'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { POST } from '@/le/api';
import { toast } from '@/le/ui';
import { AuthShell, Notice, PasswordField, msg } from '@/le/auth';

/** Forgot password: email, a 6-digit code by email, then the new password. */
export default function Forgot() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [codeId, setCodeId] = useState<string | null>(null);
  const [code, setCode] = useState(''); const [p1, setP1] = useState(''); const [p2, setP2] = useState('');
  const [error, setError] = useState(''); const [ok, setOk] = useState('');
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    try { const r = await POST('/auth/forgot', { email: email.trim() }); setCodeId(r.code_id); setOk(r.message); setError(''); } catch (er) { setError(msg(er)); }
  };
  const save = async () => {
    try { const r = await POST('/auth/reset', { code_id: codeId, code, password: p1, confirm: p2 }); toast(r.message, 'ok'); router.push('/login'); } catch (er) { setError(msg(er)); }
  };
  return (
    <AuthShell>
      <form onSubmit={send} noValidate>
        <h2>Forgot password</h2>
        <p className="muted" style={{ margin: '0 0 16px' }}>Enter your work email. We will email you a 6-digit code (valid 10 minutes).</p>
        <Notice error={error} ok={ok} />
        <div className="f"><label htmlFor="fe">Work email</label><input id="fe" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <button className={`btn block ${codeId ? '' : 'primary'}`} type="submit">{codeId ? 'Email the code again' : 'Email me a code'}</button>
        {codeId ? (
          <div style={{ marginTop: 16 }}>
            <div className="f"><label htmlFor="rc">6-digit code</label><input id="rc" className="otp-input" inputMode="numeric" maxLength={6} autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} /></div>
            <p className="small muted" style={{ margin: '0 0 8px' }}>New password: minimum 10 characters, with a letter, a number and a symbol. Your last 5 passwords cannot be reused.</p>
            <PasswordField id="r1" label="New password" value={p1} onChange={setP1} />
            <PasswordField id="r2" label="Confirm new password" value={p2} onChange={setP2} />
            <button className="btn primary block" type="button" onClick={save}>Save new password</button>
          </div>
        ) : null}
        <p style={{ marginTop: 14 }}><Link href="/login">Back to login</Link></p>
      </form>
    </AuthShell>
  );
}
