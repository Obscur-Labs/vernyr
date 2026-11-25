'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { GET } from '@/le/api';
import { M, useMeta } from '@/le/meta';
import { fmtDT, qs } from '@/le/format';
import { Options } from '@/le/form';
import { ListView } from '@/le/ListView';
import { StageBadge } from '@/le/badges';

/* eslint-disable @typescript-eslint/no-explicit-any */
// The client's Visa cases (legacy/public/js/pages/work.js visaPage)
function Visa() {
  const router = useRouter();
  const q = useSearchParams();
  const [f, setF] = useState<Record<string, string>>({ stage: q.get('stage') ?? '', country: q.get('country') ?? '', counsellor: q.get('counsellor') ?? '' });
  const set = (k: string) => (e: React.ChangeEvent<HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const stages = useMeta.getState().meta?.visa_stages ?? [];
  return (
    <>
      <div className="page-head"><div><h1>Visa cases</h1><div className="sub">Visa progress for {M.admin() ? 'all' : 'your'} students</div></div></div>
      <ListView<any> listKey="visa" noPaging filters={f} setFilters={(v) => setF((s) => ({ ...s, ...v }))} fetch={(p) => GET('/visa' + qs(p))} onRow={(r) => router.push(`/students/${r.student_id}/applications`)}
        filtersUi={<>
          <select value={f.stage} onChange={set('stage')}><option value="">All stages</option><Options list={[...(f.stage.includes(',') ? [[f.stage, 'Dashboard filter'] as [string, string]] : []), ...stages.map((s) => [s.code, s.name] as [string, string])]} /></select>
          <select value={f.country} onChange={set('country')}><option value="">All countries</option><Options list={M.countries(true)} /></select>
          {M.admin() ? <select value={f.counsellor} onChange={set('counsellor')}><option value="">All counsellors</option><Options list={M.users().map((u) => [u.id, u.name] as [string, string])} /></select> : null}
        </>}
        columns={[
          { k: 'student_name', label: 'Student', render: (r) => <><Link href={`/students/${r.student_id}/applications`} onClick={(e) => e.stopPropagation()}><b>{r.student_name}</b></Link><div className="small mono muted">{r.visa_code}</div></> },
          { k: 'country', label: 'Country' }, { k: 'university', label: 'University' }, { k: 'stage', label: 'Stage', render: (r) => <StageBadge code={r.stage} type="visa" /> },
          { k: 'attempt_no', label: 'Attempt' }, { k: 'appointment_at', label: 'Appointment', render: (r) => (r.appointment_at ? fmtDT(r.appointment_at) : '') }, { k: 'counsellor', label: 'Counsellor' },
        ]} />
    </>
  );
}
export default function Page() { return <Suspense><Visa /></Suspense>; }
