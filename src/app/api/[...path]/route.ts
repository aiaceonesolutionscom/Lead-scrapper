import { NextRequest, NextResponse } from "next/server";

// The Vercel → Cloudflare Quick Tunnel hop sits on a flaky 5G NAT, so raw
// requests to the tunnel intermittently fail with 502/503/504 during the TLS
// handshake even though the backend is healthy. This route handler retries
// those transient failures server-side (with backoff) so the client never
// sees the flakiness — the client-side fetchWithRetry in src/lib/api.ts
// remains as a second safety net.
//
// Only a small allowlist of client headers is forwarded upstream: passing
// Vercel/Next-internal headers (x-matched-path, x-vercel-*, forwarded-*, …)
// to the Cloudflare quick tunnel made POST requests fail immediately with
// "ECONNRESET"-style errors while GET worked fine. Origin/Referer MUST be
// forwarded — the backend's CSRF originGuard validates them against
// config.allowedOrigins.
//
// TARGET is 127.0.0.1 (not "localhost"): on Windows "localhost" resolves to
// BOTH ::1 (IPv6) and 127.0.0.1, while the backend binds IPv4-only. Node's
// fetch would intermittently pick ::1, get ECONNREFUSED, and burn all retries
// — surfacing as the dreaded "Upstream unreachable after retries" that
// happened at random even with a perfectly healthy backend.
//
// Cookie behavior is identical to the old next.config rewrite: the upstream
// session cookie (host-only, SameSite=None, Secure) is copied verbatim onto
// the response, so it is issued for leadlabz.vercel.app (first-party) exactly
// as before.

export const dynamic = "force-dynamic";
export const maxDuration = 25;

const TARGET = process.env.API_PROXY_TARGET || "http://127.0.0.1:5000";
const MAX_ATTEMPTS = 3;
// Retry 503/504 (transient tunnel/proxy hiccups) AND 530 — 530 is Cloudflare's
// "tunnel connection lost, retrying" error page which the quick tunnel serves
// for 10-30s during an edge reconnect on a flaky CGNAT link; the tunnel usually
// recovers within seconds so a fast retry succeeds. A 502 ANSWERED BY THE
// BACKEND is a real backend decision (e.g. its own upstream error) and must be
// returned to the client as-is.
const RETRYABLE_STATUS = new Set([503, 504, 530]);
const BACKOFF_MS = [300, 600];
// Per-attempt timeout * attempts + backoff must stay under Vercel's function
// cap (maxDuration=25s). Old values (15s x 3 + 2.1s backoff) exceeded 25s,
// so Vercel killed the function mid-flight and the browser saw "Failed to
// fetch". 7s x 3 + 0.9s = ~21.9s leaves headroom. A healthy backend answers
// in <1s, so this is plenty; slow-extraction endpoints respond async.
const ATTEMPT_TIMEOUT_MS = 7000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function forward(
  upstream: string,
  req: NextRequest,
  body: ArrayBuffer | undefined,
  method: string
): Promise<{ status: number; headers: Headers; data: ArrayBuffer }> {
  // Only forward safe client headers — Vercel/Next internal headers can confuse
  // the Cloudflare Quick Tunnel (causes immediate POST failures). Origin and
  // Referer must pass through: the backend's CSRF originGuard relies on them.
  const headers = new Headers();
  for (const [key, value] of req.headers.entries()) {
    const k = key.toLowerCase();
    if (k === "content-type" || k === "accept" || k === "authorization" || k === "cookie" ||
        k === "origin" || k === "referer" || k === "user-agent") {
      headers.set(key, value);
    }
  }
  if (body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  // Read the upstream response FULLY here instead of streaming res.body back:
  // on a flaky link cloudflared can drop the connection mid-body. If we stream
  // the body straight through, that abort is invisible to this handler (Vercel
  // already shipped the status line) and the CLIENT sees a truncated/corrupt
  // 200 — the exact "Failed to fetch" / ERR_CONTENT_DECODING_FAILED we saw. By
  // buffering, a mid-body abort throws here and is retried like any other
  // transient failure, so only a fully-good body ever reaches the client.
  const res = await fetch(upstream, {
    method,
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
  });
  const data = await res.arrayBuffer();
  return { status: res.status, headers: res.headers, data };
}

export async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path } = await params;
  const rest = path.join("/");
  const upstream = `${TARGET}/api/${rest}${req.nextUrl.search}`;

  // Read the body once up-front so every retry can reuse it.
  const hasBody = !["GET", "HEAD"].includes(req.method);
  const body = hasBody ? await req.arrayBuffer().catch(() => undefined) : undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await forward(upstream, req, body, req.method);
      if (!RETRYABLE_STATUS.has(res.status) || attempt === MAX_ATTEMPTS - 1) {
        const headers = new Headers();
        res.headers.forEach((value, key) => {
          const k = key.toLowerCase();
          if (k === "set-cookie") return;
          // Hop-by-hop headers from the upstream MUST NOT be copied: Vercel's
          // edge re-encodes the body per the CLIENT's Accept-Encoding, so a
          // stale content-length / content-encoding / transfer-encoding from
          // the backend makes the browser decode a truncated body →
          // ERR_CONTENT_DECODING_FAILED ("Failed to fetch" in the UI). Drop
          // them and let Vercel set its own accurate values.
          if (k === "content-length" || k === "content-encoding" || k === "transfer-encoding" ||
              k === "connection" || k === "keep-alive") return;
          headers.set(key, value);
        });
        // Multiple Set-Cookie values must be appended individually — the
        // Headers iterator collapses them into one comma-joined value which
        // corrupts the session cookie.
        const cookies = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
        for (const c of cookies) headers.append("set-cookie", c);
        return new NextResponse(new Uint8Array(res.data), { status: res.status, headers });
      }
      console.warn(`[/api proxy] attempt ${attempt + 1} got upstream ${res.status} (${path.join("/")}), retrying`);
    } catch (err) {
      const message = err instanceof Error ? `${err.name}: ${err.message}` : "unknown error";
      const cause = err instanceof Error && err.cause ? ` cause: ${err.cause}` : "";
      console.warn(`[/api proxy] attempt ${attempt + 1} failed ${req.method} ${path.join("/")} → ${TARGET}: ${message}${cause}`);
    }
    if (attempt < MAX_ATTEMPTS - 1) {
      await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
    }
  }

  return NextResponse.json({ error: "Upstream unreachable after retries" }, { status: 502 });
}

export { handler as GET, handler as POST, handler as PUT, handler as DELETE, handler as PATCH, handler as HEAD, handler as OPTIONS };