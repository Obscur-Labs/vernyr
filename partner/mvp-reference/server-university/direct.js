'use strict';
const VAULT = require('../vault'); // files are stored AES-256-GCM encrypted
// University <-> student, directly (La Europa decision, Nov 2026). The university can send the student: generated or uploaded offer letters
// (conditional / unconditional), a tuition fee invoice, an agreement (the student accepts it with a typed name, IP and time recorded), other documents,
// and messages. Everything appears in the student portal ("From your university") and the La Europa counsellor / agency always gets a copy.
// The student's phone and email are never shown to the university: all of this goes through the portal.
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { db, all, get, run, insert, update, uuid, now, nextCode, getSetting } = require('../db');
const U = require('../util');
const { bad, ah, clean, num, notify, fmtDate, fieldErr, HttpError } = U;
const files = require('../files');
const email = require('../email');
const C = require('./common');
const PDF = require('../pdfdoc');

db.exec(`CREATE TABLE IF NOT EXISTS uni_student_items (id TEXT PRIMARY KEY, uapp_id TEXT NOT NULL, application_id TEXT, student_id TEXT NOT NULL, university_id TEXT NOT NULL,
  kind TEXT NOT NULL, title TEXT, body TEXT, document_id TEXT, version_id TEXT, amount REAL, currency TEXT, due_date TEXT, ref_no TEXT, needs_acceptance INTEGER DEFAULT 0,
  status TEXT DEFAULT 'Sent', viewed_at TEXT, accepted_at TEXT, accepted_name TEXT, accepted_ip TEXT, accepted_ua TEXT, sender_type TEXT NOT NULL, sender_uni_user_id TEXT, sender_student_user_id TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_usi_uapp ON uni_student_items(uapp_id); CREATE INDEX IF NOT EXISTS ix_usi_student ON uni_student_items(student_id);`);

const KIND = { offer_letter: 'Offer letter', loa: 'Final Letter of Acceptance', invoice: 'Tuition fee invoice', receipt: 'Fee payment receipt', agreement: 'Agreement', document: 'Document', message: 'Message' };
const ctxOf = (ua) => { const a = get('SELECT * FROM applications WHERE id = ?', ua.application_id); const s = a && get('SELECT * FROM students WHERE id = ?', a.student_id); return { a, s }; };
const suOf = (s) => s && get(`SELECT id FROM student_users WHERE (student_id = ? OR (lead_id IS NOT NULL AND lead_id = ?)) AND is_deleted = 0 AND status != 'Deactivated' ORDER BY created_at LIMIT 1`, s.id, s.lead_id || '');
const uniLabel = (u) => (u && (u.display_name || u.name)) || 'Your university';

