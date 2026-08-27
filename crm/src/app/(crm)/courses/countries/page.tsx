'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { ChartCard, HBarChart, fmtNumber } from '@/components/charts';
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/card';
import { SearchInput } from '@/components/ui/field';
import { BuildingIcon, GlobeIcon } from '@/components/icons';
import type { CountrySummary } from '@/types';

/**
 * The catalogue's top level. Each card is a way into the browser already
 * filtered to that destination, which is how a counsellor starts most searches.
 */
export default function CountriesPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<CountrySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get<CountrySummary[]>('/catalogue/countries')
      .then((r) => setRows(r.data))
      .catch(() => toast('Could not load countries', 'error'))
      .finally(() => setLoading(false));
  }, [toast]);

  const matched = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.country.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  const totals = useMemo(() => ({
    courses: rows.reduce((n, r) => n + r.courses, 0),
    universities: rows.reduce((n, r) => n + r.universities, 0),
  }), [rows]);

  const byCourses = useMemo(
    () => [...rows].sort((a, b) => b.courses - a.courses).slice(0, 12)
      .map((r) => ({ value: r.country, count: r.courses })),
    [rows],
  );

  return (
    <div className="animate-fade-in space-y-6 p-6">
      <PageHeader
        title="Countries"
        subtitle={loading
          ? 'Loading destinations…'
          : `${rows.length} destinations · ${fmtNumber(totals.universities)} universities · ${fmtNumber(totals.courses)} courses`}
        actions={
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Find a country…"
            label="Find a country"
            className="w-full max-w-xs"
          />
        }
      />

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : matched.length === 0 ? (
        <EmptyState
          icon={<GlobeIcon className="h-7 w-7" />}
          title={`No country matches “${search}”`}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {matched.map((c) => (
              <Link
                key={c.country}
                href={`/courses?country=${encodeURIComponent(c.country)}`}
                className="hig-press group rounded-2xl border border-line bg-surface p-4 hover:border-accent/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-t1 group-hover:text-accent">
                    {c.country}
                  </h2>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
                    <GlobeIcon className="h-[17px] w-[17px]" />
                  </span>
                </div>

                <p className="mt-3 text-[26px] font-bold leading-none tracking-tight text-t1">
                  {fmtNumber(c.courses)}
                </p>
                <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-t3">courses</p>

                <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-t2">
                  <BuildingIcon className="h-3.5 w-3.5 text-t3" />
                  {c.universities} universit{c.universities === 1 ? 'y' : 'ies'}
                </p>

                {c.minTuition != null && c.maxTuition != null && c.maxTuition > 0 && (
                  <p className="mt-1 text-[12px] text-t3">
                    Tuition {fmtNumber(c.minTuition)}–{fmtNumber(c.maxTuition)}
                  </p>
                )}
              </Link>
            ))}
          </div>

          <ChartCard title="Deepest catalogues" subtitle="Destinations by the number of courses recorded">
            <HBarChart slices={byCourses} labelWidth="w-32" />
          </ChartCard>
        </>
      )}
    </div>
  );
}
