'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import type { StudentUser } from '@/types';
import { VernyrSeal, VernyrMark, Wordmark } from '@/components/auth/Insignia';
import { Field, SubmitButton } from '@/components/auth/Field';
import { USERNAME_RE } from '@/lib/credentials';

/** A real sequence, so the numbering carries information. */
const STEPS = [
  { n: '01', title: 'Create your account', body: 'Takes a minute. No documents needed yet.' },
  { n: '02', title: 'A counsellor picks up your file', body: 'They introduce themselves in chat.' },
  { n: '03', title: 'Track everything here', body: 'Offers, documents, payments and visa stage.' },
];

export default function RegisterPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();

    if (!USERNAME_RE.test(username.trim().toLowerCase())) {
      toast('Pick a username of 3–32 letters, numbers, dots, underscores or hyphens', 'error');
      return;
    }

    if (password.length < 6) {
      toast('Password must be at least 6 characters', 'error');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post<{ token: string; user: StudentUser; studentId?: string }>(
        '/auth/register-student',
        { name, username: username.trim().toLowerCase(), email: email.trim(), phone, password },
      );
      setAuth(data.user, data.token, data.studentId);
      toast('You’re in — welcome to Vernyr.', 'success');
      router.push('/home');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Registration failed';
      toast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-base">
      <div
        aria-hidden
        className="engraving pointer-events-none absolute right-[-16rem] top-1/2 hidden w-[56rem] -translate-y-1/2 lg:block"
      >
        <VernyrSeal className="h-auto w-full" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-10 sm:px-8">
        <header className="flex items-center gap-2.5 text-t1">
          <VernyrMark className="h-9 w-9" />
          <Wordmark className="text-[19px]" />
        </header>

        <div className="grid flex-1 items-center gap-14 py-12 lg:grid-cols-12 lg:gap-12">
          <section className="hidden lg:col-span-5 lg:block">
            <h1 className="text-[2.3rem] font-semibold leading-[1.1] tracking-[-0.03em] text-t1 text-balance">
              Start your file.
            </h1>
            <p className="mt-4 max-w-[42ch] text-[15px] leading-relaxed text-t2 text-pretty">
              One place for your applications, documents and visa progress — and a direct line to
              the person handling them.
            </p>

            <ol className="mt-10 border-t border-line">
              {STEPS.map((s) => (
                <li key={s.n} className="flex gap-4 border-b border-line py-4">
                  <span className="mt-0.5 text-[12px] font-semibold tabular-nums text-accent">
                    {s.n}
                  </span>
                  <div>
                    <p className="text-[14px] font-medium text-t1">{s.title}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-t2">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="lg:col-span-6 lg:col-start-7">
            <div className="mx-auto w-full max-w-md rounded-2xl border border-line bg-surface p-7 sm:p-9">
              <h2 className="text-[22px] font-semibold tracking-[-0.015em] text-t1">
                Create your account
              </h2>
              <p className="mt-1.5 text-[14px] text-t2">Free, and takes about a minute.</p>

              <form onSubmit={handleRegister} className="mt-8 space-y-5">
                <Field
                  label="Full name"
                  value={name}
                  onChange={setName}
                  placeholder="As it appears on your passport"
                  autoComplete="name"
                  autoFocus
                  required
                  disabled={loading}
                />
                <Field
                  label="Username"
                  value={username}
                  onChange={(v) => setUsername(v.toLowerCase())}
                  placeholder="How you'll sign in — e.g. aisha.malik"
                  autoComplete="username"
                  required
                  disabled={loading}
                />
                <Field
                  label="Email"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="you@example.com"
                  autoComplete="email"
                  hint="Optional"
                  disabled={loading}
                />
                <Field
                  label="Phone"
                  type="tel"
                  value={phone}
                  onChange={setPhone}
                  placeholder="+91 98765 43210"
                  autoComplete="tel"
                  required
                  disabled={loading}
                />
                <Field
                  label="Password"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  hint={password.length > 0 && password.length < 6 ? `${password.length}/6` : undefined}
                  required
                  disabled={loading}
                />
                <div className="pt-1">
                  <SubmitButton loading={loading} loadingLabel="Creating your account…">
                    Create account
                  </SubmitButton>
                </div>
              </form>

              <p className="mt-7 border-t border-line pt-5 text-center text-[13.5px] text-t2">
                Already registered?{' '}
                <Link
                  href="/login"
                  className="font-semibold text-accent underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
                >
                  Sign in
                </Link>
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
