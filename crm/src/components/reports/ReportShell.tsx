'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { ChartSkeleton } from '@/components/charts';
import { Card, PageHeader } from '@/components/ui/card';
import { Segmented } from '@/components/ui/field';

/**
 * Every report page is the same shape: pick a window, fetch one endpoint, draw
 * charts. This holds that frame so each page is only its charts.
 */

export const RANGES = [6, 12, 24] as const;
export type Range = (typeof RANGES)[number];

/** Fetches a report and refetches when the window changes. */
export function useReport<T>(path: string, months?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const query = months ? `?months=${months}` : '';
    api.get<T>(`${path}${query}`)
      .then((r) => { if (live) { setData(r.data); setError(null); } })
      .catch((err) => {
        if (!live) return;
        const message = (err as { response?: { data?: { message?: string } } })
          .response?.data?.message ?? 'Could not load this report';
        setError(message);
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [path, months]);

  return { data, error, loading };
}

export const RangePicker = ({ value, onChange }: { value: Range; onChange: (r: Range) => void }) => (
  <Segmented
    label="Time range"
    value={value}
    onChange={onChange}
    options={RANGES.map((r) => ({ value: r, label: `${r}m` }))}
  />
);

export function ReportShell({
  title, subtitle, range, onRange, loading, error, children,
}: {
  title: string;
  subtitle: string;
  range?: Range;
  onRange?: (r: Range) => void;
  loading: boolean;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="animate-fade-in space-y-6 p-6">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={range && onRange ? <RangePicker value={range} onChange={onRange} /> : undefined}
      />

      {error ? (
        <Card className="border-red-500/25 bg-red-500/10">
          <p className="text-[15px] font-semibold text-red-400">{error}</p>
          <p className="mt-1 text-[13px] text-t2">
            Reports need the Reports module. Ask an administrator if this looks wrong.
          </p>
        </Card>
      ) : loading ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {[...Array(4)].map((_, i) => <ChartSkeleton key={i} height={260} />)}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export { Stat as Metric } from '@/components/ui/stat';
