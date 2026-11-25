'use client';

import { Suspense, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { GET, POST, download } from '@/le/api';
import { M, useMeta } from '@/le/meta';
import { ago, qs } from '@/le/format';
import { Options, formModal } from '@/le/form';
import { ListView, type ListHandle } from '@/le/ListView';
import { StatusBadge } from '@/le/badges';
import { showError, toast } from '@/le/ui';
import { STUDENT_STATUSES } from '@/le/student/Frame';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = { id: string; [k: string]: any };

// The client's Students list (legacy/public/js/pages/students.js list)
function Students() {
  const router = useRouter();
  const q = useSearchParams();
  const me = useMeta((s) => s.me)!;
  const lv = useRef<ListHandle>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [to, setTo] = useState('');
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(['q', 'status', 'stage', 'country', 'intake', 'source', 'counsellor', 'created_from', 'updated_from'].map((k) => [k, q.get(k) ?? ''])));
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const transfer = async () => {
    if (!to) { toast('Choose a counsellor', 'err'); return; }
    const r = await formModal<{ transferred: number }>({
      title: `Transfer ${sel.length} student(s) to ${M.user(to)?.name}`, size: 'sm', values: { transfer_tasks: true },
      fields: [{ k: 'reason', label: 'Reason', type: 'textarea', req: true, col: 6 }, { k: 'transfer_tasks', label: 'Also transfer open tasks', type: 'checkbox', col: 6 }],
      intro: <p className="small muted" style={{ marginTop: 0 }}>Old and new counsellors are notified and each student gets email E20 (if On).</p>,
      save: (v) => POST('/students/bulk-transfer', { ids: sel, to_user_id: to, ...v }),
    });
    if (r) { toast(`${r.transferred} student(s) transferred`, 'ok'); lv.current?.clearSelection(); setSel([]); lv.current?.reload(); }
  };
  return (
    <>
      <div className="page-head">
        <div><h1>Students</h1><div className="sub">{M.admin() || me.role === 'manager' ? 'All students (all counsellors)' : 'Students assigned to you'}</div></div>
        <span className="grow" />
        {M.admin() ? <button className="btn" onClick={() => download('/admin/export/students' + qs(f), 'students.xlsx').catch(showError)}>Export Excel</button> : null}
      </div>
      {sel.length ? (
        <div className="card" style={{ marginBottom: 10 }}><div className="bd row"><b>{sel.length}</b> selected<span className="grow" />
          <select className="input" style={{ width: 220 }} value={to} onChange={(e) => setTo(e.target.value)}><option value="">Transfer to counsellor...</option><Options list={M.users(['counsellor', 'admin']).map((u) => [u.id, u.name] as [string, string])} /></select>
          <button className="btn sm primary" onClick={transfer}>Transfer</button></div></div>
      ) : null}
      <ListView<Row>
        ref={lv} listKey="students" sort="updated_at" dir="desc" selectable={M.admin()} onSelect={setSel} filters={f} setFilters={(v) => setF((s) => ({ ...s, ...v }))}
        fetch={(p) => GET('/students' + qs(p))} onRow={(r) => router.push('/students/' + r.id)}
        filtersUi={<>
          <input type="search" placeholder="Search name, phone, email, ID" value={f.q} onChange={set('q')} style={{ width: 220 }} />
          <select value={f.status} onChange={set('status')}><option value="">Active lists (not archived)</option><Options list={STUDENT_STATUSES} /></select>
          <select value={f.stage} onChange={set('stage')}><option value="">Any application stage</option><Options list={(useMeta.getState().meta?.app_stages ?? []).map((s) => [s.code, s.name] as [string, string])} /></select>
          <select value={f.country} onChange={set('country')}><option value="">All countries</option><Options list={M.countries(true)} /></select>
          <select value={f.intake} onChange={set('intake')}><option value="">All intakes</option><Options list={M.intakes(true)} /></select>
          <select value={f.source} onChange={set('source')}><option value="">All sources</option><Options list={M.list('lead_source', true)} /></select>
          {M.admin() ? <select value={f.counsellor} onChange={set('counsellor')}><option value="">All counsellors</option><Options list={M.users().map((u) => [u.id, u.name] as [string, string])} /></select> : null}
          <input type="date" title="Created from" value={f.created_from} onChange={set('created_from')} />
          <input type="date" title="Updated since" value={f.updated_from} onChange={set('updated_from')} />
        </>}
        columns={[
          { k: 'student_code', label: 'Student ID', sort: 'student_code', render: (r) => <span className="mono">{r.student_code}</span> },
          { k: 'name', label: 'Name', sort: 'name', render: (r) => <a href={`/students/${r.id}`} onClick={(e) => { e.preventDefault(); router.push(`/students/${r.id}`); }}><b>{r.name}</b></a> },
          { k: 'phone', label: 'Phone', render: (r) => <><span className="nowrap">{r.phone}</span>{r.whatsapp ? <span className="wa">WA</span> : null}</> },
          { k: 'email', label: 'Email', sort: 'email' }, { k: 'passport', label: 'Passport', render: (r) => <span className="mono">{r.passport || '-'}</span> },
          { k: 'stage', label: 'Stage', render: (r) => <span className="badge blue">{r.stage}</span> }, { k: 'countries', label: 'Country' }, { k: 'intake', label: 'Intake' },
          { k: 'status', label: 'Status', sort: 'status', render: (r) => <StatusBadge s={r.status} /> }, { k: 'counsellor', label: 'Counsellor', sort: 'counsellor' },
          { k: 'source', label: 'Source', hide: true }, { k: 'city', label: 'City', hide: true, sort: 'city' },
          { k: 'updated_at', label: 'Last updated', sort: 'updated_at', render: (r) => ago(r.updated_at) },
        ]}
      />
    </>
  );
}
export default function Page() { return <Suspense><Students /></Suspense>; }
