'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useAuthStore, usePermission } from '@/stores/authStore';
import { PermissionMatrix } from '@/components/access/PermissionMatrix';
import { Disclosure } from '@/components/access/Disclosure';
import { expandPreset, heldModules, summarize } from '@/lib/access';
import { SkeletonTable } from '@/components/Skeleton';
import {
  Badge, Button, Card, ConfirmModal, EmptyState, Field, Input, PageHeader,
} from '@/components/ui';
import { PlusIcon, ShieldIcon } from '@/components/icons';
import type { AccessSnapshot, ModuleDef, PermissionMap, Preset } from '@/types';

const errorText = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;

/** A blank preset the editor starts from when creating one. */
const blankDraft = () => ({
  key: '',
  name: '',
  description: '',
  scope: 'staff' as const,
  permissions: {} as PermissionMap,
});

export default function RolesPage() {
  const { toast } = useToast();
  const setAccess = useAuthStore((s) => s.setAccess);
  const can = usePermission();

  const [modules, setModules] = useState<ModuleDef[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(blankDraft());
  const [matrix, setMatrix] = useState<PermissionMap>({});
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<Preset | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [m, p] = await Promise.all([
      api.get<ModuleDef[]>('/access/modules'),
      api.get<Preset[]>('/access/presets'),
    ]);
    setModules(m.data);
    setPresets(p.data);
    return p.data;
  }, []);

  useEffect(() => {
    load()
      .then((p) => setSelected((cur) => cur ?? p[0]?.key ?? null))
      .catch((err) => toast(errorText(err, 'Failed to load roles'), 'error'))
      .finally(() => setLoading(false));
  }, [load, toast]);

  const current = useMemo(
    () => (creating ? null : presets.find((p) => p.key === selected) ?? null),
    [creating, presets, selected],
  );

  // Loading a preset into the editor resets the working copy of its matrix.
  useEffect(() => {
    if (creating) { setMatrix({}); return; }
    if (current && modules.length) setMatrix(expandPreset(current, modules));
  }, [current, creating, modules]);

  /** Whatever the caller just changed about their own seat takes effect now. */
  const refreshOwnAccess = async () => {
    try {
      const { data } = await api.get<AccessSnapshot>('/access/me');
      setAccess(data);
    } catch { /* the next request will pick it up */ }
  };

  async function save() {
    setSaving(true);
    try {
      if (creating) {
        const body = { ...draft, permissions: matrix };
        const { data } = await api.post<Preset>('/access/presets', body);
        await load();
        setCreating(false);
        setSelected(data.key);
        toast(`${data.name} created`, 'success');
      } else if (current) {
        await api.put(`/access/presets/${current.key}`, {
          name: current.name,
          description: current.description,
          scope: current.scope,
          permissions: matrix,
        });
        await load();
        await refreshOwnAccess();
        toast(`${current.name} saved`, 'success');
      }
    } catch (err) {
      toast(errorText(err, 'Could not save'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      const { data } = await api.delete<{ message: string }>(`/access/presets/${removing.key}`);
      const fresh = await load();
      await refreshOwnAccess();
      if (!removing.isSystem) setSelected(fresh[0]?.key ?? null);
      toast(data.message, 'success');
      setRemoving(null);
    } catch (err) {
      toast(errorText(err, 'Could not delete'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const readOnly = !can('access', 'update');

  if (loading) return <div className="p-6"><SkeletonTable rows={4} /></div>;

  return (
    <div className="animate-fade-in space-y-6 p-6">
      <PageHeader
        title="Roles & permissions"
        subtitle={
          <>
            A preset is a named set of permissions. Every screen and every action in the app
            belongs to a module, and a preset says which of those a person holds. Assign one to
            each member on the{' '}
            <Link href="/members" className="text-accent hover:underline">Members</Link> page.
          </>
        }
        actions={can('access', 'create') && (
          <Button onClick={() => { setCreating(true); setDraft(blankDraft()); setMatrix({}); }}>
            <PlusIcon className="h-4 w-4" />New preset
          </Button>
        )}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        {/* ── Preset list ─────────────────────────────────────────────── */}
        <aside className="space-y-2">
          {presets.map((preset) => {
            const active = !creating && preset.key === selected;
            const effective = modules.length ? expandPreset(preset, modules) : {};
            return (
              <button
                key={preset.key}
                type="button"
                onClick={() => { setCreating(false); setSelected(preset.key); }}
                aria-pressed={active}
                className={`hig-press w-full rounded-2xl border p-4 text-left ${
                  active ? 'border-accent/50 bg-accent/[0.07]' : 'border-line bg-surface hover:bg-muted/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-semibold text-t1">{preset.name}</span>
                  {preset.isSystem && <span className="chip chip-admin">Built-in</span>}
                  {preset.scope === 'portal' && <span className="chip chip-student">Portal</span>}
                </div>
                <p className="mt-1 text-[13px] text-t2">
                  {modules.length ? summarize(effective, modules) : '—'}
                  {typeof preset.memberCount === 'number' && (
                    <> · {preset.memberCount} {preset.memberCount === 1 ? 'member' : 'members'}</>
                  )}
                </p>
              </button>
            );
          })}

          {creating && (
            <Card className="border-accent/50 bg-accent/[0.07]" padding="sm">
              <p className="text-[15px] font-semibold text-t1">New preset</p>
              <p className="mt-1 text-[13px] text-t2">Unsaved</p>
            </Card>
          )}
        </aside>

        {/* ── Editor ──────────────────────────────────────────────────── */}
        <section className="min-w-0">
          {creating ? (
            <Card className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" required>
                  {(id) => (
                    <Input
                      id={id}
                      value={draft.name}
                      placeholder="e.g. Senior counsellor"
                      onChange={(e) => setDraft((d) => ({
                        ...d,
                        name: e.target.value,
                        // Suggest a key from the name until the key is edited by hand.
                        key: d.key || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
                      }))}
                    />
                  )}
                </Field>

                <Field label="Key" required hint="Used in records. Lowercase, no spaces.">
                  {(id) => (
                    <Input
                      id={id}
                      value={draft.key}
                      onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value.toLowerCase() }))}
                    />
                  )}
                </Field>

                <Field label="Description" className="sm:col-span-2">
                  {(id) => (
                    <Input
                      id={id}
                      value={draft.description}
                      placeholder="What this seat is for."
                      onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                    />
                  )}
                </Field>
              </div>

              <Disclosure
                summary="Advanced settings"
                detail="Choose the modules and the actions inside each one."
                defaultOpen
              >
                <PermissionMatrix modules={modules} value={matrix} onChange={setMatrix} />
              </Disclosure>

              <div className="flex flex-wrap gap-3">
                <Button onClick={save} disabled={saving || !draft.name.trim() || !draft.key.trim()}>
                  {saving ? 'Creating…' : 'Create preset'}
                </Button>
                <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
              </div>
            </Card>
          ) : current ? (
            <div className="space-y-5">
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[20px] font-semibold text-t1">{current.name}</h2>
                    <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-t2">{current.description}</p>
                  </div>
                  <Badge className="shrink-0 px-2.5 py-1 text-[12px]">
                    {current.memberCount ?? 0} {current.memberCount === 1 ? 'member' : 'members'}
                  </Badge>
                </div>

                {/* What it grants, before anyone opens the grid. */}
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {heldModules(matrix, modules).map((m) => (
                    <Badge key={m.key} tone="outline" className="bg-card px-2.5 py-1 text-[12px] text-t2">
                      {m.label}
                    </Badge>
                  ))}
                  {heldModules(matrix, modules).length === 0 && (
                    <span className="text-[13px] text-t3">This preset grants nothing yet.</span>
                  )}
                </div>

                {current.fullAccess && (
                  <p className="mt-4 rounded-xl bg-muted px-3 py-2.5 text-[13px] leading-relaxed text-t2">
                    This seat also holds any module added to the app later, so it can always
                    reach this screen. Turning a verb off below still applies.
                  </p>
                )}
              </Card>

              <Disclosure
                summary="Advanced settings"
                detail={`Every action in ${current.name} is listed here, module by module.`}
              >
                <div className="space-y-5">
                  <PermissionMatrix
                    modules={modules}
                    value={matrix}
                    onChange={setMatrix}
                    disabled={readOnly}
                  />

                  {!readOnly && (
                    <div className="flex flex-wrap gap-3">
                      <Button onClick={save} disabled={saving}>
                        {saving ? 'Saving…' : 'Save changes'}
                      </Button>
                      <Button variant="outline" onClick={() => setMatrix(expandPreset(current, modules))}>
                        Discard
                      </Button>
                      {can('access', 'delete') && (
                        <Button variant="danger" onClick={() => setRemoving(current)} className="ml-auto">
                          {current.isSystem ? 'Reset to default' : 'Delete preset'}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </Disclosure>
            </div>
          ) : (
            <EmptyState
              icon={<ShieldIcon className="h-7 w-7" />}
              title="Pick a preset"
              description="Choose one on the left to see what it grants."
            />
          )}
        </section>
      </div>

      <ConfirmModal
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={remove}
        busy={busy}
        title={removing?.isSystem ? 'Reset this preset?' : 'Delete this preset?'}
        confirmLabel={removing?.isSystem ? 'Reset to default' : 'Delete preset'}
        body={removing?.isSystem ? (
          <>
            <strong className="text-t1">{removing.name}</strong> goes back to the built-in defined
            in code. Anyone sitting in it moves with it.
          </>
        ) : (
          <>
            <strong className="text-t1">{removing?.name}</strong> will be deleted.
            {removing?.memberCount
              ? ` ${removing.memberCount} ${removing.memberCount === 1 ? 'account sits' : 'accounts sit'} in it and will fall back to their account type.`
              : ' No accounts are using it.'}
          </>
        )}
      />
    </div>
  );
}
