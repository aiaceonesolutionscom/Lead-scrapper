"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import type { Search } from "@/types";
import {
  AlertCircle,
  ChevronRight,
  Loader2,
  RefreshCw,
  Trash2,
  ShieldCheck,
  Database,
  CheckCircle2,
  XCircle,
  Copy,
  KeyRound,
} from "lucide-react";

interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  role: "admin" | "user";
  enabled: boolean;
  password_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface UserStat extends AdminUser {
  total_searches: number;
  leads_extracted: number;
  last_search_at: string | null;
}

interface SystemStat {
  label: string;
  total_searches: number;
  leads_extracted: number;
  last_search_at: string | null;
}

interface Overview {
  users: UserStat[];
  system: SystemStat;
  totals: { searches: number; leads: number };
}

interface AppEvent {
  id: string;
  component: string;
  level: string;
  message: string;
  created_at: string;
}

type Tab = "users" | "database" | "events" | "sentry" | "config" | "health";

const STATUS = {
  pending: "bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-400",
  discovering: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  enriching: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-400",
  completed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  partially_completed: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  cancelled: "bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-500",
} as const;

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [errors, setErrors] = useState<AppEvent[]>([]);
  const [errors24h, setErrors24h] = useState<number | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [searches, setSearches] = useState<Search[]>([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [tab, setTab] = useState<Tab>("users");

  const [newUser, setNewUser] = useState({ username: "", password: "", role: "user" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [dbStatus, setDbStatus] = useState<"loading" | "connected" | "disconnected">("loading");
  const [copied, setCopied] = useState<string | null>(null);

  const checkDb = useCallback(async () => {
    setDbStatus("loading");
    try {
      await api.get("/leads", { limit: 1 });
      setDbStatus("connected");
    } catch {
      setDbStatus("disconnected");
    }
  }, []);

  const load = useCallback(async (t: Tab) => {
    try {
      setError(null);
      if (t === "users") {
        const data = await api.get<{ users: AdminUser[] }>("/admin/users");
        setUsers(data.users);
      } else if (t === "database") {
        const [ov, s] = await Promise.all([
          api.get<Overview>("/admin/overview"),
          api.get<{ searches: Search[] }>("/search", { limit: 200 }),
        ]);
        setOverview(ov);
        setSearches(s.searches);
      } else if (t === "events") {
        const data = await api.get<{ events: AppEvent[] }>("/admin/events", { tail: 80 });
        setEvents(data.events);
      } else if (t === "sentry") {
        const [e, st] = await Promise.all([
          api.get<{ events: AppEvent[] }>("/admin/events", { level: "error", tail: 200 }),
          api.get<{ errors_24h: number }>("/report-error/stats"),
        ]);
        // Only surface errors from the last 24h — matches the "errors_24h" stat
        // shown above the list, so this reads as "is something wrong right now"
        // instead of an ever-growing log of every error since setup.
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        setErrors(e.events.filter((ev) => new Date(ev.created_at).getTime() >= cutoff));
        setErrors24h(st.errors_24h);
      } else if (t === "config") {
        await checkDb();
      } else {
        const data = await api.get<Record<string, unknown>>("/admin/health");
        setHealth(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [checkDb]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(tab);
  }, [tab, load]);

  const createUser = async () => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await api.post("/admin/users", newUser);
      setNewUser({ username: "", password: "", role: "user" });
      setOk("User created");
      await load("users");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (u: AdminUser) => {
    setError(null);
    setOk(null);
    try {
      await api.put(`/admin/users/${u.id}`, { enabled: !u.enabled });
      setOk(`${u.enabled ? "Disabled" : "Enabled"} ${u.username}`);
      await load("users");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update user");
    }
  };

  const deleteUser = async (u: AdminUser) => {
    if (!window.confirm(`Delete user "${u.username}"?`)) return;
    setError(null);
    setOk(null);
    try {
      await api.del(`/admin/users/${u.id}`);
      setOk(`Deleted ${u.username}`);
      await load("users");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete user");
    }
  };

  const resetPassword = async (u: AdminUser) => {
    const password = window.prompt(`New password for "${u.username}" (min 8 chars):`);
    if (!password || password.length < 8) {
      if (password) setError("Password must be at least 8 characters");
      return;
    }
    setError(null);
    setOk(null);
    try {
      await api.post(`/admin/users/${u.id}/reset-password`, { password });
      setOk(`Password reset for ${u.username}. They must log in again.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reset password");
    }
  };

  const levelClass = (level: string) =>
    level === "error"
      ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
      : level === "warn"
        ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
        : "bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-400";

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
          <p className="text-sm text-muted-foreground">User management, database CRM, events, errors and backend health.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => load(tab)}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {(error || ok) && (
        <div className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${error ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400"}`}>
          {error ? <AlertCircle className="h-4 w-4 shrink-0" /> : null}
          <span>{error || ok}</span>
        </div>
      )}

      <div className="flex gap-2 border-b">
        {(["users", "database", "events", "sentry", "config", "health"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px capitalize ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "users" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Users</CardTitle><CardDescription>Manage who can access the CRM.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm font-medium">Add user</p>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Email</Label>
                  <Input value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} placeholder="user@example.com" inputMode="email" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Password (min 8)</Label>
                  <Input value={newUser.password} type="password" onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="••••••••" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Role</Label>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                    className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <Button onClick={createUser} disabled={busy || !newUser.username || newUser.password.length < 8} className="gap-2">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Create
                  </Button>
                </div>
              </div>
            </div>

            <div className="border rounded-lg divide-y">
              {users.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-3 p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{u.username}</span>
                      <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-[10px] px-1.5">{u.role}</Badge>
                      {!u.enabled && <Badge variant="destructive" className="text-[10px] px-1.5">disabled</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {u.email || u.username} · Joined {new Date(u.created_at).toLocaleDateString()}
                      {u.password_changed_at ? (
                        <> · Password changed {new Date(u.password_changed_at).toLocaleString()}</>
                      ) : (
                        " · Password never changed"
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => resetPassword(u)}>
                      <KeyRound className="h-3.5 w-3.5" /> Reset
                    </Button>
                    <Button variant="outline" size="sm" className="h-8" disabled={u.role === "admin"} onClick={() => toggleEnabled(u)}>
                      {u.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" disabled={u.role === "admin"} onClick={() => deleteUser(u)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "database" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Database className="h-4 w-4" /> Database — CRM</CardTitle>
            <CardDescription>Kis user ne kaun si leads nikali, kab nikali — sab yahan se control karein.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {overview ? (
              <>
                <div className="flex gap-3">
                  <Badge variant="outline" className="text-xs">Total searches: {overview.totals.searches}</Badge>
                  <Badge variant="outline" className="text-xs">Total leads: {overview.totals.leads}</Badge>
                </div>
                <div className="border rounded-lg divide-y">
                  {[...overview.users, { ...overview.system, id: "__system__", username: overview.system.label, role: "—" as const, enabled: true, created_at: "", updated_at: "" }].map((u) => (
                    <div key={u.id}>
                      <button
                        className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-muted/40"
                        onClick={() => setExpandedUser(expandedUser === u.id ? null : u.id)}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{u.username}</span>
                            {u.role === "admin" || u.role === "user" ? (
                              <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-[10px] px-1.5">{u.role}</Badge>
                            ) : (
                              <Badge variant="secondary" className="text-[10px] px-1.5">imported</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">Last extraction: {fmt(u.last_search_at)}</p>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-xs text-muted-foreground hidden sm:inline">{u.total_searches} searches</span>
                          <span className="font-semibold">{u.leads_extracted} leads</span>
                          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expandedUser === u.id ? "rotate-90" : ""}`} />
                        </div>
                      </button>
                      {expandedUser === u.id && (
                        <div className="border-t px-3 py-2 space-y-1 max-h-[50vh] overflow-auto">
                          {searches.filter((s) => (u.id === "__system__" ? !s.created_by : s.created_by === u.id)).length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2">No searches.</p>
                          ) : (
                            searches
                              .filter((s) => (u.id === "__system__" ? !s.created_by : s.created_by === u.id))
                              .map((s) => (
                                <div key={s.id} className="flex items-center justify-between gap-3 py-1.5 border-b last:border-b-0">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm truncate">&ldquo;{s.keyword}&rdquo;</span>
                                      <span className="text-xs text-muted-foreground shrink-0">{s.search_mode === "city" ? s.city : s.country}</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                      {fmt(s.created_at)} · {s.enriched_count}/{s.requested_count} enriched
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <Badge className={`text-[10px] px-1.5 ${STATUS[s.status] ?? "bg-gray-100"}`}>{s.status}</Badge>
                                    <Link href={`/crm?search_id=${s.id}`}>
                                      <Button variant="outline" size="sm" className="h-7">View leads</Button>
                                    </Link>
                                  </div>
                                </div>
                              ))
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "events" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Events</CardTitle><CardDescription>Recent backend activity (auth, searches, errors).</CardDescription></CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No events recorded.</p>
            ) : (
              <div className="border rounded-lg divide-y max-h-[60vh] overflow-auto">
                {events.map((e) => (
                  <div key={e.id} className="flex items-start gap-3 p-3">
                    <Badge className={`text-[10px] px-1.5 shrink-0 mt-0.5 ${levelClass(e.level)}`}>{e.level}</Badge>
                    <div className="min-w-0">
                      <pre className="text-sm break-words whitespace-pre-wrap font-sans">{e.message}</pre>
                      <p className="text-xs text-muted-foreground">{e.component} · {fmt(e.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "sentry" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sentry — Errors</CardTitle>
            <CardDescription>
              Backend aur browser ke errors yahan log hote hain (last 24h: {errors24h ?? "…"} client errors).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {errors.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Koi error nahi — sab kuch sahi chal raha hai.</p>
            ) : (
              <div className="border rounded-lg divide-y max-h-[60vh] overflow-auto">
                {errors.map((e) => (
                  <div key={e.id} className="flex items-start gap-3 p-3">
                    <Badge className={`text-[10px] px-1.5 shrink-0 mt-0.5 ${levelClass(e.level)}`}>{e.level}</Badge>
                    <div className="min-w-0">
                      <pre className="text-sm text-destructive break-words whitespace-pre-wrap font-sans">{e.message}</pre>
                      <p className="text-xs text-muted-foreground">{e.component} · {fmt(e.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "config" && (
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="h-4 w-4" /> Database Connection
              </CardTitle>
              <CardDescription>Local SQLite database (server/data/crm.db)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-center gap-3">
                  {dbStatus === "loading" && (
                    <>
                      <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
                      <span className="text-sm font-medium">Checking connection...</span>
                    </>
                  )}
                  {dbStatus === "connected" && (
                    <>
                      <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                      <div>
                        <span className="text-sm font-medium text-green-700 dark:text-green-400">Connected</span>
                        <p className="text-xs text-muted-foreground">Database is accessible and working</p>
                      </div>
                    </>
                  )}
                  {dbStatus === "disconnected" && (
                    <>
                      <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                      <div>
                        <span className="text-sm font-medium text-red-700 dark:text-red-400">Disconnected</span>
                        <p className="text-xs text-muted-foreground">Cannot reach the database.</p>
                      </div>
                    </>
                  )}
                </div>
                <Button variant="outline" size="sm" className="gap-1" onClick={checkDb}>
                  <RefreshCw className="h-3.5 w-3.5" /> Check
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Backend Setup</CardTitle>
              <CardDescription>How this laptop serves the whole system.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex gap-3">
                <Badge variant="outline" className="shrink-0 h-5 w-5 justify-center rounded-full p-0 text-[10px]">1</Badge>
                <span>
                  Run <code className="bg-muted px-1 py-0.5 rounded text-[11px]">scripts\run-backend.cmd</code> —
                  Express binds to <code className="bg-muted px-1 py-0.5 rounded text-[11px]">127.0.0.1:5000</code>.
                </span>
              </div>
              <div className="flex gap-3">
                <Badge variant="outline" className="shrink-0 h-5 w-5 justify-center rounded-full p-0 text-[10px]">2</Badge>
                <span>
                  <code className="bg-muted px-1 py-0.5 rounded text-[11px]">NEXT_PUBLIC_API_BASE_URL</code> tells the
                  browser where to send API calls. Locally it is{" "}
                  <code className="bg-muted px-1 py-0.5 rounded text-[11px]">http://localhost:5000</code>; on Vercel use
                  your fixed Cloudflare tunnel URL.
                </span>
              </div>
              <div className="flex gap-3">
                <Badge variant="outline" className="shrink-0 h-5 w-5 justify-center rounded-full p-0 text-[10px]">3</Badge>
                <span>
                  Everything stays on D: — DB, logs, Chromium, npm cache and temp files live under{" "}
                  <code className="bg-muted px-1 py-0.5 rounded text-[11px]">.runtime\</code>, nothing on C:.
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Environment Variables
              </CardTitle>
              <CardDescription>Required in your .env.local file</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="text-xs bg-muted rounded-lg p-4 overflow-auto whitespace-pre-wrap leading-relaxed">
{`PORT=5000
HOST=127.0.0.1
ALLOWED_ORIGINS=http://localhost:3000,__YOUR_VERCEL_URL__
SESSION_COOKIE_NAME=sid
SESSION_TTL_HOURS=24
LOGIN_MAX_FAILURES_PER_IP=10
LOGIN_MAX_FAILURES_PER_USER=6
LOGIN_LOCK_WINDOW_MINUTES=15
NEXT_PUBLIC_API_BASE_URL=https://__YOUR_TUNNEL_URL__
PLAYWRIGHT_BROWSERS_PATH=D:\\Office work\\yawar leads\\playwright-browsers`}
              </pre>
              <Button variant="outline" size="sm" className="gap-2 mt-3" onClick={() => handleCopy(`PORT=5000\nHOST=127.0.0.1\nALLOWED_ORIGINS=http://localhost:3000,__YOUR_VERCEL_URL__\nSESSION_COOKIE_NAME=sid\nSESSION_TTL_HOURS=24\nLOGIN_MAX_FAILURES_PER_IP=10\nLOGIN_MAX_FAILURES_PER_USER=6\nLOGIN_LOCK_WINDOW_MINUTES=15\nNEXT_PUBLIC_API_BASE_URL=https://__YOUR_TUNNEL_URL__\nPLAYWRIGHT_BROWSERS_PATH=D:\\Office work\\yawar leads\\playwright-browsers`, "env")}>
                <Copy className="h-3.5 w-3.5" /> {copied === "env" ? "Copied!" : "Copy"}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "health" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Backend Health</CardTitle></CardHeader>
          <CardContent>
            {!health ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
            ) : (
              <pre className="text-xs bg-muted rounded-lg p-4 overflow-auto max-h-[70vh]">{JSON.stringify(health, null, 2)}</pre>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}