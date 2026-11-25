import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../middleware/auth';
import Lead, { LeadActivity, LEAD_FLOW, LEVELS, type ILead, type LeadStatus } from '../models/Lead';
import { Timeline, nextCode } from '../models/Timeline';
import { Country, Intake, MasterItem } from '../models/Master';
import User from '../models/User';
import Student from '../models/Student';
import { can } from '../config/clientPerms';
import { serverError } from '../utils/httpError';

/** The client's Inquiry / Lead management (legacy/server/routes/leads.js, Section 4), on MongoDB. */
const router = Router();
router.use(authenticate);

class HttpError extends Error { constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); } }
const bad = (message: string, extra: Record<string, unknown> = {}) => new HttpError(400, message, extra);
const handle = (fn: (req: AuthRequest, res: Response) => Promise<unknown>) => async (req: AuthRequest, res: Response) => {
  try { await fn(req, res); } catch (err) {
    if (err instanceof HttpError) { res.status(err.status).json({ error: err.message, ...err.extra }); return; }
    serverError(res, err);
  }
};
const need = (req: AuthRequest, module: string, action: string) => { if (!can(req.user!.role, module, action)) throw new HttpError(403, 'You do not have access to this record'); };
const isAdmin = (req: AuthRequest) => req.user!.role === 'admin';
const seesAll = (req: AuthRequest) => ['admin', 'manager'].includes(req.user!.role);
const oid = (v: unknown) => (typeof v === 'string' && mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(v) : null);
const clean = (v: unknown, max = 500) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : undefined; };
const normPhone = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : d || undefined; };
const isEmail = (e: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e ?? ''));
const NAME_RE = /^[A-Za-z .]+$/;
const leadName = (l: Pick<ILead, 'first_name' | 'last_name'>) => [l.first_name, l.last_name].filter(Boolean).join(' ');
const TZ = 'Asia/Kolkata';
const istDate = (d: Date = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const istDayStart = (day: string) => new Date(`${day}T00:00:00+05:30`);
const addDays = (day: string, n: number) => istDate(new Date(+istDayStart(day) + n * 86_400_000 + 3_600_000));
const timeline = (e: { lead_id?: unknown; student_id?: unknown; type: string; description: string; data?: unknown; user_id?: string }) => Timeline.create(e);

/** Which leads a user may see: Admin / Manager all, everyone else what is assigned to or created by them. */
function scope(req: AuthRequest): Record<string, unknown> {
  if (seesAll(req)) return {};
  if (!can(req.user!.role, 'leads', 'view')) return { _id: null };
  const me = new mongoose.Types.ObjectId(req.user!.id);
  return { $or: [{ assigned_user_id: me }, { created_by: me }] };
}
async function loadLead(req: AuthRequest, id: string) {
  const _id = oid(id);
  const l = _id && (await Lead.findOne({ _id, is_deleted: false, ...scope(req) }));
  if (!l) { const hidden = _id && (await Lead.exists({ _id, is_deleted: false })); throw new HttpError(hidden ? 403 : 404, hidden ? 'You do not have access to this record' : 'Lead not found'); }
  return l;
}

// names for the ids a lead points at, loaded once per request
async function lookups() {
  const [masters, countries, intakes, users] = await Promise.all([
    MasterItem.find({ type: { $in: ['lead_source', 'sub_agent'] } }).select('name').lean(),
    Country.find().select('name').lean(), Intake.find().select('name').lean(), User.find().select('name').lean(),
  ]);
  const map = (rows: { _id: unknown; name: string }[]) => new Map(rows.map((r) => [String(r._id), r.name]));
  return { m: map(masters), c: map(countries), i: map(intakes), u: map(users) };
}
type Lookups = Awaited<ReturnType<typeof lookups>>;
const nameOf = (map: Map<string, string>, id: unknown) => (id ? map.get(String(id)) ?? '' : '');

function rowOut(l: ILead, L: Lookups) {
  const o = l.toObject ? l.toObject() : (l as unknown as Record<string, unknown>);
  const closed = ['Converted', 'Not interested'].includes(l.status);
  const fu = l.next_followup_at ? istDate(new Date(l.next_followup_at)) : null;
  const today = istDate();
  const past = l.next_followup_at ? new Date(l.next_followup_at) < new Date() : false;
  return {
    ...o, _id: undefined, __v: undefined,
    id: String(l._id), name: leadName(l), created_at: l.createdAt, updated_at: l.updatedAt,
    source_id: l.source_id ? String(l.source_id) : null, sub_agent_id: l.sub_agent_id ? String(l.sub_agent_id) : null,
    intake_id: l.intake_id ? String(l.intake_id) : null, assigned_user_id: l.assigned_user_id ? String(l.assigned_user_id) : null,
    source: nameOf(L.m, l.source_id), sub_agent: nameOf(L.m, l.sub_agent_id),
    interested_countries: (l.interested_countries ?? []).map(String),
    countries: (l.interested_countries ?? []).map((c) => nameOf(L.c, c)).filter(Boolean),
    intake: nameOf(L.i, l.intake_id), counsellor: nameOf(L.u, l.assigned_user_id),
    followup_state: !closed && l.next_followup_at ? (fu === today ? (past ? 'overdue' : 'today') : past ? 'overdue' : 'future') : null,
  };
}

// ---------- list ----------
const SORTS: Record<string, string> = { lead_code: 'lead_code', name: 'first_name', city: 'city', status: 'status', next_followup_at: 'next_followup_at',
  created_at: 'createdAt', email: 'email', counsellor: 'assigned_user_id', source: 'source_id', intake: 'intake_id', phone: 'phone' };

router.get('/', handle(async (req, res) => {
  need(req, 'leads', 'view');
  const q = req.query as Record<string, string>;
  const and: Record<string, unknown>[] = [{ is_deleted: false, merged_into: null }, scope(req)];
  if (q.status) and.push({ status: { $in: String(q.status).split(',').filter(Boolean) } });
  if (oid(q.source)) and.push({ source_id: oid(q.source) });
  if (oid(q.country)) and.push({ interested_countries: oid(q.country) });
  if (oid(q.intake)) and.push({ intake_id: oid(q.intake) });
  if (oid(q.counsellor) && isAdmin(req)) and.push({ assigned_user_id: oid(q.counsellor) });
  if (q.created_from) and.push({ createdAt: { $gte: istDayStart(q.created_from) } });
  if (q.created_to) and.push({ createdAt: { $lt: istDayStart(addDays(q.created_to, 1)) } });
  const today = istDate();
  const open = { status: { $nin: ['Converted', 'Not interested'] } };
  if (q.followup === 'today') and.push(open, { next_followup_at: { $gte: istDayStart(today), $lt: istDayStart(addDays(today, 1)) } });
  if (q.followup === 'overdue') and.push(open, { next_followup_at: { $lt: new Date() } });
  if (q.followup === 'week') and.push(open, { next_followup_at: { $gte: istDayStart(today), $lt: istDayStart(addDays(today, 7)) } });
  if (q.followup === 'custom' && q.fu_from) and.push({ next_followup_at: { $gte: istDayStart(q.fu_from) } });
  if (q.followup === 'custom' && q.fu_to) and.push({ next_followup_at: { $lt: istDayStart(addDays(q.fu_to, 1)) } });
  if (q.q) {
    const rx = new RegExp(String(q.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const ph = normPhone(q.q);
    and.push({ $or: [{ first_name: rx }, { last_name: rx }, { email: rx }, { lead_code: rx }, ...(ph ? [{ phone_normalised: new RegExp(ph) }] : [])] });
  }
  const filter = { $and: and };
  const size = [25, 50, 100].includes(Number(q.size)) ? Number(q.size) : 25;
  const page = Math.max(1, Number(q.page) || 1);
  const sortKey = SORTS[q.sort] || 'next_followup_at';
  const dir = q.dir === 'desc' ? -1 : 1;
  const [total, rows, L] = await Promise.all([
    Lead.countDocuments(filter),
    // nulls last, like the client's "ORDER BY x IS NULL, x"
    Lead.aggregate([{ $match: filter }, { $addFields: { _null: { $cond: [{ $ifNull: [`$${sortKey}`, false] }, 0, 1] } } },
      { $sort: { _null: 1, [sortKey]: dir, createdAt: -1 } }, { $skip: (page - 1) * size }, { $limit: size }]),
    lookups(),
  ]);
  res.json({ total, page, size, rows: rows.map((r) => rowOut(Lead.hydrate(r), L)) });
}));

// ---------- validation ----------
async function srcName(id: unknown) { const m = oid(id) && (await MasterItem.findById(oid(id)).select('name').lean()); return m ? m.name : ''; }

async function validate(b: Record<string, any>, existing?: ILead) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const errors: Record<string, string> = {};
  const reqd = (k: string, label: string) => { if (b[k] === undefined || b[k] === null || String(b[k]).trim() === '') errors[k] = `${label} is required`; };
  reqd('first_name', 'First name'); reqd('phone', 'Phone'); reqd('source_id', 'Source'); reqd('status', 'Status');
  if (b.first_name && (!NAME_RE.test(b.first_name) || b.first_name.length > 50)) errors.first_name = 'Letters, spaces and dot only (max 50)';
  if (b.last_name && b.last_name.length > 50) errors.last_name = 'Max 50 characters';
  const cc = b.country_code || '+91';
  if (b.phone && cc === '+91' && (normPhone(b.phone) || '').length !== 10) errors.phone = 'Enter a 10 digit mobile number';
  if (b.phone && cc !== '+91' && !/^\d{6,15}$/.test(String(b.phone).replace(/\D/g, ''))) errors.phone = 'Enter a valid phone number';
  if (b.email && !isEmail(b.email)) errors.email = 'Enter a valid email';
  const src = await srcName(b.source_id);
  if (src === 'Referral' && !clean(b.referred_by)) errors.referred_by = 'Referred by is required for Referral';
  if (src === 'Sub-agent' && !b.sub_agent_id) errors.sub_agent_id = 'Select the sub-agent';
  if (src === 'Other' && !clean(b.source_details)) errors.source_details = 'Source details are required';
  if (b.status === 'Not interested' && !b.not_interested_reason) errors.not_interested_reason = 'Select a reason';
  if (b.status === 'Follow-up') {
    const prev = existing?.next_followup_at ? new Date(existing.next_followup_at).toISOString() : null;
    if (!b.next_followup_at) errors.next_followup_at = 'Next follow-up date and time is required';
    else if (new Date(b.next_followup_at) <= new Date() && (!existing || prev !== new Date(b.next_followup_at).toISOString())) errors.next_followup_at = 'Follow-up must be in the future';
  }
  if (b.status === 'Converted' && (!existing || existing.status !== 'Converted')) errors.status = 'Converted is set only by the Convert to Student button';
  if (b.notes_internal && b.notes_internal.length > 2000) errors.notes_internal = 'Max 2000 characters';
  if (b.level && !LEVELS.includes(b.level)) errors.level = 'Invalid level';
  if (existing && b.status !== existing.status && !LEAD_FLOW[existing.status].includes(b.status)) errors.status = `Status cannot change from ${existing.status} to ${b.status}`;
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  return src;
}

function fields(b: Record<string, any>, src: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    first_name: clean(b.first_name, 50), last_name: clean(b.last_name, 50), country_code: b.country_code || '+91',
    phone: String(b.phone || '').replace(/[^\d+]/g, ''), phone_normalised: normPhone(b.phone),
    is_whatsapp: b.is_whatsapp === undefined ? true : !!b.is_whatsapp, alt_phone: clean(b.alt_phone, 20),
    email: b.email ? String(b.email).trim().toLowerCase() : undefined, city: clean(b.city, 80), state: clean(b.state, 80),
    source_id: oid(b.source_id), sub_agent_id: src === 'Sub-agent' ? oid(b.sub_agent_id) : null,
    referred_by: src === 'Referral' ? clean(b.referred_by, 100) : undefined, source_details: src === 'Other' ? clean(b.source_details, 200) : undefined,
    interested_countries: (Array.isArray(b.interested_countries) ? b.interested_countries : []).map(oid).filter(Boolean),
    course_interest: clean(b.course_interest, 150), level: b.level || undefined, intake_id: oid(b.intake_id), highest_qualification: b.highest_qualification || undefined,
    status: (b.status || 'New') as LeadStatus, not_interested_reason: b.status === 'Not interested' ? b.not_interested_reason : undefined,
    next_followup_at: b.next_followup_at ? new Date(b.next_followup_at) : undefined, notes_internal: clean(b.notes_internal, 2000),
  };
}

/** Same phone or email on another lead or student (legacy services.duplicates). */
async function duplicates(phone?: string, email?: string, excludeLeadId?: unknown) {
  if (!phone && !email) return [];
  const L = await lookups();
  const students = await Student.find({ $or: [...(phone ? [{ 'personal.phone': new RegExp(`${phone}$`) }] : []), ...(email ? [{ 'personal.email': email }] : [])] }).lean();
  const out: Record<string, unknown>[] = students.map((s) => ({ kind: 'student', id: String(s._id), code: (s as Record<string, unknown>).student_code ?? '', name: s.personal?.name, status: s.stage,
    assigned_user_id: s.counsellors?.[0] ? String(s.counsellors[0]) : null, counsellor: nameOf(L.u, s.counsellors?.[0]) }));
  const leads = await Lead.find({ is_deleted: false, merged_into: null, _id: { $ne: excludeLeadId ?? null },
    $or: [...(phone ? [{ phone_normalised: phone }] : []), ...(email ? [{ email }] : [])] }).lean();
  for (const l of leads) out.push({ kind: 'lead', id: String(l._id), code: l.lead_code, name: leadName(l), status: l.status,
    assigned_user_id: l.assigned_user_id ? String(l.assigned_user_id) : null, created_by: l.created_by ? String(l.created_by) : null, counsellor: nameOf(L.u, l.assigned_user_id) });
  return out;
}
function dupError(req: AuthRequest, matches: Record<string, unknown>[]) {
  const m = matches[0];
  const mine = isAdmin(req) || m.assigned_user_id === req.user!.id || m.created_by === req.user!.id;
  return new HttpError(409, `A ${m.kind} with this phone/email already exists: ${m.name}, assigned to ${m.counsellor || 'nobody'}, status ${m.status}.`,
    { duplicate: { ...m, can_open: mine }, matches: isAdmin(req) ? matches : undefined });
}

// ---------- create ----------
router.post('/', handle(async (req, res) => {
  need(req, 'leads', 'add');
  const b = req.body ?? {};
  const src = await validate(b);
  const f = fields(b, src);
  const matches = await duplicates(f.phone_normalised, f.email);
  if (matches.length && !(isAdmin(req) && b.save_anyway && clean(b.save_anyway_reason))) throw dupError(req, matches);
  const me = req.user!.id;
  const assigned = isAdmin(req) && oid(b.assigned_user_id) ? oid(b.assigned_user_id)! : new mongoose.Types.ObjectId(me);
  const lead_code = await nextCode('L');
  const l = await Lead.create({ ...f, lead_code, assigned_user_id: assigned, created_by: me, updated_by: me });
  await timeline({ lead_id: l._id, type: 'lead', description: `Lead created by ${req.user!.name} (status ${f.status})`, user_id: me });
  // E01 acknowledgement / E03 follow-up email and the follow-up system task arrive with the email engine and Tasks (PORTING.md)
  res.json({ id: String(l._id), lead_code });
}));

router.post('/check-duplicate', handle(async (req, res) => {
  const m = await duplicates(normPhone(req.body?.phone), req.body?.email ? String(req.body.email).trim().toLowerCase() : undefined, oid(req.body?.exclude_lead_id));
  res.json({ matches: m.map((x) => ({ ...x, can_open: isAdmin(req) || x.assigned_user_id === req.user!.id || x.created_by === req.user!.id })) });
}));

router.post('/request-access', handle(async (req, res) => {
  const { kind, id } = req.body ?? {};
  const _id = oid(id);
  const rec = _id && (kind === 'student' ? await Student.exists({ _id }) : await Lead.exists({ _id }));
  if (!rec) throw new HttpError(404, 'Not found');
  // Admin notification arrives with Notifications (PORTING.md); the request is recorded on the timeline meanwhile
  await timeline({ ...(kind === 'student' ? { student_id: _id } : { lead_id: _id }), type: 'lead', description: `${req.user!.name} requested access (duplicate found)`, user_id: req.user!.id });
  res.json({ ok: true, message: 'Admin has been notified of your access request.' });
}));

// ---------- detail ----------
router.get('/:id', handle(async (req, res) => {
  const l = await loadLead(req, req.params.id);
  const [acts, tl, L] = await Promise.all([
    LeadActivity.find({ lead_id: l._id, is_deleted: false }).sort({ createdAt: -1 }).lean(),
    Timeline.find({ lead_id: l._id }).sort({ createdAt: -1 }).limit(200).lean(),
    lookups(),
  ]);
  res.json({
    lead: rowOut(l, L),
    activities: acts.map((a) => ({ ...a, id: String(a._id), created_at: a.createdAt, logged_by: String(a.logged_by), logged_by_name: nameOf(L.u, a.logged_by),
      editable: isAdmin(req) || (String(a.logged_by) === req.user!.id && Date.now() - +new Date(a.createdAt) < 864e5) })),
    timeline: tl.map((t) => ({ ...t, id: String(t._id), created_at: t.createdAt, user_name: nameOf(L.u, t.user_id) })),
    emails: [],
    allowed_next: LEAD_FLOW[l.status],
  });
}));

// ---------- update ----------
router.put('/:id', handle(async (req, res) => {
  need(req, 'leads', 'edit');
  const l = await loadLead(req, req.params.id);
  if (l.status === 'Converted') throw bad('This lead is converted and locked.');
  const L = await lookups();
  const b = { ...rowOut(l, L), ...req.body };
  const src = await validate(b, l);
  const f = fields(b, src);
  const before = l.toObject();
  if ((f.phone_normalised !== l.phone_normalised || (f.email ?? '') !== (l.email ?? ''))) {
    const matches = await duplicates(f.phone_normalised, f.email, l._id);
    if (matches.length && !(isAdmin(req) && b.save_anyway && clean(b.save_anyway_reason))) throw dupError(req, matches);
  }
  const update: Record<string, unknown> = { ...f, updated_by: req.user!.id };
  if (req.body.assigned_user_id && req.body.assigned_user_id !== String(l.assigned_user_id ?? '')) {
    if (!isAdmin(req)) throw new HttpError(403, 'Only Admin can change the assigned counsellor');
    update.assigned_user_id = oid(req.body.assigned_user_id);
  }
  const changed = Object.keys(f).filter((k) => JSON.stringify((before as unknown as Record<string, unknown>)[k] ?? null) !== JSON.stringify((f as Record<string, unknown>)[k] ?? null) && k !== 'phone_normalised');
  await Lead.updateOne({ _id: l._id }, update);
  if (changed.length) {
    const labels = changed.map((k) => (k === 'status' ? `Status: ${before.status} to ${f.status}` : k.replace(/_id$/, '').replace(/_/g, ' ')));
    await timeline({ lead_id: l._id, type: changed.includes('status') ? 'stage' : 'lead', description: `Lead updated: ${labels.join(', ')}`, user_id: req.user!.id });
  }
  res.json({ ok: true });
}));

// ---------- follow-up popup ----------
router.post('/:id/followup', handle(async (req, res) => {
  need(req, 'leads', 'edit');
  const l = await loadLead(req, req.params.id);
  if (l.status === 'Converted') throw bad('This lead is converted and locked.');
  if (!LEAD_FLOW[l.status].includes('Follow-up') && l.status !== 'Follow-up') throw bad(`Cannot set follow-up from status ${l.status}`);
  const at = req.body?.next_followup_at;
  if (!at || new Date(at) <= new Date()) throw bad('Follow-up must be in the future', { errors: { next_followup_at: 'Follow-up must be in the future' } });
  await Lead.updateOne({ _id: l._id }, { status: 'Follow-up', next_followup_at: new Date(at), updated_by: req.user!.id });
  await timeline({ lead_id: l._id, type: 'lead', description: `Follow-up set for ${new Date(at).toLocaleString('en-GB', { timeZone: TZ })}`, user_id: req.user!.id });
  res.json({ ok: true });
}));

// ---------- call / notes log ----------
const ACT_TYPES = ['Call (outgoing)', 'Call (incoming)', 'WhatsApp', 'Email', 'Meeting / Walk-in', 'Note'];
const OUTCOMES = ['Connected', 'Not reachable', 'Busy', 'Call back later', 'Wrong number'];
router.post('/:id/activities', handle(async (req, res) => {
  need(req, 'leads', 'edit');
  const l = await loadLead(req, req.params.id);
  const b = req.body ?? {};
  const errors: Record<string, string> = {};
  if (!ACT_TYPES.includes(b.type)) errors.type = 'Type is required';
  if (String(b.type).startsWith('Call') && !OUTCOMES.includes(b.outcome)) errors.outcome = 'Outcome is required for calls';
  if (!clean(b.notes)) errors.notes = 'Notes are required'; else if (String(b.notes).length > 2000) errors.notes = 'Max 2000 characters';
  if (b.next_followup_at && new Date(b.next_followup_at) <= new Date()) errors.next_followup_at = 'Must be in the future';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  const a = await LeadActivity.create({ lead_id: l._id, type: b.type, outcome: String(b.type).startsWith('Call') ? b.outcome : undefined,
    notes: clean(b.notes, 2000), next_followup_at: b.next_followup_at ? new Date(b.next_followup_at) : undefined, logged_by: req.user!.id });
  await timeline({ lead_id: l._id, type: 'note', description: `${b.type}${b.outcome ? ` (${b.outcome})` : ''} logged by ${req.user!.name}`, user_id: req.user!.id });
  if (b.next_followup_at && l.status !== 'Converted') {
    await Lead.updateOne({ _id: l._id }, { status: 'Follow-up', next_followup_at: new Date(b.next_followup_at) });
  } else if (l.status === 'New') {
    await Lead.updateOne({ _id: l._id }, { status: 'Contacted' });
    await timeline({ lead_id: l._id, type: 'stage', description: 'Status: New to Contacted (first contact logged)', user_id: req.user!.id });
  }
  res.json({ id: String(a._id) });
}));

router.put('/:id/activities/:aid', handle(async (req, res) => {
  const l = await loadLead(req, req.params.id);
  const a = oid(req.params.aid) && (await LeadActivity.findOne({ _id: oid(req.params.aid), lead_id: l._id }));
  if (!a) throw new HttpError(404, 'Not found');
  if (!isAdmin(req) && (String(a.logged_by) !== req.user!.id || Date.now() - +a.createdAt > 864e5)) throw bad('Log entries cannot be edited after 24 hours');
  if (!clean(req.body?.notes)) throw bad('Notes are required', { errors: { notes: 'Notes are required' } });
  a.notes = clean(req.body.notes, 2000)!; if (req.body.outcome) a.outcome = req.body.outcome;
  await a.save();
  res.json({ ok: true });
}));

export default router;

// ---------- delete (soft, with reason) and request access to a duplicate ----------
router.delete('/:id', handle(async (req, res) => {
  need(req, 'leads', 'delete');
  const l = await loadLead(req, req.params.id);
  if (l.status === 'Converted') throw bad('This lead is converted and locked.');
  const reason = clean(req.body?.reason, 500);
  if (!reason) throw bad('A reason is required', { errors: { reason: 'Required' } });
  await Lead.updateOne({ _id: l._id }, { is_deleted: true, updated_by: req.user!.id });
  await timeline({ lead_id: l._id, type: 'lead', description: `Lead deleted by ${req.user!.name}: ${reason}`, user_id: req.user!.id });
  res.json({ ok: true });
}));
