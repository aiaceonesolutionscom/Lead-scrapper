import { Router } from 'express';
import { randomUUID as uuid } from 'node:crypto';
import {
  asyncHandler,
  requireAdmin,
  sendError,
  type AppRequest,
  type AppResponse,
} from '../middleware';
import { config } from '../config';
import { db, logEvent, nowIso, toLead, toSearch } from '../db';
import { createExtractionStore } from '../store';

export const searchRouter = Router();

const TERMINAL_STATUSES = ['completed', 'partially_completed', 'failed', 'cancelled'];

function extractBody(req: AppRequest): { keyword: string; country: string; city: string | null; searchMode: 'city' | 'country'; requestedCount: number } {
  const { keyword, country, city, searchMode, requestedCount } = (req.body || {}) as {
    keyword?: unknown;
    country?: unknown;
    city?: unknown;
    searchMode?: unknown;
    requestedCount?: unknown;
  };

  if (typeof keyword !== 'string' || !keyword.trim()) {
    throw { status: 400, error: 'keyword is required' };
  }
  if (typeof country !== 'string' || !country.trim()) {
    throw { status: 400, error: 'country is required' };
  }
  if (searchMode !== 'city' && searchMode !== 'country') {
    throw { status: 400, error: 'searchMode must be "city" or "country"' };
  }
  if (typeof requestedCount !== 'number' || !Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 500) {
    throw { status: 400, error: 'requestedCount must be between 1 and 500' };
  }
  if (searchMode === 'city' && (!city || typeof city !== 'string' || !city.trim())) {
    throw { status: 400, error: 'city is required when searchMode is "city"' };
  }

  return {
    keyword: keyword.trim(),
    country: country.trim(),
    city: searchMode === 'city' ? (city as string).trim() : null,
    searchMode,
    requestedCount,
  };
}

// GET /api/search — list searches (paginated)
searchRouter.get(
  '/',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(200, parseInt(String(req.query.limit || '50'), 10) || 50);
    const offset = (page - 1) * limit;
    const isAdmin = req.user?.role === 'admin';
    const ownOnly = isAdmin ? '' : 'WHERE created_by = ?';
    const ownParams = isAdmin ? [] : [req.user?.id ?? ''];

    const rows = db
      .prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM search_leads sl WHERE sl.search_id = s.id) AS linked
         FROM searches s ${ownOnly}
         ORDER BY s.created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...ownParams, limit, offset) as Record<string, unknown>[];
    const countRow = db
      .prepare(`SELECT COUNT(*) AS c FROM searches ${ownOnly}`)
      .get(...ownParams) as { c: number };
    const total = Number(countRow.c);

    res.json({
      searches: rows.map((row) => ({
        ...toSearch(row),
        discovered_count: Number(row.linked ?? row.discovered_count ?? 0),
        enriched_count: Number(row.linked ?? row.enriched_count ?? 0),
      })),
      total,
      page,
      limit,
      totalPages: total ? Math.ceil(total / limit) : 0,
    });
  })
);

// DELETE /api/search — purge all searches (and their links)
searchRouter.delete(
  '/',
  requireAdmin,
  asyncHandler(async (_req: AppRequest, res: AppResponse) => {
    db.prepare('DELETE FROM search_leads').run();
    db.prepare('DELETE FROM searches').run();
    logEvent('SEARCH', 'info', 'All searches deleted by admin');
    res.json({ success: true, message: 'All searches deleted' });
  })
);

// GET /api/search/:id — search detail (+ leads when terminal)
searchRouter.get(
  '/:id',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const id = String(req.params.id || '');
    if (!id) return sendError(res, 400, 'Search ID is required');

    const search = db.prepare('SELECT * FROM searches WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!search) return sendError(res, 404, 'Search not found');

    if (req.user?.role !== 'admin' && String(search.created_by ?? '') !== req.user?.id) {
      return sendError(res, 404, 'Search not found');
    }

    let leads: unknown[] = [];
    const status = String(search.status);
    if (TERMINAL_STATUSES.includes(status)) {
      const rows = db
        .prepare(
          `SELECT l.* FROM search_leads sl
           JOIN leads l ON l.id = sl.lead_id
           WHERE sl.search_id = ?
           ORDER BY sl.discovered_at DESC`
        )
        .all(id) as Record<string, unknown>[];
      leads = rows.map(toLead);
    }

    const linked = db
      .prepare('SELECT COUNT(*) AS c FROM search_leads WHERE search_id = ?')
      .get(id) as { c: number };

    res.json({
      search_id: search.id,
      status: search.status,
      discovered_count: Number(search.discovered_count ?? 0),
      enriched_count: Number(linked.c ?? 0),
      requested_count: search.requested_count,
      keyword: search.keyword,
      country: search.country,
      city: search.city,
      search_mode: search.search_mode,
      error_message: search.error_message,
      created_by: search.created_by ?? null,
      created_at: search.created_at,
      updated_at: search.updated_at,
      leads,
    });
  })
);

