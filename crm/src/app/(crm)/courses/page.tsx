'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import api from '@/lib/api';
import { usePermission } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import { Modal, ConfirmModal } from '@/components/ui/Modal';
import { CourseDetail } from '@/components/courses/CourseDetail';
import { CourseForm } from '@/components/courses/CourseForm';
import { FilterGroup, FilterPill, LevelChip, formatDuration, formatMoney } from '@/components/courses/bits';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, EmptyState, PageHeader, SkeletonList } from '@/components/ui/card';
import { Input, SearchInput, Select } from '@/components/ui/field';
import { PlusIcon, SearchIcon, SlidersIcon } from '@/components/icons';
import { COURSE_LEVEL_LABELS, type Course, type CourseFacets, type Paged } from '@/types';

/**
 * The catalogue browser.
 *
 * Filters live in the URL, so a filtered view is a link — that is what lets the
 * countries and universities pages hand off to this one, and what makes a
 * shortlist something a counsellor can paste to a colleague.
 */

const PAGE_SIZE = 40;

const SORTS = [
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'university', label: 'University' },
  { value: 'country', label: 'Country' },
  { value: 'tuition_asc', label: 'Tuition — low to high' },
  { value: 'tuition_desc', label: 'Tuition — high to low' },
  { value: 'duration', label: 'Shortest first' },
  { value: 'newest', label: 'Recently added' },
];

/** Every filter the page understands, and how it survives a reload. */
interface Filters {
  q: string;
  country: string[];
  level: string[];
  intake: string[];
  exam: string[];
  discipline: string[];
  university: string[];
  minTuition: string;
  maxTuition: string;
  sort: string;
}

const MULTI = ['country', 'level', 'intake', 'exam', 'discipline', 'university'] as const;
type MultiKey = (typeof MULTI)[number];

const EMPTY: Filters = {
  q: '', country: [], level: [], intake: [], exam: [], discipline: [],
  university: [], minTuition: '', maxTuition: '', sort: 'name',
};

function readFilters(params: URLSearchParams): Filters {
  const next: Filters = { ...EMPTY };
  next.q = params.get('q') ?? '';
  next.minTuition = params.get('minTuition') ?? '';
  next.maxTuition = params.get('maxTuition') ?? '';
  next.sort = params.get('sort') ?? 'name';
  for (const key of MULTI) {
    const raw = params.get(key);
    next[key] = raw ? raw.split(',').filter(Boolean) : [];
  }
  return next;
}

function toQuery(filters: Filters, page: number): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set('q', filters.q.trim());
  for (const key of MULTI) {
    if (filters[key].length) params.set(key, filters[key].join(','));
  }
  if (filters.minTuition) params.set('minTuition', filters.minTuition);
  if (filters.maxTuition) params.set('maxTuition', filters.maxTuition);
  if (filters.sort !== 'name') params.set('sort', filters.sort);
  if (page > 1) params.set('page', String(page));
  return params.toString();
}

const activeCount = (f: Filters) =>
  MULTI.reduce((n, key) => n + f[key].length, 0) + (f.minTuition ? 1 : 0) + (f.maxTuition ? 1 : 0);

