'use strict';
const VAULT = require('../vault'); // files are stored AES-256-GCM encrypted
// Official university letters (Nov 2026). Every document is on the UNIVERSITY's own letterhead: its logo, address, signatory, signature and stamp,
// bank details and fee defaults are filled in ONCE (Letters & bank details) and saved. Nothing of La Europa appears on these documents.
// Documents: conditional offer, unconditional offer, final Letter of Acceptance (LOA, for the visa), tuition fee invoice, fee payment receipt.
// 5 formats (layouts); the university picks a default and can choose another per letter.
const fs = require('fs');
const path = require('path');
const express = require('express');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { db, all, get, run, insert, uuid, now, nextCode, DATA_DIR } = require('../db');
const U = require('../util');
const { bad, ah, clean, num, fmtDate, fieldErr, HttpError } = U;
const files = require('../files');
const C = require('./common');
const W = require('./pdf').W;

db.exec(`CREATE TABLE IF NOT EXISTS uni_letter_settings (university_id TEXT PRIMARY KEY, legal_name TEXT, address TEXT, phone TEXT, email TEXT, website TEXT, registration TEXT,
  signatory_name TEXT, signatory_designation TEXT, signature_key TEXT, stamp_key TEXT, logo_key TEXT, accent TEXT, default_format INTEGER DEFAULT 1,
  contact_name TEXT, contact_designation TEXT, contact_email TEXT, contact_phone TEXT,
  bank_name TEXT, bank_account_name TEXT, bank_account_no TEXT, bank_iban TEXT, bank_swift TEXT, bank_address TEXT, bank_note TEXT,
  currency TEXT DEFAULT 'EUR', tuition_default REAL, deposit_default REAL, application_fee REAL, other_fees_json TEXT, offer_validity_days INTEGER DEFAULT 21,
  offer_terms TEXT, loa_note TEXT, footer_text TEXT, updated_by TEXT, updated_at TEXT);`);
const IMG_DIR = path.join(DATA_DIR, 'storage', 'letterhead'); fs.mkdirSync(IMG_DIR, { recursive: true });
const LOGO_DIR = path.join(DATA_DIR, 'storage', 'logos');

const FORMATS = [
  { id: 1, name: 'Classic formal', note: 'Logo in the centre, serif letter, double rule. Traditional university letter.' },
  { id: 2, name: 'Modern header band', note: 'Coloured band with logo and contact details, clean sans-serif.' },
  { id: 3, name: 'European with reference block', note: 'Logo left, address right, reference block (student ID, date) on the right.' },
  { id: 4, name: 'Compact one-page summary', note: 'Short letter with a key-facts box. Good for quick offers.' },
  { id: 5, name: 'Detailed with terms and acceptance slip', note: 'Full terms and conditions and a slip for the student to sign.' }];
const DOCS = { offer_conditional: 'Conditional offer letter', offer_unconditional: 'Unconditional offer letter', loa: 'Final Letter of Acceptance (LOA)', invoice: 'Tuition fee invoice', receipt: 'Fee payment receipt' };

function settingsOf(universityId) {
  const s = get('SELECT * FROM uni_letter_settings WHERE university_id = ?', universityId) || { university_id: universityId, default_format: 1, currency: 'EUR', offer_validity_days: 21 };
  return { ...s, other_fees: C.parseJ(s.other_fees_json, []) };
}
const hex = (h, d) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); const v = m ? m[1] : d; return rgb(parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255); };
const money = (n, c) => `${(Math.round(Number(n || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c || ''}`.trim();
async function embed(doc, p) {
  try { if (!p || !fs.existsSync(p)) return null; const b = VAULT.read(p); return b[0] === 0x89 ? await doc.embedPng(b) : await doc.embedJpg(b); } catch { return null; }
}

