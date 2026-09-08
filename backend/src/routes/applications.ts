import { Router, Response } from 'express';
import Application from '../models/Application';
import { authenticate, can, AuthRequest } from '../middleware/auth';
import { portalScope } from '../services/accounts';
import { isPortalStudent, ownsStudentRow, scopeToOwnStudent } from '../services/scope';
import { serverError } from '../utils/httpError';
import { scalar } from '../utils/query';

const router = Router();

/** Resolve the universityName for a university-role caller. */
async function getUniversityScope(userId: string): Promise<string | null> {
  const { universityName } = await portalScope(userId);
  return universityName ?? null;
}

router.get('/', authenticate, can('applications', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const filter: Record<string, unknown> = {};
    for (const key of ['studentId', 'status', 'country'] as const) {
      const value = scalar(req.query[key]);
      if (value) filter[key] = value;
    }

    // A student sees their own applications, and no one else's.
    if (!(await scopeToOwnStudent(req, filter))) { res.json([]); return; }

    // University reps can only see applications addressed to their institution
    if (req.user?.role === 'university') {
      const uniName = await getUniversityScope(req.user.id);
      if (!uniName) { res.json([]); return; }
      filter.university = { $regex: uniName, $options: 'i' };
    }

    const applications = await Application.find(filter)
      .populate('studentId', 'personal')
      .sort('-createdAt');
    res.json(applications);
  } catch (err) {
    serverError(res, err);
  }
});

// University reps cannot create applications
router.post('/', authenticate, can('applications', 'create'), async (req: AuthRequest, res: Response) => {
  if (req.user?.role === 'university') {
    res.status(403).json({ message: 'University users cannot create applications' });
    return;
  }
  if (isPortalStudent(req)) {
    res.status(403).json({ message: 'Applications are filed by your counsellor' });
    return;
  }
  try {
    const application = await Application.create(req.body);
    res.status(201).json(application);
  } catch (err) {
    serverError(res, err);
  }
});

router.get('/:id', authenticate, can('applications', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const application = await Application.findById(req.params.id).populate('studentId', 'personal');
    if (!application) { res.status(404).json({ message: 'Application not found' }); return; }

    if (!(await ownsStudentRow(req, application.studentId?._id ?? application.studentId))) {
      res.status(403).json({ message: 'Access denied' }); return;
    }

    // University rep can only read applications for their institution
    if (req.user?.role === 'university') {
      const uniName = await getUniversityScope(req.user.id);
      if (!uniName || !application.university.toLowerCase().includes(uniName.toLowerCase())) {
        res.status(403).json({ message: 'Access denied' }); return;
      }
    }

    res.json(application);
  } catch (err) {
    serverError(res, err);
  }
});

router.put('/:id', authenticate, can('applications', 'update'), async (req: AuthRequest, res: Response) => {
  if (isPortalStudent(req)) { res.status(403).json({ message: 'Forbidden' }); return; }
  try {
    const existing = await Application.findById(req.params.id);
    if (!existing) { res.status(404).json({ message: 'Application not found' }); return; }

    // University rep can only update status of their institution's applications
    if (req.user?.role === 'university') {
      const uniName = await getUniversityScope(req.user.id);
      if (!uniName || !existing.university.toLowerCase().includes(uniName.toLowerCase())) {
        res.status(403).json({ message: 'Access denied' }); return;
      }
      // Only allow status updates — no other field changes
      const allowed = ['status', 'offerDate', 'notes'] as const;
      const update: Record<string, unknown> = {};
      for (const key of allowed) {
        if ((req.body as Record<string, unknown>)[key] !== undefined) {
          update[key] = (req.body as Record<string, unknown>)[key];
        }
      }
      const application = await Application.findByIdAndUpdate(req.params.id, update, { new: true })
        .populate('studentId', 'personal');
      res.json(application);
      return;
    }

    const application = await Application.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('studentId', 'personal');
    res.json(application);
  } catch (err) {
    serverError(res, err);
  }
});

// University reps cannot delete applications
router.delete('/:id', authenticate, can('applications', 'delete'), async (req: AuthRequest, res: Response) => {
  if (req.user?.role === 'university' || isPortalStudent(req)) {
    res.status(403).json({ message: 'You cannot delete applications' });
    return;
  }
  try {
    await Application.findByIdAndDelete(req.params.id);
    res.json({ message: 'Application deleted' });
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
