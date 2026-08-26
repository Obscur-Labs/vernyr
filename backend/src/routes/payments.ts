import { Router, Response } from 'express';
import Payment from '../models/Payment';
import { authenticate, can, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, can('finance', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.studentId) filter.studentId = req.query.studentId;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.type) filter.type = req.query.type;
    const payments = await Payment.find(filter)
      .populate('studentId', 'personal')
      .populate('createdBy', 'name email')
      .sort('-createdAt');
    res.json(payments);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.post('/', authenticate, can('finance', 'create'), async (req: AuthRequest, res: Response) => {
  try {
    const payment = await Payment.create({ ...req.body, createdBy: req.user!.id });
    res.status(201).json(payment);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.get('/:id', authenticate, can('finance', 'read'), async (req, res: Response) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate('studentId', 'personal')
      .populate('createdBy', 'name email');
    if (!payment) { res.status(404).json({ message: 'Payment not found' }); return; }
    res.json(payment);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.put('/:id', authenticate, can('finance', 'update'), async (req, res: Response) => {
  try {
    const payment = await Payment.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('studentId', 'personal');
    if (!payment) { res.status(404).json({ message: 'Payment not found' }); return; }
    res.json(payment);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.delete('/:id', authenticate, can('finance', 'delete'), async (req, res: Response) => {
  try {
    await Payment.findByIdAndDelete(req.params.id);
    res.json({ message: 'Payment deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

export default router;
