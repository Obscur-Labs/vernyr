import { Router, Response } from 'express';
import Visa from '../models/Visa';
import { authenticate, can, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/', authenticate, can('visa', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.studentId) filter.studentId = req.query.studentId;
    if (req.query.stage) filter.stage = req.query.stage;
    if (req.query.country) filter.country = req.query.country;
    const visas = await Visa.find(filter)
      .populate('studentId', 'personal')
      .sort('-createdAt');
    res.json(visas);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.post('/', authenticate, can('visa', 'create'), async (req: AuthRequest, res: Response) => {
  try {
    const visa = await Visa.create(req.body);
    res.status(201).json(visa);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.get('/:id', authenticate, can('visa', 'read'), async (req, res: Response) => {
  try {
    const visa = await Visa.findById(req.params.id).populate('studentId', 'personal');
    if (!visa) { res.status(404).json({ message: 'Visa record not found' }); return; }
    res.json(visa);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.put('/:id', authenticate, can('visa', 'update'), async (req, res: Response) => {
  try {
    const visa = await Visa.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('studentId', 'personal');
    if (!visa) { res.status(404).json({ message: 'Visa record not found' }); return; }
    res.json(visa);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.delete('/:id', authenticate, can('visa', 'delete'), async (req, res: Response) => {
  try {
    await Visa.findByIdAndDelete(req.params.id);
    res.json({ message: 'Visa record deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

export default router;
