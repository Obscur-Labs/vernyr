import { Types } from 'mongoose';
import Lead, { LeadActivity } from '../models/Lead';
import Student from '../models/Student';
import PortalAccount from '../models/PortalAccount';
import { Application } from '../models/Work';
import University from '../models/University';
import { PrivacyNotice, Processor, type IBreach } from '../models/Privacy';
import { AuditLog, getSetting, setSetting } from '../models/Audit';
import { isEmail, istDate, fmtDateTime } from './crm';
import { sendSecurity } from './email';
import { current } from './consent';
import { env } from '../config/env';

/** India DPDP Act 2023 + Rules 2025: notices, retention, shared-with, breach templates, the public contact page (legacy/server/dpdp.js). */

export const PHASES: [string, string, string][] = [['13 Nov 2025', '2025-11-13', 'Board set up, definitions in force'], ['13 Nov 2026', '2026-11-13', 'Consent Managers can register'],
  ['13 May 2027', '2027-05-13', 'All duties apply: notice, consent, security, breach reporting, children, rights, transfers, penalties']];
export const replyDays = async () => Math.min(90, Math.max(1, Number(await getSetting('grievance_response_days')) || 15));
export async function contacts() {
  const g = async (k: string) => String((await getSetting(k)) ?? '');
  return { legal_name: (await g('legal_name')) || 'Euroverse Service LLP (trading as La Europa Education)', address: await g('company_address'), privacy_email: await g('privacy_email'),
    officer: await g('grievance_officer_name'), officer_email: (await g('grievance_officer_email')) || (await g('privacy_email')), officer_phone: await g('grievance_officer_phone'), reply_days: await replyDays() };
}
/** N working days later (Mon to Sat; Sunday off). */
export function addWorkingDays(from: Date | number, n: number) {
  const d = new Date(from);
  for (let left = n; left > 0;) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0) left--; }
  return d;
}
export const grievanceDue = async (from: Date | number = Date.now()) => addWorkingDays(from, await replyDays());

// ---------- s.5(2): the privacy notice to people we already had, and to new leads ----------
export const noticeVersion = async () => { const d = await current('web_privacy'); return d ? `v${d.version}` : 'v1'; };
export async function noticeText(name?: string) {
  const c = await contacts();
  const base = env.portalUrl;
  return `Dear ${name || 'student'},

This is our privacy notice under India's Digital Personal Data Protection Act, 2023.

${c.legal_name} keeps the details you gave us (such as your name, phone, email, city, study plans and, if you apply, your academic and passport documents) to give you study-abroad counselling and, when you choose, to apply to universities and help with visas. We share data only with the universities, portals and authorities needed for the step you ask for, and with service providers that work for us under contract. Some of them are outside India.

Read the full notice: ${base}/legal/privacy-policy
How to use your rights and contact our Grievance Officer: ${base}/legal/privacy-contact

You can at any time: ask what data we hold and who we shared it with, correct or erase it, withdraw your consent (as easily as you gave it), nominate a person, or raise a grievance. Write to ${c.officer_email || 'us'} from your registered email${c.officer ? ` (Grievance Officer: ${c.officer})` : ''}. We reply within ${c.reply_days} working days. If you are not satisfied, you can complain to the Data Protection Board of India.

You do not need to do anything to keep using our service.
${c.legal_name}`;
}
type Person = { type: 'lead' | 'student'; id: Types.ObjectId; email?: string; name?: string };
export async function pendingPeople(limit = 100_000): Promise<Person[]> {
  const v = await noticeVersion();
  const done = async (type: string) => new Set((await PrivacyNotice.distinct('person_id', { person_type: type, notice_version: v })).map(String));
  const [dl, ds] = await Promise.all([done('lead'), done('student')]);
  const leads = (await Lead.find({ is_deleted: false, email: { $nin: [null, ''] }, erased_at: null, converted_student_id: null }).select('email first_name').lean())
    .filter((l) => !dl.has(String(l._id))).slice(0, limit).map((l) => ({ type: 'lead' as const, id: l._id as Types.ObjectId, email: l.email, name: l.first_name }));
  const students = (await Student.find({ is_deleted: false, email: { $nin: [null, ''] } }).select('email first_name').lean())
    .filter((s) => !ds.has(String(s._id))).slice(0, limit).map((s) => ({ type: 'student' as const, id: s._id as Types.ObjectId, email: s.email, name: s.first_name }));
  return [...leads, ...students];
}
export async function sendNotice(p: Person, reason: string) {
  const v = await noticeVersion();
  if (!isEmail(String(p.email ?? '').trim()) || (await PrivacyNotice.exists({ person_type: p.type, person_id: p.id, notice_version: v }))) return false;
  await PrivacyNotice.create({ person_type: p.type, person_id: p.id, email: p.email, notice_version: v, reason });
  await sendSecurity({ to: p.email!, subject: 'How La Europa Education uses your personal data (privacy notice)', text: await noticeText(p.name),
    student_id: p.type === 'student' ? p.id : undefined, lead_id: p.type === 'lead' ? p.id : undefined });
  return true;
}
/** New leads added by staff get the notice at collection, once the Admin switched it on. */
async function autoNotices() {
  const from = await getSetting('privacy_notice_auto_from');
  if (!from) return 0;
  let n = 0;
  for (const l of await Lead.find({ is_deleted: false, email: { $nin: [null, ''] }, createdAt: { $gte: new Date(String(from)) }, erased_at: null }).select('email first_name').limit(200).lean())
    if (await sendNotice({ type: 'lead', id: l._id as Types.ObjectId, email: l.email, name: l.first_name }, 'New lead (notice at collection)')) n++;
  return n;
}

