import { Router, type Response } from 'express';
import ExcelJS from 'exceljs';
import Student from '../models/Student';
import User from '../models/User';
import Course from '../models/Course';
import PortalAccount from '../models/PortalAccount';
import University from '../models/University';
import { audit, getSetting, setSetting } from '../models/Audit';
import { Counter } from '../models/Timeline';
import { Application } from '../models/Work';
import { Country, Intake, MasterItem } from '../models/Master';
import { Commission, CommissionInvoice, CommissionPayment, CommissionRule, CourseChangeRequest, InvoiceQuery, PartnerAgreement, UniAnnouncement, UniContact, UniImportBatch, UniMessage, UniNotice, UniProfileRequest, UniversityApplication } from '../models/Partner';
import { authenticate, staffOnly, type AuthRequest } from '../middleware/auth';
import { signedFileUrl, uploadBuffer } from '../config/cloudinary';
import { HttpError, bad, clean, fieldErr, fmtDateTime, fullName, handle, isAdmin, isEmail, istDate, num, oid, addDays } from '../services/crm';
import { fmtDate } from '../services/invoicePdf';
import { notify } from '../services/tasks';
import { trigger } from '../services/uemail';
import { logoOf } from '../services/catalogue';
import * as A from '../services/uniActions';
import * as AP from '../services/uniApprovals';
import { invoicePdf, tablePdf } from '../services/uniPdf';
import * as P from '../services/partner';
import { courseOut, payloadOf, validateCourse } from './uniCatalogue';

/** The client's La Europa side of the partner portal (legacy/server/routes/university_staff.js), part 2: approvals, announcements and notices, commission, portal settings. Admin only. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const router = Router();
router.use(['/admin/uni-approvals', '/admin/uni-courses', '/admin/uni-announcements', '/admin/uni-notices', '/admin/commission', '/admin/uni-settings', '/admin/doc-types/:id/uni-flags'], authenticate, staffOnly);
const h = (fn: (req: AuthRequest, res: Response) => Promise<void>) => handle(fn);
const adminOnly = (req: AuthRequest) => { if (!isAdmin(req)) throw new HttpError(403, 'Only Admin can do this'); };
const bool = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
const uniNames = async (ids: unknown[]) => new Map(((await University.find({ _id: { $in: ids.filter(Boolean) } }).select('name display_name').lean()) as Any[]).map((u) => [String(u._id), P.uniName(u)]));
const accountName = async (id: unknown) => (id ? ((await PortalAccount.findById(id).select('name').lean()) as Any)?.name ?? null : null);
const wd = (at: Date | string) => { let d = new Date(at); let n = 0; const end = new Date(); while (d < end) { d = new Date(d.getTime() + 864e5); if (d <= end && ![0, 6].includes(d.getDay())) n++; } return n; };
const currencies = async () => ((await MasterItem.find({ type: 'currency', is_deleted: { $ne: true } }).sort({ sort: 1 }).select('name').lean()) as Any[]).map((x) => x.name);
const xlsxOut = async (res: Response, name: string, columns: string[], rows: unknown[][]) => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Report'); ws.addRow(columns).font = { bold: true }; rows.forEach((x) => ws.addRow(x as never[])); ws.columns.forEach((c) => { c.width = 20; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`); await wb.xlsx.write(res); res.end();
};

// =====================================================================================
// S46 University approvals
// =====================================================================================
router.get('/admin/uni-approvals', h(async (req, res) => {
  adminOnly(req);
  const crs = (await CourseChangeRequest.find({ status: 'Pending approval', is_deleted: false }).sort({ urgent: -1, createdAt: 1 }).lean()) as Any[];
  const prs = (await UniProfileRequest.find({ status: 'Pending' }).sort({ createdAt: 1 }).lean()) as Any[];
  const batchesAll = (await UniImportBatch.find().sort({ createdAt: -1 }).limit(50).lean()) as Any[];
  const history = (await CourseChangeRequest.find({ status: { $nin: ['Pending approval', 'Draft'] } }).sort({ reviewed_at: -1, updatedAt: -1 }).limit(50).lean()) as Any[];
  const unis = await uniNames([...crs, ...prs, ...batchesAll, ...history].map((x) => x.university_id));
  const cr = [];
  for (const x of crs) cr.push({ id: String(x._id), entity: x.entity, change_type: x.change_type, university: unis.get(String(x.university_id)), university_id: String(x.university_id), payload: x.payload, old: x.old ?? null,
    urgent: !!x.urgent, urgent_reason: x.urgent_reason ?? null, warnings: x.warnings ?? [], batch_id: x.batch_id ? String(x.batch_id) : null, created_at: x.createdAt, late: wd(x.createdAt) > 3, by: await accountName(x.requested_by), fee_flag: P.feeWordNear(x.payload?.description) });
  const profiles = [];
  for (const x of prs) {
    const u = (await University.findById(x.university_id).select('logo_updated_at').lean()) as Any;
    profiles.push({ id: String(x._id), entity: 'profile', change_type: 'Profile', university: unis.get(String(x.university_id)), university_id: String(x.university_id), payload: { ...x.payload, logo: undefined, cover: undefined }, old: x.old ?? null,
      created_at: x.createdAt, late: wd(x.createdAt) > 3, by: await accountName(x.requested_by), logo_new: x.payload?.logo?.url ? `/api/admin/uni-approvals/file/${x._id}/logo` : null, logo_old: logoOf(u) });
  }
  const batches = [];
  for (const b of batchesAll) { const pending = await CourseChangeRequest.countDocuments({ batch_id: b._id, status: 'Pending approval' }); if (pending) batches.push({ ...b, id: String(b._id), pending, university: unis.get(String(b.university_id)) }); }
  res.json({ courses: cr.filter((x) => x.entity === 'course'), campuses: cr.filter((x) => x.entity === 'campus'), scholarships: cr.filter((x) => x.entity === 'scholarship'), profiles, batches,
    history: history.map((x) => ({ id: String(x._id), entity: x.entity, change_type: x.change_type, status: x.status, review_note: x.review_note, reviewed_at: x.reviewed_at, university_id: String(x.university_id), auto_approved: !!x.auto_approved, name: x.payload?.name, university: unis.get(String(x.university_id)) })) });
}));
router.get('/admin/uni-approvals/file/:id/:kind', h(async (req, res) => {
  adminOnly(req); if (!['logo', 'cover'].includes(req.params.kind)) throw P.NotFound();
  const x = oid(req.params.id) ? ((await UniProfileRequest.findById(oid(req.params.id)).lean()) as Any) : null; const f = x?.payload?.[req.params.kind]; if (!f?.url) throw P.NotFound();
  res.json({ url: signedFileUrl(f.url, f.public_id, 'image') || f.url });
}));
router.post('/admin/uni-approvals/batch/:bid/approve', h(async (req, res) => {
  adminOnly(req); let n = 0; const errs: string[] = [];
  const bid = oid(req.params.bid); if (!bid) throw P.NotFound();
  for (const x of (await CourseChangeRequest.find({ batch_id: bid, status: 'Pending approval' }).select('_id').lean()) as Any[]) { try { await AP.approveCourse(x._id, { id: req.user!.id }, null, {}); n++; } catch (e) { errs.push((e as Error).message); } }
  await UniImportBatch.updateOne({ _id: bid }, { status: 'Approved' });
  await audit(req, 'Approve', 'CourseImportBatch', bid, `${n} approved`); res.json({ ok: true, approved: n, errors: errs });
}));
router.post('/admin/uni-approvals/:kind/:id/:action', h(async (req, res) => {
  adminOnly(req);
  const { kind, id, action } = req.params; const b = req.body ?? {};
  if (!['course', 'profile'].includes(kind) || !['approve', 'reject'].includes(action) || !oid(id)) throw P.NotFound();
  const me = { id: req.user!.id };
  if (kind === 'profile') { if (action === 'approve') await AP.approveProfile(id, me, b.fields, b.edits, clean(b.note, 500)); else await AP.rejectProfile(id, me, b.reason); }
  else if (action === 'approve') {
    const x = (await CourseChangeRequest.findById(id).lean()) as Any;
    if (x?.entity === 'course' && b.edits) { const errs = P.feeWordCheck({ fee_note: { ...x.payload, ...b.edits }.fee_note }); if (Object.keys(errs).length) throw bad('Please fix the highlighted fields', { errors: errs }); }
    await AP.approveCourse(id, me, b.edits, { note: clean(b.note, 500) ?? undefined });
  } else await AP.rejectRequest(id, me, b.reason);
  await audit(req, action === 'approve' ? 'Approve' : 'Reject', kind === 'profile' ? 'UniversityProfileChangeRequest' : 'CourseChangeRequest', id, b.reason || b.note || '');
  res.json({ ok: true });
}));
/** Admin edits a course directly on behalf of the university (4.8): live at once, logged, University Admin told */
router.post('/admin/uni-courses/:id/direct', h(async (req, res) => {
  adminOnly(req);
  const c = oid(req.params.id) ? ((await Course.findById(oid(req.params.id)).lean()) as Any) : null; if (!c) throw P.NotFound();
  const v = await validateCourse(c.university_id, req.body ?? {}, c._id);
  if (Object.keys(v.errors).length) throw bad('Please fix the highlighted fields', { errors: v.errors });
  const p = payloadOf(req.body, v);
  const x = await CourseChangeRequest.create({ university_id: c.university_id, course_id: c._id, entity: 'course', change_type: 'Edit course (by La Europa)', payload: p, old: await courseOut(c), status: 'Pending approval', created_by: req.user!.id });
  await AP.approveCourse(x._id, { id: req.user!.id }, null, { note: 'Edited by La Europa' });
  await Course.updateOne({ _id: c._id }, { change_source: 'la_europa' });
  await P.notifyUni(c.university_id, { roles: ['admin'] }, `La Europa edited the course ${p.name}`, '/courses');
  await audit(req, 'Update', 'Course', c._id, `Edited on behalf of the university: ${p.name}`); res.json({ ok: true });
}));

