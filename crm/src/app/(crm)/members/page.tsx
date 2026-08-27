'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { usesEmailLogin, loginHandle, USERNAME_RE } from '@/lib/credentials';
import { useAuthStore, usePermission } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import { SkeletonTable } from '@/components/Skeleton';
import { PermissionMatrix } from '@/components/access/PermissionMatrix';
import { Disclosure } from '@/components/access/Disclosure';
import { diffFromPreset, expandPreset, mergePermissions, summarize } from '@/lib/access';
import type { ModuleDef, PermissionMap, Preset, User, UserRole } from '@/types';

/** Account types. */
const ACCOUNT_TYPES: { value: UserRole; label: string; note: string }[] = [
  { value: 'counsellor', label: 'Staff', note: 'Sees the caseload assigned to them.' },
  { value: 'admin', label: 'Admin', note: 'Signs in with an email address. Not scoped to a caseload.' },
  { value: 'university', label: 'University partner', note: 'Scoped to applicants who applied to their institution.' },
];

const errorText = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;

interface Draft {
  name: string; username: string; email: string; password: string;
  role: UserRole; presetKey: string; phone: string; universityName: string;
}

const BLANK: Draft = {
  name: '', username: '', email: '', password: '',
  role: 'counsellor', presetKey: 'counsellor', phone: '', universityName: '',
};

const initials = (name: string) =>
  name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

