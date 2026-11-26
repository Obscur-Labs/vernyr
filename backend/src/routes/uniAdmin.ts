import { Router, type Response } from 'express';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import Student from '../models/Student';
import Course from '../models/Course';
import PortalAccount, { type IPortalAccount } from '../models/PortalAccount';
import University from '../models/University';
import { AuditLog, getSetting } from '../models/Audit';
import { Application } from '../models/Work';
import { Intake } from '../models/Master';
import { Campus, Commission, CommissionInvoice, CommissionPayment, CommissionRule, InvoiceQuery, PartnerAgreement, UniAction, UniAnnouncement, UniConsent, UniDocRequest, UniNotice, UniversityApplication } from '../models/Partner';
import { uniToken, type UniRequest } from '../middleware/university';
import { upload } from '../middleware/upload';
import { signedFileUrl, uploadBuffer } from '../config/cloudinary';
import { HttpError, bad, clean, fieldErr, fmtDateTime, fullName, handle, isEmail, istDate, num, oid } from '../services/crm';
import { fmtDate } from '../services/invoicePdf';
import { checkFile, ALLOWED } from '../services/files';
import { sendSecurity } from '../services/email';
import { notify, notifyAdmins } from '../services/tasks';
import { credentialConflict } from '../services/accounts';
import { invalidateUser } from '../services/access';
import { staffEmail } from '../services/uemail';
import { adminIds } from '../services/uniApprovals';
import { tablePdf } from '../services/uniPdf';
import * as P from '../services/partner';
import { issueInvite, meOut, notReused, pwRule, setPassword } from './uniAuth';
import { checkAttachments } from './uniDocs';
import { role, scope } from './uni';

