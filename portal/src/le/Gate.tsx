'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { GET, POST, download } from './api';
import { confirmBox, showError, toast } from './ui';
import { logout, refreshMe, t, type Any } from './p';

/** The client's consent gate (legacy/public/portal/js/main.js consentPopup, gateStep, signStep). Full screen, cannot be closed. */

const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } };
export const downloadConsent = () => download('/consent/certificate.pdf', 'La-Europa-Signed-Consent.pdf').catch(showError);
const Logo = () => <div className="logo">{/* eslint-disable-next-line @next/next/no-img-element */}<img className="mark" src="/brand/vernyr-icon.svg" alt="" width={34} height={34} />La Europa <b>Education</b></div>;

/** tracks how far a scrolling element was read: [percent, reached the end] */
function useRead(ref: React.RefObject<HTMLDivElement | null>, slack: number) {
  const [pct, setPct] = useState(0), [end, setEnd] = useState(false);
  useEffect(() => {
    const doc = ref.current; if (!doc) return;
    const on = () => {
      const max = doc.scrollHeight - doc.clientHeight, p = max <= 4 ? 100 : Math.min(100, Math.round(doc.scrollTop / max * 100));
      setPct((o) => Math.max(o, p)); if (max <= 4 || doc.scrollTop >= max - slack) setEnd(true);
    };
    doc.addEventListener('scroll', on, { passive: true }); const tm = setTimeout(on, 60); doc.focus();
    return () => { doc.removeEventListener('scroll', on); clearTimeout(tm); };
  }, [ref, slack]);
  return [pct, end] as const;
}
async function decline(type: string, msg: string) {
  if (!(await confirmBox(t(msg), { ok: t('Continue'), danger: true }))) return false;
  try { const r = await POST('/consent/decline', { type }); toast(t(r.message), 'ok'); } catch (e) { showError(e); }
  logout(); return true;
}

function GateStep({ st, type, n, total, done }: { st: Any; type: string; n: number; total: number; done: () => void }) {
  const d = st.docs[type];
  const main = ['advisory', 'master'].includes(type), all1 = type === 'master', first = main && st.first_time;
  const heading = all1 ? (first ? t('Welcome! One time only: please read and sign the Student Agreement & Consent') : t('The Student Agreement & Consent was updated: please read and sign it again'))
    : type === 'advisory' ? (first ? t('Welcome! Before you start, please read the Student Advisory & Consent') : t('The Student Advisory & Consent was updated')) : t('Please read and accept the updated') + ' ' + t(d.title);
  const ref = useRef<HTMLDivElement>(null);
  const [pct, end] = useRead(ref, 8);
  const [ok, setOk] = useState(false), [x1, setX1] = useState(false), [x2, setX2] = useState(false), [gd, setGd] = useState(false), [sig, setSig] = useState(''), [busy, setBusy] = useState(false);
  const t0 = useRef(Date.now());
  const can = end && ok && (!all1 || (x1 && x2)) && (!main || sig.trim().length >= 3) && (!(main && st.is_minor) || gd) && !busy;
  const accept = async () => {
    setBusy(true);
    try {
      await POST('/consent/accept', { type, document_id: d.id, scrolled_to_end: true, scroll_percent: pct, confirm: true, guardian_confirm: main && st.is_minor ? gd : undefined, signature_name: main ? sig.trim() : undefined,
        time_spent_sec: Math.round((Date.now() - t0.current) / 1000), screen: `${window.innerWidth}x${window.innerHeight}`, client: { timezone: tz(), locale: navigator.language } });
      toast(t('Thank you. Your acceptance has been recorded.'), 'ok'); done();
    } catch (e) { showError(e); setBusy(false); if ((e as Any).data?.code === 'stale') done(); }
  };
  const box = (on: boolean, set: (v: boolean) => void, label: React.ReactNode, id?: string) => <label className={`consent${end ? '' : ' disabled'}`}><input type="checkbox" id={id} disabled={!end} checked={on} onChange={(e) => set(e.target.checked)} /> <span>{label}</span></label>;
  return (
    <div className="gate-card" role="dialog" aria-modal="true" aria-labelledby="gt">
      <div className="gate-hd"><Logo /><span className="grow" /><span className="small">{t('Step')} {n} / {total}</span></div>
      <div className="gate-title"><h2 id="gt">{heading}</h2><div className="small muted">{t(d.title)} · {t('Version')} {d.version} · {t('Published')} {String(d.published_at || '').slice(0, 10)}</div>
        <div className="gate-prog"><i style={{ width: pct + '%' }} /></div><div className="small muted">{end ? t('Thank you for reading. Please confirm below.') : <>{t('Scroll to the end of the document to continue.')} <span>{pct}%</span></>}</div></div>
      <div className="gate-doc" tabIndex={0} ref={ref}><div className="legal-text">{d.text}</div><div className="gate-end">{t('End of document')}</div></div>
      <div className="gate-ft">
        {all1 ? <p className="small muted" style={{ margin: '0 0 6px' }}>{t('This one consent covers your whole journey: Terms of Use, Privacy Policy, Student Advisory, refund policy, sharing with universities and your visa process. You will not be asked again. You can download the signed copy any time in Account.')}</p> : null}
        {box(ok, setOk, all1 ? t('I have read and understood the Student Agreement & Consent (Parts A to I) and I agree to all of it.') : type === 'advisory' ? t('I have read and understood the Student Advisory & Consent and I agree to it.') : t('I have read and agree to the') + ' ' + t(d.title) + '.')}
        {all1 ? <>{box(x1, setX1, t('I accept the fees and refund policy (Part B).'))}{box(x2, setX2, t('I allow La Europa to share my file with the universities I apply to and with the embassy / visa centre for my visa (Parts C and D).'))}</> : null}
        {main && st.is_minor ? box(gd, setGd, <>{t('My parent / guardian')}{st.guardian ? ` (${st.guardian})` : ''} {t('has read this advisory with me and agrees to it.')}</>) : null}
        {main ? <div className="f" style={{ margin: '8px 0 0' }}><label htmlFor="g-sig" className="small">{t('Type your full name as your electronic signature')}</label><input id="g-sig" className="input" maxLength={100} autoComplete="name" disabled={!end} value={sig} onChange={(e) => setSig(e.target.value)} /></div> : null}
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}><button className="btn" onClick={logout}>{t('Logout')}</button>
          <button className="btn ghost" onClick={() => decline(type, 'Without accepting, you cannot use the student portal. Your counsellor will be told and will contact you. Continue?')}>{t('I do not agree')}</button><span className="grow" />
          <button className="btn primary" disabled={!can} onClick={accept}>{all1 ? t('I accept and sign') : t('I accept')}</button></div>
      </div>
    </div>
  );
}

