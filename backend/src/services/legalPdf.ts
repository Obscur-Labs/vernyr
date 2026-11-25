import fs from 'fs';
import path from 'path';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';
import { parse, plain } from './legalMd';

/** A4 PDF of a legal text in the small markdown of legalMd.ts (legacy/server/legal/pdf.js): website downloads and the signed, locked Student Declaration & Consent. */

export const W = (s: unknown) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/₹/g, 'INR ').replace(/[^\x20-\x7E\xA0-\xFF€\n]/g, '?');
const NAVY = rgb(0.357, 0.337, 0.914), INK = rgb(0.043, 0.063, 0.125), GREY = rgb(0.357, 0.392, 0.471), LINE = rgb(0.902, 0.91, 0.941);
const LOGO_PNG = (() => { try { const m = fs.readFileSync(path.join(__dirname, '..', '..', 'legal', 'vernyr-logo.svg'), 'utf8').match(/base64,([A-Za-z0-9+/=]+)/); return m ? Buffer.from(m[1], 'base64') : null; } catch { return null; } })();
export const PW = 595.28, PH = 841.89, M = 50;
const BOTTOM = 60;

export interface Writer { doc: PDFDocument; font: PDFFont; bold: PDFFont; sig?: PDFFont; page: PDFPage; y: number; newPage: () => void; need: (h: number) => void }
type Run = { t: string; b: boolean };
type Word = { t?: string; b?: boolean; gap?: boolean; sp?: boolean; br?: boolean };

export async function create(meta: { title: string; subject?: string; keywords?: string[]; date?: Date; band?: string; watermark?: string; bottom?: number }) {
  const doc = await PDFDocument.create();
  doc.setTitle(W(meta.title)); doc.setAuthor('Euroverse Service LLP (La Europa Education)'); doc.setProducer('La Europa CRM'); doc.setCreator('La Europa CRM');
  if (meta.subject) doc.setSubject(W(meta.subject));
  if (meta.keywords) doc.setKeywords(meta.keywords.map(W));
  if (meta.date) { doc.setCreationDate(meta.date); doc.setModificationDate(meta.date); }
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo: PDFImage | null = LOGO_PNG ? await doc.embedPng(LOGO_PNG) : null;
  const w = { doc, font, bold, y: 0 } as Writer;
  w.newPage = () => {
    w.page = doc.addPage([PW, PH]);
    const top = PH - 22;
    let x = M;
    if (logo) { const h = 34, lw = logo.width * h / logo.height; w.page.drawImage(logo, { x, y: top - h, width: lw, height: h }); x += lw + 10; }
    w.page.drawLine({ start: { x, y: top - 4 }, end: { x, y: top - 30 }, thickness: 0.8, color: LINE }); x += 10;
    w.page.drawText('La Europa Education', { x, y: top - 22, size: 12.5, font: bold, color: INK });
    if (meta.band) { const s = W(meta.band); w.page.drawText(s, { x: PW - M - font.widthOfTextAtSize(s, 8.5), y: top - 15, size: 8.5, font, color: GREY }); }
    if (meta.watermark) { const s = W(meta.watermark); w.page.drawText(s, { x: PW - M - bold.widthOfTextAtSize(s, 8), y: top - 28, size: 8, font: bold, color: rgb(0.06, 0.46, 0.43) }); }
    w.page.drawLine({ start: { x: M, y: top - 42 }, end: { x: PW - M, y: top - 42 }, thickness: 0.6, color: LINE });
    w.y = top - 66;
  };
  const bottom = meta.bottom ?? BOTTOM;
  w.need = (h) => { if (w.y - h < bottom) w.newPage(); };
  w.newPage();
  return w;
}

