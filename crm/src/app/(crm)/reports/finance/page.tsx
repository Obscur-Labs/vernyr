'use client';

import { useState } from 'react';
import {
  ChartCard, DonutChart, HBarChart, LineChart, fmtCompact,
} from '@/components/charts';
import { Metric, ReportShell, useReport, type Range } from '@/components/reports/ReportShell';
import { PAYMENT_STATUS_COLORS, colorize, money, type FinanceReport } from '@/lib/reports';

const STATUS_TONE: Record<string, string> = {
  paid: 'text-emerald-400',
  pending: 'text-amber-400',
  overdue: 'text-red-400',
  refunded: 'text-violet-400',
  waived: 'text-blue-400',
};

export default function FinanceReportPage() {
  const [range, setRange] = useState<Range>(12);
  const { data, loading, error } = useReport<FinanceReport>('/reports/finance', range);

  const total = (status: string) => data?.byStatus.find((s) => s.value === status)?.count ?? 0;
  const outstanding = total('pending') + total('overdue');

  return (
    <ReportShell
      title="Finance report"
      subtitle="Revenue, ageing and everything still owed"
      range={range}
      onRange={setRange}
      loading={loading}
      error={error}
    >
      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Metric label="Collected" value={money(total('paid'))} tone="good" />
            <Metric label="Outstanding" value={money(outstanding)} hint="pending and overdue" tone="warn" />
            <Metric label="Overdue" value={money(total('overdue'))} tone={total('overdue') > 0 ? 'bad' : 'good'} />
            <Metric
              label="Collection rate"
              value={`${total('paid') + outstanding > 0 ? Math.round((total('paid') / (total('paid') + outstanding)) * 100) : 0}%`}
              hint="of everything billed"
            />
          </div>

          <ChartCard title="Billed against collected" subtitle="What was raised each month, and what came in">
            <LineChart
              labels={data.months}
              series={[
                { name: 'Billed', points: data.series.billed, color: 'var(--chart-1)' },
                { name: 'Collected', points: data.series.revenue, color: 'var(--chart-2)' },
              ]}
              valueFormat={(n) => `$${fmtCompact(n)}`}
            />
          </ChartCard>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <ChartCard title="By status" subtitle="Value of every payment record">
              <DonutChart
                slices={colorize(data.byStatus, PAYMENT_STATUS_COLORS)}
                centerLabel="Total billed"
                centerValue={`$${fmtCompact(data.byStatus.reduce((n, s) => n + s.count, 0))}`}
              />
            </ChartCard>

            <ChartCard title="By fee type" subtitle="Where the money comes from">
              <HBarChart slices={data.byType} labelWidth="w-32" />
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <ChartCard title="Ageing" subtitle="How overdue the unpaid balance is">
              <HBarChart slices={data.ageing} labelWidth="w-28" />
            </ChartCard>

            <ChartCard title="By currency" subtitle="Exposure across the currencies in use">
              <DonutChart slices={data.byCurrency} centerLabel="Currencies" legendColumns={1} />
            </ChartCard>
          </div>

          <ChartCard title="Largest outstanding balances" subtitle="The ten biggest unpaid records">
            {data.topOutstanding.length === 0 ? (
              <p className="py-8 text-center text-[14px] text-t3">Nothing is outstanding.</p>
            ) : (
              <div className="-mx-2 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-[11px] uppercase tracking-wider text-t3">
                      <th className="px-2 pb-2 font-semibold">Student</th>
                      <th className="px-2 pb-2 font-semibold">Description</th>
                      <th className="px-2 pb-2 font-semibold">Due</th>
                      <th className="px-2 pb-2 text-right font-semibold">Amount</th>
                      <th className="px-2 pb-2 text-right font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.topOutstanding.map((p) => (
                      <tr key={p._id} className="hover:bg-muted/50">
                        <td className="px-2 py-2.5 font-medium text-t1">{p.student}</td>
                        <td className="max-w-[18rem] truncate px-2 py-2.5 text-t2">{p.description}</td>
                        <td className="px-2 py-2.5 text-t3">
                          {p.dueDate ? new Date(p.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                        </td>
                        <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-t1">
                          {money(p.amount, p.currency)}
                        </td>
                        <td className={`px-2 py-2.5 text-right font-semibold capitalize ${STATUS_TONE[p.status] ?? 'text-t2'}`}>
                          {p.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ChartCard>
        </>
      )}
    </ReportShell>
  );
}
