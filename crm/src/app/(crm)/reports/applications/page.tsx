'use client';

import { useState } from 'react';
import { ChartCard, DonutChart, HBarChart, LineChart, fmtNumber } from '@/components/charts';
import { Metric, ReportShell, useReport, type Range } from '@/components/reports/ReportShell';
import { APP_STATUS_COLORS, colorize, type ApplicationsReport } from '@/lib/reports';

export default function ApplicationsReportPage() {
  const [range, setRange] = useState<Range>(12);
  const { data, loading, error } = useReport<ApplicationsReport>('/reports/applications', range);

  const total = data?.byStatus.reduce((n, s) => n + s.count, 0) ?? 0;
  const at = (status: string) => data?.byStatus.find((s) => s.value === status)?.count ?? 0;
  const offers = at('offer_received') + at('conditional_offer') + at('accepted');

  return (
    <ReportShell
      title="Applications report"
      subtitle="Offers, rejections and where students are applying"
      range={range}
      onRange={setRange}
      loading={loading}
      error={error}
    >
      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Metric label="Applications" value={fmtNumber(total)} />
            <Metric label="Offers" value={fmtNumber(offers)} tone="good" hint="including conditional" />
            <Metric
              label="Offer rate"
              value={`${data.offerRate}%`}
              tone={data.offerRate >= 50 ? 'good' : data.offerRate >= 25 ? 'warn' : 'bad'}
            />
            <Metric label="Rejected" value={fmtNumber(at('rejected'))} tone={at('rejected') ? 'bad' : 'neutral'} />
          </div>

          <ChartCard title="Submitted against offers" subtitle="Applications created, and offers received">
            <LineChart
              labels={data.months}
              series={[
                { name: 'Submitted', points: data.series.submitted, color: 'var(--chart-3)' },
                { name: 'Offers', points: data.series.offers, color: 'var(--chart-2)' },
              ]}
            />
          </ChartCard>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <ChartCard title="By status" subtitle="Where every application stands">
              <DonutChart slices={colorize(data.byStatus, APP_STATUS_COLORS)} centerLabel="Applications" />
            </ChartCard>

            <ChartCard title="By level" subtitle="Undergraduate against postgraduate">
              <DonutChart slices={data.byLevel} centerLabel="Applications" />
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <ChartCard title="Destination countries" subtitle="Where applications are going">
              <HBarChart slices={data.byCountry} labelWidth="w-32" />
            </ChartCard>

            <ChartCard title="Top universities" subtitle="The institutions receiving the most">
              <HBarChart slices={data.byUniversity} labelWidth="w-44" monochrome />
            </ChartCard>
          </div>

          <ChartCard title="By intake" subtitle="Which starting terms students are targeting">
            <HBarChart slices={data.byIntake} labelWidth="w-32" />
          </ChartCard>
        </>
      )}
    </ReportShell>
  );
}
