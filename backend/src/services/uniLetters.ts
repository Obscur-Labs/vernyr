import { Router, type Response } from 'express';
import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFPage, type PDFFont } from 'pdf-lib';
import Course from '../models/Course';
import { Application, FeeSummary } from '../models/Work';
import { Country, Intake } from '../models/Master';
import { OfferCondition } from '../models/Portal';
import { nextCode } from '../models/Timeline';
import { UniAction, UniLetterSettings, UniStudentItem, UniversityApplication } from '../models/Partner';
import type { UniRequest } from '../middleware/university';
import { upload } from '../middleware/upload';
import { signedFileUrl, uploadBuffer, destroyAsset } from '../config/cloudinary';
import { HttpError, bad, clean, fieldErr, fullName, handle, isEmail, istDate, num } from './crm';
import { fmtDate } from './invoicePdf';
import { checkFile } from './files';
import * as P from './partner';

/** The client's university letters (legacy/server/university/letters.js): official letterhead PDFs in 5 formats, settings, 1-click documents. Nothing of La Europa on them. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
export const FORMATS = [
  { id: 1, name: 'Classic formal', note: 'Logo in the centre, serif letter, double rule. Traditional university letter.' },
  { id: 2, name: 'Modern header band', note: 'Coloured band with logo and contact details, clean sans-serif.' },
  { id: 3, name: 'European with reference block', note: 'Logo left, address right, reference block (student ID, date) on the right.' },
  { id: 4, name: 'Compact one-page summary', note: 'Short letter with a key-facts box. Good for quick offers.' },
  { id: 5, name: 'Detailed with terms and acceptance slip', note: 'Full terms and conditions and a slip for the student to sign.' }];
export const DOCS: Record<string, string> = { offer_conditional: 'Conditional offer letter', offer_unconditional: 'Unconditional offer letter', loa: 'Final Letter of Acceptance (LOA)', invoice: 'Tuition fee invoice', receipt: 'Fee payment receipt' };

export async function settingsOf(universityId: unknown): Promise<Any> {
  const s = (await UniLetterSettings.findOne({ university_id: universityId }).lean()) as Any;
  return s ?? { university_id: universityId, default_format: 1, currency: 'EUR', offer_validity_days: 21, other_fees: [] };
}
const W = (s: unknown) => String(s ?? '').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\u20b9/g, 'INR ').replace(/[^\x20-\x7E\xA0-\xFF\u20ac\n]/g, '');
const hex = (h: unknown, d: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); const v = m ? m[1] : d; return rgb(parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255); };
export const money = (n: unknown, c?: string) => `${(Math.round(Number(n || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c || ''}`.trim();
async function embed(doc: PDFDocument, url?: string | null, publicId?: string | null): Promise<PDFImage | null> {
  try {
    const u = url ? signedFileUrl(url, publicId ?? undefined, 'image') || url : null; if (!u) return null;
    const r = await fetch(u); if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return b[0] === 0x89 ? await doc.embedPng(b) : await doc.embedJpg(b);
  } catch { return null; }
}
async function placeOf(uni: Any) { const c = uni.country_id ? ((await Country.findById(uni.country_id).select('name').lean()) as Any) : null; return [uni.city, c?.name].filter(Boolean).join(', '); }

type Block = { h?: string; p?: string; size?: number; box?: [string, string][]; table?: { cols: [string, number][]; rows: string[][]; totals?: [string, string, boolean?][] } };
type Letter = { uni: Any; set: Any; format?: number; badge?: string; title: string; refs: [string, string][]; to?: string[]; blocks: Block[]; closing?: string | null; terms?: string | null; slip?: boolean; compact?: boolean; noSign?: boolean; studentName?: string };

/** the layout engine */
export async function render(d: Letter): Promise<Buffer> {
  const f = Math.min(5, Math.max(1, Number(d.format) || 1));
  const doc = await PDFDocument.create(); doc.setTitle(W(d.title)); doc.setProducer(W(d.uni.name)); doc.setCreator(W(d.uni.name)); doc.setAuthor(W(d.set.legal_name || d.uni.name));
  const serif = [1, 3].includes(f);
  const R = await doc.embedFont(serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica); const B = await doc.embedFont(serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold);
  const I = await doc.embedFont(serif ? StandardFonts.TimesRomanItalic : StandardFonts.HelveticaOblique);
  const accent = hex(d.set.accent, ['1f3a5f', '0f4c81', '7a1f2b', '0b6e4f', '3b2f6b'][f - 1]);
  const ink = rgb(0.1, 0.1, 0.1), grey = rgb(0.42, 0.42, 0.42), light = rgb(0.95, 0.96, 0.98);
  const logo = d.set.logo?.url ? await embed(doc, d.set.logo.url, d.set.logo.public_id) : await embed(doc, d.uni.logo_url, d.uni.logo_public_id);
  const sig = await embed(doc, d.set.signature?.url, d.set.signature?.public_id); const stamp = await embed(doc, d.set.stamp?.url, d.set.stamp?.public_id);
  const PW = 595.28, PH = 841.89, M = 54, BOT = d.compact ? 56 : 70; const name = d.set.legal_name || d.uni.name;
  const contact = [d.set.phone && `Tel ${d.set.phone}`, d.set.email, d.set.website].filter(Boolean).join('  |  ');
  const addr = d.set.address || (await placeOf(d.uni));
  let page!: PDFPage; let y = 0; const pages: PDFPage[] = [];
  const t = (s: unknown, x: number, yy: number, o: { size?: number; b?: boolean; i?: boolean; c?: ReturnType<typeof rgb> } = {}) => page.drawText(W(s), { x, y: yy, size: o.size || 10, font: o.b ? B : o.i ? I : R, color: o.c || ink });
  const wid = (s: unknown, size: number, b?: boolean) => (b ? B : R).widthOfTextAtSize(W(s), size);
  const wrap = (s: unknown, size: number, maxW: number, b?: boolean) => { const out: string[] = []; for (const para of W(s).split('\n')) { let line = ''; for (const w of para.split(/\s+/)) { const tt = line ? line + ' ' + w : w; if (wid(tt, size, b) > maxW && line) { out.push(line); line = w; } else line = tt; } out.push(line); } return out; };
  const fitImg = (img: PDFImage, maxW: number, maxH: number) => { const s = Math.min(maxW / img.width, maxH / img.height); return { width: img.width * s, height: img.height * s }; };
  const header = (first: boolean) => {
    page = doc.addPage([PW, PH]); pages.push(page);
    if (f === 1) {
      let top = PH - 40; if (logo) { const z = fitImg(logo, 140, first ? (d.compact ? 42 : 62) : 40); page.drawImage(logo, { x: (PW - z.width) / 2, y: top - z.height, ...z }); top -= z.height + 8; }
      t(name, (PW - wid(name, 15, true)) / 2, top - 14, { b: true, size: 15, c: accent }); top -= 28;
      if (first) { for (const l of [addr, contact].filter(Boolean)) { t(l, (PW - wid(l, 8.5)) / 2, top, { size: 8.5, c: grey }); top -= 11; } }
      page.drawLine({ start: { x: M, y: top }, end: { x: PW - M, y: top }, thickness: 1.2, color: accent }); page.drawLine({ start: { x: M, y: top - 3 }, end: { x: PW - M, y: top - 3 }, thickness: 0.4, color: accent });
      y = top - 24;
    } else if (f === 2 || f === 5) {
      const h = first ? 92 : 56;
      if (f === 2) page.drawRectangle({ x: 0, y: PH - h, width: PW, height: h, color: accent }); else page.drawRectangle({ x: 0, y: PH - 6, width: PW, height: 6, color: accent });
      const onBand = f === 2 ? rgb(1, 1, 1) : accent;
      let lx = M; if (logo) { const z = fitImg(logo, 110, h - 26); if (f === 2) page.drawRectangle({ x: M - 6, y: PH - h / 2 - z.height / 2 - 6, width: z.width + 12, height: z.height + 12, color: rgb(1, 1, 1) });
        const lxPos = f === 5 ? PW - M - z.width : M; page.drawImage(logo, { x: lxPos, y: PH - h / 2 - z.height / 2, ...z }); if (f === 2) lx = M + z.width + 20; }
      t(name, lx, PH - (first ? 40 : 32), { b: true, size: first ? 16 : 12, c: onBand });
      if (first) { t(addr, lx, PH - 56, { size: 8.5, c: f === 2 ? rgb(0.88, 0.92, 0.97) : grey }); if (contact) t(contact, lx, PH - 68, { size: 8.5, c: f === 2 ? rgb(0.88, 0.92, 0.97) : grey }); }
      y = PH - h - 28;
    } else if (f === 3) {
      let top = PH - 44; let lh = 0; if (logo) { const z = fitImg(logo, 120, first ? 58 : 38); page.drawImage(logo, { x: M, y: top - z.height, ...z }); lh = z.height; }
      const lines = first ? [name, ...wrap(addr, 8.5, 210), ...(contact ? contact.split('  |  ') : [])] : [name];
      lines.forEach((l, i) => t(l, PW - M - wid(l, i ? 8.5 : 12, !i), top - 10 - i * 12, { b: !i, size: i ? 8.5 : 12, c: i ? grey : accent }));
      top -= Math.max(lh, lines.length * 12 + 4) + 12; page.drawLine({ start: { x: M, y: top }, end: { x: PW - M, y: top }, thickness: 0.8, color: accent }); y = top - 22;
    } else {
      page.drawRectangle({ x: 0, y: 0, width: 10, height: PH, color: accent });
      let lx = M; if (logo) { const z = fitImg(logo, 70, first ? 46 : 32); page.drawImage(logo, { x: M, y: PH - 40 - z.height, ...z }); lx = M + z.width + 14; }
      t(name, lx, PH - 56, { b: true, size: first ? 14 : 11, c: accent }); if (first) wrap([addr, contact].filter(Boolean).join('  |  '), 8, PW - M - lx).slice(0, 2).forEach((l, k) => t(l, lx, PH - 70 - k * 10, { size: 8, c: grey }));
      y = PH - 104;
    }
  };
  const need = (h: number) => { if (y - h < BOT) header(false); };
  const para = (s: string, o: { size?: number; ind?: number; b?: boolean; i?: boolean; c?: ReturnType<typeof rgb> } = {}) => { const size = o.size || 10.2; for (const l of wrap(s, size, PW - 2 * M - (o.ind || 0), o.b)) { need(size + 4); t(l, M + (o.ind || 0), y, { size, b: o.b, i: o.i, c: o.c }); y -= size + 4.2; } };
  const kvs = (rows: [string, string][], size = 9.6, x0 = M, labW = 150) => { for (const [k, v] of rows) { const ls = wrap(v, size, PW - M - x0 - labW); need(ls.length * (size + 4)); t(k, x0, y, { size, b: true }); ls.forEach((l, i) => t(l, x0 + labW, y - i * (size + 4), { size })); y -= ls.length * (size + 4) + 1.5; } };

  header(true);
  if (f === 3) { const rx = PW - M - 200; const top = y; let ry = y; for (const [k, v] of d.refs) { t(k, rx, ry, { size: 8.5, c: grey }); t(v, rx + 90, ry, { size: 8.5, b: true }); ry -= 12; }
    let ty = top; for (const l of d.to || []) { t(l, M, ty, { size: 10 }); ty -= 13; } y = Math.min(ry, ty) - 14; }
  else { for (const [k, v] of d.refs) { t(`${k}: `, M, y, { size: 9, c: grey }); t(v, M + wid(`${k}: `, 9), y, { size: 9, b: true }); y -= 12.5; } y -= 6; if ((d.to || []).length) { for (const l of d.to!) { t(l, M, y, { size: 10 }); y -= 13; } y -= 6; } }
  y -= 4; need(30);
  if (f === 1) { const tt = d.title.toUpperCase(); t(tt, (PW - wid(tt, 13, true)) / 2, y, { b: true, size: 13, c: accent }); y -= 10; page.drawLine({ start: { x: (PW - wid(tt, 13, true)) / 2, y }, end: { x: (PW + wid(tt, 13, true)) / 2, y }, thickness: 0.6, color: accent }); y -= 18; }
  else if (f === 4) { page.drawRectangle({ x: M - 8, y: y - 8, width: PW - 2 * M + 16, height: 26, color: light }); t(d.title, M, y, { b: true, size: 13, c: accent }); y -= 32; }
  else { t(d.title, M, y, { b: true, size: 14, c: accent }); y -= 10; if (d.badge && f !== 3) { const bw = wid(d.badge, 8, true) + 14; page.drawRectangle({ x: PW - M - bw, y: y + 4, width: bw, height: 16, color: accent }); t(d.badge, PW - M - bw + 7, y + 9, { b: true, size: 8, c: rgb(1, 1, 1) }); } y -= 16; }
  const firstBox = d.blocks.find((x) => x.box)?.box;
  for (const b of d.blocks) {
    if (b.h) { need(b.box ? Math.min(260, (d.compact ? Math.ceil(b.box.length / 2) : b.box.length) * 14.5 + 44) : b.table ? 80 : 60); y -= 4; t(b.h, M, y, { b: true, size: 11, c: accent }); y -= 5; if (f !== 4) page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.4, color: rgb(0.8, 0.82, 0.86) }); y -= 12; }
    if (b.p) for (const p of String(b.p).split(/\n{2,}/)) { para(p, { size: b.size }); y -= 5; }
    let box = b.box;
    if (box && d.compact && box === firstBox) box = box.filter(([k]) => k !== 'Student name');
    if (box && d.compact) {
      const half = (PW - 2 * M) / 2; const rows: [string, string][][] = []; for (let i = 0; i < box.length; i += 2) rows.push([box[i], box[i + 1]].filter(Boolean));
      const lines = rows.map((r) => Math.max(...r.map(([, v]) => wrap(v, 9, half - 98).length)));
      const h0 = lines.reduce((s, n) => s + n * 12.4 + 2, 0) + 14; need(h0);
      page.drawRectangle({ x: M - 8, y: y - h0 + 14, width: PW - 2 * M + 16, height: h0, color: light, borderColor: rgb(0.84, 0.86, 0.9), borderWidth: 0.6 }); y -= 2;
      rows.forEach((r, i) => { r.forEach((c, j) => { const x0 = M + j * half; t(c[0], x0, y, { size: 8.6, b: true }); wrap(c[1], 9, half - 98).forEach((l, k) => t(l, x0 + 92, y - k * 12.4, { size: 9 })); }); y -= lines[i] * 12.4 + 2; });
      y -= 10; continue;
    }
    if (box) { const h0 = box.reduce((s, [, v]) => s + wrap(v, 9.4, PW - 2 * M - 170).length * 13.4 + 1.5, 0) + 16; need(h0); page.drawRectangle({ x: M - 8, y: y - h0 + 14, width: PW - 2 * M + 16, height: h0, color: light, borderColor: rgb(0.84, 0.86, 0.9), borderWidth: 0.6 }); y -= 2; kvs(box, 9.4, M, 170); y -= 10; }
    if (b.table) {
      const cols = b.table.cols; const head = () => { need(20); page.drawRectangle({ x: M, y: y - 5, width: PW - 2 * M, height: 17, color: f === 2 || f === 5 ? accent : light }); let x = M; for (const [c, w] of cols) { t(c, x + 4, y, { b: true, size: 8.6, c: f === 2 || f === 5 ? rgb(1, 1, 1) : ink }); x += w; } y -= 19; };
      head();
      for (const r of b.table.rows) { const cells = r.map((v, i) => wrap(v, 9, cols[i][1] - 8)); const h1 = Math.max(...cells.map((c) => c.length)) * 12 + 4; if (y - h1 < BOT) { header(false); head(); }
        let x = M; cells.forEach((ls, i) => { ls.forEach((l, k) => t(l, x + 4, y - k * 12, { size: 9 })); x += cols[i][1]; }); y -= h1; page.drawLine({ start: { x: M, y: y + 8 }, end: { x: PW - M, y: y + 8 }, thickness: 0.3, color: rgb(0.85, 0.85, 0.85) }); }
      for (const [k, v, strong] of b.table.totals || []) { need(15); t(k, PW - M - 250, y, { b: strong !== false, size: 9.6 }); t(v, PW - M - wid(v, 9.6, true) - 4, y, { b: true, size: 9.6 }); y -= 14; }
      y -= 8;
    }
  }
  if (d.closing) { y -= 2; para(d.closing); }
  if (!d.noSign) {
    need(d.compact ? 90 : 120); y -= d.compact ? 4 : 10; t(serif ? 'Yours sincerely,' : 'Sincerely,', M, y, { size: 10 }); y -= 8;
    const sy = y;
    if (sig) { const z = fitImg(sig, 150, 46); page.drawImage(sig, { x: M, y: sy - z.height, ...z }); y = sy - z.height - 4; } else y -= 34;
    if (stamp) { const z = fitImg(stamp, 92, 92); page.drawImage(stamp, { x: M + 175, y: sy - z.height + 6, ...z, opacity: 0.9 }); }
    t(d.set.signatory_name || 'Admissions Office', M, y - 4, { b: true, size: 10.4 }); y -= 17; t(d.set.signatory_designation || 'Admissions Office', M, y, { size: 9.6, c: grey }); y -= 12; t(name, M, y, { size: 9.6, c: grey }); y -= 22;
  }
  if (d.terms) { need(40); t('Terms and conditions', M, y, { b: true, size: 10.5, c: accent }); y -= 14; for (const p of String(d.terms).split(/\n+/)) para(p, { size: 8.6 }); y -= 6; }
  if (d.slip) { need(110); page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.6, color: grey, dashArray: [4, 3] }); y -= 16; t('ACCEPTANCE BY THE STUDENT (keep a copy and return this part)', M, y, { b: true, size: 9.5 }); y -= 16;
    para(`I, ${d.studentName}, accept the offer above and its conditions.`, { size: 9.4 }); y -= 18; t('Signature: ______________________________          Date: ________________', M, y, { size: 9.4 }); y -= 18; }
  const foot = d.set.footer_text || [name, addr, d.set.registration].filter(Boolean).join('  |  ');
  const footFont: PDFFont = R;
  pages.forEach((p, i) => { p.drawLine({ start: { x: M, y: 46 }, end: { x: PW - M, y: 46 }, thickness: 0.4, color: rgb(0.8, 0.8, 0.8) });
    const o: string[] = []; let line = ''; for (const w of W(foot).split(/\s+/)) { const tt = line ? line + ' ' + w : w; if (footFont.widthOfTextAtSize(tt, 7.2) > PW - 2 * M - 60 && line) { o.push(line); line = w; } else line = tt; } o.push(line);
    o.slice(0, 2).forEach((l, k) => p.drawText(l, { x: M, y: 34 - k * 9, size: 7.2, font: R, color: grey })); p.drawText(W(`Page ${i + 1} of ${pages.length}`), { x: PW - M - 50, y: 34, size: 7.2, font: R, color: grey }); });
  return Buffer.from(await doc.save());
}

