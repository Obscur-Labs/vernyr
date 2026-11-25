import { Router, Response } from 'express';
import Payment from '../models/Payment';
import { authenticate, can, AuthRequest } from '../middleware/auth';
import { isPortalStudent, ownsStudentRow, scopeToOwnStudent } from '../services/scope';
import { serverError } from '../utils/httpError';
import { scalar } from '../utils/query';

const router = Router();

router.get('/', authenticate, can('finance', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const filter: Record<string, unknown> = {};
    for (const key of ['studentId', 'status', 'type'] as const) {
      const value = scalar(req.query[key]);
      if (value) filter[key] = value;
    }
    // The student seat holds `finance.read` for its own fee page only.
    if (!(await scopeToOwnStudent(req, filter))) { res.json([]); return; }
    const payments = await Payment.find(filter)
      .populate('studentId', 'personal')
      .populate('createdBy', 'name email')
      .sort('-createdAt');
    res.json(payments);
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/', authenticate, can('finance', 'create'), async (req: AuthRequest, res: Response) => {
  try {
    if (isPortalStudent(req)) { res.status(403).json({ message: 'Forbidden' }); return; }
    const payment = await Payment.create({ ...req.body, createdBy: req.user!.id });
    res.status(201).json(payment);
  } catch (err) {
    serverError(res, err);
  }
});

router.get('/:id', authenticate, can('finance', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate('studentId', 'personal')
      .populate('createdBy', 'name email');
    if (!payment) { res.status(404).json({ message: 'Payment not found' }); return; }
    if (!(await ownsStudentRow(req, payment.studentId?._id ?? payment.studentId))) {
      res.status(403).json({ message: 'Access denied' }); return;
    }
    res.json(payment);
  } catch (err) {
    serverError(res, err);
  }
});

router.put('/:id', authenticate, can('finance', 'update'), async (req: AuthRequest, res: Response) => {
  try {
    if (isPortalStudent(req)) { res.status(403).json({ message: 'Forbidden' }); return; }
    const payment = await Payment.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('studentId', 'personal');
    if (!payment) { res.status(404).json({ message: 'Payment not found' }); return; }
    res.json(payment);
  } catch (err) {
    serverError(res, err);
  }
});

router.delete('/:id', authenticate, can('finance', 'delete'), async (req: AuthRequest, res: Response) => {
  try {
    if (isPortalStudent(req)) { res.status(403).json({ message: 'Forbidden' }); return; }
    await Payment.findByIdAndDelete(req.params.id);
    res.json({ message: 'Payment deleted' });
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
