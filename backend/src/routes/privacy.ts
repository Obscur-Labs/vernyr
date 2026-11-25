import { Router } from 'express';
import ExcelJS from 'exceljs';
import { authenticate, type AuthRequest } from '../middleware/auth';
import PortalAccount from '../models/PortalAccount';
import Student from '../models/Student';
import Lead from '../models/Lead';
import { ConsentRecord } from '../models/Portal';
import { ConsentDocument, PrivacyRequest, Breach, Processor, PrivacyNotice } from '../models/Privacy';
import { audit, getSetting, setSetting } from '../models/Audit';
import { bad, fieldErr, forbidden, notFound, handle, isAdmin, oid, clean, isEmail, escRx, istDate, userNames, nameIn, fullName } from '../services/crm';
import { notifyAdmins } from '../services/tasks';
import { studentNotify, sendSecurity } from '../services/email';
import { TYPES, REQUIRED, INCLUDED, REQ_LABEL, current, publish, hash, fill, missing } from '../services/consent';
import { PHASES, noticeVersion, noticeText, pendingPeople, sendNotice, coldMonths, coldLeads, runRetention, replyDays, breachTemplates } from '../services/dpdp';
import { fmtDate } from '../services/invoicePdf';

/** Admin > Legal & privacy (legacy/server/routes/privacy_admin.js) and the India DPDP tools (legacy/server/dpdp.js). Mounted on /api/admin. */
const router = Router();
router.use(authenticate);
router.use('/privacy', (req: AuthRequest, _res, next) => next(isAdmin(req) ? undefined : forbidden()));

const OTHER_LABELS: Record<string, string> = { communication: 'Service communication', marketing: 'Newsletters and offers', referral_contact: 'Friend referral contact',
  guardian: 'Parent / guardian consent', age_declaration: 'Age declaration', nomination: 'Nominee (DPDP)', sale_share_opt_out: 'Do not sell / share (US)', limit_sensitive: 'Limit sensitive data (US)' };
const LEGAL_KEYS = ['legal_name', 'company_address', 'privacy_email', 'grievance_officer_name', 'grievance_officer_email', 'grievance_officer_phone', 'dpo_contact', 'eu_representative', 'retention_years'];
const OPEN = ['Open', 'In progress'];
async function whoOf(suId: unknown) {
  const su = suId ? await PortalAccount.findById(suId).lean() : null;
  if (!su) return { name: '-', code: '' };
  const s = su.studentId ? await Student.findById(su.studentId).select('first_name middle_name last_name student_code').lean() : null;
  const l = !s && su.leadId ? await Lead.findById(su.leadId).select('first_name last_name lead_code').lean() : null;
  return { name: s ? fullName(s) : l ? [l.first_name, l.last_name].filter(Boolean).join(' ') : su.name, code: s?.student_code ?? l?.lead_code ?? '', email: su.email,
    student_id: su.studentId ?? null, lead_id: su.leadId ?? null };
}
const live = { role: 'student', status: { $nin: ['Deactivated', 'Pending verification'] } };

