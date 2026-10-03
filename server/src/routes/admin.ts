import { Router } from 'express';
import { existsSync, statSync, statfsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import os from 'node:os';
import {
  asyncHandler,
  requireAdmin,
  sendError,
  type AppRequest,
  type AppResponse,
} from '../middleware';
import { config } from '../config';
import { db, logEvent, nowIso, sql, toSearch } from '../db';
import { createUser, getUserById, hashPassword, toAppUser } from '../auth';
import { passwordValidationMessage } from '../password-policy';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

/** Recursive directory size in bytes; missing dirs and unreadable entries are silently skipped. */
function dirSizeBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    try {
      if (entry.isDirectory()) total += dirSizeBytes(full);
      else total += statSync(full).size;
    } catch {
      // skip files that vanish mid-walk or can't be read
    }
  }
  return total;
}

function countAdmins(): number {
  const row = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND enabled = 1").get() as { c: number };
  return Number(row.c);
}

// GET /api/admin/users
adminRouter.get(
  '/users',
  asyncHandler(async (_req: AppRequest, res: AppResponse) => {
    const rows = db.prepare('SELECT id, username, email, password_changed_at, role, enabled, onboarding_seen, last_seen_at, created_at, updated_at FROM users ORDER BY created_at ASC').all() as Record<string, unknown>[];
    res.json({ users: rows.map(toAppUser) });
  })
);

// POST /api/admin/users â€” create user (email acts as the login identifier)
adminRouter.post(
  '/users',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const { username, email, password, role } = (req.body || {}) as {
      username?: unknown;
      email?: unknown;
      password?: unknown;
      role?: unknown;
    };
    const rawEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const rawUsername = typeof username === 'string' ? username.trim() : '';
    const finalUsername = rawEmail || rawUsername;

    if (!finalUsername) {
      return sendError(res, 400, 'Email is required');
    }
    if (typeof password !== 'string') {
      return sendError(res, 400, 'Password is required');
    }
    const msg = passwordValidationMessage(password);
    if (msg) return sendError(res, 400, msg);
    const finalRole = role === 'admin' ? 'admin' : 'user';

    const exists = db
      .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE OR (email = ? COLLATE NOCASE AND email IS NOT NULL)')
      .get(finalUsername, finalUsername);
    if (exists) {
      return sendError(res, 409, 'Email already exists');
    }

    const hashed = await hashPassword(password);
    const user = createUser(finalUsername, hashed, finalRole, rawEmail || null);
    logEvent('ADMIN', 'info', `Admin "${req.user?.username}" created user "${user.username}" (${finalRole})`);
    res.status(201).json({ user: toAppUser(user) });
  })
);

// PUT /api/admin/users/:id â€” update username/role/enabled (never the password)
adminRouter.put(
  '/users/:id',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const id = String(req.params.id || '');
    const user = getUserById(id);
    if (!user) return sendError(res, 404, 'User not found');

    const body = (req.body || {}) as { username?: unknown; role?: unknown; enabled?: unknown };
    const updates: Record<string, unknown> = {};
    const now = nowIso();

    if (body.username !== undefined) {
      if (typeof body.username !== 'string' || !body.username.trim()) {
        return sendError(res, 400, 'username must be a non-empty string');
      }
      const clash = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(body.username.trim());
      if (clash && String((clash as { id: string }).id) !== id) {
        return sendError(res, 409, 'Username already exists');
      }
      updates.username = body.username.trim();
    }

    if (body.role !== undefined) {
      const nextRole = body.role === 'admin' ? 'admin' : 'user';
      const wasAdmin = user.role === 'admin';
      if (wasAdmin && nextRole !== 'admin' && countAdmins() <= 1) {
        return sendError(res, 409, 'Cannot demote the last remaining admin');
      }
      updates.role = nextRole;
    }

    if (body.enabled !== undefined) {
      const enabled = Boolean(body.enabled);
      if (user.id === req.user!.id && !enabled) {
        return sendError(res, 409, 'You cannot disable your own account');
      }
      if (user.role === 'admin' && !enabled && countAdmins() <= 1) {
        return sendError(res, 409, 'Cannot disable the last remaining admin');
      }
      updates.enabled = enabled ? 1 : 0;
    }

    const keys = Object.keys(updates);
    if (keys.length === 0) {
      return sendError(res, 400, 'Nothing to update');
    }
    keys.push('updated_at');
    db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
      ...sql([...Object.values(updates), now]),
      id
    );
    logEvent('ADMIN', 'info', `Admin "${req.user?.username}" updated user "${user.username}"`);
    res.json({ user: toAppUser(getUserById(id)!) });
  })
);

