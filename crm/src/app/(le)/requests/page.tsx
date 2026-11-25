'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { GET } from '@/le/api';
import { M } from '@/le/meta';
import { ago, fmtDate, qs } from '@/le/format';
import { Options } from '@/le/form';
import { ListView, type ListHandle } from '@/le/ListView';
import { REQ_STATUSES, ReqBadge, requestDetail } from '@/le/portalcrm';

/* eslint-disable @typescript-eslint/no-explicit-any */
const OPEN = 'Requested by student,In review,Info needed';
// The client's Student Requests (legacy/public/js/pages/portalcrm.js requestsPage)
function Requests() {
  const q = useSearchParams();
  const lv = useRef<ListHandle>(null);
  const [counts, setCounts] = useState<any>(null);
  const [f, setF] = useState<Record<string, string>>({ status: q.get('status') ?? OPEN, country: '', intake: '', counsellor: '' });
  const set = (k: string) => (e: React.ChangeEvent<HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const loadCounts = () => GET('/portal-counts').then(setCounts).catch(() => {});
  useEffect(() => { loadCounts(); }, []);
  return (
    <>
      <div className="page-head"><div><h1>Student Requests</h1><div className="sub">Apply Now requests from the student portal. La Europa reviews and applies on the student&apos;s behalf: nothing is sent to universities automatically.</div></div></div>
      {counts ? (
        <div className="stats" style={{ marginBottom: 14 }}>
          <div className="stat"><div className="lbl">New Apply Now requests</div><div className="val">{counts.requests}</div></div>
          <div className={`stat ${counts.change_requests_overdue ? 'red' : ''}`}><div className="lbl">Profile change requests</div><div className="val">{counts.change_requests}</div><div className="chg">{counts.change_requests_overdue} older than 3 days</div></div>
          <div className="stat"><div className="lbl">Offer acceptances to process</div><div className="val">{counts.offer_acceptances}</div></div>
          <div className="stat"><div className="lbl">Payment proofs to check</div><div className="val">{counts.payment_proofs}</div></div>
        </div>
      ) : null}
      <ListView<any> ref={lv} listKey="requests" noPaging filters={f} setFilters={(v) => setF((s) => ({ ...s, ...v }))} fetch={(p) => GET('/portal-requests' + qs(p))}
        onRow={(r) => requestDetail(r.id, () => { lv.current?.reload(); loadCounts(); })}
        filtersUi={<>
          <select value={f.status} onChange={set('status')}><option value={OPEN}>Open requests</option><Options list={REQ_STATUSES} /><option value="">All</option></select>
          <select value={f.country} onChange={set('country')}><option value="">All countries</option><Options list={M.countries(true)} /></select>
          <select value={f.intake} onChange={set('intake')}><option value="">All intakes</option><Options list={M.intakes(true)} /></select>
          {M.admin() ? <select value={f.counsellor} onChange={set('counsellor')}><option value="">All counsellors</option><Options list={M.users().map((u) => [u.id, u.name] as [string, string])} /></select> : null}
        </>}
        columns={[
          { k: 'code', label: 'Request ID', render: (r) => <span className="mono">{r.code}</span> },
          { k: 'student_name', label: 'Student', render: (r) => <><b>{r.student_name}</b><div className="small muted">{r.student_code}{r.is_lead ? ' (lead: register first)' : ''}</div></> },
          { k: 'university', label: 'University' }, { k: 'course', label: 'Course' }, { k: 'intake', label: 'Intake' },
          { k: 'deadline', label: 'Deadline', render: (r) => <>{fmtDate(r.deadline)}{r.days_left !== null && r.days_left !== undefined ? <div className={`small ${r.days_left <= 7 ? 'days-red' : r.days_left <= 15 ? 'days-orange' : ''}`}>{r.days_left} days left</div> : null}</> },
          { k: 'eligibility', label: 'Eligibility hint' }, { k: 'missing', label: 'Missing docs', render: (r) => (r.missing ?? []).length },
          { k: 'status', label: 'Status', render: (r) => <ReqBadge s={r.status} /> }, { k: 'requested_at', label: 'Requested', render: (r) => ago(r.requested_at) },
          { k: 'counsellor', label: 'Counsellor', hide: !M.admin() },
        ]} />
    </>
  );
}
export default function Page() { return <Suspense><Requests /></Suspense>; }
