"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PasswordInput } from "@/components/ui/password-input";
import { BrandLoader } from "@/components/shared/brand-loader";
import { api, getCurrentUser, type AuthUser } from "@/lib/api";
import { AlertCircle, CheckCircle2, Loader2, KeyRound } from "lucide-react";
import { isPasswordStrong, passwordErrors, passwordScore, PASSWORD_RULES } from "@/lib/password-policy";

function initials(name: string): string {
  return name
    .split(/[@._\s-]+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "U";
}

export default function ProfilePage() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    getCurrentUser().then((u) => {
      if (mounted) setUser(u);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const changePassword = async () => {
    setError(null);
    setOk(null);
    if (!isPasswordStrong(newPassword)) {
      setError(passwordErrors(newPassword).join('. '));
      return;
    }
    if (newPassword !== confirm) {
      setError("New passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await api.put("/auth/password", { currentPassword, newPassword });
      setOk("Password changed. Other sessions were signed out.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setUser(await getCurrentUser());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to change password");
    } finally {
      setBusy(false);
    }
  };

  if (user === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <BrandLoader label="Loading profile…" />
      </div>
    );
  }

  if (user === null) {
    return null;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">Your account and security.</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Account</CardTitle>
          <CardDescription>Your login information. Password changes are logged and visible to admins.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground font-bold text-xl">
              {initials(user.username)}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold">{user.username}</span>
                <Badge variant={user.role === "admin" ? "default" : "secondary"} className="text-[10px]">
                  {user.role}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{user.email || "No email set"}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Member since</p>
              <p className="font-medium">{new Date(user.created_at).toLocaleDateString()}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Password changed</p>
              <p className="font-medium">
                {user.password_changed_at ? new Date(user.password_changed_at).toLocaleString() : "Never"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <p className="font-medium capitalize">{user.enabled ? "Active" : "Disabled"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Change Password
          </CardTitle>
          <CardDescription>Use a strong password. Changing it signs you out everywhere else.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(error || ok) && (
            <div className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${error ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400"}`}>
              {error ? <AlertCircle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
              <span>{error || ok}</span>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="current">Current password</Label>
            <PasswordInput id="current" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="new">New password</Label>
              <PasswordInput id="new" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
              {newPassword.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex gap-1">
                    {PASSWORD_RULES.map((rule) => (
                      <div
                        key={rule.label}
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          rule.test(newPassword)
                            ? "bg-green-500"
                            : "bg-muted"
                        }`}
                      />
                    ))}
                  </div>
                  <p className={`text-xs ${isPasswordStrong(newPassword) ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                    {isPasswordStrong(newPassword) ? "Strong password" : `${passwordScore(newPassword)}/${PASSWORD_RULES.length} requirements met`}
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm new password</Label>
              <PasswordInput id="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </div>
          </div>
          <Button onClick={changePassword} disabled={busy || !currentPassword || !newPassword} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Update Password
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}