/** The client's university portal API, part 5 (legacy/server/university/routes2.js): announcements, reports, commission and invoices, users, my account. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const router = Router();
const h = (fn: (req: UniRequest, res: Response) => Promise<void>) => handle(fn as never);
const finance = (req: UniRequest) => { if (!(req.su.finance || req.su.uniRole === 'admin')) throw P.NotFound(); };
const nameMap = async (ids: unknown[], model: 'intake' | 'course') => new Map(((model === 'intake' ? await Intake.find({ _id: { $in: ids } }).select('name').lean() : await Course.find({ _id: { $in: ids } }).select('name').lean()) as Any[]).map((x) => [String(x._id), x.name as string]));

// ---------- announcements (8.5) ----------
const ANN_TYPES = ['Deadline change', 'Scholarship', 'Event / webinar', 'Course news', 'Fee change', 'Admission rule change', 'Other'];
router.get('/announcements', h(async (req, res) => {
  const rows = ((await UniAnnouncement.find({ university_id: req.su.universityId }).sort({ createdAt: -1 }).limit(100).lean()) as Any[])
    .map((a) => ({ ...a, id: String(a._id), attachments: (a.attachments ?? []).map((x: Any) => ({ id: x.id, name: x.name })) }));
  res.json({ rows, notices: await UniNotice.find({ $or: [{ university_id: null }, { university_id: req.su.universityId }] }).sort({ createdAt: -1 }).limit(30).lean(), types: ANN_TYPES,
    courses: ((await Course.find({ university_id: req.su.universityId, is_deleted: false }).sort({ name: 1 }).select('name').lean()) as Any[]).map((c) => ({ id: String(c._id), name: c.name })),
    can_post: req.su.uniRole !== 'viewer' && !req.preview });
}));
router.post('/announcements', upload.array('files', 5), h(async (req, res) => {
  role(req, 'admin', 'officer');
  const b = req.body ?? {}; const e: Record<string, string> = {};
  if (!ANN_TYPES.includes(b.type)) e.type = 'Choose the type'; if (!clean(b.title)) e.title = 'Title is required'; else if (b.title.length > 150) e.title = 'Max 150 characters';
  if (!clean(b.body)) e.body = 'Message is required'; else if (b.body.length > 5000) e.body = 'Max 5000 characters';
  if (b.type === 'Fee change' || /fee/i.test(b.body || '')) Object.assign(e, P.feeWordCheck({ body: P.feeWordNear(b.body) ? b.body : '' }));
  if (Object.keys(e).length) throw bad('Please fix the highlighted fields', { errors: e });
  const list = (req.files as Express.Multer.File[] | undefined) ?? [];
  checkAttachments(list);
  const att = [];
  for (const f of list) { const asset = await uploadBuffer(f, `university/${req.su.universityId}/announcements`); att.push({ id: crypto.randomUUID(), url: asset.url, public_id: asset.publicId, resource_type: asset.resourceType, name: f.originalname, mime: f.mimetype }); }
  let related: unknown = []; try { related = JSON.parse(String(b.related || '[]')); } catch { related = []; }
  const a = await UniAnnouncement.create({ university_id: req.su.universityId, type: b.type, title: clean(b.title, 150), body: clean(b.body, 5000), related, important: b.important === 'true' || b.important === true,
    valid_until: b.valid_until || undefined, attachments: att, status: 'Posted', created_by: req.su._id });
  const to = [...new Set([req.uni.partner_manager_id, ...(await adminIds())].filter(Boolean).map(String))];
  for (const x of to) await notify(x, 'university', `Announcement from ${P.uniName(req.uni)}: ${clean(b.title, 150)}`, '/admin/uni-announcements');
  await staffEmail('E46', to, { university_id: req.su.universityId, ctx: { announcement_title: clean(b.title, 150), announcement_type: b.type, announcement_excerpt: clean(b.body, 300) } });
  await P.uaudit(req, 'Create', 'UniversityAnnouncement', a._id, clean(b.title, 150)); res.json({ ok: true });
}));
router.get('/announcements/:id/attachment/:aid', h(async (req, res) => {
  const a = oid(req.params.id) ? ((await UniAnnouncement.findOne({ _id: oid(req.params.id), university_id: req.su.universityId }).lean()) as Any) : null; if (!a) throw P.NotFound();
  const x = (a.attachments ?? []).find((y: Any) => y.id === req.params.aid); if (!x) throw P.NotFound();
  res.json({ url: signedFileUrl(x.url, x.public_id, x.resource_type), name: x.name });
}));

// ---------- reports (11) ----------
const OFFERS = ['Conditional offer', 'Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'];
async function reportData(req: UniRequest, type: string, q: Any) {
  const f: Any = scope(req); if (q.campus && oid(q.campus)) f.campus_id = oid(q.campus);
  let apps = (await UniversityApplication.find(f).lean()) as Any[];
  const ap = new Map(((await Application.find({ _id: { $in: apps.map((x) => x.application_id) } }).select('intake_id course_id course_name_text level student_id application_code').lean()) as Any[]).map((a) => [String(a._id), a]));
  apps = apps.map((x): Any => ({ ...x, ...(ap.get(String(x.application_id)) ?? {}), _id: x._id })).filter((x) => (!q.intake || String(x.intake_id) === String(q.intake)) && (!q.course || String(x.course_id) === String(q.course)) && (!q.level || x.level === q.level));
  const small = (await getSetting('uni_small_numbers')) !== '0';
  const sm = (n: number) => (small && n > 0 && n < 5 ? 'fewer than 5' : n);
  const intakes = await nameMap(apps.map((x) => x.intake_id).filter(Boolean), 'intake'); const courses = await nameMap(apps.map((x) => x.course_id).filter(Boolean), 'course');
  const intakeN = (x: Any) => intakes.get(String(x.intake_id)) || '-';
  const courseN = (x: Any) => x.course_name_text || courses.get(String(x.course_id)) || '-';
  const offeredIds = new Set((await UniAction.distinct('uapp_id', { uapp_id: { $in: apps.map((x) => x._id) }, type: { $in: ['conditional_offer', 'unconditional_offer'] } })).map(String));
  const offered = (x: Any) => OFFERS.includes(x.status) || offeredIds.has(String(x._id));
  const group = (keyFn: (x: Any) => string) => { const g: Record<string, Any[]> = {}; for (const x of apps) { const k = keyFn(x) || '-'; (g[k] = g[k] || []).push(x); } return g; };
  const avg = (a: number[]) => (a.length ? Math.round((a.reduce((s, b) => s + b, 0) / a.length) * 10) / 10 : '-');
  if (type === 'by_intake') { const g = group(intakeN); const cols = P.STATUSES; return { columns: ['Intake', ...cols, 'Total'], rows: Object.entries(g).map(([k, l]) => [k, ...cols.map((s) => l.filter((x) => x.status === s).length), l.length]) }; }
  if (type === 'funnel') {
    const steps: [string, (x: Any) => boolean][] = [['Received', () => true], ['Reviewed', (x) => x.status !== 'New'], ['Offer', offered], ['Offer accepted', (x) => ['Offer accepted', 'Deposit received', 'Enrolled'].includes(x.status)], ['Deposit received', (x) => ['Deposit received', 'Enrolled'].includes(x.status)], ['Enrolled', (x) => x.status === 'Enrolled']];
    const base = apps.filter((x) => x.status !== 'Withdrawn'); const tot = base.length || 1;
    return { columns: ['Step', 'Count', '% of received'], rows: steps.map(([l, fn]) => { const n = base.filter(fn).length; return [l, n, Math.round((n / tot) * 1000) / 10 + '%']; }) };
  }
  if (type === 'states') {
    const st = new Map(((await Student.find({ _id: { $in: apps.map((x) => x.student_id) } }).select('state').lean()) as Any[]).map((s) => [String(s._id), s.state]));
    const g = group((x) => st.get(String(x.student_id)) || 'Not given');
    return { columns: ['Country / state', 'Applications', 'Offers', 'Enrolled'], rows: Object.entries(g).map(([k, l]) => [`India: ${k}`, sm(l.length), sm(l.filter(offered).length), sm(l.filter((x) => x.status === 'Enrolled').length)]) };
  }
  if (type === 'offer_enrolment') {
    const g = group((x) => `${intakeN(x)} | ${courseN(x)}`);
    return { columns: ['Intake | course', 'Offers issued', 'Offers accepted', 'Enrolled', 'Acceptance rate', 'Offer-to-enrolment rate'], rows: Object.entries(g).map(([k, l]) => {
      const o = l.filter(offered).length; const acc = l.filter((x) => ['Offer accepted', 'Deposit received', 'Enrolled'].includes(x.status)).length; const en = l.filter((x) => x.status === 'Enrolled').length;
      return [k, o, acc, en, o ? Math.round((acc / o) * 100) + '%' : '-', o ? Math.round((en / o) * 100) + '%' : '-']; }) };
  }
  if (type === 'decision_time') {
    const g = group((x) => `${intakeN(x)} | ${courseN(x)}`);
    const med = (a: number[]) => { if (!a.length) return '-'; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10; };
    const reqs = (await UniDocRequest.find({ uapp_id: { $in: apps.map((x) => x._id) }, answered_at: { $ne: null } }).select('uapp_id createdAt answered_at').lean()) as Any[];
    return { columns: ['Intake | course', 'Decided', 'Average days to first decision', 'Median days', 'Average La Europa response to document requests (days)'], rows: Object.entries(g).map(([k, l]) => {
      const d = l.filter((x) => x.first_decision_at).map((x) => (new Date(x.first_decision_at).getTime() - new Date(x.submitted_at).getTime()) / 864e5);
      const ids = new Set(l.map((x) => String(x._id)));
      const rq = reqs.filter((y) => ids.has(String(y.uapp_id))).map((y) => (new Date(y.answered_at).getTime() - new Date(y.createdAt).getTime()) / 864e5);
      return [k, d.length, avg(d), med(d), avg(rq)]; }) };
  }
  if (type === 'reject_reasons') { const g: Record<string, number> = {}; for (const x of apps.filter((y) => y.status === 'Rejected')) g[x.reject_reason || 'Not given'] = (g[x.reject_reason || 'Not given'] || 0) + 1; return { columns: ['Reason', 'Count'], rows: Object.entries(g).sort((a, b) => b[1] - a[1]) }; }
  if (type === 'courses') { const g = group(courseN); return { columns: ['Course', 'Applications', 'Offers', 'Enrolled'], rows: Object.entries(g).map(([k, l]) => [k, l.length, l.filter(offered).length, l.filter((x) => x.status === 'Enrolled').length]).sort((a, b) => Number(b[1]) - Number(a[1])) }; }
  if (type === 'list') {
    const acts = (await UniAction.find({ uapp_id: { $in: apps.map((x) => x._id) } }).sort({ createdAt: 1 }).select('uapp_id to_status createdAt').lean()) as Any[];
    const hist = (x: Any, t: string) => { const r = acts.find((a) => String(a.uapp_id) === String(x._id) && a.to_status === t); return r ? fmtDate(new Date(r.createdAt).toISOString()) : ''; };
    const withContact = q.contact === '1' && req.su.uniRole === 'admin' && !!req.uni.share_contact;
    const studs = new Map(((await Student.find({ _id: { $in: apps.map((x) => x.student_id) } }).select('first_name middle_name last_name state country_code phone email').lean()) as Any[]).map((s) => [String(s._id), s]));
    return { columns: ['Application ID', 'Student name', 'Course', 'Intake', 'Status', 'Submitted', 'Acknowledged', 'Offer', 'Offer accepted', 'Deposit', 'Enrolled', 'Rejected', 'State', ...(withContact ? ['Phone', 'Email'] : [])],
      rows: apps.map((x) => { const s = studs.get(String(x.student_id)) ?? {}; return [x.application_code, fullName(s), courseN(x), intakeN(x), x.status, x.submitted_at ? fmtDate(new Date(x.submitted_at).toISOString()) : '', hist(x, 'Acknowledged'),
        hist(x, 'Conditional offer') || hist(x, 'Unconditional offer'), hist(x, 'Offer accepted'), hist(x, 'Deposit received'), hist(x, 'Enrolled'), hist(x, 'Rejected'), s.state || '', ...(withContact ? [`${s.country_code || ''} ${s.phone || ''}`.trim(), s.email] : [])]; }), contact: withContact };
  }
  throw P.NotFound();
}
const REPORTS = [['by_intake', 'Applications by intake'], ['funnel', 'Conversion funnel'], ['states', 'Students by country / state'], ['offer_enrolment', 'Offer-to-enrolment rate'], ['decision_time', 'Decision time'], ['reject_reasons', 'Rejection reasons'], ['courses', 'Course performance'], ['list', 'Application list']];
router.get('/reports', h(async (req, res) => { res.json({ reports: REPORTS, can_export: req.su.uniRole !== 'viewer' || !!req.uni.viewer_exports, contact_option: req.su.uniRole === 'admin' && !!req.uni.share_contact }); }));
router.get('/reports/:type', h(async (req, res) => {
  const d = (await reportData(req, req.params.type, req.query)) as { columns: string[]; rows: unknown[][]; contact?: boolean };
  const fmt = req.query.format;
  if (!fmt) { res.json(d); return; }
  if (req.su.uniRole === 'viewer' && !req.uni.viewer_exports) throw new HttpError(403, 'Exports are not available for your role.');
  const title = (REPORTS.find((x) => x[0] === req.params.type) || ['', 'Report'])[1];
  const q = req.query as Any;
  const parts: string[] = [];
  if (q.intake && oid(q.intake)) parts.push(`intake: ${((await Intake.findById(oid(q.intake)).select('name').lean()) as Any)?.name ?? ''}`);
  if (q.course && oid(q.course)) parts.push(`course: ${((await Course.findById(oid(q.course)).select('name').lean()) as Any)?.name ?? ''}`);
  if (q.level) parts.push(`level: ${q.level}`); if (q.campus && oid(q.campus)) parts.push(`campus: ${((await Campus.findById(oid(q.campus)).select('name').lean()) as Any)?.name ?? ''}`);
  const filt = parts.join(', ') || 'none';
  await P.uaudit(req, 'Export', 'UniversityReport', null, `${title} (${fmt})${d.contact ? ' with contact details' : ''}`);
  if (fmt === 'xlsx') {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(title.slice(0, 30));
    ws.addRow([`${P.uniName(req.uni)}: ${title}`]).font = { bold: true, size: 14 }; ws.addRow([`Filters: ${filt}`]); ws.addRow([`Generated on ${fmtDateTime(new Date())} IST by La Europa partner portal`]); ws.addRow([]);
    ws.addRow(d.columns).font = { bold: true }; for (const row of d.rows) ws.addRow(row as never[]); ws.columns.forEach((c) => { c.width = 18; });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}.xlsx"`); await wb.xlsx.write(res); res.end(); return;
  }
  const buf = await tablePdf({ title: `${P.uniName(req.uni)}: ${title}`, sub: `Filters: ${filt} | Generated on ${fmtDateTime(new Date())} IST`, columns: d.columns, rows: d.rows, uni: req.uni });
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}.pdf"`); res.end(buf);
}));

// ---------- commission and invoices (10.7, finance only) ----------
const BASIS: Record<string, string> = { gross: 'Percentage of first-year tuition (gross)', net: 'Percentage of first-year tuition after scholarship', fixed: 'Fixed amount per enrolled student' };
router.get('/finance', h(async (req, res) => {
  finance(req);
  const invoices = [];
  for (const i of (await CommissionInvoice.find({ university_id: req.su.universityId, status: { $ne: 'Draft' }, is_deleted: false }).sort({ invoice_date: -1 }).lean()) as Any[]) {
    const comms = (await Commission.find({ invoice_id: i._id }).lean()) as Any[];
    const apps = new Map(((await Application.find({ _id: { $in: comms.map((c) => c.application_id).filter(Boolean) } }).select('application_code student_id course_name_text course_id intake_id').lean()) as Any[]).map((a) => [String(a._id), a]));
    const studs = new Map(((await Student.find({ _id: { $in: [...apps.values()].map((a) => a.student_id) } }).select('first_name middle_name last_name').lean()) as Any[]).map((s) => [String(s._id), s]));
    const intakes = await nameMap([...apps.values()].map((a) => a.intake_id).filter(Boolean), 'intake'); const courses = await nameMap([...apps.values()].map((a) => a.course_id).filter(Boolean), 'course');
    invoices.push({ id: String(i._id), invoice_no: i.invoice_no, kind: i.kind, invoice_date: i.invoice_date, due_date: i.due_date, total: i.total, currency: i.currency, paid: i.paid,
      balance: Math.round(((i.total || 0) - (i.paid || 0)) * 100) / 100, status: i.status, query_open: !!i.query_open,
      lines: comms.map((c) => { const a = c.application_id ? apps.get(String(c.application_id)) : null; return { id: String(c._id), amount: c.amount, currency: c.currency, application_code: a?.application_code ?? null,
        student_name: a ? fullName(studs.get(String(a.student_id)) ?? {}) : 'Volume bonus', course: a ? a.course_name_text || courses.get(String(a.course_id)) || null : null, intake: a ? intakes.get(String(a.intake_id)) ?? null : null }; }),
      payments: ((await CommissionPayment.find({ invoice_id: i._id }).sort({ createdAt: -1 }).select('amount currency payment_date reference status reject_reason createdAt').lean()) as Any[]).map((p) => ({ ...p, id: String(p._id) })) });
  }
  const rules = ((await CommissionRule.find({ university_id: req.su.universityId, status: 'Active', show_to_uni: true, is_deleted: false }).lean()) as Any[]).map((x) => ({ name: x.name, basis: BASIS[x.basis], rate: x.basis === 'fixed' ? null : x.rate,
    fixed: x.basis === 'fixed' ? `${x.fixed_amount} ${x.fixed_currency}` : null, due: ({ enrolled: 'On enrolment', deposit: 'On deposit received', days: `Enrolment date + ${x.due_days} days` } as Record<string, string>)[x.due_event] }));
  const expected = req.uni.show_expected_commission ? (await Commission.aggregate([{ $match: { university_id: req.su.universityId, status: { $in: ['Due', 'Expected'] }, is_deleted: false } }, { $group: { _id: { status: '$status', currency: '$currency' }, n: { $sum: 1 }, total: { $sum: '$amount' } } }]))
    .map((x) => ({ status: x._id.status, currency: x._id.currency, n: x.n, total: x.total })) : null;
  const agreement = req.su.uniRole === 'admin' ? ((await PartnerAgreement.find({ university_id: req.su.universityId, show_to_uni: true, is_deleted: false, status: { $ne: 'Draft' } }).sort({ start_date: -1 }).lean()) as Any[])
    .map((a) => ({ id: String(a._id), agreement_code: a.agreement_code, title: a.title, start_date: a.start_date, end_date: a.end_date, signed_by_le: a.signed_by_le, signed_by_uni: a.signed_by_uni, signed_on: a.signed_on, status: a.status,
      has_pdf: !!a.file?.url, party: 'Euroverse Service LLP, trading as La Europa Education' })) : null;
  res.json({ invoices, rules, expected, agreement });
}));
router.get('/finance/invoices/:id/pdf', h(async (req, res) => {
  finance(req);
  const i = oid(req.params.id) ? ((await CommissionInvoice.findOne({ _id: oid(req.params.id), university_id: req.su.universityId, status: { $ne: 'Draft' } }).lean()) as Any) : null;
  if (!i?.pdf?.url) throw P.NotFound();
  await P.uaudit(req, 'Download', 'CommissionInvoice', i._id, i.invoice_no);
  res.json({ url: signedFileUrl(i.pdf.url, i.pdf.public_id, i.pdf.resource_type || 'raw'), name: `${i.invoice_no}.pdf` });
}));
router.get('/agreements/:id/pdf', h(async (req, res) => {
  role(req, 'admin');
  const a = oid(req.params.id) ? ((await PartnerAgreement.findOne({ _id: oid(req.params.id), university_id: req.su.universityId, show_to_uni: true, is_deleted: false }).lean()) as Any) : null;
  if (!a?.file?.url) throw P.NotFound();
  await P.uaudit(req, 'View', 'PartnerAgreement', a._id, a.agreement_code);
  res.json({ url: signedFileUrl(a.file.url, a.file.public_id, a.file.resource_type || 'raw'), name: `${a.agreement_code}.pdf` });
}));
router.post('/finance/invoices/:id/payments', upload.single('proof'), h(async (req, res) => {
  finance(req);
  const i = oid(req.params.id) ? ((await CommissionInvoice.findOne({ _id: oid(req.params.id), university_id: req.su.universityId, status: { $in: ['Invoiced', 'Partially paid', 'Overdue'] }, kind: 'invoice' }).lean()) as Any) : null;
  if (!i) throw P.NotFound();
  const b = req.body ?? {}; const e: Record<string, string> = {}; const amt = num(b.amount);
  if (!(amt != null && amt > 0)) e.amount = 'Amount must be more than 0';
  if (!b.payment_date || b.payment_date > istDate()) e.payment_date = 'Payment date is required and cannot be in the future';
  if (!clean(b.reference)) e.reference = 'Bank reference is required';
  if (!req.file) e.proof = 'Upload the proof (PDF / JPG / PNG)';
  if (Object.keys(e).length) throw bad('Please fix the highlighted fields', { errors: e });
  checkFile(req.file!, ALLOWED, 10);
  const asset = await uploadBuffer(req.file!, `university/${req.su.universityId}/payments`);
  const ref = clean(b.reference, 100);
  const dup = await CommissionPayment.exists({ university_id: req.su.universityId, reference: ref, status: { $ne: 'Rejected' } });
  const p = await CommissionPayment.create({ invoice_id: i._id, university_id: i.university_id, amount: amt, currency: i.currency, payment_date: b.payment_date, reference: ref, proof: { url: asset.url, public_id: asset.publicId, resource_type: asset.resourceType },
    proof_name: req.file!.originalname, note: clean(b.note, 500), status: 'Submitted', submitted_by: req.su._id, source: 'university' });
  await notifyAdmins('commission', `Payment proof submitted by ${P.uniName(req.uni)} for invoice ${i.invoice_no}: ${amt} ${i.currency}${dup ? ' (duplicate reference!)' : ''}`, '/admin/commission');
  await P.uaudit(req, 'Create', 'CommissionPayment', p._id, i.invoice_no);
  res.json({ ok: true, warning: amt! > (i.total || 0) - (i.paid || 0) ? 'The amount is more than the balance.' : dup ? 'A payment with the same reference was already submitted.' : null });
}));
router.get('/finance/invoices/:id/queries', h(async (req, res) => {
  finance(req);
  const i = oid(req.params.id) ? await CommissionInvoice.findOne({ _id: oid(req.params.id), university_id: req.su.universityId }).select('_id').lean() : null; if (!i) throw P.NotFound();
  const out = [];
  for (const q of (await InvoiceQuery.find({ invoice_id: i._id }).sort({ createdAt: -1 }).lean()) as Any[]) {
    const msgs = [];
    for (const m of q.messages ?? []) msgs.push({ ...m, id: String(m._id), mine: m.sender_type === 'university', sender: m.sender_type === 'university' ? ((await PortalAccount.findById(m.sender_id).select('name').lean()) as Any)?.name : 'La Europa Education' });
    out.push({ ...q, id: String(q._id), messages: msgs });
  }
  res.json(out);
}));
router.post('/finance/invoices/:id/queries', h(async (req, res) => {
  finance(req);
  const i = oid(req.params.id) ? await CommissionInvoice.findOne({ _id: oid(req.params.id), university_id: req.su.universityId, status: { $ne: 'Draft' } }) : null; if (!i) throw P.NotFound();
  const body = clean(req.body?.body, 2000); if (!body) throw fieldErr('body', 'Write your question');
  let q = req.body?.query_id && oid(req.body.query_id) ? await InvoiceQuery.findOne({ _id: oid(req.body.query_id), invoice_id: i._id, status: 'Open' }) : null;
  if (!q) q = new InvoiceQuery({ invoice_id: i._id, university_id: i.university_id, commission_id: req.body?.commission_id && oid(req.body.commission_id) ? req.body.commission_id : undefined, status: 'Open', created_by: req.su._id });
  q.messages.push({ sender_type: 'university', sender_id: req.su._id, body, sent_at: new Date() }); await q.save();
  i.query_open = true; await i.save();
  await notifyAdmins('commission', `Invoice query from ${P.uniName(req.uni)} on ${i.invoice_no}`, '/admin/commission');
  await P.uaudit(req, 'Create', 'InvoiceQuery', q._id, i.invoice_no); res.json({ ok: true });
}));

// ---------- users (2.7, University Admin only) ----------
const ALERTS = ['applications', 'messages', 'deadlines', 'finance'];
const userOut = (u: Any) => ({ id: String(u._id), name: u.name, email: u.email, role: u.uniRole, role_label: P.ROLE_LABEL[u.uniRole], finance: !!(u.finance || u.uniRole === 'admin'), campuses: (u.campuses ?? []).map(String),
  department: u.department ?? null, phone: u.phone ?? null, alerts: u.alerts ?? null, status: u.status, last_login_at: u.lastLoginAt ?? null, main: !!u.isMainContact, twofa: false });
const liveUsers = (universityId: unknown) => PortalAccount.countDocuments({ role: 'university', universityId, status: { $in: ['Invited', 'Active'] } });
router.get('/users', h(async (req, res) => {
  role(req, 'admin');
  const rows = ((await PortalAccount.find({ role: 'university', universityId: req.su.universityId, status: { $ne: 'Deleted' } }).sort({ status: 1, name: 1 }).lean()) as Any[]).map(userOut);
  const names = new Map(rows.map((r) => [r.id, r.name]));
  const activity = ((await AuditLog.find({ university_id: req.su.universityId, actor_type: 'university' }).sort({ createdAt: -1 }).limit(200).select('action entity_type entity_label ip createdAt user_id').lean()) as Any[])
    .map((x) => ({ action: x.action, entity_type: x.entity_type, entity_label: x.entity_label, ip: x.ip, created_at: x.createdAt, user: names.get(String(x.user_id)) ?? null }));
  res.json({ rows, max: req.uni.max_users, officers_propose: !!req.uni.officers_propose,
    campuses: ((await Campus.find({ university_id: req.su.universityId, is_deleted: false }).select('name').lean()) as Any[]).map((c) => ({ id: String(c._id), name: c.name })), activity });
}));
async function userFields(req: { su: { universityId?: unknown } }, b: Any, existing: Any | null) {
  const e: Record<string, string> = {};
  if (!clean(b.name)) e.name = 'Full name is required';
  if (!existing) {
    if (!isEmail(b.email)) e.email = 'Valid email is required';
    else { const clash = await credentialConflict({ email: String(b.email), username: String(b.email) }); if (clash) e.email = 'This email already has an account'; }
  }
  if (!['admin', 'officer', 'viewer'].includes(b.role)) e.role = 'Choose a role';
  if (Object.keys(e).length) throw bad('Please fix the highlighted fields', { errors: e });
  const own = new Set(((await Campus.find({ university_id: req.su.universityId }).select('_id').lean()) as Any[]).map((c) => String(c._id)));
  return { name: clean(b.name, 100)!, uniRole: b.role, finance: b.role === 'admin' || !!b.finance, campuses: (Array.isArray(b.campuses) ? b.campuses : []).filter((id: string) => own.has(String(id))),
    department: clean(b.department, 40) ?? undefined, phone: clean(b.phone, 30) ?? undefined, alerts: (Array.isArray(b.alerts) ? b.alerts : ALERTS).filter((x: string) => ALERTS.includes(x)) };
}
/** a university login waiting for its invite: email is the username, the password is set on activation */
export async function createUniUser(universityId: unknown, b: Any, created: { by?: unknown; type: 'university' | 'staff' }) {
  const f = await userFields({ su: { universityId } }, b, null);
  const email = String(b.email).trim().toLowerCase();
  const su = await PortalAccount.create({ role: 'university', universityId, email, username: email, password: crypto.randomBytes(24).toString('base64url'), ...f, status: 'Invited', isActive: true,
    flags: { created_by: created.by ? String(created.by) : null, created_by_type: created.type } });
  await issueInvite(su._id);
  return su;
}
const mailWarn = (em: string) => (/@(gmail|yahoo|hotmail|outlook|live|icloud|aol|proton(mail)?|rediffmail)\./i.test(em) ? 'This looks like a personal / free email address. University work emails are recommended.'
  : /^(info|admissions|admission|office|contact|international)@/i.test(em) ? 'Shared mailboxes should not be used for personal logins.' : null);
