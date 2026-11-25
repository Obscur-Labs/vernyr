import { Router } from 'express';
import ExcelJS from 'exceljs';
import { authenticate, type AuthRequest } from '../middleware/auth';
import User from '../models/User';
import Student from '../models/Student';
import University from '../models/University';
import { MasterItem } from '../models/Master';
import { Payment, FeeSummary, Application } from '../models/Work';
import { PaymentSubmission } from '../models/Portal';
import { Counter } from '../models/Timeline';
import { DiscountRequest } from '../models/Console';
import { audit } from '../models/Audit';
import { bad, fieldErr, notFound, forbidden, handle, oid, clean, num, istDate, timeline, userNames, nameIn, fullName } from '../services/crm';
import { notify, createTask } from '../services/tasks';
import { isSuper, can, need, regVal } from '../services/console';
import { workNames } from './work';
import { docPdf, fmt } from '../services/docPdf';
import { fmtDate } from '../services/invoicePdf';

/** Admin console money (legacy/server/admin5/money.js): service packages, payments overview, refunds, service fee receipts, reconciliation. */
const router = Router();
router.use(authenticate);
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const r2 = (n: unknown) => Math.round(Number(n || 0) * 100) / 100;

// ---------- service packages (a master with instalments) ----------
router.get('/console/packages', handle(async (req, res) => {
  await need(req, 'fees');
  const rows = await MasterItem.find({ type: 'service_package' }).sort({ sort: 1, name: 1 }).lean();
  res.json({ rows: rows.map((m) => ({ id: String(m._id), name: m.name, active: m.active, ...((m.data as Any) ?? {}) })), gst_default: await regVal('service_gst_percent') });
}));
router.post('/console/packages', handle(async (req, res) => {
  await need(req, 'fees', 'edit');
  const b = req.body ?? {};
  if (!clean(b.name)) throw fieldErr('name', 'Package name is required');
  if (!(Number(b.default_fee) >= 0)) throw fieldErr('default_fee', 'Default fee is required');
  const inst = ((b.instalments ?? []) as Any[]).filter((x) => x && clean(x.name)).map((x) => ({ name: clean(x.name, 60), percent: num(x.percent), amount: num(x.amount), due_rule: clean(x.due_rule, 60) }));
  if (inst.reduce((s, x) => s + (x.percent || 0), 0) > 100.001) throw fieldErr('instalments', 'Instalment percentages add up to more than 100%');
  const data = { default_fee: Number(b.default_fee), instalments: inst, refund_policy: clean(b.refund_policy, 5000), gst_percent: num(b.gst_percent) };
  if (b.id) {
    const m = await MasterItem.findOne({ _id: oid(b.id), type: 'service_package' });
    if (!m) throw notFound();
    const old = m.data;
    m.set({ name: clean(b.name, 100), active: b.active !== false, data }); await m.save();
    await audit(req, 'Update', 'ServicePackage', m._id, b.name, old, data);
    res.json({ id: String(m._id) }); return;
  }
  const m = await MasterItem.create({ type: 'service_package', name: clean(b.name, 100), active: true, data });
  await audit(req, 'Create', 'ServicePackage', m._id, b.name);
  res.json({ id: String(m._id) });
}));