// ---------- the layout engine ----------
// d = { uni, set, format, badge, title, refs: [[k,v]], to: [lines], blocks: [{ h, p, table: {cols, rows, totals}, box: [[k,v]] }], closing, signoff: bool, terms, slip: bool }
async function render(d) {
  const f = Math.min(5, Math.max(1, Number(d.format) || 1));
  const doc = await PDFDocument.create(); doc.setTitle(W(d.title)); doc.setProducer(W(d.uni.name)); doc.setCreator(W(d.uni.name)); doc.setAuthor(W(d.set.legal_name || d.uni.name));
  const serif = [1, 3].includes(f);
  const R = await doc.embedFont(serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica); const B = await doc.embedFont(serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold);
  const I = await doc.embedFont(serif ? StandardFonts.TimesRomanItalic : StandardFonts.HelveticaOblique);
  const accent = hex(d.set.accent, ['1f3a5f', '0f4c81', '7a1f2b', '0b6e4f', '3b2f6b'][f - 1]);
  const ink = rgb(0.1, 0.1, 0.1), grey = rgb(0.42, 0.42, 0.42), light = rgb(0.95, 0.96, 0.98);
  const logo = await embed(doc, d.set.logo_key ? path.join(IMG_DIR, d.set.logo_key) : (d.uni.logo_key ? path.join(LOGO_DIR, d.uni.logo_key) : null));
  const sig = await embed(doc, d.set.signature_key && path.join(IMG_DIR, d.set.signature_key)); const stamp = await embed(doc, d.set.stamp_key && path.join(IMG_DIR, d.set.stamp_key));
  const PW = 595.28, PH = 841.89, M = 54, BOT = d.compact ? 56 : 70; const name = d.set.legal_name || d.uni.name;
  const contact = [d.set.phone && `Tel ${d.set.phone}`, d.set.email, d.set.website].filter(Boolean).join('  |  ');
  const addr = d.set.address || [d.uni.city, U.masterName(d.uni.country_id)].filter(Boolean).join(', ');
  let page, y; const pages = [];
  const t = (s, x, yy, o = {}) => page.drawText(W(s), { x, y: yy, size: o.size || 10, font: o.b ? B : o.i ? I : R, color: o.c || ink });
  const wid = (s, size, b) => (b ? B : R).widthOfTextAtSize(W(s), size);
  const wrap = (s, size, maxW, b) => { const out = []; for (const para of W(String(s ?? '')).split('\n')) { let line = ''; for (const w of para.split(/\s+/)) { const tt = line ? line + ' ' + w : w; if (wid(tt, size, b) > maxW && line) { out.push(line); line = w; } else line = tt; } out.push(line); } return out; };
  const fitImg = (img, maxW, maxH) => { const s = Math.min(maxW / img.width, maxH / img.height); return { width: img.width * s, height: img.height * s }; };
  const header = (first) => {
    page = doc.addPage([PW, PH]); pages.push(page);
    if (f === 1) { // classic: centred
      let top = PH - 40; if (logo) { const z = fitImg(logo, 140, first ? (d.compact ? 42 : 62) : 40); page.drawImage(logo, { x: (PW - z.width) / 2, y: top - z.height, ...z }); top -= z.height + 8; }
      t(name, (PW - wid(name, 15, true)) / 2, top - 14, { b: true, size: 15, c: accent }); top -= 28;
      if (first) { for (const l of [addr, contact].filter(Boolean)) { t(l, (PW - wid(l, 8.5)) / 2, top, { size: 8.5, c: grey }); top -= 11; } }
      page.drawLine({ start: { x: M, y: top }, end: { x: PW - M, y: top }, thickness: 1.2, color: accent }); page.drawLine({ start: { x: M, y: top - 3 }, end: { x: PW - M, y: top - 3 }, thickness: 0.4, color: accent });
      y = top - 24;
    } else if (f === 2 || f === 5) { // band (2) or light rule (5)
      const h = first ? 92 : 56;
      if (f === 2) page.drawRectangle({ x: 0, y: PH - h, width: PW, height: h, color: accent }); else page.drawRectangle({ x: 0, y: PH - 6, width: PW, height: 6, color: accent });
      const onBand = f === 2 ? rgb(1, 1, 1) : accent;
      let lx = M; if (logo) { const z = fitImg(logo, 110, h - 26); if (f === 2) page.drawRectangle({ x: M - 6, y: PH - h / 2 - z.height / 2 - 6, width: z.width + 12, height: z.height + 12, color: rgb(1, 1, 1) });
        const lxPos = f === 5 ? PW - M - z.width : M; page.drawImage(logo, { x: lxPos, y: PH - h / 2 - z.height / 2, ...z }); if (f === 2) lx = M + z.width + 20; }
      t(name, lx, PH - (first ? 40 : 32), { b: true, size: first ? 16 : 12, c: onBand });
      if (first) { t(addr, lx, PH - 56, { size: 8.5, c: f === 2 ? rgb(0.88, 0.92, 0.97) : grey }); if (contact) t(contact, lx, PH - 68, { size: 8.5, c: f === 2 ? rgb(0.88, 0.92, 0.97) : grey }); }
      y = PH - h - 28;
    } else if (f === 3) { // european
      let top = PH - 44; let lh = 0; if (logo) { const z = fitImg(logo, 120, first ? 58 : 38); page.drawImage(logo, { x: M, y: top - z.height, ...z }); lh = z.height; }
      const lines = first ? [name, ...wrap(addr, 8.5, 210), ...(contact ? contact.split('  |  ') : [])] : [name];
      lines.forEach((l, i) => t(l, PW - M - wid(l, i ? 8.5 : 12, !i), top - 10 - i * 12, { b: !i, size: i ? 8.5 : 12, c: i ? grey : accent }));
      top -= Math.max(lh, lines.length * 12 + 4) + 12; page.drawLine({ start: { x: M, y: top }, end: { x: PW - M, y: top }, thickness: 0.8, color: accent }); y = top - 22;
    } else { // 4 compact: vertical accent bar
      page.drawRectangle({ x: 0, y: 0, width: 10, height: PH, color: accent });
      let lx = M; if (logo) { const z = fitImg(logo, 70, first ? 46 : 32); page.drawImage(logo, { x: M, y: PH - 40 - z.height, ...z }); lx = M + z.width + 14; }
      t(name, lx, PH - 56, { b: true, size: first ? 14 : 11, c: accent }); if (first) wrap([addr, contact].filter(Boolean).join('  |  '), 8, PW - M - lx).slice(0, 2).forEach((l, k) => t(l, lx, PH - 70 - k * 10, { size: 8, c: grey }));
      y = PH - 104;
    }
  };
  const need = (h) => { if (y - h < BOT) header(false); };
  const para = (s, o = {}) => { const size = o.size || 10.2; for (const l of wrap(s, size, PW - 2 * M - (o.ind || 0), o.b)) { need(size + 4); t(l, M + (o.ind || 0), y, { size, b: o.b, i: o.i, c: o.c }); y -= size + 4.2; } };
  const kvs = (rows, size = 9.6, x0 = M, labW = 150) => { for (const [k, v] of rows) { const ls = wrap(v, size, PW - M - x0 - labW); need(ls.length * (size + 4)); t(k, x0, y, { size, b: true }); ls.forEach((l, i) => t(l, x0 + labW, y - i * (size + 4), { size })); y -= ls.length * (size + 4) + 1.5; } };

  header(true);
  // date / references
  if (f === 3) { const rx = PW - M - 200; const top = y; let ry = y; for (const [k, v] of d.refs) { t(k, rx, ry, { size: 8.5, c: grey }); t(v, rx + 90, ry, { size: 8.5, b: true }); ry -= 12; }
    let ty = top; for (const l of d.to || []) { t(l, M, ty, { size: 10 }); ty -= 13; } y = Math.min(ry, ty) - 14; }
  else { for (const [k, v] of d.refs) { t(`${k}: `, M, y, { size: 9, c: grey }); t(v, M + wid(`${k}: `, 9), y, { size: 9, b: true }); y -= 12.5; } y -= 6; if ((d.to || []).length) { for (const l of d.to) { t(l, M, y, { size: 10 }); y -= 13; } y -= 6; } }
  // title
  y -= 4; need(30);
  if (f === 1) { const tt = d.title.toUpperCase(); t(tt, (PW - wid(tt, 13, true)) / 2, y, { b: true, size: 13, c: accent }); y -= 10; page.drawLine({ start: { x: (PW - wid(tt, 13, true)) / 2, y }, end: { x: (PW + wid(tt, 13, true)) / 2, y }, thickness: 0.6, color: accent }); y -= 18; }
  else if (f === 4) { page.drawRectangle({ x: M - 8, y: y - 8, width: PW - 2 * M + 16, height: 26, color: light }); t(d.title, M, y, { b: true, size: 13, c: accent }); y -= 32; }
  else { t(d.title, M, y, { b: true, size: 14, c: accent }); y -= 10; if (d.badge && f !== 3) { const bw = wid(d.badge, 8, true) + 14; page.drawRectangle({ x: PW - M - bw, y: y + 4, width: bw, height: 16, color: accent }); t(d.badge, PW - M - bw + 7, y + 9, { b: true, size: 8, c: rgb(1, 1, 1) }); } y -= 16; }
  // compact: key facts box first
  for (const b of d.blocks) {
    if (b.h) { need(b.box ? Math.min(260, (d.compact ? Math.ceil(b.box.length / 2) : b.box.length) * 14.5 + 44) : b.table ? 80 : 60); /* keep a heading with its content */ y -= 4; t(b.h, M, y, { b: true, size: 11, c: accent }); y -= 5; if (f !== 4) page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.4, color: rgb(0.8, 0.82, 0.86) }); y -= 12; }
    if (b.p) for (const p of String(b.p).split(/\n{2,}/)) { para(p, { size: b.size }); y -= 5; }
    if (b.box && d.compact && b.box === d.blocks.find(x => x.box)?.box) b.box = b.box.filter(([k]) => !['Student name'].includes(k)); // the name is already in the opening sentence
    if (b.box && d.compact) { // two columns: keeps the LOA on one page
      const half = (PW - 2 * M) / 2; const rows = []; for (let i = 0; i < b.box.length; i += 2) rows.push([b.box[i], b.box[i + 1]]);
      const lines = rows.map(r => Math.max(...r.filter(Boolean).map(([, v]) => wrap(v, 9, half - 98).length)));
      const h0 = lines.reduce((s, n) => s + n * 12.4 + 2, 0) + 14; need(h0);
      page.drawRectangle({ x: M - 8, y: y - h0 + 14, width: PW - 2 * M + 16, height: h0, color: light, borderColor: rgb(0.84, 0.86, 0.9), borderWidth: 0.6 }); y -= 2;
      rows.forEach((r, i) => { r.forEach((c, j) => { if (!c) return; const x0 = M + j * half; t(c[0], x0, y, { size: 8.6, b: true }); wrap(c[1], 9, half - 98).forEach((l, k) => t(l, x0 + 92, y - k * 12.4, { size: 9 })); }); y -= lines[i] * 12.4 + 2; });
      y -= 10; continue;
    }
    if (b.box) { const h0 = b.box.reduce((s, [, v]) => s + wrap(v, 9.4, PW - 2 * M - 170).length * 13.4 + 1.5, 0) + 16; need(h0); page.drawRectangle({ x: M - 8, y: y - h0 + 14, width: PW - 2 * M + 16, height: h0, color: light, borderColor: rgb(0.84, 0.86, 0.9), borderWidth: 0.6 }); y -= 2; kvs(b.box, 9.4, M, 170); y -= 10; }
    if (b.table) {
      const cols = b.table.cols; const head = () => { need(20); page.drawRectangle({ x: M, y: y - 5, width: PW - 2 * M, height: 17, color: f === 2 || f === 5 ? accent : light }); let x = M; for (const [c, w] of cols) { t(c, x + 4, y, { b: true, size: 8.6, c: f === 2 || f === 5 ? rgb(1, 1, 1) : ink }); x += w; } y -= 19; };
      head();
      for (const r of b.table.rows) { const cells = r.map((v, i) => wrap(v, 9, cols[i][1] - 8)); const h1 = Math.max(...cells.map(c => c.length)) * 12 + 4; if (y - h1 < BOT) { header(false); head(); }
        let x = M; cells.forEach((ls, i) => { ls.forEach((l, k) => t(l, x + 4, y - k * 12, { size: 9 })); x += cols[i][1]; }); y -= h1; page.drawLine({ start: { x: M, y: y + 8 }, end: { x: PW - M, y: y + 8 }, thickness: 0.3, color: rgb(0.85, 0.85, 0.85) }); }
      for (const [k, v, strong] of b.table.totals || []) { need(15); t(k, PW - M - 250, y, { b: strong !== false, size: 9.6 }); t(v, PW - M - wid(v, 9.6, true) - 4, y, { b: true, size: 9.6 }); y -= 14; }
      y -= 8;
    }
  }
  if (d.closing) { y -= 2; para(d.closing); }
  // signature block (university's own signature + stamp, saved once); the application form has none
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
  pages.forEach((p, i) => { p.drawLine({ start: { x: M, y: 46 }, end: { x: PW - M, y: 46 }, thickness: 0.4, color: rgb(0.8, 0.8, 0.8) });
    const ls = (() => { const o = []; let line = ''; for (const w of W(foot).split(/\s+/)) { const tt = line ? line + ' ' + w : w; if (R.widthOfTextAtSize(tt, 7.2) > PW - 2 * M - 60 && line) { o.push(line); line = w; } else line = tt; } o.push(line); return o.slice(0, 2); })();
    ls.forEach((l, k) => p.drawText(l, { x: M, y: 34 - k * 9, size: 7.2, font: R, color: grey })); p.drawText(W(`Page ${i + 1} of ${pages.length}`), { x: PW - M - 50, y: 34, size: 7.2, font: R, color: grey }); });
  return Buffer.from(await doc.save());
}