// =====================================================================================
// S49 University announcements and partner notices
// =====================================================================================
router.get('/admin/uni-announcements', h(async (req, res) => {
  adminOnly(req);
  const list = (await UniAnnouncement.find().sort({ createdAt: -1 }).limit(200).lean()) as Any[];
  const unis = await uniNames(list.map((a) => a.university_id));
  const courses = new Map(((await Course.find({ _id: { $in: list.flatMap((a) => (Array.isArray(a.related) ? a.related : [])).filter((x) => oid(x)) } }).select('name').lean()) as Any[]).map((c) => [String(c._id), c.name]));
  const rows = [];
  for (const a of list) rows.push({ ...a, id: String(a._id), university: unis.get(String(a.university_id)), related: (Array.isArray(a.related) ? a.related : []).map((x: unknown) => courses.get(String(x))).filter(Boolean),
    attachments: (a.attachments ?? []).map((x: Any) => ({ id: x.id, name: x.name })), by: await accountName(a.created_by) });
  await UniAnnouncement.updateMany({ _id: { $in: list.filter((y) => y.status === 'Posted').map((y) => y._id) }, status: 'Posted' }, { status: 'Seen by La Europa' });
  const notices = (await UniNotice.find().sort({ createdAt: -1 }).limit(50).lean()) as Any[];
  const nu = await uniNames(notices.map((n) => n.university_id));
  res.json({ rows, notices: notices.map((n) => ({ ...n, id: String(n._id), university: n.university_id ? nu.get(String(n.university_id)) : 'All universities' })),
    universities: ((await University.find({ portal_status: { $in: ['Active', 'Invited'] } }).select('name display_name').lean()) as Any[]).map((u) => ({ id: String(u._id), name: P.uniName(u) })) });
}));
router.get('/admin/uni-announcements/:id/attachment/:aid', h(async (req, res) => {
  const a = oid(req.params.id) ? ((await UniAnnouncement.findById(oid(req.params.id)).lean()) as Any) : null; if (!a) throw P.NotFound();
  if (!isAdmin(req) && !a.published_at) throw new HttpError(403, 'Not allowed');
  const x = (a.attachments ?? []).find((y: Any) => y.id === req.params.aid); if (!x) throw P.NotFound();
  res.json({ url: signedFileUrl(x.url, x.public_id, x.resource_type), name: x.name });
}));
router.post('/admin/uni-announcements/:id/:action', h(async (req, res) => {
  adminOnly(req);
  const act = req.params.action; if (!['publish', 'handled', 'reply'].includes(act)) throw P.NotFound();
  const a = oid(req.params.id) ? await UniAnnouncement.findById(oid(req.params.id)) : null; if (!a) throw P.NotFound();
  const b = req.body ?? {};
  if (act === 'publish') {
    const scope = b.scope === 'active' ? 'active' : 'all';
    let counsellors: unknown[];
    if (scope === 'all') counsellors = await User.distinct('_id', { role: 'counsellor', isActive: true });
    else { const studs = await Application.distinct('student_id', { university_id: a.university_id, is_deleted: false, stage: { $nin: ['rejected', 'withdrawn', 'offer_declined', 'enrolment_confirmed'] } }); counsellors = (await Student.distinct('primary_counsellor_id', { _id: { $in: studs } })).filter(Boolean); }
    const u = (await University.findById(a.university_id).select('name display_name').lean()) as Any;
    for (const c of counsellors) await notify(c, 'university_news', `${a.important ? 'IMPORTANT: ' : ''}${P.uniName(u)}: ${a.title}`, '/dashboard');
    a.set({ published_at: new Date(), published_by: req.user!.id, published_scope: scope });
  }
  if (act === 'handled') a.set({ status: 'Handled', handled_by: req.user!.id, handled_at: new Date() });
  if (act === 'reply') {
    const body = clean(b.body, 5000); if (!body) throw fieldErr('body', 'Write the reply');
    await UniMessage.create({ university_id: a.university_id, sender_type: 'staff', sender_user_id: req.user!.id, body: `Re: ${a.title}\n${body}`, sent_at: new Date() });
    await P.notifyUni(a.university_id, {}, 'La Europa replied to your announcement', '/messages');
  }
  await a.save();
  await audit(req, 'Update', 'UniversityAnnouncement', a._id, act); res.json({ ok: true });
}));
router.post('/admin/uni-notices', h(async (req, res) => {
  adminOnly(req); const b = req.body ?? {};
  if (b.delete) { if (oid(b.delete)) await UniNotice.deleteOne({ _id: oid(b.delete) }); res.json({ ok: true }); return; }
  if (!clean(b.title)) throw fieldErr('title', 'Title is required');
  const uid = b.university_id && oid(b.university_id) ? oid(b.university_id) : null;
  const n = await UniNotice.create({ university_id: uid ?? undefined, title: clean(b.title, 150), body: clean(b.body, 2000), active_until: b.active_until || undefined, created_by: req.user!.id });
  for (const u of uid ? [uid] : await University.distinct('_id', { portal_status: 'Active' })) await P.notifyUni(u, {}, `Notice from La Europa: ${clean(b.title, 150)}`, '/announcements');
  await audit(req, 'Create', 'PartnerNotice', n._id, b.title); res.json({ ok: true });
}));

