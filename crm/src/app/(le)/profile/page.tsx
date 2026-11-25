'use client';

import { useEffect, useRef, useState } from 'react';
import http from '@/lib/api';
import { GET, POST, PUT, ApiError } from '@/le/api';
import { useMeta } from '@/le/meta';
import { initials } from '@/le/format';
import { FormGrid, visibleValues, type Field, type Vals } from '@/le/form';
import { showError, toast } from '@/le/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
const FIELDS: Field[] = [
  { k: 'name', label: 'Full name', req: true, maxlength: 100, col: 3 }, { k: 'email', label: 'Email (only Admin can change)', disabled: true, col: 3 },
  { k: 'mobile', label: 'Mobile number', type: 'tel', req: true, help: '+91, 10 digits', col: 3 }, { k: 'designation', label: 'Designation', placeholder: 'e.g. Senior Counsellor', col: 3 },
  { k: 'signature_html', label: 'Email signature (shown in student emails)', type: 'textarea', col: 6, rows: 4, help: 'Simple formatting allowed: <b>, <i>, <br>' },
];
const PW: Field[] = [
  { k: 'current', label: 'Current password', type: 'password', req: true, col: 6 },
  { k: 'password', label: 'New password', type: 'password', req: true, col: 6, help: 'Min 12 characters, 1 letter and 1 number' },
  { k: 'confirm', label: 'Confirm new password', type: 'password', req: true, col: 6 },
];
const NOTIFY: [string, string][] = [['task_assigned', 'Task assigned to me'], ['task_due', 'Task due'], ['task_overdue', 'Task overdue'], ['followup_due', 'Follow-up due'], ['doc_uploaded', 'Document uploaded'],
  ['mention', '@mention'], ['assigned', 'Student / lead assigned to me'], ['email_failed', 'Student email failed'], ['deadline', 'Deadlines'], ['visa_appt', 'Visa appointment tomorrow']];

// The client's My Profile (legacy/public/js/pages/tasks.js profilePage)
export default function Profile() {
  const [me, setMe] = useState<any>(null);
  const [v, setV] = useState<Vals>({});
  const [ne, setNe] = useState<Record<string, boolean>>({});
  const [pw, setPw] = useState<Vals>({});
  const [err, setErr] = useState<Record<string, string>>({});
  const [pwErr, setPwErr] = useState<Record<string, string>>({});
  const pwRef = useRef<HTMLDivElement>(null);
  const load = async () => {
    const m = await GET('/me');
    setMe(m);
    setV({ ...m, signature_html: m.signature_html || `<b>${m.name}</b><br>${m.designation || ''}<br>La Europa Education<br>Phone: ${m.mobile || ''}` });
    setNe(m.notify_email || {});
  };
  useEffect(() => { load().then(() => { if (location.search.includes('pw=1')) pwRef.current?.scrollIntoView(); }).catch(showError); }, []);
  const fail = (e: unknown, setE: (x: Record<string, string>) => void) => { if (e instanceof ApiError && e.data.errors) setE(e.data.errors); showError(e); };
  const save = async () => {
    setErr({});
    try { await PUT('/me', { ...visibleValues(FIELDS, v), notify_email: ne }); toast('Profile saved', 'ok'); useMeta.getState().load(); } catch (e) { fail(e, setErr); }
  };
  const changePw = async () => {
    setPwErr({});
    if (pw.password !== pw.confirm) { setPwErr({ confirm: 'Does not match' }); showError(new Error('Passwords do not match')); return; }
    try { await POST('/me/password', pw); toast('Password changed. Other sessions were logged out.', 'ok'); setPw({}); } catch (e) { fail(e, setPwErr); }
  };
  const photo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { toast('Photo must be 2 MB or less', 'err'); return; }
    const fd = new FormData(); fd.append('photo', f);
    try { await http.post('/me/photo', fd); toast('Photo updated', 'ok'); load(); } catch (er) { showError(new ApiError(0, (er as any)?.response?.data ?? {})); }
  };
  if (!me) return <div className="empty">Loading...</div>;
  return (
    <>
      <div className="page-head"><h1>My Profile</h1></div>
      <div className="grid g2">
        <div className="card"><div className="hd"><h2>Details</h2></div><div className="bd">
          <div className="row" style={{ marginBottom: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <span className="avatar lg">{me.photo_url ? <img src={me.photo_url} alt="" /> : initials(me.name)}</span>
            <div><input type="file" accept="image/png,image/jpeg" onChange={photo} /><div className="small muted">JPG / PNG, max 2 MB</div></div>
          </div>
          <form noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
            <FormGrid fields={FIELDS} vals={v} set={(k, x) => setV((s) => ({ ...s, [k]: x }))} errors={err} />
            <div className="form-actions"><button className="btn primary" type="button" onClick={save}>Save</button></div>
          </form>
        </div></div>
        <div className="stack">
          <div className="card" ref={pwRef}><div className="hd"><h2>Change password</h2></div><div className="bd">
            <form noValidate onSubmit={(e) => { e.preventDefault(); changePw(); }}>
              <FormGrid fields={PW} vals={pw} set={(k, x) => setPw((s) => ({ ...s, [k]: x }))} errors={pwErr} />
              <div className="form-actions"><button className="btn primary" type="button" onClick={changePw}>Change password</button></div>
            </form>
          </div></div>
          <div className="card"><div className="hd"><h2>Email copies of notifications</h2></div><div className="bd">
            {NOTIFY.map(([k, l]) => <label key={k} className="row" style={{ gap: 8, padding: '4px 0' }}><input type="checkbox" checked={!!ne[k]} onChange={(e) => setNe((s) => ({ ...s, [k]: e.target.checked }))} /> {l}</label>)}
            <p className="small muted">In-app notifications are always on. Saved with your details.</p>
          </div></div>
        </div>
      </div>
    </>
  );
}
