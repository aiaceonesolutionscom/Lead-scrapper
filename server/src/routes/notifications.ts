import { Router } from 'express';
import { asyncHandler, requireAuth, type AppRequest, type AppResponse } from '../middleware';
import { db, sql } from '../db';
import { toNotification } from '../notifications';

export const notificationsRouter = Router();

// Latest 50 notifications for the current user + unread count.
notificationsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const userId = req.user!.id;
    const rows = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(userId) as Record<string, unknown>[];
    const unreadRow = db
      .prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0')
      .get(userId) as { c: number };
    res.json({ notifications: rows.map(toNotification), unread: Number(unreadRow.c) });
  })
);

// Mark one or more (or all) notifications as read. Body: { all: true } or { ids: string[] }.
notificationsRouter.post(
  '/read',
  requireAuth,
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const userId = req.user!.id;
    const body = (req.body || {}) as { all?: unknown; ids?: unknown };
    if (body.all === true) {
      db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(userId);
    } else if (Array.isArray(body.ids) && body.ids.length > 0) {
      const ids = body.ids.filter((x): x is string => typeof x === 'string');
      if (ids.length) {
        const placeholders = ids.map(() => '?').join(', ');
        db.prepare(
          `UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${placeholders})`
        ).run(...sql([userId, ...ids]));
      }
    }
    res.json({ success: true });
  })
);