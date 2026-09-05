import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url)); // server/src
export const serverRoot = resolve(here, '..'); // server/
export const repoRoot = resolve(serverRoot, '..'); // repository root (D:\...\lead-extractor-crm)

// Load the repository's env file so existing variables (e.g.
// PLAYWRIGHT_BROWSERS_PATH) keep working — env is loaded from the repo root
// regardless of where the process was started from.
const envFile = resolve(repoRoot, '.env.local');
if (existsSync(envFile)) loadEnv({ path: envFile });
else loadEnv();

export const config = {
  port: Number(process.env.PORT || 5000),
  // Bind to loopback only: the Cloudflare tunnel runs on this machine and is
  // the ONLY way in. Nothing else on the LAN can reach the API directly.
  host: process.env.HOST || '127.0.0.1',
  dbPath: process.env.DB_PATH || resolve(serverRoot, 'data', 'crm.db'),
  dataDir: resolve(serverRoot, 'data'),
  repoRoot,
  serverRoot,
  // The Vercel frontend origin(s) allowed to call the API with cookies.
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  sessionCookieName: process.env.SESSION_COOKIE_NAME || 'sid',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 24),
  sessionCleanupMinutes: Number(process.env.SESSION_CLEANUP_MINUTES || 60),
  // Bootstrap-admin fallback — only used when no users exist yet.
  adminUsername: process.env.ADMIN_USERNAME || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  logRetentionDays: Number(process.env.LOG_RETENTION_DAYS || 30),
  // Brute-force protection on /api/auth/login.
  loginMaxFailuresPerIp: Number(process.env.LOGIN_MAX_FAILURES_PER_IP || 10),
  loginMaxFailuresPerUser: Number(process.env.LOGIN_MAX_FAILURES_PER_USER || 6),
  loginLockWindowMinutes: Number(process.env.LOGIN_LOCK_WINDOW_MINUTES || 15),
  // Maximum number of extractions running at the same time.
  // Set to 1 for development to prevent concurrent scraper collisions;
  // increase for production if desired.
  maxConcurrentSearches: Number(process.env.MAX_CONCURRENT_SEARCHES || 1),
};