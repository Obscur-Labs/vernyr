import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { getSetting } from '../models/Audit';

/** Student invoices / payment requests and receipts (legacy/server/svcpdf.js): brand gradients, pdf-lib with Helvetica, text stays selectable. */

type Rgb = [number, number, number];
const C: Record<string, Rgb> = { violet: [0.545, 0.361, 0.965], indigo: [0.357, 0.337, 0.914], sky: [0.231, 0.51, 0.965], teal: [0.251, 0.816, 0.745], ink: [0.09, 0.1, 0.16],
  muted: [0.42, 0.45, 0.53], line: [0.88, 0.89, 0.94], soft: [0.965, 0.965, 0.995], soft2: [0.93, 0.93, 1], green: [0.05, 0.6, 0.42], red: [0.86, 0.2, 0.2], amber: [0.85, 0.5, 0.05], white: [1, 1, 1] };
const col = (c: Rgb) => rgb(c[0], c[1], c[2]);
const mix = (a: Rgb, b: Rgb, f: number) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * f) as Rgb;
const W = (s: unknown) => String(s ?? '').replace(/₹/g, 'Rs.').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/[^\x20-\x7E\n]/g, '');
export const inrPdf = (n: unknown) => 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtDate = (ymd?: string | null) => (ymd ? new Date(String(ymd).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }) : '');
const LOGO = (() => {
  for (const p of [path.join(process.cwd(), '..', 'crm', 'public', 'brand', 'vernyr-icon-192.png'), path.join(process.cwd(), 'crm', 'public', 'brand', 'vernyr-icon-192.png')]) {
    try { return fs.readFileSync(p); } catch { /* try the next place */ }
  }
  return null;
})();
const CONTACT = async () => ({ web: (await getSetting('company_website')) || 'www.vernyr.com', phone: (await getSetting('company_phone')) || '+91 777 888 1875', email: (await getSetting('privacy_email')) || 'info.laeuropa@gmail.com' });

type O = { size?: number; bold?: boolean; color?: Rgb; rotate?: number; opacity?: number };
async function canvas() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const PW = 595.28, PH = 841.89, M = 34;
  const page = doc.addPage([PW, PH]);
  const f = (o: O) => (o.bold ? bold : font);
  const width = (s: unknown, size: number, o: O = {}) => f(o).widthOfTextAtSize(W(s), size);
  const t = (s: unknown, x: number, y: number, o: O = {}) => page.drawText(W(s), { x, y, size: o.size || 9, font: f(o), color: col(o.color || C.ink), rotate: o.rotate ? degrees(o.rotate) : undefined, opacity: o.opacity });
  const tr = (s: unknown, xr: number, y: number, o: O = {}) => t(s, xr - width(s, o.size || 9, o), y, o);
  const tc = (s: unknown, xc: number, y: number, o: O = {}) => t(s, xc - width(s, o.size || 9, o) / 2, y, o);
  const wrap = (s: unknown, size: number, maxW: number, o: O = {}) => {
    const out: string[] = [];
    for (const para of W(s).split('\n')) { let line = ''; for (const w of para.split(/\s+/)) { const x = line ? line + ' ' + w : w; if (width(x, size, o) > maxW && line) { out.push(line); line = w; } else line = x; } out.push(line); }
    return out;
  };
  // rounded rectangle, (x, yTop) = top-left corner
  const rr = (x: number, yTop: number, w: number, h: number, r: number, o: { fill?: Rgb; border?: Rgb; bw?: number; opacity?: number } = {}) =>
    page.drawSvgPath(`M ${r},0 H ${w - r} Q ${w},0 ${w},${r} V ${h - r} Q ${w},${h} ${w - r},${h} H ${r} Q 0,${h} 0,${h - r} V ${r} Q 0,0 ${r},0 Z`,
      { x, y: yTop, color: o.fill ? col(o.fill) : undefined, borderColor: o.border ? col(o.border) : undefined, borderWidth: o.border ? o.bw || 0.8 : 0, opacity: o.opacity, borderOpacity: o.opacity });
  // horizontal gradient band from stops [[colour, at]...]
  const grad = (x: number, y: number, w: number, h: number, stops: [Rgb, number][], n = 80) => {
    for (let i = 0; i < n; i++) {
      const p = i / (n - 1);
      let a = stops[0], b = stops[stops.length - 1];
      for (let k = 0; k < stops.length - 1; k++) if (p >= stops[k][1] && p <= stops[k + 1][1]) { a = stops[k]; b = stops[k + 1]; break; }
      page.drawRectangle({ x: x + (w / n) * i, y, width: w / n + 0.6, height: h, color: col(mix(a[0], b[0], (p - a[1]) / (b[1] - a[1] || 1))) });
    }
  };
  const png = async (text: string, px: number) => doc.embedPng(await QRCode.toBuffer(text, { margin: 1, width: px * 3, errorCorrectionLevel: 'M', color: { dark: '#16192A', light: '#FFFFFF' } }));
  const circle = (x: number, y: number, r: number, c?: Rgb, o: { border?: Rgb; bw?: number; opacity?: number } = {}) =>
    page.drawCircle({ x, y, size: r, color: c ? col(c) : undefined, borderColor: o.border ? col(o.border) : undefined, borderWidth: o.bw || 0, opacity: o.opacity });
  const logo: PDFImage | null = LOGO ? await doc.embedPng(LOGO) : null;
  return { doc, page, font, bold, PW, PH, M, t, tr, tc, wrap, rr, grad, png, circle, width, logo };
}
type Cv = Awaited<ReturnType<typeof canvas>>;