// ---------- payments overview, late proofs, discounts ----------
router.get('/console/payments', handle(async (req, res) => {
  await need(req, 'fees');
  const q = req.query as Record<string, string>;
  const f: Any = { is_deleted: false };
  if (q.from || q.to) f.payment_date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  if (q.payment_for) f.payment_for = q.payment_for;
  const pays = await Payment.find(f).sort({ payment_date: -1, createdAt: -1 }).limit(500).lean();
  const studs = await Student.find({ _id: { $in: pays.map((p) => p.student_id) } }).select('student_code first_name last_name primary_counsellor_id').lean();
  const names = await userNames();
  const rows = pays.map((x) => { const s = studs.find((y) => String(y._id) === String(x.student_id)); return {
    id: String(x._id), student: `${s?.student_code ?? ''} ${s?.first_name ?? ''} ${s?.last_name ?? ''}`.trim(), student_id: String(x.student_id), payment_for: x.payment_for, amount: x.amount, currency: x.currency,
    date: x.payment_date, mode: x.mode, reference: x.reference_no, counsellor: nameIn(names, s?.primary_counsellor_id), is_refund: !!x.is_refund, refund_status: x.refund_status ?? null,
    refund_reason: x.refund_reason ?? null, receipt_no: x.receipt_no ?? null, by: nameIn(names, x.created_by) }; });
  const totals: Record<string, number> = {};
  for (const x of rows) { if (x.is_refund && x.refund_status !== 'Approved') continue; const k = `${x.payment_for}|${x.currency}`; totals[k] = r2((totals[k] || 0) + x.amount); }
  const late = (await PaymentSubmission.find({ status: 'Submitted', createdAt: { $lt: new Date(Date.now() - 2 * 864e5) } }).sort({ createdAt: 1 }).lean());
  const ls = await Student.find({ _id: { $in: late.map((x) => x.student_id) } }).select('student_code first_name').lean();
  const discounts = await DiscountRequest.find().sort({ createdAt: -1 }).limit(200).lean();
  const ds = await Student.find({ _id: { $in: discounts.map((d) => d.student_id) } }).select('student_code first_name').lean();
  res.json({
    rows, totals: Object.entries(totals).map(([k, v]) => { const [payment_for, currency] = k.split('|'); return { payment_for, currency, amount: v }; }),
    proofs: late.map((x) => { const s = ls.find((y) => String(y._id) === String(x.student_id)); return { id: String(x._id), student: `${s?.student_code} ${s?.first_name}`, student_id: String(x.student_id), amount: x.amount, currency: x.currency, created_at: x.createdAt }; }),
    discounts: discounts.map((d) => { const s = ds.find((y) => String(y._id) === String(d.student_id)); return { ...d, id: String(d._id), student: `${s?.student_code} ${s?.first_name}`, by: nameIn(names, d.requested_by), decided: nameIn(names, d.decided_by), month: d.createdAt.toISOString().slice(0, 7) }; }),
    can_refund: await can(req, 'fees', 'edit'), can_approve: await can(req, 'fees', 'approve'),
  });
}));

// ---------- refunds: a negative payment, approved by Finance or a Super Admin ----------
router.post('/console/refunds', handle(async (req, res) => {
  await need(req, 'fees', 'edit');
  const b = req.body ?? {};
  const s = await Student.findOne({ is_deleted: false, ...(oid(b.student_id) ? { _id: oid(b.student_id) } : { student_code: String(b.student_code ?? '').trim().toUpperCase() }) });
  if (!s) throw fieldErr('student_code', 'Student not found');
  const amt = num(b.amount);
  if (!(amt! > 0)) throw fieldErr('amount', 'Amount must be more than 0');
  const reason = clean(b.reason, 300);
  if (!reason) throw fieldErr('reason', 'Reason is required');
  const payFor = b.payment_for || 'La Europa service fee', cur = b.currency || 'INR';
  const [paid] = await Payment.aggregate([{ $match: { student_id: s._id, payment_for: payFor, currency: cur, is_deleted: false, $or: [{ is_refund: { $ne: true } }, { refund_status: 'Approved' }] } }, { $group: { _id: null, s: { $sum: '$amount' } } }]);
  if (amt! > (paid?.s ?? 0) + 0.001) throw fieldErr('amount', `The refund is more than the amount paid (${paid?.s ?? 0})`);
  const p = await Payment.create({ student_id: s._id, payment_for: payFor, amount: -amt!, currency: cur, payment_date: b.payment_date || istDate(), mode: b.mode || 'Bank transfer',
    reference_no: clean(b.reference_no, 100), remarks: 'Refund', is_refund: true, refund_reason: reason, refund_status: 'Pending', created_by: req.user!.id });
  for (const a of await User.find({ isActive: true, $or: [{ is_super_admin: true }, { finance: true }] }).select('_id').lean())
    await notify(a._id, 'approval', `Refund waiting for approval: ${fmt(amt, cur)} for ${fullName(s)}`, '/console/approvals');
  await audit(req, 'Create', 'Refund', p._id, s.student_code, null, { amount: amt, reason });
  res.json({ id: String(p._id) });
}));
router.post('/console/refunds/:id/:action(approve|reject)', handle(async (req, res) => {
  const p = await Payment.findOne({ _id: oid(req.params.id), is_refund: true, refund_status: 'Pending' });
  if (!p) throw bad('This refund was already decided');
  const me = await User.findById(req.user!.id).select('finance').lean();
  if (!(await isSuper(req)) && !((await can(req, 'fees', 'approve')) && me?.finance)) throw forbidden();
  const approve = req.params.action === 'approve';
  const reason = clean(req.body?.reason, 200);
  if (!approve && !reason) throw fieldErr('reason', 'Reason is required');
  p.set(approve ? { refund_status: 'Approved', approved_by: req.user!.id, approved_at: new Date() } : { refund_status: 'Rejected', approved_by: req.user!.id, approved_at: new Date(), remarks: `Refund rejected: ${reason}`, is_deleted: true });
  await p.save();
  await timeline({ student_id: p.student_id, type: 'payment', description: `Refund of ${fmt(Math.abs(p.amount), p.currency)} ${approve ? 'approved' : 'rejected'} by ${req.user!.name}`, user_id: req.user!.id });
  if (p.created_by) await notify(p.created_by, 'approval', `Refund ${approve ? 'approved' : 'rejected'}: ${fmt(Math.abs(p.amount), p.currency)}`, `/students/${p.student_id}/fees`);
  await audit(req, approve ? 'Approve' : 'Reject', 'Refund', p._id, String(p.amount));
  res.json({ ok: true });
}));

