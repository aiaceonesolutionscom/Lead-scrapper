"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE_URL } from "@/lib/api";

/**
 * ConnectionStatus — a slim, polite banner that appears only when the backend
 * is unreachable (laptop off / network down). It disappears automatically the
 * moment the backend responds again, so users never see raw "Failed to fetch"
 * errors and don't think the app itself is broken.
 *
 * Uses the public /api/auth/ping liveness endpoint (no session required).
 * Requires FAIL_THRESHOLD consecutive failed pings before showing so a single
 * 502 blip from the flaky Vercel→Funnel hop never makes the banner blink.
 */
const CHECK_INTERVAL_MS = 15_000;
const FAIL_THRESHOLD = 2;

function checkBackend(): Promise<boolean> {
  const origin = API_BASE_URL || window.location.origin;
  const url = `${origin}/api/auth/ping`;
  return fetch(url, { cache: "no-store", credentials: "include" })
    .then((res) => res.ok)
    .catch(() => false);
}

export function ConnectionStatus() {
  // null = unknown (first check in flight) — do not show anything yet.
  const [offline, setOffline] = useState<boolean | null>(null);
  const failures = useRef(0);

  const refresh = useCallback(async () => {
    const ok = await checkBackend();
    failures.current = ok ? 0 : failures.current + 1;
    setOffline(!ok && failures.current >= FAIL_THRESHOLD);
  }, []);

  useEffect(() => {
    let mounted = true;
    checkBackend().then((ok) => {
      if (!mounted) return;
      failures.current = ok ? 0 : 1;
      setOffline(!ok && failures.current >= FAIL_THRESHOLD);
    });
    const id = window.setInterval(() => void refresh(), CHECK_INTERVAL_MS);
    window.addEventListener("online", refresh);
    return () => {
      mounted = false;
      window.clearInterval(id);
      window.removeEventListener("online", refresh);
    };
  }, [refresh]);

  const show = offline === true;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-2 border-b px-3 py-1.5 text-xs font-medium transition-all",
        show
          ? "bg-destructive/10 text-destructive border-destructive/30 opacity-100"
          : "pointer-events-none border-transparent bg-transparent opacity-0"
      )}
    >
      <WifiOff className="h-3.5 w-3.5" />
      <span>Server connection lost — retrying automatically. Your data is safe.</span>
    </div>
  );
}