// ---------- document content ----------
async function student(ua: Any) {
  const v = (await P.appView(ua, { detail: true })) as Any; const i = v.identity || {};
  return { v, name: v.student_name, first: i.first_name || String(v.student_name || '').split(' ')[0], dob: i.dob, nationality: i.nationality, passport: i.passport, city: [i.city, i.state, i.country].filter(Boolean).join(', ') };
}
type St = Any;
const bankRows = (set: Any) => ([['Bank', set.bank_name], ['Account name', set.bank_account_name || set.legal_name], ['Account number', set.bank_account_no], ['IBAN', set.bank_iban], ['SWIFT / BIC', set.bank_swift], ['Bank address', set.bank_address]] as [string, string][]).filter((r) => r[1]);
const payReference = (set: Any, sid: string, appRef?: string) => (set.bank_note || 'Please quote the student ID and full name as the payment reference.').replace(/\{student_id\}/g, sid || appRef || '');
export async function build(kind: string, ctx: { uni: Any; set: Any; ua: Any; b: Any; no?: string; student?: Any }) {
  const { uni, set, ua, b } = ctx; const st: St = ctx.student || (await student(ua)); const fmt = b.format || set.default_format || 1;
  const cur = b.currency || set.currency || 'EUR'; const sid = clean(b.student_uni_id, 50) || ua.student_uni_id || ua.university_ref || '';
  const course = st.v.course; const intake = st.v.intake; const today = fmtDate(b.issue_date || istDate());
  const refs: [string, string][] = [['Date', today], ...(sid ? [['Student ID', sid] as [string, string]] : []), ...(ua.university_ref && ua.university_ref !== sid ? [['Our reference', ua.university_ref] as [string, string]] : [])];
  const to = [st.name, ...(st.city ? [st.city] : [])];
  const fd = (x: unknown) => (x ? fmtDate(String(x instanceof Date ? x.toISOString() : x)) : '-');
  const studentBox: [string, string][] = [['Student name', st.name], ['Student ID', sid || '-'], ['Date of birth', fd(st.dob)], ['Nationality', st.nationality || '-'], ...(st.passport ? [['Passport number', st.passport] as [string, string]] : []),
    ['Programme', course], ['Level', st.v.level || '-'], ['Intake', intake || '-'], ...(b.programme_start ? [['Programme start', fd(b.programme_start)] as [string, string]] : []), ...(b.programme_end ? [['Expected end', fd(b.programme_end)] as [string, string]] : []),
    ...(b.duration ? [['Duration', b.duration] as [string, string]] : []), ...(b.campus || st.v.campus ? [['Campus', b.campus || st.v.campus] as [string, string]] : [])];
  const deadline = b.acceptance_deadline || new Date(Date.now() + (Number(set.offer_validity_days) || 21) * 864e5).toISOString().slice(0, 10);
  const fees: Any[] = set.other_fees || [];
  if (kind === 'offer_conditional' || kind === 'offer_unconditional') {
    const cond = kind === 'offer_conditional';
    const conds = (Array.isArray(b.conditions) ? b.conditions : []).filter((c: Any) => c && clean(c.text));
    const feeRows: string[][] = [['Tuition fee (first year)', money(b.tuition ?? set.tuition_default, cur)], ...fees.filter((x) => x && x.label).map((x) => [x.label, money(x.amount, cur)]), ...(num(b.scholarship) ? [['Scholarship / waiver', '- ' + money(b.scholarship, cur)]] : [])];
    const total = (num(b.tuition ?? set.tuition_default) || 0) + fees.reduce((s, x) => s + (num(x.amount) || 0), 0) - (num(b.scholarship) || 0);
    const dep = num(b.deposit ?? set.deposit_default);
    return render({ uni, set, format: fmt, badge: cond ? 'CONDITIONAL' : 'UNCONDITIONAL', title: `${cond ? 'Conditional' : 'Unconditional'} Offer of Admission`, refs, to, studentName: st.name,
      blocks: [{ p: `Dear ${st.first},\n\nWe are pleased to inform you that you have been ${cond ? 'made a conditional offer of' : 'offered'} admission to the following programme at ${set.legal_name || uni.name}${cond ? ', subject to the conditions set out below' : ''}.` },
        ...(fmt === 4 ? [{ box: [['Programme', course], ['Intake', intake || '-'], ['Student ID', sid || '-'], ['Tuition (first year)', money(total, cur)], ['Accept by', fd(deadline)]] as [string, string][] }] : [{ h: 'Student and programme details', box: studentBox }]),
        { h: 'Tuition and fees', table: { cols: [['Item', 330], ['Amount', 157]], rows: feeRows, totals: [['Total for the first year', money(total, cur)]] } },
        ...(dep ? [{ p: `A deposit of ${money(dep, cur)} is required to confirm your place${b.deposit_deadline ? ` by ${fd(b.deposit_deadline)}` : ''}.` }] : []),
        ...(cond ? [{ h: 'Conditions of this offer', table: { cols: [['#', 28], ['Condition', 339], ['Due by', 120]] as [string, number][], rows: conds.map((c: Any, i: number) => [String(i + 1), clean(c.text, 500)!, c.due ? fd(c.due) : '-']) } }] : []),
        ...(bankRows(set).length && (dep || fmt === 5) ? [{ h: 'Payment details', box: [...bankRows(set), ['Payment reference', payReference(set, sid, ua.university_ref)]] as [string, string][] }] : []),
        { h: 'Acceptance', p: `Please confirm your acceptance of this offer by ${fd(deadline)}.${cond ? ' Once all conditions are met, an unconditional offer will be issued.' : ' After payment of the deposit you will receive your final Letter of Acceptance.'}${clean(b.scholarship_text) ? `\n\nScholarship: ${clean(b.scholarship_text, 300)}` : ''}${clean(b.letter_note) ? `\n\n${clean(b.letter_note, 2000)}` : ''}` }],
      closing: `We congratulate you on your ${cond ? 'conditional ' : ''}offer and look forward to welcoming you to ${set.legal_name || uni.name}.${set.contact_name ? ` For any questions please contact ${set.contact_name}${set.contact_email ? ' (' + set.contact_email + ')' : ''}.` : ''}`,
      terms: fmt === 5 ? (set.offer_terms || 'This offer is personal and cannot be transferred. It is valid for the intake shown only. The university may withdraw the offer if any information or document provided is found to be incorrect. Fees are subject to the university fee regulations in force. Visa and immigration decisions are made by the competent authorities.') : null, slip: fmt === 5 });
  }
  if (kind === 'loa') {
    const total = num(b.total_fees); const paid = num(b.fees_paid) || 0; const bal = total != null ? Math.max(0, total - paid) : null;
    return render({ uni, set, format: fmt, badge: 'FINAL LOA', title: 'Final Letter of Acceptance', refs, to, studentName: st.name,
      blocks: [{ p: `To whom it may concern,\n\nThis is to confirm that ${st.name}${st.dob ? `, born on ${fd(st.dob)}` : ''}${st.nationality ? `, of ${st.nationality} nationality` : ''}${st.passport ? `, holding passport number ${st.passport}` : ''}, has been granted unconditional admission and has accepted a place at ${set.legal_name || uni.name} for the programme below.` },
        { h: 'Student and programme details', box: studentBox },
        { h: 'Tuition fees', table: { cols: [['Item', 330], ['Amount', 157]], rows: [['Total tuition fee' + (b.fee_period ? ` (${b.fee_period})` : ' (first year)'), money(total, cur)], ['Amount paid', money(paid, cur)], ...(b.payment_date ? [['Last payment received on', fd(b.payment_date)]] : [])],
          totals: bal !== null ? [['Balance due', money(bal, cur)]] : [] } },
        ...(clean(b.accommodation) ? [{ h: 'Accommodation', p: clean(b.accommodation, 500)! }] : []),
        ...(b.reporting_date ? [{ p: `The student is expected to report to the university on ${fd(b.reporting_date)}.` }] : []),
        { h: 'University contact person', box: [['Name', b.contact_name || set.contact_name || set.signatory_name || '-'], ['Designation', b.contact_designation || set.contact_designation || '-'], ['Email', b.contact_email || set.contact_email || set.email || '-'], ['Phone', b.contact_phone || set.contact_phone || set.phone || '-'], ['University address', set.address || (await placeOf(uni))]] },
        { p: `${clean(b.note) || set.loa_note || 'This letter is issued at the request of the student for visa and immigration purposes.'} Should you require any further information, please contact the person named above.` }],
      compact: true });
  }
  if (kind === 'invoice') {
    const items = (Array.isArray(b.items) ? b.items : []).filter((i: Any) => i && clean(i.description));
    const total = items.reduce((s: number, i: Any) => s + (num(i.amount) || 0), 0) - (num(b.scholarship) || 0);
    return render({ uni, set, format: fmt, badge: 'INVOICE', title: 'Tuition Fee Invoice', refs: [['Invoice number', ctx.no || ''], ...refs, ['Due date', fd(b.due_date)]], to, studentName: st.name,
      blocks: [{ h: 'Billed to', box: [['Student name', st.name], ['Student ID', sid || '-'], ['Programme', course], ['Intake', intake || '-']] },
        { h: 'Charges', table: { cols: [['Description', 330], ['Amount', 157]], rows: [...items.map((i: Any) => [clean(i.description, 200)!, money(i.amount, cur)]), ...(num(b.scholarship) ? [['Scholarship / discount', '- ' + money(b.scholarship, cur)]] : [])], totals: [['Total due', money(total, cur)]] } },
        { h: 'How to pay', box: [...(bankRows(set).length ? bankRows(set) : [['Payment', clean(b.bank_details, 500) || 'See the university payment page'] as [string, string]]), ['Payment reference', payReference(set, sid, ua.university_ref)]] },
        ...(clean(b.note) ? [{ p: clean(b.note, 1000)! }] : [])],
      closing: `Please pay by ${fd(b.due_date)}. Payments are accepted only to the account above. A receipt will be issued for every payment.` });
  }
  if (kind === 'receipt') {
    return render({ uni, set, format: fmt, badge: 'RECEIPT', title: 'Fee Payment Receipt', refs: [['Receipt number', ctx.no || ''], ...refs], to, studentName: st.name,
      blocks: [{ p: `Received with thanks from ${st.name}${sid ? ` (student ID ${sid})` : ''} the amount below for the programme ${course}${intake ? ', intake ' + intake : ''}.` },
        { h: 'Payment', box: [['Amount received', money(b.amount, cur)], ['Payment for', clean(b.purpose, 120) || 'Tuition fee'], ['Payment date', fd(b.payment_date)], ['Payment method', clean(b.method, 60) || 'Bank transfer'], ...(clean(b.reference) ? [['Transaction reference', clean(b.reference, 100)!] as [string, string]] : [])] },
        ...(num(b.total_fees) !== null ? [{ h: 'Fee account', table: { cols: [['', 330], ['Amount', 157]] as [string, number][], rows: [['Total fee', money(b.total_fees, cur)], ['Paid to date (including this payment)', money(b.paid_to_date, cur)]], totals: [['Balance', money(Math.max(0, (num(b.total_fees) ?? 0) - (num(b.paid_to_date) ?? 0)), cur)]] as [string, string][] } }] : [])],
      closing: 'This receipt is issued electronically by the university.' });
  }
  throw bad('Unknown document');
}
const asFile = (buf: Buffer, name: string) => ({ buffer: buf, originalname: name, size: buf.length, mimetype: 'application/pdf' } as Express.Multer.File);
const paidSoFar = async (uaId: unknown) => (await UniStudentItem.aggregate([{ $match: { uapp_id: uaId, kind: 'receipt' } }, { $group: { _id: null, s: { $sum: '$amount' } } }]))[0]?.s || 0;

