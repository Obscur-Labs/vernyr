'use client';

import { useState } from 'react';
import Link from 'next/link';
import { POST } from '@/le/api';
import { toast } from '@/le/ui';
import { AuthShell, Notice, PasswordField, msg, useEnter } from '@/le/auth';

/** UP01: password login; on the first login only, a code emailed to confirm the email. */
export default function Login() {
  const enter = useEnter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<{ code_id: string; masked?: string } | null>(null);
  const [otp, setOtp] = useState('');

  const login = async () => {
    const r = await POST('/auth/login', { email: email.trim(), password });
    if (r.token) enter(r); else setCode({ code_id: r.code_id, masked: r.masked });
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await login(); } catch (er) { setError(msg(er)); } finally { setBusy(false); }
  };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { enter(await POST('/auth/2fa/verify', { code: otp, code_id: code!.code_id })); }
    catch (er) { setError(msg(er)); } finally { setBusy(false); }
  };
  // a new code: the login is sent again, which emails a fresh one
  const resend = async (e: React.MouseEvent) => { e.preventDefault(); try { await login(); toast('A new code has been sent', 'ok'); } catch (er) { setError(msg(er)); } };

  if (code) return (
    <AuthShell>
      <form onSubmit={verify} noValidate>
        <h2>Verify your email</h2>
        <p className="muted" style={{ margin: '0 0 16px' }}>This is your first login, so we emailed a 6-digit code to <b>{code.masked || 'your email'}</b> (valid for 10 minutes). You need it only once; after this you log in with your password.</p>
        <Notice error={error} />
        <div className="f"><label htmlFor="code">Email code</label><input id="code" className="otp-input" inputMode="numeric" maxLength={6} autoComplete="one-time-code" autoFocus value={otp} onChange={(e) => setOtp(e.target.value)} /></div>
        <button className="btn primary block" type="submit" disabled={busy}>Verify</button>
        <div className="row between small" style={{ marginTop: 14 }}><a href="#" onClick={resend}>Send a new code</a><a href="#" onClick={(e) => { e.preventDefault(); setCode(null); setOtp(''); }}>Back</a></div>
      </form>
    </AuthShell>
  );
  return (
    <AuthShell>
      <form onSubmit={submit} noValidate>
        <h2>Partner login</h2>
        <p className="muted" style={{ margin: '0 0 16px' }}>For university staff invited by La Europa Education.</p>
        <Notice error={error} />
        <div className="f"><label htmlFor="em">Work email</label><input id="em" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <PasswordField id="pw1" label="Password" value={password} onChange={setPassword} auto="current-password" />
        <div className="row between" style={{ margin: '6px 0 16px' }}><span /><Link href="/forgot">Forgot password?</Link></div>
        <button className="btn primary block" type="submit" disabled={busy}>Login</button>
        <p className="small muted" style={{ marginTop: 14 }}>On your first login we email you a one-time code to confirm your email. After that you log in with your password.</p>
      </form>
    </AuthShell>
  );
}
