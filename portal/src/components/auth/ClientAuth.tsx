'use client';

import { useState } from 'react';
import Link from 'next/link';
import '@/styles/le-fonts.css';
import '@/styles/le-ui.css';

/** The client's (La Europa) student sign-in layout: ink brand panel, white form, legal links. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="le-ui portal">
      <div className="auth">
        <div className="art">
          <div className="logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="mark-full" src="/brand/vernyr-logo-white.svg" alt="Vernyr" width={97} height={72} />
            <span className="logo-sep" />
            La Europa <b>Education</b>
          </div>
          <div>
            <h1>Your study abroad journey, <b>in one place</b>.</h1>
            <p>See your applications, upload documents, find courses and chat with your counsellor. La Europa applies to universities on your behalf.</p>
            <div className="flow">
              {['Profile', 'Shortlist', 'Apply', 'Offer', 'Fee', 'Visa', 'Enrolled'].map((s) => <span key={s}>{s}</span>)}
            </div>
          </div>
          <div className="small" style={{ opacity: 0.7 }}>Euroverse Service LLP, trading as La Europa Education</div>
        </div>
        <div className="box">
          {children}
          <div className="legal-foot small">
            <Link href="/legal/student-constitution" target="_blank">Student Constitution</Link>
            <Link href="/legal/privacy-policy" target="_blank">Privacy Policy</Link>
            <Link href="/legal/refund-policy" target="_blank">Refund &amp; Cancellation</Link>
            <Link href="/legal/cookie-notice" target="_blank">Cookies</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Notice({ error, ok }: { error?: string; ok?: string }) {
  return (
    <>
      {error ? <div className="err-box" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
      {ok ? <div className="ok-box" role="status" style={{ marginBottom: 12 }}>{ok}</div> : null}
    </>
  );
}

/** Password with Show / Hide and, for new passwords, the client's strength bar. */
export function PasswordField(props: {
  id: string; label: React.ReactNode; value: string; onChange: (v: string) => void; isNew?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const v = props.value;
  let n = 0;
  if (v.length >= 8) n++;
  if (/[A-Za-z]/.test(v) && /\d/.test(v)) n++;
  if (v.length >= 12) n++;
  if (/[^A-Za-z0-9]/.test(v)) n++;
  const colour = ['var(--error)', 'var(--error)', 'var(--warning)', 'var(--teal)', 'var(--teal)'][n];
  return (
    <div className="f">
      <label htmlFor={props.id}>{props.label}</label>
      <div className="pw">
        <input id={props.id} type={shown ? 'text' : 'password'} autoComplete={props.isNew ? 'new-password' : 'current-password'}
          value={v} onChange={(e) => props.onChange(e.target.value)} />
        <button type="button" onClick={() => setShown((s) => !s)}>{shown ? 'Hide' : 'Show'}</button>
      </div>
      {props.isNew ? <div className="strength"><i style={{ width: `${n * 25}%`, background: colour }} /></div> : null}
    </div>
  );
}

export const TermsText = () => (
  <span>
    I have read and agree to the <Link href="/legal/student-constitution" target="_blank">Student Constitution (Terms &amp; Conditions)</Link> and
    the <Link href="/legal/privacy-policy" target="_blank">Privacy Policy</Link><span className="req">*</span>
  </span>
);

export const apiMessage = (err: unknown, fallback = 'Something went wrong. Please try again.') =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

export const apiErrors = (err: unknown): Record<string, string> =>
  (err as { response?: { data?: { errors?: Record<string, string> } } })?.response?.data?.errors || {};

export const sixDigits = (v: string) => v.replace(/\D/g, '').slice(0, 6);
