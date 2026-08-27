import { Router, Response } from 'express';
import type { PipelineStage } from 'mongoose';
import Lead from '../models/Lead';
import Student from '../models/Student';
import Application from '../models/Application';
import Visa from '../models/Visa';
import Payment from '../models/Payment';
import User from '../models/User';
import Course from '../models/Course';
import University from '../models/University';
import { authenticate, can, AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * The reports section.
 *
 * Every endpoint answers with series and breakdowns rather than pre-rendered
 * numbers, because the CRM draws them as charts. Shapes are deliberately
 * uniform — `{ value, count }` for a breakdown, `{ month, … }` for a series —
 * so one chart component reads any of them.
 */

router.use(authenticate, can('reports', 'read'));

/* ── Shared shapes ───────────────────────────────────────────────────────── */

interface Bucket { value: string; count: number }

const bucketsOf = (rows: { _id: unknown; n: number }[]): Bucket[] =>
  rows.map((r) => ({ value: r._id == null || r._id === '' ? 'unspecified' : String(r._id), count: r.n }));

/** Months back from the start of the current one, inclusive. */
function monthWindow(req: AuthRequest): { start: Date; months: string[] } {
  const months = Math.min(Math.max(Number(req.query.months) || 12, 3), 36);
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));

  const keys: string[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return { start, months: keys };
}

const monthGroup = (field: string): PipelineStage[] => [
  { $group: {
    _id: { $dateToString: { format: '%Y-%m', date: `$${field}` } },
    n: { $sum: 1 },
  } },
];

const monthSum = (field: string, amount: string): PipelineStage[] => [
  { $group: {
    _id: { $dateToString: { format: '%Y-%m', date: `$${field}` } },
    n: { $sum: `$${amount}` },
  } },
];

/** Fills the gaps so a line chart has one point per month, zeros included. */
function series(months: string[], rows: { _id: unknown; n: number }[]): number[] {
  const found = new Map(rows.map((r) => [String(r._id), r.n]));
  return months.map((m) => found.get(m) ?? 0);
}

/* ── Overview ────────────────────────────────────────────────────────────── */

