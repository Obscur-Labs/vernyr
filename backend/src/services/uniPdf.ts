import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib';
import { getSetting } from '../models/Audit';
import { signedFileUrl } from '../config/cloudinary';

/** The client's partner PDFs (legacy/server/university/pdf.js): report tables (11.3) and commission invoices / credit notes (10.5). */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
// standard PDF fonts only know Windows-1252: anything else is replaced so generation never fails
export const W = (s: unknown) => String(s ?? '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\u20b9/g, 'INR ').replace(/[^\x20-\x7E\xA0-\xFF\u20ac\n]/g, '?');
function wrap(text: unknown, font: PDFFont, size: number, maxW: number) {
  const out: string[] = [];
  for (const para of W(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) { const t = line ? line + ' ' + word : word; if (font.widthOfTextAtSize(t, size) > maxW && line) { out.push(line); line = word; } else line = t; }
    out.push(line);
  }
  return out;
}
async function logoImage(doc: PDFDocument, uni?: Any | null): Promise<PDFImage | null> {
  try {
    if (!uni?.logo_url) return null;
    const r = await fetch(signedFileUrl(uni.logo_url, uni.logo_public_id, 'image') || uni.logo_url); if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return b[0] === 0x89 ? await doc.embedPng(b) : await doc.embedJpg(b);
  } catch { return null; }
}

export async function tablePdf({ title, sub, columns, rows, uni }: { title: string; sub: string; columns: string[]; rows: unknown[][]; uni?: Any | null }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica); const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const landscape = columns.length > 6; const [PW, PH] = landscape ? [841.89, 595.28] : [595.28, 841.89];
  const M = 32; const colW = (PW - 2 * M) / columns.length; const size = columns.length > 10 ? 6.5 : 8;
  const logo = await logoImage(doc, uni);
  let page = doc.addPage([PW, PH]); let y = 0;
  const newPage = (first = false) => {
    if (!first) page = doc.addPage([PW, PH]);
    y = PH - M;
    if (logo) page.drawImage(logo, { x: PW - M - 40, y: y - 34, width: 40, height: 40 });
    page.drawText(W(title), { x: M, y: y - 14, size: 14, font: bold, color: rgb(0.06, 0.12, 0.23) });
    page.drawText(W(sub), { x: M, y: y - 30, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
    y -= 52;
    let x = M; page.drawRectangle({ x: M, y: y - 4, width: PW - 2 * M, height: 16, color: rgb(0.06, 0.12, 0.23) });
    for (const c of columns) { page.drawText(W(c).slice(0, Math.floor(colW / (size * 0.55))), { x: x + 3, y, size, font: bold, color: rgb(1, 1, 1) }); x += colW; }
    y -= 18;
  };
  newPage(true);
  rows.forEach((row, i) => {
    const cells = row.map((v) => wrap(v, font, size, colW - 6));
    const h = Math.max(...cells.map((c) => c.length)) * (size + 2) + 4;
    if (y - h < M + 20) newPage();
    if (i % 2) page.drawRectangle({ x: M, y: y - h + size + 2, width: PW - 2 * M, height: h, color: rgb(0.96, 0.97, 0.99) });
    let x = M; cells.forEach((lines) => { lines.forEach((l, k) => page.drawText(l, { x: x + 3, y: y - k * (size + 2), size, font, color: rgb(0.1, 0.1, 0.1) })); x += colW; });
    y -= h;
  });
  if (!rows.length) page.drawText('No data for these filters.', { x: M, y, size: 10, font });
  const pages = doc.getPages(); pages.forEach((p, i) => p.drawText(`La Europa Education partner portal | Page ${i + 1} of ${pages.length}`, { x: M, y: 16, size: 7, font, color: rgb(0.5, 0.5, 0.5) }));
  return Buffer.from(await doc.save());
}

/** commission invoice or credit note; company, tax and bank details come from Admin settings (placeholders until entered) */
export async function invoicePdf(inv: Any, lines: Any[], opts: { creditFor?: string; agreement?: string } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica); const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]); const M = 40; let y = 800;
  const t = (s: unknown, x: number, yy: number, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}) => page.drawText(W(s), { x, y: yy, size: o.size || 9, font: o.bold ? bold : font, color: o.color || rgb(0.12, 0.12, 0.12) });
  const credit = inv.kind === 'credit_note';
  page.drawRectangle({ x: 0, y: 780, width: 595.28, height: 62, color: rgb(0.06, 0.12, 0.23) });
  t('La Europa Education', M, 812, { size: 18, bold: true, color: rgb(1, 1, 1) }); t('Euroverse Service LLP, trading as La Europa Education', M, 796, { size: 9, color: rgb(0.85, 0.85, 0.85) });
  t(credit ? 'CREDIT NOTE' : 'INVOICE', 440, 806, { size: 18, bold: true, color: rgb(0.79, 0.64, 0.15) });
  y = 760;
  const from = [(await getSetting('company_address')) || '[Company address: set in Admin settings]', (await getSetting('invoice_tax_ids')) || '[GSTIN / PAN / LLPIN: set in Admin settings]', (await getSetting('privacy_email')) || ''].filter(Boolean);
  t('From', M, y, { bold: true }); from.forEach((l, i) => wrap(l, font, 8.5, 230).forEach((w, k) => t(w, M, y - 13 - (i * 2 + k) * 11, { size: 8.5 })));
  const bill: Any = inv.bill_to || {};
  t('Bill to', 310, y, { bold: true }); [bill.name, bill.address, bill.vat_id ? `Tax / VAT ID: ${bill.vat_id}` : null, bill.contact].filter(Boolean).forEach((l, i) => wrap(l, font, 8.5, 240).forEach((w, k) => t(w, 310, y - 13 - (i * 2 + k) * 11, { size: 8.5 })));
  y = 660;
  const kv: [string, string][] = [[credit ? 'Credit note number' : 'Invoice number', inv.invoice_no], ['Date', inv.invoice_date], ...(credit ? [['Credits invoice', opts.creditFor || ''] as [string, string]] : [['Due date', inv.due_date] as [string, string]]), ['Agreement', opts.agreement || '-'], ['Currency', inv.currency]];
  kv.forEach(([k, v], i) => { t(k, M, y - i * 13, { bold: true, size: 8.5 }); t(v, M + 120, y - i * 13, { size: 8.5 }); });
  y -= kv.length * 13 + 16;
  const cols: [string, number][] = [['Student', 110], ['Application', 72], ['Univ. ID', 55], ['Course / intake', 130], ['Enrolled', 52], ['Basis', 50], ['Rate', 34], ['Amount', 52]];
  page.drawRectangle({ x: M, y: y - 4, width: 515, height: 16, color: rgb(0.93, 0.94, 0.97) });
  let x = M; for (const [c, w] of cols) { t(c, x + 2, y, { bold: true, size: 7.5 }); x += w; } y -= 16;
  for (const l of lines) {
    x = M; const vals = [l.student, l.application, l.uni_id, l.course, l.enrolled, l.basis, l.rate, l.amount];
    const h = Math.max(...vals.map((v, i) => wrap(v, font, 7.5, cols[i][1] - 4).length)) * 9.5 + 4;
    vals.forEach((v, i) => { wrap(v, font, 7.5, cols[i][1] - 4).forEach((w, k) => t(w, x + 2, y - k * 9.5, { size: 7.5 })); x += cols[i][1]; });
    y -= h; page.drawLine({ start: { x: M, y: y + 6 }, end: { x: M + 515, y: y + 6 }, thickness: 0.3, color: rgb(0.85, 0.85, 0.85) });
  }
  y -= 8;
  const money = (n: unknown) => `${(Math.round(Number(n || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })} ${inv.currency}`;
  const totals: [string, string][] = [['Subtotal', money(inv.subtotal)], ...((inv.tax ?? []) as Any[]).map((tx) => [tx.name + (tx.percent ? ` (${tx.percent}%)` : ''), tx.not_applicable ? `Not applicable${tx.note ? ': ' + tx.note : ''}` : money(tx.amount)] as [string, string]), [credit ? 'Total credit' : 'Total', money(inv.total)]];
  totals.forEach(([k, v], i) => { t(k, 360, y - i * 14, { bold: i === totals.length - 1, size: 9 }); t(v, 470, y - i * 14, { bold: i === totals.length - 1, size: 9 }); });
  y -= totals.length * 14 + 20;
  if (!credit) { t('Payment instructions', M, y, { bold: true }); wrap((await getSetting('invoice_bank_details')) || '[Bank details: set in Admin settings]', font, 8.5, 515).forEach((w, k) => t(w, M, y - 13 - k * 11, { size: 8.5 })); y -= 60; }
  if (inv.notes) { t('Notes', M, y, { bold: true }); wrap(inv.notes, font, 8.5, 515).forEach((w, k) => t(w, M, y - 13 - k * 11, { size: 8.5 })); }
  t('Please upload the payment proof in the La Europa partner portal. This document was generated by the La Europa CRM.', M, 30, { size: 7, color: rgb(0.5, 0.5, 0.5) });
  return Buffer.from(await doc.save());
}
