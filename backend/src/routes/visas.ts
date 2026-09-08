import { Router, Response } from 'express';
import Visa from '../models/Visa';
import { authenticate, can, AuthRequest } from '../middleware/auth';
import { isPortalStudent, ownsStudentRow, scopeToOwnStudent } from '../services/scope';
import { serverError } from '../utils/httpError';
import { scalar } from '../utils/query';

const router = Router();

router.get('/', authenticate, can('visa', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const filter: Record<string, unknown> = {};
    for (const key of ['studentId', 'stage', 'country'] as const) {
      const value = scalar(req.query[key]);
      if (value) filter[key] = value;
    }
    // The student seat holds `visa.read` for its own tracker only.
    if (!(await scopeToOwnStudent(req, filter))) { res.json([]); return; }
    const visas = await Visa.find(filter)
      .populate('studentId', 'personal')
      .sort('-createdAt');
    res.json(visas);
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/', authenticate, can('visa', 'create'), async (req: AuthRequest, res: Response) => {
  try {
    if (isPortalStudent(req)) { res.status(403).json({ message: 'Forbidden' }); return; }
    const visa = await Visa.create(req.body);
    res.status(201).json(visa);
  } catch (err) {
    serverError(res, err);
  }
});

router.get('/:id', authenticate, can('visa', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const visa = await Visa.findById(req.params.id).populate('studentId', 'personal');
    if (!visa) { res.status(404).json({ message: 'Visa record not found' }); return; }
    if (!(await ownsStudentRow(req, visa.studentId?._id ?? visa.studentId))) {
      res.status(403).json({ message: 'Access denied' }); return;
    }
    res.json(visa);
  } catch (err) {
    serverError(res, err);
  }
});

router.put('/:id', authenticate, can('visa', 'update'), async (req: AuthRequest, res: Response) => {
  try {
    if (isPortalStudent(req)) { res.status(403).json({ message: 'Forbidden' }); return; }
    const visa = await Visa.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('studentId', 'personal');
    if (!visa) { res.status(404).json({ message: 'Visa record not found' }); return; }
    res.json(visa);
  } catch (err) {
    serverError(res, err);
  }
});

router.delete('/:id', authenticate, can('visa', 'delete'), async (req: AuthRequest, res: Response) => {
  try {
    if (isPortalStudent(req)) { res.status(403).json({ message: 'Forbidden' }); return; }
    await Visa.findByIdAndDelete(req.params.id);
    res.json({ message: 'Visa record deleted' });
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
