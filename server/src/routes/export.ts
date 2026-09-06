import { Router } from 'express';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { asyncHandler, sendError, type AppRequest, type AppResponse } from '../middleware';
import { db, toLead } from '../db';
import { getMapUrl } from '@/lib/utils';
import type { ExportData, Lead } from '@/types';

export const exportRouter = Router();

function statusLabel(s: string | undefined): string {
  switch (String(s)) {
    case 'contacted': return 'Contacted';
    case 'interested': return 'Interested';
    case 'follow_up': return 'Follow-Up';
    case 'converted': return 'Converted';
    case 'archived': return 'Archived';
    default: return 'New';
  }
}

// Every field belongs in its own column. Missing values become "N/A" instead
// of empty cells, so nothing looks missing and each row is easy to scan.
function mapLeadToExport(lead: Lead): ExportData {
  const fmt = (v: string | null | undefined) => (v && v.trim() ? String(v).trim() : 'N/A');

  return {
    business_name: fmt(lead.business_name),
    contact_person: fmt(lead.contact_person),
    phone: fmt(lead.phone),
    phone_country: fmt(lead.phone_country),
    email: fmt(lead.email),
    website: fmt(lead.website),
    instagram: fmt(lead.instagram),
    facebook: fmt(lead.facebook),
    linkedin: fmt(lead.linkedin),
    address: fmt(lead.address),
    city: fmt(lead.city),
    country: fmt(lead.country),
    location_url: getMapUrl(lead) || 'N/A',
    category: fmt(lead.category),
    confidence: fmt(lead.confidence).replace(/^./, (c) => c.toUpperCase()),
    verified: lead.verified ? 'Yes' : 'No',
    status: statusLabel(lead.status),
    created_date: new Date(lead.created_at).toLocaleDateString(),
  };
}

const HYPERLINK = (url: string, label: string) =>
  `=HYPERLINK("${url.replace(/"/g, '""')}","${label.replace(/"/g, '""')}")`;

// URL-ish columns become clickable Excel links in CSV. Only applied to real
// values — "N/A" markers stay plain text.
function maybeLink(value: string, url: string): string {
  if (value === 'N/A') return value;
  return HYPERLINK(url, value);
}

function toClickableCsvRow(row: ExportData): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  if (row.phone !== 'N/A') out.phone = maybeLink(row.phone, `tel:${row.phone.replace(/[\s-]/g, '')}`);
  if (row.email !== 'N/A') out.email = maybeLink(row.email, `mailto:${row.email}`);
  if (row.website !== 'N/A') out.website = maybeLink(row.website, row.website);
  if (row.instagram !== 'N/A') out.instagram = maybeLink(row.instagram, row.instagram);
  if (row.facebook !== 'N/A') out.facebook = maybeLink(row.facebook, row.facebook);
  if (row.linkedin !== 'N/A') out.linkedin = maybeLink(row.linkedin, row.linkedin);
  if (row.location_url !== 'N/A') out.location_url = HYPERLINK(row.location_url, row.location_url);
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

    // XLSX with real, clickable hyperlinks + readability features:
    // frozen header, auto-filter, and highlighted "Verified" / status values.
    const worksheet = XLSX.utils.json_to_sheet(exportData);

    const keys = Object.keys(exportData[0] || {}) as (keyof ExportData)[];

    const link = (addr: string, target: string, tooltip: string) => {
      const cell = worksheet[addr];
      if (!cell) return;
      cell.l = { Target: target, Tooltip: tooltip };
      cell.s = { font: { color: { rgb: '0563C1' }, underline: true } };
    };

    exportData.forEach((row, i) => {
      const col = (k: keyof ExportData) => keys.indexOf(k) + 1;
      if (row.phone !== 'N/A') link(XLSX.utils.encode_cell({ r: i + 1, c: col('phone') - 1 }), `tel:${row.phone.replace(/[\s-]/g, '')}`, 'Call');
      if (row.email !== 'N/A') link(XLSX.utils.encode_cell({ r: i + 1, c: col('email') - 1 }), `mailto:${row.email}`, 'Email');
      if (row.website !== 'N/A') link(XLSX.utils.encode_cell({ r: i + 1, c: col('website') - 1 }), row.website, row.website);
      if (row.instagram !== 'N/A') link(XLSX.utils.encode_cell({ r: i + 1, c: col('instagram') - 1 }), row.instagram, row.instagram);
      if (row.facebook !== 'N/A') link(XLSX.utils.encode_cell({ r: i + 1, c: col('facebook') - 1 }), row.facebook, row.facebook);
      if (row.linkedin !== 'N/A') link(XLSX.utils.encode_cell({ r: i + 1, c: col('linkedin') - 1 }), row.linkedin, row.linkedin);
      if (row.location_url !== 'N/A') link(XLSX.utils.encode_cell({ r: i + 1, c: col('location_url') - 1 }), row.location_url, 'Open in Google Maps');

      // Color-coded verified / status cells for at-a-glance reading.
      const addr = worksheet[XLSX.utils.encode_cell({ r: i + 1, c: col('verified') - 1 })];
      if (addr) {
        addr.s = { font: { color: { rgb: row.verified === 'Yes' ? '15803D' : '9CA3AF' }, bold: true } };
      }
      const stAddr = worksheet[XLSX.utils.encode_cell({ r: i + 1, c: col('status') - 1 })];
      if (stAddr) {
        stAddr.s = { font: { color: { rgb: '374151' }, bold: true } };
      }
    });

    // Auto-size columns, but cap width so long URLs don't blow out the sheet.
    const colWidths = keys.map((key) => ({
      wch: Math.max(
        key.length + 2,
        Math.min(
          45,
          ...exportData.map((row) => String((row as unknown as Record<string, unknown>)[key] || '').length)
        )
      ),
    }));
    worksheet['!cols'] = colWidths;
    worksheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_cell({ r: exportData.length, c: keys.length - 1 })}` };
    worksheet['!freeze'] = { xSplit: 0, ySplit: 1 };

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