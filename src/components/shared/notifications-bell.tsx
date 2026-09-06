"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Loader2, Search, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { getNotifications, markNotificationsRead, type NotificationsResponse } from "@/lib/api";
import type { AppNotification } from "@/types";

const typeIcon = {
  search: Search,
  info: Info,
  warning: TriangleAlert,
  announcement: Info,
} as const;

function timeAgo(iso: string): string {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Browsers block audio before the user interacts with the page. We lazily
// create an AudioContext and unlock it on the first click/keypress, so a
// fresh login still gets the "ding" on new notifications.
let audioCtx: AudioContext | null = null;

function ensureAudio(): AudioContext | null {
  try {
    if (!audioCtx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

function playDing(): void {
  const ctx = ensureAudio();
  if (!ctx) return;
  const now = ctx.currentTime;
  [880, 1174.66].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = now + i * 0.16;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.18);
  });
}

/** Sidebar bell: polls the API, shows an unread badge and a notifications panel. */
export function NotificationsBell() {
  const router = useRouter();
  const [data, setData] = useState<NotificationsResponse>({ notifications: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<number | null>(null);
  const seenIdsRef = useRef<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getNotifications();
      setData(next);
      const ids = new Set(next.notifications.map((n) => n.id));
      const prev = seenIdsRef.current;
      if (prev !== null) {
        const hasNew = next.notifications.some((n) => !prev.has(n.id));
        if (hasNew && !document.hidden) playDing();
      }
      seenIdsRef.current = ids;
    } catch {
      // swallow — will retry on next poll
    }
  }, []);

  // Unlock the audio on the first user gesture so notification rings are not
  // cut/blocked by the browser's autoplay policy.
  useEffect(() => {
    const unlock = () => void ensureAudio();
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, []);

  // Initial fetch + polling refresh every 30s. (Deferred so the synchronous
  // setState happens outside the effect body.)
  useEffect(() => {
    const boot = window.setTimeout(() => void refresh(), 0);
    pollingRef.current = window.setInterval(() => void refresh(), 30_000);
    return () => {
      window.clearTimeout(boot);
      if (pollingRef.current) window.clearInterval(pollingRef.current);
    };
  }, [refresh]);

  // Close when clicking outside the panel.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDocClick);
    return () => document.removeEventListener("pointerdown", onDocClick);
  }, [open]);

  async function openAll() {
    setOpen(true);
    if (data.unread === 0) return;
    setBusy(true);
    try {
      await markNotificationsRead();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function markOneRead(n: AppNotification) {
    if (!n.read) {
      await markNotificationsRead([n.id]);
      setData((prev) => ({
        unread: Math.max(0, prev.unread - 1),
        notifications: prev.notifications.map((x) => (x.id === n.id ? { ...x, read: true } : x)),
      }));
    }
    if (n.link) {
      setOpen(false);
      router.push(n.link);
    }
  }

  return (
    <div ref={panelRef} className="relative">
      <button
        onClick={() => (open ? setOpen(false) : void (openAll(), refresh()))}
        onPointerDown={(e) => e.stopPropagation()}
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {data.unread > 0 && (
          <span className="pointer-events-none absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
            {data.unread > 99 ? "99+" : data.unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-50 w-80 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            <button
              onClick={openAll}
              disabled={busy || data.unread === 0}
              className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
              Mark all read
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto divide-y">
            {data.notifications.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">No notifications yet.</p>
            ) : (
              data.notifications.map((n) => {
                const Icon = typeIcon[n.type] ?? Info;
                const inner = (
                  <>
                    <Icon
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0",
                        n.type === "warning" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{n.title}</p>
                      {n.body && <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                      <p className="mt-0.5 text-[11px] text-muted-foreground/70">{timeAgo(n.created_at)}</p>
                    </div>
                    {!n.read && <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" />}
                  </>
                );
                return n.link ? (
                  <Link
                    key={n.id}
                    href={n.link}
                    onClick={() => void markOneRead(n)}
                    className="flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-muted"
                  >
                    {inner}
                  </Link>
                ) : (
                  <button
                    key={n.id}
                    onClick={() => void markOneRead(n)}
                    className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted"
                  >
                    {inner}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}