// tell the student (portal + email) and give La Europa / the agency a copy
function fanOut(ua, item, uni) {
  const { a, s } = ctxOf(ua); if (!s) return;
  const su = suOf(s);
  const what = item.kind === 'message' ? 'sent you a message' : `sent you ${item.kind === 'invoice' ? 'a tuition fee invoice' : item.kind === 'receipt' ? 'a fee payment receipt' : item.kind === 'loa' ? 'your final Letter of Acceptance (for the visa)' : item.kind === 'agreement' ? 'an agreement' + (item.needs_acceptance ? ' to accept' : '') : item.kind === 'offer_letter' ? 'your offer letter' : 'a document'}`;
  if (su) email.studentNotify(su.id, 'university', `${uniLabel(uni)} ${what}`, '#/university');
  if (s.email) email.sendSecurity({ to: s.email, subject: `${uniLabel(uni)} ${what}`, text: `Hello ${s.first_name},\n\n${uniLabel(uni)} ${what} about your application (${(get('SELECT name FROM courses WHERE id = ?', a.course_id) || {}).name || a.course_name_text || 'your course'}).\nOpen your La Europa student portal to see it: ${email.portalUrl()}/#/university\n\nLa Europa Education`, student_id: s.id });
  for (const h of C.handlers(a)) notify(h, 'university', `${uniLabel(uni)} ${what.replace('you', s.first_name)} (${a.application_code}): copy for La Europa`, `#/students/${s.id}/applications`);
  U.timeline({ student_id: s.id, type: 'university', description: `${uniLabel(uni)} ${what.replace('you', 'the student')}${item.title ? ': ' + item.title : ''} (direct to the student, copy for La Europa)`, link: `app:${a.id}` });
}
function addItem(req, ua, o) {
  const { a, s } = ctxOf(ua);
  const id = uuid();
  insert('uni_student_items', { id, uapp_id: ua.id, application_id: a.id, student_id: s.id, university_id: ua.university_id, kind: o.kind, title: o.title || null, body: o.body || null, document_id: o.document_id || null,
    version_id: o.version_id || null, amount: o.amount ?? null, currency: o.currency || null, due_date: o.due_date || null, ref_no: o.ref_no || null, needs_acceptance: o.needs_acceptance ? 1 : 0,
    status: 'Sent', sender_type: o.sender_type || 'university', sender_uni_user_id: req.uu ? req.uu.id : null, sender_student_user_id: req.su ? req.su.id : null, created_at: now() });
  return get('SELECT * FROM uni_student_items WHERE id = ?', id);
}
// write a generated PDF to a temp file that looks like an uploaded file (so the normal document code can store it)
function tempFile(buf, name) {
  const p = path.join(os.tmpdir(), `le-gen-${uuid()}.pdf`); fs.writeFileSync(p, buf);
  return { path: p, originalname: name, size: buf.length, mimetype: 'application/pdf' };
}
function saveDoc(req, ua, file, typeName, title) {
  const { a } = ctxOf(ua);
  const { ext, mime } = files.checkFile(file, ['pdf', 'jpg', 'jpeg', 'png'], 25);
  const tid = files.typeId(typeName) || files.typeId('Others');
  const doc = files.docFor(a.student_id, tid, { title: title || (files.typeId(typeName) ? null : typeName), application_id: a.id }, null);
  if (!doc.application_id) run('UPDATE documents SET application_id = ? WHERE id = ?', a.id, doc.id);
  const v = files.addVersion(doc, file.path, file.originalname, mime, ext, req.uu.id, 'university', {});
  run(`UPDATE documents SET status = 'Verified', verified_at = ? WHERE id = ?`, now(), doc.id); run(`UPDATE document_versions SET version_status = 'Verified' WHERE id = ?`, v.id);
  return { doc, v };
}
const money = (n, c) => `${(Math.round(Number(n || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c || ''}`.trim();
function letterHead(uni) {
  const country = U.masterName(uni.country_id);
  return { brand: uniLabel(uni), brandSub: [uni.city, country].filter(Boolean).join(', ') || 'Admissions office', footer: `${uniLabel(uni)} | Issued through the La Europa partner portal` };
}

// ---------- generated offer letter (conditional / unconditional) ----------
// generated offer letter: official university letterhead, 5 formats (letters.js); nothing of La Europa on it
async function offerPdfFile(req, ua, b, type) {
  const LT = require('./letters'); const set = LT.settingsOf(ua.university_id);
  const cond = type === 'conditional_offer' || b.letter_type === 'Conditional';
  if (clean(b.student_uni_id)) run('UPDATE university_applications SET student_uni_id = ? WHERE id = ?', clean(b.student_uni_id, 50), ua.id);
  const fresh = get('SELECT * FROM university_applications WHERE id = ?', ua.id);
  const buf = await LT.build(cond ? 'offer_conditional' : 'offer_unconditional', { uni: C.uni(ua.university_id), set, ua: fresh, b });
  const { a } = ctxOf(ua);
  return tempFile(buf, `${cond ? 'Conditional' : 'Unconditional'}-offer-letter-${(fresh.student_uni_id || a.application_code).replace(/[^A-Za-z0-9-]/g, '')}.pdf`);
}

