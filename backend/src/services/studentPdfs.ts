import os from 'os';
import crypto from 'crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import Student, { Comment, type IStudent } from '../models/Student';
import Lead, { LeadActivity } from '../models/Lead';
import PortalAccount from '../models/PortalAccount';
import { Timeline } from '../models/Timeline';
import { Application, VisaCase, Payment } from '../models/Work';
import { ChatMessage, ConsentRecord } from '../models/Portal';
import { SignedDocument, type ISignedDocument } from '../models/Privacy';
import { EmailLog } from '../models/Email';
import { env } from '../config/env';
import { fmtDateTime, fmtTime, fullName, istDate, userNames, nameIn } from './crm';
import { fmtDate } from './invoicePdf';
import { stageList } from './masters';
import { academicSummary } from './students';
import { regVal } from './console';
import { workNames } from '../routes/work';
import { readLocked } from './signing';
import * as PDF from './legalPdf';

/** Student PDFs for staff (legacy/server/routes/students.js summary, record.js, legal/evidence.js). */

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ist = (d?: Date | string | null) => (d ? fmtDateTime(d) : '');
const accountsOf = async (s: IStudent) => PortalAccount.find({ $or: [{ studentId: s._id }, ...(s.lead_id ? [{ leadId: s.lead_id }] : [])] }).select('_id email').lean();
export async function latestSigned(s: IStudent) {
  const ids = (await accountsOf(s)).map((a) => a._id);
  return ids.length ? SignedDocument.findOne({ student_user_id: { $in: ids } }).sort({ signed_at: -1 }) : null;
}

