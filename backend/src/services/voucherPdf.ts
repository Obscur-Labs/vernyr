import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

/** The reward voucher, A4 (legacy/server/voucher.js): a ticket with the reward, student, code and validity, who to redeem with, the terms and La Europa's note. */

export interface VoucherData {
  voucher_code: string; status?: string; issued_on: string; valid_from: string; valid_until: string; student: string; student_code?: string; title: string; reward?: string; promo_code?: string;
  provider: { name?: string; contact?: string; phone?: string; email?: string; address?: string }; terms?: string; note?: string;
}

const LOGO_PNG = (() => {
  for (const p of [path.join(process.cwd(), '..', 'crm', 'public', 'brand', 'vernyr-logo.svg'), path.join(process.cwd(), 'crm', 'public', 'brand', 'vernyr-logo.svg')]) {
    try { const m = fs.readFileSync(p, 'utf8').match(/base64,([A-Za-z0-9+/=]+)/); if (m) return Buffer.from(m[1], 'base64'); } catch { /* try the next place */ }
  }
  return null;
})();
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = { ink: hex('#0B1020'), muted: hex('#5B6478'), line: hex('#E6E8F0'), indigo: hex('#5B56E9'), indigoDark: hex('#3F3AC4'), soft: hex('#EEEDFD'), white: rgb(1, 1, 1), green: hex('#16A34A'), red: hex('#DC2626'), paper: hex('#F7F7FB') };
// the standard PDF fonts only know WinAnsi
const safe = (s: unknown) => String(s ?? '').replace(/₹/g, 'INR ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '');
function wrapW(text: unknown, font: PDFFont, size: number, width: number) {
  const out: string[] = [];
  for (const para of safe(text).split(/\n/)) {
    let cur = '';
    for (const w of para.split(/\s+/).filter(Boolean)) { const t = cur ? cur + ' ' + w : w; if (font.widthOfTextAtSize(t, size) > width && cur) { out.push(cur); cur = w; } else cur = t; }
    out.push(cur);
  }
  return out;
}

export const SAMPLE: VoucherData = {
  voucher_code: 'LEV-7KQ2-M9XD', status: 'Issued', issued_on: '10 Jan 2027', valid_from: '10 Jan 2027', valid_until: '10 Apr 2027', student: 'Riya Shah', student_code: 'LE-S-2026-00012',
  title: 'Free flight ticket: 2 partner universities', reward: 'Free flight ticket to your university city (economy, one way)', promo_code: 'PR-4HX8KD',
  provider: { name: 'SkyWay Travels Pvt Ltd', contact: 'Ms. Anjali Verma', phone: '+91 98765 43210', email: 'offers@skywaytravels.example', address: '2nd Floor, Example Plaza, MG Road, Ahmedabad 380009' },
  terms: '1. Valid only for the student named on this voucher.\n2. Economy class, one way, from India to the city of the university. Dates subject to availability.\n3. Book at least 21 days before travel.',
  note: 'This offer is provided by SkyWay Travels Pvt Ltd. La Europa Education only issues the voucher. The product or service, its terms and conditions, quality and delivery are the responsibility of SkyWay Travels Pvt Ltd. La Europa Education is not responsible for the product or service, or for anything after the voucher is redeemed. The voucher is valid only until the date printed on it, can be used once, and cannot be exchanged for cash or transferred.',
};

export async function voucherPdf(v: VoucherData) {
  const doc = await PDFDocument.create(); doc.setTitle(`Voucher ${v.voucher_code}`); doc.setProducer('La Europa CRM'); doc.setAuthor('La Europa Education');
  const W = 595.28, H = 841.89; const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold), mono = await doc.embedFont(StandardFonts.CourierBold);
  const text = (t: unknown, x: number, y: number, size: number, f = font, color = C.ink) => page.drawText(safe(t), { x, y, size, font: f, color });
  const right = (t: string, xr: number, y: number, size: number, f = font, color = C.ink) => text(t, xr - f.widthOfTextAtSize(safe(t), size), y, size, f, color);
  const M = 42; let y = H - 44;

  if (LOGO_PNG) { const img = await doc.embedPng(LOGO_PNG); const h = 34, w = img.width * h / img.height; page.drawImage(img, { x: M, y: y - h, width: w, height: h }); }
  right('REWARD VOUCHER', W - M, y - 14, 15, bold, C.indigo); right('Issued by La Europa Education', W - M, y - 30, 9, font, C.muted);
  y -= 58;

  // the ticket
  const tH = 250, tY = y - tH, stubW = 176, mainW = W - 2 * M - stubW;
  page.drawRectangle({ x: M, y: tY, width: W - 2 * M, height: tH, color: C.indigo });
  page.drawRectangle({ x: M + mainW, y: tY, width: stubW, height: tH, color: C.white, borderColor: C.indigo, borderWidth: 2 });
  for (let yy = tY + 8; yy < tY + tH - 6; yy += 10) page.drawLine({ start: { x: M + mainW, y: yy }, end: { x: M + mainW, y: yy + 5 }, thickness: 1.2, color: C.white });
  page.drawCircle({ x: M + mainW, y: tY + tH, size: 9, color: C.white }); page.drawCircle({ x: M + mainW, y: tY, size: 9, color: C.white });
  let ty = tY + tH - 30;
  text('YOUR REWARD', M + 22, ty, 9, bold, hex('#C9C7FA')); ty -= 26;
  for (const l of wrapW(v.reward || v.title, bold, 21, mainW - 44).slice(0, 4)) { text(l, M + 22, ty, 21, bold, C.white); ty -= 26; }
  ty -= 4; for (const l of wrapW(v.title, font, 10.5, mainW - 44).slice(0, 2)) { text(l, M + 22, ty, 10.5, font, hex('#DCDAFC')); ty -= 14; }
  text('ISSUED TO', M + 22, tY + 52, 8.5, bold, hex('#C9C7FA'));
  text(v.student, M + 22, tY + 32, 17, bold, C.white);
  if (v.student_code) text(v.student_code, M + 22, tY + 17, 9, font, hex('#DCDAFC'));
  const sx = M + mainW + 16, sw = stubW - 32; let sy = tY + tH - 28;
  text('VOUCHER CODE', sx, sy, 8.5, bold, C.muted); sy -= 22;
  const cs = Math.min(16, 16 * sw / mono.widthOfTextAtSize(v.voucher_code, 16)); text(v.voucher_code, sx, sy, cs, mono, C.indigoDark); sy -= 24;
  const qr = await QRCode.toBuffer(`La Europa voucher ${v.voucher_code}`, { margin: 0, width: 300, errorCorrectionLevel: 'M', color: { dark: '#0B1020', light: '#FFFFFF' } });
  page.drawImage(await doc.embedPng(qr), { x: sx + (sw - 78) / 2, y: sy - 78, width: 78, height: 78 }); sy -= 96;
  text('VALID UNTIL', sx, sy, 8.5, bold, C.muted); sy -= 17; text(v.valid_until, sx, sy, 14, bold, C.ink); sy -= 15;
  text(`from ${v.valid_from}`, sx, sy, 8.5, font, C.muted);
  y = tY - 22;

  if (v.status && v.status !== 'Issued') {
    page.drawRectangle({ x: M, y: y - 22, width: W - 2 * M, height: 24, color: v.status === 'Redeemed' ? C.green : C.red });
    text(`${v.status.toUpperCase()}: this voucher can no longer be used`, M + 12, y - 15, 10.5, bold, C.white); y -= 36;
  }

  // redeem with | voucher details
  const colW = (W - 2 * M - 16) / 2, boxTop = y, boxH = 150;
  const box = (x: number, title: string) => { page.drawRectangle({ x, y: boxTop - boxH, width: colW, height: boxH, color: C.paper, borderColor: C.line, borderWidth: 1 }); text(title, x + 14, boxTop - 22, 9, bold, C.indigo); };
  box(M, 'REDEEM WITH'); box(M + colW + 16, 'VOUCHER DETAILS');
  const p = v.provider || {}; let ry = boxTop - 42;
  for (const l of wrapW(p.name, bold, 12.5, colW - 28).slice(0, 2)) { text(l, M + 14, ry, 12.5, bold); ry -= 16; }
  ry -= 2;
  for (const [k, val] of ([['Contact', p.contact], ['Mobile', p.phone], ['Email', p.email], ['Address', p.address]] as [string, string | undefined][]).filter((r) => r[1])) {
    text(k, M + 14, ry, 8.5, font, C.muted);
    const ls = wrapW(val, font, 9.5, colW - 84).slice(0, 3);
    ls.forEach((l, i) => text(l, M + 70, ry - i * 12, 9.5, i ? font : k === 'Mobile' ? bold : font)); ry -= 12 * ls.length + 5;
  }
  let dy = boxTop - 42; const dx = M + colW + 30;
  for (const [k, val] of [['Offer', v.title], ['Offer code', v.promo_code], ['Issued on', v.issued_on], ['Valid', `${v.valid_from} to ${v.valid_until}`], ['Status', v.status || 'Issued']]) {
    text(k, dx, dy, 8.5, font, C.muted);
    const ls = wrapW(val, font, 9.5, colW - 96).slice(0, 2);
    ls.forEach((l, i) => text(l, dx + 66, dy - i * 12, 9.5, k === 'Status' ? bold : font)); dy -= 12 * ls.length + 7;
  }
  y = boxTop - boxH - 22;

  text('HOW TO REDEEM', M, y, 9, bold, C.indigo); y -= 15;
  for (const s of [`1. Contact ${p.contact || 'the provider'} at ${p.name || 'the provider'} before ${v.valid_until}.`, '2. Show this voucher (printed or on your phone) and a photo ID with the same name.',
    '3. The provider checks the code and gives the product or service under its own terms.']) for (const l of wrapW(s, font, 9.5, W - 2 * M)) { text(l, M, y, 9.5, font); y -= 13; }
  y -= 10;

  text('TERMS AND CONDITIONS', M, y, 9, bold, C.indigo); y -= 14;
  const termsLines = wrapW(v.terms || '', font, 8.5, W - 2 * M);
  const noteLines = wrapW(v.note || '', font, 8.5, W - 2 * M - 24);
  const room = Math.max(0, Math.floor((y - 72 - (noteLines.length * 11 + 34)) / 11));
  for (const l of termsLines.slice(0, room)) { text(l, M, y, 8.5, font, C.ink); y -= 11; }
  if (termsLines.length > room) { text('Full terms: on your La Europa portal, Offers page.', M, y, 8.5, font, C.muted); y -= 11; }
  y -= 8;
  const nh = noteLines.length * 11 + 26;
  page.drawRectangle({ x: M, y: y - nh, width: W - 2 * M, height: nh, color: C.soft });
  page.drawRectangle({ x: M, y: y - nh, width: 3, height: nh, color: C.indigo });
  text('Please note', M + 12, y - 15, 9, bold, C.indigoDark); let ny = y - 28;
  for (const l of noteLines) { text(l, M + 12, ny, 8.5, font, C.ink); ny -= 11; }

  page.drawLine({ start: { x: M, y: 50 }, end: { x: W - M, y: 50 }, thickness: 0.8, color: C.line });
  text('Euroverse Service LLP, trading as La Europa Education', M, 36, 8.5, font, C.muted);
  right(`Voucher ${v.voucher_code}`, W - M, 36, 8.5, font, C.muted);
  return Buffer.from(await doc.save());
}
