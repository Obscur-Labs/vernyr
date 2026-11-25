'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { GET } from '@/le/api';
import { M } from '@/le/meta';
import { qs } from '@/le/format';
import { Options } from '@/le/form';
import { showError } from '@/le/ui';
import { TYPES, TaskTable, taskForm, type Task } from '@/le/tasks';

const T: [string, string][] = [['today', 'Today'], ['overdue', 'Overdue'], ['upcoming', 'Upcoming'], ['completed', 'Completed'], ['assigned_by_me', 'Assigned by me']];

// The client's My Tasks (legacy/public/js/pages/tasks.js page)
function Tasks() {
  const q = useSearchParams();
  const tab = q.get('tab') || 'today';
  const [f, setF] = useState<Record<string, string>>({ priority: q.get('priority') ?? '', type: q.get('type') ?? '', from: q.get('from') ?? '', to: q.get('to') ?? '', user: q.get('user') ?? '' });
  const [rows, setRows] = useState<Task[] | null>(null);
  const load = useCallback(async () => { try { setRows((await GET('/tasks' + qs({ ...f, tab }))).rows); } catch (e) { showError(e); } }, [f, tab]);
  useEffect(() => { load(); }, [load]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const tabHref = (k: string) => `/tasks?${new URLSearchParams({ ...Object.fromEntries(q.entries()), tab: k })}`;
  return (
    <>
      <div className="page-head">
        <div><h1>My Tasks</h1><div className="sub">Tasks assigned to {f.user ? M.user(f.user)?.name ?? '' : 'you'}</div></div>
        <span className="grow" /><button className="btn primary" onClick={async () => { if (await taskForm({})) load(); }}>+ New task</button>
      </div>
      <div className="card">
        <div className="tabs" style={{ padding: '0 10px' }}>{T.map(([k, l]) => <Link key={k} href={tabHref(k)} className={tab === k ? 'on' : ''}>{l}</Link>)}</div>
        <div className="filters">
          <select value={f.priority} onChange={set('priority')}><option value="">Any priority</option><Options list={['High', 'Medium', 'Low']} /></select>
          <select value={f.type} onChange={set('type')}><option value="">Any type</option><Options list={TYPES} /></select>
          <input type="date" title="Due from" value={f.from} onChange={set('from')} /><input type="date" title="Due to" value={f.to} onChange={set('to')} />
          {M.admin() ? <select value={f.user} onChange={set('user')}><option value="">Me</option><Options list={M.users().map((u) => [u.id, u.name] as [string, string])} /></select> : null}
        </div>
        {rows ? <TaskTable rows={rows} reload={load} /> : <div className="empty">Loading...</div>}
      </div>
    </>
  );
}
export default function Page() { return <Suspense><Tasks /></Suspense>; }
