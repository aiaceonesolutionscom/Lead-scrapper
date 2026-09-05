import { Router } from 'express';
import { randomUUID as uuid } from 'node:crypto';
import {
  asyncHandler,
  requireAdmin,
  sendError,
  type AppRequest,
  type AppResponse,
} from '../middleware';
import { db, logEvent, nowIso, sql, toLead, toLeadNote, toLeadSource } from '../db';

export const leadsRouter = Router();

const ALLOWED_SORT_COLUMNS = [
  'business_name',
  'city',
  'country',
  'category',
  'status',
  'created_at',
  'updated_at',
  'phone',
  'email',
];

const ALLOWED_UPDATE_FIELDS = [
  'business_name',
  'contact_person',
  'phone',
  'phone_valid',
  'phone_country',
  'email',
  'website',
  'instagram',
  'facebook',
  'linkedin',
  'address',
  'city',
  'country',
  'country_code',
  'category',
  'status',
  'notes',
  'confidence',
  'verified',
];

// GET /api/leads — filters + pagination (+ count_only)
leadsRouter.get(
  '/',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const q = req.query;
    const status = typeof q.status === 'string' ? q.status : undefined;
    const searchQuery = typeof q.search === 'string' ? q.search : undefined;
    const city = typeof q.city === 'string' ? q.city : undefined;
    const country = typeof q.country === 'string' ? q.country : undefined;
    const category = typeof q.category === 'string' ? q.category : undefined;
    const searchId = typeof q.search_id === 'string' ? q.search_id : undefined;
    const page = Math.max(1, parseInt(String(q.page || '1'), 10) || 1);
    const limit = Math.min(500, parseInt(String(q.limit || '50'), 10) || 50);
    const sortBy = ALLOWED_SORT_COLUMNS.includes(String(q.sortBy))
      ? String(q.sortBy)
      : 'created_at';
    const sortOrder = q.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const countOnly = q.count_only === 'true';
    const offset = (page - 1) * limit;

    const where: string[] = [];
    const params: unknown[] = [];
    const isAdmin = req.user?.role === 'admin';

    if (searchId) {
      const row = db.prepare('SELECT COUNT(*) AS c FROM search_leads WHERE search_id = ?').get(searchId) as { c: number };
      if (Number(row.c) === 0) {
        return res.json({ leads: [], total: 0, page, limit, totalPages: 0 });
      }
      where.push('id IN (SELECT lead_id FROM search_leads WHERE search_id = ?)');
      params.push(searchId);
    }
    if (!isAdmin) {
      where.push(
        'id IN (SELECT sl.lead_id FROM search_leads sl JOIN searches s ON s.id = sl.search_id WHERE s.created_by = ?)'
      );
      params.push(req.user?.id ?? '');
    }
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    if (searchQuery) {
      where.push(
        `(business_name LIKE ? OR contact_person LIKE ? OR phone LIKE ? OR email LIKE ?)`
      );
      const like = `%${searchQuery}%`;
      params.push(like, like, like, like);
    }
    if (city) {
      where.push('city LIKE ? COLLATE NOCASE');
      params.push(`%${city}%`);
    }
    if (country) {
      where.push('country LIKE ? COLLATE NOCASE');
      params.push(`%${country}%`);
    }
    if (category) {
      where.push('category LIKE ? COLLATE NOCASE');
      params.push(`%${category}%`);
    }

    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    if (countOnly) {
      const row = db
        .prepare(`SELECT COUNT(*) AS c FROM leads${whereSql}`)
        .get(...sql(params)) as { c: number };
      return res.json({ total: Number(row.c) });
    }

    const countRow = db
      .prepare(`SELECT COUNT(*) AS c FROM leads${whereSql}`)
      .get(...sql(params)) as { c: number };
    const total = Number(countRow.c);

    const rows = db
      .prepare(`SELECT * FROM leads${whereSql} ORDER BY ${sortBy} ${sortOrder.trim() === 'ASC' ? 'ASC' : 'DESC'}, id DESC LIMIT ? OFFSET ?`)
      .all(...sql(params), limit, offset) as Record<string, unknown>[];

    res.json({
      leads: rows.map(toLead),
      total,
      page,
      limit,
      totalPages: total ? Math.ceil(total / limit) : 0,
    });
  })
);

// DELETE /api/leads — purge everything
leadsRouter.delete(
  '/',
  requireAdmin,
  asyncHandler(async (_req: AppRequest, res: AppResponse) => {
    db.prepare('DELETE FROM lead_notes').run();
    db.prepare('DELETE FROM lead_sources').run();
    db.prepare('DELETE FROM search_leads').run();
    db.prepare('DELETE FROM leads').run();
    logEvent('LEADS', 'info', 'All leads deleted by admin');
    res.json({ success: true, message: 'All leads deleted' });
  })
);

