import { Router } from 'express';
import {
  asyncHandler,
  requireAuth,
  sendError,
  type AppRequest,
  type AppResponse,
} from '../middleware';
import { config } from '../config';
import { db, logEvent, nowIso } from '../db';
import { passwordValidationMessage } from '../password-policy';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  getUserByLogin,
  hashPassword,
  setLastSeenNow,
  setSessionCookie,
  toAppUser,
  verifyPassword,
} from '../auth';

export const authRouter = Router();

// ---- Brute-force protection ------------------------------------------------
// Two independent sliding windows: per-IP failure count and per-username
// failure count. Crossing either threshold temporarily locks that IP/user.
const ipFailures = new Map<string, number[]>();
const userFailures = new Map<string, number[]>();
const LOCK_MS = config.loginLockWindowMinutes * 60 * 1000;

function prune(map: Map<string, number[]>, key: string): number[] {
  const now = Date.now();
  const recent = (map.get(key) || []).filter((t) => now - t < LOCK_MS);
  map.set(key, recent);
  return recent;
}

function isLocked(key: string, map: Map<string, number[]>, limit: number): boolean {
  return prune(map, key).length >= limit;
}

function recordFailure(key: string, map: Map<string, number[]>): void {
  const list = prune(map, key);
  list.push(Date.now());
  map.set(key, list);
}

function clearFailures(username: string, ip: string): void {
  userFailures.delete(username.toLowerCase());
  ipFailures.delete(ip);
}

authRouter.post(
  '/login',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const body = (req.body || {}) as {
      username?: unknown;
      email?: unknown;
      password?: unknown;
      company_website?: unknown;
      captchaToken?: unknown;
    };
    const identifier = typeof body.email === 'string' && body.email.trim() ? body.email : body.username;
    const password = body.password;
    const ip = req.ip || 'unknown';

    // Cloudflare Turnstile — when a secret key is configured the request must
    // carry a valid token. Two distinct states:
    //   - no captchaToken field at all  -> client never had Turnstile; verify
    //     as usual when a key is configured (reject).
    //   - captchaToken === ""           -> client's widget timed out because
    //     the challenge endpoint is unreachable on a flaky network (CGNAT);
    //     allow the login to proceed — brute-force protection below (per-IP /
    //     per-user failure locks, per-minute request cap) still applies.
    if (config.turnstileSecretKey) {
      const raw = body.captchaToken;
      const token = typeof raw === 'string' ? raw : '';
      const skipped = typeof raw === 'string' && raw === '';
      if (!skipped) {
        if (!token) {
          return sendError(res, 400, 'Security check failed. Please try again.');
        }
        try {
          const params = new URLSearchParams();
          params.set('secret', config.turnstileSecretKey);
          params.set('response', token);
          const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
          });
          const data = (await resp.json()) as { success?: boolean; 'error-codes'?: string[] };
          if (!data.success) {
            logEvent('AUTH', 'warn', `Turnstile verification failed for ${ip}: ${data['error-codes']?.join(',') || 'unknown'}`);
            return sendError(res, 400, 'Security check failed. Please try again.');
          }
        } catch {
          logEvent('AUTH', 'warn', `Turnstile verify request error for ${ip}`);
          return sendError(res, 500, 'Security check unavailable. Please try again.');
        }
      } else {
        logEvent('AUTH', 'info', `Turnstile skipped (widget timeout) for ${ip}`);
      }
    }

    // Honeypot — a visually-hidden field the login form never asks real users
    // to fill. Autofill bots populate it; humans leave it empty. When tripped
    // we answer with the exact same 401 as a bad password so the bot cannot
    // tell it was detected, and we do NOT count it as a per-IP/user failure
    // (a bot hammering one shared IP must not lock out a real user).
    const spamField = typeof body.company_website === 'string' ? body.company_website.trim() : '';
    if (spamField) {
      logEvent('AUTH', 'warn', `Login honeypot triggered from ${ip}`);
      return sendError(res, 401, 'Invalid email or password');
    }

    if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier.trim() || !password) {
      return sendError(res, 400, 'Email and password are required');
    }

    const userKey = identifier.trim().toLowerCase();
    if (isLocked(ip, ipFailures, config.loginMaxFailuresPerIp) || isLocked(userKey, userFailures, config.loginMaxFailuresPerUser)) {
      logEvent('AUTH', 'warn', `Login lockout for ${ip} / "${identifier}"`);
      return sendError(res, 429, 'Too many failed attempts. Try again later.');
    }

    if (!password || password.length < 8) {
      return sendError(res, 400, 'Password must be at least 8 characters');
    }

    const user = getUserByLogin(userKey);
    const stored = user
      ? (db
          .prepare('SELECT password_hash, enabled FROM users WHERE id = ?')
          .get(user.id) as { password_hash: string; enabled: number } | undefined)
      : undefined;

    if (!user || !stored || !stored.enabled || !(await verifyPassword(password, stored.password_hash))) {
      recordFailure(ip, ipFailures);
      recordFailure(userKey, userFailures);
      logEvent('AUTH', 'warn', `Failed login attempt for "${identifier}" from ${ip}`);
      return sendError(res, 401, 'Invalid email or password');
    }

    clearFailures(userKey, ip);
    const session = createSession(user.id);
    setLastSeenNow(user.id);
    const secure = req.secure || req.get('x-forwarded-proto') === 'https';
    setSessionCookie(res, session.id, secure);
    logEvent('AUTH', 'info', `User "${user.username}" logged in from ${ip}`);
    res.json({ user: toAppUser(user) });
  })
);

