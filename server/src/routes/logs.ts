import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Router } from 'express';
import { asyncHandler, sendError, type AppRequest, type AppResponse } from '../middleware';
import { config } from '../config';

export const logsRouter = Router();

// GET /api/logs?search_id=&tail=
logsRouter.get(
  '/',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const searchId = typeof req.query.search_id === 'string' ? req.query.search_id : '';
    const tail = Math.max(1, Math.min(1000, parseInt(String(req.query.tail || '50'), 10) || 50));

    const logFile = join(config.repoRoot, 'logs', 'extraction.log');
    if (!existsSync(logFile)) {
      return res.json({ logs: [], message: 'No logs yet' });
    }

    const content = readFileSync(logFile, 'utf-8');
    const allLines = content.split('\n').filter(Boolean);

    let lines = allLines;
    if (searchId) {
      const shortId = searchId.slice(0, 8);
      lines = allLines.filter((line) => line.includes(`[${shortId}]`));
    }

    res.json({ logs: lines.slice(-tail), total: lines.length });
  })
);

// Fallback for unknown API paths so the JSON error contract stays consistent.
export function notFoundHandler(_req: AppRequest, res: AppResponse): void {
  sendError(res, 404, 'Not found');
}