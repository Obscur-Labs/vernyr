import { Router } from 'express';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import { authenticate, type AuthRequest } from '../middleware/auth';
import User from '../models/User';
import Student from '../models/Student';
import Lead from '../models/Lead';
import PortalAccount from '../models/PortalAccount';
import University from '../models/University';
import Course from '../models/Course';
import { FeeSummary, Payment, StageHistory, VisaCase, Application } from '../models/Work';
import { AccountDeletionRequest, ProfileChangeRequest } from '../models/Portal';
import { EmailLog } from '../models/Email';
import { AuditLog, audit, getSetting, setSetting } from '../models/Audit';
import { Branch, DiscountRequest, ApprovalNote, UnassignedQueue, RestoreTest } from '../models/Console';
import { bad, fieldErr, handle, clean, istDate, istDayStart, addDays, encrypt, decrypt, userNames, nameIn, escRx } from '../services/crm';
import { notify } from '../services/tasks';
import { isSuper, can, need, needSuper, GROUPS, LIST, BY, FIXED, regVal, regCheck, regSet, lastChange } from '../services/console';

/** The Admin console (legacy/server/admin5/ops.js): home, approvals centre, company profile, settings, health, audit log. */
const router = Router();
router.use(authenticate);

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Working days since (Mon to Fri). */
const wd = (d: Date | string) => { let x = new Date(d); let n = 0; const end = new Date(); while (x < end) { x = new Date(+x + 864e5); if (x <= end && ![0, 6].includes(x.getDay())) n++; } return n; };
const sla = async () => Number(await regVal('approvals_sla_days')) || 2;

// ---------- approvals centre: one queue over every request type; actions call the existing endpoints ----------
export async function approvalItems(req: AuthRequest) {
  const out: Any[] = [];
  const s = await sla();
  const names = await userNames();
  const push = (o: Any) => out.push({ ...o, waiting_days: wd(o.submitted_at), late: wd(o.submitted_at) > s });
  if (await can(req, 'fees', 'approve')) {
    const fees = await FeeSummary.find({ fee_kind: 'service', discount_approved: false, is_deleted: false }).lean() as Any[];
    const studs = await Student.find({ _id: { $in: fees.map((f) => f.student_id) } }).select('first_name last_name student_code').lean();
    for (const f of fees) {
      const st = studs.find((x) => String(x._id) === String(f.student_id));
      const rq = await DiscountRequest.findOne({ fee_summary_id: f._id, status: 'Pending' }).sort({ createdAt: -1 }).lean();
      push({ key: 'discount:' + f._id, type: 'Service fee discount', source: 'Staff', source_name: nameIn(names, rq?.requested_by ?? f.updated_by ?? f.created_by),
        summary: `${st?.student_code} ${st?.first_name} ${st?.last_name ?? ''}: discount INR ${f.discount} on ${f.total_amount}${rq?.reason ? ` (${rq.reason})` : ''}`, submitted_at: f.updatedAt ?? f.createdAt,
        approve: { url: `/fee-summaries/${f._id}/approve-discount`, body: { approve: true } }, reject: { url: `/fee-summaries/${f._id}/approve-discount`, body: { approve: false } } });
    }
    const refunds = await Payment.find({ is_refund: true, refund_status: 'Pending', is_deleted: false }).lean();
    const rs = await Student.find({ _id: { $in: refunds.map((p) => p.student_id) } }).select('first_name student_code').lean();
    for (const p of refunds) {
      const st = rs.find((x) => String(x._id) === String(p.student_id));
      push({ key: 'refund:' + p._id, type: 'Refund to a student', source: 'Staff', source_name: nameIn(names, p.created_by), summary: `${st?.student_code} ${st?.first_name}: refund ${Math.abs(p.amount)} ${p.currency} (${p.refund_reason ?? ''})`,
        submitted_at: (p as Any).createdAt, approve: { url: `/console/refunds/${p._id}/approve`, body: {} }, reject: { url: `/console/refunds/${p._id}/reject` } });
    }
  }
  if (await can(req, 'privacy')) {
    for (const d of await AccountDeletionRequest.find({ status: 'Requested' }).lean())
      push({ key: 'deletion:' + d._id, type: 'Account deletion request', source: 'Student', source_name: (await PortalAccount.findById(d.student_user_id).select('email').lean())?.email,
        summary: d.reason || 'Delete my account', submitted_at: d.createdAt, link: '/admin/privacy', approve: null, reject: null });
  }
  const esc = Number((await getSetting('request_review_days')) || 2);
  for (const x of (await ProfileChangeRequest.find({ status: 'Pending', is_deleted: false }).lean()).filter((y) => wd(y.createdAt) >= esc))
    push({ key: 'pcr:' + x._id, type: 'Student profile change (escalated)', source: 'Student', source_name: (await Student.findById(x.student_id).select('student_code').lean())?.student_code,
      summary: x.field_label || x.field_key, submitted_at: x.createdAt, link: '/requests', approve: null, reject: null });
  for (const it of out) it.notes = (await ApprovalNote.find({ item_key: it.key }).sort({ at: 1 }).lean()).map((n) => ({ kind: n.kind, text: n.text, at: n.at, by: nameIn(names, n.by_user) }));
  return out.sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || String(a.submitted_at).localeCompare(String(b.submitted_at)));
}
router.get('/console/approvals', handle(async (req, res) => {
  const rows = await approvalItems(req);
  res.json({ rows, sla_days: await sla(), counts: rows.reduce((o, x) => { o[x.type] = (o[x.type] || 0) + 1; return o; }, {} as Record<string, number>) });
}));
router.post('/console/approvals/info', handle(async (req, res) => {
  const it = (await approvalItems(req)).find((x) => x.key === req.body?.key);
  if (!it) throw bad('This item is no longer waiting');
  const text = clean(req.body?.text, 500);
  if (!text) throw fieldErr('text', 'Write what information you need');
  await ApprovalNote.create({ item_key: it.key, kind: 'info', text, by_user: req.user!.id });
  const [type, id] = it.key.split(':');
  const who = type === 'discount' ? (await DiscountRequest.findOne({ fee_summary_id: id }).sort({ createdAt: -1 }).lean())?.requested_by ?? (await FeeSummary.findById(id).lean() as Any)?.updated_by
    : type === 'refund' ? (await Payment.findById(id).lean())?.created_by : null;
  if (who) await notify(who, 'approval', `Admin needs more information: ${text}`, '/dashboard');
  await audit(req, 'Ask for info', 'ApprovalItem', it.key, text);
  res.json({ ok: true });
}));