// after any offer letter (generated or uploaded) the student gets it directly
function pushOffer(req, ua, letterId) {
  const ol = letterId && get('SELECT * FROM offer_letters WHERE id = ?', letterId); if (!ol || !ol.document_id) return;
  if (get('SELECT 1 x FROM uni_student_items WHERE kind = ? AND version_id = ?', 'offer_letter', ol.version_id)) return;
  const item = addItem(req, ua, { kind: 'offer_letter', title: `${ol.type} offer letter`, document_id: ol.document_id, version_id: ol.version_id });
  fanOut(ua, item, req.uni);
}

// ---------- university side (/api/university) ----------
const uni = express.Router();
const role = (req, ...r) => { if (!r.includes(req.uu.role) || req.preview) throw new HttpError(403, 'Your role does not allow this action.'); };
const loadUA = (req, id) => require('./routes').loadUA(req, id);
const itemOut = (x) => ({ id: x.id, kind: x.kind, kind_label: KIND[x.kind], title: x.title, body: x.body, amount: x.amount, currency: x.currency, due_date: x.due_date, ref_no: x.ref_no, needs_acceptance: !!x.needs_acceptance,
  status: x.status, viewed_at: x.viewed_at, accepted_at: x.accepted_at, accepted_name: x.accepted_name, sender: x.sender_type === 'student' ? 'Student' : (get('SELECT name FROM uni_users WHERE id = ?', x.sender_uni_user_id) || {}).name || 'University',
  mine: x.sender_type === 'university', has_file: !!x.version_id, created_at: x.created_at });

