import { Router } from 'express';
import { Types } from 'mongoose';
import QRCode from 'qrcode';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { authenticate, staffOnly, type AuthRequest } from '../middleware/auth';
import User from '../models/User';
import Student from '../models/Student';
import Lead from '../models/Lead';
import Task from '../models/Task';
import { Timeline } from '../models/Timeline';
import { Application, VisaCase } from '../models/Work';
import University from '../models/University';
import { HttpError, handle, oid, fullName, hmac } from '../services/crm';
import { stageList } from '../services/masters';
import { getSetting } from '../models/Audit';
import { env } from '../config/env';

/** The client's Counsellors overview (Admin / Manager) and the office walk-in QR (legacy/server/routes/counsellors.js). */
const router = Router();
router.use(authenticate);
router.use(['/counsellors', '/walkin-qr'], staffOnly);

const guard = (req: AuthRequest) => { if (!['admin', 'manager'].includes(req.user!.role)) throw new HttpError(403, 'Only Admin and Manager can see the counsellors overview'); };
const OFFER = ['conditional_offer', 'unconditional_offer', 'offer_accepted'];
const APPLIED = ['applied', 'under_review', 'interview'];
const CLOSED = ['rejected', 'withdrawn', 'offer_declined'];

async function stats(uid: Types.ObjectId) {
  const mine = await Student.distinct('_id', { is_deleted: false, primary_counsellor_id: uid });
  const apps = (f: Record<string, unknown>) => Application.countDocuments({ is_deleted: false, student_id: { $in: mine }, ...f });
  const last = await Timeline.findOne({ user_id: uid }).sort({ createdAt: -1 }).select('createdAt').lean();
  return {
    students: mine.length,
    leads: await Lead.countDocuments({ is_deleted: false, assigned_user_id: uid, status: { $nin: ['Converted', 'Not interested'] } }),
    applications: await apps({}), applied: await apps({ stage: { $in: APPLIED } }), offers: await apps({ stage: { $in: OFFER } }),
    tuition_paid: await apps({ stage: { $in: ['tuition_paid', 'enrolment_confirmed'] } }),
    visa_approved: await VisaCase.countDocuments({ is_deleted: false, stage: 'approved', student_id: { $in: mine } }),
    enrolled: await Student.countDocuments({ is_deleted: false, primary_counsellor_id: uid, status: 'Enrolled' }),
    open_tasks: await Task.countDocuments({ is_deleted: false, assigned_to: uid, status: { $in: ['Open', 'In progress'] } }),
    overdue_tasks: await Task.countDocuments({ is_deleted: false, assigned_to: uid, status: { $in: ['Open', 'In progress'] }, due_at: { $lt: new Date() } }),
    last_activity: last?.createdAt ?? null,
  };
}
const counsellors = async () => (await User.find({ role: 'counsellor' }).sort({ name: 1 }).lean())
  .map((u) => ({ id: String(u._id), name: u.name, staff_code: u.staff_code ?? null, designation: u.designation ?? null, status: u.isActive === false ? 'inactive' : 'active', last_login_at: u.lastSeenAt ?? null, _id: u._id }));

router.get('/counsellors', handle(async (req, res) => {
  guard(req);
  const list = await counsellors();
  res.json({ rows: await Promise.all(list.map(async ({ _id, ...u }) => ({ ...u, ...(await stats(_id as Types.ObjectId)) }))) });
}));

