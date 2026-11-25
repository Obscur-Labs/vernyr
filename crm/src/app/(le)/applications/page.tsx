'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { GET, download } from '@/le/api';
import { M, useMeta } from '@/le/meta';
import { fmtDate, qs, store } from '@/le/format';
import { Options } from '@/le/form';
import { ListView } from '@/le/ListView';
import { StageBadge } from '@/le/badges';
import { showError } from '@/le/ui';
import { stagePopup } from '@/le/work/applications';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;

function Kanban({ f, filtersUi }: { f: Record<string, string>; filtersUi: React.ReactNode }) {
  const router = useRouter();
  const [rows, setRows] = useState<Any[] | null>(null);
  const drag = useRef<string | null>(null);
  const [over, setOver] = useState('');
  const load = useCallback(async () => { try { setRows((await GET('/applications' + qs({ ...f, view: 'kanban' }))).rows); } catch (e) { showError(e); } }, [JSON.stringify(f)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);
  const cols = useMeta.getState().meta?.app_stages ?? [];
  const canMove = M.can('applications', 'edit');
  return <>
    <div className="card" style={{ marginBottom: 12 }}><div className="filters" style={{ border: 0 }}>{filtersUi}</div></div>
    <div className="kanban">{!rows ? <div className="empty">Loading...</div> : cols.map((c) => {
      const items = rows.filter((r) => r.stage === c.code);
      return (
        <div key={c.code} className={`kcol ${over === c.code ? 'drop' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(c.code); }} onDragLeave={() => setOver('')}
          onDrop={(e) => { e.preventDefault(); setOver(''); const r = rows.find((x) => x.id === drag.current); if (r && r.stage !== c.code) stagePopup(r, load, c.code); }}>
          <h3><span className="dot" style={{ background: c.color }} />{c.name} <span className="badge">{items.length}</span></h3>
          {items.map((r) => (
            <div key={r.id} className="kcard" draggable={canMove} onDragStart={() => { drag.current = r.id; }} onClick={() => router.push(`/students/${r.student_id}/applications`)}>
              <div className="u">{r.student_name}</div><div className="small">{r.university}</div><div className="small muted">{r.course} · {r.intake}</div><div className="small muted">{r.days_in_stage} day(s) in stage</div>
            </div>
          ))}
        </div>
      );
    })}</div>
  </>;
}

// The client's Applications (legacy/public/js/pages/work.js applicationsPage)
function Applications() {
  const router = useRouter();
  const q = useSearchParams();
  const view = q.get('view') || store.get('apps:view', 'table');
  useEffect(() => { store.set('apps:view', view); }, [view]);
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(['q', 'stage', 'visa_stage', 'country', 'university', 'intake', 'counsellor'].map((k) => [k, q.get(k) ?? ''])));
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const meta = useMeta.getState().meta!;
  const viewHref = (v: string) => `/applications?${new URLSearchParams({ ...Object.fromEntries(q.entries()), view: v })}`;
  const filtersUi = <>
    <input type="search" placeholder="Student, app ID, university app ID" value={f.q} onChange={set('q')} style={{ width: 220 }} />
    <select value={f.stage} onChange={set('stage')}><option value="">All stages</option><Options list={[...(f.stage.includes(',') ? [[f.stage, 'Dashboard filter'] as [string, string]] : []), ...meta.app_stages.map((s) => [s.code, s.name] as [string, string])]} /></select>
    <select value={f.visa_stage} onChange={set('visa_stage')}><option value="">All visa stages</option><Options list={[...(f.visa_stage.includes(',') ? [[f.visa_stage, 'Dashboard filter'] as [string, string]] : []), ...meta.visa_stages.map((s) => [s.code, s.name] as [string, string])]} /></select>
    <select value={f.country} onChange={set('country')}><option value="">All countries</option><Options list={M.countries(true)} /></select>
    <select value={f.university} onChange={set('university')}><option value="">All universities</option><Options list={meta.universities.map((u) => [u.id, u.name] as [string, string])} /></select>
    <select value={f.intake} onChange={set('intake')}><option value="">All intakes</option><Options list={M.intakes(true)} /></select>
    {M.admin() ? <select value={f.counsellor} onChange={set('counsellor')}><option value="">All counsellors</option><Options list={M.users().map((u) => [u.id, u.name] as [string, string])} /></select> : null}
  </>;
  return (
    <>
      <div className="page-head">
        <div><h1>Applications</h1><div className="sub">All applications for {M.admin() ? 'all' : 'your'} students</div></div><span className="grow" />
        <div className="btn-group"><Link className={`btn sm ${view === 'table' ? 'on' : ''}`} href={viewHref('table')}>Table</Link><Link className={`btn sm ${view === 'kanban' ? 'on' : ''}`} href={viewHref('kanban')}>Kanban</Link></div>
        {M.admin() ? <button className="btn" onClick={() => download('/admin/export/applications' + qs(f), 'applications.xlsx').catch(showError)}>Export Excel</button> : null}
      </div>
      {view === 'kanban' ? <Kanban f={f} filtersUi={filtersUi} /> : (
        <ListView<Any & { id: string }> listKey="apps" filters={f} setFilters={(v) => setF((s) => ({ ...s, ...v }))} filtersUi={filtersUi}
          fetch={(p) => GET('/applications' + qs(p))} onRow={(r) => router.push(`/students/${r.student_id}/applications`)}
          columns={[
            { k: 'student_name', label: 'Student', sort: 'student', render: (r) => <><Link href={`/students/${r.student_id}/applications`} onClick={(e) => e.stopPropagation()}><b>{r.student_name}</b></Link><div className="small muted mono">{r.application_code}</div></> },
            { k: 'country', label: 'Country' }, { k: 'university', label: 'University' }, { k: 'course', label: 'Course' }, { k: 'intake', label: 'Intake' },
            { k: 'stage', label: 'Stage', sort: 'stage', render: (r) => <StageBadge code={r.stage} /> },
            { k: 'applied_date', label: 'Applied date', sort: 'applied_date', render: (r) => fmtDate(r.applied_date) },
            { k: 'days_in_stage', label: 'Days in current stage', sort: 'days', render: (r) => <span className={r.days_in_stage > 30 ? 'days-orange' : ''}>{r.days_in_stage}</span> },
            { k: 'counsellor', label: 'Counsellor' },
          ]} />
      )}
    </>
  );
}
export default function Page() { return <Suspense><Applications /></Suspense>; }
