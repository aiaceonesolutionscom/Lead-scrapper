"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface BrandLoaderProps {
  /** Optional short status text under the loader (e.g. "Discovering businesses…"). */
  label?: string;
  /** When true, shows an animated indeterminate progress bar instead of just the spinner. */
  progress?: boolean;
  className?: string;
}

/**
 * Premium branded loading state used across the app (auth gate, pages,
 * running searches). Shows the branded "LE" mark with a pulsing ring + a
 * subtle gradient sweep; `progress` mode adds an indeterminate bar suited to
 * long-running extraction statuses.
 */
export function BrandLoader({ label, progress = false, className }: BrandLoaderProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 py-16", className)}>
      <div className="relative flex h-16 w-16 items-center justify-center">
        <div className="absolute inset-0 rounded-2xl bg-primary/20 animate-pulse" />
        <div className="absolute -inset-2 rounded-3xl bg-gradient-to-tr from-primary/0 via-primary/30 to-primary/0 blur-sm animate-pulse" />
        <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-lg shadow-lg">
          LE
        </div>
      </div>

      {progress ? (
        <div className="w-56 space-y-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-primary to-transparent animate-[indeterminate_1.2s_ease-in-out_infinite]" />
          </div>
          {label && <p className="text-center text-sm text-muted-foreground">{label}</p>}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          {label && <p className="text-sm text-muted-foreground">{label}</p>}
        </div>
      )}
    </div>
  );
}