router.post('/users', h(async (req, res) => {
  role(req, 'admin');
  if ((await liveUsers(req.su.universityId)) >= (req.uni.max_users || 10)) throw bad('Your user limit is reached. Please contact La Europa.');
  const su = await createUniUser(req.su.universityId, req.body ?? {}, { by: req.su._id, type: 'university' });
  await notifyAdmins('university', `${P.uniName(req.uni)} added a portal user: ${su.name} (${P.ROLE_LABEL[su.uniRole!]})`, '/admin/university');
  await P.uaudit(req, 'Create', 'UniversityUser', su._id, `${su.name} ${su.uniRole}`);
  res.json({ ok: true, warning: mailWarn(String(req.body.email)) });
}));
const otherAdmin = (u: IPortalAccount) => PortalAccount.exists({ role: 'university', universityId: u.universityId, uniRole: 'admin', status: 'Active', _id: { $ne: u._id } });
const loadUser = async (req: UniRequest) => { const u = oid(req.params.id) ? await PortalAccount.findOne({ _id: oid(req.params.id), role: 'university', universityId: req.su.universityId }) : null; if (!u) throw P.NotFound(); return u; };
router.put('/users/:id', h(async (req, res) => {
  role(req, 'admin');
  const u = await loadUser(req);
  const f = await userFields(req, { name: u.name, role: u.uniRole, finance: u.finance, campuses: (u.campuses ?? []).map(String), department: u.department, phone: u.phone, alerts: u.alerts, ...req.body }, u);
  if (u.uniRole === 'admin' && f.uniRole !== 'admin' && !(await otherAdmin(u))) throw bad('At least one active University Admin must always exist.');
  const old = { role: u.uniRole, finance: u.finance };
  u.set(f); await u.save();
  if (old.role !== f.uniRole) await notifyAdmins('university', `${P.uniName(req.uni)} changed the role of ${u.name} to ${P.ROLE_LABEL[f.uniRole]}`, '/admin/university');
  await P.uaudit(req, 'Update', 'UniversityUser', u._id, u.name, old, { role: f.uniRole, finance: f.finance }); res.json({ ok: true });
}));
router.post('/users/:id/:action', h(async (req, res) => {
  role(req, 'admin');
  const a = req.params.action; if (!['deactivate', 'activate', 'logout', 'resend'].includes(a)) throw P.NotFound();
  const u = await loadUser(req);
  if (a === 'deactivate') {
    if (u.uniRole === 'admin' && !(await otherAdmin(u))) throw bad('The last active University Admin cannot be deactivated.');
    u.set({ status: 'Inactive', sessionsEndedAt: new Date() }); await u.save(); invalidateUser(String(u._id));
    await notifyAdmins('university', `${P.uniName(req.uni)} deactivated the portal user ${u.name}`, '/admin/university');
  }
  if (a === 'activate') {
    if ((await liveUsers(u.universityId)) >= (req.uni.max_users || 10)) throw bad('Your user limit is reached. Please contact La Europa.');
    u.status = u.lastLoginAt || u.pwHistory?.length ? 'Active' : 'Invited'; await u.save();
  }
  if (a === 'logout') { u.sessionsEndedAt = new Date(); await u.save(); invalidateUser(String(u._id)); }
  if (a === 'resend') { if (u.status !== 'Invited') throw bad('This user has already activated the account'); await issueInvite(u._id); }
  await P.uaudit(req, 'Update', 'UniversityUser', u._id, `${a}: ${u.name}`); res.json({ ok: true });
}));
router.put('/settings/officers-propose', h(async (req, res) => {
  role(req, 'admin'); await University.updateOne({ _id: req.su.universityId }, { officers_propose: !!req.body?.on });
  await P.uaudit(req, 'Update', 'University', req.su.universityId, `Officers can propose course changes: ${req.body?.on ? 'On' : 'Off'}`); res.json({ ok: true });
}));

