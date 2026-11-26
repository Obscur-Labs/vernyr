'use client';

import { use, useEffect, useState } from 'react';
import { GET, POST } from '@/le/api';
import { Modal, openOverlay, toast } from '@/le/ui';
import { AuthShell, Notice, PasswordField, msg, useEnter } from '@/le/auth';
import type { Any } from '@/le/u';

/** Invite activation (2.5, 2.6): an emailed code, name and password, acceptance of the Terms and the Data Processing terms. */
export default function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const t = encodeURIComponent(token);
  const enter = useEnter();
  const [d, setD] = useState<Any | null>(null);
  const [codeId, setCodeId] = useState<string | null>(null);
  const [v, setV] = useState({ code: '', name: '', designation: '', phone: '', password: '', confirm: '', accept_terms: false });
  const [error, setError] = useState('');
  useEffect(() => {
    GET(`/auth/invite/${t}`).then((x) => { setD(x); setV((s) => ({ ...s, name: x.name || '', designation: x.designation || '', phone: x.phone || '' })); }).catch((e) => setError(msg(e)));
  }, [t]);
  const set = (k: string) => (x: string | boolean) => setV((s) => ({ ...s, [k]: x }));
  const doc = (x: Any) => openOverlay((close) => (
    <Modal title={`${x?.title} (v${x?.version})`} size="lg" close={close}>
      {x?.html ? <div className="legal-doc" dangerouslySetInnerHTML={{ __html: x.html }} /> : <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{x?.text}</div>}
    </Modal>
  ));
  const send = async () => {
    try { const r = await POST(`/auth/invite/${t}/start`); setCodeId(r.code_id); toast(`Code sent to ${r.masked}`, 'ok'); setError(''); } catch (er) { setError(msg(er)); }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { enter(await POST(`/auth/invite/${t}/accept`, { code_id: codeId, ...v })); } catch (er) { setError(msg(er)); }
  };
  if (!d) return <AuthShell><Notice error={error} />{error ? null : <div className="empty">Loading...</div>}</AuthShell>;
  if (!d.valid) return (
    <AuthShell>
      <div>
        <h2>Link expired</h2><p>{d.message}</p>
        <button className="btn primary" onClick={async () => { try { toast((await POST(`/auth/invite/${t}/request-new`)).message, 'ok'); } catch (er) { toast(msg(er), 'err'); } }}>Request new link</button>
      </div>
    </AuthShell>
  );
  return (
    <AuthShell>
      <form onSubmit={submit} noValidate>
        <h2>Welcome to the La Europa partner portal</h2>
        <p className="muted" style={{ margin: '0 0 14px' }}><b>{d.university}</b> · {d.email}</p>
        <Notice error={error} />
        <p className="small">For your security we will email a code to <b>{d.email}</b> in a separate security email.</p>
        <button className="btn primary block" type="button" onClick={send}>{codeId ? 'Email the code again' : 'Email my code'}</button>
        {codeId ? (
          <div style={{ marginTop: 14 }}>
            <div className="f"><label htmlFor="ic">Verification code</label><input id="ic" className="otp-input" inputMode="numeric" maxLength={6} value={v.code} onChange={(e) => set('code')(e.target.value)} /></div>
            <div className="f"><label htmlFor="nm">Full name</label><input id="nm" maxLength={100} value={v.name} onChange={(e) => set('name')(e.target.value)} /></div>
            <div className="f"><label htmlFor="ds">Designation</label><input id="ds" maxLength={100} value={v.designation} onChange={(e) => set('designation')(e.target.value)} /></div>
            <div className="f"><label htmlFor="ph">Phone (with country code)</label><input id="ph" maxLength={30} value={v.phone} onChange={(e) => set('phone')(e.target.value)} /></div>
            <PasswordField id="p1" label="Password (min 10 characters, a letter, a number and a symbol)" value={v.password} onChange={set('password')} />
            <PasswordField id="p2" label="Confirm password" value={v.confirm} onChange={set('confirm')} />
            <label className="consent"><input type="checkbox" checked={v.accept_terms} onChange={(e) => set('accept_terms')(e.target.checked)} />{' '}
              <span>I accept the <a href="#" onClick={(e) => { e.preventDefault(); doc(d.terms); }}>Portal Terms of Use</a> and the <a href="#" onClick={(e) => { e.preventDefault(); doc(d.dpa); }}>Data Processing terms</a>.</span></label>
            <button className="btn primary block" type="submit" style={{ marginTop: 10 }}>Activate my account</button>
          </div>
        ) : null}
      </form>
    </AuthShell>
  );
}
