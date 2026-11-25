'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { AuthShell, Notice, PasswordField, apiMessage, sixDigits } from '@/components/auth/ClientAuth';

// Forgot password: step 1 username -> a 6-digit code to the email on the account; step 2 code + new password
export default function ForgotPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [otpId, setOtpId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return setError('Enter your username');
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/auth/forgot', { identifier: username.trim(), app: 'crm' });
      setOtpId(data.otpId); setOk(data.message);
    } catch (err) { setError(apiMessage(err)); } finally { setBusy(false); }
  };

  const save = async () => {
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from the email');
    if (p1 !== p2) return setError('The two passwords do not match');
    if (p1.length < 12 || !/[A-Za-z]/.test(p1) || !/\d/.test(p1)) return setError('Minimum 12 characters, with at least 1 letter and 1 number');
    setBusy(true); setError('');
    try {
      await api.post('/auth/reset', { otpId, code, password: p1 });
      router.push('/login?reset=1');
    } catch (err) { setError(apiMessage(err)); } finally { setBusy(false); }
  };

  return (
    <AuthShell>
      <form onSubmit={send} noValidate>
        <h2>Forgot password</h2>
        <p className="muted" style={{ margin: '0 0 18px' }}>Ask your Admin to set a new password for you. If your account has an email, enter your username: we will send a 6-digit code to that email (valid for 10 minutes).</p>
        <Notice error={error} ok={ok} />
        <div className="f">
          <label htmlFor="em">Username</label>
          <input id="em" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <button className={otpId ? 'btn' : 'btn primary'} type="submit" disabled={busy}>{otpId ? 'Email the code again' : 'Email me a code'}</button>
        {otpId ? (
          <div style={{ marginTop: 16 }}>
            <div className="f">
              <label htmlFor="code">6-digit code</label>
              <input id="code" className="otp-input" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(sixDigits(e.target.value))} />
            </div>
            <PasswordField id="p1" label="New password" value={p1} onChange={setP1} autoComplete="new-password" hint="Minimum 12 characters, with at least 1 letter and 1 number." />
            <PasswordField id="p2" label="Confirm new password" value={p2} onChange={setP2} autoComplete="new-password" />
            <button className="btn primary" type="button" onClick={save} disabled={busy}>Save new password</button>
          </div>
        ) : null}
        <p style={{ marginTop: 14 }}><Link href="/login">Back to login</Link></p>
      </form>
    </AuthShell>
  );
}