function layout(w: Writer, runs: Run[], size: number, maxW: number) {
  const words: Word[] = [];
  for (const r of runs) for (const part of W(r.t).split(/(\n)/)) {
    if (part === '\n') { words.push({ br: true }); continue; }
    // only normal spaces split words: no-break spaces keep the empty consent box together
    for (const tok of part.split(/([ \t\r]+)/)) if (tok && !/^[ \t\r]+$/.test(tok)) words.push({ t: tok, b: r.b, gap: words.length > 0 && !!words[words.length - 1].sp }); else if (tok && words.length) words[words.length - 1].sp = true;
  }
  const lines: Word[][] = [];
  let line: Word[] = [], lw = 0;
  const wd = (x: Word) => (x.b ? w.bold : w.font).widthOfTextAtSize(x.t!, size);
  const spW = w.font.widthOfTextAtSize(' ', size);
  for (const x of words) {
    if (x.br) { lines.push(line); line = []; lw = 0; continue; }
    const add = (line.length && x.gap ? spW : 0) + wd(x);
    if (lw + add > maxW && line.length) {
      // never break inside a word made of several pieces: move the whole word down
      let k = line.length - 1;
      while (k > 0 && !line[k].gap) k--;
      if (!x.gap && k > 0) { const moved = line.splice(k); lines.push(line); line = [...moved, x]; lw = line.reduce((s, y, i) => s + (i && y.gap ? spW : 0) + wd(y), 0); }
      else { lines.push(line); line = [x]; lw = wd(x); }
    } else { line.push(x); lw += add; }
  }
  if (line.length) lines.push(line);
  return lines;
}
const runsOf = (s: string): Run[] => String(s).split('**').map((t, i) => ({ t, b: i % 2 === 1 })).filter((r) => r.t);
export function rich(w: Writer, text: string | Run[], o: { size?: number; indent?: number; right?: number; bold?: boolean; color?: ReturnType<typeof rgb>; keep?: number } = {}) {
  const size = o.size ?? 9.2, x0 = M + (o.indent ?? 0), maxW = PW - M - x0 - (o.right ?? 0);
  const lines = layout(w, typeof text === 'string' ? runsOf(text) : text, size, maxW);
  const lh = size * 1.42;
  if (o.keep) w.need(Math.min(lines.length, 3) * lh + o.keep);
  for (const ln of lines) {
    w.need(lh);
    let x = x0;
    for (const [i, r] of ln.entries()) { const f = r.b || o.bold ? w.bold : w.font; if (i && r.gap) x += w.font.widthOfTextAtSize(' ', size); w.page.drawText(r.t!, { x, y: w.y, size, font: f, color: o.color ?? INK }); x += f.widthOfTextAtSize(r.t!, size); }
    w.y -= lh;
  }
}
export function heading(w: Writer, text: string, level: number) {
  const size = level <= 1 ? 16 : level === 2 ? 13.5 : level === 3 ? 11.2 : 10;
  w.need(size * 1.4 + 40); w.y -= level <= 2 ? 10 : 6;
  rich(w, plain(text), { size, bold: true, color: NAVY });
  if (level <= 2) w.page.drawLine({ start: { x: M, y: w.y + size * 0.5 }, end: { x: PW - M, y: w.y + size * 0.5 }, thickness: 0.6, color: LINE });
  w.y -= 3;
}
export function box(w: Writer, rows: [string, string | { bold: string }][], o: { size?: number; kw?: number; title?: string } = {}) {
  const size = o.size ?? 8.4, lh = size * 1.4, kw = o.kw ?? 150;
  const runs = (v: unknown): Run[] => (v && typeof v === 'object' ? [{ t: String((v as { bold: string }).bold), b: true }] : [{ t: String(v ?? '-'), b: false }]);
  const prepared = rows.map(([k, v]) => [k, layout(w, runs(v), size, PW - 2 * M - kw - 12)] as const);
  const hh = prepared.reduce((a, [, l]) => a + l.length * lh + 2, 0) + 14;
  if (hh < PH - 200) w.need(hh + (o.title ? 44 : 0));
  if (o.title) heading(w, o.title, 3);
  let top: number | null = w.y + lh - 2;
  const start = w.page;
  for (const [k, lines] of prepared) {
    w.need(lines.length * lh + 2);
    if (w.page !== start) top = null;
    w.page.drawText(W(k), { x: M + 6, y: w.y, size, font: w.bold, color: INK });
    lines.forEach((ln, i) => { let x = M + kw; for (const [j, r] of ln.entries()) { const f = r.b ? w.bold : w.font; if (j && r.gap) x += w.font.widthOfTextAtSize(' ', size); w.page.drawText(r.t!, { x, y: w.y - i * lh, size, font: f, color: INK }); x += f.widthOfTextAtSize(r.t!, size); } });
    w.y -= lines.length * lh + 2;
  }
  if (top !== null) w.page.drawRectangle({ x: M - 2, y: w.y + lh - 6, width: PW - 2 * M + 4, height: top - w.y - lh + 10, borderColor: LINE, borderWidth: 0.7 });
  w.y -= 10;
}
/** opt.checks fills the consent boxes. */
export function markdown(w: Writer, md: string, opt: { checks?: Record<string, boolean>; levelShift?: number } = {}) {
  for (const b of parse(md)) {
    if (b.k === 'h') heading(w, b.text, b.level - (opt.levelShift ?? 0));
    else if (b.k === 'p') { rich(w, b.text); w.y -= 4.5; }
    else if (b.k === 'li') { rich(w, [{ t: '- ', b: false }, ...runsOf(b.text)], { indent: 12 + b.level * 12 }); w.y -= 2; }
    else if (b.k === 'check') { const on = opt.checks ? !!opt.checks[b.key ?? ''] : false; rich(w, [{ t: (on ? '[ X ]' : '[    ]') + ' ', b: true }, ...runsOf(b.text)], { indent: 4 }); w.y -= 5; }
    else { for (const [i, r] of b.rows.entries()) rich(w, r.map((c, j) => ({ t: (j ? '  |  ' : '') + plain(c), b: i === 0 }))); w.y -= 4; }
  }
}
// the signature name: Times bold italic (the client's fallback when the handwriting font is not installed)
export async function sigFont(w: Writer) { if (!w.sig) w.sig = await w.doc.embedFont(StandardFonts.TimesRomanBoldItalic); return w.sig; }
const SIG_INK = rgb(0.11, 0.2, 0.55), SEAL = rgb(0.06, 0.46, 0.43), SOFT = rgb(0.973, 0.976, 0.992);
const rr = (p: PDFPage, x: number, y: number, wd: number, ht: number, r: number, o: Record<string, unknown>) =>
  p.drawSvgPath(`M ${r} 0 H ${wd - r} Q ${wd} 0 ${wd} ${r} V ${ht - r} Q ${wd} ${ht} ${wd - r} ${ht} H ${r} Q 0 ${ht} 0 ${ht - r} V ${r} Q 0 0 ${r} 0 Z`, { x, y: y + ht, ...o });
