'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GET } from '@/le/api';
import { ago } from '@/le/format';
import { showError } from '@/le/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
const N = ({ n, cls = '' }: { n?: number; cls?: string }) => <b className={cls}>{n ?? 0}</b>;
// The client's Counsellors (legacy/public/js/pages/counsellors.js list)
export default function Counsellors() {
  const router = useRouter();
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { GET('/counsellors').then((d) => setRows(d.rows)).catch(showError); }, []);
  if (!rows) return <div className="empty">Loading...</div>;
  const sum = (k: string) => rows.reduce((s, x) => s + (x[k] || 0), 0);
  const stats: [string, number][] = [['Counsellors', rows.length], ['Students', sum('students')], ['Applications', sum('applications')], ['Offers', sum('offers')], ['Visa approved', sum('visa_approved')]];
  return (
    <>
      <div className="page-head"><div><h1>Counsellors</h1><div className="sub">Each counsellor handles a student from first contact to enrolment. Open a counsellor to see only their students.</div></div></div>
      <div className="stats" style={{ marginBottom: 20 }}>{stats.map(([l, v]) => <div key={l} className="stat" style={{ cursor: 'default' }}><div className="lbl">{l}</div><div className="val">{v}</div></div>)}</div>
      <div className="card"><div className="bd flush"><div className="table-wrap"><table className="t cards">
        <thead><tr><th>Counsellor</th><th>Counsellor ID</th><th>Students</th><th>Open leads</th><th>Applied</th><th>Offers</th><th>Tuition paid</th><th>Visa approved</th><th>Enrolled</th><th>Tasks (overdue)</th><th>Last activity</th></tr></thead>
        <tbody>{rows.length ? rows.map((u) => (
          <tr key={u.id} className="click" onClick={() => router.push('/counsellors/' + u.id)}>
            <td data-label="Counsellor"><b>{u.name}</b><div className="small muted">{u.designation || ''}{u.status !== 'active' ? ' · ' + u.status : ''}</div></td>
            <td data-label="Counsellor ID"><span className="badge blue mono">{u.staff_code || '-'}</span></td><td data-label="Students"><N n={u.students} /></td><td data-label="Open leads"><N n={u.leads} /></td>
            <td data-label="Applied"><N n={u.applied} /></td><td data-label="Offers"><N n={u.offers} /></td><td data-label="Tuition paid"><N n={u.tuition_paid} /></td>
            <td data-label="Visa approved"><N n={u.visa_approved} cls="text-green" /></td><td data-label="Enrolled"><N n={u.enrolled} cls="text-green" /></td>
            <td data-label="Tasks"><N n={u.open_tasks} /> {u.overdue_tasks ? <span className="badge red">{u.overdue_tasks} overdue</span> : null}</td>
            <td data-label="Last activity" className="small muted">{u.last_activity ? ago(u.last_activity) : '-'}</td>
          </tr>
        )) : <tr><td colSpan={11} className="empty">No counsellors yet. Admin Settings &gt; Users: create a user with the Counsellor role.</td></tr>}</tbody>
      </table></div></div></div>
    </>
  );
}
