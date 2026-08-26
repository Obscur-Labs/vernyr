'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import api from '@/lib/api';
import { VernyrSeal, VernyrMark, Wordmark } from '@/components/auth/Insignia';
import { Field, SubmitButton } from '@/components/auth/Field';

const CAPABILITIES = [
  {
    title: 'Pipeline',
    body: 'Every enquiry from first contact to departure, on one board.',
    glyph: (
      <>
        <circle cx="4" cy="6" r="2" />
        <circle cx="12" cy="6" r="2" />
        <circle cx="20" cy="6" r="2" />
        <path d="M6 6h4M14 6h4M4 9v6a3 3 0 003 3h13" />
      </>
    ),
  },
  {
    title: 'Verification',
    body: 'Passports, transcripts and financials checked and countersigned.',
    glyph: (
      <>
        <path d="M5 3h9l5 5v13H5z" />
        <path d="M14 3v5h5" />
        <path d="M8.5 14.5l2.5 2.5 4.5-5" />
      </>
    ),
  },
  {
    title: 'Deadlines',
    body: 'Offer windows, CAS dates and visa filings tracked to the day.',
    glyph: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
        <circle cx="12" cy="15.5" r="2.2" />
      </>
    ),
  },
];

export default function LoginPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const { toast } = useToast();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { identifier, password });

      // The portal seat has no Dashboard, which is what makes it a portal seat.
      // Signing in here used to succeed and then land on a page of 403s.
      if (!data.access?.permissions?.dashboard?.read) {
        toast('This account signs in on the student portal, not here.', 'error');
        return;
      }

      setAuth(data.user, data.token, data.access);
      toast('Welcome back!', 'success');
      router.push('/dashboard');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Invalid credentials';
      toast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-base">
      {/* Engraved field — a struck seal bleeding off the left edge */}
      <div
        aria-hidden
        className="engraving pointer-events-none absolute top-1/2 hidden -translate-y-1/2 lg:block"
        style={{ left: '-15rem', width: '44rem' }}
      >
        <VernyrSeal className="w-full h-auto" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10 sm:px-10">
        <header className="flex items-center gap-3 text-t1">
          <VernyrMark className="w-9 h-9" />
          <Wordmark className="text-[19px]" />
          <span aria-hidden className="h-4 w-px bg-line" />
          <span className="text-[13px] text-t2">Counsellor workspace</span>
        </header>

        <div className="grid flex-1 items-center gap-16 py-14 lg:grid-cols-12 lg:gap-10">
          {/* Brand column */}
          <section className="hidden lg:col-span-5 lg:block">
            <h1 className="text-[2.6rem] font-semibold leading-[1.08] tracking-[-0.03em] text-t1 text-balance">
              Every file, every deadline, every student.
            </h1>
            <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-t2 text-pretty">
              Vernyr keeps a consultancy&rsquo;s paperwork straight — so nothing slips between an
              enquiry and a boarding pass.
            </p>

            <ul className="mt-11 border-t border-line">
              {CAPABILITIES.map((c) => (
                <li key={c.title} className="flex gap-4 border-b border-line py-4">
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden
                    className="mt-0.5 w-[18px] h-[18px] shrink-0 text-accent"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {c.glyph}
                  </svg>
                  <div>
                    <p className="text-[14px] font-medium text-t1">{c.title}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-t2">{c.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Sign-in plate */}
          <section className="lg:col-span-6 lg:col-start-7">
            <div className="mx-auto w-full max-w-md rounded-2xl border border-line bg-surface p-7 sm:p-9">
              <h2 className="text-[22px] font-semibold tracking-[-0.015em] text-t1">Sign in</h2>
              <p className="mt-1.5 text-[14px] text-t2">
                Staff accounts are issued by your administrator. Administrators sign in with their
                email address.
              </p>

              <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                <Field
                  label="Username"
                  value={identifier}
                  onChange={setIdentifier}
                  placeholder="e.g. sarah.thompson"
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

              <p className="mt-7 border-t border-line pt-5 text-[13px] leading-relaxed text-t2">
                Locked out or need an account? Ask a super admin to issue one from Settings →
                Users.
              </p>
            </div>
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-t2">
          <span>© {new Date().getFullYear()} Vernyr</span>
          <span className="tabular-nums">Study abroad operations</span>
        </footer>
      </div>
    </main>
  );
}