// ---------- overview ----------
router.get('/privacy/overview', handle(async (_req, res) => {
  const names = await userNames();
  const accounts = await PortalAccount.find(live).select('_id').lean();
  let pending = 0;
  for (const a of accounts) if ((await missing(a._id)).length) pending++;
  await current('student_consent'); // seeds La Europa's texts
  res.json({
    settings: Object.fromEntries(await Promise.all(LEGAL_KEYS.map(async (k) => [k, String((await getSetting(k)) ?? '')]))),
    documents: await Promise.all(Object.keys(TYPES).map(async (type) => ({ type, title: TYPES[type], required: REQUIRED.includes(type),
      versions: await Promise.all((await ConsentDocument.find({ doc_type: type }).sort({ published_at: -1 }).lean()).map(async (v) => ({
        id: String(v._id), version: v.version, is_current: v.is_current, published_at: v.published_at, change_note: v.change_note, hash: v.body_hash.slice(0, 16),
        by: nameIn(names, v.published_by) || 'System', accepted: (await ConsentRecord.distinct('student_user_id', { document_id: v._id, value: 'yes' })).length }))) }))),
    counts: { open: await PrivacyRequest.countDocuments({ status: { $in: OPEN } }), overdue: await PrivacyRequest.countDocuments({ status: { $in: OPEN }, due_at: { $lt: new Date() } }),
      accounts: accounts.length, pending_consent: pending, minors: await PortalAccount.countDocuments({ role: 'student', 'flags.is_minor': true }),
      breaches_open: await Breach.countDocuments({ status: { $ne: 'Closed' } }) },
  });
}));
router.put('/privacy/settings', handle(async (req, res) => {
  const b = req.body ?? {};
  if (b.privacy_email && !isEmail(b.privacy_email)) throw fieldErr('privacy_email', 'Enter a valid email');
  if (b.grievance_officer_email && !isEmail(b.grievance_officer_email)) throw fieldErr('grievance_officer_email', 'Enter a valid email');
  if (b.retention_years && !(Number(b.retention_years) >= 1 && Number(b.retention_years) <= 15)) throw fieldErr('retention_years', '1 to 15 years');
  for (const k of LEGAL_KEYS) if (k in b) await setSetting(k, clean(b[k], 300) ?? '', req.user!.id);
  await audit(req, 'Update', 'Settings', null, 'Legal & privacy contacts changed');
  res.json({ ok: true });
}));

// ---------- legal documents: published, versioned, never edited ----------
router.get('/privacy/documents/:id', handle(async (req, res) => {
  const d = await ConsentDocument.findById(oid(req.params.id)).lean();
  if (!d) throw notFound();
  res.json({ ...d, id: String(d._id), filled: await fill(d.body) });
}));
router.post('/privacy/documents/:type/publish', handle(async (req, res) => {
  const type = req.params.type;
  if (!TYPES[type]) throw notFound();
  const body = String(req.body?.body ?? '').replace(/\r\n/g, '\n').trim();
  if (body.length < 200) throw fieldErr('body', 'The document looks too short');
  const note = clean(req.body?.change_note, 300);
  if (!note) throw fieldErr('change_note', 'Describe what changed (shown in the history)');
  const cur = await current(type);
  if (cur && cur.body_hash === hash(body)) throw bad('Nothing changed compared to the current version');
  const v = await publish(type, body, note, req.user!.id);
  await audit(req, 'Create', 'LegalDocument', type, `Published ${TYPES[type]} v${v}`);
  // every student accepts the new version at the next login
  if ([...REQUIRED, ...INCLUDED].includes(type) && req.body?.notify)
    for (const su of await PortalAccount.find({ role: 'student', status: 'Active' }).select('_id').lean()) await studentNotify(su._id, `We updated our ${TYPES[type]} (v${v}). Please read and accept it at your next login.`, '/home');
  res.json({ ok: true, version: v });
}));

