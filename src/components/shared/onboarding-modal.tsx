"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Search, Users, Bell, LifeBuoy, Loader2 } from "lucide-react";

const FEATURES = [
  {
    icon: Search,
    title: "New Search",
    body: "Extract verified leads for any business type + city/country — with email and phone.",
  },
  {
    icon: Users,
    title: "CRM",
    body: "All your leads in one place — status, notes, sources and one-click CSV/XLSX export.",
  },
  {
    icon: Bell,
    title: "Notifications",
    body: "Search finished or failed — instant alert, no page refresh needed.",
  },
  {
    icon: LifeBuoy,
    title: "Support",
    body: "Facing an issue? Chat directly with Support — the admin replies right away.",
  },
];

export function OnboardingModal({
  username,
  onDone,
}: {
  username: string;
  onDone: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border bg-card shadow-2xl">
        <div className="border-b px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary font-bold text-lg text-primary-foreground">
              LE
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Welcome, {username}!</h2>
              <p className="text-xs text-muted-foreground">Lead Extractor + CRM · A product by Muneeb Jawwad</p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 px-6 py-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                <f.icon className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{f.title}</p>
                <p className="text-xs text-muted-foreground">{f.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-6 py-4">
          <Button variant="ghost" disabled={busy} onClick={onDone}>
            Skip for now
          </Button>
          <Button
            className="gap-2"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onDone();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Get started
          </Button>
        </div>
      </div>
    </div>
  );
}