function header(cv: Cv, stops: [Rgb, number][], title: string, sub: string) {
  const { page, PW, PH, M, t, tr, grad, circle, tc } = cv;
  grad(0, PH - 128, PW, 128, stops);
  circle(PW - 40, PH - 10, 70, C.white, { opacity: 0.08 }); circle(PW - 120, PH - 120, 46, C.white, { opacity: 0.07 }); circle(PW * 0.45, PH + 10, 60, C.white, { opacity: 0.05 });
  circle(M + 22, PH - 50, 22, C.white);
  if (cv.logo) page.drawImage(cv.logo, { x: M + 22 - 15, y: PH - 50 - 15, width: 30, height: 30 }); else tc('V', M + 22, PH - 56, { size: 16, bold: true, color: C.indigo });
  t('La Europa Education', M + 54, PH - 46, { size: 19, bold: true, color: C.white });
  t('Euroverse Service LLP  |  Study abroad, done right', M + 54, PH - 62, { size: 8.5, color: [0.92, 0.92, 1] });
  tr(title, PW - M, PH - 48, { size: 21, bold: true, color: C.white });
  tr(sub, PW - M, PH - 63, { size: 8.5, color: [0.92, 0.92, 1] });
}
async function footer(cv: Cv, line2: string) {
  const { PW, M, tc, grad } = cv;
  const c = await CONTACT();
  grad(M, 52, PW - 2 * M, 2, [[C.violet, 0], [C.indigo, 0.5], [C.sky, 1]]);
  tc(`${c.web}   |   ${c.phone}   |   ${c.email}`, PW / 2, 38, { size: 8, color: C.muted });
  tc(line2, PW / 2, 26, { size: 7.5, color: C.muted });
}
function stamp(cv: Cv, text: string, color: Rgb, x: number, y: number) {
  const { page, bold } = cv;
  const size = 15, w = bold.widthOfTextAtSize(text, size) + 22;
  page.drawRectangle({ x, y, width: w, height: 28, borderColor: col(color), borderWidth: 2.2, rotate: degrees(12), opacity: 0, borderOpacity: 0.85 });
  page.drawText(text, { x: x + 9, y: y + 8.5, size, font: bold, color: col(color), rotate: degrees(12), opacity: 0.85 });
}
function strip(cv: Cv, yTop: number, cells: [string, string, boolean?][]) {
  const { PW, M, rr, t, wrap } = cv;
  const w = PW - 2 * M, h = 58;
  rr(M + 2, yTop - 3, w, h, 14, { fill: [0.85, 0.86, 0.93], opacity: 0.6 }); rr(M, yTop, w, h, 14, { fill: C.white, border: C.line });
  const cw = w / cells.length;
  cells.forEach(([k, v, hi], i) => {
    const x = M + cw * i;
    if (hi) rr(x + 6, yTop - 6, cw - 12, h - 12, 10, { fill: C.soft2 });
    if (i && !hi) cv.page.drawLine({ start: { x, y: yTop - 12 }, end: { x, y: yTop - h + 12 }, thickness: 0.6, color: col(C.line) });
    t(k.toUpperCase(), x + 16, yTop - 22, { size: 7, bold: true, color: hi ? C.indigo : C.muted });
    t(wrap(v, hi ? 14 : 10, cw - 26, { bold: true })[0], x + 16, yTop - 41, { size: hi ? 14 : 10, bold: true, color: hi ? C.indigo : C.ink });
  });
  return yTop - h;
}
function card(cv: Cv, x: number, yTop: number, w: number, label: string, lines: string[], accent: Rgb) {
  const { rr, t, wrap } = cv;
  const body = lines.flatMap((l, i) => wrap(l, i === 0 ? 10 : 8.5, w - 28, { bold: i === 0 }).map((z) => [z, i === 0] as [string, boolean]));
  const h = 34 + body.length * 12.5;
  rr(x, yTop, w, h, 12, { fill: C.soft, border: C.line });
  cv.page.drawRectangle({ x, y: yTop - h + 10, width: 3, height: h - 20, color: col(accent) });
  t(label.toUpperCase(), x + 14, yTop - 18, { size: 7, bold: true, color: accent });
  body.forEach(([z, b], i) => t(z, x + 14, yTop - 34 - i * 12.5, { size: b ? 10 : 8.5, bold: b, color: b ? C.ink : C.muted }));
  return h;
}

