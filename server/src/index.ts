import express from 'express';
import type { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { repoRoot, config } from './config';
import { logEvent, purgeOldEvents } from './db';
import { cleanupExpiredSessions, createBootstrapAdminIfNeeded } from './auth';
import { corsMiddleware, requireAuth, requireAdmin, sendError } from './middleware';
import { createRateLimiter, originGuard, securityHeaders } from './security';
import { authRouter } from './routes/auth';
import { searchRouter } from './routes/search';
import { leadsRouter } from './routes/leads';
import { dashboardRouter } from './routes/dashboard';
import { exportRouter } from './routes/export';
import { logsRouter } from './routes/logs';
import { adminRouter } from './routes/admin';
import { reportRouter } from './routes/report';
import { notificationsRouter } from './routes/notifications';
import { supportRouter } from './routes/support';

// Everything (DB file, logs, Chromium) lives under the repo root on D:.
// Pin cwd regardless of where/how the server was launched so paths like
// `logs/extraction.log` and the repository `.env.local` resolve identically.
process.chdir(repoRoot);

const app = express();
app.set('trust proxy', true); // tunnel terminates TLS; log real client IPs

app.use(securityHeaders);
app.use(originGuard);
app.use(corsMiddleware);
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Public liveness probe
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', v: '1.0.0' });
});

// Per-IP read throttles (anti-scrape). Write/search-start traffic is small
// and already behind auth; exports get a tighter window because they leak
// the whole dataset at once.
const readLimiter = createRateLimiter('list', 120, 60_000);
const exportLimiter = createRateLimiter('export', 10, 60_000);
const opsLimiter = createRateLimiter('ops', 30, 60_000);
const reportLimiter = createRateLimiter('report', 60, 60_000);
// Login is the only public POST — throttle total attempts per IP regardless
// of success/failure (failure lockout on top is inside the auth route).
const loginLimiter = createRateLimiter('auth-login', config.loginMaxRequestsPerMinute, 60_000);

// API — every data route requires a session (admin routes require admin too).
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRouter);
app.use('/api/search', requireAuth, readLimiter, searchRouter);
app.use('/api/leads', requireAuth, readLimiter, leadsRouter);
app.use('/api/dashboard', requireAuth, readLimiter, dashboardRouter);
app.use('/api/export', requireAuth, exportLimiter, exportRouter);
app.use('/api/logs', requireAuth, requireAdmin, readLimiter, logsRouter);
app.use('/api/notifications', requireAuth, readLimiter, notificationsRouter);
app.use('/api/support', requireAuth, readLimiter, supportRouter);
app.use('/api/admin', requireAuth, requireAdmin, opsLimiter, adminRouter);
app.use('/api/report-error', reportLimiter, reportRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: unknown, req: Request, res: Response, _next: () => void) => {
  const status = (err as { status?: number }).status;
  const message = (err as { error?: string }).error;
  const type = (err as { type?: string }).type;

  if (type === 'entity.parse.failed') {
    sendError(res, 400, 'Invalid JSON body');
    return;
  }
  if (status && message) {
    sendError(res, status, message);
    return;
  }

  const msg = err instanceof Error ? err.message : 'Internal server error';
  logEvent('HTTP', 'error', `${req.method} ${req.path}: ${msg}`);
  sendError(res, 500, 'Internal server error');
});

// Periodic maintenance: expired sessions + aged-out app events.
setInterval(() => {
  try {
    cleanupExpiredSessions();
    purgeOldEvents(config.logRetentionDays);
  } catch {
    // non-critical
  }
}, config.sessionCleanupMinutes * 60 * 1000).unref();

app.listen(config.port, config.host, () => {
  logEvent('HTTP', 'info', `Backend listening on ${config.host}:${config.port}`);
  console.log(`Backend listening on http://${config.host}:${config.port}`);
});

// Create the first admin from ADMIN_USERNAME/ADMIN_PASSWORD only when no user
// exists yet (falls back to `npm run create-admin` for interactive setup).
createBootstrapAdminIfNeeded();