// ---------- s.8(7) + Rule 8(3): erase cold leads (never before one year; off until the Admin sets it) ----------
export const coldMonths = async () => Math.max(0, Number(await getSetting('retention_cold_lead_months')) || 0);
export async function coldLeads(months?: number) {
  const m = months ?? (await coldMonths());
  if (!m) return [];
  const before = new Date(Date.now() - Math.max(12, m) * 30.4 * 864e5);
  const withPortal = new Set((await PortalAccount.distinct('leadId', { leadId: { $ne: null } })).map(String));
  const active = new Set((await LeadActivity.distinct('lead_id', { createdAt: { $gte: before } })).map(String));
  return (await Lead.find({ is_deleted: false, erased_at: null, converted_student_id: null, status: { $ne: 'Converted' }, updatedAt: { $lt: before } }).select('lead_code').lean())
    .filter((l) => !withPortal.has(String(l._id)) && !active.has(String(l._id)));
}
async function eraseLead(id: unknown) {
  await Lead.updateOne({ _id: id }, { $set: { first_name: 'Erased', phone: '', erased_at: new Date(), is_deleted: true, email_refs: [] },
    $unset: { last_name: 1, phone_normalised: 1, alt_phone: 1, email: 1, city: 1, state: 1, referred_by: 1, source_details: 1, course_interest: 1, notes_internal: 1, email_thread_root_id: 1, email_thread_subject: 1 } });
  await LeadActivity.updateMany({ lead_id: id }, { notes: '(erased)' });
}
export async function runRetention(by?: string) {
  const list = await coldLeads();
  for (const l of list) await eraseLead(l._id);
  if (list.length) await AuditLog.create({ user_id: by, action: 'Retention', entity_type: 'Lead', entity_label: `Erased ${list.length} cold lead(s) (DPDP s.8(7))${by ? '' : ' by the daily job'}` });
  return list.length;
}

// ---------- s.11(1)(b): who the person's data was shared with ----------
export async function sharedWith(studentId?: unknown) {
  const unis = studentId ? await University.find({ _id: { $in: await Application.distinct('university_id', { student_id: studentId, is_deleted: false }) } }).sort({ name: 1 }).select('name country').lean() : [];
  const procs = await Processor.find({ active: true }).sort({ name: 1 }).lean();
  return { universities: unis.map((u) => ({ name: u.name, country: u.country, what: 'Your application and the documents needed for it' })),
    processors: procs.map((x) => ({ name: x.name, what: x.service, location: x.location })) };
}

// ---------- s.9(3): no targeted offers to children ----------
export const isChild = async (suId: unknown) => !!((await PortalAccount.findById(suId).select('flags').lean())?.flags as { is_minor?: boolean } | undefined)?.is_minor;

// ---------- breach notice templates (Rule 7) ----------
export async function breachTemplates(b: IBreach) {
  const c = await contacts();
  const when = fmtDateTime(b.detected_at);
  return {
    board_initial: `To: Data Protection Board of India\nSubject: Intimation of personal data breach (DPDP Rules 2025, Rule 7(2)(a))\n\nData Fiduciary: ${c.legal_name}${c.address ? ', ' + c.address : ''}\nContact: ${c.officer || '[name]'}, ${c.officer_email || '[email]'}, ${c.officer_phone || '[phone]'}\n\nNature of the breach: ${b.description}\nExtent (people / data affected): ${b.people_affected ?? '[number]'} people; ${b.data_affected || '[which data]'}\nTiming: detected ${when} IST\nLocation: [system / place]\nLikely impact: ${b.risk} risk. [describe]\n\nA detailed report will follow within 72 hours.`,
    board_report: `To: Data Protection Board of India\nSubject: Detailed report on personal data breach (Rule 7(2)(b)), detected ${when} IST\n\n1. Updated description: ${b.description}\n2. Broad facts, events and reasons: [what happened, how it was found]\n3. Mitigation measures taken: ${b.actions || '[actions]'}\n4. Who caused it (if known): [unknown / details]\n5. Steps to stop it happening again: [measures]\n6. Report on intimations to affected persons: ${b.notified_people_at ? 'sent on ' + fmtDateTime(b.notified_people_at) + ' IST' : '[date, method, number of persons]'}\n\n${c.legal_name}\n${c.officer || '[name]'}, ${c.officer_email || '[email]'}`,
    person: `Subject: Important: a security incident involving your personal data\n\nDear [name],\n\nOn ${when} IST we found a security incident that may involve your personal data (${b.data_affected || '[which data]'}).\n\nWhat happened: ${b.description}\nWhat it may mean for you: [likely consequences, e.g. misuse of your passport copy]\nWhat we have done: ${b.actions || '[actions]'}\nWhat you can do: [e.g. watch for suspicious calls or emails, change your portal password]\n\nContact: ${c.officer || 'our Grievance Officer'}, ${c.officer_email || '[email]'}${c.officer_phone ? ', ' + c.officer_phone : ''}\n\n${c.legal_name}`,
  };
}

/** Notices to new leads every 10 minutes; cold-lead erasure once a day when switched on. */
export function startDpdpJobs() {
  setInterval(() => { autoNotices().catch((e) => console.error('[dpdp notices]', e)); }, 10 * 60e3).unref();
  setInterval(async () => {
    try {
      if ((await coldMonths()) && istDate() !== (await getSetting('retention_cold_last_run'))) { await setSetting('retention_cold_last_run', istDate()); await runRetention(); }
    } catch (e) { console.error('[dpdp retention]', e); }
  }, 60 * 60e3).unref();
}
