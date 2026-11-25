'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import api from '@/lib/api';
import { AuthShell, Notice, PasswordField, apiMessage, sixDigits } from '@/components/auth/ClientAuth';

type LoginResult = {
  token?: string; user?: never; access?: { permissions?: Record<string, { read?: boolean }> };
  otpRequired?: boolean; otpId?: string; masked?: string;
};

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const { setAuth } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [hp, setHp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState<{ id: string; masked: string } | null>(null);

  const finish = (data: LoginResult) => {
    // the student and university seats have no Dashboard: they sign in on their own portal
    if (!data.access?.permissions?.dashboard?.read || !data.token || !data.user) {
      setError('Invalid username or password');
      return;
    }
    setAuth(data.user, data.token, data.access as never);
    router.push('/dashboard');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return setError('Enter your username');
    if (password.length < 8) return setError('Password must be at least 8 characters');
    setBusy(true); setError('');
    try {
      const { data } = await api.post<LoginResult>('/auth/login', { identifier: username.trim(), password, remember, hp, app: 'crm' });
      if (data.otpRequired && data.otpId) setOtp({ id: data.otpId, masked: data.masked ?? 'your email' });
      else finish(data);
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (otp) return <OtpStep otp={otp} onBack={() => { setOtp(null); setPassword(''); }} onDone={finish} />;

  return (
    <AuthShell>
      <form onSubmit={submit} noValidate>
        <h2>Log in</h2>
        <p className="muted" style={{ margin: '0 0 18px' }}>Staff access only. Ask Admin for an account.</p>
        <Notice error={error} ok={params.get('reset') ? 'Your password has been changed. Please log in.' : undefined} />
        <div className="f">
          <label htmlFor="em">Username</label>
          <input id="em" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus
            value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <PasswordField id="pw" label="Password" value={password} onChange={setPassword} />
        <div className="row between" style={{ margin: '4px 0 16px' }}>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember me (7 days)
          </label>
          <Link href="/forgot">Forgot password?</Link>
        </div>
        <input name="hp" className="hp-field" tabIndex={-1} autoComplete="off" aria-hidden="true" value={hp} onChange={(e) => setHp(e.target.value)} />
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Logging in...' : 'Login'}</button>
      </form>
    </AuthShell>
  );
}

function OtpStep({ otp, onBack, onDone }: { otp: { id: string; masked: string }; onBack: () => void; onDone: (d: LoginResult) => void }) {
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
    try { const { data } = await api.post<LoginResult>('/auth/otp', { otpId: otp.id, code }); onDone(data); }
    catch (err) { setError(apiMessage(err)); }
  };
  const resend = async () => {
    try { await api.post('/auth/otp/resend', { otpId: otp.id, app: 'crm' }); setOk('A new code has been sent'); setError(''); startTimer(); }
    catch (err) { setError(apiMessage(err)); }
  };

  return (
    <AuthShell>
      <form onSubmit={verify} noValidate>
        <h2>Verify your email</h2>
        <p className="muted" style={{ margin: '0 0 18px' }}>This is your first login, so we sent a 6-digit code to {otp.masked} (valid for 10 minutes). You need it only once; after this you log in with your password.</p>
        <Notice error={error} ok={ok} />
        <div className="f">
          <label htmlFor="code">6-digit code</label>
          <input id="code" className="otp-input" inputMode="numeric" maxLength={6} autoComplete="one-time-code" autoFocus
            value={code} onChange={(e) => setCode(sixDigits(e.target.value))} />
        </div>
        <button className="btn primary" type="submit">Verify</button>
        <div className="row between" style={{ marginTop: 14 }}>
          <a href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>Back to login</a>
          <button type="button" className="btn ghost sm" disabled={left > 0} onClick={resend}>{left > 0 ? `Resend OTP (${left})` : 'Resend OTP'}</button>
        </div>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return <Suspense><Login /></Suspense>;
}