// ---------- document content (one function per document type) ----------
// s: student facts the university is allowed to see; a: application facts; b: form values
function student(ua) {
  const v = C.appView(ua, { detail: true }); const i = v.identity || {};
  return { v, name: v.student_name, first: i.first_name || String(v.student_name || '').split(' ')[0], dob: i.dob, nationality: i.nationality, passport: i.passport, city: [i.city, i.state, i.country].filter(Boolean).join(', ') };
}
function bankRows(set) { return [['Bank', set.bank_name], ['Account name', set.bank_account_name || set.legal_name], ['Account number', set.bank_account_no], ['IBAN', set.bank_iban], ['SWIFT / BIC', set.bank_swift], ['Bank address', set.bank_address]].filter(r => r[1]); }
function payReference(set, sid, appRef) { return (set.bank_note || 'Please quote the student ID and full name as the payment reference.').replace(/\{student_id\}/g, sid || appRef || ''); }
async function build(kind, ctx) {
  const { uni, set, ua, b } = ctx; const st = ctx.student || student(ua); const fmt = b.format || set.default_format || 1;
  const cur = b.currency || set.currency || 'EUR'; const sid = clean(b.student_uni_id, 50) || ua.student_uni_id || ua.university_ref || '';
  const course = st.v.course; const intake = st.v.intake; const today = fmtDate(b.issue_date || U.istDate());
  const refs = [['Date', today], ...(sid ? [['Student ID', sid]] : []), ...(ua.university_ref && ua.university_ref !== sid ? [['Our reference', ua.university_ref]] : [])];
  const to = [st.name, ...(st.city ? [st.city] : [])];
  const studentBox = [['Student name', st.name], ['Student ID', sid || '-'], ['Date of birth', st.dob ? fmtDate(st.dob) : '-'], ['Nationality', st.nationality || '-'], ...(st.passport ? [['Passport number', st.passport]] : []),
    ['Programme', course], ['Level', st.v.level || '-'], ['Intake', intake || '-'], ...(b.programme_start ? [['Programme start', fmtDate(b.programme_start)]] : []), ...(b.programme_end ? [['Expected end', fmtDate(b.programme_end)]] : []),
    ...(b.duration ? [['Duration', b.duration]] : []), ...(b.campus || st.v.campus ? [['Campus', b.campus || st.v.campus]] : [])];
  const deadline = b.acceptance_deadline || new Date(Date.now() + (Number(set.offer_validity_days) || 21) * 864e5).toISOString().slice(0, 10);
  if (kind === 'offer_conditional' || kind === 'offer_unconditional') {
    const cond = kind === 'offer_conditional';
    const conds = (Array.isArray(b.conditions) ? b.conditions : C.parseJ(b.conditions, [])).filter(c => c && clean(c.text));
    const feeRows = [['Tuition fee (first year)', money(b.tuition ?? set.tuition_default, cur)], ...(set.other_fees || []).filter(x => x && x.label).map(x => [x.label, money(x.amount, cur)]),
      ...(num(b.scholarship) ? [['Scholarship / waiver', '- ' + money(b.scholarship, cur)]] : [])];
    const total = (num(b.tuition ?? set.tuition_default) || 0) + (set.other_fees || []).reduce((s, x) => s + (num(x.amount) || 0), 0) - (num(b.scholarship) || 0);
    const dep = num(b.deposit ?? set.deposit_default);
    return render({ uni, set, format: fmt, badge: cond ? 'CONDITIONAL' : 'UNCONDITIONAL', title: `${cond ? 'Conditional' : 'Unconditional'} Offer of Admission`, refs, to, studentName: st.name,
      blocks: [{ p: `Dear ${st.first},\n\nWe are pleased to inform you that you have been ${cond ? 'made a conditional offer of' : 'offered'} admission to the following programme at ${set.legal_name || uni.name}${cond ? ', subject to the conditions set out below' : ''}.` },
        ...(fmt === 4 ? [{ box: [['Programme', course], ['Intake', intake || '-'], ['Student ID', sid || '-'], ['Tuition (first year)', money(total, cur)], ['Accept by', fmtDate(deadline)]] }] : [{ h: 'Student and programme details', box: studentBox }]),
        { h: 'Tuition and fees', table: { cols: [['Item', 330], ['Amount', 157]], rows: feeRows, totals: [['Total for the first year', money(total, cur)]] } },
        ...(dep ? [{ p: `A deposit of ${money(dep, cur)} is required to confirm your place${b.deposit_deadline ? ` by ${fmtDate(b.deposit_deadline)}` : ''}.` }] : []),
        ...(cond ? [{ h: 'Conditions of this offer', table: { cols: [['#', 28], ['Condition', 339], ['Due by', 120]], rows: conds.map((c, i) => [String(i + 1), clean(c.text, 500), c.due ? fmtDate(c.due) : '-']) } }] : []),
        ...(bankRows(set).length && (dep || fmt === 5) ? [{ h: 'Payment details', box: [...bankRows(set), ['Payment reference', payReference(set, sid, ua.university_ref)]] }] : []),
        { h: 'Acceptance', p: `Please confirm your acceptance of this offer by ${fmtDate(deadline)}.${cond ? ' Once all conditions are met, an unconditional offer will be issued.' : ' After payment of the deposit you will receive your final Letter of Acceptance.'}${clean(b.scholarship_text) ? `\n\nScholarship: ${clean(b.scholarship_text, 300)}` : ''}${clean(b.letter_note) ? `\n\n${clean(b.letter_note, 2000)}` : ''}` }],
      closing: `We congratulate you on your ${cond ? 'conditional ' : ''}offer and look forward to welcoming you to ${set.legal_name || uni.name}.${set.contact_name ? ` For any questions please contact ${set.contact_name}${set.contact_email ? ' (' + set.contact_email + ')' : ''}.` : ''}`,
      terms: fmt === 5 ? (set.offer_terms || 'This offer is personal and cannot be transferred. It is valid for the intake shown only. The university may withdraw the offer if any information or document provided is found to be incorrect. Fees are subject to the university fee regulations in force. Visa and immigration decisions are made by the competent authorities.') : null, slip: fmt === 5 });
  }
  if (kind === 'loa') {
    const total = num(b.total_fees); const paid = num(b.fees_paid) || 0; const bal = total !== null ? Math.max(0, total - paid) : null;
    return render({ uni, set, format: fmt, badge: 'FINAL LOA', title: 'Final Letter of Acceptance', refs, to, studentName: st.name,
      blocks: [{ p: `To whom it may concern,\n\nThis is to confirm that ${st.name}${st.dob ? `, born on ${fmtDate(st.dob)}` : ''}${st.nationality ? `, of ${st.nationality} nationality` : ''}${st.passport ? `, holding passport number ${st.passport}` : ''}, has been granted unconditional admission and has accepted a place at ${set.legal_name || uni.name} for the programme below.` },
        { h: 'Student and programme details', box: studentBox },
        { h: 'Tuition fees', table: { cols: [['Item', 330], ['Amount', 157]], rows: [['Total tuition fee' + (b.fee_period ? ` (${b.fee_period})` : ' (first year)'), money(total, cur)], ['Amount paid', money(paid, cur)], ...(b.payment_date ? [['Last payment received on', fmtDate(b.payment_date)]] : [])],
          totals: bal !== null ? [['Balance due', money(bal, cur)]] : [] } },
        ...(clean(b.accommodation) ? [{ h: 'Accommodation', p: clean(b.accommodation, 500) }] : []),
        ...(b.reporting_date ? [{ p: `The student is expected to report to the university on ${fmtDate(b.reporting_date)}.` }] : []),
        { h: 'University contact person', box: [['Name', b.contact_name || set.contact_name || set.signatory_name || '-'], ['Designation', b.contact_designation || set.contact_designation || '-'], ['Email', b.contact_email || set.contact_email || set.email || '-'], ['Phone', b.contact_phone || set.contact_phone || set.phone || '-'], ['University address', set.address || addrOf(uni)]] },
        { p: `${clean(b.note) || set.loa_note || 'This letter is issued at the request of the student for visa and immigration purposes.'} Should you require any further information, please contact the person named above.` }],
      compact: true });
  }
  if (kind === 'invoice') {
    const items = (Array.isArray(b.items) ? b.items : []).filter(i => i && clean(i.description));
    const total = items.reduce((s, i) => s + (num(i.amount) || 0), 0) - (num(b.scholarship) || 0);
    return render({ uni, set, format: fmt, badge: 'INVOICE', title: 'Tuition Fee Invoice', refs: [['Invoice number', ctx.no], ...refs, ['Due date', fmtDate(b.due_date)]], to, studentName: st.name,
      blocks: [{ h: 'Billed to', box: [['Student name', st.name], ['Student ID', sid || '-'], ['Programme', course], ['Intake', intake || '-']] },
        { h: 'Charges', table: { cols: [['Description', 330], ['Amount', 157]], rows: [...items.map(i => [clean(i.description, 200), money(i.amount, cur)]), ...(num(b.scholarship) ? [['Scholarship / discount', '- ' + money(b.scholarship, cur)]] : [])], totals: [['Total due', money(total, cur)]] } },
        { h: 'How to pay', box: [...(bankRows(set).length ? bankRows(set) : [['Payment', clean(b.bank_details, 500) || 'See the university payment page']]), ['Payment reference', payReference(set, sid, ua.university_ref)]] },
        ...(clean(b.note) ? [{ p: clean(b.note, 1000) }] : [])],
      closing: `Please pay by ${fmtDate(b.due_date)}. Payments are accepted only to the account above. A receipt will be issued for every payment.` });
  }
  if (kind === 'receipt') {
    return render({ uni, set, format: fmt, badge: 'RECEIPT', title: 'Fee Payment Receipt', refs: [['Receipt number', ctx.no], ...refs], to, studentName: st.name,
      blocks: [{ p: `Received with thanks from ${st.name}${sid ? ` (student ID ${sid})` : ''} the amount below for the programme ${course}${intake ? ', intake ' + intake : ''}.` },
        { h: 'Payment', box: [['Amount received', money(b.amount, cur)], ['Payment for', clean(b.purpose, 120) || 'Tuition fee'], ['Payment date', fmtDate(b.payment_date)], ['Payment method', clean(b.method, 60) || 'Bank transfer'], ...(clean(b.reference) ? [['Transaction reference', clean(b.reference, 100)]] : [])] },
        ...(num(b.total_fees) !== null ? [{ h: 'Fee account', table: { cols: [['', 330], ['Amount', 157]], rows: [['Total fee', money(b.total_fees, cur)], ['Paid to date (including this payment)', money(b.paid_to_date, cur)]], totals: [['Balance', money(Math.max(0, num(b.total_fees) - num(b.paid_to_date)), cur)]] } }] : [])],
      closing: 'This receipt is issued electronically by the university.' });
  }
  throw bad('Unknown document');
}
const addrOf = (uni) => [uni.city, U.masterName(uni.country_id)].filter(Boolean).join(', ');

