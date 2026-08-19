'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/context/ToastContext';
import { devApi } from '@/lib/devApi';
import type { DevUser, DevOverview, DevRbac, ImpersonateResult } from '@/lib/devApi';
import type { UserRole } from '@/types';
import { studentUrl } from '@/lib/config';

const ROLES: UserRole[] = [
  'super_admin', 'admin', 'counsellor_manager', 'counsellor', 'finance', 'accountant',
  'visa_team', 'doc_verification', 'university_team', 'support', 'student', 'university',
];

const ROLE_COLORS: Record<UserRole, string> = {
  super_admin:       'bg-indigo-500/15 text-indigo-400',
  admin:             'bg-violet-500/15 text-violet-400',
  counsellor_manager:'bg-emerald-500/15 text-emerald-400',
  counsellor:        'bg-emerald-500/15 text-emerald-400',
  finance:           'bg-amber-500/15 text-amber-400',
  accountant:        'bg-amber-500/15 text-amber-400',
  visa_team:         'bg-blue-500/15 text-blue-400',
  doc_verification:  'bg-orange-500/15 text-orange-400',
  university_team:   'bg-cyan-500/15 text-cyan-400',
  support:           'bg-slate-500/15 text-slate-400',
  student:           'bg-sky-500/15 text-sky-400',
  university:        'bg-teal-500/15 text-teal-400',
};

type Tab = 'overview' | 'users' | 'rbac' | 'data';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'users',    label: 'Users & RBAC' },
  { id: 'rbac',     label: 'Access Matrix' },
  { id: 'data',     label: 'Collections' },
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
  useEffect(() => { document.title = 'Dev Console — StudyCRM'; }, []);

  return (
    <div className="min-h-screen bg-base text-t1">
      <header className="border-b border-line bg-surface">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
                <span className="font-mono text-accent">/dev</span> Console
              </h1>
              <p className="text-xs text-t2 mt-1">
                Direct database access with no authentication. Local development only.
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
            These endpoints bypass every permission check in the app. They are mounted only when
            <code className="mx-1 px-1 rounded bg-black/25 font-mono">ENABLE_DEV_ROUTES=true</code>
            and <code className="mx-1 px-1 rounded bg-black/25 font-mono">NODE_ENV≠production</code>,
            and only answer requests from localhost.
          </div>

          <nav className="flex gap-1 mt-4 -mb-px">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3.5 py-2 text-sm font-medium rounded-t-lg border-b-2 transition ${
                  tab === t.id
                    ? 'border-accent text-t1 bg-card'
                    : 'border-transparent text-t2 hover:text-t1'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {reachable === false && (
          <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-300">
            <p className="font-semibold mb-1">Cannot reach /api/dev</p>
            <p className="text-red-300/80">
              Start the backend and make sure <code className="font-mono">ENABLE_DEV_ROUTES=true</code> is
              set in <code className="font-mono">backend/.env</code>, then reload.
            </p>
          </div>
        )}

        {reachable && tab === 'overview' && <OverviewTab data={overview} onRefresh={loadOverview} />}
        {reachable && tab === 'users'    && <UsersTab />}
        {reachable && tab === 'rbac'     && <RbacTab />}
        {reachable && tab === 'data'     && <CollectionsTab collections={overview?.database.collections ?? []} />}
      </main>
    </div>
  );
}

/* ── shared bits ──────────────────────────────────────────────────────────── */

