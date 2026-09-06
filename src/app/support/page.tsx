"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BrandLoader } from "@/components/shared/brand-loader";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  getMyThreads,
  getThreadMessages,
  createThread,
  postThreadMessage,
  setThreadStatus,
  type SupportThreadListResponse,
} from "@/lib/api";
import type { SupportMessage, SupportThread } from "@/types";
import { LifeBuoy, Plus, ArrowLeft, Send, Loader2, AlertCircle, MessageSquare } from "lucide-react";

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

function useThreads() {
  const [data, setData] = useState<SupportThreadListResponse>({ threads: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getMyThreads());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load support tickets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return { data, loading, error, reload: load };
}

export default function SupportPage() {
  const { data, loading, error, reload } = useThreads();
  const [view, setView] = useState<"list" | "thread">("list");
  const [newOpen, setNewOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [newMsg, setNewMsg] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // active thread
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [toggling, setToggling] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (view === "thread" && endRef.current) endRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages, view]);

  async function openThread(t: SupportThread) {
    setView("thread");
    setThread(t);
    setThreadLoading(true);
    setThreadError(null);
    try {
      const detail = await getThreadMessages(t.id);
      setMessages(detail.messages);
    } catch (e) {
      setThreadError(e instanceof Error ? e.message : "Failed to load conversation");
    } finally {
      setThreadLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!subject.trim() || !newMsg.trim()) {
      setFormError("Subject and message are required");
      return;
    }
    setCreating(true);
    try {
      const created = await createThread(subject.trim(), newMsg.trim());
      setSubject("");
      setNewMsg("");
      setNewOpen(false);
      await reload();
      await openThread(created.thread);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to open ticket");
    } finally {
      setCreating(false);
    }
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!thread || !reply.trim()) return;
    setSending(true);
    try {
      await postThreadMessage(thread.id, reply.trim());
      setReply("");
      const detail = await getThreadMessages(thread.id);
      setMessages(detail.messages);
      setThread(detail.thread);
    } catch (e) {
      setThreadError(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  async function handleToggleStatus() {
    if (!thread) return;
    setToggling(true);
    try {
      const next: "open" | "closed" = thread.status === "open" ? "closed" : "open";
      await setThreadStatus(thread.id, next);
      setThread(prev => (prev ? { ...prev, status: next } : prev));
      await reload();
    } catch (e) {
      setThreadError(e instanceof Error ? e.message : "Failed to update ticket");
    } finally {
      setToggling(false);
    }
  }

  if (loading) return <BrandLoader label="Loading support…" className="py-24" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Support</h1>
          <p className="text-sm text-muted-foreground">Open a ticket and chat with the admin.</p>
        </div>
        {view === "thread" ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => {
              setView("list");
              setThread(null);
              setMessages([]);
            }}
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        ) : (
          <Button size="sm" className="gap-2" onClick={() => setNewOpen(v => !v)}>
            <Plus className="h-4 w-4" /> New ticket
          </Button>
        )}
      </div>

      {(error || formError || threadError) && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{formError || error || threadError}</span>
        </div>
      )}

      {view === "list" ? (
        <>
          {newOpen && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">New support ticket</CardTitle>
                <CardDescription>Describe your issue — an admin will reply here.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreate} className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="subject">Subject</Label>
                    <Input
                      id="subject"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="e.g. Search stopped mid-way"
                      disabled={creating}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="message">Message</Label>
                    <textarea
                      id="message"
                      value={newMsg}
                      onChange={(e) => setNewMsg(e.target.value)}
                      disabled={creating}
                      rows={4}
                      className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder="What went wrong or what do you need help with?"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" disabled={creating || !subject.trim() || !newMsg.trim()} className="gap-2">
                      {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Open ticket
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => { setNewOpen(false); setFormError(null); }} disabled={creating}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <LifeBuoy className="h-4 w-4 text-muted-foreground" />
                Your tickets
                <span className="text-sm font-normal text-muted-foreground">({data.threads.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.threads.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                  <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">No tickets yet</p>
                    <p className="text-sm text-muted-foreground">Create one and the admin will reply as soon as possible.</p>
                  </div>
                </div>
              ) : (
                <div className="divide-y rounded-lg border">
                  {data.threads.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => void openThread(t)}
                      className="flex w-full flex-col gap-1 p-3 text-left transition-colors hover:bg-muted/50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{t.subject}</p>
                        <Badge variant={t.status === "open" ? "default" : "secondary"} className="shrink-0 text-[10px] px-1.5">
                          {t.status === "open" ? "open" : "closed"}
                        </Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {t.last_message || "No messages"}
                      </p>
                      <p className="text-[11px] text-muted-foreground/70">
                        {t.message_count ?? 0} message(s) · last {t.last_message_at ? timeLabel(t.last_message_at) : "—"}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base truncate">{thread?.subject}</CardTitle>
              <div className="flex shrink-0 items-center gap-2">
                {thread && (
                  <Badge variant={thread.status === "open" ? "default" : "secondary"} className="text-[10px] px-1.5">
                    {thread.status === "open" ? "open" : "closed"}
                  </Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => void handleToggleStatus()}
                  disabled={toggling || !thread}
                >
                  {toggling ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  {thread?.status === "open" ? "Close" : "Reopen"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {threadLoading ? (
              <BrandLoader label="Loading conversation…" className="py-10" />
            ) : (
              <>
                <div className="space-y-2 max-h-[420px] overflow-y-auto rounded-lg border bg-muted/30 p-3">
                  {messages.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">No messages yet.</p>
                  ) : (
                    messages.map((m) => (
                      <div
                        key={m.id}
                        className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
                      >
                        <div
                          className={cn(
                            "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                            m.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-background border"
                          )}
                        >
                          <p className={cn("mb-0.5 text-xs font-medium", m.role === "user" ? "text-primary-foreground/80" : "text-muted-foreground")}>
                            {m.role === "admin" ? "Admin" : m.username || "You"}
                          </p>
                          <p className="whitespace-pre-wrap break-all">{m.body}</p>
                          <p className={cn("mt-1 text-[10px]", m.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground/70")}>
                            {timeLabel(m.created_at)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={endRef} />
                </div>

                <form onSubmit={handleReply} className="flex items-end gap-2">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    disabled={sending || thread?.status === "closed"}
                    rows={2}
                    placeholder={thread?.status === "closed" ? "This ticket is closed." : "Type your message…"}
                    className="flex min-h-[60px] flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <Button
                    type="submit"
                    disabled={sending || !reply.trim() || thread?.status === "closed"}
                    className="gap-2"
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Send
                  </Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}