// =====================================================================================
// S50 to S52 Commission (Admin only, never counsellors)
// =====================================================================================
router.get('/admin/commission/rules', h(async (req, res) => {
  adminOnly(req);
  const rules = (await CommissionRule.find({ is_deleted: false }).sort({ university_id: 1, name: 1 }).lean()) as Any[];
  const unis = await uniNames(rules.map((x) => x.university_id));
  const withAg = await PartnerAgreement.distinct('university_id');
  res.json({ rows: rules.map((x) => ({ ...x, id: String(x._id), university: unis.get(String(x.university_id)) })),
    universities: ((await University.find({ $or: [{ portal_status: { $ne: null } }, { _id: { $in: withAg } }] }).select('name display_name').lean()) as Any[]).map((u) => ({ id: String(u._id), name: P.uniName(u) })),
    agreements: ((await PartnerAgreement.find({ is_deleted: false }).select('university_id agreement_code title').lean()) as Any[]).map((a) => ({ ...a, id: String(a._id) })), currencies: await currencies() });
}));
router.post('/admin/commission/rules', h(async (req, res) => {
  adminOnly(req);
  const b = req.body ?? {}; const cur = b.id && oid(b.id) ? await CommissionRule.findById(oid(b.id)) : null; const e: Record<string, string> = {};
  if (!oid(b.university_id) || !(await University.exists({ _id: oid(b.university_id) }))) e.university_id = 'Choose the university';
  if (!oid(b.agreement_id) || !(await PartnerAgreement.exists({ _id: oid(b.agreement_id), university_id: oid(b.university_id) }))) e.agreement_id = 'Choose the partner agreement';
  if (!clean(b.name)) e.name = 'Rule name is required';
  if (!['all', 'levels', 'courses', 'campuses'].includes(b.scope)) e.scope = 'Choose the scope';
  if (!['gross', 'net', 'fixed'].includes(b.basis)) e.basis = 'Choose the basis';
  const rate = num(b.rate), fixed = num(b.fixed_amount), dd = num(b.due_days);
  if (b.basis !== 'fixed' && !(rate != null && rate >= 0.01 && rate <= 100)) e.rate = 'Rate must be 0.01 to 100';
  if (b.basis === 'fixed' && !(fixed != null && fixed > 0 && b.fixed_currency)) e.fixed_amount = 'Amount and currency are required';
  if (!['enrolled', 'deposit', 'days'].includes(b.due_event)) e.due_event = 'Choose when it becomes due';
  if (b.due_event === 'days' && !(dd != null && dd >= 0 && dd <= 365)) e.due_days = '0 to 365';
  if (!b.valid_from) e.valid_from = 'Valid from is required';
  if (Object.keys(e).length) throw bad('Please fix the highlighted fields', { errors: e });
  const scopeIds: string[] = b.scope === 'all' ? [] : (Array.isArray(b.scope_ids) ? b.scope_ids : []).map(String);
  // two rules with the same scope and overlapping dates are blocked
  const same = (await CommissionRule.find({ university_id: b.university_id, scope: b.scope, status: 'Active', is_deleted: false, ...(cur ? { _id: { $ne: cur._id } } : {}) }).lean()) as Any[];
  const clash = same.find((x) => JSON.stringify([...(x.scope_ids ?? [])].sort()) === JSON.stringify([...scopeIds].sort()) && (x.valid_from || '0000') <= (b.valid_to || '9999') && (b.valid_from || '0000') <= (x.valid_to || '9999'));
  if (clash && b.status !== 'Inactive') throw bad(`Rule "${clash.name}" has the same scope and overlapping dates.`);
  const f: Any = { university_id: b.university_id, agreement_id: b.agreement_id, name: clean(b.name, 100), scope: b.scope, scope_ids: scopeIds, intakes: Array.isArray(b.intakes) ? b.intakes.map(String) : [], valid_from: b.valid_from, valid_to: b.valid_to || null,
    basis: b.basis, rate: b.basis === 'fixed' ? null : rate, fixed_amount: b.basis === 'fixed' ? fixed : null, fixed_currency: b.basis === 'fixed' ? b.fixed_currency : null, due_event: b.due_event, due_days: dd,
    slabs: (Array.isArray(b.slabs) ? b.slabs : []).filter((s0: Any) => (num(s0?.from) ?? 0) > 0), min_amount: num(b.min_amount), max_amount: num(b.max_amount), cap_currency: b.cap_currency || null,
    show_to_uni: b.show_to_uni === undefined ? true : bool(b.show_to_uni), status: b.status === 'Inactive' ? 'Inactive' : 'Active', internal_note: clean(b.internal_note, 2000), updated_by: req.user!.id };
  const old = cur?.toObject();
  let r = cur;
  if (r) r.set(f); else r = new CommissionRule({ rule_code: `LE-CR-${String((await CommissionRule.countDocuments()) + 1).padStart(4, '0')}`, ...f, created_by: req.user!.id });
  await r.save();
  await audit(req, cur ? 'Update' : 'Create', 'CommissionRule', r._id, f.name, old, f); res.json({ ok: true, id: String(r._id) });
}));
async function commissionOut(c: Any): Promise<Any> {
  const a = c.application_id ? ((await Application.findById(c.application_id).lean()) as Any) : null;
  const s = a ? ((await Student.findById(a.student_id).select('first_name middle_name last_name').lean()) as Any) : null;
  const ua = c.uapp_id ? ((await UniversityApplication.findById(c.uapp_id).select('enrol_date student_uni_id').lean()) as Any) : null;
  const nm = async (m: { findById: (id: unknown) => any }, id: unknown) => (id ? ((await m.findById(id).select('name').lean()) as Any)?.name ?? '' : '');
  return { ...c, id: String(c._id), university: P.uniName((await University.findById(c.university_id).select('name display_name').lean()) as Any), student: s ? fullName(s) : 'Volume bonus', application_code: a?.application_code ?? '-',
    course: a ? a.course_name_text || (await nm(Course, a.course_id)) : '', intake: a ? await nm(Intake, a.intake_id) : '', enrol_date: ua?.enrol_date ?? null, student_uni_id: ua?.student_uni_id ?? null,
    rule: c.rule_id ? await nm(CommissionRule, c.rule_id) : null, invoice_no: c.invoice_id ? ((await CommissionInvoice.findById(c.invoice_id).select('invoice_no').lean()) as Any)?.invoice_no ?? null : null };
}
router.get('/admin/commission', h(async (req, res) => {
  adminOnly(req); const q = req.query as Any; const f: Any = { is_deleted: false };
  if (q.university && oid(q.university)) f.university_id = oid(q.university); if (q.status) f.status = String(q.status);
  const rows = []; for (const c of (await Commission.find(f).sort({ createdAt: -1 }).limit(1000).lean()) as Any[]) rows.push(await commissionOut(c));
  const invs = (await CommissionInvoice.find({ is_deleted: false, ...(f.university_id ? { university_id: f.university_id } : {}) }).sort({ createdAt: -1 }).limit(300).lean()) as Any[];
  const unis = await uniNames(invs.map((i) => i.university_id));
  const invoices = [];
  for (const i of invs) invoices.push({ ...i, id: String(i._id), university: unis.get(String(i.university_id)), balance: Math.round(((i.total || 0) - (i.paid || 0)) * 100) / 100, lines: await Commission.countDocuments({ invoice_id: i._id }),
    payments: ((await CommissionPayment.find({ invoice_id: i._id }).sort({ createdAt: -1 }).lean()) as Any[]).map((x) => ({ ...x, id: String(x._id), proof: undefined, proof_url: x.proof?.url ? `/api/admin/commission/payments/${x._id}/proof` : null })),
    queries: ((await InvoiceQuery.find({ invoice_id: i._id }).sort({ createdAt: -1 }).lean()) as Any[]).map((qq) => ({ ...qq, id: String(qq._id) })) });
  res.json({ rows, invoices, rules: ((await CommissionRule.find({ is_deleted: false }).select('name university_id').lean()) as Any[]).map((r) => ({ ...r, id: String(r._id) })),
    universities: ((await University.find({ portal_status: { $ne: null } }).select('name display_name').lean()) as Any[]).map((u) => ({ id: String(u._id), name: P.uniName(u) })) });
}));
router.put('/admin/commission/:id', h(async (req, res) => {
  adminOnly(req); const c = oid(req.params.id) ? await Commission.findById(oid(req.params.id)) : null; if (!c) throw P.NotFound();
  const b = req.body ?? {};
  if (['Invoiced', 'Paid', 'Overdue'].includes(c.status) && !b.cancel) throw bad('This line is invoiced. Cancel the invoice with a credit note first.');
  const old = c.toObject(); const f: Any = {};
  if (b.cancel) { if (!clean(b.reason)) throw fieldErr('reason', 'Reason is required'); if (c.invoice_id) throw bad('Cancel the invoice with a credit note first.'); f.status = 'Cancelled'; f.cancel_reason = clean(b.reason, 300); }
  else {
    if ((b.rule_id && String(b.rule_id) !== String(c.rule_id)) || (b.basis_amount !== undefined && num(b.basis_amount) !== c.basis_amount)) { if (!clean(b.reason)) throw fieldErr('reason', 'Reason is required for a manual change'); }
    if (b.rule_id && oid(b.rule_id)) f.rule_id = oid(b.rule_id); if (b.basis_amount !== undefined) f.basis_amount = num(b.basis_amount);
    const rule = (await CommissionRule.findById(f.rule_id || c.rule_id).lean()) as Any;
    if (rule) { f.rate = rule.basis === 'fixed' ? null : rule.rate; f.fixed_amount = rule.basis === 'fixed' ? rule.fixed_amount : null; f.amount = A.calcAmount(rule, f.basis_amount ?? c.basis_amount, 0); if (c.status === 'Needs rule') f.status = 'Due'; f.due_date = c.due_date || istDate(); }
    if (b.amount !== undefined && num(b.amount) != null) f.amount = num(b.amount);
    if (b.fx_rate !== undefined) { f.fx_rate = num(b.fx_rate); f.fx_date = b.fx_date || null; f.invoice_currency = b.invoice_currency || null; f.invoice_amount = f.fx_rate ? Math.round((f.amount ?? c.amount) * f.fx_rate * 100) / 100 : null; }
    if (b.internal_note !== undefined) f.internal_note = clean(b.internal_note, 2000);
  }
  c.set({ ...f, updated_by: req.user!.id }); await c.save();
  await audit(req, 'Update', 'Commission', c._id, c.commission_code, old, { ...f, reason: b.reason }); res.json({ ok: true });
}));
async function nextInvoiceNo(kind: string) {
  const t = new Date(); const y = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1; const fy = `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  const prefix = kind === 'credit_note' ? (await getSetting('credit_note_prefix')) || 'LE-CN' : (await getSetting('invoice_prefix')) || 'LE-INV';
  const c = await Counter.findByIdAndUpdate(`${prefix}-${fy}`, { $inc: { value: 1 } }, { upsert: true, new: true });
  return `${prefix}-${fy}-${String(c.value).padStart(4, '0')}`;
}
async function renderInvoice(inv: Any) {
  const lines = [];
  for (const c of (await Commission.find({ invoice_id: inv.credit_for || inv._id }).lean()) as Any[]) {
    const o = await commissionOut(c);
    lines.push({ student: o.student, application: o.application_code, uni_id: o.student_uni_id || '', course: `${o.course} (${o.intake})`, enrolled: o.enrol_date ? fmtDate(o.enrol_date) : '',
      basis: o.basis_amount != null ? `${o.basis_amount} ${o.basis_currency || ''}` : '', rate: o.rate ? o.rate + '%' : o.fixed_amount ? 'Fixed' : '', amount: `${o.invoice_amount ?? o.amount} ${o.invoice_currency || o.currency}` });
  }
  const ag = inv.agreement_id ? ((await PartnerAgreement.findById(inv.agreement_id).select('agreement_code title').lean()) as Any) : null;
  const cf = inv.credit_for ? ((await CommissionInvoice.findById(inv.credit_for).select('invoice_no').lean()) as Any)?.invoice_no : '';
  return invoicePdf(inv, lines, { agreement: ag ? `${ag.agreement_code} ${ag.title}` : '-', creditFor: cf || '' });
}
const storePdf = async (inv: Any) => {
  const buf = await renderInvoice(inv);
  const asset = await uploadBuffer({ buffer: buf, originalname: `${inv.invoice_no}.pdf`, mimetype: 'application/pdf', size: buf.length } as Express.Multer.File, `university/${inv.university_id}/invoices`);
  await CommissionInvoice.updateOne({ _id: inv._id }, { pdf: { url: asset.url, public_id: asset.publicId, resource_type: asset.resourceType } });
};
async function finEmail(code: string, inv: Any, ctx: Any) {
  const contacts = ((await UniContact.find({ university_id: inv.university_id, department: 'Finance / Accounts', is_deleted: false }).select('email').lean()) as Any[]).map((x) => x.email);
  const users = (await P.usersOf(inv.university_id, { finance: true, alert: 'finance' })).map((x: Any) => x.email);
  await trigger(code, { to: [...contacts, ...users], university_id: inv.university_id, invoice_id: inv._id, ctx, link: '/finance' });
}
router.post('/admin/commission/invoices', h(async (req, res) => {
  adminOnly(req); const b = req.body ?? {};
  const ids = (Array.isArray(b.commission_ids) ? b.commission_ids : []).filter((x: unknown) => oid(x)); if (!ids.length) throw bad('Select the commission lines');
  const lines = (await Commission.find({ _id: { $in: ids }, status: 'Due', invoice_id: null, is_deleted: false }).lean()) as Any[];
  if (lines.length !== ids.length) throw bad('Only lines with status Due (not yet invoiced) can be invoiced');
  if (new Set(lines.map((x) => String(x.university_id))).size > 1) throw bad('All selected lines must belong to the same university');
  const cur = new Set(lines.map((x) => x.invoice_currency || x.currency)); if (cur.size > 1) throw bad('All selected lines must have the same invoice currency (enter an exchange rate on the lines first)');
  const u = (await University.findById(lines[0].university_id).lean()) as Any;
  const ag = (await P.activeAgreement(u._id)) || ((await PartnerAgreement.findOne({ university_id: u._id, is_deleted: false }).sort({ start_date: -1 }).lean()) as Any);
  const subtotal = Math.round(lines.reduce((n, x) => n + Number(x.invoice_amount ?? x.amount ?? 0), 0) * 100) / 100;
  const taxes = (Array.isArray(b.taxes) ? b.taxes : []).map((t0: Any) => ({ name: clean(t0.name, 60), percent: num(t0.percent), fixed: num(t0.fixed), not_applicable: bool(t0.not_applicable), note: clean(t0.note, 200) })).filter((t0: Any) => t0.name)
    .map((t0: Any) => ({ ...t0, amount: t0.not_applicable ? 0 : t0.percent ? Math.round(subtotal * t0.percent) / 100 : t0.fixed || 0 }));
  const total = Math.round((subtotal + taxes.reduce((n: number, t0: Any) => n + t0.amount, 0)) * 100) / 100;
  const fin = (await UniContact.findOne({ university_id: u._id, department: 'Finance / Accounts', is_deleted: false }).sort({ is_primary: -1 }).lean()) as Any;
  const date = b.invoice_date || istDate();
  const inv = await CommissionInvoice.create({ invoice_no: `DRAFT-${Date.now()}`, kind: 'invoice', university_id: u._id, agreement_id: ag?._id, invoice_date: date, due_date: b.due_date || addDays(date, Number(ag?.payment_terms_days || 30)),
    currency: [...cur][0], subtotal, tax: taxes, total, bill_to: { name: b.bill_name || u.legal_name || u.display_name || u.name, address: b.bill_address || u.billing_address || '', vat_id: b.vat_id || u.vat_id || '', contact: fin ? `${fin.name}, ${fin.email}` : '' },
    notes: clean(b.notes, 1000), status: 'Draft', created_by: req.user!.id });
  await Commission.updateMany({ _id: { $in: lines.map((x) => x._id) } }, { invoice_id: inv._id });
  await audit(req, 'Create', 'CommissionInvoice', inv._id, `Draft for ${P.uniName(u)} (${lines.length} lines)`); res.json({ ok: true, id: String(inv._id) });
}));
router.get('/admin/commission/invoices/:id/pdf', h(async (req, res) => {
  adminOnly(req); const i = oid(req.params.id) ? ((await CommissionInvoice.findById(oid(req.params.id)).lean()) as Any) : null; if (!i) throw P.NotFound();
  if (i.pdf?.url && i.status !== 'Draft') { res.json({ url: signedFileUrl(i.pdf.url, i.pdf.public_id, i.pdf.resource_type || 'raw'), name: `${i.invoice_no}.pdf` }); return; }
  const buf = await renderInvoice(i);
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${i.invoice_no}.pdf"`); res.end(buf);
}));
router.post('/admin/commission/invoices/:id/:action', h(async (req, res) => {
  adminOnly(req);
  const act = req.params.action;
  const i = oid(req.params.id) ? ((await CommissionInvoice.findById(oid(req.params.id)).lean()) as Any) : null; if (!i) throw P.NotFound();
  const b = req.body ?? {};
  if (act === 'record-payment') { // from the bank statement, without a university proof
    if (!['Invoiced', 'Partially paid', 'Overdue'].includes(i.status) || i.kind !== 'invoice') throw P.NotFound();
    const amt = num(b.amount); if (!(amt != null && amt > 0)) throw fieldErr('amount', 'Amount must be more than 0'); if (!b.payment_date) throw fieldErr('payment_date', 'Date is required');
    const p = await CommissionPayment.create({ invoice_id: i._id, university_id: i.university_id, amount: amt, currency: i.currency, payment_date: b.payment_date, reference: clean(b.reference, 100), note: clean(b.note, 300), status: 'Submitted', source: 'la_europa' });
    await confirmPayment(req, i, p.toObject(), amt, null);
    await audit(req, 'Create', 'CommissionPayment', p._id, `Recorded from bank: ${i.invoice_no}`); res.json({ ok: true }); return;
  }
  if (!['issue', 'discard', 'cancel', 'pause', 'resume'].includes(act)) throw P.NotFound();
  if (act === 'discard') { if (i.status !== 'Draft') throw bad('Only drafts can be discarded'); await Commission.updateMany({ invoice_id: i._id }, { $unset: { invoice_id: 1 } }); await CommissionInvoice.updateOne({ _id: i._id }, { is_deleted: true }); }
  if (act === 'issue') {
    if (i.status !== 'Draft') throw bad('Already issued');
    const no = await nextInvoiceNo('invoice');
    await CommissionInvoice.updateOne({ _id: i._id }, { invoice_no: no, status: 'Invoiced', issued_at: new Date(), issued_by: req.user!.id });
    const inv = (await CommissionInvoice.findById(i._id).lean()) as Any;
    await storePdf(inv);
    await Commission.updateMany({ invoice_id: i._id }, { status: 'Invoiced' });
    await finEmail('E35', inv, { invoice_number: no, invoice_date: fmtDate(inv.invoice_date), invoice_total: inv.total, currency: inv.currency, due_date: fmtDate(inv.due_date) });
    await P.notifyUni(inv.university_id, { finance: true }, `Invoice ${no} issued`, '/finance');
  }
  if (act === 'cancel') { // credit note (10.5)
    if (!['Invoiced', 'Partially paid', 'Overdue', 'Paid'].includes(i.status)) throw bad('Only issued invoices can be cancelled');
    if (!clean(b.reason)) throw fieldErr('reason', 'Reason is required');
    const no = await nextInvoiceNo('credit_note');
    const cn = await CommissionInvoice.create({ invoice_no: no, kind: 'credit_note', credit_for: i._id, university_id: i.university_id, agreement_id: i.agreement_id, invoice_date: istDate(), currency: i.currency, subtotal: i.subtotal, tax: i.tax, total: i.total,
      bill_to: i.bill_to, notes: `Credit note for invoice ${i.invoice_no}. Reason: ${clean(b.reason, 500)}`, status: 'Invoiced', issued_at: new Date(), issued_by: req.user!.id, created_by: req.user!.id });
    await storePdf(cn.toObject());
    await CommissionInvoice.updateOne({ _id: i._id }, { status: 'Cancelled', cancel_reason: clean(b.reason, 500) });
    await Commission.updateMany({ invoice_id: i._id }, { status: 'Due', $unset: { invoice_id: 1 } });
    await finEmail('E35', cn.toObject(), { invoice_number: no, invoice_date: fmtDate(cn.invoice_date), invoice_total: cn.total, currency: cn.currency, due_date: '-' });
  }
  if (act === 'pause' || act === 'resume') await CommissionInvoice.updateOne({ _id: i._id }, { reminders_paused: act === 'pause' });
  await audit(req, 'Update', 'CommissionInvoice', i._id, `${act} ${i.invoice_no}`); res.json({ ok: true });
}));
async function confirmPayment(req: AuthRequest, i: Any, p: Any | null, amount: number, note: string | null) {
  if (p) await CommissionPayment.updateOne({ _id: p._id }, { status: 'Confirmed', confirmed_amount: amount, ...(note ? { note } : {}), reviewed_by: req.user!.id, reviewed_at: new Date() });
  const paid = Math.round(((i.paid || 0) + amount) * 100) / 100;
  const status = paid + 0.009 >= i.total ? 'Paid' : 'Partially paid';
  await CommissionInvoice.updateOne({ _id: i._id }, { paid, status });
  if (status === 'Paid') await Commission.updateMany({ invoice_id: i._id }, { status: 'Paid' });
  await finEmail('E37', i, { amount, currency: i.currency, payment_date: fmtDate(p?.payment_date || istDate()), invoice_number: i.invoice_no, balance: Math.round((i.total - paid) * 100) / 100 });
  await P.notifyUni(i.university_id, { finance: true }, `Payment confirmed for invoice ${i.invoice_no}`, '/finance');
}
router.post('/admin/commission/payments/:id/:action', h(async (req, res) => {
  adminOnly(req);
  const act = req.params.action; if (!['confirm', 'reject'].includes(act)) throw P.NotFound();
  const p = oid(req.params.id) ? ((await CommissionPayment.findOne({ _id: oid(req.params.id), status: 'Submitted' }).lean()) as Any) : null; if (!p) throw bad('This payment was already reviewed');
  const i = (await CommissionInvoice.findById(p.invoice_id).lean()) as Any;
  const b = req.body ?? {};
  if (act === 'reject') {
    if (!clean(b.reason)) throw fieldErr('reason', 'Reason is required (shown to the university)');
    await CommissionPayment.updateOne({ _id: p._id }, { status: 'Rejected', reject_reason: clean(b.reason, 300), reviewed_by: req.user!.id, reviewed_at: new Date() });
    await P.notifyUni(i.university_id, { finance: true }, `Payment proof for ${i.invoice_no} was not accepted: ${clean(b.reason, 200)}`, '/finance');
  } else await confirmPayment(req, i, p, num(b.amount) ?? p.amount, clean(b.note, 300) ?? null);
  await audit(req, act === 'confirm' ? 'Confirm' : 'Reject', 'CommissionPayment', p._id, i.invoice_no); res.json({ ok: true });
}));
router.get('/admin/commission/payments/:id/proof', h(async (req, res) => {
  adminOnly(req); const p = oid(req.params.id) ? ((await CommissionPayment.findById(oid(req.params.id)).lean()) as Any) : null; if (!p?.proof?.url) throw P.NotFound();
  res.json({ url: signedFileUrl(p.proof.url, p.proof.public_id, p.proof.resource_type), name: p.proof_name });
}));
router.post('/admin/commission/queries/:qid/:action', h(async (req, res) => {
  adminOnly(req);
  const act = req.params.action; if (!['reply', 'close'].includes(act)) throw P.NotFound();
  const q = oid(req.params.qid) ? await InvoiceQuery.findById(oid(req.params.qid)) : null; if (!q) throw P.NotFound();
  if (act === 'reply') { const body = clean(req.body?.body, 2000); if (!body) throw fieldErr('body', 'Write the reply'); q.messages.push({ sender_type: 'staff', sender_id: req.user!.id, body, sent_at: new Date() }); }
  else q.set({ status: 'Closed', closed_at: new Date(), closed_by: req.user!.id });
  await q.save();
  if (act === 'close' && !(await InvoiceQuery.exists({ invoice_id: q.invoice_id, status: 'Open' }))) await CommissionInvoice.updateOne({ _id: q.invoice_id }, { query_open: false });
  await P.notifyUni(q.university_id, { finance: true }, `La Europa ${act === 'reply' ? 'replied to' : 'closed'} your invoice query`, '/finance');
  res.json({ ok: true });
}));
/** S52 reports, per currency, no conversion */
const ST = ['Expected', 'Due', 'Invoiced', 'Paid', 'Overdue'];
router.get('/admin/commission/reports/:type', h(async (req, res) => {
  adminOnly(req);
  const q = req.query as Any; const type = req.params.type;
  const f: Any = { is_deleted: false };
  if (q.university && oid(q.university)) f.university_id = oid(q.university);
  if (q.from || q.to) f.createdAt = { ...(q.from ? { $gte: new Date(String(q.from)) } : {}), ...(q.to ? { $lte: new Date(String(q.to) + 'T23:59:59') } : {}) };
  let lines = (await Commission.find(f).lean()) as Any[];
  const apps = new Map(((await Application.find({ _id: { $in: lines.map((x) => x.application_id).filter(Boolean) } }).select('intake_id country_id').lean()) as Any[]).map((a) => [String(a._id), a]));
  lines = lines.map((x): Any => ({ ...x, intake_id: apps.get(String(x.application_id))?.intake_id, country_id: apps.get(String(x.application_id))?.country_id }))
    .filter((x) => (!q.intake || String(x.intake_id) === String(q.intake)) && (!q.country || String(x.country_id) === String(q.country)) && (!q.currency || (x.invoice_currency || x.currency) === q.currency));
  const unis = await uniNames([...lines.map((x) => x.university_id), ...((await University.find({ portal_status: { $ne: null } }).select('_id').lean()) as Any[]).map((u) => u._id)]);
  const intakes = new Map(((await Intake.find().select('name').lean()) as Any[]).map((i) => [String(i._id), i.name]));
  const sum = (l: Any[]) => Math.round(l.reduce((n, x) => n + Number(x.amount || 0), 0) * 100) / 100;
  const groupBy = (keyFn: (x: Any) => string) => { const g: Record<string, Any[]> = {}; for (const x of lines) { const k = `${keyFn(x)}|${x.currency || '-'}`; (g[k] = g[k] || []).push(x); } return g; };
  const byStatus = (g: Record<string, Any[]>) => Object.entries(g).map(([k, l]) => [...k.split('|'), ...ST.map((s) => sum(l.filter((x) => x.status === s)))]);
  let data: { columns: string[]; rows: unknown[][] };
  const days = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 864e5);
  if (type === 'by_university') data = { columns: ['University', 'Currency', ...ST], rows: byStatus(groupBy((x) => unis.get(String(x.university_id)) || '-')) };
  else if (type === 'by_intake') data = { columns: ['Intake', 'Currency', ...ST], rows: byStatus(groupBy((x) => intakes.get(String(x.intake_id)) || '-')) };
  else if (type === 'ageing') {
    const inv = (await CommissionInvoice.find({ status: 'Overdue', is_deleted: false, ...(f.university_id ? { university_id: f.university_id } : {}) }).lean()) as Any[];
    const iu = await uniNames(inv.map((i) => i.university_id));
    const bucket = (d: string) => { const n = days(d); return n <= 30 ? '1 to 30' : n <= 60 ? '31 to 60' : n <= 90 ? '61 to 90' : 'more than 90'; };
    data = { columns: ['Invoice', 'University', 'Due date', 'Days overdue', 'Bucket', 'Balance', 'Currency'], rows: inv.map((i) => [i.invoice_no, iu.get(String(i.university_id)), fmtDate(i.due_date), days(i.due_date), bucket(i.due_date), Math.round((i.total - i.paid) * 100) / 100, i.currency]) };
  } else if (type === 'forecast') {
    const g: Record<string, number> = {}; for (const x of lines.filter((y) => ['Expected', 'Due'].includes(y.status))) { const k = `${String(x.due_date || 'not set').slice(0, 7)}|${x.currency}`; g[k] = (g[k] || 0) + Number(x.amount || 0); }
    data = { columns: ['Month', 'Currency', 'Expected / due amount'], rows: Object.entries(g).sort().map(([k, v]) => [...k.split('|'), Math.round(v * 100) / 100]) };
  } else if (type === 'collections') {
    const g: Record<string, number> = {}; for (const x of (await CommissionPayment.find({ status: 'Confirmed' }).lean()) as Any[]) { const k = `${String(x.payment_date).slice(0, 7)}|${x.currency}`; g[k] = (g[k] || 0) + Number(x.confirmed_amount ?? x.amount); }
    data = { columns: ['Month', 'Currency', 'Confirmed payments'], rows: Object.entries(g).sort().map(([k, v]) => [...k.split('|'), Math.round(v * 100) / 100]) };
  } else if (type === 'attention') {
    const queries = (await InvoiceQuery.find({ status: 'Open' }).lean()) as Any[];
    const qinv = new Map(((await CommissionInvoice.find({ _id: { $in: queries.map((x) => x.invoice_id) } }).select('invoice_no').lean()) as Any[]).map((i) => [String(i._id), i.invoice_no]));
    const cancelled = (await CommissionInvoice.find({ status: 'Cancelled' }).sort({ updatedAt: -1 }).limit(50).lean()) as Any[];
    const au = await uniNames([...queries, ...cancelled].map((x) => x.university_id));
    data = { columns: ['Type', 'Reference', 'University', 'Detail'], rows: [
      ...lines.filter((x) => x.status === 'Needs rule').map((x) => ['Needs rule', x.commission_code, unis.get(String(x.university_id)), x.internal_note || '']),
      ...queries.map((x) => ['Query open', qinv.get(String(x.invoice_id)), au.get(String(x.university_id)), '']),
      ...cancelled.map((x) => ['Invoice cancelled', x.invoice_no, au.get(String(x.university_id)), x.cancel_reason || '']),
      ...lines.filter((x) => x.recalculated).map((x) => ['Recalculated', x.commission_code, unis.get(String(x.university_id)), ''])] };
  } else if (type === 'universities') {
    const rows: unknown[][] = [];
    for (const u of (await University.find({ portal_status: { $ne: null } }).lean()) as Any[]) {
      const ua = (await UniversityApplication.find({ university_id: u._id, is_deleted: false }).select('status first_decision_at submitted_at').lean()) as Any[]; const dec = ua.filter((x) => x.first_decision_at);
      rows.push([P.uniName(u), u.portal_status, ua.length, ua.filter((x) => x.status === 'New').length, ua.filter((x) => ['Conditional offer', 'Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'].includes(x.status)).length, ua.filter((x) => x.status === 'Enrolled').length,
        dec.length ? Math.round((dec.reduce((n, x) => n + (new Date(x.first_decision_at).getTime() - new Date(x.submitted_at).getTime()) / 864e5, 0) / dec.length) * 10) / 10 : '-']);
    }
    data = { columns: ['University', 'Portal', 'Applications', 'New not acknowledged', 'Offers', 'Enrolled', 'Avg days to decision'], rows };
  } else throw P.NotFound();
  if (!q.format) { res.json(data); return; }
  await audit(req, 'Export', 'CommissionReport', null, `${type} ${q.format}`);
  if (q.format === 'xlsx') { await xlsxOut(res, type, data.columns, data.rows); return; }
  const buf = await tablePdf({ title: `La Europa: ${type.replace(/_/g, ' ')}`, sub: `Generated on ${fmtDateTime(new Date())} IST. Totals per currency, no conversion.`, columns: data.columns, rows: data.rows });
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${type}.pdf"`); res.end(buf);
}));