// ---------- 1-click: everything filled automatically ----------
// Student details from the application; fees, scholarship, deposit, conditions and deadlines from the offer the university already recorded,
// else from the course and Letters & bank details; student ID created automatically if missing; programme dates from the intake and course duration.
function ensureStudentId(ua, uni) {
  if (ua.student_uni_id) return ua.student_uni_id;
  const short = String(uni.short_name || uni.name || 'UNI').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'UNI';
  const yr = new Date().getFullYear();
  const n = (get(`SELECT COUNT(*) c FROM university_applications WHERE university_id = ? AND student_uni_id LIKE ?`, ua.university_id, `${short}-${yr}-%`).c || 0) + 1;
  let id = `${short}-${yr}-${String(n).padStart(4, '0')}`; let k = n;
  while (get('SELECT 1 x FROM university_applications WHERE university_id = ? AND student_uni_id = ?', ua.university_id, id)) id = `${short}-${yr}-${String(++k).padStart(4, '0')}`;
  run('UPDATE university_applications SET student_uni_id = ? WHERE id = ?', id, ua.id);
  return id;
}
function autoData(ua, uni) {
  const set = settingsOf(ua.university_id);
  const a = get('SELECT * FROM applications WHERE id = ?', ua.application_id);
  const course = a.course_id ? get('SELECT * FROM courses WHERE id = ?', a.course_id) || {} : {};
  const fee = get(`SELECT * FROM fee_summaries WHERE application_id = ? AND fee_kind = 'tuition' AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1`, a.id) || {};
  const act = get(`SELECT data_json FROM uni_actions WHERE uapp_id = ? AND type IN ('conditional_offer','unconditional_offer') ORDER BY created_at DESC LIMIT 1`, ua.id);
  const od = act ? C.parseJ(act.data_json, {}) : {};
  const pick = (...v) => v.find(x => x !== null && x !== undefined && x !== '');
  const tuition = num(pick(fee.total_amount, od.tuition, set.tuition_default, course.tuition_fee)) || 0;
  const scholarship = num(pick(fee.scholarship, od.scholarship)) || 0;
  const other = (set.other_fees || []).reduce((s, x) => s + (num(x.amount) || 0), 0);
  const intake = a.intake_id && get('SELECT month, year FROM intakes WHERE id = ?', a.intake_id);
  const start = pick(od.programme_start, ua.programme_start, intake && intake.year ? `${intake.year}-${String(intake.month || 9).padStart(2, '0')}-01` : null);
  const months = Number(course.duration_months) || (/(\d+(?:\.\d+)?)\s*year/i.test(course.duration || '') ? Math.round(parseFloat(RegExp.$1) * 12) : /(\d+)\s*month/i.test(course.duration || '') ? Number(RegExp.$1) : null);
  const end = start && months ? (() => { const d = new Date(start + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + months); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })() : null;
  const paid = get(`SELECT COALESCE(SUM(amount), 0) s FROM uni_student_items WHERE uapp_id = ? AND kind = 'receipt'`, ua.id).s || num(ua.deposit_amount) || 0;
  const conds = all(`SELECT text FROM offer_conditions WHERE application_id = ? AND is_deleted = 0 AND status = 'Open'`, a.id).map(c => ({ text: c.text }));
  const dl = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  return { set, format: set.default_format || 1, currency: pick(fee.currency, od.currency, set.currency, course.currency) || 'EUR', tuition, scholarship, scholarship_text: pick(od.scholarship_text, course.scholarship_text),
    deposit: num(pick(fee.deposit_required, od.deposit, set.deposit_default)), deposit_deadline: pick(fee.deposit_deadline, od.deposit_deadline), conditions: conds.length ? conds : (od.conditions || []),
    acceptance_deadline: pick(a.offer_deadline, od.acceptance_deadline, dl(Number(set.offer_validity_days) || 21)), programme_start: start, programme_end: end, duration: months ? (months % 12 ? `${months} months` : `${months / 12} year${months > 12 ? 's' : ''}`) : null,
    student_uni_id: ensureStudentId(ua, uni), total_fees: Math.round((tuition + other - scholarship) * 100) / 100, fees_paid: paid, paid_to_date: paid, payment_date: ua.deposit_date || null,
    items: [{ description: 'Tuition fee (first year)', amount: tuition }, ...(set.other_fees || []).filter(x => x && x.label).map(x => ({ description: x.label, amount: num(x.amount) || 0 }))], due_date: dl(14),
    amount: num(ua.deposit_amount) || null, purpose: ua.deposit_amount ? 'Tuition deposit' : 'Tuition fee', method: 'Bank transfer' };
}
const ONE_CLICK = { offer_conditional: ['Conditional offer', 'Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled', 'Acknowledged', 'Under assessment', 'Interview scheduled', 'Documents requested', 'New', 'Waitlisted'],
  offer_unconditional: ['Conditional offer', 'Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled', 'Acknowledged', 'Under assessment', 'Interview scheduled', 'Documents requested', 'New', 'Waitlisted'],
  loa: ['Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'], invoice: ['Conditional offer', 'Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'], receipt: ['Conditional offer', 'Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'] };

