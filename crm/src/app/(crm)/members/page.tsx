'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { usesEmailLogin, loginHandle, USERNAME_RE } from '@/lib/credentials';
import { useAuthStore, usePermission } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import { SkeletonTable } from '@/components/Skeleton';
import { PermissionMatrix } from '@/components/access/PermissionMatrix';
import { Disclosure } from '@/components/access/Disclosure';
import { diffFromPreset, expandPreset, mergePermissions, summarize } from '@/lib/access';
import {
  Badge, Button, ConfirmModal, Field, Input, Modal, PageHeader, Select,
} from '@/components/ui';
import { Avatar, Table, TableEmpty, TD, TR } from '@/components/ui/table';
import { PlusIcon } from '@/components/icons';
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

const COLUMNS = ['Member', 'Sign-in', 'Seat', 'Phone', ''];

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
  const [deactivating, setDeactivating] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function deactivate() {
    if (!deactivating) return;
    setBusy(true);
    try {
      await api.delete(`/users/${deactivating._id}`);
      setMembers((prev) => prev.filter((u) => u._id !== deactivating._id));
      toast(`${deactivating.name} deactivated`, 'success');
      setDeactivating(null);
    } catch (err) {
      toast(errorText(err, 'Failed to deactivate'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-fade-in space-y-6 p-6">
      <PageHeader
        title="Members"
        subtitle={
          <>
            Staff and partner accounts. What each one can reach is decided by the preset in their
            seat — edit those on{' '}
            <Link href="/roles" className="text-accent hover:underline">Roles &amp; permissions</Link>.
            Student portal logins are issued from the student&rsquo;s own page, not here.
          </>
        }
        actions={can('members', 'create') && (
          <Button onClick={() => setEditing('new')}>
            <PlusIcon className="h-4 w-4" />Add member
          </Button>
        )}
      />

      {loading ? <SkeletonTable rows={5} /> : (
        <Table columns={COLUMNS}>
          {members.map((u) => (
            <TR key={u._id}>
              <TD>
                <div className="flex items-center gap-2.5">
                  <Avatar name={u.name} />
                  <span className="text-[15px] font-medium text-t1">{u.name}</span>
                  {u._id === me?._id && <span className="chip chip-admin">You</span>}
                </div>
              </TD>
              <TD>{loginHandle(u)}</TD>
              <TD>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[14px] font-medium text-t1">{u.presetName ?? u.role}</span>
                  {u.presetInherited && (
                    <Badge title="No preset saved on this account yet — it follows the account type.">
                      Inherited
                    </Badge>
                  )}
                  {u.hasOverrides && (
                    <Badge tone="warning" title="This account has permissions of its own on top of the preset.">
                      Customised
                    </Badge>
                  )}
                </div>
              </TD>
              <TD>{u.phone || '—'}</TD>
              <TD>
                <div className="flex justify-end gap-1">
                  {can('members', 'update') && (
                    <Button variant="ghost" size="sm" onClick={() => setEditing(u._id)}>Edit</Button>
                  )}
                  {can('members', 'delete') && u._id !== me?._id && (
                    <Button variant="danger" size="sm" onClick={() => setDeactivating(u)}>Deactivate</Button>
                  )}
                </div>
              </TD>
            </TR>
          ))}
          {members.length === 0 && <TableEmpty columns={COLUMNS.length}>No members yet.</TableEmpty>}
        </Table>
      )}

      <MemberSheet
        open={!!editing}
        member={target}
        presets={presets}
        modules={modules}
        onClose={() => setEditing(null)}
        onSaved={async () => { await load(); setEditing(null); }}
      />

      <ConfirmModal
        open={!!deactivating}
        onClose={() => setDeactivating(null)}
        onConfirm={deactivate}
        busy={busy}
        title="Deactivate this member?"
        confirmLabel="Deactivate"
        body={
          <>
            <strong className="text-t1">{deactivating?.name}</strong> will no longer be able to sign
            in. Their record and everything they touched stays where it is.
          </>
        }
      />
    </div>
  );
}

/* ── The create / edit sheet ────────────────────────────────────────────── */

function MemberSheet({
  open, member, presets, modules, onClose, onSaved,
}: {
  open: boolean;
  member: User | null;
  presets: Preset[];
  modules: ModuleDef[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const formId = useId();
  const isNew = !member;

  const [draft, setDraft] = useState<Draft>(BLANK);
  const [saving, setSaving] = useState(false);

  // Reset on every open, so a closed sheet never reopens holding the last
  // person's details.
  useEffect(() => {
    if (!open) return;
    setDraft(member
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
      : BLANK);
  }, [open, member]);

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
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

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
    ? Object.values(diffFromPreset(presetPermissions, matrix, modules))
      .reduce((n, verbs) => n + Object.keys(verbs).length, 0)
    : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="sheet"
      title={isNew ? 'Add member' : member?.name ?? ''}
      description={isNew ? 'Staff and partner accounts only.' : undefined}
      dismissable={!saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          {/* The form lives in the body; `form=` is what lets a footer button
              submit it without wrapping the modal's own chrome. */}
          <Button type="submit" form={formId} disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Add member' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required>
            {(id) => (
              <Input id={id} required value={draft.name} onChange={(e) => set('name', e.target.value)} />
            )}
          </Field>

          <Field
            label="Account type"
            hint={ACCOUNT_TYPES.find((t) => t.value === draft.role)?.note}
          >
            {(id) => (
              <Select
                id={id}
                value={draft.role}
                onChange={(e) => {
                  const role = e.target.value as UserRole;
                  // Keep the seat in step with the type unless one was chosen.
                  const suggested = presets.some((p) => p.key === role) ? role : draft.presetKey;
                  setDraft((d) => ({ ...d, role, presetKey: isNew ? suggested : d.presetKey }));
                }}
              >
                {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            )}
          </Field>

          {needsEmail ? (
            <Field label="Email" required hint="They sign in with this.">
              {(id) => (
                <Input id={id} type="email" required value={draft.email}
                  onChange={(e) => set('email', e.target.value)} />
              )}
            </Field>
          ) : (
            <Field label="Username" required hint="They sign in with this.">
              {(id) => (
                <Input id={id} required value={draft.username} placeholder="e.g. sarah.thompson"
                  onChange={(e) => set('username', e.target.value.toLowerCase())} />
              )}
            </Field>
          )}

          {isNew ? (
            <Field label="Password" required hint="At least 6 characters.">
              {(id) => (
                <Input id={id} type="password" required autoComplete="new-password"
                  value={draft.password} onChange={(e) => set('password', e.target.value)} />
              )}
            </Field>
          ) : !needsEmail && (
            <Field label="Email" hint="Optional — contact only.">
              {(id) => (
                <Input id={id} type="email" value={draft.email}
                  onChange={(e) => set('email', e.target.value)} />
              )}
            </Field>
          )}

          {isNew && !needsEmail && (
            <Field label="Email" hint="Optional — contact only.">
              {(id) => (
                <Input id={id} type="email" value={draft.email}
                  onChange={(e) => set('email', e.target.value)} />
              )}
            </Field>
          )}

          <Field label="Phone" hint="Optional.">
            {(id) => <Input id={id} value={draft.phone} onChange={(e) => set('phone', e.target.value)} />}
          </Field>

          {draft.role === 'university' && (
            <Field
              label="University name"
              required
              hint="Must match the name used in application records exactly."
              className="sm:col-span-2"
            >
              {(id) => (
                <Input id={id} required value={draft.universityName}
                  placeholder="e.g. University of Manchester"
                  onChange={(e) => set('universityName', e.target.value)} />
              )}
            </Field>
          )}
        </div>

        {/* ── The seat ─────────────────────────────────────────────── */}
        {presets.length > 0 ? (
          <div className="space-y-3">
            <div>
              <h3 className="text-[15px] font-semibold text-t1">Access</h3>
              <p className="mt-0.5 text-[13px] text-t2">
                Pick the preset this person sits in. Change the preset itself on Roles &amp;
                permissions, and everyone in it moves together.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {staffPresets.map((p) => {
                const active = p.key === draft.presetKey;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => set('presetKey', p.key)}
                    aria-pressed={active}
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
                  <Button variant="outline" onClick={() => setMatrix(presetPermissions)}>
                    Reset to {preset?.name ?? 'the preset'}
                  </Button>
                )}
              </div>
            </Disclosure>
          </div>
        ) : (
          <p className="rounded-xl bg-muted px-3 py-2.5 text-[13px] leading-relaxed text-t2">
            You can edit this person&rsquo;s details, but changing their access needs
            permission on Roles &amp; permissions.
          </p>
        )}
      </form>
    </Modal>
  );
}