// =====================================================================================
// S53 University portal settings (global) and document type flags (C19)
// =====================================================================================
export const UNI_SETTINGS: Record<string, string> = { uni_portal_enabled: '1', uni_idle_min: '30', uni_remember_device: '1', uni_invite_days: '7', uni_review_reminder_days: '1', uni_review_admin_days: '2', uni_always_review_rejections: '1', uni_ack_email: '1',
  uni_auto_approve_minor: '0', uni_small_numbers: '1', uni_download_alert: '50', uni_access_months: '12', uni_ack_days: '3', uni_agreement_warn_days: '60', uni_agreement_reminders: '60,30,7', uni_invoice_reminders: '7,0,7',
  uni_bulk_max_rows: '1000', uni_max_file_mb: '10', uni_sending_address: '', uni_display_name: 'La Europa Education Partner Team', uni_noreply_address: '', partner_portal_url: '', uni_email_footer: '',
  uni_officers_edit_contacts: '0', invoice_prefix: 'LE-INV', credit_note_prefix: 'LE-CN', invoice_tax_ids: '', invoice_bank_details: '', show_uni_social: '0' };
router.get('/admin/uni-settings', h(async (req, res) => {
  adminOnly(req);
  const values: Record<string, string> = {}; for (const [k, d] of Object.entries(UNI_SETTINGS)) values[k] = (await getSetting(k)) ?? d;
  res.json({ values, countries: ((await Country.find().sort({ name: 1 }).select('name transfers_allowed').lean()) as Any[]).map((c) => ({ id: String(c._id), name: c.name, transfers_allowed: c.transfers_allowed !== false })) });
}));
router.put('/admin/uni-settings', h(async (req, res) => {
  adminOnly(req); const b = req.body ?? {}; const e: Record<string, string> = {};
  if (b.uni_idle_min !== undefined && !(Number(b.uni_idle_min) >= 15 && Number(b.uni_idle_min) <= 120)) e.uni_idle_min = '15 to 120 minutes';
  if (b.uni_sending_address && !isEmail(b.uni_sending_address)) e.uni_sending_address = 'Valid email address';
  if (b.partner_portal_url && !/^https?:\/\//.test(b.partner_portal_url)) e.partner_portal_url = 'Full URL (https://...)';
  if (Object.keys(e).length) throw bad('Please fix the highlighted fields', { errors: e });
  for (const k of Object.keys(UNI_SETTINGS)) if (k in b) await setSetting(k, b[k] === true ? '1' : b[k] === false ? '0' : String(b[k] ?? '').slice(0, 2000), req.user!.id);
  for (const c of Array.isArray(b.countries) ? b.countries : []) if (oid(c?.id)) await Country.updateOne({ _id: oid(c.id) }, { transfers_allowed: !!c.transfers_allowed });
  await audit(req, 'Update', 'Settings', null, 'University portal settings'); res.json({ ok: true });
}));
router.put('/admin/doc-types/:id/uni-flags', h(async (req, res) => {
  adminOnly(req);
  const t = oid(req.params.id) ? await MasterItem.findOne({ _id: oid(req.params.id), type: 'document_type' }) : null; if (!t) throw P.NotFound();
  t.data = { ...(t.data ?? {}), never_share_uni: bool(req.body?.never_share_uni), uni_can_upload: bool(req.body?.uni_can_upload) }; t.markModified('data'); await t.save();
  await audit(req, 'Update', 'DocumentType', t._id, t.name); res.json({ ok: true });
}));

export default router;