// DELETE /api/search/:id
searchRouter.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const id = String(req.params.id || '');
    if (!id) return sendError(res, 400, 'Search ID is required');

    const exists = db.prepare('SELECT id FROM searches WHERE id = ?').get(id);
    if (!exists) return sendError(res, 404, 'Search not found');

    db.prepare('DELETE FROM search_leads WHERE search_id = ?').run(id);
    db.prepare('DELETE FROM searches WHERE id = ?').run(id);
    logEvent('SEARCH', 'info', `Search ${id} deleted by admin`);
    res.json({ success: true, id });
  })
);

// POST /api/search/start — create a search and launch extraction in the background
searchRouter.post(
  '/start',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const { keyword, country, city, searchMode, requestedCount } = extractBody(req);
    const now = nowIso();

    // Limit concurrent extractions to prevent scraper collisions & junk data
    const maxConcurrent = config.maxConcurrentSearches;
    const activeCount = db
      .prepare(`SELECT COUNT(*) AS c FROM searches WHERE status IN ('pending','discovering','enriching')`)
      .get() as { c: number };
    if (activeCount.c >= maxConcurrent) {
      return sendError(res, 409, `Maximum concurrent extractions (${maxConcurrent}) reached. Please wait for existing searches to complete.`);
    }

    const searchId = uuid();

    db.prepare(
      `INSERT INTO searches (id, keyword, country, city, search_mode, requested_count,
         discovered_count, enriched_count, status, error_message, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'pending', NULL, ?, ?, ?)`
    ).run(searchId, keyword, country, city, searchMode, requestedCount, req.user?.id ?? null, now, now);

    logEvent('SEARCH', 'info', `Search ${searchId} started: "${keyword}" in ${city || country} (${searchMode}), target ${requestedCount}`);

    // Fire-and-forget: respond first, then run extraction (same process).
    setImmediate(() => {
      void (async () => {
        try {
          const { runExtraction } = await import('@/lib/extraction');
          await runExtraction(
            { searchId, keyword, country, city, searchMode, requestedCount },
            createExtractionStore()
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown extraction error';
          logEvent('EXTRACTION', 'error', `Extraction failed for ${searchId}: ${msg}`);
          try {
            const store = createExtractionStore();
            await store.updateSearch(searchId, { status: 'failed', error_message: msg });
          } catch {
            // last-resort: nothing more to do
          }
        }
      })();
    });

    res.status(201).json({ searchId, status: 'pending' });
  })
);

// POST /api/search/cancel — mark a running search as cancelled
searchRouter.post(
  '/cancel',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const { searchId } = (req.body || {}) as { searchId?: unknown };
    if (typeof searchId !== 'string' || !searchId) {
      return sendError(res, 400, 'searchId is required');
    }

    const existing = db
      .prepare('SELECT id, status, created_by FROM searches WHERE id = ?')
      .get(searchId) as { id: string; status: string; created_by: string | null } | undefined;
    if (!existing) return sendError(res, 404, 'Search not found');

    if (req.user?.role !== 'admin' && existing.created_by !== req.user?.id) {
      return sendError(res, 404, 'Search not found');
    }

    if (TERMINAL_STATUSES.includes(existing.status)) {
      return sendError(res, 409, `Cannot cancel search with status "${existing.status}"`);
    }

    db.prepare("UPDATE searches SET status = 'cancelled', error_message = 'Cancelled by user', updated_at = ? WHERE id = ?").run(
      nowIso(),
      searchId
    );
    logEvent('SEARCH', 'info', `Search ${searchId} cancelled`);
    res.json({ success: true, searchId });
  })
);