function CoursesInner() {
  const router = useRouter();
  const params = useSearchParams();
  const can = usePermission();
  const { toast } = useToast();

  const [filters, setFilters] = useState<Filters>(() => readFilters(new URLSearchParams(params.toString())));
  const [search, setSearch] = useState(filters.q);
  const [page, setPage] = useState(Number(params.get('page')) || 1);

  const [result, setResult] = useState<Paged<Course> | null>(null);
  const [facets, setFacets] = useState<CourseFacets | null>(null);
  const [loading, setLoading] = useState(true);

  const [detail, setDetail] = useState<Course | null>(null);
  const [editing, setEditing] = useState<Course | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Course | null>(null);
  const [busy, setBusy] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const mayWrite = can('courses', 'create') || can('courses', 'update');

  // The box types faster than the server answers; commit after a pause.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.q === search ? f : { ...f, q: search }));
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(() => toQuery(filters, page), [filters, page]);

  // The URL is the filter state's home; this keeps it in step without pushing
  // a history entry for every keystroke.
  useEffect(() => {
    router.replace(query ? `/courses?${query}` : '/courses', { scroll: false });
  }, [query, router]);

  const load = useCallback(() => {
    setLoading(true);
    const withLimit = `${query}${query ? '&' : ''}limit=${PAGE_SIZE}`;
    Promise.all([
      api.get<Paged<Course>>(`/catalogue/courses?${withLimit}`),
      api.get<CourseFacets>(`/catalogue/courses/facets?${query}`),
    ])
      .then(([courses, f]) => { setResult(courses.data); setFacets(f.data); })
      .catch(() => toast('Could not load the catalogue', 'error'))
      .finally(() => setLoading(false));
  }, [query, toast]);

  useEffect(() => { load(); }, [load]);

  const toggle = (key: MultiKey, value: string) => {
    setFilters((f) => ({
      ...f,
      [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value],
    }));
    setPage(1);
  };

  const clearAll = () => {
    setFilters({ ...EMPTY, sort: filters.sort });
    setSearch('');
    setPage(1);
  };

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/catalogue/courses/${deleting._id}`);
      toast('Course removed', 'success');
      setDeleting(null);
      setDetail(null);
      load();
    } catch {
      toast('Could not remove the course', 'error');
    } finally {
      setBusy(false);
    }
  }

  const pills = [
    ...MULTI.flatMap((key) =>
      filters[key].map((value) => ({
        key: `${key}:${value}`,
        label: key === 'level'
          ? COURSE_LEVEL_LABELS[value as keyof typeof COURSE_LEVEL_LABELS] ?? value
          : value,
        remove: () => toggle(key, value),
      })),
    ),
    ...(filters.minTuition
      ? [{ key: 'min', label: `≥ ${filters.minTuition}`, remove: () => setFilters((f) => ({ ...f, minTuition: '' })) }]
      : []),
    ...(filters.maxTuition
      ? [{ key: 'max', label: `≤ ${filters.maxTuition}`, remove: () => setFilters((f) => ({ ...f, maxTuition: '' })) }]
      : []),
  ];

  const filterPanel = facets && (
    <>
      <FilterGroup
        title="Level"
        options={facets.levels}
        selected={filters.level}
        onToggle={(v) => toggle('level', v)}
        labels={COURSE_LEVEL_LABELS}
      />
      <FilterGroup
        title="Country"
        options={facets.countries}
        selected={filters.country}
        onToggle={(v) => toggle('country', v)}
        searchable
      />
      <FilterGroup
        title="Intake"
        options={facets.intakes}
        selected={filters.intake}
        onToggle={(v) => toggle('intake', v)}
        searchable
      />
      <FilterGroup
        title="Entry exam"
        options={facets.exams}
        selected={filters.exam}
        onToggle={(v) => toggle('exam', v)}
        visible={5}
      />
      {facets.disciplines.length > 0 && (
        <FilterGroup
          title="Discipline"
          options={facets.disciplines}
          selected={filters.discipline}
          onToggle={(v) => toggle('discipline', v)}
          searchable
        />
      )}

      <section className="border-t border-line py-4">
        <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wider text-t3">
          Annual tuition
        </h3>
        <div className="flex items-center gap-2">
          <Input
            size="sm"
            type="number"
            inputMode="numeric"
            value={filters.minTuition}
            onChange={(e) => { setFilters((f) => ({ ...f, minTuition: e.target.value })); setPage(1); }}
            placeholder="Min"
            aria-label="Minimum tuition"
          />
          <span className="text-t3">–</span>
          <Input
            size="sm"
            type="number"
            inputMode="numeric"
            value={filters.maxTuition}
            onChange={(e) => { setFilters((f) => ({ ...f, maxTuition: e.target.value })); setPage(1); }}
            placeholder="Max"
            aria-label="Maximum tuition"
          />
        </div>
        {facets.currencies.length > 0 && (
          <p className="mt-2 text-[11.5px] text-t3">
            Most courses are priced in {facets.currencies[0].value}.
          </p>
        )}
      </section>
    </>
  );

  return (
    <div className="animate-fade-in space-y-4 p-6">
      <PageHeader
        title="Courses"
        subtitle={loading && !result
          ? 'Searching the catalogue…'
          : `${(result?.total ?? 0).toLocaleString()} course${result?.total === 1 ? '' : 's'} across the catalogue`}
        actions={can('courses', 'create') && (
          <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
            <PlusIcon className="h-4 w-4" />Add course
          </Button>
        )}
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search courses, universities, disciplines…"
          label="Search the catalogue"
          className="min-w-[240px] flex-1"
        />

        <Select
          value={filters.sort}
          onChange={(e) => { setFilters((f) => ({ ...f, sort: e.target.value })); setPage(1); }}
          aria-label="Sort"
          className="w-auto"
        >
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>

        <Button variant="outline" onClick={() => setFiltersOpen(true)} className="lg:hidden">
          <SlidersIcon className="h-4 w-4" />
          Filters
          {activeCount(filters) > 0 && <Badge tone="accent">{activeCount(filters)}</Badge>}
        </Button>
      </div>

      {pills.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {pills.map((p) => <FilterPill key={p.key} label={p.label} onRemove={p.remove} />)}
          <Button variant="ghost" size="sm" onClick={clearAll} className="text-t3">Clear all</Button>
        </div>
      )}

      <div className="flex gap-6">
        <aside className="hidden w-64 shrink-0 lg:block">
          <Card padding="none" className="sticky top-4 px-4 py-2">
            {facets ? filterPanel : <div className="h-96 animate-pulse rounded-xl bg-muted" />}
          </Card>
        </aside>

        <div className="min-w-0 flex-1">
          {loading && !result ? (
            <SkeletonList rows={8} height={70} />
          ) : !result?.items.length ? (
            <EmptyState
              icon={<SearchIcon className="h-7 w-7" />}
              title="No courses match"
              description="Loosen a filter, or search for something broader."
              action={activeCount(filters) > 0 && (
                <Button variant="secondary" onClick={clearAll}>Clear filters</Button>
              )}
            />
          ) : (
            <>
              <ul
                className="space-y-2"
                style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 150ms' }}
              >
                {result.items.map((course) => (
                  <li key={course._id}>
                    <button
                      type="button"
                      onClick={() => setDetail(course)}
                      className="hig-press group flex w-full items-center gap-4 rounded-xl border border-line bg-surface px-4 py-3 text-left hover:border-accent/40"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[14.5px] font-semibold text-t1 group-hover:text-accent">
                            {course.name}
                          </span>
                          <LevelChip level={course.level} />
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12.5px] text-t3">
                          <span className="truncate font-medium text-t2">{course.universityName}</span>
                          <span aria-hidden>·</span>
                          <span>{course.country}</span>
                          {course.intakes.length > 0 && (
                            <>
                              <span aria-hidden>·</span>
                              <span className="truncate">{course.intakes.join(', ')}</span>
                            </>
                          )}
                        </span>
                      </span>

                      <span className="hidden w-24 shrink-0 text-right text-[12.5px] text-t2 sm:block">
                        {formatDuration(course.duration)}
                      </span>
                      <span className="hidden w-32 shrink-0 text-right text-[13px] font-semibold tabular-nums text-t1 md:block">
                        {formatMoney(course.tuition)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              {result.pages > 1 && (
                <nav className="mt-5 flex items-center justify-center gap-3" aria-label="Pagination">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(p - 1, 1))}
                    disabled={page <= 1}
                  >
                    Previous
                  </Button>
                  <span className="text-[13px] tabular-nums text-t2">
                    Page {result.page} of {result.pages}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(p + 1, result.pages))}
                    disabled={page >= result.pages}
                  >
                    Next
                  </Button>
                </nav>
              )}
            </>
          )}
        </div>
      </div>

      {/* Filters as a sheet on small screens */}
      <Modal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        variant="sheet"
        footer={
          <>
            <Button variant="secondary" onClick={clearAll} className="mr-auto">Clear all</Button>
            <Button onClick={() => setFiltersOpen(false)}>
              Show {(result?.total ?? 0).toLocaleString()} results
            </Button>
          </>
        }
      >
        {filterPanel}
      </Modal>

      <CourseDetail
        course={detail}
        open={!!detail}
        onClose={() => setDetail(null)}
        onEdit={mayWrite ? () => { setEditing(detail); setDetail(null); setFormOpen(true); } : undefined}
        onDelete={can('courses', 'delete') ? () => setDeleting(detail) : undefined}
      />

      <CourseForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        course={editing}
        onSaved={load}
      />

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        busy={busy}
        title="Remove this course?"
        confirmLabel="Remove course"
        body={
          <>
            <strong className="text-t1">{deleting?.name}</strong> at {deleting?.universityName} will be
            deleted from the catalogue. Re-running the importer would bring it back.
          </>
        }
      />
    </div>
  );
}

export default function CoursesPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-t2">Loading the catalogue…</div>}>
      <CoursesInner />
    </Suspense>
  );
}
