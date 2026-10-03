"use client";

import { Suspense, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, AlertCircle, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BrandLoader } from "@/components/shared/brand-loader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { cn } from "@/lib/utils";
import { api, type AuthUser } from "@/lib/api";
import { Turnstile, TURNSTILE_SITE_KEY } from "@/components/shared/turnstile";

function LoginForm() {
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");
  const next =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Honeypot — invisible to humans, bots autofill it. If non-empty the
  // backend silently rejects the submission as a bot.
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [turnstileTimedOut, setTurnstileTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Turnstile tokens are single-use. A consumed token (any submit, success or
  // failure) must never be sent again — Cloudflare answers "timeout-or-duplicate"
  // and the user sees "Security check failed". Reset the widget after every
  // attempt so a fresh token is minted for the next one.
  const resetTurnstileRef = useRef<(() => void) | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }

    if (TURNSTILE_SITE_KEY && !captchaToken && !turnstileTimedOut) {
      setError("Please complete the security check.");
      return;
    }

    setSubmitting(true);
    try {
      const { user } = await api.post<{ user: AuthUser }>("/auth/login", {
        email: email.trim(),
        username: email.trim(),
        password,
        company_website: companyWebsite,
        // If Turnstile timed out (challenge endpoint unreachable on flaky
        // networks) we send "skip" — the backend only skips verification for
        // the explicit empty string, never for a tampered/missing token.
        captchaToken: turnstileTimedOut ? "" : TURNSTILE_SITE_KEY ? captchaToken : undefined,
      });
      const dest = user?.role === "admin" ? "/admin" : next;
      window.location.assign(dest);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed. Please try again.");
    } finally {
      setSubmitting(false);
      // Fresh challenge for the next attempt (the sent token is now spent).
      setCaptchaToken("");
      setTurnstileTimedOut(false);
      resetTurnstileRef.current?.();
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4 relative">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-lg"
            )}
          >
            LE
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Lead Extractor + CRM</h1>
            <p className="text-sm text-muted-foreground">
              Sign in to manage your leads
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Sign In</CardTitle>
            <CardDescription>Enter your credentials to continue.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Honeypot — visually hidden, real bots autofill it. */}
              <input
                type="text"
                name="company_website"
                value={companyWebsite}
                onChange={(e) => setCompanyWebsite(e.target.value)}
                className="sr-only"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
              />

              <div className="space-y-2">
                <Label htmlFor="username">Email or username</Label>
                <Input
                  id="username"
                  type="text"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  placeholder="email@example.com or username"
                  disabled={submitting}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={submitting}
                />
              </div>

              {TURNSTILE_SITE_KEY && (
                <div className="space-y-2">
                  <Turnstile
                    onToken={setCaptchaToken}
                    onExpired={() => {
                      setCaptchaToken("");
                      // Re-mint a token after the 5-min expiry instead of
                      // leaving the submit button permanently disabled.
                      resetTurnstileRef.current?.();
                    }}
                    onTimeout={() => {
                      // Challenge endpoint unreachable (flaky network). Allow
                      // rate-limited login without a CAPTCHA token.
                      setTurnstileTimedOut(true);
                    }}
                    resetRef={resetTurnstileRef}
                  />
                  {turnstileTimedOut && (
                    <p className="text-xs text-muted-foreground">
                      Security check unavailable on this network — you can still sign in.
                    </p>
                  )}
                </div>
              )}

              <Button
                type="submit"
                className="w-full gap-2"
                disabled={submitting || ((TURNSTILE_SITE_KEY ? true : false) && !captchaToken && !turnstileTimedOut)}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogIn className="h-4 w-4" />
                )}
                {submitting ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground space-y-0.5">
          <span className="block">Lead Extractor + CRM v1.0</span>
          <span className="block text-muted-foreground/70">Built by MJ Labs · A product by Muneeb Jawwad</span>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <BrandLoader label="Loading login…" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}