// ---------- 1-click: everything filled automatically ----------
async function ensureStudentId(ua: Any, uni: Any) {
  if (ua.student_uni_id) return ua.student_uni_id as string;
  const short = String(uni.short_name || uni.name || 'UNI').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'UNI';
  const yr = new Date().getFullYear(); const pre = `${short}-${yr}-`;
  let k = (await UniversityApplication.countDocuments({ university_id: ua.university_id, student_uni_id: { $regex: '^' + pre } })) + 1;
  let id = pre + String(k).padStart(4, '0');
  while (await UniversityApplication.exists({ university_id: ua.university_id, student_uni_id: id })) id = pre + String(++k).padStart(4, '0');
  await UniversityApplication.updateOne({ _id: ua._id }, { student_uni_id: id }); ua.student_uni_id = id;
  return id;
}
export async function autoData(ua: Any, uni: Any) {
  const set = await settingsOf(ua.university_id);
  const a = (await Application.findById(ua.application_id).lean()) as Any;
  const course = (a.course_id ? await Course.findById(a.course_id).lean() : null) as Any ?? {};
  const fee = ((await FeeSummary.findOne({ application_id: a._id, fee_kind: 'tuition', is_deleted: false }).sort({ createdAt: -1 }).lean()) as Any) ?? {};
  const act = (await UniAction.findOne({ uapp_id: ua._id, type: { $in: ['conditional_offer', 'unconditional_offer'] } }).sort({ createdAt: -1 }).lean()) as Any;
  const od: Any = act?.data ?? {};
  const pick = (...v: unknown[]) => v.find((x) => x !== null && x !== undefined && x !== '') as any;
  const tuition = num(pick(fee.total_amount, od.tuition, set.tuition_default, course.tuition_fee)) || 0;
  const scholarship = num(pick(fee.scholarship, od.scholarship)) || 0;
  const fees: Any[] = set.other_fees || [];
  const other = fees.reduce((s, x) => s + (num(x.amount) || 0), 0);
  const intake = a.intake_id ? ((await Intake.findById(a.intake_id).select('month year').lean()) as Any) : null;
  const start = pick(od.programme_start, ua.programme_start, intake?.year ? `${intake.year}-${String(intake.month || 9).padStart(2, '0')}-01` : null);
  const dur = String(course.duration || ''); const ym = /(\d+(?:\.\d+)?)\s*year/i.exec(dur); const mm = /(\d+)\s*month/i.exec(dur);
  const months = Number(course.duration_months) || (ym ? Math.round(parseFloat(ym[1]) * 12) : mm ? Number(mm[1]) : null);
  const end = start && months ? (() => { const d = new Date(String(start).slice(0, 10) + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + months); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })() : null;
  const paid = (await paidSoFar(ua._id)) || num(ua.deposit_amount) || 0;
  const conds = ((await OfferCondition.find({ application_id: a._id, is_deleted: false, status: 'Open' }).select('text').lean()) as Any[]).map((c) => ({ text: c.text }));
  const dl = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  return { set, format: set.default_format || 1, currency: pick(fee.currency, od.currency, set.currency, course.currency) || 'EUR', tuition, scholarship, scholarship_text: pick(od.scholarship_text, course.scholarship_text),
    deposit: num(pick(fee.deposit_required, od.deposit, set.deposit_default)), deposit_deadline: pick(fee.deposit_deadline, od.deposit_deadline), conditions: conds.length ? conds : (od.conditions || []),
    acceptance_deadline: pick(a.offer_deadline, od.acceptance_deadline, dl(Number(set.offer_validity_days) || 21)), programme_start: start, programme_end: end, duration: months ? (months % 12 ? `${months} months` : `${months / 12} year${months > 12 ? 's' : ''}`) : null,
    student_uni_id: await ensureStudentId(ua, uni), total_fees: Math.round((tuition + other - scholarship) * 100) / 100, fees_paid: paid, paid_to_date: paid, payment_date: ua.deposit_date || null,
    items: [{ description: 'Tuition fee (first year)', amount: tuition }, ...fees.filter((x) => x && x.label).map((x) => ({ description: x.label, amount: num(x.amount) || 0 }))], due_date: dl(14),
    amount: num(ua.deposit_amount) || null, purpose: ua.deposit_amount ? 'Tuition deposit' : 'Tuition fee', method: 'Bank transfer' };
}
const AFTER_OFFER = ['Conditional offer', 'Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'];
const ANY_OFFER = [...AFTER_OFFER, 'Acknowledged', 'Under assessment', 'Interview scheduled', 'Documents requested', 'New', 'Waitlisted'];
const ONE_CLICK: Record<string, string[]> = { offer_conditional: ANY_OFFER, offer_unconditional: ANY_OFFER, loa: ['Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'], invoice: AFTER_OFFER, receipt: AFTER_OFFER };