function SignStep({ st, done }: { st: Any; done: () => void }) {
  const d = st.docs.student_consent, k = d.constitution, minor = !!st.is_minor, gi = st.guardian_info || {};
  const ref = useRef<HTMLDivElement>(null), conRef = useRef<HTMLDivElement>(null);
  const [pct, end] = useRead(ref, 40);
  const [con, setCon] = useState(false), [conOpened, setConOpened] = useState(false);
  const [opt, setOpt] = useState({ D: false, E: false });
  const [name, setName] = useState(''), [code, setCode] = useState(''), [gName, setGName] = useState(gi.name || ''), [gRel, setGRel] = useState(gi.relation || ''), [gEmail, setGEmail] = useState(gi.email || ''), [gAdult, setGAdult] = useState(false), [gCode, setGCode] = useState('');
  const [otp, setOtp] = useState<{ student: string | null; guardian: string | null }>({ student: null, guardian: null });
  const [sent, setSent] = useState<Record<string, string>>({}), [wait, setWait] = useState<Record<string, boolean>>({});
  const [signing, setSigning] = useState(false), [res, setRes] = useState<Any | null>(null);
  const t0 = useRef(Date.now());
  const why = (() => {
    if (!end) return t('Read to the end');
    const nm = name.trim(); if (nm.length < 3 || !/\s/.test(nm)) return t('Type your full name');
    if (!otp.student) return t('Send the code to your email');
    if (!/^\d{6}$/.test(code.trim())) return t('Enter the 6-digit code');
    if (minor) {
      if (gName.trim().length < 3 || !gRel) return t('Add the guardian\'s name and relation');
      if (!gAdult) return t('The guardian must confirm that they are 18 or older');
      if (!otp.guardian) return t('Send the code to the guardian');
      if (!/^\d{6}$/.test(gCode.trim())) return t('Enter the guardian\'s code');
    }
    return '';
  })();
  const send = async (who: 'student' | 'guardian') => {
    setWait((w) => ({ ...w, [who]: true }));
    try {
      const r = await POST('/consent/sign/code', { who, guardian_email: who === 'guardian' ? gEmail.trim() : undefined });
      setOtp((o) => ({ ...o, [who]: r.otp_id })); if (who === 'student') setCode(''); else setGCode('');
      setSent((s) => ({ ...s, [who]: `${t('Code sent to')} ${r.masked}. ${t('Valid for 10 minutes.')}` }));
      setTimeout(() => setWait((w) => ({ ...w, [who]: false })), 30000);
    } catch (e) { showError(e); setWait((w) => ({ ...w, [who]: false })); }
  };
  const sign = async () => {
    setSigning(true);
    try {
      setRes(await POST('/consent/sign', { document_hash: d.hash, consents: opt, typed_name: name.trim(), otp_id: otp.student, code: code.trim(),
        guardian: minor ? { name: gName.trim(), relation: gRel, adult: gAdult, otp_id: otp.guardian, code: gCode.trim() } : undefined,
        scrolled_to_end: end, scroll_percent: pct, constitution_opened: conOpened, time_spent_sec: Math.round((Date.now() - t0.current) / 1000), client: { timezone: tz(), locale: navigator.language } }));
    } catch (e) { showError(e); setSigning(false); if ((e as Any).data?.code === 'stale') done(); }
  };
  const openCon = (e?: React.MouseEvent) => { e?.preventDefault(); setConOpened(true); setCon(true); setTimeout(() => conRef.current?.focus(), 0); };
  if (res) return (
    <div className="gate-card sign-card"><div className="gate-hd"><Logo /></div>
      <div className="sign-done"><div className="tick">✓</div><h2>{t('Signed and locked')}</h2><p>{t('Thank you. Your Student Declaration & Consent is signed. The PDF was made once and is locked: it cannot be changed.')}</p>
        <p className="small muted">{t('Document ID')}: <b>{res.doc_code}</b> · {res.pages} {t('pages')}</p><p className="small muted">{t('A copy was sent to your email. You can download it any time in Account.')}</p>
        <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}><button className="btn" onClick={downloadConsent}>⬇ {t('Download signed PDF')}</button><button className="btn primary" onClick={done}>{t('Continue')}</button></div></div>
    </div>
  );
  return (
    <div className="gate-card sign-card" role="dialog" aria-modal="true" aria-labelledby="gt">
      <div className="gate-hd"><Logo /><span className="grow" /><span className="small">{t('One time only')}</span></div>
      <div className="gate-title"><h2 id="gt">{st.first_time ? t('Welcome! Please read and sign your Student Declaration & Consent') : t('A new version was published: please read and sign it again')}</h2>
        <div className="small muted">{t(d.title)} v{d.version} · {t('signed under the')} <a href="#" onClick={openCon}>{t('Terms & Conditions')} v{k.version}</a></div>
        <div className="gate-prog"><i style={{ width: pct + '%' }} /></div><div className="small muted">{end ? t('Thank you for reading. Type your full name and enter the code from your email.') : <>{t('Read to the end. The signature is at the bottom.')} <span>{pct}%</span></>}</div></div>
      <div className="gate-doc" tabIndex={0} ref={ref} hidden={con}>
        <div className="legal-md" dangerouslySetInnerHTML={{ __html: d.html }} />
        <div className="p-banner info" style={{ margin: '6px 0 14px' }}><span className="grow">{t('The full Student Terms & Conditions (Student Constitution, with Schedules 1 to 8) are part of what you sign.')}</span><button className="btn sm" onClick={openCon}>{t('Read the Terms & Conditions')}</button>
          <a className="btn sm ghost" href="/legal/student-constitution" target="_blank" rel="noopener noreferrer">{t('Open in a new tab')}</a></div>
        <section className="sign-box" aria-labelledby="sg">
          <h3 id="sg">{t('Signature')}</h3>
          <p className="small">{t('By typing my full name below and confirming the one-time password (OTP) sent to my email address, I sign this Student Declaration & Consent electronically.')}</p>
          <div className="opt-box"><div className="small"><b>{t('Optional, separate from this Declaration')}</b> · {t('You can change these any time in Privacy & my data. Saying no does not affect our services.')}</div>
            <label className="consent"><input type="checkbox" checked={opt.D} onChange={(e) => setOpt({ ...opt, D: e.target.checked })} /> <span>{t('News and offers: I would like to receive information about courses, countries and events from La Europa Education.')}</span></label>
            <label className="consent"><input type="checkbox" checked={opt.E} onChange={(e) => setOpt({ ...opt, E: e.target.checked })} /> <span>{t('Success stories: La Europa Education may use my name, photo and result in its promotion (Clause 9.12).')}</span></label></div>
          <div className="f"><label htmlFor="s-name">{t('Your full name')}</label><input id="s-name" className="input" maxLength={100} autoComplete="name" placeholder={t('First name and last name')} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="otp-row"><button className="btn" disabled={!!wait.student} onClick={() => send('student')}>{otp.student ? t('Send a new code') : `${t('Send code to my email')}${st.email_masked ? ` (${st.email_masked})` : ''}`}</button>
            <input className="input otp-in" inputMode="numeric" maxLength={6} autoComplete="one-time-code" placeholder={t('6-digit code')} disabled={!otp.student} value={code} onChange={(e) => setCode(e.target.value)} /><span className="small muted">{sent.student ?? ''}</span></div>
          {minor ? <div className="guardian-box" style={{ marginTop: 12 }}><b>{t('Parent or guardian (the student is under 18)')}</b>
            <p className="small" style={{ margin: '4px 0 8px' }}>{t('I am the parent or lawful guardian of the student. I have read this document with the student and I agree to it on the student\'s behalf. (Schedule 8)')}</p>
            <div className="sign-grid">
              <div className="f"><label htmlFor="g-name">{t('Parent or guardian\'s full name')}</label><input id="g-name" className="input" maxLength={100} value={gName} onChange={(e) => setGName(e.target.value)} /></div>
              <div className="f"><label htmlFor="g-rel">{t('Relation')}</label><select id="g-rel" className="input" value={gRel} onChange={(e) => setGRel(e.target.value)}>{['', 'Mother', 'Father', 'Legal guardian', 'Other'].map((x) => <option key={x} value={x}>{x ? t(x) : t('Choose')}</option>)}</select></div>
              <div className="f"><label htmlFor="g-email">{t('Guardian\'s own email')}</label><input id="g-email" className="input" type="email" maxLength={120} value={gEmail} onChange={(e) => setGEmail(e.target.value)} /></div>
            </div>
            <label className="consent" style={{ margin: '6px 0' }}><input type="checkbox" checked={gAdult} onChange={(e) => setGAdult(e.target.checked)} /> <span>{t('I, the parent or guardian, confirm that I am 18 years of age or older.')}</span></label>
            <div className="otp-row"><button className="btn" disabled={!!wait.guardian} onClick={() => send('guardian')}>{otp.guardian ? t('Send a new code') : t('Send code to the guardian\'s email')}</button>
              <input className="input otp-in" inputMode="numeric" maxLength={6} placeholder={t('6-digit code')} disabled={!otp.guardian} value={gCode} onChange={(e) => setGCode(e.target.value)} /><span className="small muted">{sent.guardian ?? ''}</span></div>
          </div> : null}
          <p className="small muted" style={{ marginTop: 10 }}>{t('The code is sent only by email. After you sign, one PDF is made with this document, the full Terms & Conditions and the audit trail (time, IP address, device). It is locked and cannot be changed. A copy is emailed to you and you can download it any time.')}</p>
        </section>
      </div>
      {con ? <div className="gate-con">
        <div className="con-bar"><button className="btn sm" onClick={() => { setCon(false); setTimeout(() => ref.current?.focus(), 0); }}>← {t('Back to the consent')}</button>
          <select className="input" aria-label={t('Contents')} defaultValue="" onChange={(e) => { const el = e.target.value && conRef.current?.querySelector('#' + CSS.escape(e.target.value)); if (el && conRef.current) conRef.current.scrollTop = (el as HTMLElement).offsetTop - 10; }}>
            <option value="">{t('Contents')}</option>{k.toc.map((x: Any) => <option key={x.id} value={x.id}>{x.level === 3 ? '  ' : ''}{x.text}</option>)}</select></div>
        <div className="gate-doc" tabIndex={0} ref={conRef}><div className="legal-md" dangerouslySetInnerHTML={{ __html: k.html }} /></div>
      </div> : null}
      <div className="gate-ft"><div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><button className="btn" onClick={logout}>{t('Logout')}</button>
        <button className="btn ghost" onClick={() => decline('student_consent', 'Without signing, you cannot use the student portal. Your counsellor will be told and will contact you. Continue?')}>{t('I do not agree')}</button><span className="grow" />
        <span className="small muted">{why}</span><button className="btn primary" disabled={!!why || signing} onClick={sign}>{signing ? t('Signing...') : t('Sign electronically')}</button></div></div>
    </div>
  );
}

/** walks the student through every missing document, then hands back to the portal */
export function Gate({ onDone }: { onDone: () => void }) {
  const [st, setSt] = useState<Any | null>(null);
  const [total, setTotal] = useState(0);
  const load = useCallback(async () => {
    try {
      const s = await GET('/consent/status');
      if (!s.missing.length) { await refreshMe(); onDone(); return; }
      setTotal((n) => n || s.missing.length); setSt(s);
    } catch (e) { showError(e); }
  }, [onDone]);
  useEffect(() => { load(); }, [load]);
  if (!st) return <div className="gate"><div className="gate-card"><div className="empty">{t('Loading...')}</div></div></div>;
  const type = st.missing[0];
  return <div className="gate">{type === 'student_consent' ? <SignStep key={type} st={st} done={load} /> : <GateStep key={type} st={st} type={type} n={total - st.missing.length + 1} total={total} done={load} />}</div>;
}
