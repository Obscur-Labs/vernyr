import { Router } from 'express';
import ExcelJS from 'exceljs';
import { authenticate, type AuthRequest } from '../middleware/auth';
import User from '../models/User';
import Student from '../models/Student';
import Lead, { LeadActivity } from '../models/Lead';
import University from '../models/University';
import Course from '../models/Course';
import Task from '../models/Task';
import { Country, Intake, MasterItem } from '../models/Master';
import { Application, ChecklistItem, FeeSummary, Payment, StageHistory, VisaCase } from '../models/Work';
import { ConsentRecord, AccountDeletionRequest } from '../models/Portal';
import { EmailLog } from '../models/Email';
import { AuditLog, audit } from '../models/Audit';
import { ScheduledReport } from '../models/Console';
import { bad, fieldErr, forbidden, notFound, handle, oid, clean, istDate, istDayStart, addDays, userNames, nameIn } from '../services/crm';
import { stageList } from '../services/masters';
import { quickEmail, esc } from '../services/email';
import { logoOf } from '../services/catalogue';
import { isSuper, can, need, regVal } from '../services/console';
import { docPdf } from '../services/docPdf';

/** Admin console insights (legacy/server/admin5/insights.js): checklist templates, storage, universities overview, catalogue quality, standard and scheduled reports. */
const router = Router();
router.use(authenticate);
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const names = async () => {
  const [c, m] = await Promise.all([Country.find().select('name').lean(), MasterItem.find().select('name').lean()]);
  const all = new Map<string, string>([...c, ...m].map((x) => [String(x._id), x.name]));
  return (id: unknown) => (id ? all.get(String(id)) ?? '' : '');
};