/** a generated offer letter, as an upload would be (the "generate" option of the offer actions) */
export async function offerPdfFile(req: UniRequest, ua: Any, b: Any, type: string) {
  const set = await settingsOf(ua.university_id);
  const cond = type === 'conditional_offer' || b.letter_type === 'Conditional';
  if (clean(b.student_uni_id)) await UniversityApplication.updateOne({ _id: ua._id }, { student_uni_id: clean(b.student_uni_id, 50) });
  const fresh = (await UniversityApplication.findById(ua._id).lean()) as Any;
  const buf = await build(cond ? 'offer_conditional' : 'offer_unconditional', { uni: req.uni, set, ua: fresh, b });
  const code = (await Application.findById(ua.application_id).select('application_code').lean())?.application_code || 'application';
  return asFile(buf, `${cond ? 'Conditional' : 'Unconditional'}-offer-letter-${String(fresh.student_uni_id || code).replace(/[^A-Za-z0-9-]/g, '')}.pdf`);
}
/** any document or agreement from typed text, on the university letterhead */
export async function textDocument(req: UniRequest, ua: Any, o: { kind: string; title: string; text: string; format?: number; needs_acceptance?: boolean }) {
  const set = await settingsOf(ua.university_id); const st = await student(ua);
  const sid = ua.student_uni_id || ua.university_ref;
  const buf = await render({ uni: req.uni, set, format: o.format || set.default_format || 1, badge: o.kind === 'agreement' ? 'AGREEMENT' : 'DOCUMENT', title: o.title,
    refs: [['Date', fmtDate(istDate())], ...(sid ? [['Student ID', sid] as [string, string]] : [])], to: [st.name], studentName: st.name, blocks: [{ p: o.text }],
    closing: o.kind === 'agreement' && o.needs_acceptance ? 'The student accepts this agreement online; the typed name, IP address and time of acceptance are recorded.' : null });
  return asFile(buf, `${o.title.replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 60) || 'document'}.pdf`);
}
/** a generated official document (invoice, receipt, LOA, offer): stored in the student's documents, sent to the student, copy for La Europa */
export async function sendGenerated(req: UniRequest, ua: Any, kind: string, b: Any, typeName: string, titleFn: (n: string) => string, itemExtra: Any = {}) {
  const D = await import('../routes/uniDirect');
  const set = await settingsOf(ua.university_id);
  if (clean(b.student_uni_id)) await UniversityApplication.updateOne({ _id: ua._id }, { student_uni_id: clean(b.student_uni_id, 50) });
  const fresh = (await UniversityApplication.findById(ua._id).lean()) as Any;
  const pre = ({ invoice: 'INV', receipt: 'RCPT', loa: 'LOA', offer_conditional: 'OFR', offer_unconditional: 'OFR' } as Record<string, string>)[kind];
  const no = `${String(req.uni.short_name || 'UNI').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()}-${pre}-${(await nextCode(pre)).split('-').pop()}`;
  const buf = await build(kind, { uni: req.uni, set, ua: fresh, b: { currency: set.currency, ...b }, no });
  const { doc, v } = await D.saveDoc(req, ua, asFile(buf, `${titleFn(no).replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, '-')}.pdf`), typeName, titleFn(no));
  const item = await D.addItem(req, ua, { kind: kind.startsWith('offer') ? 'offer_letter' : kind, title: titleFn(no), document_id: doc._id, version_id: v.id, ref_no: no, currency: b.currency || set.currency, ...itemExtra });
  if (kind === 'loa') {
    const { VisaCase } = await import('../models/Work');
    const a = (await Application.findById(ua.application_id).select('student_id').lean()) as Any;
    const vc = await VisaCase.findOne({ student_id: a.student_id, is_open: true, is_deleted: false }).sort({ createdAt: -1 }).select('_id').lean();
    if (vc && !doc.visa_case_id) { doc.visa_case_id = vc._id as never; await doc.save(); }
  }
  await D.fanOut(ua, item, req.uni);
  return { item, no };
}

