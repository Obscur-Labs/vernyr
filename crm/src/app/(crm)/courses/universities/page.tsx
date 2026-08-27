'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import api from '@/lib/api';
import { usePermission } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import { CourseDetail } from '@/components/courses/CourseDetail';
import { CourseForm } from '@/components/courses/CourseForm';
import { DetailRow, LevelChip, formatDuration, formatMoney } from '@/components/courses/bits';
import { Button, ButtonLink } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, EmptyState, PageHeader, SkeletonList } from '@/components/ui/card';
import { Field, Input, SearchInput, Select, Textarea } from '@/components/ui/field';
import {
  BuildingIcon, ExternalLinkIcon, PencilIcon, PlusIcon, TrashIcon,
} from '@/components/icons';
import type { Course, Paged, University } from '@/types';

/** The institutions behind the catalogue, and what each of them offers. */

interface UniversityDraft {
  name: string;
  country: string;
  city: string;
  website: string;
  type: University['type'];
  notes: string;
}

const blankDraft: UniversityDraft = {
  name: '', country: '', city: '', website: '', type: 'unknown', notes: '',
};

function UniversityForm({
  open, onClose, university, countries, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  university?: University | null;
  countries: string[];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<UniversityDraft>(blankDraft);
  const [busy, setBusy] = useState(false);
  const editing = !!university;

  useEffect(() => {
    if (!open) return;
    setDraft(university
      ? {
        name: university.name,
        country: university.country,
        city: university.city ?? '',
        website: university.website ?? '',
        type: university.type,
        notes: university.notes ?? '',
      }
      : blankDraft);
  }, [open, university]);

  const set = <K extends keyof UniversityDraft>(k: K, v: UniversityDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  async function save() {
    if (!draft.name.trim() || !draft.country.trim()) {
      toast('Name and country are both required', 'error');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: draft.name.trim(),
        country: draft.country.trim(),
        city: draft.city.trim() || undefined,
        website: draft.website.trim() || undefined,
        type: draft.type,
        notes: draft.notes.trim() || undefined,
      };
      if (editing && university) await api.put(`/catalogue/universities/${university._id}`, payload);
      else await api.post('/catalogue/universities', payload);
      toast(editing ? 'University updated' : 'University added', 'success');
      onSaved();
      onClose();
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })
        .response?.data?.message ?? 'Could not save the university';
      toast(message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit university' : 'Add a university'}
      description="A university is unique per country — the importer upserts on that pair."
      dismissable={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add university'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" required>
          {(id) => (
            <Input id={id} value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="University of Tartu" />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Country" required>
            {(id) => (
              <>
                <Input
                  id={id}
                  value={draft.country}
                  onChange={(e) => set('country', e.target.value)}
                  list="catalogue-countries"
                  placeholder="Estonia"
                />
                <datalist id="catalogue-countries">
                  {countries.map((c) => <option key={c} value={c} />)}
                </datalist>
              </>
            )}
          </Field>
          <Field label="City">
            {(id) => (
              <Input id={id} value={draft.city} onChange={(e) => set('city', e.target.value)} placeholder="Tartu" />
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Website">
            {(id) => (
              <Input id={id} value={draft.website} onChange={(e) => set('website', e.target.value)} placeholder="https://…" />
            )}
          </Field>
          <Field label="Type">
            {(id) => (
              <Select id={id} value={draft.type} onChange={(e) => set('type', e.target.value as University['type'])}>
                <option value="unknown">Not recorded</option>
                <option value="public">Public</option>
                <option value="private">Private</option>
              </Select>
            )}
          </Field>
        </div>

        <Field label="Notes">
          {(id) => (
            <Textarea id={id} value={draft.notes} onChange={(e) => set('notes', e.target.value)} rows={3} />
          )}
        </Field>
      </div>
    </Modal>
  );
}

function UniversitiesInner() {
  const params = useSearchParams();
  const can = usePermission();
  const { toast } = useToast();

  const [rows, setRows] = useState<University[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [country, setCountry] = useState(params.get('country') ?? '');

  const [open, setOpen] = useState<University | null>(null);
  const [detail, setDetail] = useState<Course[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<University | null>(null);
  const [courseFormOpen, setCourseFormOpen] = useState(false);
  const [course, setCourse] = useState<Course | null>(null);
  const [deleting, setDeleting] = useState<University | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ limit: '500' });
    if (q.trim()) p.set('q', q.trim());
    if (country) p.set('country', country);
    api.get<Paged<University>>(`/catalogue/universities?${p}`)
      .then((r) => setRows(r.data.items))
      .catch(() => toast('Could not load universities', 'error'))
      .finally(() => setLoading(false));
  }, [q, country, toast]);

  useEffect(() => { load(); }, [load]);

  const countries = useMemo(
    () => [...new Set(rows.map((r) => r.country))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const openDetail = useCallback((university: University) => {
    setOpen(university);
    setDetail(null);
    setDetailLoading(true);
    api.get<University & { courses: Course[] }>(`/catalogue/universities/${university._id}`)
      .then((r) => setDetail(r.data.courses ?? []))
      .catch(() => toast('Could not load that university', 'error'))
      .finally(() => setDetailLoading(false));
  }, [toast]);

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/catalogue/universities/${deleting._id}`);
      toast('University and its courses removed', 'success');
      setDeleting(null);
      setOpen(null);
      load();
    } catch {
      toast('Could not remove the university', 'error');
    } finally {
      setBusy(false);
    }
  }

  // Grouped by country: a flat list of 225 institutions is unreadable.
  const grouped = useMemo(() => {
    const map = new Map<string, University[]>();
    for (const row of rows) {
      const list = map.get(row.country) ?? [];
      list.push(row);
      map.set(row.country, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  return (
    <div className="animate-fade-in space-y-5 p-6">
      <PageHeader
        title="Universities"
        subtitle={loading
          ? 'Loading…'
          : `${rows.length.toLocaleString()} institutions across ${countries.length} countries`}
        actions={can('courses', 'create') && (
          <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
            <PlusIcon className="h-4 w-4" />Add university
          </Button>
        )}
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search institutions…"
          label="Search universities"
          className="min-w-[240px] flex-1"
        />
        <Select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country" className="w-auto">
          <option value="">Every country</option>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>

      {loading ? (
        <SkeletonList rows={8} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<BuildingIcon className="h-7 w-7" />}
          title="No universities match"
          description="Try a different search, or clear the country filter."
        />
      ) : (
        <div className="space-y-7">
          {grouped.map(([name, list]) => (
            <section key={name}>
              <h2 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-t3">
                {name}
                <Badge className="normal-case tracking-normal">{list.length}</Badge>
              </h2>
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {list.map((u) => (
                  <li key={u._id}>
                    <button
                      type="button"
                      onClick={() => openDetail(u)}
                      className="hig-press group flex h-full w-full items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left hover:border-accent/40"
                    >
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
                        <BuildingIcon className="h-[18px] w-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-t1 group-hover:text-accent">
                          {u.name}
                        </span>
                        <span className="mt-0.5 block text-[12px] text-t3">
                          {u.courseCount} course{u.courseCount === 1 ? '' : 's'}
                          {u.city ? ` · ${u.city}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* One university and its courses */}
      <Modal
        open={!!open}
        onClose={() => { setOpen(null); setDetail(null); }}
        title={open?.name ?? ''}
        description={open ? [open.city, open.country].filter(Boolean).join(' · ') : undefined}
        size="xl"
        footer={open && (
          <>
            {can('courses', 'delete') && (
              <Button variant="danger" size="sm" onClick={() => setDeleting(open)} className="mr-auto">
                <TrashIcon className="h-4 w-4" />Remove
              </Button>
            )}
            {open.website && (
              <ButtonLink href={open.website} external variant="secondary">
                <ExternalLinkIcon className="h-4 w-4" />Website
              </ButtonLink>
            )}
            {can('courses', 'update') && (
              <Button
                variant="secondary"
                onClick={() => { setEditing(open); setOpen(null); setFormOpen(true); }}
              >
                <PencilIcon className="h-4 w-4" />Edit
              </Button>
            )}
            {can('courses', 'create') && (
              <Button onClick={() => setCourseFormOpen(true)}>
                <PlusIcon className="h-4 w-4" />Add course
              </Button>
            )}
          </>
        )}
      >
        {open && (
          <>
            <Card tone="inset" padding="none" className="mb-5 overflow-hidden">
              <DetailRow label="Country">{open.country}</DetailRow>
              {open.city && <DetailRow label="City">{open.city}</DetailRow>}
              <DetailRow label="Type">{open.type === 'unknown' ? 'Not recorded' : open.type}</DetailRow>
              <DetailRow label="Courses listed">{open.courseCount}</DetailRow>
              {open.website && (
                <DetailRow label="Website">
                  <a href={open.website} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">
                    {open.website}
                  </a>
                </DetailRow>
              )}
              {open.notes && <DetailRow label="Notes">{open.notes}</DetailRow>}
            </Card>

            <div className="mb-2.5 flex items-center justify-between gap-3">
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-t3">Courses</h3>
              <Link
                href={`/courses?university=${open._id}`}
                className="text-[12.5px] font-medium text-accent hover:underline"
              >
                Open in the browser
              </Link>
            </div>

            {detailLoading ? (
              <SkeletonList rows={4} height={56} />
            ) : !detail?.length ? (
              <EmptyState title="No courses recorded yet" className="py-8" />
            ) : (
              <ul className="space-y-1.5">
                {detail.map((c) => (
                  <li key={c._id}>
                    <button
                      type="button"
                      onClick={() => setCourse(c)}
                      className="hig-press flex w-full items-center gap-3 rounded-lg border border-line bg-card px-3 py-2.5 text-left hover:border-accent/40"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[13.5px] font-medium text-t1">{c.name}</span>
                          <LevelChip level={c.level} />
                        </span>
                        <span className="mt-0.5 block text-[12px] text-t3">
                          {formatDuration(c.duration)}
                          {c.intakes.length ? ` · ${c.intakes.join(', ')}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-t2">
                        {formatMoney(c.tuition)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Modal>

      <CourseDetail course={course} open={!!course} onClose={() => setCourse(null)} />

      <UniversityForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        university={editing}
        countries={countries}
        onSaved={load}
      />

      <CourseForm
        open={courseFormOpen}
        onClose={() => setCourseFormOpen(false)}
        universityId={open?._id}
        onSaved={() => { load(); if (open) openDetail(open); }}
      />

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        busy={busy}
        title="Remove this university?"
        confirmLabel="Remove everything"
        body={
          <>
            <strong className="text-t1">{deleting?.name}</strong> and all {deleting?.courseCount} of its
            courses will be deleted. Re-running the importer would bring them back.
          </>
        }
      />
    </div>
  );
}

export default function UniversitiesPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-t2">Loading universities…</div>}>
      <UniversitiesInner />
    </Suspense>
  );
}
