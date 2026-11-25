'use client';

import { useState } from 'react';
import { BarChart, ChartCard, DonutChart, HBarChart, LineChart, fmtNumber } from '@/components/charts';
import { Metric, ReportShell, useReport, type Range } from '@/components/reports/ReportShell';
import { STAGE_LABELS, STAGE_ORDER, orderedBuckets, type StudentsReport } from '@/lib/reports';

/** IELTS buckets come back keyed by their lower bound. */
const IELTS_LABELS: Record<string, string> = {
  '0': 'Under 5.0', '5': '5.0–5.5', '5.5': '5.5–6.0', '6': '6.0–6.5',
  '6.5': '6.5–7.0', '7': '7.0–7.5', '7.5': '7.5+',
};

export default function StudentsReportPage() {
  const [range, setRange] = useState<Range>(12);
  const { data, loading, error } = useReport<StudentsReport>('/reports/students', range);

  const totalStudents = data?.byStage.reduce((n, s) => n + s.count, 0) ?? 0;
  const inFlight = data?.byStage
    .filter((s) => !['departure'].includes(s.value))
    .reduce((n, s) => n + s.count, 0) ?? 0;
  const departed = data?.byStage.find((s) => s.value === 'departure')?.count ?? 0;
  const newThisWindow = data?.series.newStudents.reduce((n, v) => n + v, 0) ?? 0;

  return (
    <ReportShell
      title="Students report"
      subtitle="Where every student is, and who is carrying them"
      range={range}
      onRange={setRange}
      loading={loading}
      error={error}
    >
      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Metric label="Students" value={fmtNumber(totalStudents)} />
            <Metric label={`New in ${range} months`} value={fmtNumber(newThisWindow)} />
            <Metric label="In progress" value={fmtNumber(inFlight)} hint="not yet departed" />
            <Metric label="Departed" value={fmtNumber(departed)} tone="good" />
          </div>

          <ChartCard title="Intake over time" subtitle="Students added each month">
            <LineChart
              labels={data.months}
              series={[{ name: 'New students', points: data.series.newStudents, color: 'var(--chart-2)' }]}
            />
          </ChartCard>

          <ChartCard title="Journey stages" subtitle="Headcount at each step of the pipeline">
            <BarChart
              slices={orderedBuckets(data.byStage, STAGE_ORDER, undefined, STAGE_LABELS)}
              monochrome
              height={260}
            />
          </ChartCard>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <ChartCard title="Caseload by counsellor" subtitle="Who is carrying how many">
              <HBarChart slices={data.byCounsellor} labelWidth="w-36" monochrome />
            </ChartCard>

            <ChartCard title="Preferred destinations" subtitle="Countries students are aiming for">
              <HBarChart slices={data.byPreferredCountry} labelWidth="w-32" />
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <ChartCard title="Nationality" subtitle="Top ten">
              <DonutChart slices={data.byNationality} size={168} thickness={22} centerLabel="Students" />
            </ChartCard>

            <ChartCard title="Target intake" subtitle="When students want to start">
              <HBarChart slices={data.byIntake} labelWidth="w-28" />
            </ChartCard>

            <ChartCard title="IELTS bands" subtitle="Where recorded scores sit">
              <HBarChart
                slices={data.ieltsBands.map((b) => ({ ...b, value: IELTS_LABELS[b.value] ?? b.value }))}
                labelWidth="w-24"
                monochrome
              />
            </ChartCard>
          </div>
        </>
      )}
    </ReportShell>
  );
}