// ---------- routes (/api/university) ----------
export const router = Router();
const h = (fn: (req: UniRequest, res: Response) => Promise<void>) => handle(fn as never);
const admin = (req: UniRequest) => { if (req.su.uniRole !== 'admin' || req.preview) throw new HttpError(403, 'Only the University Admin can change letter settings.'); };
const sender = (req: UniRequest) => { if (!['admin', 'officer'].includes(String(req.su.uniRole)) || req.preview) throw new HttpError(403, 'Your role does not allow this action.'); };
const SET_FIELDS = ['legal_name', 'address', 'phone', 'email', 'website', 'registration', 'signatory_name', 'signatory_designation', 'accent', 'contact_name', 'contact_designation', 'contact_email', 'contact_phone',
  'bank_name', 'bank_account_name', 'bank_account_no', 'bank_iban', 'bank_swift', 'bank_address', 'bank_note', 'currency', 'offer_terms', 'loa_note', 'footer_text'];
const LONG = ['offer_terms', 'loa_note', 'bank_note', 'footer_text', 'address'];
const setOut = (s: Any) => { const o: Any = { ...s, has_logo: !!s.logo?.url, has_signature: !!s.signature?.url, has_stamp: !!s.stamp?.url }; delete o.logo; delete o.signature; delete o.stamp; delete o._id; delete o.__v; return o; };
const loadUA = async (req: UniRequest, id: string) => (await (await import('../routes/uni')).loadUA(req, id)).toObject() as Any;
const pdf = (res: Response, buf: Buffer, name: string) => { res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${name}"`); res.send(buf); };

router.get('/letters/settings', h(async (req, res) => {
  res.json({ settings: setOut(await settingsOf(req.su.universityId)), formats: FORMATS, docs: DOCS, uni_logo: !!req.uni.logo_url, can_edit: req.su.uniRole === 'admin' && !req.preview });
}));
router.put('/letters/settings', h(async (req, res) => {
  admin(req); const b = req.body ?? {}; const errors: Record<string, string> = {};
  for (const k of ['email', 'contact_email']) if (b[k] && !isEmail(b[k])) errors[k] = 'Enter a valid email';
  for (const k of ['tuition_default', 'deposit_default', 'application_fee']) if (b[k] !== undefined && b[k] !== '' && b[k] !== null && !((num(b[k]) ?? -1) >= 0)) errors[k] = 'Must be 0 or more';
  if (b.accent && !/^#?[0-9a-f]{6}$/i.test(b.accent)) errors.accent = 'Use a colour like #1F3A5F';
  Object.assign(errors, P.feeWordCheck({ offer_terms: b.offer_terms, bank_note: b.bank_note }));
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  const cur = await settingsOf(req.su.universityId);
  const f: Any = {};
  for (const k of SET_FIELDS) f[k] = b[k] !== undefined ? clean(b[k], LONG.includes(k) ? 3000 : 200) : cur[k] ?? null;
  for (const k of ['tuition_default', 'deposit_default', 'application_fee']) f[k] = b[k] !== undefined ? num(b[k]) : cur[k] ?? null;
  f.default_format = Math.min(5, Math.max(1, Number(b.default_format ?? cur.default_format) || 1)); f.offer_validity_days = Math.min(120, Math.max(1, Number(b.offer_validity_days ?? cur.offer_validity_days) || 21));
  f.other_fees = (Array.isArray(b.other_fees) ? b.other_fees : cur.other_fees || []).filter((x: Any) => x && clean(x.label)).map((x: Any) => ({ label: clean(x.label, 100), amount: num(x.amount) || 0 })).slice(0, 10);
  await UniLetterSettings.updateOne({ university_id: req.su.universityId }, { $set: f }, { upsert: true });
  await P.uaudit(req, 'Update', 'LetterSettings', req.su.universityId, 'Letters & bank details saved'); res.json({ ok: true });
}));
const KINDS = ['logo', 'signature', 'stamp'];
router.post('/letters/settings/image/:kind', upload.single('file'), h(async (req, res) => {
  admin(req); const kind = req.params.kind; if (!KINDS.includes(kind)) throw P.NotFound();
  if (!req.file) throw bad('Choose an image (PNG or JPG)');
  const { ext } = checkFile(req.file, ['png', 'jpg', 'jpeg'], 3);
  const old = ((await settingsOf(req.su.universityId)) as Any)[kind];
  const asset = await uploadBuffer({ ...req.file, originalname: `${kind}-${Date.now()}.${ext}` } as Express.Multer.File, `university/${req.su.universityId}/letterhead`);
  await UniLetterSettings.updateOne({ university_id: req.su.universityId }, { $set: { [kind]: { url: asset.url, public_id: asset.publicId } } }, { upsert: true });
  if (old?.public_id) await destroyAsset(old.public_id, 'image').catch(() => {});
  await P.uaudit(req, 'Update', 'LetterSettings', req.su.universityId, `${kind} image uploaded (${ext})`); res.json({ ok: true });
}));
router.delete('/letters/settings/image/:kind', h(async (req, res) => {
  admin(req); const kind = req.params.kind; if (!KINDS.includes(kind)) throw P.NotFound();
  const old = ((await settingsOf(req.su.universityId)) as Any)[kind];
  await UniLetterSettings.updateOne({ university_id: req.su.universityId }, { $unset: { [kind]: 1 } });
  if (old?.public_id) await destroyAsset(old.public_id, 'image').catch(() => {});
  res.json({ ok: true });
}));
router.get('/letters/settings/image/:kind', h(async (req, res) => {
  const kind = req.params.kind; const s = ((await settingsOf(req.su.universityId)) as Any)[kind];
  if (!KINDS.includes(kind) || !s?.url) throw P.NotFound();
  res.json({ url: signedFileUrl(s.url, s.public_id, 'image') || s.url });
}));
/** any document in any format with a sample student (nothing is saved or sent) */
router.get('/letters/preview/:doc', h(async (req, res) => {
  const doc = req.params.doc; if (!DOCS[doc]) throw P.NotFound();
  const set = await settingsOf(req.su.universityId);
  const fake = { student_uni_id: 'S-2027-0042', university_ref: 'ADM-2027-118' };
  const sample = { v: { student_name: 'Riya Shah (sample)', course: 'MSc Management', level: 'Master', intake: 'Sep 2027', campus: null }, name: 'Riya Shah (sample)', first: 'Riya', dob: '2000-05-14', nationality: 'Indian', passport: 'A1234567', city: 'Ahmedabad, Gujarat, India' };
  const dl = new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10);
  const tu = set.tuition_default ?? 12000, dep = set.deposit_default ?? 2500;
  const b = { format: Number(req.query.format) || set.default_format || 1, tuition: tu, deposit: dep, scholarship: 1000, scholarship_text: 'Merit scholarship', currency: set.currency || 'EUR', acceptance_deadline: dl, deposit_deadline: dl,
    programme_start: '2027-09-15', programme_end: '2029-07-31', duration: '2 years', conditions: [{ text: 'Final degree certificate and transcript', due: '2027-07-31' }, { text: 'IELTS 6.5 overall', due: '2027-06-30' }],
    total_fees: tu, fees_paid: dep, payment_date: istDate(), reporting_date: '2027-09-08', items: [{ description: 'Tuition fee (first year)', amount: tu }], due_date: dl,
    amount: dep, purpose: 'Tuition deposit', method: 'Bank transfer', reference: 'TRX-889201', paid_to_date: dep };
  pdf(res, await build(doc, { uni: req.uni, set, ua: fake, b, student: sample, no: doc === 'invoice' ? 'INV-SAMPLE-001' : 'RCPT-SAMPLE-001' }), `sample-${doc}-format-${b.format}.pdf`);
}));
/** 1-click: what can be generated now, preview (not saved) and send (saved, sent to the student, copy for La Europa) */
router.get('/applications/:id/docs', h(async (req, res) => {
  const ua = await loadUA(req, req.params.id); const d = await autoData(ua, req.uni);
  const sent = (await UniStudentItem.find({ uapp_id: ua._id, kind: { $in: ['offer_letter', 'loa', 'invoice', 'receipt'] } }).sort({ createdAt: -1 }).select('kind title createdAt').lean()) as Any[];
  res.json({ format: d.format, formats: FORMATS, student_uni_id: d.student_uni_id, can_send: ['admin', 'officer'].includes(String(req.su.uniRole)) && !req.preview,
    settings_ok: !!(d.set.signatory_name && (d.set.bank_iban || d.set.bank_account_no)), has_signature: !!d.set.signature?.url,
    docs: Object.entries(DOCS).map(([k, label]) => ({ key: k, label, ready: ONE_CLICK[k].includes(ua.status), needs_amount: k === 'receipt' && !d.amount,
      last: sent.find((x) => x.kind === (k.startsWith('offer') ? 'offer_letter' : k) && (!k.startsWith('offer') || String(x.title || '').toLowerCase().startsWith(k === 'offer_conditional' ? 'conditional' : 'unconditional')))?.createdAt ?? null })),
    summary: { tuition: d.tuition, scholarship: d.scholarship, deposit: d.deposit, currency: d.currency, total_fees: d.total_fees, paid: d.fees_paid, programme_start: d.programme_start, conditions: d.conditions.length } });
}));
router.get('/applications/:id/docs/:doc/preview', h(async (req, res) => {
  const doc = req.params.doc; if (!DOCS[doc]) throw P.NotFound();
  const ua = await loadUA(req, req.params.id); const d = await autoData(ua, req.uni);
  const amt = num(req.query.amount);
  const b: Any = { ...d, format: Number(req.query.format) || d.format, ...(amt ? { amount: amt, paid_to_date: d.paid_to_date + amt, payment_date: istDate() } : {}) };
  if (doc === 'receipt' && !b.amount) throw bad('Enter the amount received for the receipt');
  if (doc === 'receipt' && !b.payment_date) b.payment_date = istDate();
  pdf(res, await build(doc, { uni: req.uni, set: d.set, ua, b, no: ['invoice', 'receipt'].includes(doc) ? 'DRAFT' : undefined }), `preview-${doc}.pdf`);
}));
router.post('/applications/:id/docs/:doc/send', h(async (req, res) => {
  const kind = req.params.doc; if (!DOCS[kind]) throw P.NotFound();
  sender(req);
  const ua = await loadUA(req, req.params.id);
  if (!ONE_CLICK[kind].includes(ua.status)) throw bad(kind === 'loa' ? 'The final LOA can be issued after an unconditional offer.' : 'This document can be issued after an offer.');
  const d = await autoData(ua, req.uni);
  const b: Any = { ...d, format: Number(req.body?.format) || d.format };
  if (kind === 'receipt') {
    const amt = num(req.body?.amount) || d.amount; if (!amt || amt <= 0) throw fieldErr('amount', 'Enter the amount received');
    b.amount = amt; b.paid_to_date = Math.round(((await paidSoFar(ua._id)) + amt) * 100) / 100; b.payment_date = req.body?.payment_date || (num(req.body?.amount) ? istDate() : ua.deposit_date) || istDate();
  }
  if (kind === 'offer_conditional' && !b.conditions.length) b.conditions = [{ text: 'Submission of final academic documents' }];
  const map: Record<string, [string, (n: string) => string, Any]> = { offer_conditional: ['Offer letter', (n) => `Conditional offer letter ${n}`, {}], offer_unconditional: ['Offer letter', (n) => `Unconditional offer letter ${n}`, {}],
    loa: ['Acceptance letter for visa', (n) => `Final Letter of Acceptance ${n}`, { amount: d.fees_paid }], invoice: ['Tuition fee invoice', (n) => `Tuition fee invoice ${n}`, { amount: Math.round(d.total_fees * 100) / 100, due_date: d.due_date }],
    receipt: ['University receipt', (n) => `Fee payment receipt ${n}`, { amount: b.amount }] };
  const [typeName, titleFn, extra] = map[kind];
  const out = await sendGenerated(req, ua, kind, b, typeName, titleFn, extra);
  if (kind.startsWith('offer')) { const { OfferLetter } = await import('../models/Partner'); await OfferLetter.create({ uapp_id: ua._id, application_id: ua.application_id, type: kind === 'offer_conditional' ? 'Conditional' : 'Unconditional', document_id: out.item.document_id, version_id: out.item.version_id, issue_date: istDate() }); }
  await P.uaudit(req, 'Create', 'UniversityLetter', ua._id, `${DOCS[kind]} ${out.no} (1-click)`);
  res.json({ ok: true, no: out.no, id: String(out.item._id) });
}));

// ---------- direct documents: invoice, receipt, LOA with the university's own values ----------
router.get('/applications/:id/student/defaults', h(async (req, res) => {
  const ua = await loadUA(req, req.params.id); const set = await settingsOf(ua.university_id);
  const a = (await Application.findById(ua.application_id).select('course_id').lean()) as Any; const course = a?.course_id ? ((await Course.findById(a.course_id).select('tuition_fee currency').lean()) as Any) : null;
  res.json({ format: set.default_format || 1, currency: set.currency || course?.currency || 'EUR', tuition: set.tuition_default ?? course?.tuition_fee ?? null, deposit: set.deposit_default ?? null, other_fees: set.other_fees || [],
    student_uni_id: ua.student_uni_id || '', paid_to_date: await paidSoFar(ua._id), has_bank: !!(set.bank_iban || set.bank_account_no), has_signature: !!set.signature?.url,
    contact: { name: set.contact_name, designation: set.contact_designation, email: set.contact_email, phone: set.contact_phone }, validity_days: set.offer_validity_days || 21, formats: FORMATS });
}));
router.post('/applications/:id/student/invoice', h(async (req, res) => {
  sender(req); const ua = await loadUA(req, req.params.id);
  if (!AFTER_OFFER.includes(ua.status)) throw bad('A tuition fee invoice can be sent after an offer.');
  const b = req.body ?? {}; const items = (Array.isArray(b.items) ? b.items : []).filter((i: Any) => i && clean(i.description) && num(i.amount) !== null);
  const errors: Record<string, string> = {};
  if (!items.length) errors.items = 'Add at least one line with an amount';
  if (items.some((i: Any) => (num(i.amount) ?? 0) < 0)) errors.items = 'Amounts must be 0 or more';
  if (!b.due_date || b.due_date < istDate()) errors.due_date = 'Due date is required (today or later)';
  Object.assign(errors, P.feeWordCheck({ note: b.note }));
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  const total = items.reduce((t: number, i: Any) => t + (num(i.amount) ?? 0), 0) - (num(b.scholarship) || 0);
  const { no, item } = await sendGenerated(req, ua, 'invoice', { ...b, items }, 'Tuition fee invoice', (n) => `Tuition fee invoice ${n}`, { amount: Math.round(total * 100) / 100, due_date: b.due_date });
  await P.uaudit(req, 'Create', 'TuitionInvoice', ua._id, `${no} ${money(total, b.currency)}`);
  res.json({ ok: true, id: String(item._id), invoice_no: no });
}));
router.post('/applications/:id/student/receipt', h(async (req, res) => {
  sender(req); const ua = await loadUA(req, req.params.id);
  if (!AFTER_OFFER.includes(ua.status)) throw bad('A payment receipt can be issued after an offer.');
  const b: Any = { ...(req.body ?? {}) }; const errors: Record<string, string> = {};
  if (!((num(b.amount) ?? 0) > 0)) errors.amount = 'Amount received is required';
  if (!b.payment_date || b.payment_date > istDate()) errors.payment_date = 'Payment date is required and cannot be in the future';
  if (b.total_fees !== undefined && b.total_fees !== '' && !((num(b.total_fees) ?? -1) >= 0)) errors.total_fees = 'Must be 0 or more';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  b.paid_to_date = Math.round(((await paidSoFar(ua._id)) + (num(b.amount) ?? 0)) * 100) / 100; if (b.total_fees === '') delete b.total_fees;
  const { no, item } = await sendGenerated(req, ua, 'receipt', b, 'University receipt', (n) => `Fee payment receipt ${n}`, { amount: num(b.amount) });
  await P.uaudit(req, 'Create', 'FeeReceipt', ua._id, `${no} ${money(b.amount, b.currency)}`);
  res.json({ ok: true, id: String(item._id), receipt_no: no, paid_to_date: b.paid_to_date });
}));
router.post('/applications/:id/student/loa', h(async (req, res) => {
  sender(req); const ua = await loadUA(req, req.params.id);
  if (!['Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'].includes(ua.status)) throw bad('The final LOA can be issued after an unconditional offer.');
  const b: Any = { ...(req.body ?? {}) }; const errors: Record<string, string> = {};
  if (!clean(b.student_uni_id) && !ua.student_uni_id) errors.student_uni_id = 'Student ID is required on the LOA';
  if (!b.programme_start) errors.programme_start = 'Programme start date is required';
  if (!((num(b.total_fees) ?? -1) >= 0)) errors.total_fees = 'Total tuition fee is required';
  if (b.fees_paid !== undefined && b.fees_paid !== '' && !((num(b.fees_paid) ?? -1) >= 0)) errors.fees_paid = 'Must be 0 or more';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  if (b.fees_paid === undefined || b.fees_paid === '') b.fees_paid = await paidSoFar(ua._id);
  const { no, item } = await sendGenerated(req, ua, 'loa', b, 'Acceptance letter for visa', (n) => `Final Letter of Acceptance ${n}`, { amount: num(b.fees_paid) });
  await P.uaudit(req, 'Create', 'FinalLOA', ua._id, no);
  res.json({ ok: true, id: String(item._id), loa_no: no });
}));
void fullName;