authRouter.post(
  '/logout',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const sid = (req.cookies?.[config.sessionCookieName] as string) || '';
    if (sid) {
      destroySession(sid);
      logEvent('AUTH', 'info', 'User logged out');
    }
    const secure = req.secure || req.get('x-forwarded-proto') === 'https';
    clearSessionCookie(res, secure);
    res.json({ success: true });
  })
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    res.json({ user: toAppUser(req.user!) });
  })
);

// POST /api/auth/onboarding { seen: boolean } — marks the first-login tour as
// seen/dismissed so it stops appearing.
authRouter.post(
  '/onboarding',
  requireAuth,
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const { seen } = (req.body || {}) as { seen?: unknown };
    const value = seen === true ? 1 : 0;
    db.prepare('UPDATE users SET onboarding_seen = ?, updated_at = ? WHERE id = ?').run(
      value,
      nowIso(),
      req.user!.id
    );
    res.json({ success: true, onboarding_seen: value === 1 });
  })
);

authRouter.put(
  '/password',
  requireAuth,
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const user = req.user!;
    const { currentPassword, newPassword } = (req.body || {}) as {
      currentPassword?: unknown;
      newPassword?: unknown;
    };
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return sendError(res, 400, 'currentPassword and newPassword are required');
    }
    const msg = passwordValidationMessage(newPassword);
    if (msg) return sendError(res, 400, msg);
    const stored = db
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(user.id) as { password_hash: string } | undefined;
    if (!stored || !(await verifyPassword(currentPassword, stored.password_hash))) {
      return sendError(res, 400, 'Current password is incorrect');
    }

    const hashed = await hashPassword(newPassword);
    const changedAt = nowIso();
    db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?').run(
      hashed,
      changedAt,
      changedAt,
      user.id
    );

    // Revoke every other session for this user (keep the current one).
    const sid = (req.cookies?.[config.sessionCookieName] as string) || '';
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(user.id, sid);

    logEvent('AUTH', 'info', `User "${user.username}" changed their password`);
    res.json({ success: true });
  })
);

// Public liveness probe (used by the frontend/tunnel).
authRouter.get('/ping', (_req, res) => {
  res.json({ ok: true, ts: nowIso(), v: '1.0.0' });
});