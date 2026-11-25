'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GET } from '@/le/api';
import { ago, fmtDate, fmtDT } from '@/le/format';
import { showError } from '@/le/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
// The client's counsellor detail (legacy/public/js/pages/counsellors.js detail)
export default function Counsellor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  const [q, setQ] = useState('');
  useEffect(() => { try { setQ(sessionStorage.getItem('cn:q') || ''); } catch { /* ignore */ } }, []);
  useEffect(() => { GET('/counsellors/' + id).then(setD).catch(showError); }, [id]);
  const search = (v: string) => { setQ(v); try { sessionStorage.setItem('cn:q', v); } catch { /* ignore */ } };
  if (!d) return <div className="empty">Loading...</div>;
  const c = d.counsellor;
  const s = q.trim().toLowerCase();
  const rows = d.students.filter((x: any) => !s || x.name.toLowerCase().includes(s) || String(x.student_code).toLowerCase().includes(s));
  const stats: [string, number][] = [['Students', c.students], ['Open leads', c.leads], ['Applied', c.applied], ['Offers', c.offers], ['Visa approved', c.visa_approved], ['Enrolled', c.enrolled], ['Overdue tasks', c.overdue_tasks]];
  return (
    <>
      <div className="page-head"><Link className="btn ghost sm" href="/counsellors">← Counsellors</Link></div>
      <div className="card" style={{ marginBottom: 20 }}><div className="bd">
        <div className="row" style={{ gap: 16, alignItems: 'center' }}><span className="avatar lg">{c.name.split(' ').map((x: string) => x[0]).join('').slice(0, 2)}</span>
          <div className="grow"><h1 style={{ margin: 0 }}>{c.name}</h1><div className="small muted">{c.designation || 'Counsellor'} · Counsellor ID <span className="badge blue mono">{c.staff_code || '-'}</span> · last login {c.last_login_at ? fmtDT(c.last_login_at) : '-'}</div></div></div>
        <div className="stats" style={{ marginTop: 18 }}>{stats.map(([l, v]) => <div key={l} className="stat" style={{ cursor: 'default' }}><div className="lbl">{l}</div><div className="val">{v}</div></div>)}</div>
      </div></div>
      <div className="card">
        <div className="hd"><h2>Students of {c.name.split(' ')[0]}</h2><span className="grow" /><input className="input" style={{ maxWidth: 260 }} placeholder="Search name or student ID" value={q} onChange={(e) => search(e.target.value)} /></div>
        <div className="bd flush"><div className="table-wrap"><table className="t cards"><thead><tr><th>Student</th><th>Status</th><th>Where in the flow</th><th>University</th><th>Applications</th><th>Last update</th></tr></thead>
          <tbody>{rows.length ? rows.map((x: any) => (
            <tr key={x.id} className="click" onClick={() => router.push('/students/' + x.id)}>
              <td data-label="Student"><b>{x.name}</b><div className="small mono muted">{x.student_code}</div></td>
              <td data-label="Status"><span className={`badge ${x.status === 'Enrolled' ? 'green' : ''}`}>{x.status || '-'}</span></td>
              <td data-label="Where"><span className="badge blue">{x.step}</span></td>
              <td data-label="University" className="small">{x.university || '-'}{x.application_code ? <div className="mono muted">{x.application_code}</div> : null}</td>
              <td data-label="Applications">{x.open_applications} open / {x.applications}</td><td data-label="Last update" className="small muted">{ago(x.last_update)}</td>
            </tr>
          )) : <tr><td colSpan={6} className="empty">No students</td></tr>}</tbody></table></div></div>
      </div>
      {d.leads.length ? (
        <div className="card" style={{ marginTop: 20 }}><div className="hd"><h2>Open leads ({d.leads.length})</h2></div><div className="bd flush"><div className="table-wrap"><table className="t cards">
          <thead><tr><th>Lead</th><th>Status</th><th>Next follow-up</th><th>Created</th></tr></thead>
          <tbody>{d.leads.map((l: any) => (
            <tr key={l.id} className="click" onClick={() => router.push('/leads/' + l.id)}>
              <td data-label="Lead"><b>{l.name}</b><div className="small mono muted">{l.code}</div></td><td data-label="Status"><span className="badge">{l.status}</span></td>
              <td data-label="Next follow-up" className="small">{l.next_followup_at ? fmtDT(l.next_followup_at) : '-'}</td><td data-label="Created" className="small muted">{fmtDate(l.created_at)}</td>
            </tr>
          ))}</tbody></table></div></div></div>
      ) : null}
    </>
  );
}
