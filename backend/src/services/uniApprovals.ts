import { Types } from 'mongoose';
import Course, { CourseChange } from '../models/Course';
import University from '../models/University';
import User from '../models/User';
import Student from '../models/Student';
import { Intake, MasterItem } from '../models/Master';
import { Application } from '../models/Work';
import { ApplicationRequest } from '../models/Portal';
import { Campus, CourseChangeRequest, Scholarship, UniProfileRequest } from '../models/Partner';
import { uploadBuffer, signedFileUrl } from '../config/cloudinary';
import { bad, clean, fieldErr, istDate } from './crm';
import { fmtDate } from './invoicePdf';
import { esc } from './email';
import { notify, notifyAdmins } from './tasks';
import { nextCourseUid } from './catalogue';
import { trigger } from './uemail';
import * as P from './partner';

/** The client's La Europa approvals (legacy/server/university/approvals.js): nothing a university submits goes live before approval. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
export const adminIds = async () => (await User.find({ role: 'admin', isActive: true }).select('_id').lean()).map((a) => a._id);
export const notifyStaff = notifyAdmins;

async function e39(x: Any, status: string, note: string | null | undefined, summary: string) {
  const admins = await P.usersOf(x.university_id, { roles: ['admin'] });
  const by = x.requested_by ? ((await (await import('../models/PortalAccount')).default.findById(x.requested_by).select('email').lean()) as Any) : null;
  const to = [by?.email, ...admins.map((y: Any) => y.email)].filter(Boolean);
  await trigger('E39', { to, university_id: x.university_id, ctx: { change_summary: summary, change_status: status.toLowerCase(), reject_reason_block: note ? `<p>${status === 'Rejected' ? 'Reason' : 'Note from La Europa'}: ${esc(note)}</p>` : '' }, link: '/courses' });
  await P.unotify([x.requested_by, ...admins.map((y: Any) => y._id)], `${summary}: ${status.toLowerCase()}${note ? ' - ' + note : ''}`, x.entity === 'scholarship' ? '/intakes' : x.entity === 'profile' ? '/profile' : '/courses');
}
const merge = (payload: Any, edits?: Any | null) => ({ ...payload, ...(edits || {}) });
const durationOf = (m: number) => (m % 12 === 0 ? `${m / 12} year${m > 12 ? 's' : ''}` : `${m} months`);

// ---------- courses ----------
export async function applyCourse(x: Any, p: Any, by: unknown) {
  if (p.archive) { await Course.updateOne({ _id: x.course_id }, { status: 'Archived', active: false, change_source: 'university' }); return x.course_id; }
  const campus = p.campus_id ? ((await Campus.findById(p.campus_id).lean()) as Any) : null;
  const field = p.field_of_study_id ? ((await MasterItem.findById(p.field_of_study_id).select('name').lean()) as Any)?.name : null;
  const f: Any = { university_id: x.university_id, name: p.name, level: p.level, field_of_study_id: p.field_of_study_id, field, campus_id: p.campus_id, city: campus?.city ?? null,
    duration_months: p.duration_months, duration: p.duration_months ? durationOf(p.duration_months) : null, language: p.language, course_link: p.course_link,
    tuition_fee: p.tuition_fee, currency: p.currency, tuition_fee_non_eu: null, fee_note: p.fee_note, application_fee: p.application_fee, application_fee_currency: p.application_fee_currency,
    university_course_code: p.university_course_code, description: p.description, seats_for_le: p.seats_for_le, uni_status: p.uni_status, note_for_le: p.note_for_le,
    status: p.uni_status === 'Closed' ? 'Hidden' : 'Published', active: true, approved: true, last_verified_on: istDate(), change_source: 'university',
    // the university states these itself, so the course no longer follows the university settings
    own_intakes: true, own_english: true, own_app_fee: true, own_academic: true };
  let c = x.course_id ? await Course.findById(x.course_id) : null;
  if (c) {
    const old = c.toObject() as Any;
    const changes = Object.keys(f).filter((k) => !['duration', 'last_verified_on'].includes(k) && String(old[k] ?? '') !== String(f[k] ?? ''))
      .map((k) => ({ course_id: c!._id, field: k, old_value: old[k] == null ? null : String(old[k]), new_value: f[k] == null ? null : String(f[k]), changed_by: by || undefined }));
    if (changes.length) await CourseChange.insertMany(changes);
    c.set({ ...f, updated_by: by || undefined });
  } else {
    const u = await University.findById(x.university_id).select('uni_code').lean();
    c = new Course({ ...f, course_uid: u?.uni_code ? await nextCourseUid(u as never) : undefined, created_by: by || undefined });
  }
  const english = (p.english ?? []).map((e: Any) => ({ test_type: e.test_type, min_overall: e.min_overall, min_band: e.min_band, moi_accepted: !!p.moi_accepted, min_12th_english_percent: p.min_12th_english_percent }));
  if (!english.length && p.moi_accepted) english.push({ test_type: null, moi_accepted: true, min_12th_english_percent: p.min_12th_english_percent });
  c.set('english', english);
  c.min_english = english.find((e: Any) => /IELTS/.test(e.test_type || ''))?.min_overall ?? null;
  c.set('academic', { required_level: p.required_level, min_percent: p.min_percent, note: p.academic_note, entrance_test: p.entrance_test && p.entrance_test !== 'None' ? p.entrance_test : null, min_work_months: p.min_work_months });
  // intakes keep their ids (applications point at them)
  const old = c.intakes ?? []; const changes: Any[] = []; const next: Any[] = [];
  for (const i of p.intakes ?? []) {
    const master = i.intake_id ? { _id: i.intake_id } : i.month && i.year ? await Intake.findOne({ month: i.month, year: i.year }).select('_id').lean() : null;
    const o = old.find((z: Any) => (i.id && String(z._id) === String(i.id)) || (master && String(z.intake_id) === String(master._id)) || (z.month && z.month === i.month && z.year === i.year)) as Any;
    const fi = { intake_id: master?._id ?? null, month: i.month, year: i.year, every_year: !!i.every_year, open_date: i.open_date, deadline: i.deadline, deadline_note: i.deadline_note, status: p.uni_status === 'Closed' ? 'Closed' : i.status, closed_reason: i.closed_reason };
    if (o) { if (o.deadline !== fi.deadline || (o.status || 'Open') !== fi.status) changes.push({ intake_id: fi.intake_id, deadline: fi.deadline, closed: fi.status === 'Closed' }); next.push({ _id: o._id, ...fi }); }
    else next.push(fi);
    if (!master && i.month && i.year) await notifyAdmins('university', `New intake ${i.month}/${i.year} used by a university course is not in the Intakes master`, '/admin/masters');
  }
  c.set('intakes', next);
  await c.save();
  // counsellors with affected applications or Apply Now requests (4.5)
  for (const ch of changes) {
    const apps = (await Application.find({ course_id: c._id, is_deleted: false, stage: { $in: ['documents_pending', 'ready_to_apply'] }, ...(ch.intake_id ? { intake_id: ch.intake_id } : {}) }).select('student_id').lean()) as Any[];
    const studs = (await Student.find({ _id: { $in: apps.map((a) => a.student_id) } }).select('primary_counsellor_id').lean()) as Any[];
    const reqs = (await ApplicationRequest.find({ course_id: c._id, status: { $in: ['Requested by student', 'In review', 'Info needed'] } }).lean()) as Any[];
    const reqStud = (await Student.find({ _id: { $in: reqs.map((q) => q.student_id).filter(Boolean) } }).select('primary_counsellor_id').lean()) as Any[];
    const iname = ch.intake_id ? ((await Intake.findById(ch.intake_id).select('name').lean()) as Any)?.name : null;
    const msg = `${ch.closed ? 'Intake closed' : 'Deadline changed'} for ${p.name}${iname ? ' ' + iname : ''}${ch.closed ? '' : ' to ' + fmtDate(ch.deadline)}`;
    for (const id of new Set([...studs, ...reqStud].map((s) => s.primary_counsellor_id).filter(Boolean).map(String))) await notify(id, 'university', msg, '/applications');
  }
  return c._id;
}
export async function approveCourse(reqId: unknown, admin: { id: string } | null, edits?: Any | null, opts: { note?: string; auto?: boolean } = {}) {
  const x = await CourseChangeRequest.findById(reqId);
  if (!x || x.status !== 'Pending approval') throw bad('This request is not waiting for approval');
  const p = merge(x.payload, edits);
  let target: unknown;
  if (x.entity === 'course') target = await applyCourse(x.toObject(), p, admin?.id);
  else if (x.entity === 'campus') target = await applyCampus(x.toObject(), p);
  else if (x.entity === 'scholarship') target = await applyScholarship(x.toObject(), p);
  const st = edits && Object.keys(edits).length ? 'Approved with edits' : 'Approved';
  x.set({ status: st, reviewed_by: admin?.id, reviewed_at: new Date(), review_note: opts.note || undefined, final: p, auto_approved: !!opts.auto, ...(x.entity === 'course' && !x.course_id ? { course_id: target } : {}) });
  await x.save();
  await e39(x.toObject(), opts.auto ? 'Approved' : st, opts.note, `${x.change_type}: ${p.name || ''}`);
  return target;
}
export async function rejectRequest(reqId: unknown, admin: { id: string }, reason: unknown) {
  if (!clean(reason)) throw fieldErr('reason', 'Reason is required (visible to the university)');
  const x = await CourseChangeRequest.findById(reqId);
  if (!x || x.status !== 'Pending approval') throw bad('This request is not waiting for approval');
  x.set({ status: 'Rejected', reviewed_by: admin.id, reviewed_at: new Date(), review_note: clean(reason, 500) }); await x.save();
  await e39(x.toObject(), 'Rejected', clean(reason, 500), `${x.change_type}: ${x.payload?.name || ''}`);
}
async function applyCampus(x: Any, p: Any) {
  if (p.is_main) await Campus.updateMany({ university_id: x.university_id }, { is_main: false });
  const f = { name: p.name, city: p.city, address: p.address, map_link: p.map_link, is_main: !!p.is_main, status: p.status };
  let id = x.course_id as Types.ObjectId | undefined; // a campus request keeps the campus id in course_id, as in the client
  if (id) await Campus.updateOne({ _id: id }, f); else id = (await Campus.create({ university_id: x.university_id, ...f }))._id;
  if (!(await Campus.exists({ university_id: x.university_id, is_main: true, is_deleted: false }))) await Campus.updateOne({ _id: id }, { is_main: true });
  return id;
}
async function applyScholarship(x: Any, p: Any) {
  const f = { name: p.name, description: p.description, benefit_type: p.benefit_type, amount: p.amount, currency: p.currency, percent: p.percent, min_percent: p.min_percent, other_criteria: p.other_criteria,
    applies: p.applies || {}, deadline: p.deadline, how_apply: p.how_apply, link: p.link, valid_until: p.valid_until, status: 'Live' };
  let id = x.scholarship_id;
  if (id) await Scholarship.updateOne({ _id: id }, f);
  else id = (await Scholarship.create({ university_id: x.university_id, code: `LE-SCH-${String((await Scholarship.countDocuments()) + 1).padStart(5, '0')}`, ...f }))._id;
  await syncScholarshipBadges(x.university_id);
  return id;
}
const applies = (s: Any, c: Any) => { const a = s.applies || {}; return !a.scope || a.scope === 'all' || (a.scope === 'levels' && (a.levels || []).includes(c.level)) || (a.scope === 'courses' && (a.courses || []).map(String).includes(String(c._id))); };
const liveScholarships = async (universityId: unknown) => {
  const today = istDate();
  return (await Scholarship.find({ university_id: universityId, status: 'Live', is_deleted: false, $and: [{ $or: [{ valid_until: null }, { valid_until: { $gte: today } }] }, { $or: [{ deadline: null }, { deadline: { $gte: today } }] }] }).lean()) as Any[];
};
/** "Scholarship available" badge = at least one Live scholarship applies (9.4) */
export async function syncScholarshipBadges(universityId: unknown) {
  const live = await liveScholarships(universityId);
  for (const c of (await Course.find({ university_id: universityId, is_deleted: false }).select('level scholarship_text').lean()) as Any[]) {
    const hit = live.find((s) => applies(s, c));
    await Course.updateOne({ _id: c._id }, { scholarship: !!hit, ...(hit ? { scholarship_text: hit.name } : {}) });
  }
}
export async function scholarshipsForCourse(course: Any) {
  return (await liveScholarships(course.university_id)).filter((s) => applies(s, course)).map((s) => ({ name: s.name, benefit: s.benefit_type === 'Fixed amount' ? `${s.amount} ${s.currency}` : s.benefit_type === 'Percentage of tuition' ? `${s.percent}% of tuition` : s.benefit_type,
    deadline: s.deadline, eligibility: [s.min_percent ? `Minimum ${s.min_percent}%` : null, s.other_criteria].filter(Boolean).join('. '), how: s.how_apply }));
}