uni.get('/applications/:id/student', ah(async (req, res) => {
  const ua = loadUA(req, req.params.id);
  run(`UPDATE uni_student_items SET viewed_at = COALESCE(viewed_at, ?) WHERE uapp_id = ? AND sender_type = 'student'`, now(), ua.id);
  res.json({ rows: all('SELECT * FROM uni_student_items WHERE uapp_id = ? ORDER BY created_at DESC', ua.id).map(itemOut), can_send: ['admin', 'officer'].includes(req.uu.role) && !req.preview,
    status: ua.status, invoice_ok: ['Conditional offer', 'Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'].includes(ua.status) });
}));
uni.get('/applications/:id/student/:itemId/file', ah(async (req, res) => {
  const ua = loadUA(req, req.params.id);
  const x = get('SELECT * FROM uni_student_items WHERE id = ? AND uapp_id = ?', req.params.itemId, ua.id); const v = x && x.version_id && get('SELECT * FROM document_versions WHERE id = ?', x.version_id);
  if (!v) throw C.NotFound();
  res.setHeader('Content-Type', v.mime_type); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Content-Disposition', `inline; filename="${String(v.stored_name).replace(/"/g, '')}"`);
  VAULT.pipe(files.filePath(v.file_key), res);
}));
uni.post('/applications/:id/student/message', ah(async (req, res) => {
  role(req, 'admin', 'officer'); const ua = loadUA(req, req.params.id);
  const body = clean(req.body.body, 3000); if (!body) throw fieldErr('body', 'Write a message');
  if (/\b\d{10}\b|@[a-z0-9-]+\.[a-z]{2,}/i.test(body) && !req.uni.share_contact) { /* allowed: the university may share its own contact details */ }
  const item = addItem(req, ua, { kind: 'message', body });
  fanOut(ua, item, req.uni); C.uaudit(req, 'Message', 'UniversityStudent', ua.id, 'Message to the student');
  res.json({ ok: true });
}));
// tuition fee invoice to the student (generated PDF)
const OFFER_OK = ['Conditional offer', 'Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'];
// send a generated official document (invoice / receipt / LOA) to the student, store it in the student's documents and give La Europa a copy
async function sendGenerated(req, ua, kind, b, typeName, titleFn, itemExtra) {
  const LT = require('./letters'); const set = LT.settingsOf(ua.university_id);
  if (clean(b.student_uni_id)) run('UPDATE university_applications SET student_uni_id = ? WHERE id = ?', clean(b.student_uni_id, 50), ua.id);
  const fresh = get('SELECT * FROM university_applications WHERE id = ?', ua.id);
  const pre = { invoice: 'INV', receipt: 'RCPT', loa: 'LOA', offer_conditional: 'OFR', offer_unconditional: 'OFR' }[kind];
  const no = `${(req.uni.short_name || 'UNI').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()}-${pre}-${nextCode(pre).split('-').pop()}`;
  const buf = await LT.build(kind, { uni: req.uni, set, ua: fresh, b: { currency: set.currency, ...b }, no });
  const f = tempFile(buf, `${titleFn(no).replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, '-')}.pdf`);
  try {
    const { doc, v } = saveDoc(req, ua, f, typeName, titleFn(no));
    const item = addItem(req, ua, { kind, title: titleFn(no), document_id: doc.id, version_id: v.id, ref_no: no, currency: b.currency || set.currency, ...itemExtra });
    if (kind === 'loa') { const { a } = ctxOf(ua); const vc = get('SELECT id FROM visa_cases WHERE student_id = ? AND is_open = 1 AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1', a.student_id); if (vc) run('UPDATE documents SET visa_case_id = COALESCE(visa_case_id, ?) WHERE id = ?', vc.id, doc.id); }
    fanOut(ua, item, req.uni); return { item, no };
  } finally { files.cleanup(f); }
}
uni.get('/applications/:id/student/defaults', ah(async (req, res) => {
  const ua = loadUA(req, req.params.id); const set = require('./letters').settingsOf(ua.university_id);
  const paid = get(`SELECT COALESCE(SUM(amount), 0) s FROM uni_student_items WHERE uapp_id = ? AND kind = 'receipt'`, ua.id).s;
  const a = get('SELECT course_id FROM applications WHERE id = ?', ua.application_id); const course = a.course_id && get('SELECT tuition_fee, currency FROM courses WHERE id = ?', a.course_id);
  res.json({ format: set.default_format || 1, currency: set.currency || (course && course.currency) || 'EUR', tuition: set.tuition_default ?? (course ? course.tuition_fee : null), deposit: set.deposit_default, other_fees: set.other_fees,
    student_uni_id: ua.student_uni_id || '', paid_to_date: paid, has_bank: !!(set.bank_iban || set.bank_account_no), has_signature: !!set.signature_key, contact: { name: set.contact_name, designation: set.contact_designation, email: set.contact_email, phone: set.contact_phone },
    validity_days: set.offer_validity_days || 21, formats: require('./letters').FORMATS });
}));
// tuition fee invoice (official, generated)
uni.post('/applications/:id/student/invoice', ah(async (req, res) => {
  role(req, 'admin', 'officer'); const ua = loadUA(req, req.params.id);
  if (!OFFER_OK.includes(ua.status)) throw bad('A tuition fee invoice can be sent after an offer.');
  const b = req.body; const items = (Array.isArray(b.items) ? b.items : []).filter(i => i && clean(i.description) && num(i.amount) !== null);
  const errors = {};
  if (!items.length) errors.items = 'Add at least one line with an amount';
  if (items.some(i => num(i.amount) < 0)) errors.items = 'Amounts must be 0 or more';
  if (!b.due_date || b.due_date < U.istDate()) errors.due_date = 'Due date is required (today or later)';
  Object.assign(errors, C.feeWordCheck({ note: b.note }));
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  const total = items.reduce((t, i) => t + num(i.amount), 0) - (num(b.scholarship) || 0);
  const { no, item } = await sendGenerated(req, ua, 'invoice', { ...b, items }, 'Tuition fee invoice', (n) => `Tuition fee invoice ${n}`, { amount: Math.round(total * 100) / 100, due_date: b.due_date });
  C.uaudit(req, 'Create', 'TuitionInvoice', ua.id, `${no} ${money(total, b.currency)}`);
  res.json({ ok: true, id: item.id, invoice_no: no });
}));
// fee payment receipt (official, generated)
uni.post('/applications/:id/student/receipt', ah(async (req, res) => {
  role(req, 'admin', 'officer'); const ua = loadUA(req, req.params.id);
  if (!OFFER_OK.includes(ua.status)) throw bad('A payment receipt can be issued after an offer.');
  const b = { ...req.body }; const errors = {};
  if (!(num(b.amount) > 0)) errors.amount = 'Amount received is required';
  if (!b.payment_date || b.payment_date > U.istDate()) errors.payment_date = 'Payment date is required and cannot be in the future';
  if (b.total_fees !== undefined && b.total_fees !== '' && !(num(b.total_fees) >= 0)) errors.total_fees = 'Must be 0 or more';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  const before = get(`SELECT COALESCE(SUM(amount), 0) s FROM uni_student_items WHERE uapp_id = ? AND kind = 'receipt'`, ua.id).s;
  b.paid_to_date = Math.round((before + num(b.amount)) * 100) / 100; if (b.total_fees === '') delete b.total_fees;
  const { no, item } = await sendGenerated(req, ua, 'receipt', b, 'University receipt', (n) => `Fee payment receipt ${n}`, { amount: num(b.amount) });
  C.uaudit(req, 'Create', 'FeeReceipt', ua.id, `${no} ${money(b.amount, b.currency)}`);
  res.json({ ok: true, id: item.id, receipt_no: no, paid_to_date: b.paid_to_date });
}));
// final Letter of Acceptance for the visa
uni.post('/applications/:id/student/loa', ah(async (req, res) => {
  role(req, 'admin', 'officer'); const ua = loadUA(req, req.params.id);
  if (!['Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'].includes(ua.status)) throw bad('The final LOA can be issued after an unconditional offer.');
  const b = { ...req.body }; const errors = {};
  if (!clean(b.student_uni_id) && !ua.student_uni_id) errors.student_uni_id = 'Student ID is required on the LOA';
  if (!b.programme_start) errors.programme_start = 'Programme start date is required';
  if (!(num(b.total_fees) >= 0)) errors.total_fees = 'Total tuition fee is required';
  if (b.fees_paid !== undefined && b.fees_paid !== '' && !(num(b.fees_paid) >= 0)) errors.fees_paid = 'Must be 0 or more';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  if (b.fees_paid === undefined || b.fees_paid === '') b.fees_paid = get(`SELECT COALESCE(SUM(amount), 0) s FROM uni_student_items WHERE uapp_id = ? AND kind = 'receipt'`, ua.id).s;
  const { no, item } = await sendGenerated(req, ua, 'loa', b, 'Acceptance letter for visa', (n) => `Final Letter of Acceptance ${n}`, { amount: num(b.fees_paid) });
  C.uaudit(req, 'Create', 'FinalLOA', ua.id, no);
  res.json({ ok: true, id: item.id, loa_no: no });
}));