function StatusDot({ ok }: { ok: boolean | null }) {
  const color = ok === null ? 'bg-t3' : ok ? 'bg-emerald-400' : 'bg-red-400';
  return <span className={`w-2 h-2 rounded-full ${color}`} />;
}

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${ROLE_COLORS[role] ?? 'bg-muted text-t2'}`}>
      {role}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-t3 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-line/50 last:border-0">
      <span className="text-xs text-t2">{label}</span>
      <span className="text-sm font-medium text-t1 text-right break-all">{value}</span>
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
        <button onClick={onRefresh} className="px-3 py-1.5 rounded-lg bg-muted text-t1 text-xs font-medium hover:bg-line transition">
          Refresh
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Environment">
          <Row label="NODE_ENV"       value={data.env.nodeEnv} />
          <Row label="Port"           value={data.env.port} />
          <Row label="JWT expiry"     value={data.env.jwtExpiresIn} />
          <Row label="JWT secret set" value={data.env.jwtSecretSet ? 'yes' : 'no'} />
          <Row label="CRM origin"     value={data.env.crmUrl || '—'} />
          <Row label="Student origin" value={data.env.studentUrl || '—'} />
        </Card>

        <Card title="File storage">
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
        </Card>

        <Card title="Database">
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
        </Card>
      </div>

      <Card title="Collection counts">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {data.database.collections.map(c => (
            <div key={c.name} className="flex items-baseline justify-between rounded-lg bg-muted px-3 py-2">
              <span className="text-xs text-t2 font-mono truncate">{c.name}</span>
              <span className="text-sm font-semibold text-t1 ml-2">{c.count}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ── Users & RBAC CRUD ────────────────────────────────────────────────────── */

const BLANK_USER = { name: '', email: '', password: '', role: 'counsellor' as UserRole, phone: '', universityName: '' };

function UsersTab() {
  const router = useRouter();
  const { toast } = useToast();

  const [users, setUsers]     = useState<DevUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ]             = useState('');
  const [roleFilter, setRoleFilter]         = useState<UserRole | ''>('');
  const [includeInactive, setIncludeInactive] = useState(true);

  const [creating, setCreating] = useState(false);
  const [draft, setDraft]       = useState(BLANK_USER);
  const [handoff, setHandoff]   = useState<ImpersonateResult | null>(null);

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
      setUsers(prev => prev.map(u => (u._id === id ? updated : u)));
      toast('User updated', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function createUser() {
    if (!draft.name || !draft.email || !draft.password) {
      toast('Name, email and password are required', 'error'); return;
    }
    try {
      await devApi<DevUser>('/users', { method: 'POST', body: JSON.stringify(draft) });
      toast(`Created ${draft.email}`, 'success');
      setDraft(BLANK_USER);
      setCreating(false);
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function resetPassword(u: DevUser) {
    const password = window.prompt(`New password for ${u.email} (min 6 chars)`);
    if (!password) return;
    try {
      await devApi(`/users/${u._id}/password`, { method: 'PATCH', body: JSON.stringify({ password }) });
      toast('Password updated', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function removeUser(u: DevUser) {
    if (!window.confirm(`Permanently delete ${u.email}? This cannot be undone.`)) return;
    try {
      await devApi(`/users/${u._id}`, { method: 'DELETE' });
      setUsers(prev => prev.filter(x => x._id !== u._id));
      toast(`Deleted ${u.email}`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search name or email…"
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-card border border-line text-sm text-t1 placeholder:text-t3 focus:outline-none focus:border-accent"
        />
        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value as UserRole | '')}
          className="px-3 py-2 rounded-lg bg-card border border-line text-sm text-t1 focus:outline-none focus:border-accent"
        >
          <option value="">All roles</option>
          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-line text-sm text-t2 cursor-pointer">
          <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} />
          Inactive
        </label>
        <button
          onClick={() => setCreating(v => !v)}
          className="px-3 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 transition"
        >
          {creating ? 'Cancel' : '+ New user'}
        </button>
      </div>

      {creating && (
        <div className="rounded-xl border border-line bg-card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name"     value={draft.name}     onChange={v => setDraft({ ...draft, name: v })} />
          <Field label="Email"    value={draft.email}    onChange={v => setDraft({ ...draft, email: v })} />
          <Field label="Password" value={draft.password} onChange={v => setDraft({ ...draft, password: v })} />
          <div>
            <label className="block text-xs text-t2 mb-1">Role</label>
            <select
              value={draft.role}
              onChange={e => setDraft({ ...draft, role: e.target.value as UserRole })}
              className="w-full px-3 py-2 rounded-lg bg-muted border border-line text-sm text-t1 focus:outline-none focus:border-accent"
            >
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <Field label="Phone (optional)" value={draft.phone} onChange={v => setDraft({ ...draft, phone: v })} />
          {draft.role === 'university' && (
            <Field label="University name" value={draft.universityName} onChange={v => setDraft({ ...draft, universityName: v })} />
          )}
          <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
            <button onClick={createUser} className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 transition">
              Create user
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-line bg-card overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="border-b border-line text-left">
              {['User', 'Role', 'Active', 'Last seen', ''].map(h => (
                <th key={h} className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-t3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-t2">Loading…</td></tr>
            )}
            {!loading && users.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-t2">No users match.</td></tr>
            )}
            {!loading && users.map(u => (
              <tr key={u._id} className="border-b border-line/50 last:border-0 hover:bg-muted/40">
                <td className="px-4 py-3">
                  <p className="font-medium text-t1">{u.name}</p>
                  <p className="text-xs text-t3">{u.email}</p>
                  {u.universityName && <p className="text-xs text-t3">{u.universityName}</p>}
                </td>
                <td className="px-4 py-3">
                  <select
                    value={u.role}
                    onChange={e => patchUser(u._id, { role: e.target.value as UserRole })}
                    className="px-2 py-1 rounded-md bg-muted border border-line text-xs text-t1 focus:outline-none focus:border-accent"
                  >
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => patchUser(u._id, { isActive: !u.isActive })}
                    className={`px-2 py-0.5 rounded-md text-xs font-medium ${
                      u.isActive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                    }`}
                  >
                    {u.isActive ? 'active' : 'inactive'}
                  </button>
                </td>
                <td className="px-4 py-3 text-xs text-t3">
                  {u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    <MiniButton onClick={() => loginAs(u)}>Login as</MiniButton>
                    <MiniButton onClick={() => resetPassword(u)}>Password</MiniButton>
                    <MiniButton onClick={() => removeUser(u)} danger>Delete</MiniButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {handoff && <StudentHandoffModal result={handoff} onClose={() => setHandoff(null)} />}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs text-t2 mb-1">{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-muted border border-line text-sm text-t1 placeholder:text-t3 focus:outline-none focus:border-accent"
      />
    </div>
  );
}

function MiniButton({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
        danger ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-muted text-t2 hover:text-t1 hover:bg-line'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Student sessions live on the portal's origin (:3001), which this page cannot
 * write to. Hand over a paste-able snippet instead.
 */
function StudentHandoffModal({ result, onClose }: { result: ImpersonateResult; onClose: () => void }) {
  const { toast } = useToast();
  const portal = studentUrl;

  const snippet = [
    `localStorage.setItem('student_token', ${JSON.stringify(result.token)});`,
    `localStorage.setItem('student-auth', ${JSON.stringify(JSON.stringify({
      state: { user: result.user, token: result.token, studentId: result.studentId },
      version: 0,
    }))});`,
    `location.href = '/home';`,
  ].join('\n');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-line bg-surface p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-t1 mb-1">Sign in as {result.user.name}</h3>
        <p className="text-sm text-t2 mb-4">
          The student portal runs on a different origin, so paste this into the devtools console at{' '}
          <a href={portal} target="_blank" rel="noreferrer" className="text-accent hover:underline">{portal}</a>.
        </p>
        <pre className="rounded-lg bg-base border border-line p-3 text-xs text-t2 font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-64">
          {snippet}
        </pre>
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={() => { navigator.clipboard.writeText(snippet); toast('Snippet copied', 'success'); }}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 transition"
          >
            Copy snippet
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-muted text-t1 text-sm font-medium hover:bg-line transition">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Access matrix ────────────────────────────────────────────────────────── */

function RbacTab() {
  const { toast } = useToast();
  const [data, setData] = useState<DevRbac | null>(null);

  useEffect(() => {
    devApi<DevRbac>('/rbac').then(setData).catch(err => toast((err as Error).message, 'error'));
  }, [toast]);

  if (!data) return <p className="text-sm text-t2">Loading…</p>;

  const areas = [...new Set(data.matrix.map(r => r.area))];

  return (
    <div className="space-y-5">
      <Card title="Roles in use">
        <div className="flex flex-wrap gap-2">
          {data.roles.map(r => (
            <div key={r.role} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5">
              <RoleBadge role={r.role} />
              <span className="text-xs text-t2">{r.users} user{r.users === 1 ? '' : 's'}</span>
            </div>
          ))}
        </div>
      </Card>

      <p className="text-xs text-t3">
        Most guards are inline <code className="font-mono">req.user.role</code> checks rather than
        <code className="font-mono mx-1">authorize()</code> calls, so this table is a hand-maintained
        mirror declared in <code className="font-mono">backend/src/routes/dev.ts</code> — update it when
        you change a guard.
      </p>

      {areas.map(area => (
        <Card key={area} title={area}>
          <div className="space-y-3">
            {data.matrix.filter(r => r.area === area).map(rule => (
              <div key={rule.surface + rule.rule} className="rounded-lg bg-muted px-3 py-2.5">
                <p className="font-mono text-xs text-accent break-all">{rule.surface}</p>
                <p className="text-sm text-t1 mt-1">{rule.rule}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {rule.allow?.map(r => (
                    <span key={r} className="px-1.5 py-0.5 rounded text-xs bg-emerald-500/15 text-emerald-400 font-mono">+{r}</span>
                  ))}
                  {rule.deny?.map(r => (
                    <span key={r} className="px-1.5 py-0.5 rounded text-xs bg-red-500/15 text-red-400 font-mono">−{r}</span>
                  ))}
                  {!rule.allow && !rule.deny && (
                    <span className="px-1.5 py-0.5 rounded text-xs bg-slate-500/15 text-slate-400 font-mono">any authenticated</span>
                  )}
                </div>
                <p className="text-xs text-t3 mt-2 font-mono">{rule.source}</p>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ── Collection browser ───────────────────────────────────────────────────── */

function CollectionsTab({ collections }: { collections: { name: string; count: number }[] }) {
  const { toast } = useToast();
  const [name, setName]   = useState('');
  const [limit, setLimit] = useState(25);
  const [docs, setDocs]   = useState<unknown[] | null>(null);
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
        <select
          value={name}
          onChange={e => setName(e.target.value)}
          className="px-3 py-2 rounded-lg bg-card border border-line text-sm text-t1 focus:outline-none focus:border-accent"
        >
          <option value="">Choose a collection…</option>
          {collections.map(c => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
        </select>
        <select
          value={limit}
          onChange={e => setLimit(Number(e.target.value))}
          className="px-3 py-2 rounded-lg bg-card border border-line text-sm text-t1 focus:outline-none focus:border-accent"
        >
          {[10, 25, 50, 100].map(n => <option key={n} value={n}>latest {n}</option>)}
        </select>
        <span className="text-xs text-t3">Read-only. Password hashes are always stripped.</span>
      </div>

      {loading && <p className="text-sm text-t2">Loading…</p>}

      {!loading && docs && (
        <pre className="rounded-xl border border-line bg-card p-4 text-xs text-t2 font-mono overflow-auto max-h-[70vh]">
          {JSON.stringify(docs, null, 2)}
        </pre>
      )}
    </div>
  );
}
