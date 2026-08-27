'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import api from '@/lib/api';
import { USERNAME_RE } from '@/lib/credentials';
import { usePermission } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import { SkeletonTable } from '@/components/Skeleton';
import type { PortalAccount, Preset, Student } from '@/types';

const errorText = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;

type Filter = 'all' | 'student' | 'university';

const initials = (n: string) => n.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase();

const studentName = (a: PortalAccount) =>
  typeof a.studentId === 'object' && a.studentId ? a.studentId.personal?.name ?? '—' : '—';

const since = (iso?: string) => {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

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

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('role', filter);
    if (q.trim()) params.set('q', q.trim());
    const { data } = await api.get<PortalAccount[]>(`/portal-accounts?${params}`);
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

  async function resetPassword(a: PortalAccount) {
    const password = window.prompt(`New password for ${a.name} (at least 6 characters):`);
    if (!password) return;
    try {
      const { data } = await api.patch<{ message: string }>(`/portal-accounts/${a._id}/password`, { password });
      toast(data.message, 'success');
    } catch (err) {
      toast(errorText(err, 'Could not reset the password'), 'error');
    }
  }

  async function deactivate(a: PortalAccount) {
    if (!window.confirm(`Deactivate ${a.name}? They will no longer be able to sign in.`)) return;
    try {
      await api.delete(`/portal-accounts/${a._id}`);
      setRows((prev) => prev.filter((r) => r._id !== a._id));
      toast(`${a.name} deactivated`, 'success');
    } catch (err) {
      toast(errorText(err, 'Could not deactivate'), 'error');
    }
  }

  return (
    <div className="animate-fade-in p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-[28px] font-bold tracking-[-0.02em] text-t1">Portal accounts</h1>
          <p className="mt-1 text-[15px] leading-relaxed text-t2">
            Logins for the people outside the office — students and university partners. Staff
            accounts live on <a href="/members" className="text-accent hover:underline">Members</a>.
          </p>
        </div>
        {can('portal_accounts', 'create') && (
          <button onClick={() => setCreating(true)} className="hig-btn hig-btn-primary hig-press">
            Issue a login
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-full border border-line bg-card p-0.5">
          {(['all', 'student', 'university'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`hig-press rounded-full px-3.5 py-1.5 text-[13px] font-medium capitalize ${
                filter === f ? 'bg-accent text-white' : 'text-t2 hover:text-t1'
              }`}
            >
              {f === 'all' ? 'All' : f === 'student' ? 'Students' : 'Universities'}
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, username or institution…"
          aria-label="Search portal accounts"
          className="h-9 min-w-[16rem] flex-1 rounded-full border border-line bg-card px-4 text-[13px] text-t1 placeholder:text-t3 focus:border-accent focus:outline-none"
        />
      </div>

      {loading ? <SkeletonTable rows={5} /> : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="border-b border-line">
                  {['Account', 'Signs in as', 'Scope', 'Seat', 'Last seen', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wider text-t2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a._id} className="border-b border-line transition-colors last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[11px] font-bold text-accent">
                          {initials(a.name)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-medium text-t1">{a.name}</p>
                          <p className="text-[12px] capitalize text-t3">{a.role}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[14px] text-t2">{a.username ?? a.email ?? '—'}</td>
                    <td className="px-4 py-3 text-[14px] text-t2">
                      {a.role === 'student' ? studentName(a) : a.universityName ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[14px] text-t2">{a.presetName ?? a.role}</span>
                      {a.hasOverrides && (
                        <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                          Customised
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[14px] text-t3">{since(a.lastSeenAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {can('portal_accounts', 'update') && (
                          <button
                            onClick={() => resetPassword(a)}
                            className="hig-press rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-t2 hover:bg-muted hover:text-t1"
                          >
                            Reset password
                          </button>
                        )}
                        {can('portal_accounts', 'delete') && (
                          <button
                            onClick={() => deactivate(a)}
                            className="hig-press danger-action rounded-lg px-2.5 py-1.5 text-[13px] font-medium"
                          >
                            Deactivate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-[15px] text-t3">
                      {q ? `Nothing matches “${q}”.` : 'No portal logins yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating && (
        <IssueSheet
          presets={presets}
          onClose={() => setCreating(false)}
          onIssued={async () => { await load(); setCreating(false); }}
        />
      )}
    </div>
  );
}

/* ── Issue a login ──────────────────────────────────────────────────────── */

function IssueSheet({
  presets, onClose, onIssued,
}: {
  presets: Preset[];
  onClose: () => void;
  onIssued: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [role, setRole] = useState<'student' | 'university'>('student');
  const [form, setForm] = useState({
    name: '', username: '', email: '', password: '',
    studentId: '', universityName: '', presetKey: '',
  });
  const [students, setStudents] = useState<Student[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (role !== 'student' || students.length) return;
    api.get<Student[]>('/students').then((r) => setStudents(r.data)).catch(() => {});
  }, [role, students.length]);

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
    <>
      <div className="overlay-scrim animate-backdrop-in fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Issue a portal login"
        className="animate-slide-in-right fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-lg flex-col border-l border-line bg-surface shadow-2xl"
      >
        <div className="flex h-[var(--chrome-h)] shrink-0 items-center justify-between border-b border-line px-5">
          <h2 className="text-[17px] font-semibold text-t1">Issue a portal login</h2>
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
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <div className="flex rounded-full border border-line bg-card p-0.5">
              {(['student', 'university'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`hig-press flex-1 rounded-full px-3 py-2 text-[13px] font-medium capitalize ${
                    role === r ? 'bg-accent text-white' : 'text-t2 hover:text-t1'
                  }`}
                >
                  {r === 'student' ? 'Student' : 'University partner'}
                </button>
              ))}
            </div>

            {role === 'student' ? (
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-t2">Student record<span className="ml-0.5 text-t3">*</span></label>
                <select
                  value={form.studentId}
                  onChange={(e) => {
                    const s = students.find((x) => x._id === e.target.value);
                    setForm({ ...form, studentId: e.target.value, name: form.name || s?.personal?.name || '' });
                  }}
                  className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3 text-[15px] text-t1 focus:border-accent focus:outline-none"
                >
                  <option value="">Pick a student…</option>
                  {students.map((s) => (
                    <option key={s._id} value={s._id}>{s.personal?.name ?? s._id}</option>
                  ))}
                </select>
                {picked && <p className="mt-1 text-[12px] text-t3">Stage: {picked.stage.replace(/_/g, ' ')}</p>}
              </div>
            ) : (
              <Field label="Institution" required value={form.universityName}
                onChange={(v) => setForm({ ...form, universityName: v })}
                hint="Must match the name used in application records exactly." />
            )}

            <Field label="Display name" required value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label="Username" required value={form.username}
              onChange={(v) => setForm({ ...form, username: v.toLowerCase() })} hint="They sign in with this." />
            <Field label="Password" required type="password" value={form.password}
              onChange={(v) => setForm({ ...form, password: v })} hint="At least 6 characters." />
            <Field label="Email" type="email" value={form.email}
              onChange={(v) => setForm({ ...form, email: v })} hint="Optional — contact only." />

            {presets.length > 0 && (
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-t2">Seat</label>
                <select
                  value={form.presetKey || role}
                  onChange={(e) => setForm({ ...form, presetKey: e.target.value })}
                  className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3 text-[15px] text-t1 focus:border-accent focus:outline-none"
                >
                  {presets.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="flex shrink-0 gap-3 border-t border-line p-5">
            <button type="submit" disabled={saving} className="hig-btn hig-btn-primary hig-press">
              {saving ? 'Issuing…' : 'Issue login'}
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

function Field({ label, value, onChange, required, type = 'text', hint }: {
  label: string; value: string; onChange: (v: string) => void;
  required?: boolean; type?: string; hint?: string;
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
        autoComplete={type === 'password' ? 'new-password' : 'off'}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3.5 text-[15px] text-t1 placeholder:text-t3 focus:border-accent focus:outline-none"
      />
      {hint && <p className="mt-1 text-[12px] leading-snug text-t3">{hint}</p>}
    </div>
  );
}

export default function PortalAccountsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-t2">Loading portal accounts…</div>}>
      <PortalAccountsInner />
    </Suspense>
  );
}
