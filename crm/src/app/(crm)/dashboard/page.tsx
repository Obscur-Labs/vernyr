'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { Stat, StatSkeleton } from '@/components/ui/stat';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { useToast } from '@/context/ToastContext';
import { usePermission } from '@/stores/authStore';
import {
  BarChart, ChartCard, ChartSkeleton, DonutChart, LineChart, StackedBar, fmtCompact,
} from '@/components/charts';
import {
  LEAD_STATUS_COLORS, LEAD_STATUS_ORDER, STAGE_LABELS, STAGE_ORDER,
  orderedBuckets, money, type OverviewReport,
} from '@/lib/reports';
import {
  CreditCardIcon, DocumentTextIcon, GraduationIcon, PassportIcon, PlusIcon, TargetIcon,
} from '@/components/icons';
import type { DashboardStats } from '@/types';

/**
 * The dashboard reads two endpoints: `/dashboard/stats` for the headline
 * counts everyone can see, and `/reports/overview` for the trend lines, which
 * only a caller holding `reports.read` may have. Everything below degrades to
 * the first when the second is not available.
 */
export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [overview, setOverview] = useState<OverviewReport | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const router = useRouter();
  const can = usePermission();
  const maySeeReports = can('reports', 'read');

  useEffect(() => {
    api.get<DashboardStats>('/dashboard/stats')
      .then((r) => setStats(r.data))
      .catch(() => toast('Failed to load dashboard stats', 'error'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!maySeeReports) return;
    api.get<OverviewReport>('/reports/overview?months=12')
      .then((r) => setOverview(r.data))
      .catch(() => {});
  }, [maySeeReports]);

  const leadSlices = orderedBuckets(
    Object.entries(stats?.leadsByStatus ?? {}).map(([value, count]) => ({ value, count })),
    LEAD_STATUS_ORDER,
    LEAD_STATUS_COLORS,
  );

  const stageSlices = orderedBuckets(
    Object.entries(stats?.studentsByStage ?? {}).map(([value, count]) => ({ value, count })),
    STAGE_ORDER,
    undefined,
    STAGE_LABELS,
  );

  const revenueSplit = overview
    ? [
      { value: 'Collected', count: overview.totals.revenuePaid, color: 'var(--chart-2)' },
      { value: 'Pending', count: overview.totals.revenuePending, color: 'var(--chart-4)' },
      { value: 'Overdue', count: overview.totals.revenueOverdue, color: 'var(--chart-10)' },
    ]
    : [];

  return (
    <div className="animate-fade-in space-y-8 p-6">
      <PageHeader
        title="Dashboard"
        subtitle="Overview of your study abroad pipeline"
        actions={
          <>
            <Button onClick={() => router.push('/leads')}>
              <PlusIcon className="h-4 w-4" />New lead
            </Button>
            <Button variant="secondary" onClick={() => router.push('/students')}>
              <PlusIcon className="h-4 w-4" />New student
            </Button>
          </>
        }
      />

      {/* Headline counts */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        {loading ? (
          [...Array(5)].map((_, i) => <StatSkeleton key={i} />)
        ) : stats ? (
          <>
            <Stat label="Total Leads" value={stats.totalLeads} icon={<TargetIcon />} accent="indigo" spark={overview?.series.leads} />
            <Stat label="Total Students" value={stats.totalStudents} icon={<GraduationIcon />} accent="emerald" spark={overview?.series.students} />
            <Stat label="Applications" value={stats.totalApplications} icon={<DocumentTextIcon />} accent="blue" spark={overview?.series.applications} />
            <Stat label="Visa Approvals" value={stats.visaApprovals} icon={<PassportIcon />} accent="violet" />
            <Stat
              label="Pending Payments"
              value={`$${stats.pendingPaymentsTotal.toLocaleString()}`}
              icon={<CreditCardIcon />}
              accent="amber"
              spark={overview?.series.revenue}
            />
          </>
        ) : null}
      </div>

      {/* Twelve-month trend */}
      {maySeeReports && (
        <ChartCard
          title="Twelve-month trend"
          subtitle="New leads, students and applications, month by month"
          action={
            <Button variant="ghost" size="sm" onClick={() => router.push('/reports')} className="text-accent">
              All reports
            </Button>
          }
        >
          {overview ? (
            <LineChart
              labels={overview.months}
              series={[
                { name: 'Leads', points: overview.series.leads, color: 'var(--chart-1)' },
                { name: 'Students', points: overview.series.students, color: 'var(--chart-2)' },
                { name: 'Applications', points: overview.series.applications, color: 'var(--chart-3)' },
              ]}
            />
          ) : (
            <ChartSkeleton height={240} />
          )}
        </ChartCard>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartCard title="Lead pipeline" subtitle="Where every enquiry currently sits">
          {loading ? <ChartSkeleton height={220} /> : <DonutChart slices={leadSlices} centerLabel="Leads" />}
        </ChartCard>

        <ChartCard title="Student journey" subtitle="Headcount at each stage of the pipeline">
          {loading ? <ChartSkeleton height={220} /> : <BarChart slices={stageSlices} monochrome height={240} />}
        </ChartCard>
      </div>

      {maySeeReports && overview && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <ChartCard
            title="Revenue"
            subtitle="Collected against what is still owed"
            className="xl:col-span-1"
          >
            <p className="text-[28px] font-bold leading-none tracking-tight text-t1">
              {money(overview.totals.revenuePaid)}
            </p>
            <p className="mt-1 text-[12px] text-t3">collected all time</p>
            <div className="mt-4">
              <StackedBar slices={revenueSplit} height={14} />
            </div>
            <ul className="mt-4 space-y-2">
              {revenueSplit.map((s) => (
                <li key={s.value} className="flex items-center gap-2.5 text-[13px]">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
                  <span className="flex-1 text-t2">{s.value}</span>
                  <span className="font-semibold tabular-nums text-t1">{money(s.count)}</span>
                </li>
              ))}
            </ul>
          </ChartCard>

          <ChartCard
            title="Monthly revenue"
            subtitle="Payments received, by the month they cleared"
            className="xl:col-span-2"
          >
            <LineChart
              labels={overview.months}
              series={[{ name: 'Collected', points: overview.series.revenue, color: 'var(--chart-2)' }]}
              valueFormat={(n) => `$${fmtCompact(n)}`}
              height={220}
            />
          </ChartCard>
        </div>
      )}
    </div>
  );
}
