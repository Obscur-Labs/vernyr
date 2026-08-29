'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import { usesEmailLogin } from '@/lib/credentials';
import { Button, Card, Field, Input, PageHeader } from '@/components/ui';
import { Avatar } from '@/components/ui/table';
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
    <div className="animate-fade-in space-y-6 p-6">
      <PageHeader title="Profile" subtitle="Your account details and password." />

      <div className="max-w-lg space-y-6">
        <Card>
          <div className="mb-4 flex items-center gap-3">
            <Avatar name={me.name} className="h-12 w-12 text-sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-t1">{me.name}</p>
              <p className="text-xs text-t2">
                {ROLE_LABELS[me.role]} · signs in as{' '}
                <span className="font-mono">{me.username ?? me.email}</span>
              </p>
            </div>
          </div>

          <form onSubmit={saveProfile} className="space-y-4">
            <Field label="Full name" required>
              {(id) => (
                <Input id={id} required value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              )}
            </Field>

            <Field
              label="Email"
              required={usesEmailLogin(me.role)}
              hint={usesEmailLogin(me.role) ? 'You sign in with this address.' : 'Optional — contact only.'}
            >
              {(id) => (
                <Input id={id} type="email" required={usesEmailLogin(me.role)} value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })} />
              )}
            </Field>

            <Field label="Phone" hint="Optional.">
              {(id) => (
                <Input id={id} value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              )}
            </Field>

            <Button type="submit" disabled={savingProfile}>
              {savingProfile ? 'Saving…' : 'Save changes'}
            </Button>
          </form>

          {me.username && (
            <p className="mt-4 border-t border-line pt-4 text-xs text-t2">
              Your username can&rsquo;t be changed here — ask an admin to change it for you.
            </p>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-semibold text-t1">Change password</h2>
          <form onSubmit={changePassword} className="space-y-4">
            <Field label="Current password" required>
              {(id) => (
                <Input id={id} type="password" required autoComplete="current-password"
                  value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
              )}
            </Field>

            <Field
              label="New password"
              required
              hint={pw.next.length > 0 && pw.next.length < 6 ? `${pw.next.length}/6 characters` : 'At least 6 characters.'}
            >
              {(id) => (
                <Input id={id} type="password" required autoComplete="new-password"
                  invalid={pw.next.length > 0 && pw.next.length < 6}
                  value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
              )}
            </Field>

            <Field
              label="Confirm new password"
              required
              error={pw.confirm.length > 0 && pw.confirm !== pw.next ? 'These do not match.' : null}
            >
              {(id) => (
                <Input id={id} type="password" required autoComplete="new-password"
                  invalid={pw.confirm.length > 0 && pw.confirm !== pw.next}
                  value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
              )}
            </Field>

            <Button type="submit" disabled={savingPw}>
              {savingPw ? 'Updating…' : 'Update password'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