// ---------- profile ----------
export async function approveProfile(reqId: unknown, admin: { id: string }, fields?: string[] | null, edits?: Any | null, note?: string | null) {
  const x = await UniProfileRequest.findById(reqId);
  if (!x || x.status !== 'Pending') throw bad('This request is not waiting for approval');
  const p = merge(x.payload, edits);
  const pick = (k: string) => !fields || !fields.length || fields.includes(k);
  const f: Any = {};
  for (const k of ['name', 'short_name', 'city', 'website', 'intl_page', 'about', 'founded_year', 'students_count', 'languages', 'rankings', 'accreditations', 'social']) if (pick(k) && p[k] !== undefined) f[k] = p[k];
  if (pick('uni_type') && p.uni_type) { f.uni_type = p.uni_type; f.type = p.uni_type; }
  if (pick('logo') && p.logo?.url) {
    // the logo moves from the request into the university (served by /api/logos/:id)
    const r = await fetch(signedFileUrl(p.logo.url, p.logo.public_id, 'image') || p.logo.url);
    if (r.ok) { const asset = await uploadBuffer({ buffer: Buffer.from(await r.arrayBuffer()), originalname: `logo-${Date.now()}.png`, mimetype: 'image/png', size: 0 } as Express.Multer.File, 'logos');
      Object.assign(f, { logo_url: asset.url, logo_public_id: asset.publicId, logo_updated_at: new Date(), logo_approved_by: admin.id, logo_approved_at: new Date() }); }
  }
  if (pick('cover') && p.cover) f.cover = p.cover;
  if (Object.keys(f).length) await University.updateOne({ _id: x.university_id }, f);
  const st = edits && Object.keys(edits).length ? 'Approved with edits' : 'Approved';
  x.set({ status: st, reviewed_by: admin.id, reviewed_at: new Date(), review_note: note || undefined, final: { ...p, approved_fields: fields || 'all' } }); await x.save();
  await e39({ ...x.toObject(), entity: 'profile' }, st, note, 'University profile');
}
export async function rejectProfile(reqId: unknown, admin: { id: string }, reason: unknown) {
  if (!clean(reason)) throw fieldErr('reason', 'Reason is required (visible to the university)');
  const x = await UniProfileRequest.findById(reqId); if (!x || x.status !== 'Pending') throw bad('This request is not waiting for approval');
  x.set({ status: 'Rejected', reviewed_by: admin.id, reviewed_at: new Date(), review_note: clean(reason, 500) }); await x.save();
  await e39({ ...x.toObject(), entity: 'profile' }, 'Rejected', clean(reason, 500), 'University profile');
}
