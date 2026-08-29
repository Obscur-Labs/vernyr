'use client';

import { Fragment, useCallback, useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/context/ToastContext';
import { usesEmailLogin, loginHandle } from '@/lib/credentials';
import { devApi } from '@/lib/devApi';
import type {
  DevUser, DevOverview, DevRbac, ImpersonateResult,
  ActivityPage, ActivityAction,
} from '@/lib/devApi';
import { ACTIONS as PERMISSION_VERBS, type Action as PermissionVerb, type UserRole } from '@/types';
import { groupModules, labelFor } from '@/lib/access';
import { studentUrl } from '@/lib/config';
import { fullDate, timeAgo } from '@/lib/format';
import {
  Badge, Button, Card, Checkbox, ConfirmModal, EmptyState, Field, Input,
  Modal, RoleBadge, SearchInput, Select,
} from '@/components/ui';
import { Table, TableEmpty, TableSkeleton, TD, TR } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * The dev console.
 *
 * It uses the same UI layer as the rest of the CRM — the console being crude is
 * not the same as it being inconsistent, and a blocking `window.confirm` over a
 * god-mode delete was the worst of both. What stays deliberately unlike the app
 * is the *authority*: no role guards, every account editable, super admins
 * included. That is the reason the route exists.
 *
 * The route is dark-only; the lock lives in ThemeContext, not here.
 */

const ROLES: UserRole[] = ['admin', 'counsellor', 'student', 'university'];

type Tab = 'overview' | 'users' | 'activity' | 'rbac' | 'data';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users & RBAC' },
  { id: 'activity', label: 'Activity' },
  { id: 'rbac', label: 'Access Matrix' },
  { id: 'data', label: 'Collections' },
];

export default function DevConsolePage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [overview, setOverview] = useState<DevOverview | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await devApi<DevOverview>('/overview'));
      setReachable(true);
    } catch {
      setReachable(false);
    }
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  // Set client-side rather than exporting metadata: a `metadata` export would
  // also title the 404 this route renders in a production build.
  useEffect(() => { document.title = 'Dev Console — Vernyr'; }, []);

  return (
    <div className="min-h-screen bg-base text-t1">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto max-w-7xl px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
                <span className="font-mono text-accent">/dev</span> Console
              </h1>
              <p className="mt-1 text-xs text-t2">
                Direct database access with no authentication. Local development only, dark theme only.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <StatusDot ok={reachable} />
              <span className="text-t2">
                {reachable === null ? 'connecting…' : reachable ? 'backend reachable' : 'backend unreachable'}
              </span>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            These endpoints bypass every permission check in the app — every account is editable
            from here, super admins included. They are mounted only when
            <code className="mx-1 rounded bg-black/25 px-1 font-mono">ENABLE_DEV_ROUTES=true</code>
            and <code className="mx-1 rounded bg-black/25 px-1 font-mono">NODE_ENV≠production</code>,
            and only answer requests from localhost.
          </div>

          <nav className="-mb-px mt-4 flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={cn(
                  'hig-press rounded-t-lg border-b-2 px-3.5 py-2 text-sm font-medium',
                  tab === t.id
                    ? 'border-accent bg-card text-t1'
                    : 'border-transparent text-t2 hover:text-t1',
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {reachable === false && (
          <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-300">
            <p className="mb-1 font-semibold">Cannot reach /api/dev</p>
            <p className="text-red-300/80">
              Start the backend and make sure <code className="font-mono">ENABLE_DEV_ROUTES=true</code> is
              set in <code className="font-mono">backend/.env</code>, then reload.
            </p>
          </div>
        )}

        {reachable && tab === 'overview' && <OverviewTab data={overview} onRefresh={loadOverview} />}
        {reachable && tab === 'users' && <UsersTab />}
        {reachable && tab === 'activity' && <ActivityTab />}
        {reachable && tab === 'rbac' && <RbacTab />}
        {reachable && tab === 'data' && <CollectionsTab collections={overview?.database.collections ?? []} />}
      </main>
    </div>
  );
}

