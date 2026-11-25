'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GET, POST } from '@/le/api';
import { M } from '@/le/meta';
import { fmtDate, fmtDT, qs, store } from '@/le/format';
import { Options } from '@/le/form';
import { PriBadge } from '@/le/badges';
import { showError, toast } from '@/le/ui';
import { taskForm, type Task } from '@/le/tasks';

/* eslint-disable @typescript-eslint/no-explicit-any */
export const TL_ICON: Record<string, string> = { stage: '➜', document: 'D', email: '@', payment: '₹', task: '✓', note: 'N', comment: 'C', profile: 'P', lead: 'L' };

// The client's Dashboard (legacy/public/js/pages/dashboard.js)
export default function Dashboard() {
  const router = useRouter();
  const [f, setF] = useState<Record<string, string>>(() => store.get('dash:filters', {}));
  const [d, setD] = useState<any>(null);
  const [tab, setTab] = useState<string>(() => store.get('dash:todo', 'today'));
  const load = useCallback(async () => {
    store.set('dash:filters', f);
    try { setD(await GET('/dashboard' + qs(f))); } catch (e) { showError(e); }
  }, [f]);
  useEffect(() => { load(); }, [load]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const extra = (link: string) => {
    const p = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
    return p.length ? link + (link.includes('?') ? '&' : '?') + p.join('&') : link;
  };
  const done = async (id: string) => { try { await POST(`/tasks/${id}/done`); toast('Task marked done', 'ok'); load(); } catch (e) { showError(e); } };
  const href = (h: string) => h.replace(/^#/, '');
  const todoRow = (t: Task, overdue: boolean) => (
    <div key={t.id} className={`todo-row ${overdue ? 'overdue' : ''}`}>
      <input type="checkbox" title="Mark done" onChange={() => done(t.id)} />
      <div className="grow">
        <div className="ttl">{t.title} {t.is_system ? <span className="badge grey">System</span> : null}</div>
        <div className="small muted">{t.student_id ? <><Link href={`/students/${t.student_id}`}>{t.student_name || ''}</Link> · </> : t.lead_id ? <><Link href={`/leads/${t.lead_id}`}>{t.lead_name || 'Lead'}</Link> · </> : null}{fmtDT(t.due_at)}</div>
      </div>
      <PriBadge p={t.priority} />
    </div>
  );
  const tabs: [string, string, Task[]][] = d ? [['today', 'Today', d.todo.today], ['overdue', 'Overdue', d.todo.overdue], ['upcoming', 'Upcoming (7 days)', d.todo.upcoming]] : [];

  return (
    <>
      <div className="page-head">
        <div><h1>Dashboard</h1><div className="sub">{M.admin() ? 'All students of all counsellors' : 'Your assigned leads and students'} · {new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
        <span className="grow" />
        <div className="filters" style={{ border: 0, padding: 0 }}>
          <select value={f.intake ?? ''} onChange={set('intake')}><option value="">All intakes</option><Options list={M.intakes()} /></select>
          <select value={f.country ?? ''} onChange={set('country')}><option value="">All countries</option><Options list={M.countries()} /></select>
          {M.admin() ? <select value={f.counsellor ?? ''} onChange={set('counsellor')}><option value="">All counsellors</option><Options list={M.users('counsellor').map((u) => [u.id, u.name] as [string, string])} /></select> : null}
        </div>
      </div>
      {!d ? <div className="empty">Loading...</div> : (
        <>
          <div className="stats">{d.cards.map((c: any) => (
            <Link key={c.label} className={`stat ${c.tone || ''}`} href={href(extra(c.link))}>
              <div className="lbl">{c.label}</div><div className="val">{c.value}</div>
              <div className={`chg ${c.week ? 'up' : ''}`}>{c.sub ? c.sub : c.week !== undefined ? `${c.week ? '+' + c.week : 'No change'} this week` : ''}</div>
            </Link>
          ))}</div>
          <div className="dash-grid">
            <div className="card">
              <div className="hd"><h2>To-Do</h2><span className="grow" /><button className="btn sm primary" onClick={async () => { if (await taskForm({})) load(); }}>+ New Task</button><Link className="btn sm" href="/tasks">View all</Link></div>
              <div className="tabs" style={{ padding: '0 12px' }}>{tabs.map(([k, l, arr]) => (
                <button key={k} className={tab === k ? 'on' : ''} onClick={() => { store.set('dash:todo', k); setTab(k); }}>{l} <span className={`n ${k === 'overdue' && arr.length ? 'red' : ''}`}>{arr.length}</span></button>
              ))}</div>
              <div className="bd" style={{ paddingTop: 4 }}>{tabs.filter(([k]) => k === tab).map(([k, , arr]) => (
                <div key={k}>{arr.length ? arr.map((t) => todoRow(t, k === 'overdue')) : <div className="empty">Nothing here</div>}</div>
              ))}</div>
            </div>
            <div className="card"><div className="hd"><h2>Upcoming intakes and deadlines</h2></div><div className="bd">
              <h4 style={{ marginBottom: 8 }}>Application deadlines (next 30 days)</h4>
              {d.deadlines.length ? (
                <div className="table-wrap"><table className="t"><thead><tr><th>Student</th><th>University</th><th>Course</th><th>Intake</th><th>Deadline</th><th>Days left</th></tr></thead>
                  <tbody>{d.deadlines.map((x: any, i: number) => (
                    <tr key={i}><td><Link href={`/students/${x.student_id}/${x.src === 'shortlist' ? 'shortlist' : 'applications'}`}>{x.student}</Link></td><td>{x.university}</td><td>{x.course}</td><td>{x.intake}</td>
                      <td className="nowrap">{fmtDate(x.deadline)}</td><td className={x.days_left <= 7 ? 'days-red' : x.days_left <= 15 ? 'days-orange' : ''}>{x.days_left}</td></tr>
                  ))}</tbody></table></div>
              ) : <p className="muted">No deadlines in the next 30 days.</p>}
              <h4 style={{ margin: '16px 0 8px' }}>Visa appointments (next 14 days)</h4>
              {d.visa_appointments.length ? (
                <ul className="list-plain">{d.visa_appointments.map((v: any, i: number) => (
                  <li key={i}><div className="grow"><Link href={`/students/${v.student_id}/visa`}>{v.student}</Link> <span className="muted small">{v.country} · {v.centre || ''}</span></div><b className="nowrap">{fmtDT(v.appointment_at)}</b></li>
                ))}</ul>
              ) : <p className="muted">No visa appointments in the next 14 days.</p>}
              <h4 style={{ margin: '16px 0 8px' }}>Students per upcoming intake</h4>
              {d.intake_summary.length ? <div className="row">{d.intake_summary.map((i: any) => <span key={i.name} className="badge blue" style={{ fontSize: 13, padding: '5px 12px' }}>{i.name}: {i.c}</span>)}</div> : <p className="muted">No upcoming intakes yet.</p>}
            </div></div>
            <div className="card" style={{ gridColumn: '1/-1' }}>
              <div className="hd"><h2>Recent activity</h2><span className="muted small">Last 20 actions on {M.admin() ? 'all' : 'your'} students</span></div>
              <div className="bd">{d.recent.length ? (
                <ul className="tl">{d.recent.map((t: any, i: number) => (
                  <li key={i} style={{ cursor: 'pointer' }} onClick={() => router.push(`/students/${t.student_id}/timeline`)}>
                    <span className={`ic ${t.type}`}>{TL_ICON[t.type] || '•'}</span>
                    <div className="grow"><div><b>{t.student_name}</b>: {t.description}</div><div className="when">{t.user_name || 'System'} · {fmtDT(t.created_at)}</div></div>
                  </li>
                ))}</ul>
              ) : <p className="muted">No recent activity.</p>}</div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
