'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import api from '@/lib/api';
import { AuthShell, Notice, PasswordField, apiMessage } from '@/components/auth/ClientAuth';
import { OtpStep, type SignedIn } from '@/components/auth/OtpStep';

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const { setAuth } = useAuthStore();
  const [ident, setIdent] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState<{ id: string; masked: string } | null>(null);

  const done = (d: SignedIn) => { setAuth(d.user, d.token, d.studentId); router.push('/home'); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ident.trim()) return setError('Enter your email or mobile');
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/auth/login', { identifier: ident.trim(), password, remember, app: 'portal' });
      if (data.otpRequired) setOtp({ id: data.otpId, masked: data.masked });
      else done(data);
    } catch (err) { setError(apiMessage(err)); } finally { setBusy(false); }
  };

  if (otp) return <OtpStep otpId={otp.id} masked={otp.masked} title="Verify your email" onBack={() => setOtp(null)} onDone={done} />;

  return (
    <AuthShell>
      <form onSubmit={submit} noValidate>
        <h2>Student login</h2>
        <p className="muted" style={{ margin: '0 0 16px' }}>Log in to see your La Europa file.</p>
        <Notice error={error} ok={params.get('reset') ? 'Your password has been changed. Please log in.' : undefined} />
        <div className="f">
          <label htmlFor="id1">Email or mobile</label>
          <input id="id1" autoComplete="username" inputMode="email" autoFocus value={ident} onChange={(e) => setIdent(e.target.value)} />
        </div>
        <PasswordField id="pw1" label="Password" value={password} onChange={setPassword} />
        <div className="row between" style={{ margin: '6px 0 10px' }}>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Keep me logged in</label>
          <Link href="/forgot">Forgot password?</Link>
        </div>
        <button className="btn primary block" type="submit" style={{ marginTop: 10 }} disabled={busy}>{busy ? 'Logging in...' : 'Login'}</button>
        <p style={{ marginTop: 16, textAlign: 'center' }}>New to La Europa? <Link href="/register">Sign up</Link></p>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return <Suspense><Login /></Suspense>;
}
