'use client';

import { Suspense, useCallback, useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import api from '@/lib/api';
import { USERNAME_RE } from '@/lib/credentials';
import { usePermission } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import { SkeletonTable } from '@/components/Skeleton';
import { timeAgo } from '@/lib/format';
import {
  Badge, Button, ConfirmModal, Field, Input, Modal, PageHeader,
  SearchInput, Segmented, Select,
} from '@/components/ui';
import { Avatar, Table, TableEmpty, TD, TR } from '@/components/ui/table';
import { PlusIcon } from '@/components/icons';
import type { PortalAccount, Preset, Student } from '@/types';

const errorText = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;

type Filter = 'all' | 'student' | 'university';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'student', label: 'Students' },
  { value: 'university', label: 'Universities' },
];

const COLUMNS = ['Account', 'Signs in as', 'Scope', 'Seat', 'Last seen', ''];

const studentName = (a: PortalAccount) =>
  typeof a.studentId === 'object' && a.studentId ? a.studentId.personal?.name ?? '—' : '—';

function PortalAccountsInner() {
  const { toast } = useToast();
  const can = usePermission();
  const params = useSearchParams();

  const [rows, setRows] = useState<PortalAccount[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  // The sidebar splits this page into "Student logins" and "University
  // logins", which are the same screen with the filter pre-set.
  const initialFilter = params.get('role');
  const [filter, setFilter] = useState<Filter>(
    initialFilter === 'student' || initialFilter === 'university' ? initialFilter : 'all',
  );
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<PortalAccount | null>(null);
  const [deactivating, setDeactivating] = useState<PortalAccount | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const search = new URLSearchParams();
    if (filter !== 'all') search.set('role', filter);
    if (q.trim()) search.set('q', q.trim());
    const { data } = await api.get<PortalAccount[]>(`/portal-accounts?${search}`);
    setRows(data);
  }, [filter, q]);

  useEffect(() => {
    load()
      .catch((err) => toast(errorText(err, 'Failed to load portal accounts'), 'error'))
      .finally(() => setLoading(false));
  }, [load, toast]);

  useEffect(() => {
    const role = params.get('role');
    setFilter(role === 'student' || role === 'university' ? role : 'all');
  }, [params]);

  useEffect(() => {
    if (!can('access', 'read')) return;
    api.get<Preset[]>('/access/presets')
      .then((r) => setPresets(r.data.filter((p) => p.scope === 'portal')))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function deactivate() {
    if (!deactivating) return;
    setBusy(true);
    try {
      await api.delete(`/portal-accounts/${deactivating._id}`);
      setRows((prev) => prev.filter((r) => r._id !== deactivating._id));
      toast(`${deactivating.name} deactivated`, 'success');
      setDeactivating(null);
    } catch (err) {
      toast(errorText(err, 'Could not deactivate'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-fade-in space-y-5 p-6">
      <PageHeader
        title="Portal accounts"
        subtitle={
          <>
            Logins for the people outside the office — students and university partners. Staff
            accounts live on <Link href="/members" className="text-accent hover:underline">Members</Link>.
          </>
        }
        actions={can('portal_accounts', 'create') && (
          <Button onClick={() => setCreating(true)}>
            <PlusIcon className="h-4 w-4" />Issue a login
          </Button>
        )}
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <Segmented label="Account kind" value={filter} onChange={setFilter} options={FILTERS} />
        <SearchInput
          value={q}
          onValueChange={setQ}
          placeholder="Search name, username or institution…"
          label="Search portal accounts"
          className="min-w-[16rem] flex-1"
        />
      </div>

      {loading ? <SkeletonTable rows={5} /> : (
        <Table columns={COLUMNS} minWidth={760}>
          {rows.map((a) => (
            <TR key={a._id}>
              <TD>
                <div className="flex items-center gap-2.5">
                  <Avatar name={a.name} />
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium text-t1">{a.name}</p>
                    <p className="text-[12px] capitalize text-t3">{a.role}</p>
                  </div>
                </div>
              </TD>
              <TD>{a.username ?? a.email ?? '—'}</TD>
              <TD>{a.role === 'student' ? studentName(a) : a.universityName ?? '—'}</TD>
              <TD>
                <span className="text-[14px] text-t2">{a.presetName ?? a.role}</span>
                {a.hasOverrides && <Badge tone="warning" className="ml-1.5">Customised</Badge>}
              </TD>
              <TD className="text-t3">{a.lastSeenAt ? timeAgo(a.lastSeenAt) : 'never'}</TD>
              <TD>
                <div className="flex justify-end gap-1">
                  {can('portal_accounts', 'update') && (
                    <Button variant="ghost" size="sm" onClick={() => setResetting(a)}>Reset password</Button>
                  )}
                  {can('portal_accounts', 'delete') && (
                    <Button variant="danger" size="sm" onClick={() => setDeactivating(a)}>Deactivate</Button>
                  )}
                </div>
              </TD>
            </TR>
          ))}
          {rows.length === 0 && (
            <TableEmpty columns={COLUMNS.length}>
              {q ? `Nothing matches “${q}”.` : 'No portal logins yet.'}
            </TableEmpty>
          )}
        </Table>
      )}

      <IssueSheet
        open={creating}
        presets={presets}
        onClose={() => setCreating(false)}
        onIssued={async () => { await load(); setCreating(false); }}
      />

      <ResetPasswordModal
        account={resetting}
        onClose={() => setResetting(null)}
      />

      <ConfirmModal
        open={!!deactivating}
        onClose={() => setDeactivating(null)}
        onConfirm={deactivate}
        busy={busy}
        title="Deactivate this login?"
        confirmLabel="Deactivate"
        body={
          <>
            <strong className="text-t1">{deactivating?.name}</strong> will no longer be able to sign
            in to the portal. Their student record is untouched.
          </>
        }
      />
    </div>
  );
}

/* ── Reset a password ───────────────────────────────────────────────────── */

/**
 * `window.prompt` used to do this. It blocks the thread, ignores the theme,
 * cannot validate a length, and shows the new password in plain text.
 */
function ResetPasswordModal({
  account, onClose,
}: {
  account: PortalAccount | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (account) setPassword(''); }, [account]);

  const tooShort = password.length > 0 && password.length < 6;

  async function submit() {
    if (!account) return;
    if (password.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
    setBusy(true);
    try {
      const { data } = await api.patch<{ message: string }>(
        `/portal-accounts/${account._id}/password`, { password },
      );
      toast(data.message, 'success');
      onClose();
    } catch (err) {
      toast(errorText(err, 'Could not reset the password'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!account}
      onClose={onClose}
      size="sm"
      title="Reset password"
      description={account ? `A new password for ${account.name}. Tell them what it is — it is not emailed.` : undefined}
      dismissable={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || password.length < 6}>
            {busy ? 'Setting…' : 'Set password'}
          </Button>
        </>
      }
    >
      <Field
        label="New password"
        required
        hint="At least 6 characters."
        error={tooShort ? 'Too short — 6 characters minimum.' : null}
      >
        {(id) => (
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            value={password}
            invalid={tooShort}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && password.length >= 6) submit(); }}
          />
        )}
      </Field>
    </Modal>
  );
}

/* ── Issue a login ──────────────────────────────────────────────────────── */

const BLANK_FORM = {
  name: '', username: '', email: '', password: '',
  studentId: '', universityName: '', presetKey: '',
};

function IssueSheet({
  open, presets, onClose, onIssued,
}: {
  open: boolean;
  presets: Preset[];
  onClose: () => void;
  onIssued: () => Promise<void>;
}) {
  const { toast } = useToast();
  const formId = useId();
  const [role, setRole] = useState<'student' | 'university'>('student');
  const [form, setForm] = useState(BLANK_FORM);
  const [students, setStudents] = useState<Student[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(BLANK_FORM);
    setRole('student');
  }, [open]);

  useEffect(() => {
    if (!open || role !== 'student' || students.length) return;
    api.get<Student[]>('/students').then((r) => setStudents(r.data)).catch(() => {});
  }, [open, role, students.length]);

  const set = <K extends keyof typeof BLANK_FORM>(key: K, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!USERNAME_RE.test(form.username.trim().toLowerCase())) {
      toast('Username must be 3–32 characters: letters, numbers, dot, underscore or hyphen', 'error'); return;
    }
    if (form.password.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
    if (role === 'student' && !form.studentId) { toast('Pick the student this login belongs to', 'error'); return; }
    if (role === 'university' && !form.universityName.trim()) { toast('Enter the institution name', 'error'); return; }

    const payload: Record<string, string> = {
      role,
      name: form.name.trim(),
      username: form.username.trim().toLowerCase(),
      password: form.password,
      presetKey: form.presetKey || role,
    };
    if (form.email.trim()) payload.email = form.email.trim();
    if (role === 'student') payload.studentId = form.studentId;
    if (role === 'university') payload.universityName = form.universityName.trim();

    setSaving(true);
    try {
      await api.post('/portal-accounts', payload);
      toast(`Login issued for ${payload.name}`, 'success');
      await onIssued();
    } catch (err) {
      toast(errorText(err, 'Could not issue the login'), 'error');
    } finally {
      setSaving(false);
    }
  }

  const picked = students.find((s) => s._id === form.studentId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="sheet"
      title="Issue a portal login"
      description="A seat for someone outside the office."
      dismissable={!saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form={formId} disabled={saving}>
            {saving ? 'Issuing…' : 'Issue login'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        <Segmented
          label="Account kind"
          value={role}
          onChange={setRole}
          options={[
            { value: 'student', label: 'Student' },
            { value: 'university', label: 'University partner' },
          ]}
          className="w-full [&>button]:flex-1"
        />

        {role === 'student' ? (
          <Field
            label="Student record"
            required
            hint={picked ? `Stage: ${picked.stage.replace(/_/g, ' ')}` : undefined}
          >
            {(id) => (
              <Select
                id={id}
                value={form.studentId}
                onChange={(e) => {
                  const s = students.find((x) => x._id === e.target.value);
                  setForm((f) => ({
                    ...f,
                    studentId: e.target.value,
                    name: f.name || s?.personal?.name || '',
                  }));
                }}
              >
                <option value="">Pick a student…</option>
                {students.map((s) => (
                  <option key={s._id} value={s._id}>{s.personal?.name ?? s._id}</option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <Field label="Institution" required hint="Must match the name used in application records exactly.">
            {(id) => (
              <Input id={id} required value={form.universityName}
                onChange={(e) => set('universityName', e.target.value)} />
            )}
          </Field>
        )}

        <Field label="Display name" required>
          {(id) => <Input id={id} required value={form.name} onChange={(e) => set('name', e.target.value)} />}
        </Field>

        <Field label="Username" required hint="They sign in with this.">
          {(id) => (
            <Input id={id} required value={form.username}
              onChange={(e) => set('username', e.target.value.toLowerCase())} />
          )}
        </Field>

        <Field label="Password" required hint="At least 6 characters.">
          {(id) => (
            <Input id={id} type="password" required autoComplete="new-password"
              value={form.password} onChange={(e) => set('password', e.target.value)} />
          )}
        </Field>

        <Field label="Email" hint="Optional — contact only.">
          {(id) => (
            <Input id={id} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          )}
        </Field>

        {presets.length > 0 && (
          <Field label="Seat">
            {(id) => (
              <Select id={id} value={form.presetKey || role} onChange={(e) => set('presetKey', e.target.value)}>
                {presets.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
              </Select>
            )}
          </Field>
        )}
      </form>
    </Modal>
  );
}

export default function PortalAccountsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-t2">Loading portal accounts…</div>}>
      <PortalAccountsInner />
    </Suspense>
  );
}
