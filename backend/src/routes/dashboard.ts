import { Router, Response } from 'express';
import Lead from '../models/Lead';
import Student from '../models/Student';
import Application from '../models/Application';
import Visa from '../models/Visa';
import Payment from '../models/Payment';
import { authenticate, can, AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/stats', authenticate, can('dashboard', 'read'), async (_req: AuthRequest, res: Response) => {
  try {
    const [totalLeads, totalStudents, totalApplications, visaApprovals, pendingPayments, leadsByStatus, studentsByStage] = await Promise.all([
      Lead.countDocuments(),
      Student.countDocuments(),
      Application.countDocuments(),
      Visa.countDocuments({ stage: 'approved' }),
      Payment.aggregate([{ $match: { status: 'pending' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Lead.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Student.aggregate([{ $group: { _id: '$stage', count: { $sum: 1 } } }]),
    ]);

    res.json({
      totalLeads,
      totalStudents,
      totalApplications,
      visaApprovals,
      pendingPaymentsTotal: pendingPayments[0]?.total || 0,
      leadsByStatus: Object.fromEntries(leadsByStatus.map(({ _id, count }) => [_id, count])),
      studentsByStage: Object.fromEntries(studentsByStage.map(({ _id, count }) => [_id, count])),
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.get('/reports', authenticate, can('reports', 'read'), async (_req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [monthlyStudents, monthlyVisaApprovals, monthlyRevenue] = await Promise.all([
      Student.countDocuments({ createdAt: { $gte: startOfMonth } }),
      Visa.countDocuments({ stage: 'approved', updatedAt: { $gte: startOfMonth } }),
      Payment.aggregate([
        { $match: { status: 'paid', paidDate: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    res.json({
      monthlyStudents,
      monthlyVisaApprovals,
      monthlyRevenue: monthlyRevenue[0]?.total || 0,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

export default router;
