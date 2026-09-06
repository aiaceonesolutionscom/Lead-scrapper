"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme, type ThemeMode } from "@/components/shared/theme-provider";
import { Button } from "@/components/ui/button";

const OPTIONS: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: "auto", label: "Auto", Icon: Monitor },
  { mode: "light", label: "Light", Icon: Sun },
  { mode: "dark", label: "Dark", Icon: Moon },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { mode, setMode } = useTheme();

  const current = OPTIONS.find((o) => o.mode === mode) ?? OPTIONS[0];
  const next = OPTIONS[(OPTIONS.findIndex((o) => o.mode === mode) + 1) % OPTIONS.length];

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("h-8 w-8", className)}
      title={`Theme: ${current.label}. Click for ${next.label}.`}
      onClick={() => setMode(next.mode)}
    >
      <current.Icon className="h-4 w-4" />
    </Button>
  );
}