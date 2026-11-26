'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import http from '@/lib/api';
import { ApiError, GET, POST, PUT } from './api';
import { ago, fmtDate, fmtDT } from './format';
import { FormGrid, Options, formModal, type Field, type Vals } from './form';
import { Modal, confirmBox, openOverlay, showError, toast } from './ui';
import { local, refreshMe, t, usePMe, type Any } from './p';
import { ComplBar } from './compl';
import { downloadConsent } from './Gate';
import { ShareConsents, saveFile, share, shareCard, showLegal } from './share';

/** The client's account screens (legacy/public/portal/js/account.js): My Profile, Settings, Notifications, Refer a friend, Privacy & my data. */

const errs = (setErr: (e: Record<string, string>) => void) => (e: unknown) => { if (e instanceof ApiError && e.data.errors) setErr(e.data.errors); showError(e); };
const Kv = ({ k, v }: { k: string; v: unknown }) => <div><div className="k">{t(k)}</div><div className="v">{v === null || v === undefined || v === '' ? <span className="muted">-</span> : String(v)}</div></div>;
const Loading = () => <div className="empty-p">{t('Loading...')}</div>;

// ---------- My Profile (SP20) ----------
export function Profile() {
  const [d, setD] = useState<{ P: Any; crs: Any[] } | null>(null);
  const [showPp, setShowPp] = useState(false);
  const load = useCallback(() => Promise.all([GET('/profile'), GET('/profile/change-requests')]).then(([P, crs]) => setD({ P, crs })).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;
  const { P, crs } = d, pe = P.data.personal, pp = P.data.passport;
  return (
    <>
      <div className="p-head"><h1>{t('My Profile')}</h1><span className="grow" /><Link className="btn sm primary" href="/my-information">{P.locks.submitted ? t('View / request changes') : t('Edit profile')}</Link></div>
      <div className="p-card" style={{ marginBottom: 12 }}><div className="bd"><ComplBar c={P.completion} /><div className="summary-line" style={{ marginTop: 12 }}>{P.summary.line}</div><div className="small muted" style={{ marginTop: 6 }}>{t('Total experience')}: {P.summary.experience}</div></div></div>
      <div className="p-grid two"><div className="p-grid">
        <div className="p-card"><div className="hd"><h2>{t('Personal')}</h2><span className="grow" /><Link className="small" href="/my-information?step=1">{t('Open')}</Link></div><div className="bd"><div className="kv">
          <Kv k="Name" v={[pe.first_name, pe.middle_name, pe.last_name].filter(Boolean).join(' ')} /><Kv k="Gender" v={pe.gender} /><Kv k="Date of birth" v={fmtDate(pe.dob)} /><Kv k="Nationality" v={pe.nationality} />
          <Kv k="Mobile" v={P.account.phone} /><Kv k="Email" v={P.account.email} /><Kv k="WhatsApp" v={pe.whatsapp} /><Kv k="Address" v={[pe.address1, pe.address2, pe.city, pe.state, pe.pin].filter(Boolean).join(', ')} />
          <Kv k="Emergency contact" v={[pe.emergency_name, pe.emergency_phone].filter(Boolean).join(', ')} /></div></div></div>
        <div className="p-card"><div className="hd"><h2>{t('Passport')}</h2><span className="grow" /><Link className="small" href="/my-information?step=2">{t('Open')}</Link></div><div className="bd"><div className="kv">
          <div><div className="k">{t('Passport number')}</div><div className="v">{pp.passport ? <><span className="mono">{showPp ? pp.passport : pp.passport_masked || pp.passport}</span> <button className="btn xs" title={t('Show')} onClick={() => setShowPp(!showPp)}>👁</button></> : '-'}</div></div>
          <Kv k="Issue date" v={fmtDate(pp.passport_issue)} /><Kv k="Expiry date" v={fmtDate(pp.passport_expiry)} /><Kv k="Place of issue" v={pp.passport_place} /></div></div></div>
      </div><div className="p-grid">
        <div className="p-card"><div className="hd"><h2>{t('Preferences')}</h2><span className="grow" /><Link className="small" href="/my-information?step=6">{t('Open')}</Link></div><div className="bd"><div className="kv"><Kv k="Course" v={P.data.preferences.course} /><Kv k="Level" v={P.data.preferences.level} /></div></div></div>
        <div className="p-card"><div className="hd"><h2>{t('My change requests')}</h2></div><div className="bd flush">{crs.length ? crs.map((c) => (
          <div key={c.id} className="rowx"><div className="grow"><div className="t">{c.field_label}</div><div className="s">{t('Requested')} {ago(c.created_at)} · {typeof c.new_value === 'object' ? JSON.stringify(c.new_value) : String(c.new_value)}</div>
            {c.reject_reason ? <div className="s days-red">{t('Not approved:')} {c.reject_reason}</div> : null}</div>
            <span className={`badge ${c.status === 'Approved' ? 'green' : c.status === 'Rejected' ? 'red' : c.status === 'Pending' ? 'orange' : 'grey'}`}>{t(c.status)}</span>
            {c.status === 'Pending' ? <button className="btn xs" onClick={async () => { await POST(`/profile/change-requests/${c.id}/cancel`).catch(showError); load(); }}>{t('Cancel')}</button> : null}</div>
        )) : <div className="empty-p">{t('No change requests')}</div>}</div></div>
      </div></div>
    </>
  );
}

// ---------- Settings (SP21) ----------
function OtpModal({ title, masked, close, verify }: { title: string; masked: string; close: () => void; verify: (code: string) => Promise<void> }) {
  const [code, setCode] = useState('');
  return (
    <Modal title={title} size="sm" close={close} foot={<><button className="btn" onClick={close}>{t('Cancel')}</button><button className="btn primary" onClick={async () => { try { await verify(code); close(); } catch (e) { showError(e); } }}>{t('Verify')}</button></>}>
      <p>{t('We sent a 6-digit code to')} <b>{masked}</b>.</p><input className="input otp-input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
    </Modal>
  );
}
async function verifyFlow(what: string, done: () => void) {
  try {
    const r = await POST(`/me/verify/${what}/send`);
    openOverlay((close) => <OtpModal title={what === 'email' ? t('Verify your email') : t('Verify your mobile')} masked={r.masked} close={close} verify={async (code) => { await POST('/me/verify', { otp_id: r.otp_id, code }); toast(t('Verified'), 'ok'); done(); }} />);
  } catch (e) { showError(e); }
}
function ChangeContact({ type, close, done }: { type: 'email' | 'mobile'; close: () => void; done: () => void }) {
  const [v, setV] = useState({ value: '', country_code: '+91', reason: '', code: '' });
  const [otpId, setOtpId] = useState<string | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const go = async () => {
    setErr({});
    try {
      if (!otpId) { const r = await POST('/settings/contact/start', { type, value: v.value, country_code: type === 'mobile' ? v.country_code : undefined }); setOtpId(r.otp_id); return; }
      const r = await POST('/settings/contact/confirm', { otp_id: otpId, code: v.code, reason: type === 'email' ? v.reason : undefined });
      toast(t(r.message), 'ok'); close(); done();
    } catch (e) { errs(setErr)(e); }
  };
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Modal title={type === 'email' ? t('Change email') : t('Change mobile')} size="sm" close={close} foot={<><button className="btn" onClick={close}>{t('Cancel')}</button><button className="btn primary" onClick={go}>{otpId ? t('Confirm') : t('Send code')}</button></>}>
      <form noValidate onSubmit={(e) => { e.preventDefault(); go(); }}>
        {type === 'mobile' ? <div className={`f${err.value ? ' err' : ''}`}><label>{t('New mobile')}</label><div className="phone"><select value={v.country_code} onChange={set('country_code')}><Options list={['+91', '+977', '+880', '+94', '+971', '+1', '+44']} /></select><input type="tel" inputMode="numeric" value={v.value} onChange={set('value')} /></div><div className="msg">{err.value ?? ''}</div></div>
          : <><div className={`f${err.value ? ' err' : ''}`}><label>{t('New email')}</label><input type="email" value={v.value} onChange={set('value')} /><div className="msg">{err.value ?? ''}</div></div><div className="f"><label>{t('Reason (for your counsellor)')}</label><input value={v.reason} onChange={set('reason')} /></div></>}
        {otpId ? <div style={{ marginTop: 10 }}><label className="small">{type === 'email' ? t('6-digit code sent to the new email') : t('6-digit code sent to your registered email')}</label><input className="input otp-input" inputMode="numeric" maxLength={6} value={v.code} onChange={set('code')} /></div> : null}
      </form>
    </Modal>
  );
}
function DeleteRequest({ close, done }: { close: () => void; done: () => void }) {
  const [reason, setReason] = useState(''), [pw, setPw] = useState('');
  return (
    <Modal title={t('Request account deletion')} close={close} foot={<><button className="btn" onClick={close}>{t('Cancel')}</button><button className="btn danger solid" onClick={async () => { try { await POST('/account/delete-request', { reason, password: pw }); close(); await refreshMe(); done(); } catch (e) { showError(e); } }}>{t('Send request')}</button></>}>
      <p className="small">{t('Your request will be reviewed by La Europa. Some records may need to be kept for legal and accounting reasons, and applications already submitted to universities cannot be undone.')}</p>
      <div className="f"><label>{t('Reason (optional)')}</label><textarea className="input" rows={2} style={{ height: 'auto', padding: 8 }} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <div className="f" style={{ marginTop: 8 }}><label>{t('Password')}</label><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
    </Modal>
  );
}
const DETAILS: Field[] = [{ k: 'whatsapp', label: 'WhatsApp number', type: 'tel' }, { k: 'emergency_name', label: 'Emergency contact name' }, { k: 'emergency_phone', label: 'Emergency contact phone', type: 'tel' },
  { k: 'address1', label: 'Address line 1', col: 3 }, { k: 'address2', label: 'Address line 2', col: 3 }, { k: 'city', label: 'City' }, { k: 'pin', label: 'PIN code' }];
