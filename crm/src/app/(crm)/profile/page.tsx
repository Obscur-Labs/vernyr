'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import { usesEmailLogin } from '@/lib/credentials';
import type { User, UserRole } from '@/types';

const ROLE_LABELS: Record<UserRole, string> = {
  admin:      'Admin',
  counsellor: 'Counsellor',
  student:    'Student',
  university: 'University',
};

const errorText = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback;

export default function ProfilePage() {
  const { user: me, setAuth } = useAuthStore();
  const { toast } = useToast();

  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [savingProfile, setSavingProfile] = useState(false);

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (me) setForm({ name: me.name, email: me.email ?? '', phone: me.phone ?? '' });
  }, [me]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!me) return;

    if (usesEmailLogin(me.role) && !form.email.trim()) {
      toast('Admin accounts sign in with an email address, so it cannot be blank', 'error');
      return;
    }

    setSavingProfile(true);
    try {
      const { data } = await api.put<User>(`/users/${me._id}`, {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
      });
      // Keep the header and sidebar in step with what was just saved
      setAuth(data, localStorage.getItem('crm_token') ?? '');
      toast('Profile updated', 'success');
    } catch (err) {
      toast(errorText(err, 'Failed to update profile'), 'error');
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw.next !== pw.confirm) { toast('New passwords do not match', 'error'); return; }
    if (pw.next.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }

    setSavingPw(true);
    try {
      // /auth/change-password, not a plain user update — this is the only route
      // that verifies the current password before replacing it.
      await api.post('/auth/change-password', {
        currentPassword: pw.current,
        newPassword: pw.next,
      });
      setPw({ current: '', next: '', confirm: '' });
      toast('Password updated', 'success');
    } catch (err) {
      toast(errorText(err, 'Failed to update password'), 'error');
    } finally {
      setSavingPw(false);
    }
  }

  if (!me) return null;

  return (
    <div className="animate-fade-in p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-t1">Profile</h1>
        <p className="mt-1 text-sm text-t2">Your account details and password.</p>
      </div>

      <div className="max-w-lg space-y-6">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/20 text-sm font-bold text-accent">
              {me.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-t1">{me.name}</p>
              <p className="text-xs text-t2">
                {ROLE_LABELS[me.role]} · signs in as{' '}
                <span className="font-mono">{me.username ?? me.email}</span>
              </p>
            </div>
          </div>

          <form onSubmit={saveProfile} className="space-y-4">
            <Field label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
            <Field
              label="Email" type="email" value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
              required={usesEmailLogin(me.role)}
              hint={usesEmailLogin(me.role) ? 'You sign in with this address.' : 'Optional — contact only.'}
            />
            <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} hint="Optional." />
            <button
              type="submit" disabled={savingProfile}
              className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-60"
            >
              {savingProfile ? 'Saving…' : 'Save changes'}
            </button>
          </form>

          {me.username && (
            <p className="mt-4 border-t border-line pt-4 text-xs text-t2">
              Your username can&rsquo;t be changed here — ask an admin to change it for you.
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="mb-4 text-sm font-semibold text-t1">Change password</h2>
          <form onSubmit={changePassword} className="space-y-4">
            <Field label="Current password" type="password" value={pw.current}
              onChange={(v) => setPw({ ...pw, current: v })} required autoComplete="current-password" />
            <Field label="New password" type="password" value={pw.next}
              onChange={(v) => setPw({ ...pw, next: v })} required autoComplete="new-password"
              hint={pw.next.length > 0 && pw.next.length < 6 ? `${pw.next.length}/6 characters` : 'At least 6 characters.'} />
            <Field label="Confirm new password" type="password" value={pw.confirm}
              onChange={(v) => setPw({ ...pw, confirm: v })} required autoComplete="new-password" />
            <button
              type="submit" disabled={savingPw}
              className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-60"
            >
              {savingPw ? 'Updating…' : 'Update password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, required, type = 'text', hint, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void;
  required?: boolean; type?: string; hint?: string; autoComplete?: string;
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
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-line bg-card px-4 py-2.5 text-sm text-t1 focus:border-accent focus:outline-none"
      />
      {hint && <p className="mt-1 text-xs text-t3">{hint}</p>}
    </div>
  );
}
