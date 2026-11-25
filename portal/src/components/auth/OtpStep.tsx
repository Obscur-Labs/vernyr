'use client';

import { useEffect, useRef, useState } from 'react';
import api from '@/lib/api';
import { AuthShell, Notice, apiMessage, sixDigits } from './ClientAuth';

export type SignedIn = { token: string; user: never; studentId?: string };

/** "We emailed a 6-digit code": first login and sign-up both end here. */
export function OtpStep({ otpId, masked, title, onBack, onDone }: {
  otpId: string; masked: string; title: string; onBack: () => void; onDone: (d: SignedIn) => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [left, setLeft] = useState(30);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = () => {
    setLeft(30);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => setLeft((n) => { if (n <= 1 && timer.current) clearInterval(timer.current); return n - 1; }), 1000);
  };
  useEffect(() => { startTimer(); return () => { if (timer.current) clearInterval(timer.current); }; }, []);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    try { const { data } = await api.post<SignedIn>('/auth/otp', { otpId, code }); onDone(data); }
    catch (err) { setError(apiMessage(err)); }
  };
  const resend = async () => {
    try { await api.post('/auth/otp/resend', { otpId, app: 'portal' }); setOk('A new code has been sent'); setError(''); startTimer(); }
    catch (err) { setError(apiMessage(err)); }
  };

  return (
    <AuthShell>
      <form onSubmit={verify} noValidate>
        <h2>{title}</h2>
        <p className="muted" style={{ margin: '0 0 16px' }}>We emailed a 6-digit code to <b>{masked}</b>. It is valid for 10 minutes. Check your spam folder if you do not see it.</p>
        <Notice error={error} ok={ok} />
        <div className="f">
          <label htmlFor="code">6-digit code</label>
          <input id="code" className="otp-input" inputMode="numeric" maxLength={6} autoComplete="one-time-code" autoFocus
            value={code} onChange={(e) => setCode(sixDigits(e.target.value))} />
        </div>
        <button className="btn primary block" type="submit">Verify</button>
        <div className="row between" style={{ marginTop: 14 }}>
          <a href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>Back</a>
          <button type="button" className="btn ghost sm" disabled={left > 0} onClick={resend}>{left > 0 ? `Resend code (${left})` : 'Resend code'}</button>
        </div>
      </form>
    </AuthShell>
  );
}
