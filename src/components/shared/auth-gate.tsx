"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCurrentUser, type AuthUser } from "@/lib/api";
import { installErrorReporter } from "@/lib/error-report";
import { Sidebar } from "@/components/shared/sidebar";

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
      const allowed =
        pathname.startsWith("/admin") ||
        pathname.startsWith("/crm") ||
        pathname.startsWith("/profile") ||
        pathname.startsWith("/settings");
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
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
      <Sidebar user={user} />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}