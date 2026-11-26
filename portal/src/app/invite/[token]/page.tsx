'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import api from '@/lib/api';
import { AuthShell, Notice, PasswordField, TermsText, apiMessage, sixDigits } from '@/components/auth/ClientAuth';

type Info = { valid: boolean; message?: string; first_name?: string; masked?: string };

// The client's invite activation (legacy/public/portal/js/auth.js invite): email a code, choose a password, accept, sign in
export default function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const base = `/portal/auth/invite/${encodeURIComponent(token)}`;
  const [info, setInfo] = useState<Info | null>(null);
  const [otpId, setOtpId] = useState<string | null>(null);
  const [code, setCode] = useState(''), [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false), [comm, setComm] = useState(false), [mkt, setMkt] = useState(false);
  const [error, setError] = useState(''), [ok, setOk] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { api.get(base).then((r) => setInfo(r.data)).catch((e) => setInfo({ valid: false, message: apiMessage(e) })); }, [base]);
  const send = async () => {
    setBusy(true); setError('');
    try { const { data } = await api.post(`${base}/start`); setOtpId(data.otp_id); setOk(`Code sent to ${data.masked}`); } catch (e) { setError(apiMessage(e)); } finally { setBusy(false); }
  };
  const activate = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* unknown */ }
    try {
      const { data } = await api.post(`${base}/accept`, { otp_id: otpId, code, password, consent_terms: terms, consent_comm: comm, consent_marketing: mkt, client: { timezone: tz, locale: navigator.language } });
      setAuth(data.user, data.token, data.studentId ?? undefined); router.push('/dashboard');
    } catch (err) { setError(apiMessage(err)); setBusy(false); }
  };
  const again = async () => { try { const { data } = await api.post(`${base}/request-new`); setOk(data.message); } catch (e) { setError(apiMessage(e)); } };
  if (!info) return <AuthShell><p className="muted">Loading...</p></AuthShell>;
  if (!info.valid) return (
    <AuthShell><div style={{ maxWidth: 420 }}><h2>Link expired</h2><Notice error={error} ok={ok} /><p>{info.message}</p>
      <button className="btn primary" onClick={again}>Request new link</button> <Link className="btn" href="/forgot">Forgot password</Link></div></AuthShell>
  );
  return (
    <AuthShell>
      <form onSubmit={activate} noValidate>
        <h2>Welcome{info.first_name ? `, ${info.first_name}` : ''}!</h2>
        <p className="muted" style={{ margin: '0 0 16px' }}>Your La Europa student portal is ready. For your safety we will email a code to <b>{info.masked || 'your email'}</b> (in a separate security email).</p>
        <Notice error={error} ok={ok} />
        <button className="btn primary block" type="button" disabled={busy} onClick={send}>{otpId ? 'Email the code again' : 'Email my code'}</button>
        {otpId ? <div style={{ marginTop: 14 }}>
          <div className="f"><label htmlFor="ic">6-digit code</label><input id="ic" className="otp-input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(sixDigits(e.target.value))} /></div>
          <PasswordField id="ip" label="Choose a password" value={password} onChange={setPassword} isNew />
          <label className="consent"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} /> <TermsText /></label>
          <label className="consent"><input type="checkbox" checked={comm} onChange={(e) => setComm(e.target.checked)} /> <span>I agree to receive service updates about my application by email, phone, SMS and WhatsApp<span className="req">*</span></span></label>
          <label className="consent"><input type="checkbox" checked={mkt} onChange={(e) => setMkt(e.target.checked)} /> <span>Send me newsletters and event invitations (optional, you can stop any time)</span></label>
          <button className="btn primary block" type="submit" disabled={busy}>Activate my account</button>
        </div> : null}
      </form>
    </AuthShell>
  );
}