// ---------- admin home: company KPIs, funnel, leaderboard, catalogue quality ----------
router.get('/console/home', handle(async (req, res) => {
  if (!(await isSuper(req)) && !(await can(req, 'reports'))) throw bad('Not allowed');
  const q = req.query as Record<string, string>;
  const t = istDate();
  const from = q.period === 'fy' ? `${Number(t.slice(5, 7)) >= 4 ? t.slice(0, 4) : Number(t.slice(0, 4)) - 1}-04-01` : q.period === 'all' ? '2000-01-01' : t.slice(0, 8) + '01';
  const fromD = istDayStart(from);
  const branchUsers = q.branch ? await User.distinct('_id', { branch_id: q.branch }) : null;
  const byC = (field: string) => (branchUsers ? { [field]: { $in: branchUsers } } : {});
  const studentsIn = branchUsers ? await Student.distinct('_id', { primary_counsellor_id: { $in: branchUsers } }) : null;
  const appsIn = studentsIn ? await Application.distinct('_id', { student_id: { $in: studentsIn } }) : null;
  const moved = async (stages: string[]) => (await StageHistory.distinct('application_id', { to_stage: { $in: stages }, changed_at: { $gte: fromD }, application_id: appsIn ? { $in: appsIn } : { $ne: null } })).length;
  const service = await Payment.aggregate([{ $match: { payment_for: 'La Europa service fee', is_deleted: false, payment_date: { $gte: from }, ...(studentsIn ? { student_id: { $in: studentsIn } } : {}) } }, { $group: { _id: '$currency', s: { $sum: '$amount' } } }]);
  const kpi = {
    new_leads: await Lead.countDocuments({ is_deleted: false, createdAt: { $gte: fromD }, ...byC('assigned_user_id') }),
    registered: await Student.countDocuments({ is_deleted: false, createdAt: { $gte: fromD }, ...byC('primary_counsellor_id') }),
    applied: await moved(['applied']), offers: await moved(['conditional_offer', 'unconditional_offer']),
    visa_approved: await VisaCase.countDocuments({ stage: 'approved', is_deleted: false, updatedAt: { $gte: fromD }, ...(studentsIn ? { student_id: { $in: studentsIn } } : {}) }),
    enrolled: await moved(['enrolment_confirmed']), service_fee: service.map((x) => ({ currency: x._id, amount: Math.round(x.s * 100) / 100 })),
  };
  const funnel = [['Leads', kpi.new_leads], ['Registered', kpi.registered], ['Applied', kpi.applied], ['Offers', kpi.offers], ['Visa approved', kpi.visa_approved], ['Enrolled', kpi.enrolled]];
  const counsellors = await User.find({ role: 'counsellor', isActive: true, ...(q.branch ? { branch_id: q.branch } : {}) }).select('name').lean();
  const leaders = (await Promise.all(counsellors.map(async (u) => {
    const mine = await Student.distinct('_id', { primary_counsellor_id: u._id });
    const apps = await Application.distinct('_id', { student_id: { $in: mine } });
    return { name: u.name, enrolled: (await StageHistory.distinct('application_id', { to_stage: 'enrolment_confirmed', changed_at: { $gte: fromD }, application_id: { $in: apps } })).length,
      registered: await Student.countDocuments({ primary_counsellor_id: u._id, createdAt: { $gte: fromD }, is_deleted: false }) };
  }))).sort((a, b) => b.enrolled - a.enrolled || b.registered - a.registered).slice(0, 8);
  const publishedUnis = await Course.distinct('university_id', { status: 'Published', is_deleted: false });
  const quality = { missing_logo: await University.countDocuments({ _id: { $in: publishedUnis }, logo_url: null }),
    old_verified: await Course.countDocuments({ status: 'Published', is_deleted: false, $or: [{ last_verified_on: null }, { last_verified_on: { $lt: addDays(t, -182) } }] }), link_warnings: 0 };
  const badges = { approvals: (await approvalItems(req)).length, unassigned: await UnassignedQueue.countDocuments({ status: 'Open' }),
    failed_emails: await EmailLog.countDocuments({ status: { $in: ['Failed', 'Bounced'] }, queued_at: { $gt: new Date(Date.now() - 7 * 864e5) } }),
    privacy: await AccountDeletionRequest.countDocuments({ status: 'Requested' }) };
  res.json({ badges, kpi, funnel, leaders, expiring: [], quality, finance: await can(req, 'reconciliation'),
    branches: (await Branch.find({ is_deleted: false }).sort({ name: 1 }).select('name').lean()).map((b) => ({ id: String(b._id), name: b.name })) });
}));