// ---------- checklist templates (country x level x stage); new items reach existing students only on "Apply to existing" ----------
const keyOf = (b: Any) => ({ country_id: oid(b.country_id) ?? null, level: b.level || null, stage: b.stage || 'Application' });
const templateFilter = (k: ReturnType<typeof keyOf>) => ({ is_deleted: false, country_id: k.country_id, level: k.level, ...(k.stage === 'Application' ? { $or: [{ stage: 'Application' }, { stage: null }] } : { stage: k.stage }) });
router.get('/console/checklists', handle(async (req, res) => {
  await need(req, 'checklists');
  const N = await names();
  const items = await ChecklistItem.find({ is_deleted: false }).sort({ country_id: 1, level: 1, stage: 1, sort: 1 }).lean();
  const groups = new Map<string, Any>();
  for (const i of items) {
    const k = `${i.country_id ?? ''}|${i.level ?? ''}|${i.stage || 'Application'}`;
    if (!groups.has(k)) groups.set(k, { country_id: i.country_id ?? null, level: i.level ?? null, stage: i.stage || 'Application', name: i.template_name, items: [] });
    groups.get(k)!.items.push(i);
  }
  res.json({
    templates: [...groups.values()].map((g) => ({ ...g, name: g.name || `${g.country_id ? N(g.country_id) : 'All countries'}, ${g.level || 'All levels'}, ${g.stage}`, country: g.country_id ? N(g.country_id) : 'All countries',
      new_only: g.items.some((x: Any) => !x.applies_existing), items: g.items.map((x: Any) => ({ id: String(x._id), document_type_id: String(x.document_type_id), document_type: N(x.document_type_id), required: x.required, sort: x.sort,
        note: x.note, condition: x.condition_text, visible_student: x.visible_student !== false, expiry_check: !!x.expiry_check, active: x.active, applies_existing: x.applies_existing !== false })) })),
    countries: (await Country.find().sort({ sort: 1, name: 1 }).select('name').lean()).map((x) => ({ id: String(x._id), name: x.name })),
    doc_types: (await MasterItem.find({ type: 'document_type', active: true }).sort({ sort: 1, name: 1 }).select('name').lean()).map((x) => ({ id: String(x._id), name: x.name })),
    levels: ['Bachelor', 'Master', 'Other'], stages: ['Application', 'Visa', 'Pre-departure'], rules: ['Yes', 'Optional', 'If Bachelor', 'If Master', 'If work exp', 'If taken'],
  });
}));
router.post('/console/checklists', handle(async (req, res) => {
  await need(req, 'checklists', 'edit');
  const b = req.body ?? {};
  if (!['Application', 'Visa', 'Pre-departure'].includes(b.stage)) throw fieldErr('stage', 'Choose the stage');
  const items = ((b.items ?? []) as Any[]).filter((x) => oid(x.document_type_id));
  if (!items.length) throw bad('Add at least one document');
  const k = keyOf(b);
  const existing = await ChecklistItem.find(templateFilter(k));
  const keep = new Set<string>();
  for (const [i, x] of items.entries()) {
    const f = { ...k, document_type_id: oid(x.document_type_id), required: x.required || 'Yes', sort: i, note: clean(x.note, 300), condition_text: clean(x.condition, 200),
      visible_student: x.visible_student !== false, expiry_check: !!x.expiry_check, active: x.active !== false, template_name: clean(b.name, 80) };
    const ex = x.id && existing.find((e) => String(e._id) === String(x.id));
    if (ex) { ex.set(f); await ex.save(); keep.add(String(ex._id)); }
    else keep.add(String((await ChecklistItem.create({ ...f, applies_existing: false, created_by: req.user!.id }))._id));
  }
  // never hard-deleted
  for (const e of existing) if (!keep.has(String(e._id))) { e.active = false; await e.save(); }
  await audit(req, 'Update', 'ChecklistTemplate', `${k.country_id}|${k.level}|${k.stage}`, b.name || `${k.stage}`, null, { items: items.length });
  res.json({ ok: true });
}));
router.post('/console/checklists/apply-existing', handle(async (req, res) => {
  await need(req, 'checklists', 'edit');
  const b = req.body ?? {};
  const k = keyOf(b);
  const newItems = await ChecklistItem.find({ ...templateFilter(k), applies_existing: false });
  const studs = await Student.find({ is_deleted: false, status: { $nin: ['Archived', 'Dropped'] }, ...(k.country_id ? { _id: { $in: await Application.distinct('student_id', { country_id: k.country_id, is_deleted: false }) } } : {}) })
    .select('student_code first_name last_name createdAt').lean();
  const affected = studs.filter((s) => newItems.some((i) => (i as Any).createdAt > s.createdAt));
  const N = await names();
  if (!b.confirm) { res.json({ preview: true, students: affected.length, sample: affected.slice(0, 10).map((s) => `${s.student_code} ${s.first_name} ${s.last_name ?? ''}`.trim()), items: newItems.map((i) => N(i.document_type_id)) }); return; }
  await ChecklistItem.updateMany({ _id: { $in: newItems.map((i) => i._id) } }, { applies_existing: true });
  await audit(req, 'Update', 'ChecklistTemplate', 'apply-existing', `Applied ${newItems.length} item(s) to ${affected.length} existing student(s)`);
  res.json({ ok: true, students: affected.length });
}));
router.post('/console/checklists/copy', handle(async (req, res) => {
  await need(req, 'checklists', 'edit');
  const b = req.body ?? {};
  const from = keyOf({ country_id: b.from_country, level: b.from_level, stage: b.from_stage });
  const src = await ChecklistItem.find({ ...templateFilter(from), active: true }).lean();
  if (!src.length) throw bad('The source template is empty');
  if (!oid(b.to_country)) throw fieldErr('to_country', 'Choose the new country');
  const to = { ...from, country_id: oid(b.to_country) };
  if (await ChecklistItem.exists(templateFilter(to))) throw bad('A template already exists for that country, level and stage');
  await ChecklistItem.insertMany(src.map(({ _id, ...x }) => ({ ...x, country_id: to.country_id, applies_existing: false, template_name: undefined, created_by: req.user!.id })));
  await audit(req, 'Create', 'ChecklistTemplate', String(to.country_id), `Copied ${src.length} item(s)`);
  res.json({ ok: true });
}));

// ---------- storage: files are on Cloudinary; the Google Drive mirror is not connected in this build ----------
router.get('/console/storage', handle(async (req, res) => {
  await need(req, 'checklists');
  res.json({ settings: { drive_sync_enabled: false, folder_trigger: await regVal('folder_trigger'), drive_root_folder: '', connected: false, max_file_mb: await regVal('max_file_mb') },
    rule: 'Files are stored on Cloudinary under students/<student>/documents, named {student_id}_{document_type}_v{version}.{ext}', counts: { synced: 0, pending: 0, failed: 0, local: 0 }, rows: [], super: await isSuper(req) });
}));

