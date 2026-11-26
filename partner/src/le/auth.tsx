'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import '@/styles/le-fonts.css';
import '@/styles/le-ui.css';
import { ApiError } from './api';
import { signIn } from './u';
import { UiHost, toast } from './ui';

/** The client's partner sign-in layout (legacy/public/university/js/auth.js): ink brand panel, white form. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="le-ui uni">
      <div className="auth uni-auth">
        <div className="art">
          <div className="logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="mark-full" src="/brand/vernyr-logo-white.svg" alt="Vernyr" width={97} height={72} />
            <span className="logo-sep" />
            La Europa <b>Partner Portal</b>
          </div>
          <div>
            <h1>Applications from La Europa, <b>in one place</b>.</h1>
            <p>Review applications La Europa submitted to you, request documents, issue decisions and offer letters, keep your courses up to date and manage invoices.</p>
            <div className="flow">{['Received', 'Review', 'Interview', 'Offer', 'Accepted', 'Deposit', 'Enrolled'].map((s) => <span key={s}>{s}</span>)}</div>
          </div>
          <div className="small" style={{ opacity: 0.7 }}>Euroverse Service LLP, trading as La Europa Education</div>
        </div>
        <div className="box">{children}</div>
      </div>
      <UiHost />
    </div>
  );
}
export const Notice = ({ error, ok }: { error?: string; ok?: string }) => (
  <>
    {error ? <div className="err-box" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
    {ok ? <div className="ok-box" role="status" style={{ marginBottom: 12 }}>{ok}</div> : null}
  </>
);
export function PasswordField({ id, label, value, onChange, auto = 'new-password' }: { id: string; label: React.ReactNode; value: string; onChange: (v: string) => void; auto?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="f">
      <label htmlFor={id}>{label}</label>
      <div className="pw">
        <input id={id} type={shown ? 'text' : 'password'} autoComplete={auto} value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={() => setShown((s) => !s)}>{shown ? 'Hide' : 'Show'}</button>
      </div>
    </div>
  );
}
export const msg = (e: unknown) => (e as ApiError)?.message || 'Something went wrong';
/** after a sign-in: keep the token, go where the visitor was heading */
export function useEnter() {
  const router = useRouter();
  return (d: { token: string; user: { name: string } }) => {
    signIn(d.token); toast(`Welcome, ${d.user.name}`, 'ok');
    const a = sessionStorage.getItem('leu:after'); sessionStorage.removeItem('leu:after');
    router.replace(a && !/login|invite|reset|forgot|preview/.test(a) ? a : '/dashboard');
  };
}