export default function MembersPage() {
  const { user: me } = useAuthStore();
  const { toast } = useToast();
  const can = usePermission();

  const [members, setMembers] = useState<User[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [modules, setModules] = useState<ModuleDef[]>([]);
  const [loading, setLoading] = useState(true);

  /** `null` = closed, `'new'` = the create sheet, otherwise the member's id. */
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await api.get<User[]>('/users');
    setMembers(data);
    return data;
  }, []);

  useEffect(() => {
    Promise.all([
      load(),
      // Presets and modules are only needed to *draw* the seat picker. Someone
      // who may manage members but not roles still gets the rest of the page.
      can('access', 'read')
        ? Promise.all([
            api.get<Preset[]>('/access/presets').then((r) => setPresets(r.data)),
            api.get<ModuleDef[]>('/access/modules').then((r) => setModules(r.data)),
          ])
        : Promise.resolve(),
    ])
      .catch((err) => toast(errorText(err, 'Failed to load members'), 'error'))
      .finally(() => setLoading(false));
    // `can` is derived from the store and changes identity on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, toast]);

  const target = editing && editing !== 'new' ? members.find((m) => m._id === editing) ?? null : null;

  async function deactivate(member: User) {
    if (!window.confirm(`Deactivate ${member.name}? They will no longer be able to sign in.`)) return;
    try {
      await api.delete(`/users/${member._id}`);
      setMembers((prev) => prev.filter((u) => u._id !== member._id));
      toast(`${member.name} deactivated`, 'success');
    } catch (err) {
      toast(errorText(err, 'Failed to deactivate'), 'error');
    }
  }

  return (
    <div className="animate-fade-in p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-[28px] font-bold tracking-[-0.02em] text-t1">Members</h1>
          <p className="mt-1 text-[15px] leading-relaxed text-t2">
            Staff and partner accounts. What each one can reach is decided by the preset in their
            seat — edit those on{' '}
            <a href="/roles" className="text-accent hover:underline">Roles &amp; access</a>.
            Student portal logins are issued from the student&rsquo;s own page, not here.
          </p>
        </div>
        {can('members', 'create') && (
          <button onClick={() => setEditing('new')} className="hig-btn hig-btn-primary hig-press">
            Add member
          </button>
        )}
      </div>

      {loading ? <SkeletonTable rows={5} /> : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-line">
                  {['Member', 'Sign-in', 'Seat', 'Phone', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wider text-t2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((u) => (
                  <tr key={u._id} className="border-b border-line transition-colors last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[11px] font-bold text-accent">
                          {initials(u.name)}
                        </span>
                        <span className="text-[15px] font-medium text-t1">{u.name}</span>
                        {u._id === me?._id && <span className="chip chip-admin">You</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[14px] text-t2">{loginHandle(u)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[14px] font-medium text-t1">{u.presetName ?? u.role}</span>
                        {u.presetInherited && (
                          <span
                            title="No preset saved on this account yet — it follows the account type."
                            className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-t2"
                          >
                            Inherited
                          </span>
                        )}
                        {u.hasOverrides && (
                          <span
                            title="This account has permissions of its own on top of the preset."
                            className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400"
                          >
                            Customised
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[14px] text-t2">{u.phone || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {can('members', 'update') && (
                          <button
                            onClick={() => setEditing(u._id)}
                            className="hig-press rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-t2 hover:bg-muted hover:text-t1"
                          >
                            Edit
                          </button>
                        )}
                        {can('members', 'delete') && u._id !== me?._id && (
                          <button
                            onClick={() => deactivate(u)}
                            className="hig-press danger-action rounded-lg px-2.5 py-1.5 text-[13px] font-medium"
                          >
                            Deactivate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {members.length === 0 && (
                  <tr><td colSpan={5} className="py-12 text-center text-[15px] text-t3">No members yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <MemberSheet
          member={target}
          presets={presets}
          modules={modules}
          onClose={() => setEditing(null)}
          onSaved={async () => { await load(); setEditing(null); }}
        />
      )}
    </div>
  );
}

/* ── The create / edit sheet ────────────────────────────────────────────── */

function MemberSheet({
  member, presets, modules, onClose, onSaved,
}: {
  member: User | null;
  presets: Preset[];
  modules: ModuleDef[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const isNew = !member;

  const [draft, setDraft] = useState<Draft>(() =>
    member
      ? {
          name: member.name,
          username: member.username ?? '',
          email: member.email ?? '',
          password: '',
          role: member.role,
          presetKey: member.presetKey ?? member.role,
          phone: member.phone ?? '',
          universityName: member.universityName ?? '',
        }
      : BLANK,
  );
  const [saving, setSaving] = useState(false);

  /** Seats offered for staff. A portal preset is never a choice on this screen. */
  const staffPresets = useMemo(
    () => presets.filter((p) => p.scope === 'staff' || p.key === draft.presetKey),
    [presets, draft.presetKey],
  );

  const preset = presets.find((p) => p.key === draft.presetKey) ?? null;
  const presetPermissions = useMemo(
    () => (preset && modules.length ? expandPreset(preset, modules) : {}),
    [preset, modules],
  );

  // The working copy of the matrix: the preset, with this account's own
  // overrides laid over it. Saving stores only the difference.
  const [matrix, setMatrix] = useState<PermissionMap>({});
  useEffect(() => {
    setMatrix(mergePermissions(presetPermissions, member?.permissions ?? {}));
  }, [presetPermissions, member]);

  const needsEmail = usesEmailLogin(draft.role);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    if (needsEmail && !draft.email.trim()) {
      toast('Admin accounts sign in with an email address', 'error'); return;
    }
    if (!needsEmail && !USERNAME_RE.test(draft.username.trim().toLowerCase())) {
      toast('Username must be 3–32 characters: letters, numbers, dot, underscore or hyphen', 'error'); return;
    }
    if (isNew && draft.password.length < 6) {
      toast('Password must be at least 6 characters', 'error'); return;
    }
    if (draft.role === 'university' && !draft.universityName.trim()) {
      toast('University accounts need the institution name', 'error'); return;
    }

    // Only what the account actually holds beyond its preset gets stored, so a
    // later change to the preset still reaches everyone sitting in it.
    const overrides = modules.length ? diffFromPreset(presetPermissions, matrix, modules) : {};

    const payload: Record<string, unknown> = {
      name: draft.name.trim(),
      role: draft.role,
      presetKey: draft.presetKey,
      permissions: overrides,
      // Sent even when blank so clearing a field actually clears it; the server
      // turns an empty credential into an unset rather than an empty string.
      username: draft.username.trim().toLowerCase(),
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      universityName: draft.universityName.trim(),
    };
    if (isNew) payload.password = draft.password;

    setSaving(true);
    try {
      if (isNew) {
        // A create cannot carry empty strings into the unique index.
        for (const key of ['username', 'email', 'phone', 'universityName']) {
          if (!payload[key]) delete payload[key];
        }
        await api.post('/users', payload);
        toast(`${draft.name} added`, 'success');
      } else {
        await api.put(`/users/${member!._id}`, payload);
        toast(`${draft.name} updated`, 'success');
      }
      await onSaved();
    } catch (err) {
      toast(errorText(err, isNew ? 'Failed to add member' : 'Failed to save'), 'error');
    } finally {
      setSaving(false);
    }
  }

  const overrideCount = modules.length
    ? Object.values(diffFromPreset(presetPermissions, matrix, modules)).reduce(
        (n, verbs) => n + Object.keys(verbs).length, 0)
    : 0;

  return (
    <>
      <div className="overlay-scrim animate-backdrop-in fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? 'Add member' : `Edit ${member!.name}`}
        className="overlay-panel animate-sheet-in fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-2xl flex-col rounded-none border-y-0 border-r-0 sm:rounded-l-3xl"
      >
        <div className="flex h-[var(--chrome-h)] shrink-0 items-center justify-between border-b border-line px-5">
          <h2 className="text-[17px] font-semibold text-t1">{isNew ? 'Add member' : member!.name}</h2>
          <button
            type="button" onClick={onClose} aria-label="Close"
            className="hig-press grid h-9 w-9 place-items-center rounded-lg text-t2 hover:bg-muted hover:text-t1"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" required value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />

              <Select
                label="Account type"
                value={draft.role}
                onChange={(v) => {
                  const role = v as UserRole;
                  // Keep the seat in step with the type unless one was chosen.
                  const suggested = presets.some((p) => p.key === role) ? role : draft.presetKey;
                  setDraft({ ...draft, role, presetKey: isNew ? suggested : draft.presetKey });
                }}
                options={ACCOUNT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                hint={ACCOUNT_TYPES.find((t) => t.value === draft.role)?.note}
              />

              {needsEmail ? (
                <Field label="Email" required type="email" value={draft.email}
                  onChange={(v) => setDraft({ ...draft, email: v })} hint="They sign in with this." />
              ) : (
                <Field label="Username" required value={draft.username}
                  onChange={(v) => setDraft({ ...draft, username: v.toLowerCase() })}
                  placeholder="e.g. sarah.thompson" hint="They sign in with this." />
              )}

              {isNew ? (
                <Field label="Password" required type="password" value={draft.password}
                  onChange={(v) => setDraft({ ...draft, password: v })} hint="At least 6 characters." />
              ) : (
                !needsEmail && (
                  <Field label="Email" type="email" value={draft.email}
                    onChange={(v) => setDraft({ ...draft, email: v })} hint="Optional — contact only." />
                )
              )}

              {isNew && !needsEmail && (
                <Field label="Email" type="email" value={draft.email}
                  onChange={(v) => setDraft({ ...draft, email: v })} hint="Optional — contact only." />
              )}

              <Field label="Phone" value={draft.phone} onChange={(v) => setDraft({ ...draft, phone: v })} hint="Optional." />

              {draft.role === 'university' && (
                <div className="sm:col-span-2">
                  <Field label="University name" required value={draft.universityName}
                    onChange={(v) => setDraft({ ...draft, universityName: v })}
                    placeholder="e.g. University of Manchester"
                    hint="Must match the name used in application records exactly." />
                </div>
              )}
            </div>

            {/* ── The seat ─────────────────────────────────────────────── */}
            {presets.length > 0 ? (
              <div className="space-y-3">
                <div>
                  <h3 className="text-[15px] font-semibold text-t1">Access</h3>
                  <p className="mt-0.5 text-[13px] text-t2">
                    Pick the preset this person sits in. Change the preset itself on Roles &amp; access,
                    and everyone in it moves together.
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {staffPresets.map((p) => {
                    const active = p.key === draft.presetKey;
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => setDraft({ ...draft, presetKey: p.key })}
                        className={`hig-press rounded-xl border p-3 text-left ${
                          active ? 'border-accent/50 bg-accent/[0.07]' : 'border-line bg-card hover:bg-muted/60'
                        }`}
                      >
                        <span className="block text-[14px] font-semibold text-t1">{p.name}</span>
                        <span className="mt-0.5 block text-[12px] text-t2">
                          {modules.length ? summarize(expandPreset(p, modules), modules) : '—'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {member?.presetInherited && (
                  <p className="rounded-xl bg-muted px-3 py-2.5 text-[13px] leading-relaxed text-t2">
                    This account has never had a preset saved — it currently follows its account
                    type. Saving here writes the seat explicitly.
                  </p>
                )}

                <Disclosure
                  summary="Advanced settings"
                  detail={
                    overrideCount
                      ? `${overrideCount} ${overrideCount === 1 ? 'permission differs' : 'permissions differ'} from ${preset?.name ?? 'the preset'}.`
                      : `Grant or revoke individual actions for ${draft.name || 'this person'} only.`
                  }
                >
                  <div className="space-y-4">
                    <PermissionMatrix
                      modules={modules}
                      value={matrix}
                      onChange={setMatrix}
                      baseline={presetPermissions}
                      baselineLabel={preset?.name ?? 'the preset'}
                    />
                    {overrideCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setMatrix(presetPermissions)}
                        className="hig-btn hig-press bg-muted text-t1 hover:bg-line"
                      >
                        Reset to {preset?.name ?? 'the preset'}
                      </button>
                    )}
                  </div>
                </Disclosure>
              </div>
            ) : (
              <p className="rounded-xl bg-muted px-3 py-2.5 text-[13px] leading-relaxed text-t2">
                You can edit this person&rsquo;s details, but changing their access needs
                permission on Roles &amp; access.
              </p>
            )}
          </div>

          <div className="flex shrink-0 gap-3 border-t border-line p-5">
            <button type="submit" disabled={saving} className="hig-btn hig-btn-primary hig-press">
              {saving ? 'Saving…' : isNew ? 'Add member' : 'Save changes'}
            </button>
            <button type="button" onClick={onClose} className="hig-btn hig-press bg-muted text-t1 hover:bg-line">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

/* ── Form primitives ────────────────────────────────────────────────────── */

function Field({ label, value, onChange, required, type = 'text', placeholder, hint }: {
  label: string; value: string; onChange: (v: string) => void;
  required?: boolean; type?: string; placeholder?: string; hint?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-medium text-t2">
        {label}{required && <span className="ml-0.5 text-t3">*</span>}
      </label>
      <input
        type={type}
        required={required}
        value={value}
        placeholder={placeholder}
        autoComplete={type === 'password' ? 'new-password' : 'off'}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3.5 text-[15px] text-t1 placeholder:text-t3 focus:border-accent focus:outline-none"
      />
      {hint && <p className="mt-1 text-[12px] leading-snug text-t3">{hint}</p>}
    </div>
  );
}

function Select({ label, value, onChange, options, hint }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; hint?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-medium text-t2">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3 text-[15px] text-t1 focus:border-accent focus:outline-none"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <p className="mt-1 text-[12px] leading-snug text-t3">{hint}</p>}
    </div>
  );
}