// ---------- company profile (bank details encrypted; Super Admin edits) ----------
const COMPANY = ['company_legal_name', 'company_trading_name', 'company_llpin', 'company_address', 'company_gstin', 'company_pan', 'company_signatory', 'company_signatory_designation',
  'invoice_prefix_university', 'invoice_prefix_credit', 'receipt_prefix', 'company_logo_note', 'company_website', 'company_phone'];
const companyValues = async () => Object.fromEntries(await Promise.all(COMPANY.map(async (k) => [k, await regVal(k)])));
router.get('/console/company', handle(async (req, res) => {
  await need(req, 'company');
  const bank = await getSetting('company_bank_enc');
  const sup = await isSuper(req);
  let b: unknown = null;
  if (sup && bank) { try { b = JSON.parse(decrypt(String(bank)) ?? 'null'); } catch { b = null; } }
  res.json({ values: await companyValues(), bank: b, bank_on_file: !!bank, can_edit: sup, fixed: { company_legal_name: 'Euroverse Service LLP', company_trading_name: 'La Europa Education' } });
}));
router.put('/console/company', handle(async (req, res) => {
  await needSuper(req);
  const b = req.body ?? {};
  const errors: Record<string, string> = {};
  if (b.company_gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(String(b.company_gstin).toUpperCase())) errors.company_gstin = 'Enter a valid GSTIN';
  if (b.company_pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(String(b.company_pan).toUpperCase())) errors.company_pan = 'Enter a valid PAN';
  if (!clean(b.company_llpin)) errors.company_llpin = 'LLPIN is required';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  const old = await companyValues();
  for (const k of COMPANY) if (b[k] !== undefined && !['company_legal_name', 'company_trading_name'].includes(k))
    await setSetting(k, ['company_gstin', 'company_pan'].includes(k) ? String(b[k] || '').toUpperCase() : String(b[k] || ''), req.user!.id);
  if (b.bank && typeof b.bank === 'object') {
    const bank = Object.fromEntries(['account_name', 'bank_name', 'account_no', 'ifsc', 'account_type', 'branch', 'city', 'state', 'pin', 'upi_id', 'swift'].map((k) => [k, clean(b.bank[k], 120) ?? '']));
    if (bank.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bank.ifsc.toUpperCase())) throw fieldErr('ifsc', 'Enter a valid IFSC');
    await setSetting('company_bank_enc', encrypt(JSON.stringify(bank)), req.user!.id);
    await audit(req, 'Setting change', 'CompanyBank', 'company', 'Company bank details changed');
  }
  await audit(req, 'Setting change', 'CompanyProfile', 'company', 'Company profile', old, await companyValues());
  res.json({ ok: true });
}));

