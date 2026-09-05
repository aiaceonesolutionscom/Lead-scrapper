import { Router } from 'express';
import { asyncHandler, requireAuth, sendError, type AppRequest, type AppResponse } from '../middleware';
import { db, logEvent } from '../db';

// Reports of browser-side errors so the admin can see them in the Sentry tab.
// Auth required (the server silently ignores unauthenticated frontends), and
// inputs are deduped + capped so a noisy client can't flood the event log.
export const reportRouter = Router();
reportRouter.use(requireAuth);

reportRouter.post(
  '/',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const { message, stack, url } = (req.body || {}) as { message?: unknown; stack?: unknown; url?: unknown };

    if (typeof message !== 'string' || !message.trim()) {
      return sendError(res, 400, 'message is required');
    }

    const msgText = message.trim().slice(0, 500);
    const stackText = typeof stack === 'string' && stack.trim() ? stack.trim().slice(0, 2000) : '';
    const urlText = typeof url === 'string' && url.trim() ? url.trim().slice(0, 300) : '';
    const cutoff = new Date(Date.now() - 60_000).toISOString();

    const dup = db
      .prepare(
        "SELECT id FROM app_events WHERE component = 'CLIENT' AND level = 'error' AND message = ? AND created_at > ? LIMIT 1"
      )
      .get(msgText, cutoff);
    if (dup) {
      return res.json({ ok: true, deduped: true });
    }

    logEvent(
      'CLIENT',
      'error',
      `${msgText}${urlText ? ` (${urlText})` : ''}${stackText ? `\n${stackText}` : ''}`
    );
    res.json({ ok: true });
  })
);

// GET /api/report-error/stats — recent client error volume (24h)
reportRouter.get(
  '/stats',
  asyncHandler(async (_req: AppRequest, res: AppResponse) => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const count = db
      .prepare("SELECT COUNT(*) AS c FROM app_events WHERE component = 'CLIENT' AND created_at > ?")
      .get(cutoff) as { c: number };
    res.json({ errors_24h: Number(count.c) });
  })
);