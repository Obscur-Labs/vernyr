'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { usesEmailLogin, loginHandle, USERNAME_RE } from '@/lib/credentials';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import { SkeletonTable } from '@/components/Skeleton';
import type { User, UserRole } from '@/types';

const ROLE_OPTIONS: UserRole[] = ['admin', 'counsellor', 'university'];

const ROLE_COLORS: Record<UserRole, string> = {
  admin:      'bg-indigo-500/15 text-indigo-400',
  counsellor: 'bg-emerald-500/15 text-emerald-400',
  student:    'bg-sky-500/15 text-sky-400',
  university: 'bg-teal-500/15 text-teal-400',
};

interface NewMember {
  name: string; username: string; email: string; password: string;
  role: UserRole; phone: string; universityName: string;
}

const BLANK: NewMember = {
  name: '', username: '', email: '', password: '',
  role: 'counsellor', phone: '', universityName: '',
};

/** Whatever the server said, or a fallback — never swallow the real reason. */
const errorText = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;

export default function MembersPage() {
  const { user: me } = useAuthStore();
  const { toast } = useToast();

  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<NewMember>(BLANK);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<User[]>('/users')
      .then((r) => setMembers(r.data))
      .catch((err) => toast(errorText(err, 'Failed to load members'), 'error'))
      .finally(() => setLoading(false));
  }, [toast]);

  const needsEmail = usesEmailLogin(draft.role);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();

    if (needsEmail && !draft.email.trim()) {
      toast('Admin accounts sign in with an email address', 'error'); return;
    }
    if (!needsEmail && !USERNAME_RE.test(draft.username.trim().toLowerCase())) {
      toast('Username must be 3–32 characters: letters, numbers, dot, underscore or hyphen', 'error'); return;
    }
    if (draft.password.length < 6) {
      toast('Password must be at least 6 characters', 'error'); return;
    }
    if (draft.role === 'university' && !draft.universityName.trim()) {
      toast('University accounts need the institution name', 'error'); return;
    }

    // Only send fields that carry a value. A blank string is not "no value" to
    // Mongo's unique index — it is a value, and the first one saved blocks
    // every later member who leaves the same field empty.
    const payload: Record<string, string> = { name: draft.name.trim(), password: draft.password, role: draft.role };
    if (draft.username.trim()) payload.username = draft.username.trim().toLowerCase();
    if (draft.email.trim()) payload.email = draft.email.trim();
    if (draft.phone.trim()) payload.phone = draft.phone.trim();
    if (draft.universityName.trim()) payload.universityName = draft.universityName.trim();

    setSaving(true);
    try {
      const res = await api.post<User>('/users', payload);
      setMembers((prev) => [...prev, res.data]);
      setShowForm(false);
      setDraft(BLANK);
      toast(`${res.data.name} added`, 'success');
    } catch (err) {
      toast(errorText(err, 'Failed to add member'), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(member: User) {
    if (!window.confirm(`Deactivate ${member.name}? They will no longer be able to sign in.`)) return;
    try {
      await api.put(`/users/${member._id}`, { isActive: false });
      setMembers((prev) => prev.filter((u) => u._id !== member._id));
      toast(`${member.name} deactivated`, 'success');
    } catch (err) {
      toast(errorText(err, 'Failed to deactivate'), 'error');
    }
  }

  return (
    <div className="animate-fade-in p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-t1">Members</h1>
          <p className="mt-1 text-sm text-t2">
            Staff and partner accounts. Admins sign in with an email address; every other role
            signs in with a username.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
        >
          {showForm ? 'Cancel' : '+ Add member'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={addMember} className="mb-6 space-y-4 rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-t1">New member</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />

            <div>
              <label className="mb-1 block text-xs text-t3">Role</label>
              <select
                value={draft.role}
                onChange={(e) => setDraft({ ...draft, role: e.target.value as UserRole })}
                className="w-full rounded-xl border border-line bg-card px-3 py-2 text-sm text-t1 focus:border-accent focus:outline-none"
              >
                {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            {needsEmail ? (
              <Field
                label="Email" required type="email" value={draft.email}
                onChange={(v) => setDraft({ ...draft, email: v })}
                hint="Admins sign in with this."
              />
            ) : (
              <Field
                label="Username" required value={draft.username}
                onChange={(v) => setDraft({ ...draft, username: v.toLowerCase() })}
                placeholder="e.g. sarah.thompson"
                hint="They sign in with this."
              />
            )}

            <Field
              label="Password" required type="password" value={draft.password}
              onChange={(v) => setDraft({ ...draft, password: v })}
              hint="At least 6 characters."
            />

            {!needsEmail && (
              <Field label="Email" type="email" value={draft.email}
                onChange={(v) => setDraft({ ...draft, email: v })} hint="Optional — contact only." />
            )}

            <Field label="Phone" value={draft.phone} onChange={(v) => setDraft({ ...draft, phone: v })} hint="Optional." />

            {draft.role === 'university' && (
              <div className="sm:col-span-2">
                <Field
                  label="University name" required value={draft.universityName}
                  onChange={(v) => setDraft({ ...draft, universityName: v })}
                  placeholder="e.g. University of Manchester"
                  hint="Must match the name used in application records exactly."
                />
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              type="submit" disabled={saving}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-60"
            >
              {saving ? 'Adding…' : 'Add member'}
            </button>
            <button
              type="button" onClick={() => { setShowForm(false); setDraft(BLANK); }}
              className="rounded-xl bg-muted px-4 py-2 text-sm font-semibold text-t2 transition-colors hover:bg-line"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? <SkeletonTable rows={5} /> : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-line">
                  {['Member', 'Sign-in', 'Role', 'Phone', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-t2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((u) => (
                  <tr key={u._id} className="border-b border-line transition-colors last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent">
                          {u.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </span>
                        <span className="text-sm font-medium text-t1">{u.name}</span>
                        {u._id === me?._id && (
                          <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-xs text-accent">You</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-t2">{loginHandle(u)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${ROLE_COLORS[u.role]}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-t2">{u.phone || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {u._id !== me?._id && (
                        <button onClick={() => deactivate(u)} className="text-xs text-red-400 hover:underline">
                          Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {members.length === 0 && (
                  <tr><td colSpan={5} className="py-12 text-center text-sm text-t3">No members yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, required, type = 'text', placeholder, hint }: {
  label: string; value: string; onChange: (v: string) => void;
  required?: boolean; type?: string; placeholder?: string; hint?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-t3">
        {label}{required && <span className="ml-0.5 text-red-400">*</span>}
      </label>
      <input
        type={type}
        required={required}
        value={value}
        placeholder={placeholder}
        autoComplete={type === 'password' ? 'new-password' : 'off'}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-line bg-card px-3 py-2 text-sm text-t1 placeholder:text-t3 focus:border-accent focus:outline-none"
      />
      {hint && <p className="mt-1 text-xs text-t3">{hint}</p>}
    </div>
  );
}
