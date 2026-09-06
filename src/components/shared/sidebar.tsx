"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { api, type AuthUser } from "@/lib/api";
import {
  LayoutDashboard,
  Search,
  History,
  Users,
  Settings,
  Menu,
  X,
  ChevronRight,
  LogOut,
  Shield,
  UserCircle,
  LifeBuoy,
} from "lucide-react";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { NotificationsBell } from "@/components/shared/notifications-bell";

const userNav = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/search/new", label: "New Search", icon: Search },
  { href: "/search-history", label: "Search History", icon: History },
  { href: "/crm", label: "CRM", icon: Users },
  { href: "/support", label: "Support", icon: LifeBuoy },
  { href: "/profile", label: "Profile", icon: UserCircle },
  { href: "/settings", label: "Settings", icon: Settings },
];

const adminNav = [
  { href: "/admin", label: "Admin Panel", icon: Shield },
  { href: "/profile", label: "Profile", icon: UserCircle },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ user }: { user?: AuthUser | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navItems = user?.role === "admin" ? adminNav : userNav;

  async function handleLogout() {
    try {
      await api.post("/auth/logout");
    } catch {
      // continue
    }
    router.push("/login");
  }

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-50 rounded-md bg-background border border-border p-2 shadow-md md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-sidebar-bg transition-transform duration-200",
          "md:relative md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex h-14 items-center justify-between border-b px-4">
          <Link href="/" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
              LE
            </div>
            <span className="font-semibold text-sm">Lead Extractor</span>
          </Link>
          <div className="flex items-center gap-1">
            <NotificationsBell />
            <button
              onClick={() => setMobileOpen(false)}
              className="rounded-md p-1 hover:bg-muted md:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const isActive = pathname === item.href || 
              (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
                {isActive && <ChevronRight className="ml-auto h-4 w-4" />}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t p-4">
          {user && (
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm uppercase">
                {user.username.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user.username}</p>
                <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
              </div>
              <ThemeToggle />
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
          <p className="text-xs text-muted-foreground mt-3">Lead Extractor + CRM v1.0</p>
        </div>
      </aside>
    </>
  );
}