// ---------- universities overview and catalogue quality ----------
router.get('/console/universities', handle(async (req, res) => {
  await need(req, 'universities');
  const N = await names();
  const unis = await University.find({ is_deleted: false }).sort({ name: 1 }).lean();
  res.json({ finance: false, rows: await Promise.all(unis.map(async (u) => ({ id: String(u._id), name: u.name, country: N(u.country_id), city: u.city ?? null, logo: logoOf(u), has_logo: !!u.logo_url,
    master_status: u.active === false ? 'Inactive' : 'Active', portal_status: 'Draft', agreement: 'None', partner_manager: null, logo_source_note: u.logo_source_note ?? null,
    active_apps: await Application.countDocuments({ university_id: u._id, is_deleted: false, stage: { $nin: ['rejected', 'withdrawn', 'offer_declined', 'enrolment_confirmed'] } }),
    enrolled: await Application.countDocuments({ university_id: u._id, is_deleted: false, stage: 'enrolment_confirmed' }) }))) });
}));
router.put('/console/universities/:id/logo-note', handle(async (req, res) => {
  await need(req, 'universities', 'edit');
  await University.updateOne({ _id: oid(req.params.id) }, { logo_source_note: clean(req.body?.note, 200), logo_approved_by: req.user!.id, logo_approved_at: new Date() });
  await audit(req, 'Update', 'University', req.params.id, 'Logo source note');
  res.json({ ok: true });
}));
const FEE_WORDS = /(non[\s.-]*eu|eu[\s.-]*\/[\s.-]*eea|\beea\b|international|foreign|overseas)/i;
function linkWarn(link: string | undefined, website: string | undefined) {
  if (!link) return null;
  let host: string;
  try { const u = new URL(link); if (u.protocol !== 'https:') return 'Not https'; host = u.hostname.replace(/^www\./, ''); } catch { return 'Not a valid link'; }
  if (!website) return null;
  let uh: string;
  try { uh = new URL(website).hostname.replace(/^www\./, ''); } catch { return null; }
  const base = uh.split('.').slice(-2).join('.');
  return host === uh || host.endsWith('.' + base) || host === base ? null : `Link domain ${host} is not the university website (${uh})`;
}
/** Flag course links that do not point at the university's own website. */
export async function qualityScan() {
  const sites = new Map((await University.find().select('website').lean()).map((u) => [String(u._id), u.website]));
  let n = 0;
  for (const c of await Course.find({ is_deleted: false }).select('course_link university_id link_domain_warning')) {
    const w = linkWarn(c.course_link, sites.get(String(c.university_id)));
    if (!!w !== !!c.link_domain_warning) { c.set({ link_domain_warning: !!w, link_warning_reason: w }); await c.save(); n++; }
  }
  return n;
}
router.get('/console/catalogue-quality', handle(async (req, res) => {
  await need(req, 'catalogue');
  await qualityScan();
  const months = Number(await regVal('course_verify_months')) || 6;
  const old = addDays(istDate(), -months * 30);
  const pub = { status: 'Published', is_deleted: false };
  const unis = new Map((await University.find().select('name logo_url').lean()).map((u) => [String(u._id), u]));
  const uName = (id: unknown) => unis.get(String(id))?.name ?? '';
  const published = await Course.find(pub).lean();
  const all = await Course.find({ is_deleted: false }).select('name level university_id fee_note').lean();
  const dupes = new Map<string, number>();
  for (const c of all) { const k = `${c.university_id}|${c.name.toLowerCase()}|${c.level}`; dupes.set(k, (dupes.get(k) ?? 0) + 1); }
  const missing = [...new Set(published.map((c) => String(c.university_id)))].filter((id) => !unis.get(id)?.logo_url);
  res.json({
    missing_logo: missing.map((id) => ({ id, name: uName(id), courses: published.filter((c) => String(c.university_id) === id).length })),
    old_verified: published.filter((c) => !c.last_verified_on || c.last_verified_on < old).slice(0, 200).map((c) => ({ id: String(c._id), name: c.name, university: uName(c.university_id), last_verified_on: c.last_verified_on ?? null })),
    link_warnings: (await Course.find({ link_domain_warning: true, is_deleted: false }).limit(200).lean()).map((c) => ({ id: String(c._id), name: c.name, university: uName(c.university_id), course_link: c.course_link, link_warning_reason: c.link_warning_reason })),
    fee_words: all.filter((c) => FEE_WORDS.test(c.fee_note ?? '')).map((c) => ({ id: String(c._id), name: c.name, university: uName(c.university_id) })),
    duplicates: [...dupes.entries()].filter(([, n]) => n > 1).map(([k, n]) => { const [u, name, level] = k.split('|'); return { university: uName(u), name, level, n }; }),
    passed_open: published.flatMap((c) => (c.intakes ?? []).filter((i) => i.deadline && i.deadline < istDate()).map((i) => ({ id: String(i._id), course: c.name, university: uName(c.university_id), deadline: i.deadline }))).slice(0, 200),
    months,
  });
}));
router.post('/console/catalogue/bulk', handle(async (req, res) => {
  await need(req, 'catalogue', 'edit');
  const ids = ((req.body?.ids ?? []) as unknown[]).map(oid).filter(Boolean).slice(0, 1000);
  const act = req.body?.action;
  if (!ids.length) throw bad('Choose courses');
  if (act === 'verified') await Course.updateMany({ _id: { $in: ids } }, { last_verified_on: req.body?.date || istDate() });
  else if (['Published', 'Hidden', 'Archived', 'Draft'].includes(act)) {
    if (act === 'Published') { const badFee = (await Course.find({ _id: { $in: ids } }).select('name fee_note').lean()).filter((c) => FEE_WORDS.test(c.fee_note ?? '')); if (badFee.length) throw bad(`Fix the fee text first (forbidden words): ${badFee.map((x) => x.name).join(', ')}`); }
    await Course.updateMany({ _id: { $in: ids } }, { status: act });
  } else throw bad('Unknown action');
  await audit(req, 'Update', 'Course', null, `Bulk ${act}: ${ids.length} course(s)`);
  res.json({ ok: true, count: ids.length });
}));