router.get('/overview', async (req: AuthRequest, res: Response) => {
  try {
    const { start, months } = monthWindow(req);
    const since = { $gte: start };

    const [
      totalLeads, totalStudents, totalApplications, totalVisas,
      leadSeries, studentSeries, applicationSeries, revenueSeries,
      leadsByStatus, studentsByStage, applicationsByStatus,
      paid, pending, overdue, converted,
    ] = await Promise.all([
      Lead.countDocuments(),
      Student.countDocuments(),
      Application.countDocuments(),
      Visa.countDocuments(),
      Lead.aggregate([{ $match: { createdAt: since } }, ...monthGroup('createdAt')]),
      Student.aggregate([{ $match: { createdAt: since } }, ...monthGroup('createdAt')]),
      Application.aggregate([{ $match: { createdAt: since } }, ...monthGroup('createdAt')]),
      Payment.aggregate([{ $match: { status: 'paid', paidDate: since } }, ...monthSum('paidDate', 'amount')]),
      Lead.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Student.aggregate([{ $group: { _id: '$stage', n: { $sum: 1 } } }]),
      Application.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Payment.aggregate([{ $match: { status: 'paid' } }, { $group: { _id: null, n: { $sum: '$amount' } } }]),
      Payment.aggregate([{ $match: { status: 'pending' } }, { $group: { _id: null, n: { $sum: '$amount' } } }]),
      Payment.aggregate([{ $match: { status: 'overdue' } }, { $group: { _id: null, n: { $sum: '$amount' } } }]),
      Lead.countDocuments({ convertedStudentId: { $ne: null } }),
    ]);

    res.json({
      totals: {
        leads: totalLeads,
        students: totalStudents,
        applications: totalApplications,
        visas: totalVisas,
        converted,
        conversionRate: totalLeads ? Math.round((converted / totalLeads) * 100) : 0,
        revenuePaid: paid[0]?.n ?? 0,
        revenuePending: pending[0]?.n ?? 0,
        revenueOverdue: overdue[0]?.n ?? 0,
      },
      months,
      series: {
        leads: series(months, leadSeries),
        students: series(months, studentSeries),
        applications: series(months, applicationSeries),
        revenue: series(months, revenueSeries),
      },
      leadsByStatus: bucketsOf(leadsByStatus),
      studentsByStage: bucketsOf(studentsByStage),
      applicationsByStatus: bucketsOf(applicationsByStatus),
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/* ── Finance ─────────────────────────────────────────────────────────────── */

router.get('/finance', async (req: AuthRequest, res: Response) => {
  try {
    const { start, months } = monthWindow(req);
    const now = new Date();

    const [byStatus, byType, byCurrency, revenue, billed, ageing, topOutstanding] = await Promise.all([
      Payment.aggregate([{ $group: { _id: '$status', n: { $sum: '$amount' }, count: { $sum: 1 } } }]),
      Payment.aggregate([{ $group: { _id: '$type', n: { $sum: '$amount' } } }, { $sort: { n: -1 } }]),
      Payment.aggregate([{ $group: { _id: '$currency', n: { $sum: '$amount' } } }, { $sort: { n: -1 } }]),
      Payment.aggregate([{ $match: { status: 'paid', paidDate: { $gte: start } } }, ...monthSum('paidDate', 'amount')]),
      Payment.aggregate([{ $match: { createdAt: { $gte: start } } }, ...monthSum('createdAt', 'amount')]),
      Payment.aggregate([
        { $match: { status: { $in: ['pending', 'overdue'] }, dueDate: { $ne: null } } },
        { $project: {
          amount: 1,
          daysLate: { $divide: [{ $subtract: [now, '$dueDate'] }, 86400000] },
        } },
        { $bucket: {
          groupBy: '$daysLate',
          boundaries: [-100000, 0, 30, 60, 90],
          default: '90+',
          output: { n: { $sum: '$amount' }, count: { $sum: 1 } },
        } },
      ]),
      Payment.find({ status: { $in: ['pending', 'overdue'] } })
        .sort({ amount: -1 }).limit(10)
        .populate('studentId', 'personal.name')
        .lean(),
    ]);

    const AGEING_LABELS: Record<string, string> = {
      '-100000': 'Not yet due', '0': '0–30 days', '30': '30–60 days', '60': '60–90 days', '90+': '90+ days',
    };

    res.json({
      months,
      byStatus: byStatus.map((r) => ({ value: String(r._id), count: r.n, records: r.count })),
      byType: bucketsOf(byType),
      byCurrency: bucketsOf(byCurrency),
      series: { revenue: series(months, revenue), billed: series(months, billed) },
      ageing: ageing.map((r) => ({ value: AGEING_LABELS[String(r._id)] ?? String(r._id), count: r.n, records: r.count })),
      topOutstanding: topOutstanding.map((p) => ({
        _id: String(p._id),
        student: (p.studentId as { personal?: { name?: string } } | null)?.personal?.name ?? 'Unknown',
        description: p.description,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        dueDate: p.dueDate,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/* ── Students ────────────────────────────────────────────────────────────── */

router.get('/students', async (req: AuthRequest, res: Response) => {
  try {
    const { start, months } = monthWindow(req);

    const [byStage, intake, byCounsellor, byNationality, byPreferredCountry, byIntake, ielts] = await Promise.all([
      Student.aggregate([{ $group: { _id: '$stage', n: { $sum: 1 } } }]),
      Student.aggregate([{ $match: { createdAt: { $gte: start } } }, ...monthGroup('createdAt')]),
      Student.aggregate([
        { $group: { _id: '$assignedCounsellor', n: { $sum: 1 } } },
        { $sort: { n: -1 } }, { $limit: 15 },
      ]),
      Student.aggregate([
        { $group: { _id: '$personal.nationality', n: { $sum: 1 } } },
        { $sort: { n: -1 } }, { $limit: 10 },
      ]),
      Student.aggregate([
        { $unwind: '$preferences.countries' },
        { $group: { _id: '$preferences.countries', n: { $sum: 1 } } },
        { $sort: { n: -1 } }, { $limit: 12 },
      ]),
      Student.aggregate([
        { $group: { _id: '$preferences.intake', n: { $sum: 1 } } },
        { $sort: { n: -1 } }, { $limit: 10 },
      ]),
      Student.aggregate([
        { $match: { 'scores.ielts': { $gt: 0 } } },
        { $bucket: {
          groupBy: '$scores.ielts',
          boundaries: [0, 5, 5.5, 6, 6.5, 7, 7.5, 10],
          default: 'other',
          output: { n: { $sum: 1 } },
        } },
      ]),
    ]);

    // Counsellor ids mean nothing to a chart legend.
    const counsellorIds = byCounsellor.map((r) => r._id).filter(Boolean);
    const counsellors = await User.find({ _id: { $in: counsellorIds } }).select('name').lean();
    const nameById = new Map(counsellors.map((u) => [String(u._id), u.name]));

    res.json({
      months,
      byStage: bucketsOf(byStage),
      series: { newStudents: series(months, intake) },
      byCounsellor: byCounsellor.map((r) => ({
        value: r._id ? nameById.get(String(r._id)) ?? 'Unknown' : 'Unassigned',
        count: r.n,
      })),
      byNationality: bucketsOf(byNationality),
      byPreferredCountry: bucketsOf(byPreferredCountry),
      byIntake: bucketsOf(byIntake),
      ieltsBands: ielts.map((r) => ({ value: String(r._id), count: r.n })),
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/* ── Applications ────────────────────────────────────────────────────────── */

router.get('/applications', async (req: AuthRequest, res: Response) => {
  try {
    const { start, months } = monthWindow(req);

    const [byStatus, byCountry, byUniversity, byLevel, byIntake, submitted, offers] = await Promise.all([
      Application.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Application.aggregate([{ $group: { _id: '$country', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 12 }]),
      Application.aggregate([{ $group: { _id: '$university', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 12 }]),
      Application.aggregate([{ $group: { _id: '$level', n: { $sum: 1 } } }]),
      Application.aggregate([{ $group: { _id: '$intake', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }]),
      Application.aggregate([{ $match: { createdAt: { $gte: start } } }, ...monthGroup('createdAt')]),
      Application.aggregate([
        { $match: { offerDate: { $gte: start, $ne: null } } }, ...monthGroup('offerDate'),
      ]),
    ]);

    const total = byStatus.reduce((n, r) => n + r.n, 0);
    const won = byStatus
      .filter((r) => ['offer_received', 'conditional_offer', 'accepted'].includes(String(r._id)))
      .reduce((n, r) => n + r.n, 0);

    res.json({
      months,
      byStatus: bucketsOf(byStatus),
      byCountry: bucketsOf(byCountry),
      byUniversity: bucketsOf(byUniversity),
      byLevel: bucketsOf(byLevel),
      byIntake: bucketsOf(byIntake),
      series: { submitted: series(months, submitted), offers: series(months, offers) },
      offerRate: total ? Math.round((won / total) * 100) : 0,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/* ── Visas ───────────────────────────────────────────────────────────────── */

router.get('/visas', async (req: AuthRequest, res: Response) => {
  try {
    const { start, months } = monthWindow(req);

    const [byStage, byCountry, filed, approved, rejected] = await Promise.all([
      Visa.aggregate([{ $group: { _id: '$stage', n: { $sum: 1 } } }]),
      Visa.aggregate([{ $group: { _id: '$country', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 12 }]),
      Visa.aggregate([{ $match: { filedDate: { $gte: start, $ne: null } } }, ...monthGroup('filedDate')]),
      Visa.aggregate([{ $match: { approvalDate: { $gte: start, $ne: null } } }, ...monthGroup('approvalDate')]),
      Visa.aggregate([{ $match: { stage: 'rejected', decisionDate: { $gte: start, $ne: null } } }, ...monthGroup('decisionDate')]),
    ]);

    const decided = byStage
      .filter((r) => ['approved', 'rejected'].includes(String(r._id)))
      .reduce((n, r) => n + r.n, 0);
    const ok = byStage.find((r) => r._id === 'approved')?.n ?? 0;

    res.json({
      months,
      byStage: bucketsOf(byStage),
      byCountry: bucketsOf(byCountry),
      series: {
        filed: series(months, filed),
        approved: series(months, approved),
        rejected: series(months, rejected),
      },
      approvalRate: decided ? Math.round((ok / decided) * 100) : 0,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/* ── Leads ───────────────────────────────────────────────────────────────── */

router.get('/leads', async (req: AuthRequest, res: Response) => {
  try {
    const { start, months } = monthWindow(req);

    const [byStatus, bySource, byCountry, byOwner, created, convertedSeries, total, converted] = await Promise.all([
      Lead.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Lead.aggregate([{ $group: { _id: '$source', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
      Lead.aggregate([{ $group: { _id: '$intendedCountry', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 12 }]),
      Lead.aggregate([{ $group: { _id: '$assignedTo', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 15 }]),
      Lead.aggregate([{ $match: { createdAt: { $gte: start } } }, ...monthGroup('createdAt')]),
      Lead.aggregate([
        { $match: { convertedStudentId: { $ne: null }, updatedAt: { $gte: start } } },
        ...monthGroup('updatedAt'),
      ]),
      Lead.countDocuments(),
      Lead.countDocuments({ convertedStudentId: { $ne: null } }),
    ]);

    const ownerIds = byOwner.map((r) => r._id).filter(Boolean);
    const owners = await User.find({ _id: { $in: ownerIds } }).select('name').lean();
    const nameById = new Map(owners.map((u) => [String(u._id), u.name]));

    res.json({
      months,
      byStatus: bucketsOf(byStatus),
      bySource: bucketsOf(bySource),
      byCountry: bucketsOf(byCountry),
      byOwner: byOwner.map((r) => ({
        value: r._id ? nameById.get(String(r._id)) ?? 'Unknown' : 'Unassigned',
        count: r.n,
      })),
      series: { created: series(months, created), converted: series(months, convertedSeries) },
      conversionRate: total ? Math.round((converted / total) * 100) : 0,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/* ── Catalogue ───────────────────────────────────────────────────────────── */

router.get('/catalogue', async (_req: AuthRequest, res: Response) => {
  try {
    const [byLevel, byCountry, byUniversity, tuition, intakes, courses, universities] = await Promise.all([
      Course.aggregate([{ $group: { _id: '$level', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
      Course.aggregate([{ $group: { _id: '$country', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
      Course.aggregate([{ $group: { _id: '$universityName', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 15 }]),
      Course.aggregate([
        { $match: { 'tuition.amount': { $gt: 0 }, 'tuition.currency': 'EUR' } },
        { $bucket: {
          groupBy: '$tuition.amount',
          boundaries: [0, 2000, 5000, 10000, 15000, 25000, 1000000],
          default: 'other',
          output: { n: { $sum: 1 } },
        } },
      ]),
      Course.aggregate([
        { $unwind: '$intakes' },
        { $group: { _id: '$intakes', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 12 },
      ]),
      Course.countDocuments(),
      University.countDocuments(),
    ]);

    const BAND_LABELS: Record<string, string> = {
      '0': 'Under €2k', '2000': '€2k–5k', '5000': '€5k–10k',
      '10000': '€10k–15k', '15000': '€15k–25k', '25000': '€25k+',
    };

    res.json({
      totals: { courses, universities, countries: byCountry.length },
      byLevel: bucketsOf(byLevel),
      byCountry: bucketsOf(byCountry),
      byUniversity: bucketsOf(byUniversity),
      byIntake: bucketsOf(intakes),
      tuitionBands: tuition.map((r) => ({ value: BAND_LABELS[String(r._id)] ?? String(r._id), count: r.n })),
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

export default router;
