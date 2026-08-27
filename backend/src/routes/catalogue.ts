import { Router, Response } from 'express';
import mongoose, { type FilterQuery } from 'mongoose';
import University from '../models/University';
import Course, { COURSE_LEVELS, type ICourse } from '../models/Course';
import {
  parseDeadline, parseDuration, parseExams, parseIntakes, parseMoney, slugify,
} from '../services/catalogue';
import { authenticate, can, AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * The course catalogue: country → university → course.
 *
 * Every list endpoint takes the same filter vocabulary, so the CRM's browser,
 * a university's own page and the student portal's future picker all read from
 * one query shape. Filters are additive and every one of them is optional.
 */

router.use(authenticate, can('courses', 'read'));

/* ── Query helpers ───────────────────────────────────────────────────────── */

/** `?level=masters,phd` and `?level=masters&level=phd` both arrive here. */
function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => list(v));
  if (typeof value !== 'string') return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SORTS: Record<string, Record<string, 1 | -1>> = {
  name:        { name: 1 },
  university:  { universityName: 1, name: 1 },
  country:     { country: 1, universityName: 1, name: 1 },
  tuition_asc: { 'tuition.amount': 1, name: 1 },
  tuition_desc:{ 'tuition.amount': -1, name: 1 },
  duration:    { 'duration.months': 1, name: 1 },
  newest:      { createdAt: -1 },
};

/** The one filter builder every course surface shares. */
function courseFilter(query: Record<string, unknown>): FilterQuery<ICourse> {
  const filter: FilterQuery<ICourse> = {};

  if (query.includeInactive !== 'true') filter.isActive = { $ne: false };

  const countries = list(query.country);
  if (countries.length) filter.country = { $in: countries };

  const levels = list(query.level).filter((l) => (COURSE_LEVELS as readonly string[]).includes(l));
  if (levels.length) filter.level = { $in: levels };

  const intakes = list(query.intake);
  if (intakes.length) filter.intakes = { $in: intakes };

  const universities = list(query.university).filter((id) => mongoose.isValidObjectId(id));
  if (universities.length) filter.university = { $in: universities.map((id) => new mongoose.Types.ObjectId(id)) };

  const disciplines = list(query.discipline);
  if (disciplines.length) filter.discipline = { $in: disciplines };

  const exams = list(query.exam);
  if (exams.length) filter['exams.name'] = { $in: exams.map((e) => e.toUpperCase()) };

  const min = Number(query.minTuition);
  const max = Number(query.maxTuition);
  if (Number.isFinite(min) || Number.isFinite(max)) {
    const range: Record<string, number> = {};
    if (Number.isFinite(min)) range.$gte = min;
    if (Number.isFinite(max)) range.$lte = max;
    filter['tuition.amount'] = range;
  }

  const currency = typeof query.currency === 'string' ? query.currency.trim().toUpperCase() : '';
  if (currency) filter['tuition.currency'] = currency;

  const maxDuration = Number(query.maxDurationMonths);
  if (Number.isFinite(maxDuration)) filter['duration.months'] = { $lte: maxDuration };

  /**
   * Substring rather than `$text`: partial words are what a search-as-you-type
   * box actually sends, and "engin" matches nothing under a text index.
   */
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    filter.$or = [
      { name: re }, { universityName: re }, { discipline: re },
      { country: re }, { tags: re }, { location: re },
    ];
  }

  return filter;
}

/**
 * A hand-typed course arrives with the source's own wording — "6,000 EUR/year",
 * "2 years" — and no parsed numbers behind it. Running the importer's parsers
 * over the input is what makes a typed row and an imported one identical, and
 * therefore equally filterable.
 */
function normalizeCourseInput(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body };

  const money = (key: 'tuition' | 'applicationFee') => {
    const raw = out[key] as { text?: string; amount?: number } | undefined;
    if (!raw?.text || raw.amount != null) return;
    out[key] = parseMoney(raw.text);
  };
  money('tuition');
  money('applicationFee');

  const duration = out.duration as { text?: string; months?: number } | undefined;
  if (duration?.text && duration.months == null) out.duration = parseDuration(duration.text);

  const deadline = out.deadline as { text?: string; date?: unknown } | undefined;
  if (deadline?.text && !deadline.date) out.deadline = parseDeadline(deadline.text);

  if (typeof out.examText === 'string' && !Array.isArray(out.exams)) {
    out.exams = parseExams(out.examText);
  }

  // A free-typed intake string still becomes the canonical month list.
  if (typeof out.intakes === 'string') out.intakes = parseIntakes(out.intakes);

  return out;
}

/* ── Countries ───────────────────────────────────────────────────────────── */