// agreement or any document to the student: from text (PDF generated) or an uploaded file; an agreement can ask the student to accept it
uni.post('/applications/:id/student/document', files.upload.single('file'), ah(async (req, res) => {
  let f = req.file;
  try {
    role(req, 'admin', 'officer'); const ua = loadUA(req, req.params.id); const b = req.body;
    const kind = b.kind === 'agreement' ? 'agreement' : 'document';
    const title = clean(b.title, 150); if (!title) throw fieldErr('title', 'Title is required');
    if (!f && !clean(b.text)) throw fieldErr('text', 'Write the text or upload a file');
    if (!f) {
      // on the university's own letterhead (same formats as the offer letters), nothing of La Europa
      const { s } = ctxOf(ua); const LT = require('./letters'); const set = LT.settingsOf(ua.university_id);
      const sid = ua.student_uni_id || ua.university_ref;
      const buf = await LT.render({ uni: req.uni, set, format: Number(b.format) || set.default_format || 1, badge: kind === 'agreement' ? 'AGREEMENT' : 'DOCUMENT', title,
        refs: [['Date', fmtDate(U.istDate())], ...(sid ? [['Student ID', sid]] : [])], to: [U.fullName(s)], studentName: U.fullName(s), blocks: [{ p: clean(b.text, 20000) }],
        closing: kind === 'agreement' && (b.needs_acceptance === true || b.needs_acceptance === 'true') ? 'The student accepts this agreement online; the typed name, IP address and time of acceptance are recorded.' : null });
      f = tempFile(buf, `${title.replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 60) || 'document'}.pdf`);
    }
    const { doc, v } = saveDoc(req, ua, f, kind === 'agreement' ? 'University agreement' : 'Other university document', title);
    const item = addItem(req, ua, { kind, title, body: clean(b.message, 2000), document_id: doc.id, version_id: v.id, needs_acceptance: kind === 'agreement' && (b.needs_acceptance === true || b.needs_acceptance === 'true') });
    fanOut(ua, item, req.uni); C.uaudit(req, 'Create', 'UniversityStudentDocument', ua.id, `${KIND[kind]}: ${title}`);
    res.json({ ok: true, id: item.id });
  } finally { files.cleanup(f); files.cleanup(req.file); }
}));
// counsellor-like tracking: every application of this university by status, with what was sent to each student
uni.get('/pipeline', ah(async (req, res) => {
  const w = ['ua.university_id = ?', 'ua.is_deleted = 0']; const p = [req.uu.university_id];
  if (req.campuses.length) { w.push(`ua.campus_id IN (${req.campuses.map(() => '?').join(',')})`); p.push(...req.campuses); }
  const rows = all(`SELECT ua.* FROM university_applications ua WHERE ${w.join(' AND ')} ORDER BY COALESCE(ua.updated_at, ua.created_at) DESC LIMIT 1000`, ...p).map(ua => {
    const v = C.appView(ua);
    const last = get('SELECT kind, created_at FROM uni_student_items WHERE uapp_id = ? ORDER BY created_at DESC LIMIT 1', ua.id);
    const inv = get(`SELECT status, amount, currency, due_date FROM uni_student_items WHERE uapp_id = ? AND kind = 'invoice' ORDER BY created_at DESC LIMIT 1`, ua.id);
    const agr = get(`SELECT accepted_at FROM uni_student_items WHERE uapp_id = ? AND kind = 'agreement' AND needs_acceptance = 1 ORDER BY created_at DESC LIMIT 1`, ua.id);
    const unread = get(`SELECT COUNT(*) c FROM uni_student_items WHERE uapp_id = ? AND sender_type = 'student' AND viewed_at IS NULL`, ua.id).c;
    return { id: ua.id, code: v.application_code, student: v.student_name || v.name, course: v.course, intake: v.intake, status: ua.status, updated_at: ua.updated_at || ua.created_at,
      last_sent: last ? { kind: KIND[last.kind], at: last.created_at } : null, invoice: inv ? { amount: inv.amount, currency: inv.currency, due_date: inv.due_date } : null, agreement: agr ? (agr.accepted_at ? 'Accepted' : 'Waiting') : null, unread_student: unread };
  });
  res.json({ statuses: C.STATUSES, rows });
}));