router.get('/counsellors/:id', handle(async (req, res) => {
  guard(req);
  const u = (await counsellors()).find((x) => x.id === req.params.id);
  if (!u) throw new HttpError(404, 'Counsellor not found');
  const [stages, vstages, unis] = await Promise.all([stageList('app_stage'), stageList('visa_stage'), University.find().select('name').lean()]);
  const order = (code: string) => stages.find((s) => s.code === code)?.sort ?? 0;
  const sname = (code: string, list = stages) => list.find((s) => s.code === code)?.name ?? code;
  const students = await Student.find({ is_deleted: false, primary_counsellor_id: u._id }).sort({ updatedAt: -1 }).lean();
  const rows = await Promise.all(students.map(async (s) => {
    const apps = await Application.find({ student_id: s._id, is_deleted: false }).lean();
    const live = apps.filter((a) => !CLOSED.includes(a.stage));
    const best = [...live].sort((a, b) => order(b.stage) - order(a.stage))[0];
    const v = await VisaCase.findOne({ student_id: s._id, is_deleted: false }).sort({ createdAt: -1 }).lean();
    const step = s.status === 'Enrolled' ? 'Enrolled' : v ? `Visa: ${sname(v.stage, vstages)}` : best ? sname(best.stage) : apps.length ? 'Applications closed' : 'No application yet';
    const last = await Timeline.findOne({ student_id: s._id }).sort({ createdAt: -1 }).select('createdAt').lean();
    return { id: String(s._id), student_code: s.student_code, name: fullName(s), status: s.status, applications: apps.length, open_applications: live.length, step,
      university: best ? unis.find((x) => String(x._id) === String(best.university_id))?.name ?? null : null, application_code: best?.application_code ?? null,
      last_update: last?.createdAt ?? s.updatedAt };
  }));
  const leads = (await Lead.find({ is_deleted: false, assigned_user_id: u._id, status: { $nin: ['Converted', 'Not interested'] } }).sort({ createdAt: -1 }).limit(200).lean())
    .map((l) => ({ id: String(l._id), code: l.lead_code, name: [l.first_name, l.last_name].filter(Boolean).join(' '), status: l.status, next_followup_at: l.next_followup_at ?? null, created_at: l.createdAt }));
  const { _id, ...counsellor } = u;
  res.json({ counsellor: { ...counsellor, ...(await stats(_id as Types.ObjectId)) }, students: rows, leads });
}));

// Walk-in QR: ONE general QR for the office. The student scans it, signs up on the portal and becomes a lead
// (source Walk-in). It carries a signed key, so it works even when public sign-up is closed.
const walkinKey = () => hmac('walkin-qr').slice(0, 16);
const walkinUrl = () => `${env.portalUrl}/register?src=walkin&k=${walkinKey()}`;
router.get('/walkin-qr', handle(async (_req, res) => {
  const url = walkinUrl();
  const png = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 640, color: { dark: '#0B1020', light: '#FFFFFF' } });
  res.json({ url, png, signup_open: (await getSetting('portal_signup')) !== '0' });
}));
// the whole card (heading, text, QR) for an A4 table standee (PDF) or sharing (PNG)
router.get('/walkin-qr/card.:format', handle(async (req, res) => {
  const url = walkinUrl();
  const qr = await QRCode.toBuffer(url, { errorCorrectionLevel: 'M', margin: 1, width: 900, color: { dark: '#0B1020', light: '#FFFFFF' } });
  if (req.params.format === 'png') {
    res.setHeader('Content-Type', 'image/png'); res.setHeader('Content-Disposition', 'attachment; filename="La-Europa-walk-in-QR.png"'); res.send(qr); return;
  }
  if (req.params.format !== 'pdf') throw new HttpError(404, 'Not found');
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.043, 0.063, 0.125), indigo = rgb(0.357, 0.337, 0.914);
  const centre = (text: string, y: number, size: number, f = font, color = ink) => page.drawText(text, { x: (595.28 - f.widthOfTextAtSize(text, size)) / 2, y, size, font: f, color });
  centre('Welcome to La Europa Education', 760, 26, bold);
  centre('Scan to create your student account and start your study abroad file', 728, 13, font, indigo);
  const img = await pdf.embedPng(qr);
  page.drawImage(img, { x: (595.28 - 380) / 2, y: 300, width: 380, height: 380 });
  centre('Scan with your phone camera', 250, 15, bold);
  centre('Your counsellor will contact you right away', 226, 12);
  centre(url, 90, 8);
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'attachment; filename="La-Europa-walk-in-QR-A4-standee.pdf"');
  res.send(Buffer.from(await pdf.save()));
}));

export { walkinKey };
export default router;