const PW: Field[] = [{ k: 'current', label: 'Current password', type: 'password', req: true, col: 6 }, { k: 'password', label: 'New password', type: 'password', req: true, col: 6, help: 'Min 8 characters, with a letter and a number' }, { k: 'confirm', label: 'Confirm new password', type: 'password', req: true, col: 6 }];
const tr = (fs: Field[]) => fs.map((f) => ({ ...f, label: f.label ? t(f.label) : f.label, help: f.help ? t(f.help) : f.help }));
export function Settings() {
  const me = usePMe((s) => s.me);
  const [d, setD] = useState<Any | null>(null);
  const [det, setDet] = useState<Vals>({}), [detErr, setDetErr] = useState<Record<string, string>>({});
  const [pw, setPw] = useState<Vals>({}), [pwErr, setPwErr] = useState<Record<string, string>>({});
  const [np, setNp] = useState<Record<string, boolean>>({});
  const load = useCallback(async () => {
    try {
      const [, prefs, sessions, consents, exports, P] = await Promise.all([refreshMe(), GET('/notification-preferences'), GET('/settings/sessions'), GET('/settings/consents'), GET('/account/data-exports'), GET('/profile')]);
      setD({ prefs, sessions, consents, exports }); setDet({ ...P.data.personal });
      setNp({ ...Object.fromEntries(prefs.groups.map((g: Any) => [g.key, !!g.email])), __marketing: !!prefs.marketing });
    } catch (e) { showError(e); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!d || !me) return <Loading />;
  const saveDet = async () => { setDetErr({}); try { await PUT('/settings/details', Object.fromEntries(DETAILS.map((f) => [f.k, det[f.k] ?? '']))); toast(t('Saved'), 'ok'); } catch (e) { errs(setDetErr)(e); } };
  const savePw = async () => { setPwErr({}); try { await PUT('/settings/password', pw); toast(t('Password changed. Other devices were logged out.'), 'ok'); setPw({}); } catch (e) { errs(setPwErr)(e); } };
  const saveNp = async () => { const email = Object.fromEntries(d.prefs.groups.filter((g: Any) => g.optional).map((g: Any) => [g.key, !!np[g.key]])); try { await PUT('/notification-preferences', { email, marketing: !!np.__marketing }); toast(t('Saved'), 'ok'); } catch (e) { showError(e); } };
  const exportData = async () => { try { const r = await POST('/account/data-export'); toast(t(r.message), 'ok'); setTimeout(load, 3000); } catch (e) { showError(e); } };
  const dl = async (id: string) => {
    const pass = await confirmBox(t('Enter your password to download your data.'), { reason: true, reasonLabel: t('Password'), ok: t('Download'), cancel: t('Cancel') });
    if (!pass) return;
    try { const r = await http.post(`/portal/account/data-export/${id}/download`, { password: pass }, { responseType: 'blob' }); saveFile(new File([r.data as Blob], 'la-europa-my-data.zip')); }
    catch (e) { let m = t('Could not download the file'); try { m = JSON.parse(await ((e as Any).response?.data as Blob).text()).error ?? m; } catch { /* not JSON */ } toast(m, 'err'); }
  };
  const seen = new Set<string>();
  const signed = d.consents.filter((c: Any) => ['master', 'student_consent', 'constitution'].includes(c.consent_type) && c.value === 'yes' && !seen.has(c.consent_type) && seen.add(c.consent_type));
  return (
    <>
      <div className="p-head"><h1>{t('Settings')}</h1></div>
      <div className="p-grid two"><div className="p-grid">
        <div className="p-card"><div className="hd"><h2>{t('Contact details')}</h2></div><div className="bd">
          <div className="rowx" style={{ padding: '8px 0' }}><div className="grow"><div className="t">{t('Email')}</div><div className="s">{me.email || '-'} {me.email_verified ? <span className="badge green">{t('Verified')}</span> : <span className="badge orange">{t('Not verified')}</span>}</div></div>
            {!me.email_verified && me.email ? <button className="btn sm primary" onClick={() => verifyFlow('email', load)}>{t('Verify now')}</button> : null}<button className="btn sm" onClick={() => openOverlay((close) => <ChangeContact type="email" close={close} done={load} />)}>{t('Change')}</button></div>
          <div className="rowx" style={{ padding: '8px 0' }}><div className="grow"><div className="t">{t('Mobile')}</div><div className="s">{me.phone || '-'}</div></div><button className="btn sm" onClick={() => openOverlay((close) => <ChangeContact type="mobile" close={close} done={load} />)}>{t('Change')}</button></div>
          <p className="small muted">{t('Email changes are applied after your counsellor approves them, because all updates go to this address.')}</p>
          <form noValidate onSubmit={(e) => e.preventDefault()}><FormGrid fields={tr(DETAILS)} vals={det} set={(k, x) => setDet((o) => ({ ...o, [k]: x }))} errors={detErr} />
            <div className="form-actions"><button type="button" className="btn primary" onClick={saveDet}>{t('Save details')}</button></div></form>
        </div></div>
        <div className="p-card"><div className="hd"><h2>{t('Change password')}</h2></div><div className="bd"><form noValidate onSubmit={(e) => e.preventDefault()}>
          <FormGrid fields={tr(PW)} vals={pw} set={(k, x) => setPw((o) => ({ ...o, [k]: x }))} errors={pwErr} />
          <div className="form-actions"><button type="button" className="btn primary" onClick={savePw}>{t('Change password')}</button></div></form></div></div>
        <div className="p-card"><div className="hd"><h2>{t('Active devices')}</h2><span className="grow" /><button className="btn sm" onClick={async () => { await POST('/settings/sessions/logout-others').catch(showError); toast(t('Logged out of other devices'), 'ok'); load(); }}>{t('Log out of all other devices')}</button></div>
          <div className="bd flush">{d.sessions.map((s: Any, i: number) => <div key={s.id ?? i} className="rowx"><div className="grow"><div className="t">{t(s.device)} · {s.browser || ''} {s.current ? <span className="badge green">{t('This device')}</span> : null}</div><div className="s">{t('Last active')} {ago(s.last_seen_at)} · {s.ip || ''}</div></div></div>)}</div></div>
      </div><div className="p-grid">
        <div className="p-card"><div className="hd"><h2>{t('Notifications')}</h2></div><div className="bd">
          {d.prefs.groups.map((g: Any) => <label key={g.key} className="row" style={{ padding: '6px 0', gap: 8 }}><input type="checkbox" checked={!!np[g.key]} disabled={!g.optional} onChange={(e) => setNp({ ...np, [g.key]: e.target.checked })} /><span className="grow">{t(g.label)}</span>{g.optional ? null : <span className="small muted">🔒 {t('Required for your application')}</span>}</label>)}
          <label className="row" style={{ padding: '6px 0', gap: 8, borderTop: '1px solid var(--line)', marginTop: 6 }}><input type="checkbox" checked={!!np.__marketing} onChange={(e) => setNp({ ...np, __marketing: e.target.checked })} /><span className="grow">{t('Newsletters and events (marketing)')}</span></label>
          <div className="small muted">{t('In-app notifications are always on. WhatsApp updates: coming soon.')}</div><div className="form-actions"><button type="button" className="btn primary" onClick={saveNp}>{t('Save')}</button></div></div></div>
        <div className="p-card"><div className="hd"><h2>{t('Language')}</h2></div><div className="bd"><select className="input" disabled><option>English</option></select><div className="small muted" style={{ marginTop: 6 }}>{t('Hindi and Gujarati coming soon')}</div></div></div>
        <div className="p-card"><div className="hd"><h2>{t('Privacy & my data')}</h2><span className="grow" /><Link className="btn sm primary" href="/privacy">{t('Open')}</Link></div><div className="bd small">
          <p style={{ marginTop: 0 }}>{t('See what you accepted and when, read the exact documents, and use your privacy rights (access, correction, deletion, withdraw consent, complaint).')}</p>
          <p><button className="btn sm primary" onClick={downloadConsent}>⬇ {t('Download my signed consent (PDF)')}</button></p>
          {signed.map((c: Any) => <div key={c.consent_type}>{t(c.title)} v{c.document_version || ''}: <b>{t('accepted')}</b> · {fmtDT(c.created_at)}</div>)}</div></div>
        <div className="p-card"><div className="hd"><h2>{t('My data')}</h2></div><div className="bd"><p className="small">{t('Download a copy of your profile, applications, payments, tasks, chat and documents. Internal La Europa notes are not included.')}</p>
          <button className="btn" onClick={exportData}>{t('Download my data')}</button>
          {d.exports.map((x: Any) => <div key={x.id} className="rowx" style={{ padding: '6px 0' }}><span className="grow small">{fmtDT(x.created_at)}: {t(x.status)}</span>{x.status === 'Ready' ? <button className="btn xs primary" onClick={() => dl(x.id)}>{t('Download')}</button> : null}</div>)}</div></div>
        <div className="p-card"><div className="hd"><h2>{t('Delete my account')}</h2></div><div className="bd">{me.pending_deletion
          ? <div className="p-banner warn"><span className="grow">{t('Your request is being reviewed by La Europa.')}</span><button className="btn sm" onClick={async () => { await POST('/account/delete-request/cancel').catch(showError); await refreshMe(); load(); }}>{t('Cancel request')}</button></div>
          : <><p className="small">{t('Your request will be reviewed by La Europa. Some records may need to be kept for legal and accounting reasons, and applications already submitted to universities cannot be undone.')}</p>
            <button className="btn danger" onClick={() => openOverlay((close) => <DeleteRequest close={close} done={load} />)}>{t('Request account deletion')}</button></>}</div></div>
      </div></div>
    </>
  );
}

// ---------- Notifications (SP23) ----------
export function Notifications() {
  const [rows, setRows] = useState<Any[] | null>(null);
  const load = useCallback(() => GET('/notifications?all=1').then((d) => setRows(d.rows)).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <div className="p-head"><h1>{t('Notifications')}</h1><span className="grow" /><button className="btn sm" onClick={async () => { await POST('/notifications/read', { all: true }).catch(showError); load(); }}>{t('Mark all read')}</button></div>
      <div className="p-card"><div className="bd flush">{!rows ? <Loading /> : rows.length ? rows.map((n) => (
        <Link key={n.id} className={`notif ${n.is_read ? '' : 'unread'}`} href={local(n.link)} onClick={() => { POST('/notifications/read', { ids: [n.id] }).catch(() => {}); }}>{n.title}<div className="when">{fmtDT(n.created_at)}</div></Link>
      )) : <div className="empty-p">{t('No notifications yet')}</div>}</div></div>
    </>
  );
}

// ---------- Refer a friend (SP22) ----------
const REF: Field[] = [{ k: 'first_name', label: "Friend's first name", req: true, maxlength: 50 }, { k: 'last_name', label: 'Last name' }, { k: 'phone', label: "Friend's mobile", type: 'phone', req: true },
  { k: 'email', label: "Friend's email", type: 'email' }, { k: 'interest', label: 'Interested country / course', col: 4 }];
export function Referral() {
  const [d, setD] = useState<Any | null>(null);
  const [v, setV] = useState<Vals>({ country_code: '+91' }), [consent, setConsent] = useState(false), [err, setErr] = useState<Record<string, string>>({});
  const load = useCallback(() => GET('/referrals').then(setD).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;
  if (!d.enabled) return <div className="empty-p">{t('Referrals are not available right now.')}</div>;
  const send = async () => { setErr({}); try { const r = await POST('/referrals', { ...v, consent }); toast(t(r.message), 'ok'); setV({ country_code: '+91' }); setConsent(false); load(); } catch (e) { errs(setErr)(e); } };
  const card = async (ext: string) => {
    try { const b = ext === 'png' ? await shareCard() : new File([await (await import('./api')).blob('/referrals/card.pdf')], ''); saveFile(new File([b], `La-Europa-referral-${d.code}.${ext}`)); } catch (e) { showError(e); }
  };
  return (
    <>
      <div className="p-head"><h1>{t('Refer a friend')}</h1></div>
      <div className="p-grid two">
        <div className="p-card"><div className="hd"><h2>{t('Tell us about your friend')}</h2></div><div className="bd"><form noValidate onSubmit={(e) => e.preventDefault()}>
          <FormGrid fields={tr(REF)} vals={v} set={(k, x) => setV((o) => ({ ...o, [k]: x }))} errors={err} />
          <label className={`consent${err.consent ? ' err' : ''}`}><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> <span>{t('My friend agrees to be contacted by La Europa')}</span></label>
          <button type="button" className="btn primary block" onClick={send}>{t('Send referral')}</button></form></div></div>
        <div className="p-grid">
          <div className="p-card"><div className="hd"><h2>{t('My referral code')}</h2></div><div className="bd" style={{ textAlign: 'center' }}>
            <div className="ref-code mono">{d.code}</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={d.qr} alt={t('QR code of my referral link')} style={{ width: 180, height: 180, margin: '10px auto', display: 'block', border: '1px solid var(--line)', borderRadius: 16, padding: 8, background: '#fff' }} />
            <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}><button className="btn primary sm" onClick={() => share(d.link, `${t('Study abroad with La Europa Education. Sign up with my referral code')} ${d.code}`)}>{t('Share')}</button>
              <button className="btn sm" onClick={() => card('png')}>{t('Download card')}</button><button className="btn sm" onClick={() => card('pdf')}>{t('Print (A4)')}</button></div>
            <div className="row" style={{ marginTop: 12 }}><input className="input grow" readOnly value={d.link} onFocus={(e) => e.target.select()} /><button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(d.link); toast(t('Copied'), 'ok'); } catch { /* clipboard blocked */ } }}>{t('Copy')}</button></div>
            <p className="small muted" style={{ margin: '8px 0 0' }}>{t('Your friend signs up with this link or code. See the Offers page for rewards.')} <Link href="/offers">{t('Offers')}</Link></p></div></div>
          <div className="p-card"><div className="hd"><h2>{t('My referrals')}</h2></div><div className="bd flush">{d.rows.length ? d.rows.map((x: Any, i: number) => (
            <div key={i} className="rowx"><span className="grow t">{x.name}{x.promo_code ? <> <span className="small muted mono">{x.promo_code}</span></> : null}</span><span className="small muted">{fmtDate(x.created_at)}</span>
              <span className={`badge ${x.status === 'Enrolled' ? 'purple' : x.status === 'Registered' ? 'green' : 'blue'}`}>{t(x.status)}</span>{x.reward_given ? <span className="badge green">🎁 {t('Reward given')}</span> : null}</div>
          )) : <div className="empty-p">{t('No referrals yet')}</div>}</div></div>
        </div>
      </div>
    </>
  );
}