// POST /api/admin/users/:id/reset-password
adminRouter.post(
  '/users/:id/reset-password',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const id = String(req.params.id || '');
    const user = getUserById(id);
    if (!user) return sendError(res, 404, 'User not found');

    const { password } = (req.body || {}) as { password?: unknown };
    if (typeof password !== 'string') {
      return sendError(res, 400, 'Password is required');
    }
    const msg = passwordValidationMessage(password);
    if (msg) return sendError(res, 400, msg);

    const hashed = await hashPassword(password);
    const changedAt = nowIso();
    db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?').run(
      hashed,
      changedAt,
      changedAt,
      id
    );
    // Revoke all sessions so the reset takes effect everywhere.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    logEvent('ADMIN', 'warn', `Admin "${req.user?.username}" reset password for "${user.username}"`);
    res.json({ success: true });
  })
);

// DELETE /api/admin/users/:id
adminRouter.delete(
  '/users/:id',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const id = String(req.params.id || '');
    const user = getUserById(id);
    if (!user) return sendError(res, 404, 'User not found');

    if (user.id === req.user!.id) {
      return sendError(res, 409, 'You cannot delete your own account');
    }
    if (user.role === 'admin' && countAdmins() <= 1) {
      return sendError(res, 409, 'Cannot delete the last remaining admin');
    }

    // Delete in a transaction so the FK chain is happy regardless of schema:
    // search_leads / lead_notes / lead_sources cascade from searches and leads;
    // sessions, notifications, support_messages and support_threads reference
    // users directly. Wrapping it all in BEGIN/COMMIT keeps it atomic.
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM notifications WHERE user_id = ?').run(id);
      db.prepare('DELETE FROM support_threads WHERE user_id = ?').run(id);
      // searches.created_by -> users has no ON DELETE CASCADE in the original
      // schema, so drop this user's searches explicitly (their search_leads +
      // lead_notes + lead_sources cascade away with them).
      db.prepare('DELETE FROM searches WHERE created_by = ?').run(id);
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    logEvent('ADMIN', 'info', `Admin "${req.user?.username}" deleted user "${user.username}"`);
    res.json({ success: true, id });
  })
);

// GET /api/admin/users/:id/searches â€” one user's extraction history (admin).
adminRouter.get(
  '/users/:id/searches',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const id = String(req.params.id || '');
    const user = getUserById(id);
    if (!user) return sendError(res, 404, 'User not found');
    const rows = db
      .prepare('SELECT * FROM searches WHERE created_by = ? ORDER BY created_at DESC LIMIT 200')
      .all(id) as Record<string, unknown>[];
    res.json({ searches: rows.map(toSearch) });
  })
);

