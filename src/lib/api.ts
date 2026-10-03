"use client";

/**
 * Central API client. All requests go to the backend (Cloudflare tunnel) with
 * credentials so the httpOnly session cookie is sent cross-origin and the
 * server can identify the logged-in user. Any 401 redirects to /login.
 */

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

const API_PREFIX = API_BASE_URL ? `${API_BASE_URL}/api` : "/api";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 400;

// 502/503/504 = Vercel proxy couldn't reach the tunnel; 530 = Cloudflare's
// transient "tunnel reconnecting" error page. All four are hop-level blips on
// the flaky CGNAT link and worth a retry.
const RETRYABLE_STATUS = new Set([502, 503, 504, 530]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomJitter(): number {
  return Math.floor(Math.random() * 200);
}

/**
 * The Vercel proxy → Cloudflare quick tunnel hop is on a flaky 5G NAT, so a
 * small share of requests fail with 502/503/504/530 or "Failed to fetch" even
 * though the backend is fine. Worse, the proxy streams the tunnel response, so
 * a drop MID-BODY (after status 200) surfaces only when the body is read — never
 * as a fetch() rejection. To catch those both, the body is read inside the
 * retry loop; a mid-stream drop throws in the reader and we retry the whole
 * request so the blip is invisible to the user.
 */
async function fetchWithRetryCore<T>(
  url: string,
  init: RequestInit,
  retries: number,
  read: (res: Response) => Promise<T>
): Promise<{ status: number; headers: Headers; body: T }> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (retries <= 0) throw err;
    await sleep(RETRY_BASE_MS * (MAX_RETRIES - retries + 1) + randomJitter());
    return fetchWithRetryCore(url, init, retries - 1, read);
  }

  if (retries > 0 && RETRYABLE_STATUS.has(res.status)) {
    await sleep(RETRY_BASE_MS * (MAX_RETRIES - retries + 1) + randomJitter());
    return fetchWithRetryCore(url, init, retries - 1, read);
  }

  try {
    return { status: res.status, headers: res.headers, body: await read(res) };
  } catch {
    // Mid-stream tunnel drop (ERR_CONTENT_DECODING_FAILED / aborted body) on an
    // otherwise-good 200 — retry the whole request so the blip is invisible.
    if (retries <= 0) throw new Error("Failed to fetch");
    await sleep(RETRY_BASE_MS * (MAX_RETRIES - retries + 1) + randomJitter());
    return fetchWithRetryCore(url, init, retries - 1, read);
  }
}

const readText = (res: Response): Promise<string> => res.text();
const readBlob = (res: Response): Promise<Blob> => res.blob();

interface BufferedResponse {
  status: number;
  headers: Headers;
  text: string;
}

async function fetchBuffered(
  url: string,
  init: RequestInit,
  retries: number
): Promise<BufferedResponse> {
  const { status, headers, body } = await fetchWithRetryCore(url, init, retries, readText);
  return { status, headers, text: body };
}