// ---------- Privacy & my data (GDPR, India DPDP Act, US CCPA/CPRA) ----------
const PR_STATUS: Record<string, string> = { Open: 'orange', 'In progress': 'blue', Completed: 'green', Rejected: 'red', Withdrawn: 'grey' };
const RIGHTS: [string, string, string][] = [
  ['access', 'See and download my data', 'Get a copy of everything La Europa holds about you.'],
  ['correction', 'Correct my data', 'Something is wrong or out of date.'],
  ['erasure', 'Delete my data', 'Ask us to delete your account and data (some records must be kept by law).'],
  ['withdraw_consent', 'Withdraw a consent', 'Stop marketing, or withdraw consent for other processing.'],
  ['restriction', 'Restrict use of my data', 'Pause the use of your data while a problem is checked.'],
  ['objection', 'Object to processing', 'Object to a use of your data based on our legitimate interests.'],
  ['portability', 'Move my data', 'Get your data in a machine-readable format for another service.'],
  ['opt_out_sale', 'Do not sell or share my data (US)', 'La Europa never sells data. Record your opt-out anyway.'],
  ['limit_sensitive', 'Limit use of sensitive data (US)', 'Use passport and financial data only for the service.'],
  ['grievance', 'Raise a grievance / complaint', 'Not happy with how your data was handled? Tell our Grievance Officer.']];
