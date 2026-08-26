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

/**
 * Counsellor reassignment side-effects:
 * - the old counsellor↔student conversation is archived (history readable, sending blocked)
 * - a conversation with the new counsellor is created (or un-archived) so it
 *   shows up in both chat lists immediately
 * - system messages document the change in both threads
 */
async function handleCounsellorChange(
  student: IStudent,
  oldCounsellorId: string | undefined,
  newCounsellorId: string | undefined,
  actor: { id: string; name: string },
): Promise<void> {
  if ((oldCounsellorId ?? '') === (newCounsellorId ?? '')) return;
  if (!student.userId) return; // no portal account — nothing to do in chat
  const userId = student.userId.toString();
  const io = getIo();
  const touched = new Set<string>([userId]);

  // Close the old conversation
  if (oldCounsellorId) {
    touched.add(oldCounsellorId);
    const oldConv = await Conversation.findOne({
      participants: { $all: [userId, oldCounsellorId], $size: 2 },
    });
    if (oldConv && !oldConv.archived) {
      const sys = await Message.create({
        conversationId: oldConv._id,
        senderId: actor.id,
        senderName: actor.name,
        type: 'system',
        text: 'Counsellor reassigned — this conversation is now closed. The history stays available.',
        readBy: [actor.id],
      });
      oldConv.archived = true;
      oldConv.set('lastMessage', { text: sys.text, senderId: sys.senderId, createdAt: new Date() });
      await oldConv.save();
      if (io) {
        io.to(oldConv._id.toString()).emit('receive_message', sys.toObject());
        io.to(oldConv._id.toString()).emit('conversation_archived', { conversationId: oldConv._id.toString() });
      }
    }
  }

  // Open (or re-open) the conversation with the new counsellor
  if (newCounsellorId) {
    touched.add(newCounsellorId);
    let conv = await Conversation.findOne({
      participants: { $all: [userId, newCounsellorId], $size: 2 },
    });
    if (conv) {
      if (conv.archived) { conv.archived = false; await conv.save(); }
    } else {
      conv = await Conversation.create({ participants: [userId, newCounsellorId], studentId: student._id });
    }
    const newCounsellor = await User.findById(newCounsellorId).select('name');
    const sys = await Message.create({
      conversationId: conv._id,
      senderId: actor.id,
      senderName: actor.name,
      type: 'system',
      text: `${newCounsellor?.name ?? 'A new counsellor'} is now the assigned counsellor.`,
      readBy: [actor.id],
    });
    conv.set('lastMessage', { text: sys.text, senderId: sys.senderId, createdAt: new Date() });
    await conv.save();
    if (io) io.to(conv._id.toString()).emit('receive_message', sys.toObject());
  }

  // Nudge everyone involved to refresh their conversation lists
  if (io) for (const uid of touched) io.to(`user:${uid}`).emit('conversations_changed');
}

router.get('/', authenticate, can('students', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.stage) filter.stage = req.query.stage;

    if (req.user?.role === 'student') {
      const { studentId } = await portalScope(req.user.id);
      if (studentId) filter._id = new mongoose.Types.ObjectId(studentId);
      else { res.json([]); return; }
    } else if (req.user?.role === 'counsellor') {
      filter.assignedCounsellor = req.user.id;
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
      .populate('assignedCounsellor', 'name email')
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
    const student = await Student.create(req.body);
    res.status(201).json(student);
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
 * belongs to the people working the case — `stage` and `assignedCounsellor`
 * above all, which decide where the applicant sits in the pipeline.
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
      .populate('assignedCounsellor', 'name email');
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
    const student = await Student.findById(req.params.id).populate('assignedCounsellor', 'name email');
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
  try {
    const before = await Student.findById(req.params.id).select('assignedCounsellor');
    const student = await Student.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: false })
      .populate('assignedCounsellor', 'name email');
    if (!student) { res.status(404).json({ message: 'Student not found' }); return; }

    if ('assignedCounsellor' in req.body) {
      const newId = (student.assignedCounsellor as unknown as { _id?: mongoose.Types.ObjectId } | null)?._id?.toString();
      handleCounsellorChange(student, before?.assignedCounsellor?.toString(), newId, {
        id: req.user!.id, name: req.user!.name,
      }).catch(() => {});
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
  try {
    const before = await Student.findById(req.params.id).select('assignedCounsellor');
    const student = await Student.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: false })
      .populate('assignedCounsellor', 'name email');
    if (!student) { res.status(404).json({ message: 'Student not found' }); return; }

    if ('assignedCounsellor' in req.body) {
      const newId = (student.assignedCounsellor as unknown as { _id?: mongoose.Types.ObjectId } | null)?._id?.toString();
      handleCounsellorChange(student, before?.assignedCounsellor?.toString(), newId, {
        id: req.user!.id, name: req.user!.name,
      }).catch(() => {});
    }
    res.json(student);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// PATCH /api/students/:id/assign-counsellor  — admin only
router.patch('/:id/assign-counsellor', authenticate, can('students', 'update'), async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ message: 'Insufficient permissions' }); return;
  }
  const { counsellorId } = req.body;
  try {
    const before = await Student.findById(req.params.id).select('assignedCounsellor');
    const student = await Student.findByIdAndUpdate(
      req.params.id,
      { assignedCounsellor: counsellorId || null },
      { new: true },
    ).populate('assignedCounsellor', 'name email');
    if (!student) { res.status(404).json({ message: 'Student not found' }); return; }

    handleCounsellorChange(student, before?.assignedCounsellor?.toString(), counsellorId || undefined, {
      id: req.user!.id, name: req.user!.name,
    }).catch(() => {});

    const { notify } = await import('../utils/notify');

    // Notify the counsellor being assigned
    if (counsellorId) {
      await notify([counsellorId], {
        type:  'assignment',
        title: '👤 Student Assigned to You',
        body:  `${student.personal.name} has been assigned to you for counselling.`,
        link:  `/students/${student._id}`,
      });
    }

    const studentUser = await portalAccountForStudent(String(student._id));
    if (studentUser) {
      const counsellorDoc = student.assignedCounsellor as unknown as { name?: string } | null;
      const cName = counsellorDoc?.name ?? 'A counsellor';
      await notify([studentUser._id.toString()], {
        type:  'assignment',
        title: counsellorId ? '🤝 Counsellor Assigned' : '🔄 Counsellor Updated',
        body:  counsellorId
          ? `${cName} has been assigned as your counsellor. You can now chat with them.`
          : 'Your counsellor assignment has been updated.',
      });
    }

    res.json(student);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
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
