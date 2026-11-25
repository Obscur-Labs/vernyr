'use client';

import { useState } from 'react';
import '@/styles/le-fonts.css';
import '@/styles/le-ui.css';

/** The client's (La Europa) sign-in layout: ink brand panel on the left, white form on the right. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="le-ui">
      <div className="auth">
        <div className="art">
          <div>
            <div className="logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="mark-full" src="/brand/vernyr-logo-white.svg" alt="Vernyr" width={97} height={72} />
              <span className="logo-sep" />
              La Europa <b>Education</b>
            </div>
          </div>
          <div>
            <h1>Every student file, <b>one place</b>.</h1>
            <p>Leads, applications, documents, fees and visa progress, with automatic updates to every student.</p>
            <div className="flow">
              {['Lead', 'Student', 'Shortlist', 'Application', 'Offer', 'Fee', 'Visa', 'Enrolled'].map((s) => <span key={s}>{s}</span>)}
            </div>
          </div>
          <div className="small" style={{ opacity: 0.7 }}>Euroverse Service LLP, trading as La Europa Education</div>
        </div>
        <div className="box">{children}</div>
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

export function PasswordField(props: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  autoComplete?: string; hint?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="f">
      <label htmlFor={props.id}>{props.label}</label>
      <div className="pw">
        <input id={props.id} type={shown ? 'text' : 'password'} value={props.value} autoComplete={props.autoComplete ?? 'current-password'}
          onChange={(e) => props.onChange(e.target.value)} />
        <button type="button" onClick={() => setShown((s) => !s)}>{shown ? 'Hide' : 'Show'}</button>
      </div>
      {props.hint ? <div className="small muted">{props.hint}</div> : null}
    </div>
  );
}

export const apiMessage = (err: unknown, fallback = 'Something went wrong. Please try again.') =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback;

export const sixDigits = (v: string) => v.replace(/\D/g, '').slice(0, 6);
