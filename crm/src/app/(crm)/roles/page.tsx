'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useAuthStore, usePermission } from '@/stores/authStore';
import { PermissionMatrix } from '@/components/access/PermissionMatrix';
import { Disclosure } from '@/components/access/Disclosure';
import { expandPreset, heldModules, summarize } from '@/lib/access';
import { SkeletonTable } from '@/components/Skeleton';
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

  async function remove(preset: Preset) {
    const question = preset.isSystem
      ? `Reset ${preset.name} to its built-in defaults?`
      : `Delete the ${preset.name} preset?`;
    if (!window.confirm(question)) return;
    try {
      const { data } = await api.delete<{ message: string }>(`/access/presets/${preset.key}`);
      const fresh = await load();
      await refreshOwnAccess();
      if (!preset.isSystem) setSelected(fresh[0]?.key ?? null);
      toast(data.message, 'success');
    } catch (err) {
      toast(errorText(err, 'Could not delete'), 'error');
    }
  }

  const readOnly = !can('access', 'update');

  if (loading) return <div className="p-6"><SkeletonTable rows={4} /></div>;

  return (
    <div className="animate-fade-in p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-[28px] font-bold tracking-[-0.02em] text-t1">Roles &amp; access</h1>
          <p className="mt-1 text-[15px] leading-relaxed text-t2">
            A preset is a named set of permissions. Every screen and every action in the app
            belongs to a module, and a preset says which of those a person holds. Assign one to
            each member on the{' '}
            <a href="/members" className="text-accent hover:underline">Members</a> page.
          </p>
        </div>
        {can('access', 'create') && (
          <button
            onClick={() => { setCreating(true); setDraft(blankDraft()); setMatrix({}); }}
            className="hig-btn hig-btn-primary hig-press"
          >
            New preset
          </button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        {/* ── Preset list ─────────────────────────────────────────────── */}
        <aside className="space-y-2">
          {presets.map((preset) => {
            const active = !creating && preset.key === selected;
            const effective = modules.length ? expandPreset(preset, modules) : {};
            return (
              <button
                key={preset.key}
                onClick={() => { setCreating(false); setSelected(preset.key); }}
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
            <div className="rounded-2xl border border-accent/50 bg-accent/[0.07] p-4">
              <p className="text-[15px] font-semibold text-t1">New preset</p>
              <p className="mt-1 text-[13px] text-t2">Unsaved</p>
            </div>
          )}
        </aside>

        {/* ── Editor ──────────────────────────────────────────────────── */}
        <section className="min-w-0">
          {creating ? (
            <div className="space-y-5 rounded-2xl border border-line bg-surface p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Name" required value={draft.name}
                  onChange={(v) => setDraft({
                    ...draft,
                    name: v,
                    // Suggest a key from the name until the key is edited by hand.
                    key: draft.key || v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
                  })}
                  placeholder="e.g. Senior counsellor"
                />
                <TextField
                  label="Key" required value={draft.key}
                  onChange={(v) => setDraft({ ...draft, key: v.toLowerCase() })}
                  hint="Used in records. Lowercase, no spaces."
                />
                <div className="sm:col-span-2">
                  <TextField
                    label="Description" value={draft.description}
                    onChange={(v) => setDraft({ ...draft, description: v })}
                    placeholder="What this seat is for."
                  />
                </div>
              </div>

              <Disclosure
                summary="Advanced settings"
                detail="Choose the modules and the actions inside each one."
                defaultOpen
              >
                <PermissionMatrix modules={modules} value={matrix} onChange={setMatrix} />
              </Disclosure>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={save}
                  disabled={saving || !draft.name.trim() || !draft.key.trim()}
                  className="hig-btn hig-btn-primary hig-press"
                >
                  {saving ? 'Creating…' : 'Create preset'}
                </button>
                <button onClick={() => setCreating(false)} className="hig-btn hig-press bg-muted text-t1 hover:bg-line">
                  Cancel
                </button>
              </div>
            </div>
          ) : current ? (
            <div className="space-y-5">
              <div className="rounded-2xl border border-line bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[20px] font-semibold text-t1">{current.name}</h2>
                    <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-t2">{current.description}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[12px] font-medium text-t2">
                    {current.memberCount ?? 0} {current.memberCount === 1 ? 'member' : 'members'}
                  </span>
                </div>

                {/* What it grants, before anyone opens the grid. */}
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {heldModules(matrix, modules).map((m) => (
                    <span key={m.key} className="rounded-full border border-line bg-card px-2.5 py-1 text-[12px] text-t2">
                      {m.label}
                    </span>
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
              </div>

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
                      <button onClick={save} disabled={saving} className="hig-btn hig-btn-primary hig-press">
                        {saving ? 'Saving…' : 'Save changes'}
                      </button>
                      <button
                        onClick={() => setMatrix(expandPreset(current, modules))}
                        className="hig-btn hig-press bg-muted text-t1 hover:bg-line"
                      >
                        Discard
                      </button>
                      {can('access', 'delete') && (
                        <button
                          onClick={() => remove(current)}
                          className="hig-btn hig-press danger-action ml-auto"
                        >
                          {current.isSystem ? 'Reset to default' : 'Delete preset'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </Disclosure>
            </div>
          ) : (
            <p className="rounded-2xl border border-line bg-surface p-8 text-center text-[15px] text-t3">
              Pick a preset to see what it grants.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function TextField({
  label, value, onChange, required, placeholder, hint,
}: {
  label: string; value: string; onChange: (v: string) => void;
  required?: boolean; placeholder?: string; hint?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-medium text-t2">
        {label}{required && <span className="ml-0.5 text-t3">*</span>}
      </label>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3.5 text-[15px] text-t1 placeholder:text-t3 focus:border-accent focus:outline-none"
      />
      {hint && <p className="mt-1 text-[12px] text-t3">{hint}</p>}
    </div>
  );
}