/** The one-page profile summary. */
export async function summaryPdf(s: IStudent, byName: string) {
  const N = await workNames();
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ascii = (t: unknown) => String(t ?? '').replace(/€/g, 'EUR ').replace(/₹/g, 'INR ').replace(/[^\x20-\x7E]/g, '');
  const NAVY = rgb(0.06, 0.24, 0.46);
  page.drawRectangle({ x: 0, y: 790, width: 595.28, height: 52, color: NAVY });
  page.drawText('La Europa Education', { x: 40, y: 810, size: 18, font: bold, color: rgb(1, 1, 1) });
  page.drawText('Student profile summary', { x: 380, y: 812, size: 11, font, color: rgb(1, 1, 1) });
  let y = 760;
  const line = (label: string, value: unknown) => {
    page.drawText(ascii(label), { x: 40, y, size: 10, font: bold, color: rgb(0.2, 0.25, 0.33) });
    const lines: string[] = [];
    let cur = '';
    for (const w of ascii(value || '-').split(' ')) { if (font.widthOfTextAtSize(cur + ' ' + w, 10) > 360) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
    lines.push(cur);
    lines.forEach((l, i) => page.drawText(l, { x: 190, y: y - i * 14, size: 10, font }));
    y -= 14 * lines.length + 8;
  };
  const head = (t: string) => { y -= 6; page.drawText(t, { x: 40, y, size: 13, font: bold, color: NAVY }); y -= 22; };
  const sum = await academicSummary(s);
  line('Name', fullName(s)); line('Student ID', s.student_code); line('Email', s.email); line('Phone', `${s.country_code ?? ''} ${s.phone ?? ''}`);
  line('Date of birth', s.dob ? fmtDate(s.dob) : '-'); line('Nationality', s.nationality);
  head('Mini assessment');
  for (const part of sum.line.split(' | ')) { const [k, ...v] = part.split(': '); line(k, v.join(': ')); }
  line('Total experience', sum.experience.label);
  line('Preferred level', s.prefs?.level); line('Preferred intake', N.name(s.prefs?.intake_id));
  line('Preferred countries', (s.prefs?.country_ids ?? []).map((id) => N.name(id)).join(', '));
  const apps = await Application.find({ student_id: s._id, is_deleted: false }).limit(10).lean();
  if (apps.length) {
    const stages = await stageList('app_stage');
    head('Applications');
    for (const a of apps) line(N.name(a.university_id), `${a.course_name_text || N.name(a.course_id)} (${N.name(a.intake_id)}): ${stages.find((x) => x.code === a.stage)?.name ?? a.stage}`);
  }
  page.drawText(ascii(`Generated ${fmtDateTime(new Date())} IST by ${byName}`), { x: 40, y: 30, size: 8, font, color: rgb(0.4, 0.45, 0.5) });
  return Buffer.from(await pdf.save());
}

/** Everything that happened, first contact to today, in time order (IST), with the chat in its own section. Staff only: internal notes are included. */
export async function recordPdf(s: IStudent, byName: string) {
  const N = await workNames();
  const names = await userNames();
  const who = (id: unknown) => (id ? nameIn(names, id) || 'Staff' : '');
  const clip = (t: unknown, n = 1200) => { const x = String(t ?? '').replace(/\s+\n/g, '\n').trim(); return x.length > n ? x.slice(0, n) + '...' : x; };
  const ev: { at: Date; kind: string; text: string; by: string }[] = [];
  const push = (at: Date | string | undefined | null, kind: string, text: string, by = '') => { if (at && text) ev.push({ at: new Date(at), kind, text: clip(text), by }); };
  const accounts = await accountsOf(s);
  const suIds = accounts.map((a) => a._id);
  const lead = s.lead_id ? await Lead.findById(s.lead_id).lean() : null;
  if (lead) {
    push(lead.createdAt, 'Enquiry', `Enquiry received (${lead.lead_code})${lead.course_interest ? ': ' + lead.course_interest : ''}`, who(lead.created_by));
    for (const a of await LeadActivity.find({ lead_id: lead._id, is_deleted: false }).lean()) push(a.createdAt, 'Lead activity', `${a.type}${a.outcome ? ' · ' + a.outcome : ''}${a.notes ? ': ' + a.notes : ''}`, who(a.logged_by));
  }
  const KIND: Record<string, string> = { stage: 'Stage', document: 'Document', profile: 'Profile', payment: 'Payment', visa: 'Visa', lead: 'Enquiry', email: 'Email', task: 'Task' };
  for (const t of await Timeline.find({ $or: [{ student_id: s._id }, ...(s.lead_id ? [{ lead_id: s.lead_id }] : [])] }).lean())
    push(t.createdAt, KIND[t.type] ?? 'Update', t.description, (t.data as Any)?.actor_type === 'student' ? 'Student' : who(t.user_id));
  for (const c of await Comment.find({ student_id: s._id, is_deleted: false }).lean()) push(c.createdAt, 'Note (internal)', c.body, who(c.created_by));
  for (const e of await EmailLog.find({ $or: [{ student_id: s._id }, ...(s.lead_id ? [{ lead_id: s.lead_id }] : [])], email_type: { $ne: 'security' } }).lean() as Any[])
    push(e.sent_at ?? e.queued_at, 'Email', `Email sent: ${e.subject || e.update_title || ''} (${e.status || ''})`, 'System');
  for (const p of await Payment.find({ student_id: s._id, is_deleted: false }).lean())
    push(p.createdAt, 'Payment', `${p.is_refund ? 'Refund' : 'Payment'} ${p.currency} ${Number(p.amount).toLocaleString('en-IN')} · ${p.payment_for} · ${p.mode || ''} · paid ${fmtDate(p.payment_date)}${p.reference_no ? ' · ref ' + p.reference_no : ''}${p.receipt_no ? ' · receipt ' + p.receipt_no : ''}`, who(p.created_by));
  // Terms, Privacy and the other one-time ticks only once; every application consent is kept
  const seen = new Set<string>();
  for (const c of await ConsentRecord.find({ student_user_id: { $in: suIds } }).sort({ createdAt: 1 }).lean() as Any[]) {
    const x = c.extra ?? {};
    if (c.consent_type !== 'application_consent') { const k = c.consent_type + ':' + c.value; if (seen.has(k)) continue; seen.add(k); }
    push(c.createdAt, 'Consent', `${c.consent_type.replace(/_/g, ' ')}: ${c.value === 'yes' ? 'given' : 'not given / withdrawn'}${c.document_version ? ' (v' + c.document_version + ')' : ''}${x.text ? ' · "' + x.text + '"' : ''}${x.request_code ? ' · ' + x.request_code : ''} · IP ${c.ip || '-'}`, 'Student');
  }
  for (const d of await SignedDocument.find({ student_user_id: { $in: suIds } }).lean()) {
    const x = (d.data ?? {}) as Any;
    push(d.signed_at, 'Signature', `Signed the Student Declaration & Consent v${x.consent_version} (Terms v${x.constitution_version}) with email OTP: ${d.doc_code}, typed name "${d.typed_name}", IP ${x.ip || '-'}`, 'Student');
  }
  ev.sort((a, b) => +a.at - +b.at);
  const chat = (await ChatMessage.find({ $or: [{ student_id: s._id }, ...(s.lead_id ? [{ lead_id: s.lead_id }] : [])] }).sort({ sent_at: 1 }).lean()).map((m) => {
    const files = (m.attachments ?? []).map((a) => a.original_name).filter(Boolean);
    const w = m.sender_type === 'student' ? 'Student' : m.sender_type === 'system' ? 'System' : who(m.sender_user_id) || 'Counsellor';
    return { at: m.sent_at, text: `${w}: ${m.deleted_at ? '(message deleted) ' + (m.original_body || m.body || '') : m.body || ''}${files.length ? ` [files: ${files.join(', ')}]` : ''}${m.read_at ? '' : ' (not read yet)'}` };
  });

  const full = fullName(s);
  const w = await PDF.create({ title: `Student record ${s.student_code} - ${full}`, band: `Full student record · ${s.student_code}`, keywords: [s.student_code] });
  const apps = await Application.find({ student_id: s._id, is_deleted: false }).sort({ createdAt: 1 }).lean();
  const visas = await VisaCase.find({ student_id: s._id, is_deleted: false }).sort({ createdAt: 1 }).lean();
  const [aStages, vStages] = await Promise.all([stageList('app_stage'), stageList('visa_stage')]);
  const sn = (list: Any[], c: string) => list.find((x) => x.code === c)?.name ?? c;
  PDF.heading(w, `Full student record: ${full}`, 2);
  PDF.box(w, [['Student ID', { bold: s.student_code }], ['Name', full], ['Email / mobile', `${s.email || accounts[0]?.email || '-'} / ${s.phone || '-'}`], ['Counsellor (start to end)', who(s.primary_counsellor_id) || '-'],
    ['Status', s.status || '-'], ['Registered on', ist(s.createdAt)], ['Record created', `${ist(new Date())} IST by ${byName}`],
    ['Note', 'Everything below is in time order (India time, IST). Internal notes are marked and must not be shared with the student.']], { title: 'Student' });
  PDF.box(w, apps.length ? apps.map((a) => [a.application_code, `${N.name(a.university_id)} · ${a.course_name_text || N.name(a.course_id)} · ${N.name(a.intake_id)} · ${sn(aStages, a.stage)}`] as [string, string]) : [['Applications', 'None']],
    { title: 'Applications (current stage)', kw: 130 });
  if (visas.length) PDF.box(w, visas.map((v) => [v.visa_code, `${N.name(v.country_id)} · ${sn(vStages, v.stage)}${v.decision ? ' · ' + v.decision + ' ' + fmtDate(v.decision_date) : ''}`] as [string, string]), { title: 'Visa', kw: 130 });
  const INDIGO = rgb(0.357, 0.337, 0.914);
  const day = (d: Date) => fmtDate(istDate(d));
  const list = (rows: { at: Date; text: string; kind?: string; by?: string }[]) => {
    let cur = '';
    for (const e of rows) {
      const d = day(e.at);
      if (d !== cur) { cur = d; w.y -= 4; PDF.rich(w, d, { bold: true, size: 10, color: INDIGO, keep: 30 }); w.y -= 1; }
      PDF.rich(w, [{ t: fmtTime(e.at) + '  ', b: true }, ...(e.kind ? [{ t: `${e.kind}${e.by ? ' · ' + e.by : ''}: `, b: true }] : []), { t: e.text, b: false }], { indent: 8, size: 8.8 });
      w.y -= 2.5;
    }
  };
  PDF.heading(w, `History from first contact to today (${ev.length} entries)`, 3);
  if (ev.length) list(ev); else PDF.rich(w, 'No history yet.');
  w.newPage();
  PDF.heading(w, `Chat with the student (${chat.length} messages)`, 3);
  if (chat.length) list(chat); else PDF.rich(w, 'No chat messages.');
  return { bytes: await PDF.finish(w, `${s.student_code} · Full student record · La Europa Education · created ${ist(new Date())} IST · Confidential`), entries: ev.length };
}

// ---------- evidence certificate: Bharatiya Sakshya Adhiniyam 2023, s.63(4)(c) and its Schedule ----------
const INK = rgb(0.043, 0.063, 0.125), GREY = rgb(0.4, 0.43, 0.5), LINE = rgb(0.78, 0.8, 0.86), SHADE = rgb(0.955, 0.96, 0.98), NAVY = rgb(0.357, 0.337, 0.914), RED = rgb(0.75, 0.1, 0.1);
const SZ = 8.1, LH = SZ * 1.32, PAD = 4;
type Font = PDF.Writer['font'];
/** word wrap; a word longer than the line (a hash) is cut into pieces */
function wrap(font: Font, text: unknown, size: number, maxW: number) {
  const out: string[] = [];
  for (const para of PDF.W(String(text ?? '')).split('\n')) {
    let line = '';
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (font.widthOfTextAtSize(word, size) > maxW) {
        let n = word.length;
        while (n > 1 && font.widthOfTextAtSize(word.slice(0, n), size) > maxW) n--;
        if (line) { out.push(line); line = ''; }
        out.push(word.slice(0, n)); word = word.slice(n);
      }
      const t = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(t, size) > maxW && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}
const txt = (w: PDF.Writer, s: string, x: number, y: number, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}) =>
  w.page.drawText(PDF.W(s), { x, y, size: o.size ?? SZ, font: o.bold ? w.bold : w.font, color: o.color ?? INK });
function tick(w: PDF.Writer, x: number, y: number, on: boolean) {
  w.page.drawRectangle({ x, y: y - 1, width: 7.5, height: 7.5, borderColor: INK, borderWidth: 0.8 });
  if (on) { w.page.drawLine({ start: { x: x + 1.4, y: y + 2.6 }, end: { x: x + 3.2, y: y + 0.6 }, thickness: 1.2, color: INK }); w.page.drawLine({ start: { x: x + 3.2, y: y + 0.6 }, end: { x: x + 6.4, y: y + 5.6 }, thickness: 1.2, color: INK }); }
}
type Row = { head?: string; span?: string; k?: string; v?: string; bold?: boolean; red?: boolean; fill?: number; sign?: boolean; hint?: string; checks?: [string, boolean][]; note?: string };
/** A ruled table: prefilled values, blank lines to write by hand, tick boxes, a signature space, full-width statements and shaded headings. */
function table(w: PDF.Writer, rows: Row[], o: { kw?: number } = {}) {
  const kw = o.kw ?? 165, X = PDF.M, TW = PDF.PW - 2 * PDF.M, VX = X + kw, VW = TW - kw;
  let top = w.y + 9;
  for (const r of rows) {
    let h: number, draw: (t: number) => void;
    if (r.head || r.span) {
      const lines = wrap(r.head ? w.bold : w.font, r.head || r.span, SZ, TW - 2 * PAD);
      h = lines.length * LH + 2 * PAD;
      draw = (t) => { if (r.head) w.page.drawRectangle({ x: X, y: t - h, width: TW, height: h, color: SHADE }); lines.forEach((l, i) => txt(w, l, X + PAD, t - PAD - SZ + 1 - i * LH, { bold: !!r.head, color: r.head ? NAVY : INK })); };
    } else {
      const kl = wrap(w.bold, r.k, SZ, kw - 2 * PAD);
      const note = r.note ? wrap(w.font, r.note, 7.2, VW - 2 * PAD) : [];
      let vh = 0, vdraw: (t: number) => void;
      if (r.checks) {
        const items = r.checks.map(([l, on]) => ({ l, on, wd: 11 + w.font.widthOfTextAtSize(PDF.W(l), SZ) + 14 }));
        const lines: typeof items[] = [];
        let cur: typeof items = [], cw = 0;
        for (const it of items) { if (cw + it.wd > VW - 2 * PAD && cur.length) { lines.push(cur); cur = []; cw = 0; } cur.push(it); cw += it.wd; }
        if (cur.length) lines.push(cur);
        vh = lines.length * (LH + 2);
        vdraw = (t) => lines.forEach((ln, i) => { let x = VX + PAD; const y = t - PAD - SZ + 1 - i * (LH + 2); for (const it of ln) { tick(w, x, y, it.on); txt(w, it.l, x + 11, y); x += it.wd; } });
      } else if (r.fill || r.sign) {
        vh = r.sign ? 32 : r.fill! * 16;
        vdraw = (t) => {
          if (r.hint) txt(w, r.hint, VX + PAD, t - PAD - 7, { size: 6.8, color: GREY });
          if (r.sign) w.page.drawLine({ start: { x: VX + PAD, y: t - vh + 4 }, end: { x: VX + VW - PAD, y: t - vh + 4 }, thickness: 0.6, color: LINE });
          else for (let i = 1; i <= r.fill!; i++) w.page.drawLine({ start: { x: VX + PAD, y: t - PAD - i * 16 + 5 }, end: { x: VX + VW - PAD, y: t - PAD - i * 16 + 5 }, thickness: 0.5, color: LINE, dashArray: [2, 2] });
        };
      } else {
        const lines = wrap(r.bold ? w.bold : w.font, r.v, SZ, VW - 2 * PAD);
        vh = lines.length * LH;
        vdraw = (t) => lines.forEach((l, i) => txt(w, l, VX + PAD, t - PAD - SZ + 1 - i * LH, { bold: !!r.bold, color: r.red ? RED : INK }));
      }
      const nh = note.length ? note.length * 9.4 + 2 : 0;
      h = Math.max(kl.length * LH, vh + nh) + 2 * PAD;
      draw = (t) => {
        w.page.drawRectangle({ x: X, y: t - h, width: kw, height: h, color: SHADE });
        w.page.drawLine({ start: { x: VX, y: t }, end: { x: VX, y: t - h }, thickness: 0.6, color: LINE });
        kl.forEach((l, i) => txt(w, l, X + PAD, t - PAD - SZ + 1 - i * LH, { bold: true }));
        vdraw(t);
        note.forEach((l, i) => txt(w, l, VX + PAD, t - PAD - vh - 7 - i * 9.4, { size: 7.2, color: GREY }));
      };
    }
    if (top - h < 64) { w.newPage(); top = w.y + 9; }
    draw(top);
    w.page.drawRectangle({ x: X, y: top - h, width: TW, height: h, borderColor: LINE, borderWidth: 0.6 });
    top -= h;
  }
  w.y = top - 18;
}

export async function evidenceCertificate(row: ISignedDocument, by: { name: string; staff_code?: string; username?: string }) {
  const d = (row.data ?? {}) as Any;
  const istS = (x?: Date | string | null) => (x ? `${fmtDateTime(x)} IST` : '-');
  const ddmmyyyy = (x: Date) => x.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' });
  const hhmm = (x: Date) => x.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
  // live check at the time the certificate is made
  let fileOk = false, nowHash: string | null = null, sealOk: boolean | null = null;
  try { const bytes = await readLocked(row); nowHash = crypto.createHash('sha256').update(bytes).digest('hex'); fileOk = nowHash === row.pdf_sha256; } catch (e) { if (/changed after signing/.test((e as Error).message)) sealOk = false; }
  if (sealOk === null && d.seal) sealOk = fileOk ? true : null;
  const g = d.guardian as Any | null;
  const madeAt = new Date();
  const nets = Object.entries(os.networkInterfaces()).flatMap(([n, l]) => (l ?? []).filter((x) => !x.internal && x.mac && x.mac !== '00:00:00:00:00:00').map((x) => `${x.mac} (${n})`));
  const cpu = os.cpus()[0]?.model ?? '';
  const sv = { make: `Server running ${os.type()} ${os.release()} (${os.arch()}), host name "${os.hostname()}"${cpu ? `, processor ${cpu.trim()}` : ''}`, mac: [...new Set(nets)].slice(0, 2).join(', ') || 'Not available on this server', node: process.version };
  const verifyUrl = `${env.portalUrl}/legal/verify?id=${row.doc_code}`;
  const address = String((await regVal('company_address')) || ''), llpin = String((await regVal('company_llpin')) || '');
  const firm = `Euroverse Service LLP (trading as La Europa Education)${llpin ? `, LLPIN ${llpin}` : ''}`;
  const devices: [string, boolean][] = [['Computer / storage media', false], ['DVR', false], ['Mobile', false], ['Flash drive', false], ['CD / DVD', false], ['Server', true], ['Cloud', true], ['Other', false]];
  const other = `Vernyr portal (La Europa CRM) on Node.js ${sv.node}: MongoDB database (signed documents collection, append-only) and the Cloudinary file store. Document ID ${row.doc_code}; public check ${verifyUrl}.`;
  const algo: [string, boolean][] = [['SHA1', false], ['SHA256', true], ['MD5', false], ['Other', false]];

  const w = await PDF.create({ title: `Evidence certificate - ${row.doc_code}`, subject: 'Certificate under Section 63(4)(c), Bharatiya Sakshya Adhiniyam 2023', band: `Evidence certificate ${row.doc_code}`, date: madeAt });
  PDF.heading(w, 'Certificate under Section 63(4)(c) of the Bharatiya Sakshya Adhiniyam, 2023', 2);
  PDF.rich(w, 'For an electronic record produced in evidence. In the format of the **Schedule** to the Act (earlier the Section 65B certificate of the Indian Evidence Act, 1872). Part A is signed by the party producing the record; Part B is signed by an expert. Have your advocate check it before filing.', { size: 8.6, color: GREY });
  w.y -= 4;
  table(w, [{ head: 'Who fills and signs what' },
    { k: 'PART A (page 2)', v: 'The PARTY producing the record: the authorised signatory of Euroverse Service LLP, who has lawful control of the Vernyr system (any authorised person of the firm; not printed here). Already filled in: device, hash value and algorithm. Write by hand: name, designation, relation, date, time, place, and sign.' },
    { k: 'PART B (page 3)', v: 'The EXPERT: an independent examiner of electronic evidence, preferably an "Examiner of Electronic Evidence" notified by the Central Government under Section 79A of the IT Act 2000 (list on the MeitY website), or a digital forensic expert accepted by the court; never La Europa staff. The expert computes the hash value himself.' },
    { k: 'Attach', v: `Annexure H: hash report (page 4). Annexure R: the signed record ${row.doc_code}.pdf (download from the student file in the CRM; it must give the same SHA-256).` }], { kw: 110 });
  table(w, [{ head: '1. The electronic record' },
    { k: 'Record', v: 'Signed Student Declaration & Consent, with the Student Terms & Conditions (Student Constitution) annexed' },
    { k: 'Document ID', v: row.doc_code, bold: true },
    { k: 'File', v: `${row.doc_code}.pdf, ${d.pdf_bytes ?? '-'} bytes, ${d.pdf_pages ?? '-'} pages` },
    { k: 'SHA-256 of the PDF file', v: row.pdf_sha256 ?? '-', bold: true },
    { k: 'Versions signed', v: `Declaration v${d.consent_version}; Terms & Conditions v${d.constitution_version}` },
    { k: 'Signed by', v: `${row.typed_name} (typed full name) on ${istS(row.signed_at)} (${new Date(row.signed_at).toISOString()} UTC)` },
    { k: 'Parent / guardian', v: g ? `${g.name} (${g.relation}), separate one-time code to their own email` : 'Not applicable (signer is 18 or over)' }]);
  table(w, [{ head: '2. How the record was produced' },
    { span: `The signer logged in to their own account on the Vernyr student portal of ${firm}, read the document (server-measured reading time ${d.reading_sec_server ?? '-'} seconds), typed their full name and entered a one-time code sent to their own email. At that moment the system made the PDF once, saved its SHA-256 in an append-only record sealed with an HMAC, and stored the file. Every later download is checked against that SHA-256.` },
    { head: '3. Integrity check made when this certificate was generated' },
    { k: 'Checked at', v: `${istS(madeAt)} (${madeAt.toISOString()} UTC)` },
    { k: 'Stored file matches its SHA-256', v: fileOk ? 'Yes' : 'NO: do not use this record without investigation', bold: true, red: !fileOk },
    { k: 'Database record seal (HMAC)', v: sealOk === null ? (d.seal ? 'Could not be checked (stored file unreadable)' : 'Record made before the seal was introduced') : sealOk ? 'Valid' : 'NOT valid: do not use this record without investigation', red: sealOk === false },
    { k: 'Public check', v: verifyUrl },
    { k: 'Certificate generated by', v: `${by.name} (${by.staff_code || by.username || ''}), CRM user` }]);
  w.newPage();
  PDF.heading(w, 'PART A  (to be filled by the party)', 2);
  table(w, [
    { k: 'I, (name)', fill: 1, hint: 'full name of the authorised person signing' }, { k: 'Designation', fill: 1, hint: 'e.g. Designated Partner / Director / Authorised Signatory' },
    { k: 'Son / daughter / spouse of', fill: 1, hint: 'write by hand' },
    { k: 'Residing / employed at', v: `${firm}${address ? `, ${address}` : ''}`, ...(address ? {} : { note: 'Write the registered office address after the firm name (it is not set in Settings > Company yet).' }) },
    { span: 'do hereby solemnly affirm and sincerely state and submit as follows:' },
    { span: 'I have produced the electronic record / output of the digital record taken from the following device / digital record source (tick mark):' },
    { k: 'Device / record source', checks: devices }, { k: 'Other', v: other }, { k: 'Make & model', v: sv.make }, { k: 'Colour', v: 'Not applicable (server)' },
    { k: 'Serial number / instance ID', fill: 1, hint: 'server or cloud instance ID from the hosting provider' }, { k: 'IMEI / UIN / UID / MAC / Cloud ID', v: sv.mac },
    { k: 'Any other relevant information', v: `The record is checked against its SHA-256 before every download. It was copied from the CRM on ${istS(madeAt)}.` },
    { span: 'The digital device or the digital record source was under lawful control for regularly creating, storing or processing information for the purposes of carrying out regular activities, and during this period the computer or the communication device was working properly and the relevant information was regularly fed into the computer during the ordinary course of business. If the computer / digital device at any point of time was not working properly or out of operation, then it has not affected the electronic / digital record or its accuracy. The digital device or the source of the digital record is:' },
    { k: 'The device / source is (by me)', checks: [['Owned', false], ['Maintained', false], ['Managed', true], ['Operated', true]], note: 'Tick also Owned / Maintained if the firm owns or maintains the server itself.' },
    { k: 'HASH value of the record', v: row.pdf_sha256 ?? '-', bold: true },
    { k: 'Obtained through the algorithm', checks: algo, note: 'Legally acceptable standard. Hash report enclosed as Annexure H (page 4).' },
    { k: 'Name', fill: 1 }, { k: 'Signature', sign: true, hint: 'sign here' },
    { k: 'Date (DD/MM/YYYY)', fill: 1, hint: `date of signing (record copied on ${ddmmyyyy(madeAt)} at ${hhmm(madeAt)} IST)` }, { k: 'Time (IST, 24 hours)', fill: 1 }, { k: 'Place', fill: 1, hint: 'city' }]);
  w.newPage();
  PDF.heading(w, 'PART B  (to be filled by the expert)', 2);
  PDF.rich(w, 'For the expert: work out the SHA-256 hash of the copy produced in court (Annexure R) yourself. It must be exactly the value printed below; if it is not, do not sign and record what you found.', { size: 8.6, color: GREY });
  w.y -= 2;
  table(w, [
    { k: 'I, (name)', fill: 1 }, { k: 'Son / daughter / spouse of', fill: 1 }, { k: 'Residing / employed at', fill: 2 },
    { span: 'do hereby solemnly affirm and sincerely state and submit as follows:' },
    { span: 'The produced electronic record / output of the digital record is obtained from the following device / digital record source (tick mark):' },
    { k: 'Device / record source', checks: devices }, { k: 'Other', v: other }, { k: 'Make & model', v: sv.make }, { k: 'Colour', v: 'Not applicable (server)' },
    { k: 'Serial number / instance ID', fill: 1 }, { k: 'IMEI / UIN / UID / MAC / Cloud ID', v: sv.mac },
    { k: 'Any other relevant information', fill: 2, hint: 'e.g. tool used and how the copy was received' },
    { k: 'HASH value of the record (expected)', v: row.pdf_sha256 ?? '-', bold: true }, { k: 'HASH value found by the expert', fill: 2, hint: 'write the value you computed' },
    { k: 'Obtained through the algorithm', checks: algo, note: 'Hash report to be enclosed with the certificate.' },
    { k: 'Name and designation', fill: 1 }, { k: 'Signature', sign: true, hint: 'sign here' }, { k: 'Date (DD/MM/YYYY)', fill: 1 }, { k: 'Time (IST, 24 hours)', fill: 1 }, { k: 'Place', fill: 1 }]);
  w.newPage();
  PDF.heading(w, 'Annexure H: hash report', 2);
  table(w, [
    { k: 'File', v: `${row.doc_code}.pdf` }, { k: 'Size', v: `${d.pdf_bytes ?? '-'} bytes, ${d.pdf_pages ?? '-'} pages` }, { k: 'Algorithm', v: 'SHA-256 (FIPS 180-4)' },
    { k: 'Hash recorded at signing', v: `${row.pdf_sha256}  (${istS(row.signed_at)})`, bold: true },
    { k: 'Hash computed now', v: nowHash ? `${nowHash}  (${istS(madeAt)})` : 'Could not read the stored file', bold: true, red: !fileOk },
    { k: 'Result', v: fileOk ? 'MATCH: the stored file is unchanged since signing' : 'NO MATCH: investigate before use', bold: true, red: !fileOk },
    { k: 'Hash of the signed text', v: row.content_hash },
    { k: 'Computed by', v: `Vernyr portal (Node.js ${sv.node} crypto, SHA-256) on host "${os.hostname()}"` },
    { k: 'Check it yourself (Windows)', v: `certutil -hashfile "${row.doc_code}.pdf" SHA256` },
    { k: 'Check it yourself (Linux / Mac)', v: `sha256sum "${row.doc_code}.pdf"   or   shasum -a 256 "${row.doc_code}.pdf"` },
    { k: 'Online check', v: `${verifyUrl} (shows the SHA-256 recorded by La Europa, to compare)` }]);
  return PDF.finish(w, `${row.doc_code} | Evidence certificate (BSA 2023, s.63(4)(c) and Schedule) | made ${madeAt.toISOString()}`);
}
export { Student };