// ---------- service fee receipt PDF (one number series per financial year) ----------
const fyOf = (d: string) => { const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)); const s = m >= 4 ? y : y - 1; return `${s}-${String(s + 1).slice(2)}`; };
router.get('/console/payments/:id/receipt', handle(async (req, res) => {
  await need(req, 'fees');
  const p = await Payment.findOne({ _id: oid(req.params.id), is_deleted: false });
  if (!p) throw notFound();
  if (p.payment_for !== 'La Europa service fee' || p.is_refund) throw bad('Receipts are for service fee payments');
  if (!p.receipt_no) {
    const fy = fyOf(p.payment_date);
    const c = await Counter.findByIdAndUpdate(`RCPT-${fy}`, { $inc: { value: 1 } }, { upsert: true, new: true });
    p.receipt_no = `${await regVal('receipt_prefix')}/${fy}/${String(c!.value).padStart(4, '0')}`;
    await p.save();
  }
  const s = (await Student.findById(p.student_id))!;
  const fsum = await FeeSummary.findOne({ student_id: s._id, fee_kind: 'service', is_deleted: false }).lean() as Any;
  const pkg = fsum?.package_id ? await MasterItem.findById(fsum.package_id).lean() : null;
  const pdata = ((pkg?.data as Any) ?? {});
  const [paid] = await Payment.aggregate([{ $match: { student_id: s._id, payment_for: 'La Europa service fee', currency: 'INR', is_deleted: false, $or: [{ is_refund: { $ne: true } }, { refund_status: 'Approved' }] } }, { $group: { _id: null, s: { $sum: '$amount' } } }]);
  const paidTotal = paid?.s ?? 0;
  const net = fsum ? (fsum.total_amount || 0) - (fsum.discount_approved ? fsum.discount || 0 : 0) : null;
  const gstP = Number(pdata.gst_percent ?? (await regVal('service_gst_percent'))) || 0;
  const gstin = await regVal('company_gstin');
  const buf = await docPdf({
    title: `Service fee receipt ${p.receipt_no}`, badge: 'RECEIPT',
    from: ['Euroverse Service LLP, trading as La Europa Education', String((await regVal('company_address')) || '[Registered address: to be given by La Europa]'), [gstin ? `GSTIN ${gstin}` : 'GSTIN: [to be given]', `LLPIN ${await regVal('company_llpin')}`].join(' | ')],
    to: [fullName(s), `Student ID ${s.student_code}`, s.city || ''],
    kv: [['Receipt number', p.receipt_no], ['Receipt date', fmtDate(p.payment_date)], ['Package', pkg?.name ?? '-'], ['Instalment', p.instalment_no ? `#${p.instalment_no}` : '-'], ['Mode / reference', `${p.mode}${p.reference_no ? ' / ' + p.reference_no : ''}`]],
    columns: [['Description', 330], ['Amount', 185]],
    rows: [['La Europa service fee', fmt(p.amount, p.currency)], ...(gstP ? [[`Includes GST ${gstP}% (as per Admin setting; accountant to confirm)`, fmt(p.amount - p.amount / (1 + gstP / 100), p.currency)]] : [])],
    totals: [['Paid now', fmt(p.amount, p.currency)], ['Total paid to date', fmt(paidTotal, 'INR')], ...(net !== null ? [['Pending', fmt(Math.max(0, net - paidTotal), 'INR')] as [string, string]] : [])],
    note: `${pdata.refund_policy ? 'Refund policy: ' + pdata.refund_policy : 'Refund policy: as per the La Europa refund policy (current version in the student portal).'}\nThis receipt was generated by the La Europa CRM.`,
  });
  await audit(req, 'Download', 'Receipt', p._id, p.receipt_no);
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${p.receipt_no.replace(/\//g, '-')}.pdf"`); res.send(buf);
}));

// ---------- reconciliation: university commission per enrolment. Commissions come with the partner portal; until then the enrolled applications are listed. ----------
async function recon(q: Record<string, string>) {
  const apps = await Application.find({ is_deleted: false, stage: 'enrolment_confirmed', ...(oid(q.university) ? { university_id: oid(q.university) } : {}) }).lean() as Any[];
  const N = await workNames();
  const studs = await Student.find({ _id: { $in: apps.map((a) => a.student_id) } }).select('student_code first_name middle_name last_name').lean();
  let rows = apps.map((a) => {
    const s = studs.find((x) => String(x._id) === String(a.student_id));
    return { application_id: String(a._id), application_code: a.application_code, student: s ? `${s.student_code} ${fullName(s)}` : '', university: N.name(a.university_id), course: a.course_name_text || N.name(a.course_id),
      intake: N.name(a.intake_id), enrolled: a.stage_changed_at ?? a.updatedAt ?? null, agency: null, uni: { expected: 0, invoiced: 0, received: 0, cancelled: false, currency: 'EUR' },
      share: { expected: 0, eligible: 0, invoiced: 0, paid: 0, reversed: 0, currency: 'INR' }, net: 0, net_note: null, status: 'Open', exception: null as string | null };
  });
  if (q.fy) {
    const start = `${q.fy.slice(0, 4)}-04-01`, end = `${Number(q.fy.slice(0, 4)) + 1}-03-31`;
    rows = rows.filter((x) => !x.enrolled || (new Date(x.enrolled).toISOString().slice(0, 10) >= start && new Date(x.enrolled).toISOString().slice(0, 10) <= end));
  }
  if (q.status) rows = rows.filter((x) => x.status === q.status);
  return rows;
}
router.get('/console/reconciliation', handle(async (req, res) => {
  await need(req, 'reconciliation');
  const rows = await recon(req.query as Record<string, string>);
  res.json({ rows, cards: { received: [], share_paid: [], share_payable: [], exceptions: rows.filter((x) => x.exception).length },
    universities: (await University.find({ is_deleted: false }).sort({ name: 1 }).select('name').lean()).map((u) => ({ id: String(u._id), name: u.name })), agencies: [],
    statuses: ['Matched', 'Open', 'Received, share pending', 'Share paid before receipt', 'Reversal needed', 'Mismatch'], show_net: await isSuper(req) });
}));
router.get('/console/reconciliation/export', handle(async (req, res) => {
  await need(req, 'reconciliation', 'export');
  const rows = await recon(req.query as Record<string, string>);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Reconciliation');
  ws.addRow(['Application', 'Student', 'University', 'Course', 'Intake', 'Enrolled', 'Uni expected', 'Uni invoiced', 'Uni received', 'Uni currency', 'Net to La Europa', 'Status', 'Exception']).font = { bold: true };
  for (const x of rows) ws.addRow([x.application_code, x.student, x.university, x.course, x.intake, x.enrolled ? new Date(x.enrolled).toISOString().slice(0, 10) : '', x.uni.expected, x.uni.invoiced, x.uni.received, x.uni.currency, x.net, x.status, x.exception || '']);
  ws.columns.forEach((c) => { c.width = 16; });
  await audit(req, 'Export', 'Reconciliation', null, `${rows.length} row(s)`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', 'attachment; filename="reconciliation.xlsx"');
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));
router.post('/console/reconciliation/task', handle(async (req: AuthRequest, res) => {
  await need(req, 'reconciliation', 'edit');
  const a = await Application.findById(oid(req.body?.application_id)).lean();
  if (!a) throw notFound();
  const t = await createTask({ title: `Reconciliation: ${clean(req.body?.title, 150) || 'check commission'} (${a.application_code})`, type: 'Other', student_id: a.student_id, application_id: a._id,
    assigned_to: oid(req.body?.assigned_to) ?? oid(req.user!.id)!, due_at: new Date(Date.now() + 2 * 864e5), priority: 'High', status: 'Open' }, req.user!.id);
  res.json({ id: String((t as unknown as Any)?._id ?? t) });
}));

export default router;
