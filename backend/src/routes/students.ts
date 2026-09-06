import { Router, Response } from 'express';
import mongoose from 'mongoose';
import Student, { IStudent } from '../models/Student';
import Conversation from '../models/Conversation';
import Message from '../models/Message';
import User from '../models/User';
import { authenticate, can, AuthRequest } from '../middleware/auth';
import { getIo } from '../socket/emitter';
import { portalScope, portalAccountForStudent } from '../services/accounts';

const router = Router();

/** Normalises whatever the client sent into a list of distinct id strings. */
function idList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  const ids = raw
    .map((v) => (v && typeof v === 'object' ? (v as { _id?: unknown })._id : v))
    .map((v) => String(v ?? ''))
    .filter((v) => mongoose.Types.ObjectId.isValid(v));
  return [...new Set(ids)];
}

/**
 * Chat side-effects of a change to the counsellor roster:
 * - a conversation is opened (or un-archived) with every counsellor added
 * - the conversation with a counsellor removed is archived — history stays
 *   readable, sending is blocked
 * - system messages document both in the thread
 */
async function syncCounsellorConversations(
  student: IStudent,
  before: string[],
  after: string[],
  actor: { id: string; name: string },
): Promise<void> {
  const added   = after.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !after.includes(id));
  if (!added.length && !removed.length) return;
  if (!student.userId) return; // no portal account — nothing to do in chat
  const userId = student.userId.toString();
  const io = getIo();
  const touched = new Set<string>([userId]);

  for (const counsellorId of removed) {
    touched.add(counsellorId);
    const conv = await Conversation.findOne({
      participants: { $all: [userId, counsellorId], $size: 2 },
    });
    if (!conv || conv.archived) continue;
    const sys = await Message.create({
      conversationId: conv._id,
      senderId: actor.id,
      senderName: actor.name,
      type: 'system',
      text: 'Counsellor unassigned — this conversation is now closed. The history stays available.',
      readBy: [actor.id],
    });
    conv.archived = true;
    conv.set('lastMessage', { text: sys.text, senderId: sys.senderId, createdAt: new Date() });
    await conv.save();
    if (io) {
      io.to(conv._id.toString()).emit('receive_message', sys.toObject());
      io.to(conv._id.toString()).emit('conversation_archived', { conversationId: conv._id.toString() });
    }
  }

  for (const counsellorId of added) {
    touched.add(counsellorId);
    let conv = await Conversation.findOne({
      participants: { $all: [userId, counsellorId], $size: 2 },
    });
    if (conv) {
      if (conv.archived) { conv.archived = false; await conv.save(); }
    } else {
      conv = await Conversation.create({ participants: [userId, counsellorId], studentId: student._id });
    }
    const counsellor = await User.findById(counsellorId).select('name');
    const sys = await Message.create({
      conversationId: conv._id,
      senderId: actor.id,
      senderName: actor.name,
      type: 'system',
      text: `${counsellor?.name ?? 'A counsellor'} is now working on this case.`,
      readBy: [actor.id],
    });
    conv.set('lastMessage', { text: sys.text, senderId: sys.senderId, createdAt: new Date() });
    await conv.save();
    if (io) io.to(conv._id.toString()).emit('receive_message', sys.toObject());
  }

  // Nudge everyone involved to refresh their conversation lists
  if (io) for (const uid of touched) io.to(`user:${uid}`).emit('conversations_changed');
}

/** Tells the counsellors added, and the student, that the roster changed. */
async function announceCounsellorChange(
  student: IStudent,
  before: string[],
  after: string[],
): Promise<void> {
  const added = after.filter((id) => !before.includes(id));
  const { notify } = await import('../utils/notify');

  if (added.length) {
    await notify(added, {
      type:  'assignment',
      title: '👤 Student Assigned to You',
      body:  `${student.personal.name} has been assigned to you for counselling.`,
      link:  `/students/${student._id}`,
    });
  }

  const studentUser = await portalAccountForStudent(String(student._id));
  if (!studentUser) return;
  const names = await User.find({ _id: { $in: after } }).select('name');
  await notify([studentUser._id.toString()], {
    type:  'assignment',
    title: after.length ? '🤝 Counsellor Assigned' : '🔄 Counsellor Updated',
    body:  after.length
      ? `Your case is now with ${names.map((n) => n.name).join(', ')}. You can chat with them any time.`
      : 'Your counsellor assignment has been updated.',
  });
}

