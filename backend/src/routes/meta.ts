import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import User from '../models/User';
import University from '../models/University';
import Course from '../models/Course';
import { Country, Intake, MasterItem } from '../models/Master';
import { ensureMasters, stageList } from '../services/masters';
import { permsFor, ROLE_NAMES, clientRole } from '../config/clientPerms';
import { serverError } from '../utils/httpError';

/** The client's `/api/meta` (everything the dropdowns need) and `/api/me`, in the client's JSON shape. */
const router = Router();

const id = (d: { _id: unknown }) => String(d._id);

async function publicUser(userId: string) {
  const u = await User.findById(userId).lean();
  if (!u) return null;
  const role = clientRole(u.role);
  return {
    id: id(u), name: u.name, username: u.username ?? null, email: u.email ?? null, mobile: u.phone ?? null,
    role, role_name: ROLE_NAMES[role], has_photo: !!u.avatar, super_admin: false, console: [] as string[],
  };
}

router.get('/me', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const me = await publicUser(req.user!.id);
    if (!me) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(me);
  } catch (err) { serverError(res, err); }
});

router.get('/meta', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await ensureMasters();
    const [items, countries, intakes, unis, courses, users, appStages, visaStages, me] = await Promise.all([
      MasterItem.find({ type: { $nin: ['app_stage', 'visa_stage'] } }).sort({ type: 1, sort: 1, name: 1 }).lean(),
      Country.find().sort({ sort: 1, name: 1 }).lean(),
      Intake.find().sort({ year: 1, month: 1 }).lean(),
      University.find().sort({ name: 1 }).lean(),
      Course.find().select('name university level discipline duration tuition applicationFee link deadline isActive').sort({ name: 1 }).lean(),
      User.find().select('name email role isActive').sort({ name: 1 }).lean(),
      stageList('app_stage'), stageList('visa_stage'), publicUser(req.user!.id),
    ]);
    const masters: Record<string, unknown[]> = {};
    for (const i of items) (masters[i.type] ??= []).push({ id: id(i), code: i.code ?? null, name: i.name, active: i.active, ...(i.data ?? {}) });
    const countryId = new Map(countries.map((c) => [c.name.toLowerCase(), id(c)]));
    res.json({
      user: me,
      masters,
      countries: countries.map((c) => ({ id: id(c), name: c.name, code: c.code, active: c.active, dependant_visa: c.dependant_visa, dependant_notes: c.dependant_notes, currency: c.currency, aps_required: c.aps_required })),
      universities: unis.map((u) => ({ id: id(u), name: u.name, country_id: countryId.get(String(u.country).toLowerCase()) ?? null, city: u.city ?? null, active: u.isActive !== false, approved: true, type: u.type, website: u.website ?? null })),
      courses: courses.map((c) => ({ id: id(c), name: c.name, university_id: String(c.university), level: c.level, field: c.discipline ?? null, duration: c.duration?.text ?? null,
        tuition_fee: c.tuition?.amount ?? null, currency: c.tuition?.currency ?? null, application_fee: c.applicationFee?.amount ?? null, course_link: c.link ?? null, active: c.isActive !== false, approved: true })),
      intakes: intakes.map((i) => ({ id: id(i), name: i.name, month: i.month, year: i.year, active: i.active })),
      users: users.map((u) => ({ id: id(u), name: u.name, email: u.email ?? null, status: u.isActive === false ? 'inactive' : 'active', role: clientRole(u.role) })),
      app_stages: appStages,
      visa_stages: visaStages,
      settings: { session_timeout_min: 30, max_file_mb: 10, batching_window_min: 2, hard_cc: 'laeuropaapplication@gmail.com' },
      perms: permsFor(req.user!.role),
    });
  } catch (err) { serverError(res, err); }
});

export default router;