// ---------- consolidated settings ----------
router.get('/console/settings', handle(async (req, res) => {
  await need(req, 'settings');
  const names = await userNames();
  const sup = await isSuper(req), edit = await can(req, 'settings', 'edit');
  res.json({ groups: GROUPS, fixed: FIXED, rows: await Promise.all(LIST.map(async (s) => {
    const l = await lastChange(s.key);
    return { ...s, pattern: undefined, value: await regVal(s.key), changed_by: nameIn(names, l?.updated_by), changed_at: (l as Any)?.updatedAt ?? null, editable: !s.fixed && (s.group === 'security' ? sup : edit) };
  })) });
}));
router.put('/console/settings', handle(async (req, res) => {
  await need(req, 'settings', 'edit');
  const b = (req.body ?? {}) as Any;
  const reset: string[] = Array.isArray(b.__reset) ? b.__reset : [];
  const errors: Record<string, string> = {};
  const changes: [string, unknown][] = [];
  const sup = await isSuper(req);
  for (const [k, v] of Object.entries(b)) {
    const s = BY[k];
    if (!s || reset.includes(k)) continue;
    const err = regCheck(s, v);
    if (err) { errors[k] = err; continue; }
    if (String(await regVal(k)) !== String(v)) { if (s.group === 'security' && !sup) throw bad('Only a Super Admin can change security settings'); changes.push([k, v]); }
  }
  for (const k of reset) { const s = BY[k]; if (s && !s.fixed && String(await regVal(k)) !== s.def) { if (s.group === 'security' && !sup) throw bad('Only a Super Admin can change security settings'); changes.push([k, s.def]); } }
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  for (const [k, v] of changes) { const old = await regVal(k); await regSet(k, v, req.user!.id); await audit(req, 'Setting change', 'Setting', k, k, { [k]: old }, { [k]: v }); }
  res.json({ ok: true, changed: changes.length });
}));

