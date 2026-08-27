'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  BarChart, ChartCard, DonutChart, LineChart, fmtCompact, fmtNumber,
} from '@/components/charts';
import { Metric, ReportShell, useReport, type Range } from '@/components/reports/ReportShell';
import {
  BookIcon, DocumentTextIcon, GraduationIcon, PassportIcon, TargetIcon, WalletIcon,
} from '@/components/icons';
import {
  APP_STATUS_COLORS, LEAD_STATUS_COLORS, LEAD_STATUS_ORDER,
  STAGE_LABELS, STAGE_ORDER, colorize, money, orderedBuckets, type OverviewReport,
} from '@/lib/reports';

/** The section's front page — everything at once, each card a way into a report. */
const SECTIONS = [
  { href: '/reports/finance', label: 'Finance', hint: 'Revenue, ageing and what is outstanding', Icon: WalletIcon },
  { href: '/reports/students', label: 'Students', hint: 'Stages, caseloads and intake', Icon: GraduationIcon },
  { href: '/reports/applications', label: 'Applications', hint: 'Offers by country and university', Icon: DocumentTextIcon },
  { href: '/reports/visas', label: 'Visas', hint: 'Filings, decisions and approval rate', Icon: PassportIcon },
  { href: '/reports/leads', label: 'Leads', hint: 'Sources and conversion', Icon: TargetIcon },
  { href: '/reports/catalogue', label: 'Catalogue', hint: 'What the course catalogue holds', Icon: BookIcon },
];

export default function ReportsOverviewPage() {
  const [range, setRange] = useState<Range>(12);
  const { data, loading, error } = useReport<OverviewReport>('/reports/overview', range);

  return (
    <ReportShell
      title="Reports"
      subtitle="Performance across the whole pipeline"
      range={range}
      onRange={setRange}
      loading={loading}
      error={error}
    >
      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Metric label="Leads" value={fmtNumber(data.totals.leads)} hint={`${data.totals.converted} converted`} />
            <Metric label="Students" value={fmtNumber(data.totals.students)} />
            <Metric
              label="Conversion"
              value={`${data.totals.conversionRate}%`}
              hint="lead to student"
              tone={data.totals.conversionRate >= 25 ? 'good' : 'warn'}
            />
            <Metric
              label="Collected"
              value={money(data.totals.revenuePaid)}
              hint={`${money(data.totals.revenueOverdue)} overdue`}
              tone={data.totals.revenueOverdue > 0 ? 'warn' : 'good'}
            />
          </div>

          <ChartCard title="Volume over time" subtitle="New records created each month">
            <LineChart
              labels={data.months}
              series={[
                { name: 'Leads', points: data.series.leads, color: 'var(--chart-1)' },
                { name: 'Students', points: data.series.students, color: 'var(--chart-2)' },
                { name: 'Applications', points: data.series.applications, color: 'var(--chart-3)' },
              ]}
            />
          </ChartCard>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <ChartCard title="Lead funnel" subtitle="Every enquiry by status">
              <DonutChart
                slices={orderedBuckets(data.leadsByStatus, LEAD_STATUS_ORDER, LEAD_STATUS_COLORS)}
                centerLabel="Leads"
              />
            </ChartCard>

            <ChartCard title="Applications by status" subtitle="Where the paperwork stands">
              <DonutChart slices={colorize(data.applicationsByStatus, APP_STATUS_COLORS)} centerLabel="Applications" />
            </ChartCard>
          </div>

          <ChartCard title="Student journey" subtitle="Headcount at each stage">
            <BarChart
              slices={orderedBuckets(data.studentsByStage, STAGE_ORDER, undefined, STAGE_LABELS)}
              monochrome
              height={240}
            />
          </ChartCard>

          <ChartCard title="Revenue collected" subtitle="By the month a payment cleared">
            <LineChart
              labels={data.months}
              series={[{ name: 'Collected', points: data.series.revenue, color: 'var(--chart-2)' }]}
              valueFormat={(n) => `$${fmtCompact(n)}`}
              height={220}
            />
          </ChartCard>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold tracking-tight text-t1">Go deeper</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {SECTIONS.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  className="hig-press group flex items-start gap-3.5 rounded-2xl border border-line bg-surface p-4 hover:border-accent/40"
                >
                  <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
                    <s.Icon className="h-[19px] w-[19px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold text-t1 group-hover:text-accent">{s.label}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-relaxed text-t3">{s.hint}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </ReportShell>
  );
}
