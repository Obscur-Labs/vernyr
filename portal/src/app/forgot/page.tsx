'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { AuthShell, Notice, PasswordField, apiMessage, sixDigits } from '@/components/auth/ClientAuth';

// Forgot password: step 1 email / mobile -> 6-digit code to the registered email; step 2 code + new password
export default function ForgotPage() {
  const router = useRouter();
  const [ident, setIdent] = useState('');
  const [otpId, setOtpId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ident.trim()) return setError('Enter your email or mobile');
    setBusy(true); setError('');
    try { const { data } = await api.post('/auth/forgot', { identifier: ident.trim(), app: 'portal' }); setOtpId(data.otpId); setOk(data.message); }
    catch (err) { setError(apiMessage(err)); } finally { setBusy(false); }
  };

  const save = async () => {
    if (p1 !== p2) return setError('The two passwords do not match');
    setBusy(true); setError('');
    try { await api.post('/auth/reset', { otpId, code, password: p1 }); router.push('/login?reset=1'); }
    catch (err) { setError(apiMessage(err)); } finally { setBusy(false); }
  };

  return (
    <AuthShell>
      <form onSubmit={send} noValidate>
        <h2>Forgot password</h2>
        <p className="muted" style={{ margin: '0 0 16px' }}>Enter your email or mobile. We will email a 6-digit code (valid 10 minutes) to the email address registered on your account.</p>
        <Notice error={error} ok={ok} />
        <div className="f"><label htmlFor="fi">Email or mobile</label><input id="fi" autoComplete="username" autoFocus value={ident} onChange={(e) => setIdent(e.target.value)} /></div>
        <button className={otpId ? 'btn block' : 'btn primary block'} type="submit" disabled={busy}>{otpId ? 'Email the code again' : 'Email me a code'}</button>
        {otpId ? (
          <div style={{ marginTop: 16 }}>
            <div className="f"><label htmlFor="rc">6-digit code</label><input id="rc" className="otp-input" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(sixDigits(e.target.value))} /></div>
            <p className="small muted" style={{ margin: '0 0 8px' }}>Minimum 8 characters, with at least 1 letter and 1 number.</p>
            <PasswordField id="p1" label="New password" value={p1} onChange={setP1} isNew />
            <PasswordField id="p2" label="Confirm new password" value={p2} onChange={setP2} isNew />
            <button className="btn primary block" type="button" onClick={save} disabled={busy}>Save password</button>
          </div>
        ) : null}
        <p style={{ marginTop: 14 }}><Link href="/login">Back to login</Link></p>
      </form>
    </AuthShell>
  );
}