// ---------- standard reports ----------
export const REPORTS: [string, string, string][] = [['pipeline', 'Pipeline', 'reports'], ['funnel', 'Conversion funnel', 'reports'], ['counsellors', 'Counsellor performance', 'reports'],
  ['universities', 'University performance', 'reports'], ['revenue', 'Revenue (finance)', 'finance'], ['catalogue', 'Course catalogue quality', 'reports'], ['email', 'Email health', 'reports'],
  ['privacy', 'Privacy and consent', 'super']];
async function allowed(req: AuthRequest, k: string) {
  const x = REPORTS.find((r) => r[0] === k);
  if (!x) return false;
  if (x[2] === 'super') return isSuper(req);
  if (x[2] === 'finance') return (await can(req, 'reconciliation')) || (await can(req, 'fees', 'approve'));
  return can(req, 'reports');
}
function period(q: Record<string, string | undefined>) {
  const t = istDate();
  const from = q.from || (q.period === 'fy' ? `${Number(t.slice(5, 7)) >= 4 ? t.slice(0, 4) : Number(t.slice(0, 4)) - 1}-04-01` : q.period === 'month' ? t.slice(0, 8) + '01' : addDays(t, -365));
  const to = q.to || t;
  return { from, to, fromD: istDayStart(from), toD: istDayStart(addDays(to, 1)) };
}
export async function report(req: AuthRequest, k: string, q: Record<string, string | undefined>) {
  const pd = period(q);
  const basis = `Period ${pd.from} to ${pd.to}`;
  const inPeriod = { $gte: pd.fromD, $lt: pd.toD };
  const N = await names();
  const moved = async (stages: string[], appIds?: unknown[]) => (await StageHistory.distinct('application_id', { to_stage: { $in: stages }, changed_at: inPeriod, ...(appIds ? { application_id: { $in: appIds } } : {}) })).length;
  if (k === 'pipeline') {
    const stages = await stageList('app_stage');
    const sName = (c: string) => stages.find((s) => s.code === c)?.name ?? c;
    const apps = await Application.aggregate([{ $match: { is_deleted: false, createdAt: { $lt: pd.toD } } }, { $group: { _id: { stage: '$stage', country: '$country_id', intake: '$intake_id' }, n: { $sum: 1 } } }, { $sort: { '_id.stage': 1 } }]);
    const intakes = new Map((await Intake.find().select('name').lean()).map((i) => [String(i._id), i.name]));
    const leads = await Lead.aggregate([{ $match: { is_deleted: false } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
    return { basis: 'Current stage (snapshot); applications created up to the end date', columns: ['Stage', 'Country', 'Intake', 'Count'],
      rows: [...leads.map((x) => [`Lead: ${x._id}`, '-', '-', x.n]), ...apps.map((x) => [sName(x._id.stage), N(x._id.country) || '-', intakes.get(String(x._id.intake)) ?? '-', x.n])] };
  }
  if (k === 'funnel') {
    const leads = await Lead.countDocuments({ is_deleted: false, createdAt: inPeriod });
    const reg = await Student.countDocuments({ is_deleted: false, createdAt: inPeriod });
    const applied = await moved(['applied']), offers = await moved(['conditional_offer', 'unconditional_offer']), accepted = await moved(['offer_accepted']), enrolled = await moved(['enrolment_confirmed']);
    const decided = await VisaCase.find({ is_deleted: false, stage: { $in: ['approved', 'rejected'] }, updatedAt: inPeriod }).select('stage').lean();
    const va = decided.filter((v) => v.stage === 'approved').length;
    const pct = (a: number, b: number) => (b ? Math.round(a / b * 100) + '%' : '-');
    return { basis: `${basis}; stage dates`, columns: ['Step', 'Count', '% of previous'], rows: [['Leads created', leads, ''], ['Registered students', reg, pct(reg, leads)], ['Applications applied', applied, ''],
      ['Offers', offers, pct(offers, applied)], ['Offers accepted', accepted, pct(accepted, offers)], ['Visa approved', va, `success ${pct(va, decided.length)}`], ['Enrolled', enrolled, pct(enrolled, accepted)]] };
  }
  if (k === 'counsellors') {
    const users = await User.find({ role: 'counsellor' }).select('name').lean();
    return { basis: `${basis}; created / stage dates`, columns: ['Counsellor', 'Leads', 'Avg first response (h)', 'Registered', 'Applications', 'Offers', 'Enrolled', 'Save without notifying', 'Tasks overdue'],
      rows: await Promise.all(users.map(async (u) => {
        const leads = await Lead.find({ assigned_user_id: u._id, is_deleted: false, createdAt: inPeriod }).select('createdAt').lean();
        const fr: number[] = [];
        for (const l of leads) { const a = await LeadActivity.findOne({ lead_id: l._id }).sort({ createdAt: 1 }).select('createdAt').lean(); if (a) fr.push((+a.createdAt - +l.createdAt) / 3600e3); }
        const apps = await Application.distinct('_id', { student_id: { $in: await Student.distinct('_id', { primary_counsellor_id: u._id }) } });
        return [u.name, leads.length, fr.length ? Math.round(fr.reduce((a, b) => a + b, 0) / fr.length * 10) / 10 : '-', await Student.countDocuments({ primary_counsellor_id: u._id, createdAt: inPeriod }),
          await moved(['applied'], apps), await moved(['conditional_offer', 'unconditional_offer'], apps), await moved(['enrolment_confirmed'], apps),
          await AuditLog.countDocuments({ user_id: u._id, action: 'Save without notifying', createdAt: inPeriod }),
          await Task.countDocuments({ assigned_to: u._id, status: { $in: ['Open', 'In progress'] }, due_at: { $lt: new Date() }, is_deleted: false })];
      })) };
  }
  if (k === 'universities') {
    const OFFER = ['conditional_offer', 'unconditional_offer', 'offer_accepted', 'tuition_paid', 'enrolment_confirmed'];
    const rows = [];
    for (const u of await University.find({ is_deleted: false }).sort({ name: 1 }).select('name').lean()) {
      const apps = await Application.find({ university_id: u._id, is_deleted: false, createdAt: inPeriod }).select('stage').lean();
      if (!apps.length) continue;
      const off = apps.filter((a) => OFFER.includes(a.stage)).length, enr = apps.filter((a) => a.stage === 'enrolment_confirmed').length;
      rows.push([u.name, apps.length, '-', Math.round(off / apps.length * 100) + '%', off ? Math.round(enr / off * 100) + '%' : '-']);
    }
    return { basis: 'Applications created in the period', columns: ['University', 'Applications', 'Avg days to first decision', 'Offer rate', 'Enrolment rate'], rows };
  }
  if (k === 'revenue') {
    const pays = await Payment.aggregate([{ $match: { is_deleted: false, payment_date: { $gte: pd.from, $lte: pd.to } } }, { $group: { _id: { f: '$payment_for', c: '$currency' },
      paid: { $sum: { $cond: [{ $ne: ['$is_refund', true] }, '$amount', 0] } }, refunds: { $sum: { $cond: [{ $and: [{ $eq: ['$is_refund', true] }, { $eq: ['$refund_status', 'Approved'] }] }, '$amount', 0] } } } }]);
    const [billed] = await FeeSummary.aggregate([{ $match: { fee_kind: 'service', is_deleted: false } }, { $group: { _id: null, t: { $sum: '$total_amount' }, d: { $sum: { $cond: ['$discount_approved', '$discount', 0] } } } }]);
    return { basis: `${basis}; payment dates`, columns: ['Item', 'Currency', 'Amount', 'Refunds'],
      rows: [...pays.map((x) => [x._id.f, x._id.c, Math.round(x.paid), Math.round(-x.refunds)]), ['Service fee billed (all students)', 'INR', Math.round(billed?.t ?? 0), ''], ['Discounts approved', 'INR', Math.round(billed?.d ?? 0), '']] };
  }
  if (k === 'catalogue') {
    await qualityScan();
    const old = addDays(istDate(), -(Number(await regVal('course_verify_months')) || 6) * 30);
    const pubUnis = await Course.distinct('university_id', { status: 'Published', is_deleted: false });
    return { basis: 'Today', columns: ['Check', 'Count'], rows: [['Published courses', await Course.countDocuments({ status: 'Published', is_deleted: false })],
      ['Universities without logo (with published courses)', await University.countDocuments({ _id: { $in: pubUnis }, logo_url: null })],
      ['"Last verified" older than the limit', await Course.countDocuments({ status: 'Published', is_deleted: false, $or: [{ last_verified_on: null }, { last_verified_on: { $lt: old } }] })],
      ['Course link warnings', await Course.countDocuments({ link_domain_warning: true, is_deleted: false })]] };
  }
  if (k === 'email') {
    const rows = await EmailLog.aggregate([{ $match: { queued_at: inPeriod } }, { $group: { _id: '$trigger_code', s: { $sum: { $cond: [{ $eq: ['$status', 'Sent'] }, 1, 0] } },
      d: { $sum: { $cond: [{ $in: ['$status', ['Delivered', 'Opened']] }, 1, 0] } }, f: { $sum: { $cond: [{ $eq: ['$status', 'Failed'] }, 1, 0] } }, b: { $sum: { $cond: [{ $eq: ['$status', 'Bounced'] }, 1, 0] } } } }, { $sort: { _id: 1 } }]);
    return { basis: `${basis}; queued date`, columns: ['Trigger', 'Sent', 'Delivered / opened', 'Failed', 'Bounced'], rows: rows.map((x) => [x._id, x.s, x.d, x.f, x.b]) };
  }
  if (k === 'privacy') {
    const c = await ConsentRecord.aggregate([{ $match: { createdAt: inPeriod } }, { $group: { _id: { t: '$consent_type', v: '$value' }, n: { $sum: 1 } } }]);
    const d = await AccountDeletionRequest.aggregate([{ $group: { _id: '$status', n: { $sum: 1 }, oldest: { $min: '$createdAt' } } }]);
    return { basis, columns: ['Item', 'Count'], rows: [...c.map((x) => [`Consent ${x._id.t}: ${x._id.v}`, x.n]), ...d.map((x) => [`Deletion requests ${x._id} (oldest ${new Date(x.oldest).toISOString().slice(0, 10)})`, x.n])] };
  }
  throw bad('Unknown report');
}
router.get('/console/reports', handle(async (req, res) => {
  const ok = (await isSuper(req)) || (await can(req, 'reports'));
  const list = [];
  for (const [key, label] of REPORTS) if (await allowed(req, key)) list.push({ key, label });
  const names0 = await userNames();
  res.json({ reports: list,
    scheduled: ok ? (await ScheduledReport.find({ is_deleted: false }).sort({ createdAt: -1 }).lean()).map((s) => ({ ...s, id: String(s._id), recipients: s.recipients.map((id) => nameIn(names0, id)) })) : [],
    staff: ok ? (await User.find({ isActive: true }).sort({ name: 1 }).select('name').lean()).map((u) => ({ id: String(u._id), name: u.name })) : [] });
}));
router.get('/console/reports/:key', handle(async (req, res) => {
  if (!(await allowed(req, req.params.key))) throw forbidden();
  const d = await report(req, req.params.key, req.query as Record<string, string>);
  const label = REPORTS.find((x) => x[0] === req.params.key)![1];
  if (req.query.format === 'xlsx' || req.query.format === 'pdf') {
    await audit(req, 'Export', 'Report', req.params.key, `${label} (${req.query.format})`);
    if (req.query.format === 'pdf') {
      const w = Math.floor(515 / d.columns.length);
      const buf = await docPdf({ title: label, badge: 'REPORT', kv: [['Basis', d.basis]], columns: d.columns.map((c) => [c, w] as [string, number]), rows: d.rows.map((r) => r.map(String)) });
      res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${req.params.key}.pdf"`); res.send(buf); return;
    }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(label.slice(0, 30));
    ws.addRow([d.basis]); ws.addRow(d.columns).font = { bold: true }; d.rows.forEach((x) => ws.addRow(x)); ws.columns.forEach((c) => { c.width = 20; });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${req.params.key}.xlsx"`);
    res.send(Buffer.from(await wb.xlsx.writeBuffer())); return;
  }
  res.json({ ...d, label });
}));
router.post('/console/reports/scheduled', handle(async (req, res) => {
  await need(req, 'reports', 'edit');
  const b = req.body ?? {};
  if (!(await allowed(req, b.report_type))) throw fieldErr('report_type', 'Choose a report you can see');
  if (!['weekly', 'monthly'].includes(b.frequency)) throw fieldErr('frequency', 'Choose weekly or monthly');
  const recipients = ((b.recipients ?? []) as unknown[]).map(oid).filter(Boolean);
  if (!recipients.length) throw fieldErr('recipients', 'Choose at least one staff member');
  const s = await ScheduledReport.create({ report_type: b.report_type, frequency: b.frequency, recipients: recipients.map(String), filters: b.filters ?? {}, status: 'Active', created_by: req.user!.id });
  await audit(req, 'Create', 'ScheduledReport', s._id, b.report_type);
  res.json({ id: String(s._id) });
}));
router.post('/console/reports/scheduled/:id/delete', handle(async (req, res) => {
  await need(req, 'reports', 'edit');
  if (!(await ScheduledReport.exists({ _id: oid(req.params.id) }))) throw notFound();
  await ScheduledReport.updateOne({ _id: oid(req.params.id) }, { is_deleted: true });
  res.json({ ok: true });
}));
/** Job: weekly reports on Monday, monthly on the 1st, sent by email to the chosen staff. */
export async function scheduledReportsJob() {
  const ist = istDate();
  const weekday = new Date(ist + 'T00:00:00Z').getUTCDay();
  for (const s of await ScheduledReport.find({ status: 'Active', is_deleted: false })) {
    const due = s.frequency === 'weekly' ? weekday === 1 : ist.slice(8, 10) === '01';
    if (!due || (s.last_sent_at && istDate(s.last_sent_at) === ist)) continue;
    const owner = await User.findById(s.created_by).lean();
    if (!owner) continue;
    try {
      const fakeReq = { user: { id: String(owner._id), role: owner.role, name: owner.name } } as unknown as AuthRequest;
      const d = await report(fakeReq, s.report_type, { period: s.frequency === 'weekly' ? undefined : 'month', from: s.frequency === 'weekly' ? addDays(ist, -7) : undefined });
      const label = REPORTS.find((x) => x[0] === s.report_type)?.[1] ?? s.report_type;
      const html = `<p>${esc(d.basis)}</p><table style="border-collapse:collapse;font-size:12px"><tr>${d.columns.map((c) => `<th style="border:1px solid #ddd;padding:4px;background:#f1f5f9">${esc(c)}</th>`).join('')}</tr>${d.rows.slice(0, 100).map((r) => `<tr>${r.map((c) => `<td style="border:1px solid #ddd;padding:4px">${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
      const to = (await User.find({ _id: { $in: s.recipients }, isActive: true }).select('email').lean()).map((u) => u.email);
      await quickEmail({ to, subject: `[La Europa CRM] ${label} (${s.frequency})`, title: label, html, kind: 'staff' });
      s.last_sent_at = new Date(); await s.save();
    } catch (e) { console.warn('[scheduled report]', (e as Error).message); }
  }
}

export default router;
