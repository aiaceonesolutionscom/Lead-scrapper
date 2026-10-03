import { Router } from 'express';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { jsPDF } from 'jspdf';
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

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

const ink = hexToRgb('#334155');
const muted = hexToRgb('#64748b');
const subtle = hexToRgb('#e2e8f0');
const brand = hexToRgb('#4f46e5');
const headBg = hexToRgb('#f1f5f9');
const striped = hexToRgb('#f8fafc');
const green = hexToRgb('#15803d');
const PDF_FONT = 'helvetica';

// Printable column set. Widths are weights normalized to the page at runtime so
// they always fill the content area; long URLs wrap (max 2 lines) instead of
// breaking the layout, keeping each row clean and scannable.
const PDF_COLS: { header: string; key: keyof ExportData; weight: number; maxLines: number }[] = [
  { header: 'Business', key: 'business_name', weight: 0.145, maxLines: 2 },
  { header: 'Contact', key: 'contact_person', weight: 0.05, maxLines: 2 },
  { header: 'Phone', key: 'phone', weight: 0.10, maxLines: 1 },
  { header: 'Email', key: 'email', weight: 0.09, maxLines: 2 },
  { header: 'Website', key: 'website', weight: 0.075, maxLines: 2 },
  { header: 'Instagram', key: 'instagram', weight: 0.07, maxLines: 2 },
  { header: 'Facebook', key: 'facebook', weight: 0.07, maxLines: 2 },
  { header: 'LinkedIn', key: 'linkedin', weight: 0.07, maxLines: 2 },
  { header: 'Address', key: 'address', weight: 0.075, maxLines: 2 },
  { header: 'City', key: 'city', weight: 0.04, maxLines: 1 },
  { header: 'Country', key: 'country', weight: 0.045, maxLines: 1 },
  { header: 'Category', key: 'category', weight: 0.048, maxLines: 2 },
  { header: 'Status', key: 'status', weight: 0.038, maxLines: 1 },
  { header: 'Verified', key: 'verified', weight: 0.045, maxLines: 1 },
  { header: 'Date', key: 'created_date', weight: 0.04, maxLines: 1 },
];

// Draws text inside a fixed-width box: until its width fits the box it is
// re-rendered at a smaller font size. When even the smallest size won't fit it
// first tries word-wrapping onto more lines; if a single unbreakable word is
// still too wide it is truncated with "…" so it never bleeds into the next
// column.
const drawFitText = (doc: jsPDF, text: string, x: number, yPos: number, maxWidth: number, startSize: number): void => {
  let size = startSize;
  doc.setFontSize(size);
  while (size > 5 && doc.getTextWidth(text) > maxWidth) {
    size -= 0.5;
    doc.setFontSize(size);
  }
  let t = text;
  if (doc.getTextWidth(t) > maxWidth) {
    const wrapped = doc.splitTextToSize(t, maxWidth) as string[];
    if (wrapped.length > 1) {
      wrapped.slice(0, 3).forEach((ln, li) => {
        if (ln) doc.text(ln, x, yPos + li * 5);
      });
      return;
    }
    while (t.length > 1 && doc.getTextWidth(t + '…') > maxWidth) t = t.slice(0, -1);
    t += '…';
  }
  doc.text(t, x, yPos);
};

