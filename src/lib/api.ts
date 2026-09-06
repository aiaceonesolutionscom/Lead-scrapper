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

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.json();
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

  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    // Not logged in / session expired → send the user to login, but prefer the
    // server's own message (e.g. "Invalid email or password") when it has one.
    const serverMsg = await parseError(res).catch(() => "Not authenticated");
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      const redirect = encodeURIComponent(
        window.location.pathname + window.location.search
      );
      window.location.href = `/login?next=${redirect}`;
    }
    throw new ApiError(401, serverMsg);
  }

  if (!res.ok) {
    throw new ApiError(res.status, await parseError(res));
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await res.json()) as T;
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
  body: unknown,
  filename: string
): Promise<void> {
  const res = await fetch(`${API_PREFIX}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await parseError(res).catch(() => `Request failed (${res.status})`);
    throw new ApiError(res.status, msg);
  }
  const blob = await res.blob();
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