export interface InvoiceRow {
  invoice_no: string; status: string; invoice_date: string; due_date: string; total: number; taxable: number; cgst: number; sgst: number; igst: number; round_off: number;
  supply_type: string; place_of_supply?: string; pos_code?: string; bill_name?: string; bill_address?: string; bill_gstin?: string; student_code?: string; description: string; sac?: string;
  receipt_no?: string; paid_at?: Date | string; _id?: unknown; kind?: string;
}
export interface InvoiceHelpers {
  words: (n: number) => string; bank: () => Promise<Record<string, string> | null>; upiLink: (inv: InvoiceRow) => Promise<string | null>; appUrl: () => string;
  kindOf: (inv: InvoiceRow) => { gst: boolean; note?: string }; companyGstin: () => Promise<string>; proofDate: (inv: InvoiceRow) => Promise<Date | null>;
}

export async function invoicePdf(inv: InvoiceRow, H: InvoiceHelpers) {
  const K = H.kindOf(inv);
  const cv = await canvas();
  const { page, PW, M, t, tr, tc, rr, grad, circle, wrap } = cv;
  header(cv, [[C.violet, 0], [C.indigo, 0.5], [C.sky, 1]], K.gst ? 'TAX INVOICE' : 'PAYMENT REQUEST', K.gst ? 'Original for recipient' : 'No GST: collected for the university');
  let y = strip(cv, 841.89 - 104, [[K.gst ? 'Invoice no.' : 'Request no.', inv.invoice_no], ['Date', fmtDate(inv.invoice_date)], ['Due date', fmtDate(inv.due_date)],
    [inv.status === 'Paid' ? 'Amount paid' : 'Amount due', inrPdf(inv.total), true]]) - 18;
  const addr = (await getSetting('company_address')) || '303, Panvel Point, Mota Varachha, Surat, Gujarat, India';
  const cw = (PW - 2 * M - 14) / 2;
  const h1 = card(cv, M, y, cw, 'From', ['Euroverse Service LLP', 'trading as La Europa Education', ...String(addr).split('\n'), `GSTIN ${(await H.companyGstin()) || '-'}  |  State Gujarat (24)`,
    `LLPIN ${(await getSetting('company_llpin')) || 'ACY-5677'}`], C.indigo);
  const h2 = card(cv, M + cw + 14, y, cw, 'Bill to', [inv.bill_name ?? '', `Student ID ${inv.student_code}`, ...(inv.bill_address ? [inv.bill_address] : []),
    ...(K.gst ? [inv.bill_gstin ? `GSTIN ${inv.bill_gstin}` : 'GSTIN: Unregistered (student)', `Place of supply: ${inv.place_of_supply} (${inv.pos_code})  |  Reverse charge: No`] : [])], C.teal);
  const st: [string, Rgb] = inv.status === 'Paid' ? ['PAID', C.green] : inv.status === 'Cancelled' ? ['CANCELLED', C.red] : inv.status === 'Proof submitted' ? ['PROOF RECEIVED', C.sky] : ['UNPAID', C.amber];
  y -= Math.max(h1, h2) + 22;

  // items table
  const intra = inv.supply_type === 'intra', showSac = !!(K.gst && inv.bill_gstin && inv.sac);
  const cols: [string, number, 'l' | 'r'][] = !K.gst ? [['Description', 0, 'l'], ['Amount', 120, 'r']]
    : intra ? [['Description', 0, 'l'], ...(showSac ? [['SAC', 46, 'l'] as [string, number, 'l']] : []), ['Taxable', 84, 'r'], ['CGST 9%', 72, 'r'], ['SGST 9%', 72, 'r'], ['Amount', 88, 'r']]
      : [['Description', 0, 'l'], ...(showSac ? [['SAC', 46, 'l'] as [string, number, 'l']] : []), ['Taxable', 92, 'r'], ['IGST 18%', 84, 'r'], ['Amount', 96, 'r']];
  const tw = PW - 2 * M;
  cols[0][1] = tw - cols.slice(1).reduce((a, c) => a + c[1], 0);
  const vals = !K.gst ? [inv.description, inrPdf(inv.taxable)]
    : intra ? [inv.description, ...(showSac ? [inv.sac] : []), inrPdf(inv.taxable), inrPdf(inv.cgst), inrPdf(inv.sgst), inrPdf(inv.taxable + inv.cgst + inv.sgst)]
      : [inv.description, ...(showSac ? [inv.sac] : []), inrPdf(inv.taxable), inrPdf(inv.igst), inrPdf(inv.taxable + inv.igst)];
  rr(M, y, tw, 24, 10, { fill: C.indigo }); rr(M + tw / 2, y, tw / 2, 24, 10, { fill: C.violet }); grad(M + 10, y - 24, tw - 20, 24, [[C.indigo, 0], [C.violet, 1]], 40);
  let x = M;
  cols.forEach(([c, w, a]) => { if (a === 'r') tr(c, x + w - 12, y - 16, { size: 8, bold: true, color: C.white }); else t(c, x + 12, y - 16, { size: 8, bold: true, color: C.white }); x += w; });
  y -= 24;
  const dl = wrap(inv.description, 9.5, cols[0][1] - 24, { bold: true });
  const rh = Math.max(34, dl.length * 12 + 30);
  rr(M, y, tw, rh, 0, { fill: C.white }); page.drawLine({ start: { x: M, y: y - rh }, end: { x: PW - M, y: y - rh }, thickness: 0.6, color: col(C.line) });
  x = M;
  cols.forEach(([, w, a], i) => {
    if (i === 0) { dl.forEach((l, k) => t(l, x + 12, y - 18 - k * 12, { size: 9.5, bold: true })); t(K.gst ? 'La Europa service' : 'Paid to the university at actual cost', x + 12, y - 18 - dl.length * 12, { size: 7.5, color: C.muted }); }
    else if (a === 'r') tr(vals[i], x + w - 12, y - 18, { size: 9 }); else t(vals[i], x + 12, y - 18, { size: 9 });
    x += w;
  });
  y -= rh + 18;

  // amount in words + note (left) / totals (right)
  const tx = PW - M - 220;
  const rows: [string, string][] = !K.gst ? [['Amount', inrPdf(inv.taxable)], ['GST', 'Not applicable']]
    : [['Taxable value', inrPdf(inv.taxable)], ...(intra ? [['CGST @ 9%', inrPdf(inv.cgst)], ['SGST @ 9%', inrPdf(inv.sgst)]] as [string, string][] : [['IGST @ 18%', inrPdf(inv.igst)]] as [string, string][])];
  if (inv.round_off) rows.push(['Round off', inrPdf(inv.round_off)]);
  const th = rows.length * 16 + 54;
  rr(tx, y, 220, th, 12, { fill: C.soft, border: C.line });
  rows.forEach(([k, v], i) => { t(k, tx + 14, y - 20 - i * 16, { size: 9, color: C.muted }); tr(v, tx + 206, y - 20 - i * 16, { size: 9 }); });
  const by = y - th + 6;
  rr(tx + 6, by + 34, 208, 32, 10, { fill: C.indigo }); rr(tx + 110, by + 34, 104, 32, 10, { fill: C.violet }); grad(tx + 14, by + 2, 192, 32, [[C.indigo, 0], [C.violet, 1]], 30);
  t('TOTAL', tx + 18, by + 14, { size: 9, bold: true, color: C.white }); tr(inrPdf(inv.total), tx + 200, by + 13, { size: 13, bold: true, color: C.white });
  const lw = tx - M - 16;
  const words = wrap(H.words(inv.total), 9, lw - 28, { bold: true });
  const note = K.note ? wrap(K.note, 7.8, lw - 28) : [];
  const lh = Math.max(th, 30 + words.length * 12 + (note.length ? note.length * 10 + 8 : 0) + 44);
  rr(M, y, lw, lh, 12, { fill: C.white, border: C.line });
  t('AMOUNT IN WORDS', M + 14, y - 17, { size: 7, bold: true, color: C.indigo });
  words.forEach((l, i) => t(l, M + 14, y - 31 - i * 12, { size: 9, bold: true }));
  note.forEach((l, i) => t(l, M + 14, y - 31 - words.length * 12 - 6 - i * 10, { size: 7.8, color: [0.25, 0.32, 0.6] }));
  stamp(cv, st[0], st[1], M + lw - cv.bold.widthOfTextAtSize(st[0], 15) - 50, y - lh + 12);
  y -= Math.max(th, lh) + 20;

  // how to pay / paid
  if (inv.status === 'Paid') {
    rr(M, y, tw, 54, 14, { fill: [0.9, 0.98, 0.95], border: [0.7, 0.9, 0.82] }); circle(M + 30, y - 27, 14, C.green);
    page.drawSvgPath('M -6,0 L -2,5 L 7,-6', { x: M + 30, y: y - 27, borderColor: col(C.white), borderWidth: 2.4 });
    t('Paid - thank you!', M + 54, y - 22, { size: 12, bold: true, color: C.green });
    t(`Receipt ${inv.receipt_no}  |  confirmed ${fmtDate(inv.paid_at ? new Date(inv.paid_at).toISOString() : '')}`, M + 54, y - 38, { size: 9, color: C.muted });
    y -= 70;
  } else if (inv.status !== 'Cancelled') {
    const b = await H.bank(), link = await H.upiLink(inv), ph = 196;
    rr(M, y, tw, ph, 16, { fill: C.soft, border: C.line });
    t('HOW TO PAY', M + 16, y - 22, { size: 8, bold: true, color: C.indigo });
    const steps = [['Pay', link ? 'Scan the UPI QR or transfer to the bank account' : 'Transfer to the bank account below'], ['Reference', `Write ${inv.invoice_no} in the payment remarks`], ['Upload', 'Upload the payment proof in the portal: Payments']];
    steps.forEach(([h, s], i) => {
      const sx = M + 16 + i * 118;
      circle(sx + 10, y - 44, 10, i === 1 ? C.violet : C.indigo); tc(String(i + 1), sx + 10, y - 47.5, { size: 9.5, bold: true, color: C.white });
      t(h, sx + 25, y - 41, { size: 8.5, bold: true }); wrap(s, 7.2, 86).forEach((l, k) => t(l, sx + 25, y - 51 - k * 8.6, { size: 7.2, color: C.muted }));
    });
    const bl = b ? ([['Account holder', b.account_name], ['Bank', b.bank_name], ['Account number', b.account_no], ['IFSC', b.ifsc], ['Account type', b.account_type],
      ['Branch', [b.branch, b.city, b.pin].filter(Boolean).join(', ')], ['UPI ID', b.upi_id]] as [string, string][]).filter((r) => r[1]) : [['Bank details', 'Ask your counsellor']];
    rr(M + 12, y - 78, 352, ph - 90, 12, { fill: C.white, border: C.line });
    bl.forEach(([k, v], i) => { t(k, M + 26, y - 96 - i * 14, { size: 8, color: C.muted }); t(v, M + 120, y - 96 - i * 14, { size: 8.8, bold: k === 'Account number' || k === 'IFSC' || k === 'UPI ID' }); });
    if (link) {
      const qx = PW - M - 12 - 140;
      rr(qx, y - 16, 140, ph - 28, 14, { fill: C.white, border: C.line });
      tc('SCAN & PAY', qx + 70, y - 32, { size: 8, bold: true, color: C.indigo });
      page.drawImage(await cv.png(link, 104), { x: qx + 18, y: y - 146, width: 104, height: 104 });
      tc(inrPdf(inv.total), qx + 70, y - 158, { size: 9.5, bold: true }); tc('Any UPI app: amount filled in', qx + 70, y - 169, { size: 6.8, color: C.muted });
    }
    y -= ph + 14;
  }
  if (!['Paid', 'Cancelled'].includes(inv.status)) wrap('Pay only to the account above, in the name of Euroverse Service LLP. La Europa never asks for payment to a personal account.', 7.6, tw)
    .forEach((w2, k) => t(w2, M, y - k * 9.5, { size: 7.6, color: C.muted }));
  await footer(cv, `Thank you for choosing La Europa Education  |  computer-generated ${K.gst ? 'tax invoice' : 'payment request'}: no signature needed`);
  return Buffer.from(await cv.doc.save());
}