/* ── shared bits ──────────────────────────────────────────────────────────── */

function StatusDot({ ok }: { ok: boolean | null }) {
  const color = ok === null ? 'bg-t3' : ok ? 'bg-emerald-400' : 'bg-red-400';
  return <span aria-hidden className={`h-2 w-2 rounded-full ${color}`} />;
}

/** A titled panel. The console's own density, on the shared Card. */
function Panel({ title, children, className }: {
  title: string; children: React.ReactNode; className?: string;
}) {
  return (
    <Card tone="inset" padding="sm" className={cn('rounded-xl', className)}>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-t3">{title}</h3>
      {children}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/50 py-1.5 last:border-0">
      <span className="text-xs text-t2">{label}</span>
      <span className="break-all text-right text-sm font-medium text-t1">{value}</span>
    </div>
  );
}

/* ── Overview ─────────────────────────────────────────────────────────────── */

function OverviewTab({ data, onRefresh }: { data: DevOverview | null; onRefresh: () => void }) {
  if (!data) return <p className="text-sm text-t2">Loading…</p>;

  const connected = data.database.readyState === 1;

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onRefresh}>Refresh</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Panel title="Environment">
          <Row label="NODE_ENV" value={data.env.nodeEnv} />
          <Row label="Port" value={data.env.port} />
          <Row label="JWT expiry" value={data.env.jwtExpiresIn} />
          <Row label="JWT secret set" value={data.env.jwtSecretSet ? 'yes' : 'no'} />
          <Row label="CRM origin" value={data.env.crmUrl || '—'} />
          <Row label="Student origin" value={data.env.studentUrl || '—'} />
        </Panel>

        <Panel title="File storage">
          <Row label="Provider" value={data.storage.provider} />
          <Row
            label="Configured"
            value={
              <span className={data.storage.configured ? 'text-emerald-400' : 'text-amber-400'}>
                {data.storage.configured ? 'yes' : 'missing credentials'}
              </span>
            }
          />
          <Row label="Root folder" value={<code className="font-mono text-xs">{data.storage.folder}</code>} />
        </Panel>

        <Panel title="Database">
          <Row label="Name" value={data.database.name ?? '—'} />
          <Row
            label="Connection"
            value={
              <span className={connected ? 'text-emerald-400' : 'text-red-400'}>
                {connected ? 'connected' : `state ${data.database.readyState}`}
              </span>
            }
          />
          <Row label="Collections" value={data.database.collections.length} />
        </Panel>
      </div>

      <Panel title="Collection counts">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {data.database.collections.map((c) => (
            <div key={c.name} className="flex items-baseline justify-between rounded-lg bg-muted px-3 py-2">
              <span className="truncate font-mono text-xs text-t2">{c.name}</span>
              <span className="ml-2 text-sm font-semibold text-t1">{c.count}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/* ── Users & RBAC CRUD ────────────────────────────────────────────────────── */

const BLANK_USER = {
  name: '', username: '', email: '', password: '',
  role: 'counsellor' as UserRole, phone: '', universityName: '',
};

const USER_COLUMNS = ['User', 'Role', 'Active', 'Last seen', ''];

function UsersTab() {
  const router = useRouter();
  const { toast } = useToast();

  const [users, setUsers] = useState<DevUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');
  const [includeInactive, setIncludeInactive] = useState(true);

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(BLANK_USER);
  const [handoff, setHandoff] = useState<ImpersonateResult | null>(null);
  const [editing, setEditing] = useState<DevUser | null>(null);
  const [resetting, setResetting] = useState<DevUser | null>(null);
  const [removing, setRemoving] = useState<DevUser | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (roleFilter) params.set('role', roleFilter);
      if (includeInactive) params.set('includeInactive', 'true');
      setUsers(await devApi<DevUser[]>(`/users?${params}`));
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [q, roleFilter, includeInactive, toast]);

  useEffect(() => {
    const t = setTimeout(load, 250);   // debounce the search box
    return () => clearTimeout(t);
  }, [load]);

  async function patchUser(id: string, updates: Partial<DevUser>) {
    try {
      const updated = await devApi<DevUser>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(updates) });
      setUsers((prev) => prev.map((u) => (u._id === id ? updated : u)));
      toast('User updated', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function createUser() {
    const wantsEmail = usesEmailLogin(draft.role);
    if (!draft.name || !draft.password || (wantsEmail ? !draft.email : !draft.username)) {
      toast(`Name, password and a ${wantsEmail ? 'email' : 'username'} are required`, 'error'); return;
    }
    try {
      await devApi<DevUser>('/users', { method: 'POST', body: JSON.stringify(draft) });
      toast(`Created ${draft.username || draft.email}`, 'success');
      setDraft(BLANK_USER);
      setCreating(false);
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function removeUser() {
    if (!removing) return;
    setBusy(true);
    try {
      await devApi(`/users/${removing._id}`, { method: 'DELETE' });
      setUsers((prev) => prev.filter((x) => x._id !== removing._id));
      toast(`Deleted ${loginHandle(removing)}`, 'success');
      setRemoving(null);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  /** Mint a real login token for a user and take over the session as them. */
  async function loginAs(u: DevUser) {
    try {
      const result = await devApi<ImpersonateResult>(`/users/${u._id}/impersonate`, { method: 'POST' });

      // The student portal is a different origin, so its localStorage is out of
      // reach from here — hand the caller a snippet instead.
      if (result.user.role === 'student') { setHandoff(result); return; }

      localStorage.setItem('crm_token', result.token);
      localStorage.setItem('crm-auth', JSON.stringify({
        state: { user: result.user, token: result.token },
        version: 0,
      }));
      toast(`Signed in as ${result.user.name}`, 'success');
      router.push('/dashboard');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  const set = <K extends keyof typeof BLANK_USER>(key: K, value: (typeof BLANK_USER)[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={q}
          onValueChange={setQ}
          placeholder="Search name, username or email…"
          label="Search users"
          className="min-w-[200px] flex-1"
        />
        <Select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as UserRole | '')}
          aria-label="Role"
          className="w-auto"
        >
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
        <Checkbox
          checked={includeInactive}
          onChange={() => setIncludeInactive((v) => !v)}
          className="rounded-xl border border-line bg-card px-3 py-2.5"
        >
          Inactive
        </Checkbox>
        <Button onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancel' : '+ New user'}
        </Button>
      </div>

      {creating && (
        <Card tone="inset" padding="sm" className="grid gap-3 rounded-xl sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name">
            {(id) => <Input id={id} size="sm" value={draft.name} onChange={(e) => set('name', e.target.value)} />}
          </Field>
          <Field label="Username">
            {(id) => (
              <Input id={id} size="sm" value={draft.username}
                onChange={(e) => set('username', e.target.value.toLowerCase())} />
            )}
          </Field>
          <Field label="Email">
            {(id) => <Input id={id} size="sm" value={draft.email} onChange={(e) => set('email', e.target.value)} />}
          </Field>
          <Field label="Password">
            {(id) => (
              <Input id={id} size="sm" type="password" autoComplete="new-password"
                value={draft.password} onChange={(e) => set('password', e.target.value)} />
            )}
          </Field>
          <Field label="Role">
            {(id) => (
              <Select id={id} size="sm" value={draft.role} onChange={(e) => set('role', e.target.value as UserRole)}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Phone (optional)">
            {(id) => <Input id={id} size="sm" value={draft.phone} onChange={(e) => set('phone', e.target.value)} />}
          </Field>
          {draft.role === 'university' && (
            <Field label="University name">
              {(id) => (
                <Input id={id} size="sm" value={draft.universityName}
                  onChange={(e) => set('universityName', e.target.value)} />
              )}
            </Field>
          )}
          <div className="flex justify-end sm:col-span-2 lg:col-span-3">
            <Button size="sm" onClick={createUser}>Create user</Button>
          </div>
        </Card>
      )}

      <Table columns={USER_COLUMNS} minWidth={860}>
        {loading && <TableSkeleton rows={5} columns={USER_COLUMNS.length} />}
        {!loading && users.length === 0 && (
          <TableEmpty columns={USER_COLUMNS.length}>
            <EmptyState
              title="No users match"
              description="Clear the search or role filter, or create the first account."
              className="border-0 py-2"
            />
          </TableEmpty>
        )}
        {!loading && users.map((u) => (
          <TR key={u._id}>
            <TD>
              <p className="font-medium text-t1">{u.name}</p>
              <p className="text-xs text-t3">{loginHandle(u)}</p>
              {u.universityName && <p className="text-xs text-t3">{u.universityName}</p>}
            </TD>
            <TD>
              {/* Editable in place — changing a role is the console's job. */}
              <Select
                size="sm"
                value={u.role}
                onChange={(e) => patchUser(u._id, { role: e.target.value as UserRole })}
                aria-label={`Role for ${u.name}`}
                className="w-auto"
              >
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </TD>
            <TD>
              <button
                type="button"
                onClick={() => patchUser(u._id, { isActive: !u.isActive })}
                aria-label={`${u.isActive ? 'Deactivate' : 'Activate'} ${u.name}`}
              >
                <Badge tone={u.isActive ? 'success' : 'danger'}>
                  {u.isActive ? 'active' : 'inactive'}
                </Badge>
              </button>
            </TD>
            <TD className="whitespace-nowrap text-xs text-t3" title={u.lastSeenAt ? fullDate(u.lastSeenAt) : undefined}>
              {u.lastSeenAt ? timeAgo(u.lastSeenAt, { suffix: true }) : '—'}
            </TD>
            <TD>
              <div className="flex items-center justify-end gap-1.5">
                <Button variant="outline" size="sm" onClick={() => setEditing(u)}>Edit</Button>
                <Button variant="outline" size="sm" onClick={() => loginAs(u)}>Login as</Button>
                <Button variant="outline" size="sm" onClick={() => setResetting(u)}>Password</Button>
                <Button variant="danger" size="sm" onClick={() => setRemoving(u)}>Delete</Button>
              </div>
            </TD>
          </TR>
        ))}
      </Table>

      <EditUserModal
        user={editing}
        onClose={() => setEditing(null)}
        onSaved={(updated) => {
          setUsers((prev) => prev.map((u) => (u._id === updated._id ? updated : u)));
          setEditing(null);
        }}
      />

      <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />

      <StudentHandoffModal result={handoff} onClose={() => setHandoff(null)} />

      <ConfirmModal
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={removeUser}
        busy={busy}
        title="Delete this account?"
        confirmLabel="Delete permanently"
        body={
          <>
            <strong className="text-t1">{removing ? loginHandle(removing) : ''}</strong> is removed
            from the database outright — not deactivated. Anything referencing it keeps a dangling
            id. This cannot be undone.
          </>
        }
      />
    </div>
  );
}

/* ── Reset a password ─────────────────────────────────────────────────────── */

function ResetPasswordModal({ user, onClose }: { user: DevUser | null; onClose: () => void }) {
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user) setPassword(''); }, [user]);

  const tooShort = password.length > 0 && password.length < 6;

  async function submit() {
    if (!user || password.length < 6) return;
    setBusy(true);
    try {
      await devApi(`/users/${user._id}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ password }),
      });
      toast('Password updated', 'success');
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      size="sm"
      title="Set a new password"
      description={user ? `For ${loginHandle(user)}. No email is sent — tell them yourself.` : undefined}
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

/**
 * Student sessions live on the portal's origin (:3001), which this page cannot
 * write to. Hand over a paste-able snippet instead.
 */
function StudentHandoffModal({ result, onClose }: {
  result: ImpersonateResult | null; onClose: () => void;
}) {
  const { toast } = useToast();

  const snippet = result ? [
    `localStorage.setItem('student_token', ${JSON.stringify(result.token)});`,
    `localStorage.setItem('student-auth', ${JSON.stringify(JSON.stringify({
      state: { user: result.user, token: result.token, studentId: result.studentId },
      version: 0,
    }))});`,
    `location.href = '/home';`,
  ].join('\n') : '';

  return (
    <Modal
      open={!!result}
      onClose={onClose}
      size="lg"
      title={result ? `Sign in as ${result.user.name}` : ''}
      description={
        <>
          The student portal runs on a different origin, so paste this into the devtools console at{' '}
          <a href={studentUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            {studentUrl}
          </a>.
        </>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={() => { navigator.clipboard.writeText(snippet); toast('Snippet copied', 'success'); }}>
            Copy snippet
          </Button>
        </>
      }
    >
      <pre className="max-h-64 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-base p-3 font-mono text-xs text-t2">
        {snippet}
      </pre>
    </Modal>
  );
}

/**
 * Full record editor. Every field the API will accept is here and no role is
 * off-limits — editing a super admin is the point of the console.
 */
function EditUserModal({ user, onClose, onSaved }: {
  user: DevUser | null; onClose: () => void; onSaved: (u: DevUser) => void;
}) {
  const { toast } = useToast();
  const formId = useId();
  const [form, setForm] = useState({
    name: '', username: '', email: '',
    role: 'counsellor' as UserRole, phone: '', universityName: '', isActive: true,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setForm({
      name: user.name ?? '',
      username: user.username ?? '',
      email: user.email ?? '',
      role: user.role,
      phone: user.phone ?? '',
      universityName: user.universityName ?? '',
      isActive: user.isActive,
    });
  }, [user]);

  const needsEmail = usesEmailLogin(form.role);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    try {
      const updated = await devApi<DevUser>(`/users/${user._id}`, {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      toast('User updated', 'success');
      onSaved(updated);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      size="lg"
      title={user ? `Edit ${user.name}` : ''}
      description={user ? `${user._id} · created ${new Date(user.createdAt).toLocaleDateString()}` : undefined}
      dismissable={!saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form={formId} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={save} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            {(id) => <Input id={id} size="sm" value={form.name} onChange={(e) => set('name', e.target.value)} />}
          </Field>
          <Field label="Role">
            {(id) => (
              <Select id={id} size="sm" value={form.role} onChange={(e) => set('role', e.target.value as UserRole)}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            )}
          </Field>
          <Field label={needsEmail ? 'Username (optional for admins)' : 'Username'} required={!needsEmail}>
            {(id) => (
              <Input id={id} size="sm" value={form.username}
                onChange={(e) => set('username', e.target.value.toLowerCase())} />
            )}
          </Field>
          <Field label={needsEmail ? 'Email' : 'Email (optional)'} required={needsEmail}>
            {(id) => <Input id={id} size="sm" value={form.email} onChange={(e) => set('email', e.target.value)} />}
          </Field>
          <Field label="Phone">
            {(id) => <Input id={id} size="sm" value={form.phone} onChange={(e) => set('phone', e.target.value)} />}
          </Field>
          {form.role === 'university' && (
            <Field label="University name">
              {(id) => (
                <Input id={id} size="sm" value={form.universityName}
                  onChange={(e) => set('universityName', e.target.value)} />
              )}
            </Field>
          )}
        </div>

        <Checkbox checked={form.isActive} onChange={() => set('isActive', !form.isActive)}>
          Account is active
        </Checkbox>

        <p className="text-xs leading-relaxed text-t2">
          {needsEmail
            ? 'Admin roles sign in with their email address, so it cannot be blank.'
            : 'This role signs in with its username, so it cannot be blank.'}
        </p>
      </form>
    </Modal>
  );
}

/* ── Activity log ─────────────────────────────────────────────────────────── */

const ACTION_TONE: Record<ActivityAction, string> = {
  create: 'bg-emerald-500/15 text-emerald-400',
  update: 'bg-sky-500/15 text-sky-400',
  delete: 'bg-red-500/15 text-red-400',
  login: 'bg-indigo-500/15 text-indigo-400',
  login_failed: 'bg-amber-500/15 text-amber-400',
  register: 'bg-teal-500/15 text-teal-400',
  password_reset: 'bg-violet-500/15 text-violet-400',
  impersonate: 'bg-fuchsia-500/15 text-fuchsia-400',
  purge: 'bg-slate-500/15 text-slate-400',
};

const ACTIVITY_ACTIONS = Object.keys(ACTION_TONE) as ActivityAction[];
const ACTIVITY_COLUMNS = ['When', 'Actor', 'Action', 'Entity', 'Details', 'From'];

function ActivityTab() {
  const { toast } = useToast();

  const [page, setPage] = useState<ActivityPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [action, setAction] = useState<ActivityAction | ''>('');
  const [source, setSource] = useState<'' | 'app' | 'dev'>('');
  const [limit, setLimit] = useState(100);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (q) params.set('q', q);
      if (action) params.set('action', action);
      if (source) params.set('source', source);
      setPage(await devApi<ActivityPage>(`/activity?${params}`));
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [q, action, source, limit, toast]);

  useEffect(() => {
    const t = setTimeout(load, 250);   // debounce the search box
    return () => clearTimeout(t);
  }, [load]);

  async function clearAll() {
    setClearing(true);
    try {
      const res = await devApi<{ deleted: number }>('/activity', { method: 'DELETE' });
      toast(`Cleared ${res.deleted} entries`, 'success');
      setConfirmClear(false);
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setClearing(false);
    }
  }

  const entries = page?.entries ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={q}
          onValueChange={setQ}
          placeholder="Search actor, entity or description…"
          label="Search the activity log"
          className="min-w-[200px] flex-1"
        />
        <Select value={action} onChange={(e) => setAction(e.target.value as ActivityAction | '')}
          aria-label="Action" className="w-auto">
          <option value="">All actions</option>
          {ACTIVITY_ACTIONS.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
        </Select>
        <Select value={source} onChange={(e) => setSource(e.target.value as '' | 'app' | 'dev')}
          aria-label="Source" className="w-auto">
          <option value="">Anywhere</option>
          <option value="app">From the app</option>
          <option value="dev">From this console</option>
        </Select>
        <Select value={limit} onChange={(e) => setLimit(Number(e.target.value))}
          aria-label="How many" className="w-auto">
          {[50, 100, 250, 500].map((n) => <option key={n} value={n}>latest {n}</option>)}
        </Select>
        <Button variant="outline" onClick={load}>Refresh</Button>
        <Button variant="danger" onClick={() => setConfirmClear(true)} disabled={clearing || entries.length === 0}>
          {clearing ? 'Clearing…' : 'Clear all'}
        </Button>
      </div>

      {page && (
        <p className="text-xs text-t2">
          Showing {entries.length} of {page.total} recorded {page.total === 1 ? 'action' : 'actions'}.
        </p>
      )}

      <Table columns={ACTIVITY_COLUMNS} minWidth={900}>
        {loading && <TableSkeleton rows={8} columns={ACTIVITY_COLUMNS.length} />}
        {!loading && entries.length === 0 && (
          <TableEmpty columns={ACTIVITY_COLUMNS.length}>
            <EmptyState
              title="Nothing recorded yet"
              description="Sign-ins, registrations and any account change — from the app or from this console — land here as they happen."
              className="border-0 py-2"
            />
          </TableEmpty>
        )}
        {!loading && entries.map((e) => (
          <TR key={e._id} className="align-top">
            <TD className="whitespace-nowrap text-xs" title={fullDate(e.createdAt)}>
              {timeAgo(e.createdAt, { suffix: true })}
            </TD>
            <TD className="whitespace-nowrap">
              <p className="font-medium text-t1">{e.actorName}</p>
              {e.actorRole && <RoleBadge role={e.actorRole} className="mt-1" />}
            </TD>
            <TD>
              <span className={cn(
                'inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium',
                ACTION_TONE[e.action] ?? 'bg-muted text-t2',
              )}>
                {e.action.replace(/_/g, ' ')}
              </span>
            </TD>
            <TD className="whitespace-nowrap font-mono text-xs">{e.entity}</TD>
            <TD className="text-t1">
              {e.label}
              {e.changes?.length ? (
                <span className="mt-1 flex flex-wrap gap-1">
                  {e.changes.map((c) => (
                    <span key={c} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-t2">{c}</span>
                  ))}
                </span>
              ) : null}
            </TD>
            <TD className="whitespace-nowrap">
              <Badge tone={e.source === 'dev' ? 'warning' : 'neutral'} className="font-mono">
                {e.source}
              </Badge>
              {e.ip && <span className="ml-2 font-mono text-xs text-t3">{e.ip}</span>}
            </TD>
          </TR>
        ))}
      </Table>

      <ConfirmModal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={clearAll}
        busy={clearing}
        title="Clear the whole activity log?"
        confirmLabel="Delete every entry"
        body={
          <>
            All {page?.total ?? 0} entries are deleted — sign-ins, registrations and every account
            change, from the app as well as this console. The audit trail starts again from empty.
          </>
        }
      />
    </div>
  );
}

/* ── Access matrix ────────────────────────────────────────────────────────── */

const VERB_LETTER: Record<PermissionVerb, string> = { create: 'C', read: 'R', update: 'U', delete: 'D' };

/**
 * The live access picture: every module against every preset in force.
 *
 * Both axes come from the server's own registry rather than a copy kept here,
 * so adding a module or editing a preset shows up on this screen without
 * anyone remembering to update it. Only `scoping` below is hand-maintained,
 * because those rules live inside handlers and permissions cannot state them.
 */
function RbacTab() {
  const { toast } = useToast();
  const [data, setData] = useState<DevRbac | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    devApi<DevRbac>('/rbac')
      .then(setData)
      .catch((err) => { setError((err as Error).message); toast((err as Error).message, 'error'); });
  }, [toast]);

  if (error) return <p className="text-sm text-red-400">Could not load the access matrix: {error}</p>;
  if (!data) return <p className="text-sm text-t2">Loading…</p>;

  const groups = groupModules(data.modules);
  const areas = [...new Set(data.scoping.map((r) => r.area))];

  return (
    <div className="space-y-5">
      <Panel title="Accounts by role">
        <div className="flex flex-wrap gap-2">
          {data.roles.map((r) => (
            <div key={r.role} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5">
              <RoleBadge role={r.role} />
              <span className="text-xs text-t2">{r.users} account{r.users === 1 ? '' : 's'}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-t3">
          Role decides sign-in style and row-level scoping. It does not decide what a caller may
          do — that is the preset plus any per-person override.
        </p>
      </Panel>

      <Panel title="Presets in force">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {data.presets.map((p) => (
            <div key={p.key} className="rounded-lg bg-muted px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-t1">{p.name}</span>
                <span className="rounded bg-black/25 px-1.5 py-0.5 font-mono text-[10px] text-t3">{p.key}</span>
                {p.isSystem && <Badge tone="accent">built-in</Badge>}
                {p.fullAccess && <Badge tone="warning">full access</Badge>}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-t2">{p.description}</p>
              <p className="mt-1.5 text-xs text-t3">
                {p.members} account{p.members === 1 ? '' : 's'} · {p.scope} scope
              </p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Module matrix">
        <p className="mb-3 text-xs text-t3">
          <span className="font-mono text-emerald-400">C R U D</span> — create, read, update, delete.
          A lit letter is granted, a dimmed one is not, and a dot means the module does not offer
          that verb at all.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-line">
                <th className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-t3">Module</th>
                {data.presets.map((p) => (
                  <th key={p.key} className="px-2 pb-2 text-center text-[11px] font-semibold uppercase tracking-wider text-t3">
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group.group}>
                  <tr>
                    <td
                      colSpan={data.presets.length + 1}
                      className="px-2 pb-1 pt-4 text-[10px] font-bold uppercase tracking-widest text-accent"
                    >
                      {group.group}
                    </td>
                  </tr>
                  {group.modules.map((mod) => (
                    <tr key={mod.key} className="border-t border-line/60">
                      <td className="px-2 py-2">
                        <span className="text-sm text-t1">{mod.label}</span>
                        <span className="ml-2 font-mono text-[10px] text-t3">{mod.key}</span>
                      </td>
                      {data.presets.map((p) => (
                        <td key={p.key} className="px-2 py-2 text-center">
                          <span className="inline-flex gap-1 font-mono text-xs">
                            {PERMISSION_VERBS.map((action) => {
                              if (!mod.actions.includes(action)) {
                                return <span key={action} className="w-3 text-t3/20">·</span>;
                              }
                              const granted = p.permissions?.[mod.key]?.[action] === true;
                              return (
                                <span
                                  key={action}
                                  title={`${labelFor(mod, action)} — ${granted ? 'granted' : 'denied'}`}
                                  className={cn('w-3', granted ? 'font-bold text-emerald-400' : 'text-t3/35')}
                                >
                                  {VERB_LETTER[action]}
                                </span>
                              );
                            })}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-t1">Row-level scoping</h3>
        <p className="mb-3 text-xs text-t3">
          <code className="font-mono">can(module, action)</code> answers <em>whether</em>; these rules
          answer <em>whose</em>. They live inside handlers, so this list is hand-maintained in
          <code className="mx-1 font-mono">backend/src/routes/dev.ts</code> — update it when you change
          a handler&rsquo;s scoping.
        </p>

        <div className="space-y-5">
          {areas.map((area) => (
            <Panel key={area} title={area}>
              <div className="space-y-3">
                {data.scoping.filter((r) => r.area === area).map((rule) => (
                  <div key={rule.surface + rule.rule} className="rounded-lg bg-muted px-3 py-2.5">
                    <p className="break-all font-mono text-xs text-accent">{rule.surface}</p>
                    <p className="mt-1 text-sm text-t1">{rule.rule}</p>
                    <p className="mt-2 font-mono text-xs text-t3">{rule.source}</p>
                  </div>
                ))}
              </div>
            </Panel>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Collection browser ───────────────────────────────────────────────────── */

function CollectionsTab({ collections }: { collections: { name: string; count: number }[] }) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [limit, setLimit] = useState(25);
  const [docs, setDocs] = useState<unknown[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (collection: string, n: number) => {
    if (!collection) return;
    setLoading(true);
    try {
      const res = await devApi<{ docs: unknown[] }>(`/collections/${collection}?limit=${n}`);
      setDocs(res.docs);
    } catch (err) {
      toast((err as Error).message, 'error');
      setDocs(null);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { if (name) load(name, limit); }, [name, limit, load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={name} onChange={(e) => setName(e.target.value)} aria-label="Collection" className="w-auto">
          <option value="">Choose a collection…</option>
          {collections.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
        </Select>
        <Select value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="How many" className="w-auto">
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>latest {n}</option>)}
        </Select>
        <span className="text-xs text-t3">Read-only. Password hashes are always stripped.</span>
      </div>

      {loading && <p className="text-sm text-t2">Loading…</p>}

      {!loading && docs && (
        <pre className="max-h-[70vh] overflow-auto rounded-xl border border-line bg-card p-4 font-mono text-xs text-t2">
          {JSON.stringify(docs, null, 2)}
        </pre>
      )}
    </div>
  );
}
