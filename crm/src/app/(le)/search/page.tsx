'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { GET } from '@/le/api';
import { M } from '@/le/meta';
import { qs } from '@/le/format';
import { StatusBadge } from '@/le/badges';
import { showError } from '@/le/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
function Section({ title, rows, row }: { title: string; rows: any[]; row: (x: any) => React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="hd"><h2>{title}</h2><span className="badge">{rows.length}</span></div>
      <div className="bd flush">{rows.length ? <ul className="list-plain" style={{ padding: '0 16px' }}>{rows.map(row)}</ul> : <div className="empty">No matches</div>}</div>
    </div>
  );
}

// The client's Search (legacy/public/js/pages/tasks.js searchPage)
function Search() {
  const q = useSearchParams();
  const [term, setTerm] = useState(q.get('q') ?? '');
  const [d, setD] = useState<any>(null);
  const run = async (t: string) => {
    if (t.trim().length < 3) { setD('short'); return; }
    try { setD(await GET('/search' + qs({ q: t, all: 1 }))); } catch (e) { showError(e); }
  };
  useEffect(() => { run(q.get('q') ?? ''); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="page-head"><h1>Search</h1></div>
      <div className="card" style={{ marginBottom: 14 }}><div className="bd">
        <input className="input" type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Name, phone (any format), email, passport number (full), Student / Lead / Application ID, university application ID"
          onKeyDown={(e) => { if (e.key === 'Enter') { history.replaceState(null, '', '/search?q=' + encodeURIComponent(term)); run(term); } }} />
      </div></div>
      {d === 'short' ? <div className="empty">Type at least 3 characters</div> : d ? <>
        <Section title="Students" rows={d.students} row={(s) => <li key={s.id}><Link className="grow" href={`/students/${s.id}`}><b>{s.name}</b></Link><span className="small muted">{s.code} · {s.phone || ''} · {s.email || ''} · {s.counsellor}</span><span className="badge blue">{s.stage}</span></li>} />
        {M.can('leads') ? <Section title="Leads" rows={d.leads} row={(l) => <li key={l.id}><Link className="grow" href={`/leads/${l.id}`}><b>{l.name}</b></Link><span className="small muted">{l.code} · {l.phone || ''} · {l.email || ''} · {l.counsellor}</span><StatusBadge s={l.status} /></li>} /> : null}
        <Section title="Applications" rows={d.applications} row={(a) => <li key={a.id ?? a.code}><Link className="grow" href={`/students/${a.student_id}/applications`}><b>{a.code}</b> {a.student}</Link><span className="small muted">{a.university} {a.university_app_id ? '· ' + a.university_app_id : ''}</span><span className="badge">{a.stage}</span></li>} />
      </> : null}
    </>
  );
}
export default function Page() { return <Suspense><Search /></Suspense>; }
