import { Router } from 'express';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { asyncHandler, sendError, type AppRequest, type AppResponse } from '../middleware';
import { db, toLead } from '../db';
import { getMapUrl } from '@/lib/utils';
import type { ExportData, Lead } from '@/types';

export const exportRouter = Router();

function mapLeadToExport(lead: Lead): ExportData {
  return {
    business_name: lead.business_name,
    phone: lead.phone || '',
    email: lead.email || '',
    website: lead.website || '',
    instagram: lead.instagram || '',
    facebook: lead.facebook || '',
    linkedin: lead.linkedin || '',
    address: lead.address || '',
    city: lead.city || '',
    country: lead.country || '',
    location_url: getMapUrl(lead) || '',
    category: lead.category || '',
    confidence: lead.confidence || '',
    created_date: new Date(lead.created_at).toLocaleDateString(),
  };
}

const HYPERLINK = (url: string, label: string) =>
  `=HYPERLINK("${url.replace(/"/g, '""')}","${label.replace(/"/g, '""')}")`;

const MAP_LABEL = 'View on Map';

function toClickableCsvRow(row: ExportData): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  if (row.phone) out.phone = HYPERLINK(`tel:${row.phone}`, row.phone);
  if (row.email) out.email = HYPERLINK(`mailto:${row.email}`, row.email);
  if (row.website) out.website = HYPERLINK(row.website, row.website);
  if (row.instagram) out.instagram = HYPERLINK(row.instagram, row.instagram);
  if (row.facebook) out.facebook = HYPERLINK(row.facebook, row.facebook);
  if (row.linkedin) out.linkedin = HYPERLINK(row.linkedin, row.linkedin);
  if (row.location_url) {
    out.address = HYPERLINK(row.location_url, MAP_LABEL);
    out.city = HYPERLINK(row.location_url, MAP_LABEL);
    out.location_url = HYPERLINK(row.location_url, row.location_url);
  }
  return out;
}

function collectLeads(req: AppRequest): Lead[] {
  const body = req.body || {};
  const uid = req.user?.id ?? '';
  const isAdmin = req.user?.role === 'admin';
  const leadIds: string[] | undefined = Array.isArray(body.leadIds) ? body.leadIds.filter((x: unknown) => typeof x === 'string') : undefined;
  const searchId: string | undefined = typeof body.searchId === 'string' ? body.searchId : undefined;

  if (leadIds && leadIds.length > 0) {
    const placeholders = leadIds.map(() => '?').join(',');
    const filter = isAdmin
      ? ''
      : ' AND id IN (SELECT sl.lead_id FROM search_leads sl JOIN searches s ON s.id = sl.search_id WHERE s.created_by = ?)';
    const rows = db
      .prepare(`SELECT * FROM leads WHERE id IN (${placeholders})${filter}`)
      .all(...leadIds, ...(isAdmin ? [] : [uid])) as Record<string, unknown>[];
    return rows.map(toLead);
  }

  if (searchId) {
    const filter = isAdmin ? '' : ' AND s.created_by = ?';
    const rows = db
      .prepare(
        `SELECT l.* FROM search_leads sl
         JOIN leads l ON l.id = sl.lead_id
         JOIN searches s ON s.id = sl.search_id
         WHERE sl.search_id = ?${filter}
         ORDER BY sl.discovered_at ASC`
      )
      .all(searchId, ...(isAdmin ? [] : [uid])) as Record<string, unknown>[];
    return rows.map(toLead);
  }

  return [];
}

// POST /api/export
exportRouter.post(
  '/',
  asyncHandler(async (req: AppRequest, res: AppResponse) => {
    const body = (req.body || {}) as { format?: unknown; leadIds?: unknown; searchId?: unknown };
    const { format } = body;

    if (format !== 'csv' && format !== 'xlsx') {
      return sendError(res, 400, 'format must be "csv" or "xlsx"');
    }
    if (!body.leadIds && !body.searchId) {
      return sendError(res, 400, 'Either leadIds or searchId must be provided');
    }

    const leads = collectLeads(req);
    if (leads.length === 0) {
      return sendError(res, 404, 'No leads found to export');
    }

    const exportData = leads.map(mapLeadToExport);

    if (format === 'csv') {
      const csv = Papa.unparse(exportData.map(toClickableCsvRow), {
        quotes: true,
        newline: '\r\n',
        header: true,
      });
      const BOM = '\uFEFF';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="leads-export-${Date.now()}.csv"`);
      return res.send(BOM + csv);
    }

    // XLSX with real, clickable hyperlinks
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const link = (addr: string, target: string, tooltip: string) => {
      const cell = worksheet[addr];
      if (!cell) return;
      cell.l = { Target: target, Tooltip: tooltip };
      cell.s = { font: { color: { rgb: '0563C1' }, underline: true } };
    };
    exportData.forEach((row, i) => {
      const r = i + 2;
      if (row.phone) link(`B${r}`, `tel:${row.phone}`, `Call ${row.phone}`);
      if (row.email) link(`C${r}`, `mailto:${row.email}`, `Email ${row.email}`);
      if (row.website) link(`D${r}`, row.website, row.website);
      if (row.instagram) link(`E${r}`, row.instagram, row.instagram);
      if (row.facebook) link(`F${r}`, row.facebook, row.facebook);
      if (row.linkedin) link(`G${r}`, row.linkedin, row.linkedin);
      if (row.location_url) {
        link(`H${r}`, row.location_url, 'Open location in Google Maps');
        link(`I${r}`, row.location_url, 'Open location in Google Maps');
        link(`K${r}`, row.location_url, 'Open location in Google Maps');
      }
    });

    const colWidths = Object.keys(exportData[0] || {}).map((key) => ({
      wch: Math.max(
        key.length,
        ...exportData.map((row) => String((row as unknown as Record<string, unknown>)[key] || '').length)
      ),
    }));
    worksheet['!cols'] = colWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="leads-export-${Date.now()}.xlsx"`);
    res.send(Buffer.from(buffer));
  })
);