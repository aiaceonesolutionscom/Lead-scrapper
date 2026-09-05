import { Router } from 'express';
import { asyncHandler, type AppRequest, type AppResponse } from '../middleware';
import { db, toLead, toSearch } from '../db';

export const dashboardRouter = Router();

const OWNED_LEAD_FILTER =
  'id IN (SELECT sl.lead_id FROM search_leads sl JOIN searches s ON s.id = sl.search_id WHERE s.created_by = ?)';

// GET /api/dashboard
dashboardRouter.get(
  '/',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const isAdmin = req.user?.role === 'admin';
    const userId = req.user?.id ?? '';

    if (isAdmin) {
      const count = (table: string, where = ''): number => {
        const row = db
          .prepare(`SELECT COUNT(*) AS c FROM ${table}${where ? ` WHERE ${where}` : ''}`)
          .get() as { c: number };
        return Number(row.c);
      };
      const recentSearches = db
        .prepare('SELECT * FROM searches ORDER BY created_at DESC LIMIT 5')
        .all() as Record<string, unknown>[];
      const recentLeads = db
        .prepare('SELECT * FROM leads ORDER BY created_at DESC LIMIT 5')
        .all() as Record<string, unknown>[];
      res.json({
        stats: {
          total_searches: count('searches'),
          total_leads: count('leads'),
          verified_leads: count('leads', 'verified = 1'),
          new_leads: count('leads', "status = 'new'"),
          contacted_leads: count('leads', "status = 'contacted'"),
          converted_leads: count('leads', "status = 'converted'"),
        },
        recent_searches: recentSearches.map(toSearch),
        recent_leads: recentLeads.map(toLead),
      });
      return;
    }

    type CountRow = { c: number };
    const scopedCount = (sql: string): number =>
      Number((db.prepare(sql).get(userId) as CountRow).c);

    res.json({
      stats: {
        total_searches: scopedCount('SELECT COUNT(*) AS c FROM searches WHERE created_by = ?'),
        total_leads: scopedCount(
          `SELECT COUNT(*) AS c FROM leads WHERE ${OWNED_LEAD_FILTER}`
        ),
        verified_leads: scopedCount(
          `SELECT COUNT(*) AS c FROM leads WHERE verified = 1 AND ${OWNED_LEAD_FILTER}`
        ),
        new_leads: scopedCount(
          `SELECT COUNT(*) AS c FROM leads WHERE status = 'new' AND ${OWNED_LEAD_FILTER}`
        ),
        contacted_leads: scopedCount(
          `SELECT COUNT(*) AS c FROM leads WHERE status = 'contacted' AND ${OWNED_LEAD_FILTER}`
        ),
        converted_leads: scopedCount(
          `SELECT COUNT(*) AS c FROM leads WHERE status = 'converted' AND ${OWNED_LEAD_FILTER}`
        ),
      },
      recent_searches: (
        db
          .prepare('SELECT * FROM searches WHERE created_by = ? ORDER BY created_at DESC LIMIT 5')
          .all(userId) as Record<string, unknown>[]
      ).map(toSearch),
      recent_leads: (
        db
          .prepare(
            `SELECT * FROM leads WHERE ${OWNED_LEAD_FILTER} ORDER BY created_at DESC LIMIT 5`
          )
          .all(userId) as Record<string, unknown>[]
      ).map(toLead),
    });
  })
);