// ---------- consent log (append-only, exportable) ----------
async function consentRows(q: Record<string, string>, all = false) {
  const f: Record<string, unknown> = {};
  if (q.type) f.consent_type = q.type;
  if (q.value) f.value = q.value;
  if (q.from || q.to) f.createdAt = { ...(q.from ? { $gte: new Date(q.from) } : {}), ...(q.to ? { $lte: new Date(q.to + 'T23:59:59Z') } : {}) };
  if (oid(q.student_user_id)) f.student_user_id = oid(q.student_user_id);
  if (q.q) {
    const rx = new RegExp(escRx(String(q.q)), 'i');
    const [st, ld] = await Promise.all([Student.distinct('_id', { $or: [{ student_code: rx }, { first_name: rx }, { last_name: rx }] }), Lead.distinct('_id', { $or: [{ lead_code: rx }, { first_name: rx }, { last_name: rx }] })]);
    f.student_user_id = { $in: await PortalAccount.distinct('_id', { $or: [{ email: rx }, { studentId: { $in: st } }, { leadId: { $in: ld } }] }) };
  }
  const rows = await ConsentRecord.find(f).sort({ createdAt: -1 }).limit(all ? 20000 : 500).lean();
  return Promise.all(rows.map(async (x) => ({ ...x, id: String(x._id), _id: undefined, created_at: x.createdAt, ...(await whoOf(x.student_user_id)),
    title: TYPES[x.consent_type] || OTHER_LABELS[x.consent_type] || x.consent_type })));
}
router.get('/privacy/consents', handle(async (req, res) => { res.json({ rows: await consentRows(req.query as Record<string, string>) }); }));
router.get('/privacy/consents.xlsx', handle(async (req, res) => {
  const rows = await consentRows(req.query as Record<string, string>, true);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Consent log');
  ws.columns = ([['Date (UTC)', 'created_at', 22], ['Student', 'name', 24], ['ID', 'code', 16], ['Consent', 'title', 26], ['Version', 'document_version', 9], ['Text SHA-256', 'document_hash', 30],
    ['Value', 'value', 7], ['How', 'method', 18], ['Scrolled to end', 'scrolled', 9], ['Reading time (s)', 'time_spent_sec', 9], ['IP', 'ip', 16], ['Time zone', 'timezone', 16],
    ['Device', 'user_agent', 40], ['Details', 'details', 40]] as [string, string, number][]).map(([header, key, width]) => ({ header, key, width }));
  ws.getRow(1).font = { bold: true };
  for (const x of rows) ws.addRow({ ...x, created_at: x.created_at?.toISOString(), scrolled: x.scrolled_to_end == null ? '' : x.scrolled_to_end ? 'Yes' : 'No', details: x.extra ? JSON.stringify(x.extra) : '' });
  await audit(req, 'Export', 'ConsentRecord', null, `Consent log exported (${rows.length} rows)`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="consent-log.xlsx"');
  await wb.xlsx.write(res); res.end();
}));

// ---------- privacy rights requests with their legal deadlines ----------
router.get('/privacy/requests', handle(async (req, res) => {
  const st = String(req.query.status ?? '');
  const names = await userNames();
  const rows = (await PrivacyRequest.find(st === 'open' ? { status: { $in: OPEN } } : st ? { status: st } : {}).sort({ due_at: 1, createdAt: -1 }).limit(500).lean())
    .sort((a, b) => Number(!OPEN.includes(a.status)) - Number(!OPEN.includes(b.status)));
  res.json({ rows: await Promise.all(rows.map(async (x) => ({ ...x, ...(await whoOf(x.student_user_id)), id: String(x._id), _id: undefined, created_at: x.createdAt,
    label: REQ_LABEL[x.type] || x.type, handled_by_name: nameIn(names, x.handled_by), overdue: OPEN.includes(x.status) && !!x.due_at && x.due_at < new Date() }))) });
}));
router.put('/privacy/requests/:id', handle(async (req, res) => {
  const x = await PrivacyRequest.findById(oid(req.params.id));
  if (!x) throw notFound();
  const status = String(req.body?.status ?? '');
  if (!['In progress', 'Completed', 'Rejected', 'Extended'].includes(status)) throw fieldErr('status', 'Choose a status');
  const response = clean(req.body?.response, 4000);
  if (['Completed', 'Rejected', 'Extended'].includes(status) && !response) throw fieldErr('response', 'Write the reply to the student (reason is required for Rejected / Extended)');
  if (status === 'Extended') {
    // GDPR Art. 12(3) / CCPA: one extension for a complex request, and the student is told why
    if (x.due_at && +x.due_at > +x.createdAt + 40 * 864e5) throw bad('The deadline was already extended once');
    x.due_at = new Date(+(x.due_at ?? new Date()) + 45 * 864e5);
  }
  x.set({ status: status === 'Extended' ? 'In progress' : status, response: response ?? x.response, handled_by: req.user!.id, ...(['Completed', 'Rejected'].includes(status) ? { handled_at: new Date() } : {}) });
  await x.save();
  if (status === 'Completed' && x.type === 'restriction' && x.student_user_id) await PortalAccount.updateOne({ _id: x.student_user_id }, { 'flags.processing_restricted_at': new Date() });
  await audit(req, 'Update', 'PrivacyRequest', x._id, `${x.request_code}: ${status}`);
  const su = x.student_user_id ? await PortalAccount.findById(x.student_user_id).lean() : null;
  if (su) {
    await studentNotify(su._id, `Privacy request ${x.request_code}: ${status === 'Extended' ? 'more time needed' : status.toLowerCase()}`, '/privacy');
    const officer = await getSetting('grievance_officer_email');
    if (su.email && status !== 'In progress') await sendSecurity({ to: su.email, subject: `Your privacy request ${x.request_code}`, student_id: su.studentId, lead_id: su.leadId,
      text: `Your request (${REQ_LABEL[x.type]}) is now: ${status === 'Extended' ? `In progress, we need more time (new date ${fmtDate(x.due_at?.toISOString())})` : status}.\n\n${response}\n\nIf you are not satisfied you can contact our Grievance Officer${officer ? ` (${officer})` : ''} or your data protection authority.\nLa Europa Education` });
  }
  res.json({ ok: true });
}));

// ---------- breach register: 72 hours to the authority; DPDP: the Board and each affected person ----------
router.get('/privacy/breaches', handle(async (_req, res) => {
  const names = await userNames();
  res.json((await Breach.find().sort({ detected_at: -1 }).lean()).map((b) => ({ ...b, id: String(b._id), _id: undefined, by: nameIn(names, b.created_by),
    authority_deadline: new Date(+b.detected_at + 72 * 3600e3).toISOString() })));
}));
router.post('/privacy/breaches', handle(async (req, res) => {
  const b = req.body ?? {};
  const description = clean(b.description, 2000);
  if (!description) throw fieldErr('description', 'Describe what happened');
  const x = await Breach.create({ detected_at: b.detected_at ? new Date(b.detected_at) : new Date(), description, data_affected: clean(b.data_affected, 500),
    people_affected: Number(b.people_affected) || null, risk: ['Low', 'Medium', 'High'].includes(b.risk) ? b.risk : 'Medium', actions: clean(b.actions, 2000), status: 'Open', created_by: req.user!.id });
  await audit(req, 'Create', 'Breach', x._id, 'Breach recorded');
  await notifyAdmins('privacy', 'A personal data breach was recorded: authority notification may be due within 72 hours', '/admin/privacy');
  res.json({ id: String(x._id) });
}));
router.put('/privacy/breaches/:id', handle(async (req, res) => {
  const x = await Breach.findById(oid(req.params.id));
  if (!x) throw notFound();
  const b = req.body ?? {};
  for (const k of ['actions', 'data_affected'] as const) if (k in b) x.set(k, clean(b[k], 2000));
  for (const k of ['reported_authority_at', 'notified_people_at', 'board_initial_at', 'board_report_at'] as const) if (k in b) x.set(k, b[k] ? new Date(b[k]) : null);
  if ('people_affected' in b) x.people_affected = Number(b.people_affected) || null;
  if (['Low', 'Medium', 'High'].includes(b.risk)) x.risk = b.risk;
  if (['Open', 'Contained', 'Closed'].includes(b.status)) x.status = b.status;
  await x.save();
  await audit(req, 'Update', 'Breach', x._id, 'Breach updated');
  res.json({ ok: true });
}));
router.get('/privacy/breaches/:id/templates', handle(async (req, res) => {
  const b = await Breach.findById(oid(req.params.id));
  if (!b) throw notFound();
  res.json(await breachTemplates(b));
}));

// ---------- India DPDP: phases, notices, retention, processors ----------
router.get('/privacy/dpdp', handle(async (_req, res) => {
  const t = istDate();
  res.json({
    phases: PHASES.map(([label, date, what]) => ({ label, date, what, done: date <= t, days_left: Math.ceil((+new Date(date) - +new Date(t)) / 864e5) })),
    notices: { version: await noticeVersion(), text: await noticeText('[name]'), pending: (await pendingPeople()).length, sent: await PrivacyNotice.countDocuments(),
      auto_from: (await getSetting('privacy_notice_auto_from')) || null },
    retention: { months: await coldMonths(), due_now: (await coldLeads()).length, last_run: (await getSetting('retention_cold_last_run')) || null },
    processors: (await Processor.find().sort({ active: -1, name: 1 }).lean()).map((p) => ({ ...p, id: String(p._id), _id: undefined })), reply_days: await replyDays(),
  });
}));
router.post('/privacy/notices/send', handle(async (req, res) => {
  let n = 0;
  for (const p of await pendingPeople(500)) if (await sendNotice(p, 'Existing data (s.5(2))')) n++;
  if (req.body?.auto && !(await getSetting('privacy_notice_auto_from'))) await setSetting('privacy_notice_auto_from', new Date().toISOString(), req.user!.id);
  await audit(req, 'Create', 'PrivacyNotice', null, `Privacy notice sent to ${n} person(s)`);
  res.json({ sent: n, pending: (await pendingPeople()).length });
}));
router.put('/privacy/dpdp/settings', handle(async (req, res) => {
  const b = req.body ?? {};
  if ('retention_cold_lead_months' in b) {
    const m = Number(b.retention_cold_lead_months) || 0;
    if (m && (m < 12 || m > 120)) throw fieldErr('retention_cold_lead_months', '0 (off) or 12 to 120 months: never less than 1 year (DPDP Rules, Rule 8(3))');
    await setSetting('retention_cold_lead_months', String(m), req.user!.id);
  }
  if ('grievance_response_days' in b) {
    const d = Number(b.grievance_response_days);
    if (!(d >= 1 && d <= 90)) throw fieldErr('grievance_response_days', '1 to 90 days (DPDP Rules, Rule 14(3): maximum 90 days)');
    await setSetting('grievance_response_days', String(Math.round(d)), req.user!.id);
  }
  if ('auto_notice' in b) await setSetting('privacy_notice_auto_from', b.auto_notice ? String((await getSetting('privacy_notice_auto_from')) || new Date().toISOString()) : '', req.user!.id);
  await audit(req, 'Update', 'Settings', null, 'DPDP settings changed');
  res.json({ ok: true });
}));
router.post('/privacy/retention/run', handle(async (req, res) => { res.json({ erased: await runRetention(req.user!.id) }); }));
function procFields(b: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const f = { name: clean(b.name, 120), service: clean(b.service, 200), data_categories: clean(b.data_categories, 300), location: clean(b.location, 120),
    dpa_signed_on: /^\d{4}-\d{2}-\d{2}$/.test(b.dpa_signed_on ?? '') ? b.dpa_signed_on : undefined, breach_notice_hours: Math.min(168, Math.max(1, Number(b.breach_notice_hours) || 24)),
    sub_processors: clean(b.sub_processors, 500), contact: clean(b.contact, 200), notes: clean(b.notes, 1000), active: !(b.active === false || b.active === '0') };
  if (!f.name) throw fieldErr('name', 'Name is required');
  if (!f.service) throw fieldErr('service', 'What does this provider do for us?');
  return f;
}
router.post('/privacy/processors', handle(async (req, res) => {
  const p = await Processor.create({ ...procFields(req.body ?? {}), created_by: req.user!.id });
  await audit(req, 'Create', 'Processor', p._id, p.name);
  res.json({ id: String(p._id) });
}));
router.put('/privacy/processors/:id', handle(async (req, res) => {
  const p = await Processor.findById(oid(req.params.id));
  if (!p) throw notFound('Processor');
  p.set(procFields(req.body ?? {})); await p.save();
  await audit(req, 'Update', 'Processor', p._id, p.name);
  res.json({ ok: true });
}));

export default router;