// GET /api/admin/overview â€” per-user extraction stats + system/imported bucket
adminRouter.get(
  '/overview',
  asyncHandler(async (_req: AppRequest, res: AppResponse) => {
    const users = db
      .prepare(
        `SELECT
           u.id, u.username, u.email, u.password_changed_at, u.role, u.enabled, u.created_at, u.updated_at, u.last_seen_at,
           (SELECT COUNT(*) FROM searches s WHERE s.created_by = u.id) AS total_searches,
           (SELECT COUNT(*) FROM search_leads sl JOIN searches s ON s.id = sl.search_id AND s.created_by = u.id) AS leads_extracted,
           (SELECT MAX(s.created_at) FROM searches s WHERE s.created_by = u.id) AS last_search_at
         FROM users u ORDER BY u.created_at ASC`
      )
      .all() as Record<string, unknown>[];

    const system = db
      .prepare(
        `SELECT COUNT(DISTINCT s.id) AS total_searches, COUNT(sl.id) AS leads_extracted, MAX(s.created_at) AS last_search_at
         FROM searches s LEFT JOIN search_leads sl ON sl.search_id = s.id
         WHERE s.created_by IS NULL`
      )
      .get() as { total_searches: number; leads_extracted: number; last_search_at: string | null };

    res.json({
      users: users.map((u) => ({
        id: String(u.id),
        username: String(u.username),
        email: (u.email as string) ?? '',
        role: String(u.role),
        enabled: Boolean(u.enabled),
        password_changed_at: (u.password_changed_at as string) ?? null,
        last_seen_at: (u.last_seen_at as string) ?? null,
        created_at: String(u.created_at),
        updated_at: String(u.updated_at),
        total_searches: Number(u.total_searches),
        leads_extracted: Number(u.leads_extracted),
        last_search_at: (u.last_search_at as string) ?? null,
      })),
      system: {
        label: 'Imported',
        total_searches: Number(system.total_searches),
        leads_extracted: Number(system.leads_extracted),
        last_search_at: (system.last_search_at as string) ?? null,
      },
      totals: {
        searches: Number((db.prepare('SELECT COUNT(*) AS c FROM searches').get() as { c: number }).c),
        leads: Number((db.prepare('SELECT COUNT(*) AS c FROM leads').get() as { c: number }).c),
      },
    });
  })
);

// GET /api/admin/events?level=&tail= â€” app events (errors, logs)
adminRouter.get(
  '/events',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const level = typeof req.query.level === 'string' ? req.query.level : undefined;
    const tail = Math.max(1, Math.min(500, parseInt(String(req.query.tail || '100'), 10) || 100));

    let rows: Record<string, unknown>[];
    if (level) {
      rows = db
        .prepare('SELECT * FROM app_events WHERE level = ? ORDER BY created_at DESC LIMIT ?')
        .all(level, tail) as Record<string, unknown>[];
    } else {
      rows = db
        .prepare('SELECT * FROM app_events ORDER BY created_at DESC LIMIT ?')
        .all(tail) as Record<string, unknown>[];
    }

    res.json({ events: rows });
  })
);

// DELETE /api/admin/events â€” purge events older than retention (or all)
adminRouter.delete(
  '/events',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const { scope } = (req.query || {}) as { scope?: string };
    if (scope === 'all') {
      db.prepare('DELETE FROM app_events').run();
    } else {
      const cutoff = new Date(Date.now() - config.logRetentionDays * 24 * 60 * 60 * 1000).toISOString();
      db.prepare('DELETE FROM app_events WHERE created_at < ?').run(cutoff);
    }
    res.json({ success: true });
  })
);