// ---------- my account (UP18) ----------
router.get('/account', h(async (req, res) => {
  res.json({ me: await meOut(req.su), sessions: [], backup_left: 0, alerts: ALERTS,
    consents: await UniConsent.find({ account_id: req.su._id }).sort({ createdAt: -1 }).select('doc_type version createdAt').lean() });
}));
router.put('/account', h(async (req, res) => {
  const b = req.body ?? {}; const u = req.su;
  if (b.name !== undefined) { if (!clean(b.name)) throw fieldErr('name', 'Name is required'); u.name = clean(b.name, 100)!; }
  if (b.phone !== undefined) u.phone = clean(b.phone, 30) ?? undefined; if (b.designation !== undefined) u.designation = clean(b.designation, 100) ?? undefined;
  if (Array.isArray(b.alerts)) { let al = b.alerts.filter((x: string) => ALERTS.includes(x)); if (u.isMainContact) al = [...new Set([...al, 'applications', ...(u.finance || u.uniRole === 'admin' ? ['finance'] : [])])]; u.alerts = al; }
  await u.save(); await P.uaudit(req, 'Update', 'UniversityUser', u._id, 'My account'); res.json({ ok: true });
}));
const pwTries = new Map<string, number[]>();
router.put('/account/password', h(async (req, res) => {
  const k = String(req.su._id); const t = Date.now(); const l = (pwTries.get(k) ?? []).filter((x) => t - x < 15 * 60e3);
  if (l.length >= 5) throw new HttpError(429, 'Too many attempts. Please try again later.'); l.push(t); pwTries.set(k, l);
  const su = (await PortalAccount.findById(req.su._id).select('+password'))!;
  if (!(await su.comparePassword(String(req.body?.current || '')))) throw bad('Current password is wrong', { errors: { current: 'Wrong password' } });
  pwRule(req.body.password, [su.email, su.name]); if (req.body.password !== req.body.confirm) throw bad('Passwords do not match', { errors: { confirm: 'Does not match' } });
  await notReused(su, req.body.password); await setPassword(su, req.body.password);
  await sendSecurity({ to: String(su.email), subject: 'Your La Europa partner portal password was changed', text: `Your partner portal password was changed on ${fmtDateTime(new Date())} IST.\nIf this was not you, contact La Europa immediately.` }).catch(() => {});
  await P.uaudit(req, 'Update', 'UniversityUser', su._id, 'Password changed');
  // the password change ends every other session; this one continues on a fresh token
  res.json({ ok: true, token: uniToken(su) });
}));
router.post('/account/logout-others', h(async (req, res) => {
  req.su.sessionsEndedAt = new Date(); await req.su.save(); invalidateUser(String(req.su._id));
  await P.uaudit(req, 'Logout', 'UniversityUser', req.su._id, 'Logged out other devices');
  res.json({ ok: true, token: uniToken(req.su) });
}));

export default router;
void Course;
