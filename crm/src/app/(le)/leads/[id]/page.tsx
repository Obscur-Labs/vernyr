'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GET, PUT } from '@/le/api';
import { M } from '@/le/meta';
import { fmtDate, fmtDT } from '@/le/format';
import { Options, formModal } from '@/le/form';
import { StatusBadge } from '@/le/badges';
import { toast } from '@/le/ui';
import { OUTCOMES, TL_ICON, deleteLead, leadForm, logCall, setFollowup, type Lead } from '@/le/leads';

type Detail = {
  lead: Lead; allowed_next: string[];
  activities: { id: string; type: string; outcome?: string; notes: string; next_followup_at?: string; logged_by_name: string; created_at: string; editable: boolean }[];
  timeline: { id: string; type: string; description: string; user_name?: string; created_at: string }[];
  emails: { id: string; trigger_code: string; update_title?: string; status: string; sent_at?: string; queued_at?: string }[];
};

const Kv = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div><div className="k">{k}</div><div className="v">{children || <span className="muted">-</span>}</div></div>
);

// The client's lead detail (S08, legacy/public/js/pages/leads.js detail)
export default function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => { GET<Detail>(`/leads/${id}`).then(setD).catch((e) => setError(e.message)); }, [id]);
  useEffect(reload, [reload]);

  if (error) return <div className="card"><div className="bd"><h2>{error.includes('access') ? 'You do not have access to this record' : 'Not found'}</h2><p className="muted">{error}</p><Link className="btn" href="/leads">Back to leads</Link></div></div>;
  if (!d) return <div className="empty">Loading...</div>;
  const l = d.lead;
  const locked = l.status === 'Converted';
  const canEdit = M.can('leads', 'edit') && !locked;
  const after = (p: Promise<unknown>) => p.then((r) => { if (r) reload(); });

  const quickStatus = async (s: string) => {
    if (!s) return;
    if (s === 'Follow-up') return after(setFollowup(l));
    if (s === 'Not interested') return after(leadForm({ ...l, status: 'Not interested' }, d.allowed_next));
    try { await PUT(`/leads/${l.id}`, { ...l, status: s }); toast(`Status changed to ${s}`, 'ok'); reload(); } catch (e) { toast((e as Error).message, 'err'); }
  };

  return (
    <>
      <div className="page-head">
        <Link className="btn ghost sm" href="/leads">← Leads</Link>
        <div>
          <h1>{l.name} <span className="mono muted" style={{ fontSize: 14 }}>{l.lead_code}</span> <StatusBadge s={l.status} /></h1>
          <div className="sub">Assigned to {l.counsellor} · created {fmtDate(l.created_at)}</div>
        </div>
        <span className="grow" />
        {canEdit ? <>
          <button className="btn" onClick={() => after(logCall(l))}>Log call / note</button>
          <button className="btn" onClick={() => after(setFollowup(l))}>Set follow-up</button>
          <button className="btn" onClick={() => after(leadForm(l, d.allowed_next))}>Edit</button>
        </> : null}
        {M.can('leads', 'delete') && !locked ? <button className="btn danger" onClick={async () => { try { if (await deleteLead(l)) router.push('/leads'); } catch (e) { toast((e as Error).message, 'err'); } }}>Delete</button> : null}
      </div>
      {locked ? <div className="info-box" style={{ marginBottom: 14 }}>This lead has been converted to a student and is locked.</div> : null}
      {l.followup_state === 'overdue' ? <div className="err-box" style={{ marginBottom: 14 }}>Follow-up is overdue.</div>
        : l.followup_state === 'today' ? <div className="warn-box" style={{ marginBottom: 14 }}>Follow-up is due today.</div> : null}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)' }}>
        <div className="stack">
          <div className="card">
            <div className="hd"><h2>Lead details</h2>
              {canEdit && d.allowed_next.length ? <><span className="grow" /><select className="input" style={{ width: 'auto' }} value="" onChange={(e) => quickStatus(e.target.value)}>
                <option value="">Change status...</option><Options list={d.allowed_next.filter((s) => s !== 'Converted')} /></select></> : null}
            </div>
            <div className="bd"><div className="kv">
              <Kv k="Phone">{l.country_code} {l.phone}{l.is_whatsapp ? <span className="wa">WA</span> : null}</Kv>
              <Kv k="Alternate phone">{l.alt_phone}</Kv><Kv k="Email">{l.email}</Kv>
              <Kv k="City">{l.city}</Kv><Kv k="State">{l.state}</Kv>
              <Kv k="Source">{l.source}{l.referred_by ? ` (by ${l.referred_by})` : ''}{l.sub_agent ? ` (${l.sub_agent})` : ''}{l.source_details ? ` (${l.source_details})` : ''}</Kv>
              <Kv k="Interested country">{(l.countries as string[]).join(', ')}</Kv><Kv k="Course / field">{l.course_interest}</Kv><Kv k="Study level">{l.level}</Kv>
              <Kv k="Intake">{l.intake}</Kv><Kv k="Highest qualification">{l.highest_qualification}</Kv><Kv k="Next follow-up">{l.next_followup_at ? fmtDT(l.next_followup_at) : ''}</Kv>
              {l.not_interested_reason ? <Kv k="Not interested reason">{l.not_interested_reason}</Kv> : null}
              <div className="full"><div className="k">Notes <span className="internal-label">Internal</span></div><div className="v" style={{ whiteSpace: 'pre-wrap' }}>{l.notes_internal || '-'}</div></div>
            </div></div>
          </div>
          <div className="card">
            <div className="hd"><h2>Call / notes log</h2><span className="muted small">Newest first</span></div>
            <div className="bd">
              {d.activities.length ? <ul className="tl">{d.activities.map((a) => (
                <li key={a.id}><span className="ic note">{a.type.startsWith('Call') ? '☎' : 'N'}</span>
                  <div className="grow">
                    <div><b>{a.type}</b>{a.outcome ? ` · ${a.outcome}` : ''}</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{a.notes}</div>
                    {a.next_followup_at ? <div className="small muted">Next follow-up: {fmtDT(a.next_followup_at)}</div> : null}
                    <div className="when">{a.logged_by_name} · {fmtDT(a.created_at)}</div>
                  </div>
                  {a.editable ? <button className="btn xs" onClick={() => after(formModal({ title: 'Edit log entry', values: a,
                    fields: [{ k: 'notes', label: 'Notes', type: 'textarea', req: true, col: 6 }, ...(a.type.startsWith('Call') ? [{ k: 'outcome', label: 'Outcome', type: 'select' as const, opts: OUTCOMES, col: 3 }] : [])],
                    save: (v) => PUT(`/leads/${l.id}/activities/${a.id}`, v) }))}>Edit</button> : null}
                </li>
              ))}</ul> : <p className="muted">No calls or notes logged yet.</p>}
            </div>
          </div>
        </div>
        <div className="stack">
          <div className="card"><div className="hd"><h2>Emails to this lead</h2></div><div className="bd">
            {d.emails.length ? <ul className="list-plain">{d.emails.map((e) => (
              <li key={e.id}><span className="mono small">{e.trigger_code}</span><div className="grow">{e.update_title}<div className="small muted">{fmtDT(e.sent_at || e.queued_at)}</div></div><StatusBadge s={e.status} /></li>
            ))}</ul> : <p className="muted">No emails yet.</p>}
          </div></div>
          <div className="card"><div className="hd"><h2>Timeline</h2></div><div className="bd"><ul className="tl">
            {d.timeline.length ? d.timeline.map((t) => (
              <li key={t.id}><span className={`ic ${t.type}`}>{TL_ICON[t.type] || '•'}</span><div><div>{t.description}</div><div className="when">{t.user_name || 'System'} · {fmtDT(t.created_at)}</div></div></li>
            )) : <li className="muted">No entries</li>}
          </ul></div></div>
        </div>
      </div>
    </>
  );
}