// GET /api/admin/health
adminRouter.get(
  '/health',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const searchRow = db.prepare("SELECT COUNT(*) AS c FROM searches WHERE status IN ('pending','discovering','enriching')").get() as { c: number };
    const dbFile = config.dbPath;
    const dbSizeBytes = existsSync(dbFile) ? statSync(dbFile).size : 0;

    const envBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH || '';
    const browsersPath = envBrowsersPath ? resolve(envBrowsersPath) : '';

    const logsDir = resolve(config.repoRoot, 'logs');
    const npmCacheDir = resolve(config.repoRoot, '.runtime', 'npm-cache');
    const backupsDir = resolve(config.repoRoot, 'backups');
    // Real backup location used by scripts/backup-db.ts
    const backupRoot = process.env.BACKUP_ROOT ? resolve(process.env.BACKUP_ROOT) : resolve(config.repoRoot, 'backups');

    let diskFree: { free_gb: number; total_gb: number } | null = null;
    try {
      const s = statfsSync(config.repoRoot);
      diskFree = {
        free_gb: Math.round((s.bavail * s.bsize) / 1024 / 1024 / 1024 * 10) / 10,
        total_gb: Math.round((s.blocks * s.bsize) / 1024 / 1024 / 1024 * 10) / 10,
      };
    } catch {
      // statfs unsupported on this platform â€” leave null
    }

    res.json({
      status: 'ok',
      uptime_seconds: Math.round(process.uptime()),
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      os: { platform: os.platform(), release: os.release() },
      memory_free_mb: Math.round(os.freemem() / 1024 / 1024),
      memory_total_mb: Math.round(os.totalmem() / 1024 / 1024),
      db: {
        path: dbFile,
        size_bytes: dbSizeBytes,
        searches: Number((db.prepare('SELECT COUNT(*) AS c FROM searches').get() as { c: number }).c),
        leads: Number((db.prepare('SELECT COUNT(*) AS c FROM leads').get() as { c: number }).c),
        users: Number((db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c),
      },
      running_searches: Number(searchRow.c),
      chromium: {
        configured: !!envBrowsersPath,
        browsers_path: browsersPath,
        exists: !!browsersPath && existsSync(browsersPath),
      },
      tunnel: {
        https_terminated: Boolean(req.headers['x-forwarded-proto']),
      },
      disk: {
        drive_free_gb: diskFree?.free_gb ?? null,
        drive_total_gb: diskFree?.total_gb ?? null,
        logs_mb: Math.round(dirSizeBytes(logsDir) / 1024 / 1024 * 10) / 10,
        npm_cache_mb: Math.round(dirSizeBytes(npmCacheDir) / 1024 / 1024 * 10) / 10,
        backups_mb: Math.round(dirSizeBytes(backupsDir) / 1024 / 1024 * 10) / 10,
      },
      backup: (() => {
        try {
          // Read the real backup location (scripts/backup-db.ts writes
          // D:\CRM Backups\leadlead\backup-YYYY-MM-DD-HH-mm\crm.db).
          if (!existsSync(backupRoot)) return { status: 'no_backups', last_backup: null, backup_count: 0, total_size_mb: 0 };
          const folders = readdirSync(backupRoot).filter((f) => /^backup-\d{4}-\d{2}-\d{2}/.test(f));
          if (folders.length === 0) return { status: 'no_backups', last_backup: null, backup_count: 0, total_size_mb: 0 };
          // Each backup is a folder containing crm.db; pick the newest by folder mtime
          let newest: { name: string; mtime: Date; full: string } | null = null;
          let totalBytes = 0;
          for (const folder of folders) {
            const fullFolder = join(backupRoot, folder);
            const dbFile = join(fullFolder, 'crm.db');
            if (existsSync(dbFile)) totalBytes += statSync(dbFile).size;
            const st = statSync(fullFolder);
            if (!newest || st.mtime > newest.mtime) {
              newest = { name: folder, mtime: st.mtime, full: fullFolder };
            }
          }
          return {
            status: 'ok',
            last_backup: newest?.mtime.toISOString() || null,
            last_backup_name: newest?.name || null,
            backup_count: folders.length,
            total_size_mb: Math.round(totalBytes / 1024 / 1024 * 10) / 10,
            location: backupRoot,
          };
        } catch {
          return { status: 'error', last_backup: null, backup_count: 0, total_size_mb: 0, location: backupRoot };
        }
      })(),
    });
  })
);

// POST /api/admin/backup â€” trigger a manual database backup (VACUUM INTO a
// consistent snapshot in the same location the daily script uses).
adminRouter.post(
  '/backup',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const dbFile = config.dbPath;
    if (!existsSync(dbFile)) {
      return sendError(res, 404, 'Database file not found');
    }
    const backupRoot = process.env.BACKUP_ROOT ? resolve(process.env.BACKUP_ROOT) : resolve(config.repoRoot, 'backups');
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
      const folder = join(backupRoot, `backup-${timestamp}`);
      const { mkdirSync } = await import('node:fs');
      mkdirSync(folder, { recursive: true });
      const dest = join(folder, 'crm.db');

      // Use VACUUM INTO like scripts/backup-db.ts so the snapshot is always
      // consistent (safe while the backend is live / in WAL mode).
      const { DatabaseSync } = await import('node:sqlite');
      const source = new DatabaseSync(dbFile, { readOnly: true });
      try {
        source.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}';`);
      } finally {
        source.close();
      }

      const size = statSync(dest).size;
      logEvent('ADMIN', 'info', `Manual backup created: ${folder} (${Math.round(size / 1024)}KB) by "${req.user?.username}"`);
      res.json({ success: true, name: folder, size_bytes: size });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Backup failed';
      logEvent('ADMIN', 'error', `Manual backup failed: ${msg}`);
      sendError(res, 500, msg);
    }
  })
);