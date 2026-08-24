import { Router, Response } from 'express';
import Lead from '../models/Lead';
import Student from '../models/Student';
import User from '../models/User';
import { authenticate, AuthRequest } from '../middleware/auth';
import { notify } from '../utils/notify';

const router = Router();

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.assignedTo) filter.assignedTo = req.query.assignedTo;
    if (req.user?.role === 'counsellor') filter.assignedTo = req.user.id;
    const leads = await Lead.find(filter).populate('assignedTo', 'name email').sort('-createdAt');
    res.json(leads);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const lead = await Lead.create({ ...req.body, assignedTo: req.body.assignedTo || req.user!.id });
    res.status(201).json(lead);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.get('/:id', authenticate, async (req, res: Response) => {
  try {
    const lead = await Lead.findById(req.params.id).populate('assignedTo', 'name email');
    if (!lead) { res.status(404).json({ message: 'Lead not found' }); return; }
    res.json(lead);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // Capture pre-update state for conversion detection
    const previous = await Lead.findById(req.params.id).lean();

    const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('assignedTo', 'name email');
    if (!lead) { res.status(404).json({ message: 'Lead not found' }); return; }

    // ── Auto-convert to Student when status flips to closed_won ─────────────
    const isNewConversion =
      lead.status === 'closed_won' &&
      previous?.status !== 'closed_won' &&
      !lead.convertedStudentId;

    if (isNewConversion) {
      // Build student record from lead data
      const counsellorId = previous?.assignedTo?.toString();
      const student = await Student.create({
        stage: 'inquiry',
        personal: {
          name:  lead.name,
          email: lead.email,
          phone: lead.phone,
        },
        preferences: {
          countries:    lead.intendedCountry ? [lead.intendedCountry] : [],
          universities: [],
          courses:      lead.intendedCourse  ? [lead.intendedCourse]  : [],
          intake:       lead.intakeSemester  || undefined,
        },
        assignedCounsellor: counsellorId || undefined,
        notes: lead.notes,
      });

      // Store the link on the lead (keep lead data intact)
      await Lead.findByIdAndUpdate(lead._id, { convertedStudentId: student._id });
      (lead as unknown as Record<string, unknown>).convertedStudentId = student._id;

      // Notify counsellor + all admins/managers
      const admins = await User.find({
        role: 'admin',
        isActive: true,
      }).select('_id');
      const notifyIds = admins.map(u => u._id.toString());
      if (counsellorId && !notifyIds.includes(counsellorId)) notifyIds.push(counsellorId);

      await notify(notifyIds, {
        type:  'lead_converted',
        title: '🎓 Lead Converted to Student',
        body:  `${lead.name} has been converted to a student and is ready for counselling.`,
        link:  `/students/${student._id}`,
      });
    }
    // ────────────────────────────────────────────────────────────────────────

    res.json(lead);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// Leads are never deleted — only close them as closed_lost to preserve history.
// This endpoint exists for admin hard-deletes only.
router.delete('/:id', authenticate, async (req, res: Response) => {
  try {
    await Lead.findByIdAndDelete(req.params.id);
    res.json({ message: 'Lead deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

export default router;
