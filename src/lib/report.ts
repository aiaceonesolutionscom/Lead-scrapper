"use client";

import { jsPDF } from "jspdf";

const BRAND = "MJ Labs";
const FOUNDER = "Muneeb Jawwad";

export interface AdminReportUser {
  username: string;
  role: string;
  enabled: boolean;
  total_searches: number;
  leads_extracted: number;
  last_search_at: string | null;
}

export interface AdminReportInput {
  generated_at: Date;
  totals: { searches: number; leads: number };
  users: AdminReportUser[];
  system: {
    label: string;
    total_searches: number;
    leads_extracted: number;
    last_search_at: string | null;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

const ink = hexToRgb("#334155");
const muted = hexToRgb("#64748b");
const subtle = hexToRgb("#e2e8f0");
const brand = hexToRgb("#4f46e5");
const headBg = hexToRgb("#f1f5f9");

/** Admin CRM report: totals + per-user extraction stats as a branded PDF. */
export function buildAdminReport(input: AdminReportInput): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentW = pageW - margin * 2;

  let y = 0;
  let page = 1;

  const footer = () => {
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text(`© 2026 ${BRAND} · Built by ${FOUNDER}`, margin, pageH - 24);
    doc.text(`Page ${page}`, pageW - margin, pageH - 24, { align: "right" });
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - 48) {
      doc.addPage();
      page += 1;
      footer();
      y = margin + 10;
    }
  };

  const statBoxes = (
    items: { label: string; value: string }[],
    cols: number
  ) => {
    const gap = 10;
    const w = (contentW - gap * (cols - 1)) / cols;
    const h = 52;
    items.forEach((it, i) => {
      ensureSpace(h + 8);
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = margin + col * (w + gap);
      const y0 = y + row * (h + gap);
      doc.setFillColor(...subtle);
      doc.roundedRect(x, y0, w, h, 6, 6, "F");
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...ink);
      doc.text(it.value, x + 12, y0 + 24);
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...muted);
      doc.text(it.label.toUpperCase(), x + 12, y0 + 38);
    });
    y += Math.ceil(items.length / cols) * (h + gap);
    return y;
  };

  const table = (
    title: string,
    colWidths: number[],
    headers: string[],
    rows: string[][],
    maxRows = 20
  ) => {
    ensureSpace(90);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...ink);
    doc.text(title, margin, y);
    y += 16;

    const rowH = 24;
    const slice = rows.slice(0, maxRows);
    const headerY = y;

    doc.setFillColor(...headBg);
    doc.rect(margin, headerY, contentW, rowH, "F");
    let cx = margin;
    headers.forEach((hd, i) => {
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...ink);
      doc.text(hd.toUpperCase(), cx + 6, headerY + 15);
      cx += colWidths[i];
    });
    y = headerY + rowH;

    const striped = hexToRgb("#f8fafc");
    doc.setFontSize(9);
    slice.forEach((cells, ri) => {
      if (ri % 2 === 1) {
        doc.setFillColor(...striped);
        doc.rect(margin, y, contentW, rowH, "F");
      }
      let cxx = margin;
      cells.forEach((cell, ci) => {
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...ink);
        const txt = cell.length > 34 ? cell.slice(0, 31) + "\u2026" : cell;
        doc.text(txt, cxx + 6, y + 15);
        cxx += colWidths[ci];
      });
      doc.setDrawColor(...subtle);
      let sx = margin;
      colWidths.forEach((w) => {
        sx += w;
        doc.line(sx, y, sx, y + rowH);
      });
      y += rowH;
    });
    doc.setDrawColor(...subtle);
    doc.line(margin, y, margin + contentW, y);

    if (rows.length > maxRows) {
      doc.setFontSize(8);
      doc.setTextColor(...muted);
      doc.text(`+${rows.length - maxRows} more`, margin, y + 14);
      y += 20;
    }
    y += 16;
    return y;
  };

  // ---- Header ----
  doc.setFillColor(...brand);
  doc.roundedRect(margin, margin, contentW, 56, 8, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(255, 255, 255);
  doc.text("LE", margin + 18, margin + 36);
  doc.setFontSize(13);
  doc.text("Admin Report — CRM Overview", margin + 44, margin + 28);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(`${BRAND} · A product by ${FOUNDER}`, margin + 44, margin + 42);
  doc.setFontSize(8.5);
  doc.text(input.generated_at.toLocaleString(), pageW - margin, margin + 24, {
    align: "right",
  });
  doc.setTextColor(255, 255, 255);
  doc.text("Lead Extractor + CRM", pageW - margin, margin + 40, {
    align: "right",
  });

  y = margin + 72;
  footer();

  // ---- Totals ----
  statBoxes(
    [
      { label: "Total Searches", value: input.totals.searches.toLocaleString() },
      { label: "Total Leads", value: input.totals.leads.toLocaleString() },
      {
        label: "Accounts",
        value: input.users.length.toLocaleString(),
      },
    ],
    3
  );
  y += 10;

  // ---- Users table ----
  const userRows = input.users.map((u) => [
    `${u.username}${u.enabled ? "" : " (disabled)"}`,
    u.role,
    String(u.total_searches),
    String(u.leads_extracted),
    u.last_search_at ? new Date(u.last_search_at).toLocaleString() : "—",
  ]);
  userRows.push([
    `${input.system.label} (imported)`,
    "—",
    String(input.system.total_searches),
    String(input.system.leads_extracted),
    input.system.last_search_at
      ? new Date(input.system.last_search_at).toLocaleString()
      : "—",
  ]);

  table(
    "Extraction Activity by User",
    [
      contentW * 0.34,
      contentW * 0.12,
      contentW * 0.16,
      contentW * 0.16,
      contentW * 0.22,
    ],
    ["User", "Role", "Searches", "Leads", "Last Search"],
    userRows
  );

  // ---- Signature ----
  ensureSpace(60);
  doc.setDrawColor(...subtle);
  doc.line(margin, y, margin + 120, y);
  doc.setFontSize(8.5);
  doc.setTextColor(...muted);
  doc.text(`Generated by ${BRAND}`, margin, y + 12);

  footer();

  const dateTag = input.generated_at.toISOString().slice(0, 10);
  doc.save(`admin-report-${dateTag}.pdf`);
}