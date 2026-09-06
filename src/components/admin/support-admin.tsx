"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BrandLoader } from "@/components/shared/brand-loader";
import { cn } from "@/lib/utils";
import { getAllThreads, getThreadMessages, postThreadMessage, setThreadStatus } from "@/lib/api";
import type { SupportMessage, SupportThread } from "@/types";
import { Send, Loader2, RefreshCw, LifeBuoy, MessageSquare, AlertCircle } from "lucide-react";

/** Admin support console: all tickets with an inline chat + reply. */
export function SupportAdmin() {
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");

  const endRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    try {
      setThreads((await getAllThreads()).threads);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadThreads(), 0);
    return () => window.clearTimeout(timer);
  }, [loadThreads]);

  const refreshOpen = useCallback(async (id: string) => {
    try {
      const detail = await getThreadMessages(id);
      setMessages(detail.messages);
      setThread(detail.thread);
    } catch {
      // non-critical; keep last known messages
    }
  }, []);

  // Poll the open thread so new user messages appear without a manual refresh.
  useEffect(() => {
    if (!openId) return;
    const timer = window.setInterval(() => void refreshOpen(openId), 10_000);
    return () => window.clearInterval(timer);
  }, [openId, refreshOpen]);

  async function openThread(t: SupportThread) {
    setOpenId(t.id);
    setThread(t);
    setReply("");
    try {
      const detail = await getThreadMessages(t.id);
      setMessages(detail.messages);
      setThread(detail.thread);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load conversation");
    }
  }

  useEffect(() => {
    if (openId && endRef.current) endRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages, openId]);

  async function handleReply() {
    if (!thread || !reply.trim()) return;
    setBusy(true);
    try {
      await postThreadMessage(thread.id, reply.trim());
      setReply("");
      const detail = await getThreadMessages(thread.id);
      setMessages(detail.messages);
      setThread(detail.thread);
      await loadThreads();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send reply");
    } finally {
      setBusy(false);
    }
  }

  async function handleStatus(t: SupportThread) {
    setBusy(true);
    try {
      const next: "open" | "closed" = t.status === "open" ? "closed" : "open";
      await setThreadStatus(t.id, next);
      if (thread?.id === t.id) setThread({ ...thread, status: next });
      await loadThreads();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update ticket");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <BrandLoader label="Loading support tickets…" className="py-14" />;

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <LifeBuoy className="h-4 w-4" /> All support tickets ({threads.length})
        </p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void loadThreads()}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <div className="divide-y rounded-lg border">
        {threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No support tickets yet.</p>
          </div>
        ) : (
          threads.map((t) => {
            const expanded = openId === t.id;
            return (
              <div key={t.id}>
                <button
                  onClick={() => void (expanded ? setOpenId(null) : openThread(t))}
                  className="flex w-full items-center justify-between gap-3 p-3 text-left transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{t.subject}</span>
                      <Badge variant={t.status === "open" ? "default" : "secondary"} className="shrink-0 text-[10px] px-1.5">
                        {t.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t.user_username || "—"} · {t.message_count ?? 0} message(s)
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {t.last_message_at ? new Date(t.last_message_at).toLocaleString() : "—"}
                  </span>
                </button>

                {expanded && thread && (
                  <div className="border-t bg-muted/20 px-3 py-3">
                    <div className="max-h-[320px] space-y-2 overflow-y-auto rounded-lg border bg-background p-3">
                      {messages.length === 0 ? (
                        <p className="py-4 text-center text-sm text-muted-foreground">No messages yet.</p>
                      ) : (
                        messages.map((m) => (
                          <div key={m.id} className={cn("flex", m.role === "admin" ? "justify-end" : "justify-start")}>
                            <div
                              className={cn(
                                "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                                m.role === "admin" ? "bg-primary text-primary-foreground" : "bg-muted"
                              )}
                            >
                              <p className={cn("mb-0.5 text-xs font-medium", m.role === "admin" ? "text-primary-foreground/80" : "text-muted-foreground")}>
                                {m.role === "admin" ? "Admin (you)" : m.username || "User"}
                              </p>
                              <p className="whitespace-pre-wrap break-all">{m.body}</p>
                              <p className={cn("mt-1 text-[10px]", m.role === "admin" ? "text-primary-foreground/70" : "text-muted-foreground/70")}>
                                {new Date(m.created_at).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                      <div ref={endRef} />
                    </div>

                    <div className="mt-3 flex items-end gap-2">
                      <textarea
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        disabled={busy || thread.status === "closed"}
                        rows={2}
                        placeholder={thread.status === "closed" ? "This ticket is closed." : "Type your reply…"}
                        className="flex min-h-[60px] flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <Button onClick={() => void handleReply()} disabled={busy || !reply.trim() || thread.status === "closed"} className="gap-2">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Reply
                      </Button>
                      <Button variant="outline" onClick={() => void handleStatus(thread)} disabled={busy} className="shrink-0">
                        {thread.status === "open" ? "Close" : "Reopen"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}