function ownedByUser(userId: string, leadId: string): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM search_leads sl
       JOIN searches s ON s.id = sl.search_id
       WHERE sl.lead_id = ? AND s.created_by = ?`
    )
    .get(leadId, userId) as { c: number };
  return Number(row.c) > 0;
}

// GET /api/leads/:id — lead + sources + notes
leadsRouter.get(
  '/:id',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const id = String(req.params.id || '');
    if (!id) return sendError(res, 400, 'Lead ID is required');

    if (req.user?.role !== 'admin' && !ownedByUser(req.user?.id ?? '', id)) {
      return sendError(res, 404, 'Lead not found');
    }

    const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return sendError(res, 404, 'Lead not found');

    const sources = db
      .prepare('SELECT * FROM lead_sources WHERE lead_id = ? ORDER BY created_at DESC')
      .all(id) as Record<string, unknown>[];
    const notes = db
      .prepare('SELECT * FROM lead_notes WHERE lead_id = ? ORDER BY created_at DESC')
      .all(id) as Record<string, unknown>[];

    res.json({ ...toLead(row), sources: sources.map(toLeadSource), notes: notes.map(toLeadNote) });
  })
);

// PUT /api/leads/:id
leadsRouter.put(
  '/:id',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const id = String(req.params.id || '');
    if (!id) return sendError(res, 400, 'Lead ID is required');

    if (req.user?.role !== 'admin' && !ownedByUser(req.user?.id ?? '', id)) {
      return sendError(res, 404, 'Lead not found');
    }

    const exists = db.prepare('SELECT id FROM leads WHERE id = ?').get(id);
    if (!exists) return sendError(res, 404, 'Lead not found');

    const body = (req.body || {}) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    for (const field of ALLOWED_UPDATE_FIELDS) {
      if (field in body) updates[field] = body[field];
    }
    if (typeof updates.phone_valid === 'boolean') updates.phone_valid = updates.phone_valid ? 1 : 0;
    if (typeof updates.verified === 'boolean') updates.verified = updates.verified ? 1 : 0;

    const keys = Object.keys(updates);
    if (keys.length === 0) {
      return sendError(res, 400, 'No valid fields to update');
    }

    keys.push('updated_at');
    const values = [...Object.values(updates)];
    values.push(nowIso(), id);
    db.prepare(`UPDATE leads SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...sql(values));

    const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as Record<string, unknown>;
    res.json(toLead(updated));
  })
);

// DELETE /api/leads/:id — admin, or the user who owns the lead (same rule as GET/PUT)
leadsRouter.delete(
  '/:id',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const id = String(req.params.id || '');
    if (!id) return sendError(res, 400, 'Lead ID is required');

    if (req.user?.role !== 'admin' && !ownedByUser(req.user?.id ?? '', id)) {
      return sendError(res, 404, 'Lead not found');
    }

    const exists = db.prepare('SELECT id FROM leads WHERE id = ?').get(id);
    if (!exists) return sendError(res, 404, 'Lead not found');

    db.prepare('DELETE FROM leads WHERE id = ?').run(id);
    logEvent('LEADS', 'info', `Lead ${id} deleted by "${req.user?.username}"`);
    res.json({ success: true, id });
  })
);

// GET/POST /api/leads/:id/notes
leadsRouter.get(
  '/:id/notes',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const id = String(req.params.id || '');
    if (!id) return sendError(res, 400, 'Lead ID is required');

    if (req.user?.role !== 'admin' && !ownedByUser(req.user?.id ?? '', id)) {
      return sendError(res, 404, 'Lead not found');
    }

    const exists = db.prepare('SELECT id FROM leads WHERE id = ?').get(id);
    if (!exists) return sendError(res, 404, 'Lead not found');

    const notes = db
      .prepare('SELECT * FROM lead_notes WHERE lead_id = ? ORDER BY created_at DESC')
      .all(id) as Record<string, unknown>[];
    res.json({ notes: notes.map(toLeadNote) });
  })
);

leadsRouter.post(
  '/:id/notes',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const id = String(req.params.id || '');
    if (!id) return sendError(res, 400, 'Lead ID is required');

    if (req.user?.role !== 'admin' && !ownedByUser(req.user?.id ?? '', id)) {
      return sendError(res, 404, 'Lead not found');
    }

    const { note } = (req.body || {}) as { note?: unknown };
    if (typeof note !== 'string' || note.trim().length === 0) {
      return sendError(res, 400, 'note is required and must be a non-empty string');
    }

    const exists = db.prepare('SELECT id FROM leads WHERE id = ?').get(id);
    if (!exists) return sendError(res, 404, 'Lead not found');

    const noteId = uuid();
    const created = nowIso();
    db.prepare(
      'INSERT INTO lead_notes (id, lead_id, note, created_at) VALUES (?, ?, ?, ?)'
    ).run(noteId, id, note.trim(), created);

    logEvent('LEADS', 'info', `Note added to lead ${id}`);
    res.status(201).json({ id: noteId, lead_id: id, note: note.trim(), created_at: created });
  })
);