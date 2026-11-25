import { Router } from 'express';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { Appointment, MeetingPrefs, type IAppointment } from '../models/Appointment';
import User from '../models/User';
import Student from '../models/Student';
import Lead from '../models/Lead';
import PortalAccount from '../models/PortalAccount';
import { audit } from '../models/Audit';
import { bad, notFound, forbidden, handle, isAdmin, oid, clean, istDate, addDays, timeline, fmtTime } from '../services/crm';
import { studentNotify, sendSecurity } from '../services/email';

/** Meetings with the counsellor (legacy/server/appointments.js): weekly hours, the student picks a free slot and gives a reason, the counsellor accepts or declines. */

export const MODES = { online: 'Online', in_person: 'In person (office)' } as const;
const OPEN = ['Requested', 'Confirmed'];
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const istUtc = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00+05:30`);
const weekday = (ymd: string) => new Date(ymd + 'T00:00:00Z').getUTCDay();
const mins = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
const hmOf = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const when = (d: Date | string) => `${new Date(d).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}, ${fmtTime(d)} IST`;

export async function prefsOf(userId: unknown) {
  const p = await MeetingPrefs.findOne({ user_id: userId }).lean();
  return { slot_min: p?.slot_min ?? 30, notice_hours: p?.notice_hours ?? 12, days_ahead: p?.days_ahead ?? 21, meeting_link: p?.meeting_link ?? '', location: p?.location ?? '',
    accepting: p?.accepting ?? true, hours: p?.hours ?? [], time_off: p?.time_off ?? [] };
}

/** Free slots of a counsellor for one mode, grouped by day. A requested or confirmed slot is never offered again. */
export async function freeSlots(counsellorId: unknown, mode: 'online' | 'in_person') {
  const p = await prefsOf(counsellorId);
  if (!p.accepting) return [];
  const hours = p.hours.filter((h) => (mode === 'online' ? h.online : h.in_person));
  if (!hours.length) return [];
  const off = new Set(p.time_off.map((x) => x.date));
  const earliest = Date.now() + p.notice_hours * 3600e3;
  const busy = (await Appointment.find({ counsellor_id: counsellorId, status: { $in: OPEN }, end_at: { $gt: new Date() } }).select('start_at end_at').lean()).map((b) => [+b.start_at, +b.end_at]);
  const today = istDate();
  const out = [];
  for (let i = 0; i <= p.days_ahead; i++) {
    const ymd = addDays(today, i);
    if (off.has(ymd)) continue;
    const slots = [];
    for (const h of hours.filter((x) => x.weekday === weekday(ymd))) {
      for (let m = mins(h.start); m + p.slot_min <= mins(h.end); m += p.slot_min) {
        const s = +istUtc(ymd, hmOf(m)), e = s + p.slot_min * 60_000;
        if (s < earliest || busy.some(([a, b]) => s < b && e > a)) continue;
        slots.push({ start_at: new Date(s).toISOString(), time: hmOf(m), label: fmtTime(new Date(s)) });
      }
    }
    if (slots.length) out.push({ date: ymd, label: new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short' }),
      slots: slots.sort((a, b) => a.start_at.localeCompare(b.start_at)) });
  }
  return out;
}

export function ics(a: IAppointment, counsellorName: string) {
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: unknown) => String(s ?? '').replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => '\\' + c).replace(/\r?\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//La Europa Education//Vernyr//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', `UID:${a._id}@vernyr`, `DTSTAMP:${f(new Date())}`,
    `DTSTART:${f(a.start_at)}`, `DTEND:${f(a.end_at)}`, `SUMMARY:${esc(`Meeting with ${counsellorName} (La Europa Education)`)}`,
    `DESCRIPTION:${esc(`${MODES[a.mode]}. Reason: ${a.reason}${a.meeting_link ? `\nJoin: ${a.meeting_link}` : ''}`)}`, `LOCATION:${esc(a.mode === 'online' ? a.meeting_link : a.location)}`,
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

export async function out(a: IAppointment, forStaff = false) {
  const c = await User.findById(a.counsellor_id).select('name staff_code').lean();
  const r: Record<string, unknown> = { id: String(a._id), code: a.code, mode: a.mode, mode_label: MODES[a.mode], start_at: a.start_at, end_at: a.end_at, when: when(a.start_at), reason: a.reason,
    status: a.status, decline_reason: a.decline_reason ?? null, meeting_link: a.status === 'Confirmed' ? a.meeting_link ?? null : null, location: a.status === 'Confirmed' ? a.location ?? null : null,
    counsellor_note: a.counsellor_note ?? null, cancel_reason: a.cancel_reason ?? null, counsellor: c?.name ?? null, counsellor_id: c?.staff_code ?? null, past: +a.end_at < Date.now(), created_at: a.createdAt };
  if (forStaff) {
    const s = a.student_id ? await Student.findById(a.student_id).select('first_name last_name student_code').lean() : null;
    const l = !s && a.lead_id ? await Lead.findById(a.lead_id).select('first_name last_name lead_code').lean() : null;
    Object.assign(r, { person: s ? [s.first_name, s.last_name].filter(Boolean).join(' ') : l ? [l.first_name, l.last_name].filter(Boolean).join(' ') : '',
      person_code: s?.student_code ?? l?.lead_code ?? '', link: s ? `/students/${s._id}` : l ? `/leads/${l._id}` : '', meeting_link: a.meeting_link ?? null, location: a.location ?? null });
  }
  return r;
}

/** Portal notice + email to the student, with the calendar file once confirmed. */
export async function tellStudent(a: IAppointment, title: string, text: string) {
  if (!a.student_user_id) return;
  await studentNotify(a.student_user_id, title, '/appointments');
  const su = await PortalAccount.findById(a.student_user_id).select('email').lean();
  if (!su?.email) return;
  const cName = (await User.findById(a.counsellor_id).select('name').lean())?.name ?? 'your counsellor';
  await sendSecurity({ to: su.email, subject: title, student_id: a.student_id, lead_id: a.lead_id,
    text: `${text}\n\nMeeting ${a.code}: ${MODES[a.mode]}, ${when(a.start_at)}.\nReason you gave: ${a.reason}\n\nSee all your meetings in the La Europa student portal (Appointments).`,
    attachments: a.status === 'Confirmed' ? [{ filename: `meeting-${a.code}.ics`, content: ics(a, cName), contentType: 'text/calendar' }] : undefined }).catch(() => {});
}
export const timelineFor = (a: IAppointment, description: string, userId?: string) =>
  timeline({ student_id: a.student_id, lead_id: a.student_id ? undefined : a.lead_id, type: 'note', description, user_id: userId });

// ====================== CRM (counsellor) ======================
const router = Router();
router.use(authenticate);
async function loadAppt(req: AuthRequest) {
  const a = await Appointment.findById(oid(req.params.id));
  if (!a) throw notFound('Meeting');
  if (String(a.counsellor_id) !== req.user!.id && !isAdmin(req)) throw forbidden();
  return a;
}
router.get('/appointments', handle(async (req, res) => {
  const mine = !(isAdmin(req) && req.query.scope === 'all');
  const rows = await Promise.all((await Appointment.find(mine ? { counsellor_id: req.user!.id } : {}).sort({ start_at: -1 }).limit(300)).map((a) => out(a, true)));
  res.json({ rows, requested: rows.filter((r) => r.status === 'Requested' && !r.past).length, can_all: isAdmin(req) });
}));
router.get('/appointments/hours', handle(async (req, res) => {
  const p = await prefsOf(req.user!.id);
  const { hours, time_off, ...prefs } = p;
  res.json({ hours: [...hours].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)).map((h) => ({ ...h, day: DAYS[h.weekday] })), prefs,
    time_off: time_off.filter((x) => x.date >= istDate()).sort((a, b) => a.date.localeCompare(b.date)), days: DAYS });
}));
router.put('/appointments/hours', handle(async (req, res) => {
  const b = req.body ?? {};
  const errors: Record<string, string> = {};
  const hours = (Array.isArray(b.hours) ? b.hours : []).map((h: Record<string, unknown>, i: number) => {
    const wd = Number(h.weekday);
    const label = DAYS[wd] || `Row ${i + 1}`;
    if (!(wd >= 0 && wd <= 6)) errors['h' + i] = 'Day';
    if (!HM.test(String(h.start ?? '')) || !HM.test(String(h.end ?? '')) || String(h.start) >= String(h.end)) errors['h' + i] = `${label}: start must be before end (HH:MM)`;
    if (!h.online && !h.in_person) errors['h' + i] = `${label}: choose online and / or in person`;
    return { weekday: wd, start: String(h.start), end: String(h.end), online: !!h.online, in_person: !!h.in_person };
  });
  const p = b.prefs ?? {};
  const slot = Number(p.slot_min); if (![15, 20, 30, 45, 60].includes(slot)) errors.slot_min = 'Slot length: 15, 20, 30, 45 or 60 minutes';
  const notice = Number(p.notice_hours); if (!(notice >= 0 && notice <= 72)) errors.notice_hours = 'Notice: 0 to 72 hours';
  const ahead = Number(p.days_ahead); if (!(ahead >= 1 && ahead <= 60)) errors.days_ahead = 'Days ahead: 1 to 60';
  const link = clean(p.meeting_link, 300) ?? ''; if (link && !/^https:\/\//i.test(link)) errors.meeting_link = 'The meeting link must start with https://';
  if (Object.keys(errors).length) throw bad(Object.values(errors)[0], { errors });
  const today = istDate();
  const cur = await prefsOf(req.user!.id);
  const off = [...cur.time_off.filter((x) => x.date < today),
    ...(Array.isArray(b.time_off) ? b.time_off : []).filter((x: { date?: string }) => x && /^\d{4}-\d{2}-\d{2}$/.test(String(x.date))).map((x: { date: string; note?: string }) => ({ date: x.date, note: clean(x.note, 100) }))];
  await MeetingPrefs.updateOne({ user_id: req.user!.id }, { hours, slot_min: slot, notice_hours: notice, days_ahead: ahead, meeting_link: link || undefined,
    location: clean(p.location, 300), accepting: p.accepting !== false, time_off: off }, { upsert: true });
  await audit(req, 'Update', 'MeetingHours', req.user!.id, `${hours.length} time window(s), slot ${slot} min`);
  res.json({ ok: true });
}));
router.post('/appointments/:id/accept', handle(async (req, res) => {
  const a = await loadAppt(req);
  const b = req.body ?? {};
  if (a.status !== 'Requested') throw bad('Only a requested meeting can be accepted.');
  if (+a.start_at < Date.now()) throw bad('This time has already passed.');
  const p = await prefsOf(a.counsellor_id);
  const link = clean(b.meeting_link, 300) || p.meeting_link, loc = clean(b.location, 300) || p.location;
  if (a.mode === 'online' && !/^https:\/\//i.test(link || '')) throw bad('Add the online meeting link (https://...) for the student.', { errors: { meeting_link: 'Meeting link needed' } });
  if (a.mode === 'in_person' && !loc) throw bad('Add the office address for the student.', { errors: { location: 'Address needed' } });
  a.set({ status: 'Confirmed', meeting_link: a.mode === 'online' ? link : undefined, location: a.mode === 'in_person' ? loc : undefined, counsellor_note: clean(b.note, 300), decided_by: req.user!.id, decided_at: new Date() });
  await a.save();
  await tellStudent(a, `Meeting confirmed: ${when(a.start_at)}`, `Your counsellor ${req.user!.name} confirmed your meeting.${a.mode === 'online' ? `\nJoin online: ${a.meeting_link}` : `\nPlace: ${a.location}`}${a.counsellor_note ? `\nNote from your counsellor: ${a.counsellor_note}` : ''}`);
  await timelineFor(a, `Meeting ${a.code} confirmed by ${req.user!.name} (${MODES[a.mode]}, ${when(a.start_at)})`, req.user!.id);
  await audit(req, 'Update', 'Appointment', a._id, `${a.code} confirmed`);
  res.json({ ok: true, appointment: await out(a, true) });
}));
router.post('/appointments/:id/decline', handle(async (req, res) => {
  const a = await loadAppt(req);
  const reason = clean(req.body?.reason, 300);
  if (a.status !== 'Requested') throw bad('Only a requested meeting can be declined.');
  if (!reason) throw bad('Please tell the student why (and when would suit you).', { errors: { reason: 'Reason is required' } });
  a.set({ status: 'Declined', decline_reason: reason, decided_by: req.user!.id, decided_at: new Date() }); await a.save();
  await tellStudent(a, `Meeting request not accepted: ${when(a.start_at)}`, `Your counsellor ${req.user!.name} could not accept this time.\nReason: ${reason}\nYou can choose another time in the portal.`);
  await timelineFor(a, `Meeting ${a.code} declined by ${req.user!.name}: ${reason}`, req.user!.id);
  res.json({ ok: true });
}));
router.post('/appointments/:id/cancel', handle(async (req, res) => {
  const a = await loadAppt(req);
  const reason = clean(req.body?.reason, 300);
  if (a.status !== 'Confirmed' || +a.start_at < Date.now()) throw bad('Only an upcoming confirmed meeting can be cancelled.');
  if (!reason) throw bad('Please tell the student why.', { errors: { reason: 'Reason is required' } });
  a.set({ status: 'Cancelled', cancelled_by_type: 'counsellor', cancel_reason: reason, cancelled_at: new Date() }); await a.save();
  await tellStudent(a, `Meeting cancelled: ${when(a.start_at)}`, `Your counsellor ${req.user!.name} had to cancel this meeting.\nReason: ${reason}\nPlease choose another time in the portal.`);
  await timelineFor(a, `Meeting ${a.code} cancelled by ${req.user!.name}: ${reason}`, req.user!.id);
  res.json({ ok: true });
}));
router.post('/appointments/:id/outcome', handle(async (req, res) => {
  const a = await loadAppt(req);
  const st = req.body?.status;
  if (a.status !== 'Confirmed') throw bad('Only a confirmed meeting can be closed.');
  if (!['Completed', 'No-show'].includes(st)) throw bad('Completed or No-show');
  if (+a.start_at > Date.now()) throw bad('The meeting has not started yet.');
  const note = clean(req.body?.note, 300);
  a.set({ status: st, ...(note ? { counsellor_note: note } : {}) }); await a.save();
  await timelineFor(a, `Meeting ${a.code}: ${st}${note ? ` (${note.slice(0, 200)})` : ''}`, req.user!.id);
  res.json({ ok: true });
}));

export default router;
