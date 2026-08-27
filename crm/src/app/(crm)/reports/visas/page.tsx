'use client';

import { useState } from 'react';
import { ChartCard, DonutChart, HBarChart, LineChart, fmtNumber } from '@/components/charts';
import { Metric, ReportShell, useReport, type Range } from '@/components/reports/ReportShell';
import { VISA_STAGE_COLORS, colorize, type VisasReport } from '@/lib/reports';

export default function VisasReportPage() {
  const [range, setRange] = useState<Range>(12);
  const { data, loading, error } = useReport<VisasReport>('/reports/visas', range);

  const at = (stage: string) => data?.byStage.find((s) => s.value === stage)?.count ?? 0;
  const total = data?.byStage.reduce((n, s) => n + s.count, 0) ?? 0;
  const pending = total - at('approved') - at('rejected');

  return (
    <ReportShell
      title="Visa report"
      subtitle="Filings, decisions and how often they land"
      range={range}
      onRange={setRange}
      loading={loading}
      error={error}
    >
      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Metric label="Visa records" value={fmtNumber(total)} />
            <Metric label="Approved" value={fmtNumber(at('approved'))} tone="good" />
            <Metric label="Rejected" value={fmtNumber(at('rejected'))} tone={at('rejected') ? 'bad' : 'neutral'} />
            <Metric
              label="Approval rate"
              value={`${data.approvalRate}%`}
              hint={`${pending} still in progress`}
              tone={data.approvalRate >= 80 ? 'good' : data.approvalRate >= 60 ? 'warn' : 'bad'}
            />
          </div>

          <ChartCard title="Filings and decisions" subtitle="Filed, approved and rejected each month">
            <LineChart
              labels={data.months}
              series={[
                { name: 'Filed', points: data.series.filed, color: 'var(--chart-6)' },
                { name: 'Approved', points: data.series.approved, color: 'var(--chart-2)' },
                { name: 'Rejected', points: data.series.rejected, color: 'var(--chart-10)' },
              ]}
            />
          </ChartCard>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <ChartCard title="By stage" subtitle="Where each application sits in the process">
              <DonutChart slices={colorize(data.byStage, VISA_STAGE_COLORS)} centerLabel="Visas" />
            </ChartCard>

            <ChartCard title="By country" subtitle="Which consulates are handling the volume">
              <HBarChart slices={data.byCountry} labelWidth="w-32" />
            </ChartCard>
          </div>
        </>
      )}
    </ReportShell>
  );
}
