'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import api from '@/lib/api';
import { AuthShell, Notice, PasswordField, TermsText, apiErrors, apiMessage } from '@/components/auth/ClientAuth';
import { OtpStep, type SignedIn } from '@/components/auth/OtpStep';

const CODES = ['+91', '+977', '+880', '+94', '+971', '+1', '+44'];
type Age = 'adult' | 'minor' | 'child';

function Signup() {
  const router = useRouter();
  const q = useSearchParams();
  const walkin = q.get('src') === 'walkin';
  const { setAuth } = useAuthStore();
  const [cfg, setCfg] = useState<{ countries: string[]; intakes: string[] }>({ countries: [], intakes: [] });
  const [v, setV] = useState({
    first_name: '', last_name: '', email: '', country_code: '+91', phone: '', is_whatsapp: true, password: '',
    country: '', intake: '', referral_code: q.get('ref') ?? '', promo_code: q.get('promo') ?? '',
    guardian_name: '', guardian_relation: 'Mother', guardian_email: '', guardian_consent: false,
    consent_terms: false, consent_comm: false, consent_marketing: false,
  });
  const [age, setAge] = useState<Age>('adult');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState<{ id: string; masked: string } | null>(null);

  useEffect(() => { api.get('/auth/config').then(({ data }) => setCfg(data)).catch(() => {}); }, []);
  useEffect(() => { setError(age === 'child' ? 'Students under 13 cannot create an account. Please ask your parent to contact La Europa.' : ''); }, [age]);

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setV((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  const fieldClass = (k: string, cols: 'c3' | 'c6') => `f ${cols}${errors[k] ? ' err' : ''}`;
  const msg = (k: string) => <div className="msg">{errors[k] ?? ''}</div>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(''); setErrors({});
    try {
      const { data } = await api.post('/auth/signup', { ...v, age_group: age, walkin: walkin || undefined });
      setOtp({ id: data.otpId, masked: data.masked });
    } catch (err) {
      setError(apiMessage(err)); setErrors(apiErrors(err));
    } finally { setBusy(false); }
  };

  if (otp) {
    return <OtpStep otpId={otp.id} masked={otp.masked} title="Verify your email" onBack={() => setOtp(null)}
      onDone={(d: SignedIn) => { setAuth(d.user, d.token, d.studentId); router.push('/home'); }} />;
  }

  return (
    <AuthShell>
      <form onSubmit={submit} noValidate>
        {walkin ? <div className="p-banner info" style={{ marginBottom: 14 }}><span className="grow">Welcome to La Europa Education! Create your account here: a counsellor will see your details right away.</span></div> : null}
        <h2>Create your account</h2>
        <p className="muted" style={{ margin: '0 0 14px' }}>It takes less than a minute. We will email you a code to verify your account.</p>
        <Notice error={error} />
        <div className="form-grid">
          <div className={fieldClass('first_name', 'c3')}><label>First name<span className="req">*</span></label><input maxLength={50} autoComplete="given-name" value={v.first_name} onChange={set('first_name')} />{msg('first_name')}</div>
          <div className="f c3"><label>Last name</label><input maxLength={50} autoComplete="family-name" value={v.last_name} onChange={set('last_name')} /></div>
          <div className={fieldClass('email', 'c6')}><label>Email<span className="req">*</span></label><input type="email" autoComplete="email" value={v.email} onChange={set('email')} /><div className="help">Your verification code and all updates come to this email.</div>{msg('email')}</div>
          <div className={fieldClass('phone', 'c6')}>
            <label>Mobile<span className="req">*</span></label>
            <div className="phone">
              <select value={v.country_code} onChange={set('country_code')}>{CODES.map((c) => <option key={c}>{c}</option>)}</select>
              <input type="tel" inputMode="numeric" autoComplete="tel-national" value={v.phone} onChange={set('phone')} />
            </div>
            <label className="row small" style={{ gap: 6, marginTop: 4 }}><input type="checkbox" checked={v.is_whatsapp} onChange={set('is_whatsapp')} /> This is my WhatsApp number</label>
            {msg('phone')}
          </div>
          <div className={fieldClass('password', 'c6')}>
            <PasswordField id="pw" label="Password *" value={v.password} onChange={(p) => setV((s) => ({ ...s, password: p }))} isNew />
            <div className="help">Min 8 characters, with a letter and a number</div>{msg('password')}
          </div>
          <div className="f c3"><label>Interested country</label><select value={v.country} onChange={set('country')}><option value="">Not sure yet</option>{cfg.countries.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div className="f c3"><label>Preferred intake</label><select value={v.intake} onChange={set('intake')}><option value="">Not sure yet</option>{cfg.intakes.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div className="f c3"><label>Referral code</label><input maxLength={12} value={v.referral_code} onChange={set('referral_code')} /></div>
          <div className="f c3"><label>Promotion code</label><input maxLength={20} placeholder="optional" value={v.promo_code} onChange={set('promo_code')} /></div>
          <div className="f c6">
            <label>Your age<span className="req">*</span></label>
            <div className="seg" role="radiogroup">
              {([['adult', '18 or older'], ['minor', '13 to 17'], ['child', 'Under 13']] as const).map(([val, label]) => (
                <label key={val}><input type="radio" name="age_group" checked={age === val} onChange={() => setAge(val)} /> {label}</label>
              ))}
            </div>
          </div>
          {age === 'minor' ? (
            <div className="c6 guardian-box">
              <div className="small" style={{ marginBottom: 8 }}><b>Parent / guardian consent</b> Data protection laws (GDPR, India DPDP Act, US COPPA) need your parent or lawful guardian to agree. We will email them a confirmation.</div>
              <div className="form-grid">
                <div className={fieldClass('guardian_name', 'c3')}><label>Parent / guardian name<span className="req">*</span></label><input maxLength={100} value={v.guardian_name} onChange={set('guardian_name')} />{msg('guardian_name')}</div>
                <div className="f c3"><label>Relation</label><select value={v.guardian_relation} onChange={set('guardian_relation')}>{['Mother', 'Father', 'Legal guardian'].map((r) => <option key={r}>{r}</option>)}</select></div>
                <div className={fieldClass('guardian_email', 'c6')}><label>Parent / guardian email<span className="req">*</span></label><input type="email" value={v.guardian_email} onChange={set('guardian_email')} />{msg('guardian_email')}</div>
              </div>
              <label className={`consent${errors.guardian_consent ? ' err' : ''}`}><input type="checkbox" checked={v.guardian_consent} onChange={set('guardian_consent')} /> <span>My parent / guardian has read the Terms of Use, Privacy Policy and Student Advisory and agrees to my account and the use of my data.</span></label>
            </div>
          ) : null}
        </div>
        <label className={`consent${errors.consent_terms ? ' err' : ''}`}><input type="checkbox" checked={v.consent_terms} onChange={set('consent_terms')} /> <TermsText /></label>
        <label className={`consent${errors.consent_comm ? ' err' : ''}`}><input type="checkbox" checked={v.consent_comm} onChange={set('consent_comm')} /> <span>I agree to receive service updates about my application by email, phone, SMS and WhatsApp<span className="req">*</span></span></label>
        <label className="consent"><input type="checkbox" checked={v.consent_marketing} onChange={set('consent_marketing')} /> <span>Send me newsletters and event invitations (optional, you can stop any time)</span></label>
        <p className="small muted" style={{ margin: '8px 0 0' }}>After your first login you will be asked to read and accept the Student Advisory &amp; Consent.</p>
        <button className="btn primary block" type="submit" style={{ marginTop: 10 }} disabled={busy || age === 'child'}>{busy ? 'Creating...' : 'Create account'}</button>
        <p style={{ marginTop: 14, textAlign: 'center' }}>Already have an account? <Link href="/login">Log in</Link></p>
      </form>
    </AuthShell>
  );
}

export default function RegisterPage() {
  return <Suspense><Signup /></Suspense>;
}