function RightRequest({ type, label, close, done }: { type: string; label: string; close: () => void; done: () => void }) {
  const needsConsent = type === 'withdraw_consent' || type === 'objection';
  const [v, setV] = useState({ consent_type: 'marketing', details: '' }), [err, setErr] = useState<Record<string, string>>({});
  const go = async () => {
    setErr({});
    const body: Any = { type, details: v.details }; if (needsConsent && v.consent_type !== 'other') body.consent_type = v.consent_type;
    try { const r = await POST('/privacy/requests', body); close(); toast(t(r.message), 'ok'); done(); } catch (e) { errs(setErr)(e); }
  };
  return (
    <Modal title={t(label)} size="sm" close={close} foot={<><button className="btn" onClick={close}>{t('Cancel')}</button><button className="btn primary" onClick={go}>{t('Send')}</button></>}>
      {needsConsent ? <div className="f"><label>{t('Which one?')}</label><select className="input" value={v.consent_type} onChange={(e) => setV({ ...v, consent_type: e.target.value })}>
        <Options list={[['marketing', t('Newsletters and offers (stops now)')], ['communication', t('Service messages about my application')], ['other', t('Something else (explain below)')]]} /></select></div> : null}
      <div className={`f${err.details ? ' err' : ''}`}><label>{t('Details')}{['correction', 'objection', 'restriction', 'grievance'].includes(type) ? <span className="req">*</span> : null}</label>
        <textarea className="input" rows={4} style={{ height: 'auto', padding: 8 }} value={v.details} onChange={(e) => setV({ ...v, details: e.target.value })} /><div className="msg">{err.details ?? ''}</div></div>
      {type === 'withdraw_consent' ? <p className="small muted">{t('Withdrawing consent for service messages may mean La Europa cannot continue your applications. Your counsellor will explain the options.')}</p> : null}
    </Modal>
  );
}
export function Privacy() {
  const router = useRouter();
  const [d, setD] = useState<{ p: Any; consents: Any[] } | null>(null);
  const load = useCallback(() => Promise.all([GET('/privacy'), GET('/settings/consents')]).then(([p, consents]) => setD({ p, consents })).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;
  const { p, consents } = d, c = p.contacts;
  const right = async (type: string, label: string) => {
    if (type === 'access' || type === 'portability') {
      if (await confirmBox(t('You can download a full copy of your data straight away in Settings > My data. Do you also want to send a formal request to La Europa?'), { ok: t('Send request'), cancel: t('Go to Settings') })) {
        try { const r = await POST('/privacy/requests', { type, details: '' }); toast(t(r.message), 'ok'); load(); } catch (e) { showError(e); }
      } else router.push('/settings');
      return;
    }
    if (type === 'erasure') { if (await confirmBox(t('Deleting your account is done from Settings > Delete my account, so La Europa can check what must be kept by law. Go there now?'), { ok: t('Go to Settings'), cancel: t('Cancel') })) router.push('/settings'); return; }
    openOverlay((close) => <RightRequest type={type} label={label} close={close} done={load} />);
  };
  const readDoc = async (id: string) => {
    try { const x = await GET('/settings/consents/document/' + id); openOverlay((close) => <Modal title={`${x.title} (v${x.version})`} size="lg" close={close}><p className="small muted">{t('This is the exact text you accepted.')} SHA-256 {String(x.hash).slice(0, 16)}…</p><div className="legal-text">{x.text}</div></Modal>); } catch (e) { showError(e); }
  };
  const nominee = async () => {
    if (await formModal({ title: t('Nominee'), size: 'sm', values: p.nomination || {}, save: (v) => PUT('/privacy/nomination', v),
      fields: [{ k: 'nominee_name', label: t('Full name'), req: true, col: 6 }, { k: 'relation', label: t('Relation'), col: 6 }, { k: 'nominee_email', label: t('Email'), type: 'email', req: true, col: 6 }, { k: 'nominee_phone', label: t('Phone'), type: 'tel', col: 6 }] })) { toast(t('Saved'), 'ok'); load(); }
  };
  return (
    <>
      <div className="p-head"><h1>{t('Privacy & my data')}</h1><span className="grow" /><button className="btn primary" onClick={downloadConsent}>⬇ {t('Download my signed consent (PDF)')}</button></div>
      <ShareConsents all onChange={load} />
      <div className="p-banner info" style={{ marginBottom: 12 }}><span className="grow">{t('La Europa applies the same high privacy standard to every student, wherever you live: EU / UK GDPR, India DPDP Act 2023, US state privacy laws (CCPA / CPRA) and similar laws. We never sell your data.')}</span></div>
      <div className="p-grid two"><div className="p-grid">
        <div className="p-card"><div className="hd"><h2>{t('Your rights')}</h2></div><div className="bd flush">{RIGHTS.map(([k, l, s]) => (
          <button key={k} className="rowx right-btn" onClick={() => right(k, l)}><div className="grow" style={{ textAlign: 'left' }}><div className="t">{t(l)}</div><div className="s">{t(s)}</div></div><span className="muted">›</span></button>))}</div></div>
        <div className="p-card"><div className="hd"><h2>{t('My requests')}</h2></div><div className="bd flush">{p.requests.length ? p.requests.map((x: Any) => (
          <div key={x.id} className="rowx"><div className="grow"><div className="t">{t(x.label)} <span className={`badge ${PR_STATUS[x.status] || 'grey'}`}>{t(x.status)}</span></div>
            <div className="s">{x.code} · {t('sent')} {fmtDate(x.created_at)}{['Open', 'In progress'].includes(x.status) ? ` · ${t('reply by')} ${fmtDate(x.due_at)}` : ''}</div>{x.response ? <div className="small" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{x.response}</div> : null}</div>
            {x.status === 'Open' ? <button className="btn xs" onClick={async () => { await POST(`/privacy/requests/${x.id}/cancel`).catch(showError); load(); }}>{t('Withdraw')}</button> : null}</div>
        )) : <div className="empty-p">{t('No requests yet')}</div>}</div></div>
      </div><div className="p-grid">
        <div className="p-card"><div className="hd"><h2>{t('What I agreed to')}</h2></div><div className="bd flush">{consents.length ? consents.map((x, i) => (
          <div key={i} className="rowx"><div className="grow"><div className="t">{t(x.title)}{x.document_version ? <> <span className="muted small">v{x.document_version}</span></> : null} {x.value === 'yes' ? <span className="badge green">{t('Accepted')}</span> : <span className="badge red">{t('Declined / withdrawn')}</span>}</div>
            <div className="s">{fmtDT(x.created_at)}{x.scrolled_to_end ? ' · ' + t('read in full') : ''}</div></div>{x.document_id ? <button className="btn xs" onClick={() => readDoc(x.document_id)}>{t('Read')}</button> : null}</div>
        )) : <div className="empty-p">-</div>}</div></div>
        {p.shared_with ? <div className="p-card"><div className="hd"><h2>{t('Who my data was shared with')}</h2></div><div className="bd small">
          <p className="muted" style={{ marginTop: 0 }}>{t('Under the DPDP Act you can know who received your data. We share only what each step needs.')}</p>
          {p.shared_with.universities.length ? <><b>{t('Universities')}</b><ul style={{ margin: '4px 0 10px', paddingLeft: 18 }}>{p.shared_with.universities.map((u: Any, i: number) => <li key={i}>{u.name}{u.country ? ` (${u.country})` : ''}: {t(u.what)}</li>)}</ul></> : <div style={{ marginBottom: 8 }}>{t('No university yet.')}</div>}
          {p.shared_with.processors.length ? <><b>{t('Service providers working for La Europa')}</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{p.shared_with.processors.map((x: Any, i: number) => <li key={i}>{x.name}{x.what ? `: ${x.what}` : ''}{x.location ? ` (${x.location})` : ''}</li>)}</ul></> : null}
        </div></div> : null}
        <div className="p-card"><div className="hd"><h2>{t('Nominee (India DPDP Act)')}</h2></div><div className="bd"><p className="small" style={{ marginTop: 0 }}>{t('Name a person who can use your data rights if you die or cannot act yourself.')}</p>
          {p.nomination ? <div className="rowx" style={{ padding: '0 0 8px' }}><div className="grow"><div className="t">{p.nomination.nominee_name} {p.nomination.relation ? `(${p.nomination.relation})` : ''}</div><div className="s">{p.nomination.nominee_email}</div></div>
            <button className="btn xs" onClick={async () => { await PUT('/privacy/nomination', { revoke: true }).catch(showError); load(); }}>{t('Remove')}</button></div> : null}
          <button className="btn sm" onClick={nominee}>{p.nomination ? t('Change nominee') : t('Add a nominee')}</button></div></div>
        <div className="p-card"><div className="hd"><h2>{t('Contact')}</h2></div><div className="bd small">
          {c.privacy_email ? <div>{t('Privacy questions')}: <a href={`mailto:${c.privacy_email}`}>{c.privacy_email}</a></div> : null}
          <div>{t('Grievance Officer')}: {c.grievance_officer || t('see Privacy Policy')}{c.grievance_email ? <>, <a href={`mailto:${c.grievance_email}`}>{c.grievance_email}</a></> : null}{c.grievance_phone ? `, ${c.grievance_phone}` : ''}</div>
          {c.dpo ? <div>{t('Data Protection Officer')}: {c.dpo}</div> : null}
          <div>{t('We reply to a grievance within {n} working days (never more than 90 days).', { n: p.reply_days || 15 })}</div>
          <p className="muted">{t('You can also complain to your data protection authority (for example your EU authority, the UK ICO, or the Data Protection Board of India).')}</p>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{p.documents.map((x: Any) => <button key={x.type} className="btn xs" onClick={() => showLegal(x.type)}>{t(x.title)}</button>)}</div>
        </div></div>
      </div></div>
    </>
  );
}
