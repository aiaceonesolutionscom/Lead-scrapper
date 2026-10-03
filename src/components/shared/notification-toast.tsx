"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, X, Search, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Toast {
  id: string;
  title: string;
  body?: string;
  type: "search" | "info" | "warning" | "announcement";
  link?: string;
  read: boolean;
  created_at: string;
}

interface ToastContextValue {
  pushToast: (toast: Omit<Toast, "id" | "read" | "created_at">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

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

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const Icon = typeIcon[toast.type] ?? Info;

  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), 6000);
    return () => window.clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      className={cn(
        "pointer-events-auto flex items-start gap-3 w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-3 shadow-lg",
        "animate-in slide-in-from-right-full fade-in duration-300",
        "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right-full data-[state=closed]:fade-out"
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          toast.type === "warning" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{toast.title}</p>
        {toast.body && <p className="line-clamp-2 text-xs text-muted-foreground">{toast.body}</p>}
        <p className="mt-0.5 text-[11px] text-muted-foreground/70">{timeAgo(toast.created_at)}</p>
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (toast: Omit<Toast, "id" | "read" | "created_at">) => {
      counterRef.current++;
      const full: Toast = {
        ...toast,
        id: `toast-${counterRef.current}-${Date.now()}`,
        read: false,
        created_at: new Date().toISOString(),
      };
      setToasts((prev) => [...prev.slice(-4), full]); // max 5 visible
    },
    []
  );

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      {/* Toast container */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex flex-col-reverse gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
