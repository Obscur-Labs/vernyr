'use client';

import Link from 'next/link';
import { ChartCard, DonutChart, HBarChart, fmtNumber } from '@/components/charts';
import { Metric, ReportShell, useReport } from '@/components/reports/ReportShell';
import { LEVEL_COLORS, type CatalogueReport } from '@/lib/reports';
import { COURSE_LEVEL_LABELS, type CourseLevel } from '@/types';

export default function CatalogueReportPage() {
  const { data, loading, error } = useReport<CatalogueReport>('/reports/catalogue');

  const levels = (data?.byLevel ?? []).map((r) => ({
    value: COURSE_LEVEL_LABELS[r.value as CourseLevel] ?? r.value,
    count: r.count,
    color: LEVEL_COLORS[r.value],
  }));

  return (
    <ReportShell
      title="Catalogue report"
      subtitle="What the course catalogue actually holds"
      loading={loading}
      error={error}
    >
      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Metric label="Courses" value={fmtNumber(data.totals.courses)} />
            <Metric label="Universities" value={fmtNumber(data.totals.universities)} />
            <Metric label="Countries" value={fmtNumber(data.totals.countries)} />
            <Metric
              label="Courses per university"
              value={data.totals.universities ? Math.round(data.totals.courses / data.totals.universities) : 0}
              hint="on average"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <ChartCard
              title="By level"
              subtitle="The mix of degrees on offer"
              action={<Link href="/courses" className="text-[13px] font-medium text-accent hover:underline">Browse</Link>}
            >
              <DonutChart slices={levels} centerLabel="Courses" />
            </ChartCard>

            <ChartCard title="Tuition bands" subtitle="Euro-priced courses, by annual fee">
              <HBarChart slices={data.tuitionBands} labelWidth="w-28" monochrome />
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <ChartCard
              title="Coverage by country"
              subtitle="How many courses each destination contributes"
              action={<Link href="/courses/countries" className="text-[13px] font-medium text-accent hover:underline">Countries</Link>}
            >
              <HBarChart slices={data.byCountry} labelWidth="w-32" />
            </ChartCard>

            <ChartCard
              title="Deepest catalogues"
              subtitle="Universities with the most courses listed"
              action={<Link href="/courses/universities" className="text-[13px] font-medium text-accent hover:underline">Universities</Link>}
            >
              <HBarChart slices={data.byUniversity} labelWidth="w-44" monochrome />
            </ChartCard>
          </div>

          <ChartCard title="Intake months" subtitle="When courses actually start">
            <HBarChart slices={data.byIntake} labelWidth="w-28" />
          </ChartCard>
        </>
      )}
    </ReportShell>
  );
}
