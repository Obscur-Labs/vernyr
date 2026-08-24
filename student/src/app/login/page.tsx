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

export default function LoginPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const { toast } = useToast();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post<{ token: string; user: StudentUser; studentId?: string }>(
        '/auth/login',
        { identifier, password },
      );
      setAuth(data.user, data.token, data.studentId);
      router.push('/home');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Login failed';
      toast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-base">
      <div
        aria-hidden
        className="engraving pointer-events-none absolute left-1/2 top-1/2 w-[46rem] -translate-x-1/2 -translate-y-1/2 sm:w-[62rem]"
      >
        <VernyrSeal className="h-auto w-full" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
        <div className="flex items-center justify-center gap-2.5 text-t1">
          <VernyrMark className="h-9 w-9" />
          <Wordmark className="text-[19px]" />
        </div>

        <div className="mt-9 rounded-2xl border border-line bg-surface p-7 sm:p-9">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-t1 text-balance">
            Welcome back
          </h1>
          <p className="mt-1.5 text-[14px] text-t2">
            Pick up your application where you left it.
          </p>

          <form onSubmit={handleLogin} className="mt-8 space-y-5">
            <Field
              label="Username"
              value={identifier}
              onChange={setIdentifier}
              placeholder="e.g. aisha.malik"
              autoComplete="username"
              autoFocus
              required
              disabled={loading}
            />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
              disabled={loading}
            />
            <div className="pt-1">
              <SubmitButton loading={loading} loadingLabel="Signing in…">
                Sign in
              </SubmitButton>
            </div>
          </form>

          <p className="mt-7 border-t border-line pt-5 text-center text-[13.5px] text-t2">
            New here?{' '}
            <Link
              href="/register"
              className="font-semibold text-accent underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
            >
              Create an account
            </Link>
          </p>
        </div>

        <p className="mt-7 text-center text-[12.5px] leading-relaxed text-t2">
          Stuck? Message your counsellor, or email{' '}
          <a
            href="mailto:support@vernyr.com"
            className="text-t2 underline-offset-4 hover:underline hover:text-accent"
          >
            support@vernyr.com
          </a>
        </p>
      </div>
    </main>
  );
}
