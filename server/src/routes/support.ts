import { Router } from 'express';
import { asyncHandler, sendError, type AppRequest, type AppResponse } from '../middleware';
import { db, logEvent, nowIso, randomUUID, toThread, toMessage } from '../db';
import { createNotification } from '../notifications';
import type { SupportThread } from '@/types';

export const supportRouter = Router();

const THREAD_FIELDS = `
  t.id, t.user_id, t.subject, t.status, t.created_at, t.updated_at,
  (SELECT COUNT(*) FROM support_messages m WHERE m.thread_id = t.id) AS message_count,
  (SELECT body FROM support_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
  (SELECT created_at FROM support_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at
`;

function getThread(id: string): SupportThread | undefined {
  const row = db
    .prepare(`SELECT ${THREAD_FIELDS} FROM support_threads t WHERE t.id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? toThread(row) : undefined;
}

// GET /api/support — the current user's threads, newest activity first.
supportRouter.get(
  '/',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const rows = db
      .prepare(
        `SELECT ${THREAD_FIELDS} FROM support_threads t WHERE t.user_id = ? ORDER BY t.updated_at DESC LIMIT 50`
      )
      .all(req.user!.id) as Record<string, unknown>[];
    res.json({ threads: rows.map(toThread) });
  })
);

// GET /api/support/admin/list — every thread (admin only).
supportRouter.get(
  '/admin/list',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    if (req.user?.role !== 'admin') return sendError(res, 403, 'Admin only');
    const rows = db
      .prepare(
        `SELECT ${THREAD_FIELDS}, u.username AS user_username
         FROM support_threads t JOIN users u ON u.id = t.user_id
         ORDER BY t.updated_at DESC LIMIT 100`
      )
      .all() as Record<string, unknown>[];
    res.json({ threads: rows.map(toThread) });
  })
);

// POST /api/support — open a new thread with the first message.
supportRouter.post(
  '/',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const { subject, message } = (req.body || {}) as { subject?: unknown; message?: unknown };
    const subj = typeof subject === 'string' ? subject.trim() : '';
    const msg = typeof message === 'string' ? message.trim() : '';
    if (!subj || !msg) return sendError(res, 400, 'Subject and message are required');

    const threadId = randomUUID();
    const now = nowIso();
    db.prepare(
      'INSERT INTO support_threads (id, user_id, subject, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(threadId, req.user!.id, subj.slice(0, 200), 'open', now, now);
    db.prepare('INSERT INTO support_messages (id, thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(
      randomUUID(),
      threadId,
      req.user!.id,
      msg.slice(0, 4000),
      now
    );
    logEvent('SUPPORT', 'info', `Support thread ${threadId} created by ${req.user!.username}: "${subj}"`);
    res.status(201).json({ thread: getThread(threadId) });
  })
);

// GET /api/support/:id — messages for a thread (owner or admin).
supportRouter.get(
  '/:id',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const thread = getThread(req.params.id);
    if (!thread) return sendError(res, 404, 'Thread not found');
    if (req.user?.role !== 'admin' && thread.user_id !== req.user!.id) {
      return sendError(res, 404, 'Thread not found');
    }
    const rows = db
      .prepare(
        `SELECT m.id, m.thread_id, m.user_id, m.body, m.created_at, u.role, u.username
         FROM support_messages m JOIN users u ON u.id = m.user_id
         WHERE m.thread_id = ? ORDER BY m.created_at ASC`
      )
      .all(thread.id) as Record<string, unknown>[];
    res.json({ thread, messages: rows.map(toMessage) });
  })
);

// POST /api/support/:id/messages — append a message (owner or admin).
supportRouter.post(
  '/:id/messages',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const thread = getThread(req.params.id);
    if (!thread) return sendError(res, 404, 'Thread not found');
    if (req.user?.role !== 'admin' && thread.user_id !== req.user!.id) {
      return sendError(res, 404, 'Thread not found');
    }
    if (thread.status === 'closed') return sendError(res, 409, 'Thread is closed');

    const { body } = (req.body || {}) as { body?: unknown };
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text) return sendError(res, 400, 'Message cannot be empty');

    const now = nowIso();
    db.prepare('INSERT INTO support_messages (id, thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(
      randomUUID(),
      thread.id,
      req.user!.id,
      text.slice(0, 4000),
      now
    );
    db.prepare('UPDATE support_threads SET updated_at = ? WHERE id = ?').run(now, thread.id);

    // Let the thread owner know an admin replied.
    if (req.user?.role === 'admin' && thread.user_id !== req.user.id) {
      createNotification(
        thread.user_id,
        'info',
        `Reply on "${thread.subject}"`,
        text.slice(0, 160),
        '/support'
      );
    }
    res.json({ success: true });
  })
);

// POST /api/support/:id/status — close/reopen a thread (owner or admin).
supportRouter.post(
  '/:id/status',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const thread = getThread(req.params.id);
    if (!thread) return sendError(res, 404, 'Thread not found');
    if (req.user?.role !== 'admin' && thread.user_id !== req.user!.id) {
      return sendError(res, 404, 'Thread not found');
    }
    const { status } = (req.body || {}) as { status?: unknown };
    if (status !== 'open' && status !== 'closed') return sendError(res, 400, 'Invalid status');
    db.prepare('UPDATE support_threads SET status = ?, updated_at = ? WHERE id = ?').run(
      status,
      nowIso(),
      thread.id
    );
    res.json({ success: true });
  })
);