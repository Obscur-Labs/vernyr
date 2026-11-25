'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { GET } from '@/le/api';
import { M } from '@/le/meta';
import { fmtDT, qs } from '@/le/format';
import { Options } from '@/le/form';
import { ListView } from '@/le/ListView';
import { StatusBadge } from '@/le/badges';

/* eslint-disable @typescript-eslint/no-explicit-any */
// The client's Documents to verify (legacy/public/js/pages/work.js documentsPage)
function Documents() {
  const router = useRouter();
  const q = useSearchParams();
  const [f, setF] = useState<Record<string, string>>({ status: q.get('status') || 'Uploaded', counsellor: q.get('counsellor') ?? '' });
  const set = (k: string) => (e: React.ChangeEvent<HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <>
      <div className="page-head"><div><h1>Documents</h1><div className="sub">Documents waiting for verification</div></div></div>
      <ListView<any> listKey="docs" noPaging filters={f} setFilters={(v) => setF((s) => ({ ...s, ...v }))} fetch={(p) => GET('/documents' + qs(p))} onRow={(r) => router.push(`/students/${r.student_id}/documents`)}
        filtersUi={<>
          <select value={f.status} onChange={set('status')}><Options list={[['Uploaded', 'Uploaded (to verify)'], ['Rejected', 'Rejected'], ['Pending', 'Pending'], ['Verified', 'Verified']]} /></select>
          {M.admin() ? <select value={f.counsellor} onChange={set('counsellor')}><option value="">All counsellors</option><Options list={M.users().map((u) => [u.id, u.name] as [string, string])} /></select> : null}
        </>}
        columns={[
          { k: 'student_name', label: 'Student', render: (r) => <><Link href={`/students/${r.student_id}/documents`} onClick={(e) => e.stopPropagation()}><b>{r.student_name}</b></Link><div className="small mono muted">{r.student_code}</div></> },
          { k: 'name', label: 'Document' }, { k: 'stored_name', label: 'File', render: (r) => <span className="mono small">{r.stored_name || '-'}</span> },
          { k: 'status', label: 'Status', render: (r) => <StatusBadge s={r.status} /> }, { k: 'uploaded_at', label: 'Uploaded', render: (r) => (r.uploaded_at ? fmtDT(r.uploaded_at) : '') },
          { k: 'counsellor', label: 'Counsellor' },
        ]} />
    </>
  );
}
export default function Page() { return <Suspense><Documents /></Suspense>; }
