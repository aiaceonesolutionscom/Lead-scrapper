"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getCurrentUser, type AuthUser } from "@/lib/api";
import { installErrorReporter } from "@/lib/error-report";
import { Sidebar } from "@/components/shared/sidebar";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { NotificationsBell } from "@/components/shared/notifications-bell";
import { BrandLoader } from "@/components/shared/brand-loader";
import { OnboardingModal } from "@/components/shared/onboarding-modal";
import { ConnectionStatus } from "@/components/shared/connection-status";
import { markOnboardingSeen } from "@/lib/api";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    installErrorReporter();
    let mounted = true;
    getCurrentUser().then((u) => {
      if (mounted) setUser(u);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (user === null || user === undefined) return;
    const isAdmin = user.role === "admin";
    if (isAdmin) {
      // Admins manage everything: admin panel, CRM, and the search workflow
      // (needed to watch live extraction logs at /search/[id]).
      const allowed =
        pathname.startsWith("/admin") ||
        pathname.startsWith("/crm") ||
        pathname.startsWith("/profile") ||
        pathname.startsWith("/settings") ||
        pathname.startsWith("/search") ||
        pathname.startsWith("/search-history");
      if (!allowed) router.replace("/admin");
    } else if (pathname.startsWith("/admin") || pathname.startsWith("/admin/")) {
      router.replace("/search/new");
    }
  }, [user, pathname, router]);

  if (pathname.startsWith("/login")) {
    return <>{children}</>;
  }

  if (user === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <BrandLoader label="Signing you in…" />
      </div>
    );
  }

  if (user === null) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-lg">
            LE
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">Please log in</h1>
            <p className="text-sm text-muted-foreground max-w-sm">
              You must be signed in to access the Lead Extractor + CRM.
            </p>
          </div>
          <Link href={`/login?next=${encodeURIComponent(pathname)}`}>
            <Button>Log In</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <ConnectionStatus />
      <Sidebar user={user} />
      {/* Notifications bell lives outside the sidebar so it is never clipped by
          the narrow sidebar column on mobile or laptop. Anchored to the top-right
          of the viewport. */}
      {user && (
        <div className="fixed right-3 top-3 z-[60] md:right-4 md:top-3">
          <NotificationsBell />
        </div>
      )}
      <main className="flex-1 overflow-auto">
        <div className="pt-16 px-4 pb-4 md:p-6 lg:p-8">
          <div className="md:hidden flex items-center justify-between gap-2 py-1">
            <span className="text-lg font-bold tracking-tight">LE</span>
            <ThemeToggle />
          </div>
          {children}
          <footer className="mt-10 border-t pt-4 text-center text-xs text-muted-foreground">
            © 2026 MJ Labs · A product by Muneeb Jawwad
          </footer>
        </div>
      </main>
      {user && !user.onboarding_seen && (
        <OnboardingModal
          username={user.username}
          onDone={async () => {
            await markOnboardingSeen(true).catch(() => {});
            setUser({ ...user, onboarding_seen: true });
          }}
        />
      )}
    </div>
  );
}