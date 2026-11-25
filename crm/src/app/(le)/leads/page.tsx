'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { GET } from '@/le/api';
import { M } from '@/le/meta';
import { fmtDate, fmtDT, qs } from '@/le/format';
import { Options } from '@/le/form';
import { ListView, type ListHandle } from '@/le/ListView';
import { StatusBadge } from '@/le/badges';
import { STATUSES, leadForm, type Lead } from '@/le/leads';

// The client's Leads list (legacy/public/js/pages/leads.js list)
function Leads() {
  const router = useRouter();
  const q = useSearchParams();
  const lv = useRef<ListHandle>(null);
  const [f, setF] = useState<Record<string, string>>(() => ({
    q: q.get('q') ?? '', status: q.get('status') ?? '', source: q.get('source') ?? '', country: q.get('country') ?? '', intake: q.get('intake') ?? '',
    followup: q.get('followup') ?? '', fu_from: '', fu_to: '', counsellor: q.get('counsellor') ?? '', created_from: '', created_to: '',
  }));
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const add = async () => { if (await leadForm(null)) lv.current?.reload(); };
  useEffect(() => { if (q.get('new')) { router.replace('/leads'); add(); } }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const chip = (k: string, v: string, label: string) => {
    const on = f[k] === v;
    return <span key={k + v} className={`chip ${on ? '' : 'off'}`} onClick={() => setF((s) => ({ ...s, [k]: on ? '' : v }))}>{label}{on ? ' ✕' : ''}</span>;
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Leads</h1><div className="sub">Inquiries that are not yet registered students</div></div>
        <span className="grow" />
        {M.can('leads', 'add') ? <button className="btn primary" onClick={add}>+ Add Lead</button> : null}
      </div>
      <ListView<Lead>
        ref={lv} listKey="leads" sort="next_followup_at" dir="asc" filters={f} setFilters={(v) => setF((s) => ({ ...s, ...v }))}
        fetch={(p) => GET(`/leads${qs(p)}`)}
        filtersUi={<>
          <input type="search" placeholder="Search name, phone, email, ID" value={f.q} onChange={set('q')} style={{ width: 220 }} />
          <select value={f.status} onChange={set('status')}><option value="">All statuses</option><Options list={[['New,Contacted,Follow-up,Interested', 'Open inquiries'], ...STATUSES.map((s) => [s, s] as [string, string])]} /></select>
          <select value={f.source} onChange={set('source')}><option value="">All sources</option><Options list={M.list('lead_source', true)} /></select>
          <select value={f.country} onChange={set('country')}><option value="">All countries</option><Options list={M.countries(true)} /></select>
          <select value={f.intake} onChange={set('intake')}><option value="">All intakes</option><Options list={M.intakes(true)} /></select>
          <select value={f.followup} onChange={set('followup')}><option value="">Any follow-up</option><Options list={[['today', 'Today'], ['overdue', 'Overdue'], ['week', 'This week'], ['custom', 'Custom range']]} /></select>
          {f.followup === 'custom' ? <><input type="date" title="Follow-up from" value={f.fu_from} onChange={set('fu_from')} /><input type="date" title="Follow-up to" value={f.fu_to} onChange={set('fu_to')} /></> : null}
          {M.admin() ? <select value={f.counsellor} onChange={set('counsellor')}><option value="">All counsellors</option><Options list={M.users().map((u) => [u.id, u.name] as [string, string])} /></select> : null}
          <input type="date" title="Created from" value={f.created_from} onChange={set('created_from')} />
          <input type="date" title="Created to" value={f.created_to} onChange={set('created_to')} />
        </>}
        chips={<>{chip('followup', 'overdue', 'Overdue follow-ups')}{chip('followup', 'today', 'Follow-ups today')}{chip('status', 'Interested', 'Interested')}{chip('status', 'New', 'New')}</>}
        columns={[
          { k: 'lead_code', label: 'Lead ID', sort: 'lead_code', render: (r) => <span className="mono">{r.lead_code}</span> },
          { k: 'name', label: 'Name', sort: 'name', render: (r) => <a href={`/leads/${r.id}`} onClick={(e) => { e.preventDefault(); router.push(`/leads/${r.id}`); }}><b>{r.name}</b></a> },
          { k: 'phone', label: 'Phone', sort: 'phone', render: (r) => <><span className="nowrap">{r.country_code} {r.phone}</span>{r.is_whatsapp ? <span className="wa" title="WhatsApp">WA</span> : null}</> },
          { k: 'email', label: 'Email', sort: 'email' }, { k: 'city', label: 'City', sort: 'city' }, { k: 'source', label: 'Source', sort: 'source' },
          { k: 'countries', label: 'Interested country', render: (r) => (r.countries as string[]).join(', ') }, { k: 'intake', label: 'Intake', sort: 'intake' },
          { k: 'status', label: 'Status', sort: 'status', render: (r) => <StatusBadge s={r.status} /> },
          { k: 'next_followup_at', label: 'Next follow-up', sort: 'next_followup_at', render: (r) => r.next_followup_at && !['Converted', 'Not interested'].includes(r.status)
            ? <span className={`nowrap ${r.followup_state === 'overdue' ? 'days-red' : r.followup_state === 'today' ? 'days-orange' : ''}`}>{fmtDT(r.next_followup_at)}</span> : null },
          { k: 'counsellor', label: 'Assigned counsellor', sort: 'counsellor' },
          { k: 'created_at', label: 'Created on', sort: 'created_at', render: (r) => fmtDate(r.created_at) },
        ]}
        rowClass={(r) => (r.followup_state === 'overdue' ? 'overdue' : r.followup_state === 'today' ? 'today' : '')}
        onRow={(r) => router.push(`/leads/${r.id}`)}
      />
    </>
  );
}

export default function LeadsPage() {
  return <Suspense><Leads /></Suspense>;
}