export async function receiptPdf(inv: InvoiceRow, pay: { amount: number; payment_date: string; mode: string; reference_no?: string; createdAt?: Date }, H: InvoiceHelpers) {
  const K = H.kindOf(inv);
  const cv = await canvas();
  const { page, PW, M, t, tr, tc, rr, grad, circle, wrap } = cv;
  const tw = PW - 2 * M;
  header(cv, [[C.teal, 0], [C.sky, 0.55], [C.indigo, 1]], 'PAYMENT RECEIPT', `Receipt ${inv.receipt_no}`);
  let y = 841.89 - 104;
  rr(M + 2, y - 3, tw, 150, 18, { fill: [0.85, 0.86, 0.93], opacity: 0.6 }); rr(M, y, tw, 150, 18, { fill: C.white, border: C.line });
  circle(M + 70, y - 75, 44, [0.9, 0.98, 0.95]); circle(M + 70, y - 75, 32, C.green);
  page.drawSvgPath('M -13,0 L -4,10 L 15,-11', { x: M + 70, y: y - 75, borderColor: col(C.white), borderWidth: 5 });
  t('PAYMENT RECEIVED', M + 136, y - 34, { size: 9, bold: true, color: C.green });
  t(inrPdf(pay.amount), M + 136, y - 66, { size: 28, bold: true, color: C.ink });
  wrap(H.words(pay.amount), 9, tw - 150).forEach((l, i) => t(l, M + 136, y - 86 - i * 11, { size: 9, color: C.muted }));
  const first = String(inv.bill_name || '').split(' ')[0];
  t(`Thank you${first ? ', ' + first : ''}! We have received your payment.`, M + 136, y - 122, { size: 10, bold: true, color: C.indigo });
  y -= 168;
  const det: [string, string][] = [['Receipt no.', inv.receipt_no ?? ''], ['Receipt date', fmtDate(pay.payment_date)], ['Student', inv.bill_name ?? ''], ['Student ID', inv.student_code ?? ''],
    [K.gst ? 'Against invoice' : 'Against request', inv.invoice_no], ['Invoice date', fmtDate(inv.invoice_date)], ['Payment mode', pay.mode], ['Reference / UTR', pay.reference_no || '-']];
  const gw = (tw - 12) / 2;
  det.forEach(([k, v], i) => {
    const gx = M + (i % 2) * (gw + 12), gy = y - Math.floor(i / 2) * 46;
    rr(gx, gy, gw, 38, 10, { fill: C.soft, border: C.line }); t(k.toUpperCase(), gx + 12, gy - 14, { size: 6.8, bold: true, color: C.indigo });
    t(wrap(v, 9.5, gw - 24, { bold: true })[0], gx + 12, gy - 29, { size: 9.5, bold: true });
  });
  y -= Math.ceil(det.length / 2) * 46 + 8;
  const forRows: [string, string][] = [['For', inv.description], ...(K.gst ? [['Taxable value', inrPdf(inv.taxable)], [inv.supply_type === 'intra' ? 'CGST 9% + SGST 9%' : 'IGST 18%', inrPdf(inv.cgst + inv.sgst + inv.igst)]] as [string, string][] : [['GST', 'Not applicable']] as [string, string][]),
    [K.gst ? 'Invoice total' : 'Amount due', inrPdf(inv.total)]];
  const fh = forRows.length * 15 + 22;
  rr(M, y, tw, fh, 12, { fill: C.white, border: C.line });
  forRows.forEach(([k, v], i) => { t(k, M + 14, y - 18 - i * 15, { size: 8.8, color: C.muted }); tr(wrap(v, 8.8, tw - 160)[0], PW - M - 14, y - 18 - i * 15, { size: 8.8, bold: i === forRows.length - 1 }); });
  y -= fh + 12;
  if (K.note) { wrap(K.note, 7.6, tw).forEach((l, i) => t(l, M, y - i * 9.5, { size: 7.6, color: [0.25, 0.32, 0.6] })); y -= 30; }
  // invoice -> proof -> confirmed
  const sub = await H.proofDate(inv);
  const iso = (d?: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');
  const steps = [['Invoice raised', fmtDate(inv.invoice_date)], ['Proof uploaded', sub ? fmtDate(iso(sub)) : fmtDate(pay.payment_date)], ['Payment confirmed', fmtDate(iso(inv.paid_at ?? pay.createdAt))]];
  const sx0 = M + 60, sx1 = PW - M - 60, ty = y - 18;
  grad(sx0, ty - 1.5, sx1 - sx0, 3, [[C.teal, 0], [C.sky, 0.5], [C.indigo, 1]], 40);
  steps.forEach(([h, d], i) => { const cx = sx0 + (sx1 - sx0) * i / 2; circle(cx, ty, 9, i === 2 ? C.green : C.sky); circle(cx, ty, 4, C.white); tc(h, cx, ty - 24, { size: 8.5, bold: true }); tc(d, cx, ty - 35, { size: 7.8, color: C.muted }); });
  // know your terms
  const qy = 175;
  t('KNOW YOUR TERMS', M, qy + 14, { size: 7.5, bold: true, color: C.indigo });
  const qrs = [['Terms & Conditions', 'Student Constitution, the rules of our services', `${H.appUrl()}/legal/student-constitution`], ['Refund & Cancellation Policy', 'When fees are refundable and how', `${H.appUrl()}/legal/refund-policy`]];
  for (let i = 0; i < 2; i++) {
    const [h, s, url] = qrs[i];
    const qx = M + i * (gw + 12);
    rr(qx, qy, gw, 96, 14, { fill: C.soft, border: C.line }); rr(qx + 10, qy - 10, 76, 76, 10, { fill: C.white, border: C.line });
    page.drawImage(await cv.png(url, 66), { x: qx + 15, y: qy - 81, width: 66, height: 66 });
    t(h, qx + 98, qy - 30, { size: 9.5, bold: true }); wrap(s, 7.8, gw - 110).forEach((l, k) => t(l, qx + 98, qy - 44 - k * 9.5, { size: 7.8, color: C.muted }));
    t('Scan to read', qx + 98, qy - 76, { size: 7.5, bold: true, color: C.indigo });
  }
  await footer(cv, 'Computer-generated receipt: no signature needed  |  keep it for your records');
  return Buffer.from(await cv.doc.save());
}
export type { PDFFont, PDFPage };