router.get('/countries', async (_req: AuthRequest, res: Response) => {
  try {
    const [universities, courses] = await Promise.all([
      University.aggregate([
        { $match: { isActive: { $ne: false } } },
        { $group: { _id: '$country', universities: { $sum: 1 } } },
      ]),
      Course.aggregate([
        { $match: { isActive: { $ne: false } } },
        { $group: {
          _id: '$country',
          courses: { $sum: 1 },
          minTuition: { $min: '$tuition.amount' },
          maxTuition: { $max: '$tuition.amount' },
        } },
      ]),
    ]);

    interface CountryRow { country: string; universities: number; courses: number; minTuition?: number; maxTuition?: number }
    const byCountry = new Map<string, CountryRow>();
    for (const u of universities) {
      byCountry.set(u._id, { country: u._id, universities: u.universities, courses: 0 });
    }
    for (const c of courses) {
      const entry: CountryRow = byCountry.get(c._id) ?? { country: c._id, universities: 0, courses: 0 };
      entry.courses = c.courses;
      entry.minTuition = c.minTuition ?? undefined;
      entry.maxTuition = c.maxTuition ?? undefined;
      byCountry.set(c._id, entry);
    }

    res.json([...byCountry.values()].sort((a, b) => a.country.localeCompare(b.country)));
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/* ── Universities ────────────────────────────────────────────────────────── */

router.get('/universities', async (req: AuthRequest, res: Response) => {
  try {
    const filter: FilterQuery<Record<string, unknown>> = {};
    if (req.query.includeInactive !== 'true') filter.isActive = { $ne: false };

    const countries = list(req.query.country);
    if (countries.length) filter.country = { $in: countries };

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      const re = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ name: re }, { country: re }, { city: re }];
    }

    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const page = Math.max(Number(req.query.page) || 1, 1);

    const [items, total] = await Promise.all([
      University.find(filter).sort({ country: 1, name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      University.countDocuments(filter),
    ]);

    res.json({ items, total, page, pages: Math.max(Math.ceil(total / limit), 1) });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.get('/universities/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const university = await University.findById(req.params.id).lean();
    if (!university) { res.status(404).json({ message: 'University not found' }); return; }
    const courses = await Course.find({ university: university._id, isActive: { $ne: false } })
      .sort({ level: 1, name: 1 }).lean();
    res.json({ ...university, courses });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.post('/universities', can('courses', 'create'), async (req: AuthRequest, res: Response) => {
  try {
    const name = String(req.body.name ?? '').trim();
    const country = String(req.body.country ?? '').trim();
    if (!name || !country) { res.status(400).json({ message: 'Name and country are required' }); return; }

    const university = await University.create({ ...req.body, name, country, slug: slugify(name), source: 'manual' });
    res.status(201).json(university);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      res.status(409).json({ message: 'That university already exists in this country' });
      return;
    }
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.put('/universities/:id', can('courses', 'update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const update: Record<string, unknown> = { ...req.body };
    delete update._id;
    if (typeof update.name === 'string') update.slug = slugify(update.name);

    const university = await University.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!university) { res.status(404).json({ message: 'University not found' }); return; }

    // The name is denormalised onto every course for filter-free listing.
    if (typeof req.body.name === 'string' || typeof req.body.country === 'string') {
      await Course.updateMany(
        { university: university._id },
        { $set: { universityName: university.name, country: university.country } },
      );
    }
    res.json(university);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.delete('/universities/:id', can('courses', 'delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const university = await University.findById(req.params.id);
    if (!university) { res.status(404).json({ message: 'University not found' }); return; }
    await Course.deleteMany({ university: university._id });
    await university.deleteOne();
    res.json({ message: 'University and its courses removed' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/* ── Courses ─────────────────────────────────────────────────────────────── */

/**
 * The filter panel's vocabulary, counted against everything *except* the facet
 * being counted — so unticking a level still shows how many that level holds.
 */
router.get('/courses/facets', async (req: AuthRequest, res: Response) => {
  try {
    const withoutLevel = courseFilter({ ...req.query, level: undefined });
    const withoutCountry = courseFilter({ ...req.query, country: undefined });
    const withoutIntake = courseFilter({ ...req.query, intake: undefined });
    const base = courseFilter(req.query as Record<string, unknown>);

    const [levels, countries, intakes, exams, tuition, disciplines] = await Promise.all([
      Course.aggregate([{ $match: withoutLevel }, { $group: { _id: '$level', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
      Course.aggregate([{ $match: withoutCountry }, { $group: { _id: '$country', n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      Course.aggregate([
        { $match: withoutIntake }, { $unwind: '$intakes' },
        { $group: { _id: '$intakes', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 24 },
      ]),
      Course.aggregate([
        { $match: base }, { $unwind: '$exams' },
        { $group: { _id: '$exams.name', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 12 },
      ]),
      Course.aggregate([
        { $match: { ...base, 'tuition.amount': { $gt: 0 } } },
        { $group: { _id: '$tuition.currency', min: { $min: '$tuition.amount' }, max: { $max: '$tuition.amount' }, n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ]),
      Course.aggregate([
        { $match: { ...base, discipline: { $nin: [null, ''] } } },
        { $group: { _id: '$discipline', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 30 },
      ]),
    ]);

    const shape = (rows: { _id: unknown; n: number }[]) =>
      rows.filter((r) => r._id != null && r._id !== '').map((r) => ({ value: String(r._id), count: r.n }));

    res.json({
      levels: shape(levels),
      countries: shape(countries),
      intakes: shape(intakes),
      exams: shape(exams),
      disciplines: shape(disciplines),
      currencies: tuition.map((t) => ({
        value: String(t._id ?? 'unknown'), count: t.n, min: t.min, max: t.max,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/** Counts for the dashboard and the catalogue's own report. */
router.get('/courses/stats', async (_req: AuthRequest, res: Response) => {
  try {
    const [totals, byLevel, byCountry, tuitionBands] = await Promise.all([
      Course.aggregate([
        { $match: { isActive: { $ne: false } } },
        { $group: { _id: null, courses: { $sum: 1 }, avgTuition: { $avg: '$tuition.amount' } } },
      ]),
      Course.aggregate([
        { $match: { isActive: { $ne: false } } },
        { $group: { _id: '$level', n: { $sum: 1 } } }, { $sort: { n: -1 } },
      ]),
      Course.aggregate([
        { $match: { isActive: { $ne: false } } },
        { $group: { _id: '$country', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 12 },
      ]),
      Course.aggregate([
        { $match: { isActive: { $ne: false }, 'tuition.amount': { $gt: 0 }, 'tuition.currency': 'EUR' } },
        { $bucket: {
          groupBy: '$tuition.amount',
          boundaries: [0, 2000, 5000, 10000, 15000, 25000, 1000000],
          default: 'other',
          output: { n: { $sum: 1 } },
        } },
      ]),
    ]);

    res.json({
      courses: totals[0]?.courses ?? 0,
      avgTuition: Math.round(totals[0]?.avgTuition ?? 0),
      universities: await University.countDocuments({ isActive: { $ne: false } }),
      countries: (await Course.distinct('country')).length,
      byLevel: byLevel.map((r) => ({ value: String(r._id), count: r.n })),
      byCountry: byCountry.map((r) => ({ value: String(r._id), count: r.n })),
      tuitionBands: tuitionBands.map((r) => ({ value: String(r._id), count: r.n })),
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.get('/courses', async (req: AuthRequest, res: Response) => {
  try {
    const filter = courseFilter(req.query as Record<string, unknown>);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const sort = SORTS[String(req.query.sort ?? '')] ?? SORTS.name;

    const [items, total] = await Promise.all([
      Course.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
      Course.countDocuments(filter),
    ]);

    res.json({ items, total, page, pages: Math.max(Math.ceil(total / limit), 1), limit });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.get('/courses/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const course = await Course.findById(req.params.id)
      .populate('university', 'name country city website type')
      .lean();
    if (!course) { res.status(404).json({ message: 'Course not found' }); return; }
    res.json(course);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.post('/courses', can('courses', 'create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const university = await University.findById(req.body.university);
    if (!university) { res.status(400).json({ message: 'Pick an existing university' }); return; }

    const course = await Course.create({
      ...normalizeCourseInput(req.body),
      universityName: university.name,
      country: university.country,
      source: 'manual',
    });
    await University.updateOne({ _id: university._id }, { $inc: { courseCount: 1 } });
    res.status(201).json(course);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      res.status(409).json({ message: 'That course already exists at this university' });
      return;
    }
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.put('/courses/:id', can('courses', 'update'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const update = normalizeCourseInput(req.body);
    delete update._id;
    delete update.university;      // moving a course between universities is a create
    delete update.universityName;
    delete update.country;

    const course = await Course.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!course) { res.status(404).json({ message: 'Course not found' }); return; }
    res.json(course);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.delete('/courses/:id', can('courses', 'delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const course = await Course.findByIdAndDelete(req.params.id);
    if (!course) { res.status(404).json({ message: 'Course not found' }); return; }
    await University.updateOne({ _id: course.university }, { $inc: { courseCount: -1 } });
    res.json({ message: 'Course removed' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

export default router;