router.get('/', authenticate, can('students', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.stage) filter.stage = req.query.stage;

    // Counsellors work the whole book; `?counsellor=me` narrows it to their own.
    if (req.query.counsellor) {
      const who = req.query.counsellor === 'me' ? req.user?.id : String(req.query.counsellor);
      if (who && mongoose.Types.ObjectId.isValid(who)) filter.counsellors = new mongoose.Types.ObjectId(who);
    }

    if (req.user?.role === 'student') {
      const { studentId } = await portalScope(req.user.id);
      if (studentId) filter._id = new mongoose.Types.ObjectId(studentId);
      else { res.json([]); return; }
    } else if (req.user?.role === 'university') {
      const Application = (await import('../models/Application')).default;
      const { universityName } = await portalScope(req.user.id);
      if (!universityName) { res.json([]); return; }
      const apps = await Application.find({
        university: { $regex: universityName, $options: 'i' },
      }).select('studentId');
      const studentIds = [...new Set(apps.map(a => a.studentId.toString()))];
      filter._id = { $in: studentIds.map(id => new mongoose.Types.ObjectId(id)) };
    }

    const students = await Student.find(filter)
      .populate('counsellors', 'name email')
      .sort('-createdAt');
    res.json(students);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.post('/', authenticate, can('students', 'create'), async (req: AuthRequest, res: Response) => {
  if (req.user?.role === 'university') {
    res.status(403).json({ message: 'University users cannot create student records' }); return;
  }
  try {
    const body = { ...req.body };
    // Whoever enrols a student is working the case, so they go on the roster.
    const roster = idList(body.counsellors);
    if (req.user?.role === 'counsellor' && !roster.includes(req.user.id)) roster.push(req.user.id);
    body.counsellors = roster;

    const student = await Student.create(body);
    syncCounsellorConversations(student, [], roster, { id: req.user!.id, name: req.user!.name }).catch(() => {});
    announceCounsellorChange(student, [], roster.filter(id => id !== req.user!.id)).catch(() => {});
    res.status(201).json(await student.populate('counsellors', 'name email'));
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/**
 * A student holds `students.read` and `students.update` so the portal works —
 * but the module grant says *whether*, never *whose*. Without this the id in
 * the URL was the only thing deciding which record they reached, so any signed-in
 * student could read or edit any other student by guessing one.
 */
async function denyOtherStudentsRecord(req: AuthRequest, targetId: string): Promise<string | null> {
  if (req.user?.role !== 'student') return null;
  const { studentId } = await portalScope(req.user.id);
  if (!studentId) return 'This account is not linked to a student record';
  return studentId === String(targetId) ? null : 'You can only view your own record';
}

/**
 * What a student may change about themselves. Everything absent from this list
 * belongs to the people working the case — `stage` and `counsellors` above
 * all, which decide where the applicant sits in the pipeline.
 */
const STUDENT_SELF_FIELDS = ['personal', 'education', 'scores', 'passport', 'preferences'];

function stripFieldsStudentsCannotSet(req: AuthRequest, body: Record<string, unknown>) {
  if (req.user?.role !== 'student') return body;
  return Object.fromEntries(Object.entries(body).filter(([k]) => STUDENT_SELF_FIELDS.includes(k)));
}

/** GET /api/students/by-user/:userId — resolve a portal User to their Student record */
router.get('/by-user/:userId', authenticate, can('students', 'read'), async (req: AuthRequest, res: Response) => {
  if (req.user?.role === 'student' && req.params.userId !== req.user.id) {
    res.status(403).json({ message: 'You can only view your own record' });
    return;
  }
  try {
    const student = await Student.findOne({ userId: req.params.userId })
      .populate('counsellors', 'name email');
    if (!student) { res.status(404).json({ message: 'Student not found for user' }); return; }
    res.json(student);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.get('/:id', authenticate, can('students', 'read'), async (req: AuthRequest, res: Response) => {
  const denied = await denyOtherStudentsRecord(req, req.params.id);
  if (denied) { res.status(403).json({ message: denied }); return; }
  try {
    const student = await Student.findById(req.params.id).populate('counsellors', 'name email');
    if (!student) { res.status(404).json({ message: 'Student not found' }); return; }

    // University rep — only allow if student has an application to their institution
    if (req.user?.role === 'university') {
      const Application = (await import('../models/Application')).default;
      const { universityName } = await portalScope(req.user.id);
      if (!universityName) { res.status(403).json({ message: 'Access denied' }); return; }
      const app = await Application.findOne({
        studentId: student._id,
        university: { $regex: universityName, $options: 'i' },
      });
      if (!app) { res.status(403).json({ message: 'Access denied' }); return; }
    }

    res.json(student);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.put('/:id', authenticate, can('students', 'update'), async (req: AuthRequest, res: Response) => {
  if (req.user?.role === 'university') {
    res.status(403).json({ message: 'University users cannot modify student records' }); return;
  }
  const denied = await denyOtherStudentsRecord(req, req.params.id);
  if (denied) { res.status(403).json({ message: denied }); return; }
  req.body = stripFieldsStudentsCannotSet(req, req.body ?? {});
  if ('counsellors' in req.body) req.body.counsellors = idList(req.body.counsellors);
  try {
    const before = await Student.findById(req.params.id).select('counsellors');
    const student = await Student.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: false })
      .populate('counsellors', 'name email');
    if (!student) { res.status(404).json({ message: 'Student not found' }); return; }

    if ('counsellors' in req.body) {
      const was = idList(before?.counsellors);
      const now = idList(student.counsellors);
      syncCounsellorConversations(student, was, now, { id: req.user!.id, name: req.user!.name }).catch(() => {});
      announceCounsellorChange(student, was, now).catch(() => {});
    }
    res.json(student);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// PATCH alias (used by student portal)
router.patch('/:id', authenticate, can('students', 'update'), async (req: AuthRequest, res: Response) => {
  if (req.user?.role === 'university') {
    res.status(403).json({ message: 'University users cannot modify student records' }); return;
  }
  const denied = await denyOtherStudentsRecord(req, req.params.id);
  if (denied) { res.status(403).json({ message: denied }); return; }
  req.body = stripFieldsStudentsCannotSet(req, req.body ?? {});
  if ('counsellors' in req.body) req.body.counsellors = idList(req.body.counsellors);
  try {
    const before = await Student.findById(req.params.id).select('counsellors');
    const student = await Student.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: false })
      .populate('counsellors', 'name email');
    if (!student) { res.status(404).json({ message: 'Student not found' }); return; }

    if ('counsellors' in req.body) {
      const was = idList(before?.counsellors);
      const now = idList(student.counsellors);
      syncCounsellorConversations(student, was, now, { id: req.user!.id, name: req.user!.name }).catch(() => {});
      announceCounsellorChange(student, was, now).catch(() => {});
    }
    res.json(student);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/**
 * A counsellor may put themselves on, or take themselves off, any case —
 * that is the whole point of a shared book. Anyone else on the roster is an
 * admin's call.
 */
function denyRosterEdit(req: AuthRequest, counsellorId: string): string | null {
  if (req.user?.role === 'admin') return null;
  if (req.user?.role !== 'counsellor') return 'Only counsellors and admins manage assignments';
  return req.user.id === counsellorId ? null : 'You can only assign or unassign yourself';
}

async function saveRoster(
  req: AuthRequest,
  res: Response,
  next: (was: string[]) => string[],
): Promise<void> {
  try {
    const current = await Student.findById(req.params.id).select('counsellors');
    if (!current) { res.status(404).json({ message: 'Student not found' }); return; }

    const was = idList(current.counsellors);
    const now = next(was);
    const student = await Student.findByIdAndUpdate(
      req.params.id,
      { counsellors: now },
      { new: true },
    ).populate('counsellors', 'name email');
    if (!student) { res.status(404).json({ message: 'Student not found' }); return; }

    syncCounsellorConversations(student, was, now, { id: req.user!.id, name: req.user!.name }).catch(() => {});
    announceCounsellorChange(student, was, now.filter(id => id !== req.user!.id)).catch(() => {});
    res.json(student);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
}

// POST /api/students/:id/counsellors — add one to the roster
router.post('/:id/counsellors', authenticate, can('students', 'update'), async (req: AuthRequest, res: Response) => {
  const counsellorId = String(req.body?.counsellorId ?? req.user?.id ?? '');
  if (!mongoose.Types.ObjectId.isValid(counsellorId)) {
    res.status(400).json({ message: 'A counsellor id is required' }); return;
  }
  const denied = denyRosterEdit(req, counsellorId);
  if (denied) { res.status(403).json({ message: denied }); return; }

  const counsellor = await User.findOne({ _id: counsellorId, role: 'counsellor', isActive: true }).select('_id');
  if (!counsellor) { res.status(400).json({ message: 'Not an active counsellor' }); return; }

  await saveRoster(req, res, was => (was.includes(counsellorId) ? was : [...was, counsellorId]));
});

// DELETE /api/students/:id/counsellors/:counsellorId — take one off
router.delete('/:id/counsellors/:counsellorId', authenticate, can('students', 'update'), async (req: AuthRequest, res: Response) => {
  const { counsellorId } = req.params;
  const denied = denyRosterEdit(req, counsellorId);
  if (denied) { res.status(403).json({ message: denied }); return; }
  await saveRoster(req, res, was => was.filter(id => id !== counsellorId));
});

router.delete('/:id', authenticate, can('students', 'delete'), async (req: AuthRequest, res: Response) => {
  if (req.user?.role === 'university') {
    res.status(403).json({ message: 'University users cannot delete student records' }); return;
  }
  try {
    await Student.findByIdAndDelete(req.params.id);
    res.json({ message: 'Student deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

export default router;
