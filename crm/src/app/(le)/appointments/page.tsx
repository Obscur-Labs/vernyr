'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { GET, POST, PUT } from '@/le/api';
import { Modal, openOverlay, showError, toast } from '@/le/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const BADGE: Record<string, string> = { Requested: 'orange', Confirmed: 'green', Declined: 'red', Cancelled: 'grey', Completed: 'blue', 'No-show': 'red' };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function Accept({ r, close, done }: { r: Any; close: () => void; done: () => void }) {
  const [link, setLink] = useState(''), [loc, setLoc] = useState(''), [note, setNote] = useState('');
  useEffect(() => { GET('/appointments/hours').then((h) => { setLink(h.prefs.meeting_link || ''); setLoc(h.prefs.location || ''); }).catch(() => {}); }, []);
  const ok = async () => {
    try { await POST(`/appointments/${r.id}/accept`, { meeting_link: r.mode === 'online' ? link : undefined, location: r.mode === 'online' ? undefined : loc, note }); close(); toast('Accepted. The student got the details by email and in the portal.', 'ok'); done(); } catch (e) { showError(e); }
  };
  return (
    <Modal title={`Accept: ${r.when}`} close={close} foot={<><button className="btn" onClick={close}>Back</button><button className="btn primary" onClick={ok}>Accept and tell the student</button></>}>
      <p className="small muted" style={{ marginTop: 0 }}>{r.person} · {r.mode_label}<br />Reason: {r.reason}</p>
      {r.mode === 'online'
        ? <div className="f"><label>Online meeting link (Google Meet, Zoom, Teams)</label><input className="input" placeholder="https://meet.google.com/..." value={link} onChange={(e) => setLink(e.target.value)} /></div>
        : <div className="f"><label>Office address</label><textarea className="input" rows={2} value={loc} onChange={(e) => setLoc(e.target.value)} /></div>}
      <div className="f" style={{ marginTop: 10 }}><label>Note for the student (optional)</label><input className="input" maxLength={300} placeholder="e.g. Please bring your marksheets" value={note} onChange={(e) => setNote(e.target.value)} /></div>
    </Modal>
  );
}
function Reason({ title, help, url, okLabel, close, done }: { title: string; help: string; url: string; okLabel: string; close: () => void; done: () => void }) {
  const [v, setV] = useState('');
  const ok = async () => { try { await POST(url, { reason: v }); close(); toast('Done. The student was told.', 'ok'); done(); } catch (e) { showError(e); } };
  return <Modal title={title} close={close} foot={<><button className="btn" onClick={close}>Back</button><button className="btn danger" onClick={ok}>{okLabel}</button></>}>
    <p className="small muted" style={{ marginTop: 0 }}>{help}</p><textarea className="input" rows={3} maxLength={300} value={v} onChange={(e) => setV(e.target.value)} />
  </Modal>;
}
function Card({ r, reload }: { r: Any; reload: () => void }) {
  const upcoming = r.status === 'Confirmed' && !r.past;
  const outcome = async (status: string) => { try { await POST(`/appointments/${r.id}/outcome`, { status }); toast('Saved', 'ok'); reload(); } catch (e) { showError(e); } };
  return (
    <div className="card ap-card"><div className="bd">
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}><div className="ap-when"><b>{r.when}</b><div className="small muted">{r.mode_label} · {r.code}</div></div><span className="grow" /><span className={`badge ${BADGE[r.status] || 'grey'}`}>{r.status}</span></div>
      <div className="ap-who"><Link href={String(r.link).replace(/^#/, '')}><b>{r.person}</b></Link> <span className="mono small muted">{r.person_code}</span>{r.counsellor ? <span className="small muted"> · counsellor {r.counsellor}</span> : null}</div>
      <div className="ap-reason"><span className="small muted">Reason</span><div>{r.reason}</div></div>
      {r.status === 'Confirmed' || r.status === 'Completed' ? <div className="small" style={{ marginTop: 6 }}>{r.mode === 'online' ? <>Link: <a href={r.meeting_link} target="_blank" rel="noopener noreferrer">{r.meeting_link}</a></> : `Place: ${r.location || ''}`}</div> : null}
      {r.decline_reason ? <div className="small muted" style={{ marginTop: 6 }}>Declined: {r.decline_reason}</div> : null}
      {r.cancel_reason ? <div className="small muted" style={{ marginTop: 6 }}>Cancelled: {r.cancel_reason}</div> : null}
      <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {r.status === 'Requested' && !r.past ? <>
          <button className="btn sm primary" onClick={() => openOverlay((close) => <Accept r={r} close={close} done={reload} />)}>Accept</button>
          <button className="btn sm" onClick={() => openOverlay((close) => <Reason title="Decline the request" help="Why not, and which time would suit you? The student sees this." url={`/appointments/${r.id}/decline`} okLabel="Decline" close={close} done={reload} />)}>Decline</button>
        </> : null}
        {upcoming ? <button className="btn sm" onClick={() => openOverlay((close) => <Reason title="Cancel the meeting" help="Why? The student sees this and can book another time." url={`/appointments/${r.id}/cancel`} okLabel="Cancel meeting" close={close} done={reload} />)}>Cancel meeting</button> : null}
        {r.status === 'Confirmed' && r.past ? <><button className="btn sm primary" onClick={() => outcome('Completed')}>Mark as held</button><button className="btn sm" onClick={() => outcome('No-show')}>Student did not come</button></> : null}
      </div>
    </div></div>
  );
}
function Hours() {
  const [rows, setRows] = useState<Any[] | null>(null);
  const [off, setOff] = useState<Any[]>([]);
  const [p, setP] = useState<Any>({});
  useEffect(() => { GET('/appointments/hours').then((d) => { setRows(d.hours.map((h: Any) => ({ ...h }))); setOff(d.time_off.map((x: Any) => ({ ...x }))); setP(d.prefs); }).catch(showError); }, []);
  if (!rows) return <div className="empty">Loading...</div>;
  const setRow = (i: number, k: string, v: unknown) => setRows(rows.map((h, j) => (j === i ? { ...h, [k]: v } : h)));
  const setOffRow = (i: number, k: string, v: unknown) => setOff(off.map((h, j) => (j === i ? { ...h, [k]: v } : h)));
  const sp = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setP({ ...p, [k]: e.target.value });
  const save = async () => {
    try {
      await PUT('/appointments/hours', { hours: rows, time_off: off.filter((x) => x.date), prefs: { ...p, accepting: !!p.accepting, slot_min: Number(p.slot_min), notice_hours: Number(p.notice_hours), days_ahead: Number(p.days_ahead) } });
      toast('Saved. Students can now book in these hours.', 'ok');
    } catch (e) { showError(e); }
  };
  const add = () => { const last = rows[rows.length - 1]; setRows([...rows, last ? { ...last, weekday: (Number(last.weekday) + 1) % 7 } : { weekday: 1, start: '10:00', end: '13:00', online: true, in_person: true }]); };
  return (
    <>
      <div className="grid two" style={{ alignItems: 'start' }}>
        <div className="card"><div className="hd"><h2>Weekly hours</h2><span className="grow" /><button className="btn xs" onClick={add}>+ Add time</button></div><div className="bd">
          {rows.length ? rows.map((h, i) => (
            <div key={i} className="row ap-hrow" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <select className="input" style={{ width: 140 }} value={Number(h.weekday)} onChange={(e) => setRow(i, 'weekday', Number(e.target.value))}>{DAYS.map((x, k) => <option key={k} value={k}>{x}</option>)}</select>
              <input type="time" className="input" style={{ width: 120 }} value={h.start} onChange={(e) => setRow(i, 'start', e.target.value)} /><span>to</span>
              <input type="time" className="input" style={{ width: 120 }} value={h.end} onChange={(e) => setRow(i, 'end', e.target.value)} />
              <label className="small row" style={{ gap: 4 }}><input type="checkbox" checked={!!h.online} onChange={(e) => setRow(i, 'online', e.target.checked)} /> Online</label>
              <label className="small row" style={{ gap: 4 }}><input type="checkbox" checked={!!h.in_person} onChange={(e) => setRow(i, 'in_person', e.target.checked)} /> In person</label>
              <button className="btn xs danger" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
            </div>
          )) : <p className="muted small" style={{ margin: 0 }}>No hours yet: students cannot book you.</p>}
          <p className="small muted" style={{ margin: '10px 0 0' }}>Students see free slots only inside these hours. Add two rows for a day with a break (e.g. 10:00-13:00 and 14:00-18:00).</p>
        </div></div>
        <div className="card"><div className="hd"><h2>Settings</h2></div><div className="bd">
          <form className="form-grid" noValidate onSubmit={(e) => e.preventDefault()}>
            <div className="f c6"><label className="row" style={{ gap: 8 }}><input type="checkbox" checked={!!p.accepting} onChange={(e) => setP({ ...p, accepting: e.target.checked })} /> Students can book meetings with me</label></div>
            <div className="f c2"><label>Slot length</label><select className="input" value={p.slot_min} onChange={sp('slot_min')}>{[15, 20, 30, 45, 60].map((x) => <option key={x} value={x}>{x} minutes</option>)}</select></div>
            <div className="f c2"><label>Book at least</label><select className="input" value={p.notice_hours} onChange={sp('notice_hours')}>{[0, 2, 4, 12, 24, 48].map((x) => <option key={x} value={x}>{x ? x + ' hours before' : 'any time'}</option>)}</select></div>
            <div className="f c2"><label>Up to</label><select className="input" value={p.days_ahead} onChange={sp('days_ahead')}>{[7, 14, 21, 30, 45, 60].map((x) => <option key={x} value={x}>{x} days ahead</option>)}</select></div>
            <div className="f c6"><label>Default online meeting link</label><input className="input" placeholder="https://meet.google.com/..." value={p.meeting_link || ''} onChange={sp('meeting_link')} /></div>
            <div className="f c6"><label>Office address (in-person meetings)</label><textarea className="input" rows={2} value={p.location || ''} onChange={sp('location')} /></div>
          </form>
          <h3 style={{ margin: '16px 0 6px' }}>Days off</h3>
          {off.length ? off.map((x, i) => (
            <div key={i} className="row" style={{ gap: 8, marginBottom: 6 }}>
              <input type="date" className="input" style={{ width: 170 }} value={x.date} onChange={(e) => setOffRow(i, 'date', e.target.value)} />
              <input className="input" style={{ flex: 1 }} placeholder="Note (optional)" value={x.note || ''} onChange={(e) => setOffRow(i, 'note', e.target.value)} />
              <button className="btn xs danger" onClick={() => setOff(off.filter((_, j) => j !== i))}>✕</button>
            </div>
          )) : <p className="muted small" style={{ margin: '0 0 8px' }}>None</p>}
          <button className="btn xs" onClick={() => setOff([...off, { date: '', note: '' }])}>+ Day off</button>
        </div></div>
      </div>
      <div className="row" style={{ marginTop: 14 }}><button className="btn primary" onClick={save}>Save my meeting hours</button></div>
    </>
  );
}

// The client's Appointments (legacy/public/js/pages/appointments.js)
function Appointments() {
  const q = useSearchParams();
  const tab = q.get('tab') || 'requests';
  const all = q.get('scope') === 'all';
  const [d, setD] = useState<Any | null>(null);
  const load = useCallback(() => GET('/appointments' + (all ? '?scope=all' : '')).then(setD).catch(showError), [all]);
  useEffect(() => { load(); }, [load]);
  const rows: Any[] = d?.rows ?? [];
  const req = rows.filter((r) => r.status === 'Requested' && !r.past);
  const up = rows.filter((r) => r.status === 'Confirmed' && !r.past).sort((a, b) => a.start_at.localeCompare(b.start_at));
  const past = rows.filter((r) => !(r.status === 'Requested' && !r.past) && !(r.status === 'Confirmed' && !r.past));
  const tabs: [string, string][] = [['requests', `Requests${req.length ? ` (${req.length})` : ''}`], ['upcoming', `Upcoming (${up.length})`], ['past', 'Past and closed'], ['hours', 'My meeting hours']];
  const list = tab === 'requests' ? req : tab === 'upcoming' ? up : past;
  const href = (t: string, scopeAll = all) => `/appointments?tab=${t}${scopeAll ? '&scope=all' : ''}`;
  return (
    <>
      <div className="page-head"><div><h1>Appointments</h1><div className="sub">Students ask for a meeting in your free hours (online or at the office) with a reason. You accept or decline.</div></div><span className="grow" />
        {d?.can_all ? <Link className={`btn sm ${all ? 'primary' : ''}`} href={href(tab, !all)}>{all ? 'All counsellors' : 'Show all counsellors'}</Link> : null}</div>
      <div className="seg-tabs" style={{ marginBottom: 14 }}>{tabs.map(([k, l]) => <Link key={k} href={href(k)} className={k === tab ? 'on' : ''}>{l}</Link>)}</div>
      {tab === 'hours' ? <Hours /> : !d ? <div className="empty">Loading...</div> : list.length ? <div className="ap-list">{list.map((r) => <Card key={r.id} r={r} reload={load} />)}</div> : (
        <div className="card"><div className="bd empty">{tab === 'requests' ? 'No new requests.' : tab === 'upcoming' ? 'No upcoming meetings.' : 'Nothing here yet.'}
          {tab !== 'past' ? <> <Link href="/appointments?tab=hours">Set your meeting hours</Link> so students can book.</> : null}</div></div>
      )}
    </>
  );
}
export default function Page() { return <Suspense><Appointments /></Suspense>; }