function buildLeadsPdf(rows: ExportData[]): ArrayBuffer {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;
  const contentW = pageW - margin * 2;

  const totalWeight = PDF_COLS.reduce((s, c) => s + c.weight, 0);
  const widths = PDF_COLS.map((c) => (c.weight / totalWeight) * contentW);

  const lineH = 9;
  const cellPad = 3;

  let y = 0;
  let page = 1;

  const footer = () => {
    doc.setFontSize(7.5);
    doc.setFont(PDF_FONT, 'normal');
    doc.setTextColor(...muted);
    doc.text('© 2026 MJ Labs · Built by Muneeb Jawwad · Lead Extractor + CRM', margin, pageH - 18);
    doc.text(`Page ${page}`, pageW - margin, pageH - 18, { align: 'right' });
  };

  const drawColumnHeader = () => {
    const headerH = 20;
    doc.setFillColor(...headBg);
    doc.rect(margin, y, contentW, headerH, 'F');
    let cx = margin;
    PDF_COLS.forEach((c, i) => {
      doc.setFont(PDF_FONT, 'bold');
      doc.setTextColor(...ink);
      drawFitText(doc, c.header.toUpperCase(), cx + 4, y + 13, widths[i] - 8, 7.5);
      cx += widths[i];
    });
    doc.setDrawColor(...subtle);
    doc.line(margin, y + headerH, margin + contentW, y + headerH);
    y += headerH;
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - 32) {
      doc.addPage();
      page += 1;
      footer();
      y = margin + 4;
      drawColumnHeader();
    }
  };

  // ---- Page 1 brand band ----
  doc.setFillColor(...brand);
  doc.roundedRect(margin, margin, contentW, 42, 6, 6, 'F');
  doc.setFont(PDF_FONT, 'bold');
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text('LEADS EXPORT', margin + 14, margin + 26);
  doc.setFont(PDF_FONT, 'normal');
  doc.setFontSize(8.5);
  doc.text(`Generated ${new Date().toLocaleString()}`, pageW - margin, margin + 18, { align: 'right' });
  doc.text(`${rows.length} lead${rows.length === 1 ? '' : 's'} · ${rows.filter((r) => r.verified === 'Yes').length} verified`, pageW - margin, margin + 30, { align: 'right' });

  y = margin + 42 + 12;
  footer();
  drawColumnHeader();

  doc.setFontSize(8);
  for (const [ri, row] of rows.entries()) {
    const wrapped: string[][] = PDF_COLS.map((c) => {
      const raw = String(row[c.key] ?? '');
      if (raw.length === 0) return [''];
      const lines = doc.splitTextToSize(raw, widths[PDF_COLS.indexOf(c)] - 9) as string[];
      if (c.maxLines === 1 && lines.length > 1) {
        return [lines[0]];
      }
      if (lines.length > c.maxLines) {
        const capped = lines.slice(0, c.maxLines);
        capped[capped.length - 1] += '…';
        return capped;
      }
      return lines;
    });
    const rowH = Math.max(...wrapped.map((l) => l.length)) * lineH + cellPad * 2;

    ensureSpace(rowH);
    if (ri % 2 === 1) {
      doc.setFillColor(...striped);
      doc.rect(margin, y, contentW, rowH, 'F');
    }

    wrapped.forEach((lines, ci) => {
      const x0 = margin + widths.slice(0, ci).reduce((a, b) => a + b, 0) + 4;
      const avail = widths[ci] - 8;
      lines.forEach((ln, li) => {
        const key = PDF_COLS[ci].key;
        doc.setFont(PDF_FONT, key === 'status' ? 'bold' : 'normal');
        if (key === 'verified' && ln === 'Yes') {
          doc.setFont(PDF_FONT, 'bold');
          doc.setTextColor(...green);
        } else {
          doc.setTextColor(...ink);
        }
        drawFitText(doc, ln, x0, y + cellPad + lineH * li + 7, avail, 8);
      });
    });

    doc.setDrawColor(...subtle);
    let sx = margin;
    widths.forEach((w) => {
      sx += w;
      doc.line(sx, y, sx, y + rowH);
    });
    doc.line(margin, y + rowH, margin + contentW, y + rowH);
    y += rowH;
  }

  footer();
  return doc.output('arraybuffer');
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

    if (format !== 'csv' && format !== 'xlsx' && format !== 'pdf') {
      return sendError(res, 400, 'format must be "csv", "xlsx" or "pdf"');
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

    if (format === 'pdf') {
      const buffer = buildLeadsPdf(exportData);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="leads-export-${Date.now()}.pdf"`);
      return res.send(Buffer.from(buffer));
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