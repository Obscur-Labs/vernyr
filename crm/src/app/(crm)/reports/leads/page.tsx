'use client';

import { useState } from 'react';
import { BarChart, ChartCard, DonutChart, HBarChart, LineChart, fmtNumber } from '@/components/charts';
import { Metric, ReportShell, useReport, type Range } from '@/components/reports/ReportShell';
import {
  LEAD_STATUS_COLORS, LEAD_STATUS_ORDER, orderedBuckets, type LeadsReport,
} from '@/lib/reports';

export default function LeadsReportPage() {
  const [range, setRange] = useState<Range>(12);
  const { data, loading, error } = useReport<LeadsReport>('/reports/leads', range);

  const total = data?.byStatus.reduce((n, s) => n + s.count, 0) ?? 0;
  const at = (status: string) => data?.byStatus.find((s) => s.value === status)?.count ?? 0;
  const open = total - at('closed_won') - at('closed_lost');

  return (
    <ReportShell
      title="Leads report"
      subtitle="Where enquiries come from, and how many become students"
      range={range}
      onRange={setRange}
      loading={loading}
      error={error}
    >
      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Metric label="Leads" value={fmtNumber(total)} />
            <Metric label="Open" value={fmtNumber(open)} hint="not yet won or lost" />
            <Metric label="Won" value={fmtNumber(at('closed_won'))} tone="good" />
            <Metric
              label="Conversion"
              value={`${data.conversionRate}%`}
              hint="lead to student record"
              tone={data.conversionRate >= 25 ? 'good' : 'warn'}
            />
          </div>

          <ChartCard title="Enquiries and conversions" subtitle="Created against converted, month by month">
            <LineChart
              labels={data.months}
              series={[
                { name: 'Created', points: data.series.created, color: 'var(--chart-1)' },
                { name: 'Converted', points: data.series.converted, color: 'var(--chart-2)' },
              ]}
            />
          </ChartCard>

          <ChartCard title="Funnel" subtitle="Every lead by status, in pipeline order">
            <BarChart slices={orderedBuckets(data.byStatus, LEAD_STATUS_ORDER, LEAD_STATUS_COLORS)} height={240} />
          </ChartCard>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <ChartCard title="By source" subtitle="Which channels bring the enquiries">
              <DonutChart slices={data.bySource} centerLabel="Leads" />
            </ChartCard>

            <ChartCard title="Intended destination" subtitle="Countries enquirers name">
              <HBarChart slices={data.byCountry} labelWidth="w-32" />
            </ChartCard>
          </div>

          <ChartCard title="By owner" subtitle="Who is holding the enquiries">
            <HBarChart slices={data.byOwner} labelWidth="w-36" monochrome />
          </ChartCard>
        </>
      )}
    </ReportShell>
  );
}