// ---------- routes (/api/university) ----------
const r = express.Router();
const admin = (req) => { if (req.uu.role !== 'admin' || req.preview) throw new HttpError(403, 'Only the University Admin can change letter settings.'); };
const SET_FIELDS = ['legal_name', 'address', 'phone', 'email', 'website', 'registration', 'signatory_name', 'signatory_designation', 'accent', 'contact_name', 'contact_designation', 'contact_email', 'contact_phone',
  'bank_name', 'bank_account_name', 'bank_account_no', 'bank_iban', 'bank_swift', 'bank_address', 'bank_note', 'currency', 'offer_terms', 'loa_note', 'footer_text'];
const setOut = (s) => ({ ...s, other_fees_json: undefined, has_logo: !!s.logo_key, has_signature: !!s.signature_key, has_stamp: !!s.stamp_key, logo_key: undefined, signature_key: undefined, stamp_key: undefined });
r.get('/letters/settings', ah(async (req, res) => res.json({ settings: setOut(settingsOf(req.uu.university_id)), formats: FORMATS, docs: DOCS, uni_logo: !!req.uni.logo_key, can_edit: req.uu.role === 'admin' && !req.preview })));
r.put('/letters/settings', ah(async (req, res) => {
  admin(req); const b = req.body; const errors = {};
  for (const k of ['email', 'contact_email']) if (b[k] && !U.isEmail(b[k])) errors[k] = 'Enter a valid email';
  for (const k of ['tuition_default', 'deposit_default', 'application_fee']) if (b[k] !== undefined && b[k] !== '' && b[k] !== null && !(num(b[k]) >= 0)) errors[k] = 'Must be 0 or more';
  if (b.accent && !/^#?[0-9a-f]{6}$/i.test(b.accent)) errors.accent = 'Use a colour like #1F3A5F';
  Object.assign(errors, C.feeWordCheck({ offer_terms: b.offer_terms, bank_note: b.bank_note }));
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  const cur = settingsOf(req.uu.university_id);
  const f = { university_id: req.uu.university_id };
  for (const k of SET_FIELDS) f[k] = b[k] !== undefined ? clean(b[k], ['offer_terms', 'loa_note', 'bank_note', 'footer_text', 'address'].includes(k) ? 3000 : 200) : cur[k] ?? null;
  for (const k of ['tuition_default', 'deposit_default', 'application_fee']) f[k] = b[k] !== undefined ? num(b[k]) : cur[k] ?? null;
  f.default_format = Math.min(5, Math.max(1, Number(b.default_format ?? cur.default_format) || 1)); f.offer_validity_days = Math.min(120, Math.max(1, Number(b.offer_validity_days ?? cur.offer_validity_days) || 21));
  f.other_fees_json = JSON.stringify((Array.isArray(b.other_fees) ? b.other_fees : cur.other_fees).filter(x => x && clean(x.label)).map(x => ({ label: clean(x.label, 100), amount: num(x.amount) || 0 })).slice(0, 10));
  for (const k of ['logo_key', 'signature_key', 'stamp_key']) f[k] = cur[k] || null;
  f.updated_by = req.uu.id; f.updated_at = now();
  const cols = Object.keys(f); run(`INSERT OR REPLACE INTO uni_letter_settings (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map(k => f[k]));
  C.uaudit(req, 'Update', 'LetterSettings', req.uu.university_id, 'Letters & bank details saved'); res.json({ ok: true });
}));
r.post('/letters/settings/image/:kind(logo|signature|stamp)', files.upload.single('file'), ah(async (req, res) => {
  try {
    admin(req); if (!req.file) throw bad('Choose an image (PNG or JPG)');
    const { ext } = files.checkFile(req.file, ['png', 'jpg', 'jpeg'], 3);
    const key = `${req.params.kind}-${req.uu.university_id}-${Date.now()}.png`;
    VAULT.write(path.join(IMG_DIR, key), await require('sharp')(req.file.path).resize(800, 800, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()); files.cleanup(req.file); // signature / stamp images: encrypted at rest
    if (!get('SELECT 1 x FROM uni_letter_settings WHERE university_id = ?', req.uu.university_id)) run('INSERT INTO uni_letter_settings (university_id, default_format, currency) VALUES (?,1,?)', req.uu.university_id, 'EUR');
    run(`UPDATE uni_letter_settings SET ${req.params.kind}_key = ?, updated_by = ?, updated_at = ? WHERE university_id = ?`, key, req.uu.id, now(), req.uu.university_id);
    C.uaudit(req, 'Update', 'LetterSettings', req.uu.university_id, `${req.params.kind} image uploaded (${ext})`); res.json({ ok: true });
  } finally { files.cleanup(req.file); }
}));
r.delete('/letters/settings/image/:kind(logo|signature|stamp)', ah(async (req, res) => { admin(req); run(`UPDATE uni_letter_settings SET ${req.params.kind}_key = NULL WHERE university_id = ?`, req.uu.university_id); res.json({ ok: true }); }));
r.get('/letters/settings/image/:kind(logo|signature|stamp)', ah(async (req, res) => {
  const s = settingsOf(req.uu.university_id); const k = s[req.params.kind + '_key']; if (!k) throw C.NotFound();
  res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'private, no-store'); VAULT.pipe(path.join(IMG_DIR, path.basename(k)), res);
}));
// preview any document in any format with a sample student (nothing is saved or sent)
r.get('/letters/preview/:doc', ah(async (req, res) => {
  if (!DOCS[req.params.doc]) throw C.NotFound();
  const set = settingsOf(req.uu.university_id);
  const fake = { student_uni_id: 'S-2027-0042', university_ref: 'ADM-2027-118' };
  const sample = { v: { student_name: 'Riya Shah (sample)', course: 'MSc Management', level: 'Master', intake: 'Sep 2027', campus: null }, name: 'Riya Shah (sample)', first: 'Riya', dob: '2000-05-14', nationality: 'Indian', passport: 'A1234567', city: 'Ahmedabad, Gujarat, India' };
  const dl = new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10);
  const b = { format: Number(req.query.format) || set.default_format || 1, tuition: set.tuition_default ?? 12000, deposit: set.deposit_default ?? 2500, scholarship: 1000, scholarship_text: 'Merit scholarship', currency: set.currency || 'EUR', acceptance_deadline: dl, deposit_deadline: dl,
    programme_start: '2027-09-15', programme_end: '2029-07-31', duration: '2 years', conditions: [{ text: 'Final degree certificate and transcript', due: '2027-07-31' }, { text: 'IELTS 6.5 overall', due: '2027-06-30' }],
    total_fees: set.tuition_default ?? 12000, fees_paid: set.deposit_default ?? 2500, payment_date: U.istDate(), reporting_date: '2027-09-08', items: [{ description: 'Tuition fee (first year)', amount: set.tuition_default ?? 12000 }], due_date: dl,
    amount: set.deposit_default ?? 2500, purpose: 'Tuition deposit', payment_date2: U.istDate(), method: 'Bank transfer', reference: 'TRX-889201', paid_to_date: set.deposit_default ?? 2500 };
  if (req.params.doc === 'receipt') b.payment_date = U.istDate();
  const buf = await build(req.params.doc, { uni: req.uni, set, ua: fake, b, student: sample, no: req.params.doc === 'invoice' ? 'INV-SAMPLE-001' : 'RCPT-SAMPLE-001' });
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="sample-${req.params.doc}-format-${b.format}.pdf"`); res.send(buf);
}));

// 1-click: what can be generated now (with the auto-filled values), preview (not saved) and send (saved, sent to the student, copy for La Europa)
const loadUA = (req, id) => require('./routes').loadUA(req, id);
r.get('/applications/:id/docs', ah(async (req, res) => {
  const ua = loadUA(req, req.params.id); const d = autoData(ua, req.uni);
  const sent = all(`SELECT kind, title, created_at FROM uni_student_items WHERE uapp_id = ? AND kind IN ('offer_letter','loa','invoice','receipt') ORDER BY created_at DESC`, ua.id);
  res.json({ format: d.format, formats: FORMATS, student_uni_id: d.student_uni_id, can_send: ['admin', 'officer'].includes(req.uu.role) && !req.preview,
    settings_ok: !!(d.set.signatory_name && (d.set.bank_iban || d.set.bank_account_no)), has_signature: !!d.set.signature_key,
    docs: Object.entries(DOCS).map(([k, label]) => ({ key: k, label, ready: ONE_CLICK[k].includes(ua.status), needs_amount: k === 'receipt' && !d.amount, last: (sent.find(x => x.kind === (k.startsWith('offer') ? 'offer_letter' : k) && (!k.startsWith('offer') || x.title.toLowerCase().startsWith(k === 'offer_conditional' ? 'conditional' : 'unconditional'))) || {}).created_at || null })),
    summary: { tuition: d.tuition, scholarship: d.scholarship, deposit: d.deposit, currency: d.currency, total_fees: d.total_fees, paid: d.fees_paid, programme_start: d.programme_start, conditions: d.conditions.length } });
}));
r.get('/applications/:id/docs/:doc/preview', ah(async (req, res) => {
  if (!DOCS[req.params.doc]) throw C.NotFound();
  const ua = loadUA(req, req.params.id); const d = autoData(ua, req.uni);
  const b = { ...d, format: Number(req.query.format) || d.format, ...(req.query.amount ? { amount: num(req.query.amount), paid_to_date: d.paid_to_date + num(req.query.amount), payment_date: U.istDate() } : {}) };
  if (req.params.doc === 'receipt' && !b.amount) throw bad('Enter the amount received for the receipt');
  if (req.params.doc === 'receipt' && !b.payment_date) b.payment_date = U.istDate();
  const buf = await build(req.params.doc, { uni: req.uni, set: d.set, ua: get('SELECT * FROM university_applications WHERE id = ?', ua.id), b, no: req.params.doc === 'invoice' ? 'DRAFT' : req.params.doc === 'receipt' ? 'DRAFT' : undefined });
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="preview-${req.params.doc}.pdf"`); res.send(buf);
}));
r.post('/applications/:id/docs/:doc/send', ah(async (req, res) => {
  const kind = req.params.doc; if (!DOCS[kind]) throw C.NotFound();
  if (!['admin', 'officer'].includes(req.uu.role) || req.preview) throw new HttpError(403, 'Your role does not allow this action.');
  const ua = loadUA(req, req.params.id);
  if (!ONE_CLICK[kind].includes(ua.status)) throw bad(kind === 'loa' ? 'The final LOA can be issued after an unconditional offer.' : 'This document can be issued after an offer.');
  const d = autoData(ua, req.uni); const D = require('./direct');
  const b = { ...d, format: Number(req.body.format) || d.format };
  if (kind === 'receipt') { const amt = num(req.body.amount) || d.amount; if (!(amt > 0)) throw fieldErr('amount', 'Enter the amount received');
    const before = get(`SELECT COALESCE(SUM(amount), 0) s FROM uni_student_items WHERE uapp_id = ? AND kind = 'receipt'`, ua.id).s;
    b.amount = amt; b.paid_to_date = Math.round((before + amt) * 100) / 100; b.payment_date = req.body.payment_date || (num(req.body.amount) ? U.istDate() : ua.deposit_date) || U.istDate(); }
  if (kind === 'offer_conditional' && !b.conditions.length) b.conditions = [{ text: 'Submission of final academic documents' }];
  const map = { offer_conditional: ['Offer letter', (n) => `Conditional offer letter ${n}`, { kind: 'offer_letter' }], offer_unconditional: ['Offer letter', (n) => `Unconditional offer letter ${n}`, { kind: 'offer_letter' }],
    loa: ['Acceptance letter for visa', (n) => `Final Letter of Acceptance ${n}`, { amount: d.fees_paid }], invoice: ['Tuition fee invoice', (n) => `Tuition fee invoice ${n}`, { amount: Math.round((d.total_fees) * 100) / 100, due_date: d.due_date }],
    receipt: ['University receipt', (n) => `Fee payment receipt ${n}`, {}] };
  const [typeName, titleFn, extra] = map[kind];
  const out = await D.sendGenerated(req, ua, kind, b, typeName, titleFn, { ...extra, ...(kind === 'receipt' ? { amount: b.amount } : {}) });
  if (kind.startsWith('offer')) { const it = out.item; insert('offer_letters', { id: uuid(), uapp_id: ua.id, application_id: ua.application_id, type: kind === 'offer_conditional' ? 'Conditional' : 'Unconditional', document_id: it.document_id, version_id: it.version_id, issue_date: U.istDate(), created_at: now() }); }
  C.uaudit(req, 'Create', 'UniversityLetter', ua.id, `${DOCS[kind]} ${out.no} (1-click)`);
  res.json({ ok: true, no: out.no, id: out.item.id });
}));

module.exports = { router: r, build, render, settingsOf, autoData, FORMATS, DOCS, IMG_DIR };