function fitSize(font: PDFFont, text: string, max: number, size: number) { while (size > 8 && font.widthOfTextAtSize(text, size) > max) size -= 0.5; return size; }
function seal(p: PDFPage, cx: number, cy: number, r: number) {
  p.drawCircle({ x: cx, y: cy, size: r, color: SEAL });
  p.drawCircle({ x: cx, y: cy, size: r - 2.6, borderColor: rgb(1, 1, 1), borderWidth: 0.7 });
  p.drawSvgPath(`M ${-r * 0.42} 0 L ${-r * 0.12} ${r * 0.32} L ${r * 0.44} ${-r * 0.3}`, { x: cx, y: cy + r * 0.04, borderColor: rgb(1, 1, 1), borderWidth: Math.max(1.8, r * 0.16) });
}
/** "e-Signed by", the name, a rule, date and method, document ID, and a seal. */
export function signatureCard(p: PDFPage, w: Writer, at: { x: number; y: number; width: number; height: number }, d: { label?: string; name: string; nameSize?: number; lines?: string[] }) {
  const { x, y, width, height } = at;
  rr(p, x, y, width, height, 7, { color: SOFT, borderColor: rgb(0.78, 0.8, 0.93), borderWidth: 0.8 });
  p.drawRectangle({ x: x + 0.4, y: y + 7, width: 2.6, height: height - 14, color: SIG_INK });
  const pad = 12, sealR = Math.min(17, height * 0.3), textW = width - pad * 2 - sealR * 2 - 8;
  p.drawText(W(d.label ?? 'e-Signed by'), { x: x + pad, y: y + height - 13, size: 6.6, font: w.bold, color: GREY });
  const name = W(d.name);
  const nameSize = fitSize(w.sig!, name, textW, d.nameSize ?? 21);
  p.drawText(name, { x: x + pad, y: y + height - 13 - nameSize * 0.95, size: nameSize, font: w.sig!, color: SIG_INK });
  const ruleY = y + height - 17 - nameSize * 1.12;
  p.drawLine({ start: { x: x + pad, y: ruleY }, end: { x: x + pad + textW, y: ruleY }, thickness: 0.5, color: rgb(0.7, 0.72, 0.82) });
  (d.lines ?? []).forEach((t, k) => {
    const s = W(t), f = k === 0 ? w.bold : w.font;
    let size = 6.6;
    while (f.widthOfTextAtSize(s, size) > textW && size > 5.4) size -= 0.2;
    p.drawText(s, { x: x + pad, y: ruleY - 9 - k * 8.4, size, font: f, color: k === 0 ? INK : GREY });
  });
  seal(p, x + width - pad - sealR, y + height / 2, sealR);
}
/** Footer and page numbers on every page. */
export function finishDoc(w: Writer, footer: string) {
  const pages = w.doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 40 }, end: { x: PW - M, y: 40 }, thickness: 0.4, color: LINE });
    p.drawText(W(footer), { x: M, y: 28, size: 7, font: w.font, color: GREY });
    const pg = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pg, { x: PW - M - w.font.widthOfTextAtSize(pg, 7), y: 28, size: 7, font: w.font, color: GREY });
  });
  return w.doc;
}
/** The plain download of one website document (not signed). */
export async function documentPdf(d: { title: string; version: string; body: string; body_hash: string }) {
  const w = await create({ title: `${d.title} v${d.version}`, band: `${d.title}, version ${d.version}` });
  markdown(w, d.body);
  return Buffer.from(await finishDoc(w, `${d.title}, version ${d.version} | SHA-256 ${String(d.body_hash).slice(0, 16)} | Euroverse Service LLP (La Europa Education), LLPIN ACY-5677`).save({ useObjectStreams: false }));
}
export { GREY };
export const finish = async (w: Writer, footer: string) => Buffer.from(await finishDoc(w, footer).save({ useObjectStreams: false }));