// ---------- system health (backups are MongoDB Atlas snapshots; restores go through the hosting team) ----------
router.get('/console/health', handle(async (req, res) => {
  if (!(await can(req, 'security')) && !(await can(req, 'settings'))) throw bad('Not allowed');
  const since = new Date(Date.now() - 3600e3);
  const db = mongoose.connection.db!;
  const stats = await db.stats().catch(() => null);
  const names = await userNames();
  res.json({
    queues: { email: await EmailLog.countDocuments({ status: { $in: ['Queued', 'Retrying'] } }), unassigned: await UnassignedQueue.countDocuments({ status: 'Open' }), approvals: (await approvalItems(req)).length },
    email_last_hour: { total: await EmailLog.countDocuments({ queued_at: { $gt: since } }), failed: await EmailLog.countDocuments({ queued_at: { $gt: since }, status: { $in: ['Failed', 'Bounced'] } }) },
    db_bytes: stats?.dataSize ?? 0, storage_bytes: stats?.storageSize ?? 0, uptime_sec: Math.round(process.uptime()), node: process.version,
    restore_tests: (await RestoreTest.find().sort({ tested_on: -1 }).limit(10).lean()).map((x) => ({ ...x, id: String(x._id), by: nameIn(names, x.by_user) })),
    errors_last_day: await AuditLog.countDocuments({ action: /fail/i, createdAt: { $gt: new Date(Date.now() - 864e5) } }),
    note: 'Backups are the daily MongoDB Atlas snapshots. Restores are done by the hosting team on a written request from a Super Admin. There is no restore button in the app.',
  });
}));
router.post('/console/restore-tests', handle(async (req, res) => {
  await needSuper(req);
  if (!req.body?.tested_on) throw fieldErr('tested_on', 'Date is required');
  if (!['Passed', 'Failed'].includes(req.body?.result)) throw fieldErr('result', 'Choose the result');
  await RestoreTest.create({ tested_on: req.body.tested_on, result: req.body.result, note: clean(req.body.note, 500), by_user: req.user!.id });
  await audit(req, 'Create', 'RestoreTest', null, req.body.result);
  res.json({ ok: true });
}));

// ---------- global audit log (staff and portal users) ----------
function auditFilter(q: Record<string, string>) {
  const f: Any = {};
  if (q.actor_type) f.actor_type = q.actor_type === 'staff' ? { $in: ['staff', null] } : q.actor_type;
  if (q.action) f.action = q.action;
  if (q.user && mongoose.isValidObjectId(q.user)) f.user_id = q.user;
  if (q.entity) f.entity_type = new RegExp('^' + escRx(q.entity));
  if (q.from || q.to) f.createdAt = { ...(q.from ? { $gte: istDayStart(q.from) } : {}), ...(q.to ? { $lt: istDayStart(addDays(q.to, 1)) } : {}) };
  if (q.q) { const rx = new RegExp(escRx(q.q), 'i'); f.$or = [{ entity_label: rx }, { entity_id: rx }, { ip: rx }]; }
  return f;
}
async function actorName(a: Any, names: Map<string, string>) {
  if (a.actor_type === 'student') return `${(await PortalAccount.findById(a.user_id).select('email').lean())?.email ?? 'Student'} (student)`;
  return nameIn(names, a.user_id) || (a.user_id ? String(a.user_id) : 'System');
}
router.get('/console/audit', handle(async (req, res) => {
  await need(req, 'audit');
  const f = auditFilter(req.query as Record<string, string>);
  const size = 50, page = Math.max(1, Number(req.query.page) || 1);
  const names = await userNames();
  const rows = await AuditLog.find(f).sort({ _id: -1 }).skip((page - 1) * size).limit(size).lean();
  res.json({ total: await AuditLog.countDocuments(f), page, size, rows: await Promise.all(rows.map(async (a) => ({ ...a, id: String(a._id), created_at: a.createdAt, actor: await actorName(a, names) }))),
    actions: (await AuditLog.distinct('action')).sort(), actor_types: ['staff', 'student', 'university'], can_export: await isSuper(req) });
}));
router.get('/console/audit/export', handle(async (req, res) => {
  await needSuper(req);
  const names = await userNames();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Audit log');
  ws.addRow(['Time (UTC)', 'Actor', 'Actor type', 'Action', 'Entity', 'Record', 'Label', 'Old', 'New', 'IP', 'Device']).font = { bold: true };
  for (const a of await AuditLog.find(auditFilter(req.query as Record<string, string>)).sort({ _id: -1 }).limit(50000).lean())
    ws.addRow([a.createdAt?.toISOString(), await actorName(a, names), a.actor_type || 'staff', a.action, a.entity_type, a.entity_id, a.entity_label, JSON.stringify(a.old_value ?? null), JSON.stringify(a.new_value ?? null), a.ip, a.user_agent]);
  await audit(req, 'Export', 'AuditLog', null, 'Audit log export');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', 'attachment; filename="audit_log.xlsx"');
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

export default router;