// ---------- student side (/api/portal) ----------
const portal = express.Router();
const myStudent = (req) => { if (!req.c || !req.c.student) return null; return req.c.student; };
portal.get('/university-items', ah(async (req, res) => {
  const s = myStudent(req); if (!s) return res.json({ groups: [] });
  const groups = all(`SELECT DISTINCT uapp_id FROM uni_student_items WHERE student_id = ?`, s.id).map(x => {
    const ua = get('SELECT * FROM university_applications WHERE id = ?', x.uapp_id); const u = ua && C.uni(ua.university_id); const a = ua && get('SELECT * FROM applications WHERE id = ?', ua.application_id);
    if (!ua || !a) return null;
    const items = all('SELECT * FROM uni_student_items WHERE uapp_id = ? ORDER BY created_at DESC', ua.id).map(i => ({ ...itemOut(i), sender: i.sender_type === 'student' ? 'You' : uniLabel(u), mine: i.sender_type === 'student',
      file_url: i.version_id ? require('../portal/common').psign(i.version_id, req.su.id) : null }));
    if (!req.preview) run(`UPDATE uni_student_items SET viewed_at = COALESCE(viewed_at, ?), status = CASE WHEN status = 'Sent' AND kind != 'message' THEN 'Viewed' ELSE status END WHERE uapp_id = ? AND sender_type = 'university'`, now(), ua.id);
    return { uapp_id: ua.id, university: uniLabel(u), course: (a.course_id && (get('SELECT name FROM courses WHERE id = ?', a.course_id) || {}).name) || a.course_name_text, intake: U.masterName(a.intake_id), status: ua.status, items };
  }).filter(Boolean);
  res.json({ groups });
}));
portal.post('/university-items/:id/accept', ah(async (req, res) => {
  const s = myStudent(req); const x = s && get(`SELECT * FROM uni_student_items WHERE id = ? AND student_id = ? AND kind = 'agreement' AND needs_acceptance = 1`, req.params.id, s.id);
  if (!x) throw require('../portal/common').notFound();
  if (x.accepted_at) throw bad('You already accepted this agreement');
  const name = clean(req.body.signature_name, 100); if (!name || name.length < 3) throw fieldErr('signature_name', 'Type your full name as your signature');
  if (!req.body.confirm) throw fieldErr('confirm', 'Please tick that you have read and accept the agreement');
  run(`UPDATE uni_student_items SET status = 'Accepted', accepted_at = ?, accepted_name = ?, accepted_ip = ?, accepted_ua = ? WHERE id = ?`, now(), name, req.ip, String(req.headers['user-agent'] || '').slice(0, 300), x.id);
  require('../portal/consent').record(req, { suId: req.su.id, type: 'university_agreement', value: true, method: 'portal_typed_signature', extra: { signature_name: name, item_id: x.id, title: x.title }, universityId: x.university_id, applicationId: x.application_id });
  const ua = get('SELECT * FROM university_applications WHERE id = ?', x.uapp_id); const a = get('SELECT * FROM applications WHERE id = ?', x.application_id);
  C.notifyUni(x.university_id, { roles: ['admin', 'officer'] }, `${U.fullName(s)} accepted the agreement "${x.title}"`, `#/applications/${ua.id}`);
  for (const h of C.handlers(a)) notify(h, 'university', `${U.fullName(s)} accepted the university agreement "${x.title}" (${a.application_code})`, `#/students/${s.id}/applications`);
  U.timeline({ student_id: s.id, type: 'university', description: `Student accepted the university agreement "${x.title}" (typed name "${name}", IP ${req.ip})` });
  res.json({ ok: true });
}));
portal.post('/university-items/reply/:uappId', ah(async (req, res) => {
  const s = myStudent(req); if (!s) throw require('../portal/common').notFound();
  const ua = get('SELECT * FROM university_applications WHERE id = ? AND is_deleted = 0', req.params.uappId);
  const a = ua && get('SELECT * FROM applications WHERE id = ? AND student_id = ?', ua.application_id, s.id);
  if (!a || !get('SELECT 1 x FROM uni_student_items WHERE uapp_id = ?', ua.id)) throw require('../portal/common').notFound();
  const body = clean(req.body.body, 3000); if (!body) throw fieldErr('body', 'Write a message');
  addItem(req, ua, { kind: 'message', body, sender_type: 'student' });
  C.notifyUni(ua.university_id, { roles: ['admin', 'officer'] }, `New message from ${U.fullName(s)} (${a.application_code})`, `#/applications/${ua.id}`);
  for (const h of C.handlers(a)) notify(h, 'university', `${U.fullName(s)} replied to ${uniLabel(C.uni(ua.university_id))} (${a.application_code}): copy for La Europa`, `#/students/${s.id}/applications`);
  res.json({ ok: true });
}));

// ---------- La Europa copy (/api, staff) ----------
const staff = express.Router();
staff.get('/applications/:aid/university-student', ah(async (req, res) => {
  const { loadChild } = require('../rbac');
  const { row: a } = loadChild(req.user, 'applications', req.params.aid);
  res.json({ rows: all('SELECT * FROM uni_student_items WHERE application_id = ? ORDER BY created_at DESC', a.id).map(x => ({ ...itemOut(x), file_url: x.version_id ? files.sign(x.version_id, req.user.id) : null })) });
}));

module.exports = { uni, portal, staff, offerPdfFile, pushOffer, sendGenerated, KIND };