async function parseError(res: BufferedResponse): Promise<string> {
  try {
    const data = JSON.parse(res.text) as { error?: string; message?: string };
    return data?.error || data?.message || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export async function request<T = unknown>(
  path: string,
  options: ApiOptions = {}
): Promise<T> {
  const { method = "GET", body, query, headers } = options;

  let url = `${API_PREFIX}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const buffered = await fetchBuffered(
    url,
    {
      method,
      credentials: "include",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    MAX_RETRIES
  );

  if (buffered.status === 401) {
    // Not logged in / session expired → send the user to login, but prefer the
    // server's own message (e.g. "Invalid email or password") when it has one.
    const serverMsg = parseError(buffered).catch(() => "Not authenticated");
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      const redirect = encodeURIComponent(
        window.location.pathname + window.location.search
      );
      window.location.href = `/login?next=${redirect}`;
    }
    throw new ApiError(401, await serverMsg);
  }

  if (buffered.status >= 400) {
    // Non-2xx status — the request actually reached a backend (or the proxy's
    // "Upstream unreachable" answer); surface its real message.
    throw new ApiError(buffered.status, await parseError(buffered));
  }

  const ct = buffered.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      return JSON.parse(buffered.text) as T;
    } catch {
      throw new ApiError(buffered.status, "Invalid server response");
    }
  }
  return undefined as T;
}

/** JSON helpers bound to /api */
export const api = {
  get: <T = unknown>(path: string, query?: ApiOptions["query"]) =>
    request<T>(path, { query }),
  post: <T = unknown>(path: string, body?: unknown, query?: ApiOptions["query"]) =>
    request<T>(path, { method: "POST", body, query }),
  put: <T = unknown>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body }),
  del: <T = unknown>(path: string, query?: ApiOptions["query"]) =>
    request<T>(path, { method: "DELETE", query }),
};

/** Download a blob from a POST endpoint (exports). */
export async function downloadPost(
  path: string,
  payload: unknown,
  filename: string
): Promise<void> {
  // Blob download: CSV/PDF/XLSX are binary-ish payloads, so buffer with
  // res.blob() inside the retry loop (mid-stream drops get retried).
  const { status, body: blob } = await fetchWithRetryCore(
    `${API_PREFIX}${path}`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    MAX_RETRIES,
    readBlob
  );
  if (status >= 400) {
    const msg = await parseError({ status, headers: new Headers(), text: "" });
    throw new ApiError(status, msg);
  }
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

export interface AuthUser {
  id: string;
  username: string;
  email: string | null;
  role: "admin" | "user";
  enabled: boolean;
  onboarding_seen: boolean;
  password_changed_at: string | null;
  last_seen_at?: string | null;
  created_at: string;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const data = await api.get<{ user: AuthUser }>("/auth/me");
    return data.user;
  } catch {
    return null;
  }
}

/** Mark the first-login onboarding tour as seen (or hidden). */
export async function markOnboardingSeen(seen = true): Promise<void> {
  await api.post("/auth/onboarding", { seen });
}

export interface NotificationsResponse {
  notifications: import("@/types").AppNotification[];
  unread: number;
}

/** Latest in-app notifications + unread count for the current user. */
export async function getNotifications(): Promise<NotificationsResponse> {
  return api.get<NotificationsResponse>("/notifications");
}

/** Mark a single, a set, or (with no ids) all notifications as read. */
export async function markNotificationsRead(ids?: string[]): Promise<void> {
  await api.post("/notifications/read", ids && ids.length ? { ids } : { all: true });
}

export interface SupportThreadListResponse {
  threads: import("@/types").SupportThread[];
}

export interface SupportThreadDetailResponse {
  thread: import("@/types").SupportThread;
  messages: import("@/types").SupportMessage[];
}

/** The current user's support threads (newest activity first). */
export async function getMyThreads(): Promise<SupportThreadListResponse> {
  return api.get<SupportThreadListResponse>("/support");
}

/** All support threads (admin only). */
export async function getAllThreads(): Promise<SupportThreadListResponse> {
  return api.get<SupportThreadListResponse>("/support/admin/list");
}

/** Open a new support thread with its first message. */
export async function createThread(subject: string, message: string): Promise<SupportThreadDetailResponse> {
  return api.post<SupportThreadDetailResponse>("/support", { subject, message });
}

/** Fetch a thread's messages (owner or admin). */
export async function getThreadMessages(threadId: string): Promise<SupportThreadDetailResponse> {
  return api.get<SupportThreadDetailResponse>(`/support/${threadId}`);
}

/** Append a message to a thread (owner or admin). */
export async function postThreadMessage(threadId: string, body: string): Promise<void> {
  await api.post(`/support/${threadId}/messages`, { body });
}

/** Close ("closed") or reopen ("open") a thread (owner or admin). */
export async function setThreadStatus(threadId: string, status: "open" | "closed"): Promise<void> {
  await api.post(`/support/${threadId}/status`, { status });
}
