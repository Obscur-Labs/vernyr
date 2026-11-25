'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GET, POST, download } from '../api';
import { M } from '../meta';
import { fmtDT, initials } from '../format';
import { formModal } from '../form';
import { confirmBox, showError, toast } from '../ui';
import { StatusBadge } from '../badges';
import { taskForm } from '../tasks';
import { PortalBadge } from '../portalcrm';
import type { Ctx } from './tabs';

/** The client's student profile frame (legacy/public/js/pages/students.js profile): header, quick actions, tabs. */

/* eslint-disable @typescript-eslint/no-explicit-any */
export const STUDENT_STATUSES = ['Active', 'On hold', 'Dropped', 'Enrolled', 'Archived'];
// the same order and names as the student portal; Personal, Academic, English and Family are inside the one Information form
export const TABS: [string, string][] = [['info', 'Information'], ['shortlist', 'Shortlist'], ['applications', 'Applications & Visa'], ['documents', 'Documents'], ['fees', 'Payments'],
  ['tasks', 'Tasks'], ['chat', 'Chat'], ['requests', 'Requests'], ['notes', 'Notes'], ['emails', 'Emails'], ['timeline', 'History']];
export const normTab = (t?: string) => (t === 'visa' ? 'applications' : ['personal', 'academic', 'english', 'family'].includes(t ?? '') ? 'info' : t === 'changes' ? 'requests' : t || 'info');

function MoreMenu({ ctx, close }: { ctx: Ctx; close: () => void }) {
  const { s, P } = ctx;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    setTimeout(() => document.addEventListener('click', off), 0);
    return () => document.removeEventListener('click', off);
  }, [close]);
  const status = async (st: string) => {
    close();
    const r = ['On hold', 'Dropped'].includes(st) ? await confirmBox(`Mark ${s.first_name} as ${st}?`, { reason: true }) : await confirmBox(`Mark ${s.first_name} as ${st}?`);
    if (!r) return;
    try { await POST(`/students/${s.id}/status`, { status: st, reason: typeof r === 'string' ? r : null }); toast('Status updated', 'ok'); ctx.reload(); } catch (e) { showError(e); }
  };
  const pause = async () => {
    close();
    const r = await confirmBox(s.emails_paused ? 'Resume automatic emails to this student? (CC still applies)' : 'Pause ALL automatic emails to this student?', { reason: true });
    if (r) { try { await POST(`/students/${s.id}/pause-emails`, { paused: !s.emails_paused, reason: r }); toast('Saved', 'ok'); ctx.reload(); } catch (e) { showError(e); } }
  };
  return (
    <div className="menu pop" style={{ top: 36 }} ref={ref}>
      <button onClick={() => { close(); download(`/students/${s.id}/summary.pdf`, `${s.student_code}_profile_summary.pdf`, true).catch(showError); }}>Print / download profile summary (PDF)</button>
      {P.profile_edit ? <>
        <button onClick={() => status('On hold')}>Mark On hold</button><button onClick={() => status('Dropped')}>Mark Dropped</button>
        {s.status !== 'Active' ? <button onClick={() => status('Active')}>Mark Active</button> : null}
      </> : null}
      {P.admin ? <>
        <button onClick={() => { close(); transferDialog(ctx); }}>Transfer / assign team</button>
        <button onClick={pause}>{s.emails_paused ? 'Resume' : 'Pause'} student emails</button>
        {s.status !== 'Archived' ? <button onClick={() => status('Archived')}>Archive</button> : null}
      </> : null}
    </div>
  );
}
async function transferDialog(ctx: Ctx) {
  const { s, d } = ctx;
  const r = await formModal({
    title: 'Transfer / assign', values: { role_type: 'primary', transfer_tasks: true }, save: (v) => POST(`/students/${s.id}/transfer`, v),
    fields: [
      { k: 'role_type', label: 'Assignment', type: 'select', noBlank: true, opts: [['primary', 'Counsellor (admission + visa, start to end)']], col: 3 },
      { k: 'to_user_id', label: 'New user', type: 'select', opts: () => M.users(['counsellor', 'manager', 'admin']).map((u) => [u.id, `${u.name} (${u.role})`] as [string, string]), col: 3, help: 'One counsellor handles the student from the first contact to the end' },
      { k: 'reason', label: 'Reason', type: 'textarea', col: 6, req: true }, { k: 'transfer_tasks', label: 'Also transfer open tasks', type: 'checkbox', col: 6 },
      { k: 'h', type: 'html', html: () => <><h4>Assignment history</h4><ul className="list-plain small">{d.assignment_history.length ? d.assignment_history.map((x: any) => (
        <li key={x.id}>{fmtDT(x.created_at)}: {x.role_type} {x.from || '-'} → {x.to || '-'} by {x.by} {x.reason ? `(${x.reason})` : ''}</li>
      )) : <li className="muted">None</li>}</ul></> },
    ],
  });
  if (r) { toast('Saved. Notifications sent.', 'ok'); ctx.reload(); }
}

export function StudentFrame({ id, tab, children }: { id: string; tab: string; children: (ctx: Ctx) => React.ReactNode }) {
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);
  const load = useCallback(async () => { try { setD(await GET('/students/' + id)); } catch (e) { setError((e as Error).message); } }, [id]);
  useEffect(() => { load(); }, [load]);
  if (error) return <div className="empty">{error}</div>;
  if (!d) return <div className="empty">Loading...</div>;
  const s = d.student, h = d.header, P = d.perms;
  const ctx: Ctx = { s, d, P, reload: load };
  const tabs = TABS.filter(([k]) => k !== 'fees' || P.fees_view);
  const cur = tabs.find((t) => t[0] === tab) ? tab : 'info';
  const badgeN: Record<string, number> = { shortlist: d.counts.shortlist, applications: d.counts.applications, documents: d.counts.documents, tasks: d.counts.tasks, notes: d.counts.comments, emails: d.counts.emails_failed };
  const pdf = (path: string, name: string) => (e: React.MouseEvent) => { e.preventDefault(); download(`/students/${s.id}/${path}`, name).catch(showError); };
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="s-head">
          <span className="avatar lg">{initials(s.first_name + ' ' + (s.last_name || ''))}</span>
          <div className="who">
            <h1>{[s.first_name, s.middle_name, s.last_name].filter(Boolean).join(' ')} <span className="mono muted" style={{ fontSize: 14 }}>{s.student_code}</span>{' '}
              <span className="badge blue" style={{ fontSize: 12.5 }}>{h.stage}</span>{s.status !== 'Active' ? <StatusBadge s={s.status} /> : null}
              {d.counts.emails_failed ? <Link href={`/students/${s.id}/emails`} className="badge red" title="Email failed">✉ failed</Link> : null}{' '}
              <PortalBadge s={s} reload={load} /></h1>
            <div className="meta">
              <span>☎ {s.country_code} {s.phone}{s.whatsapp ? <span className="wa">WA</span> : null}</span>
              <span>✉ {s.email} {s.email_status === 'Bounced' ? <span className="badge red">Bounced</span> : null}</span>
              {h.countries.map((c: any) => <span key={c.name} className="country-pill"><i>{c.code || ''}</i>{c.name}</span>)}
              {h.intake ? <span className="badge">{h.intake}</span> : null}
            </div>
          </div>
          <div className="team">
            <span>Counsellor (start to end)</span><b>{h.counsellor || '-'}</b>
            {s.managed_by_agency ? <><span>Managed by</span><b><span className="badge purple">{M.list('sub_agent').find((x) => x.id === s.managed_by_agency)?.name || 'Partner agency'}</span></b></> : null}
            <span>Consent</span>
            <b><a href="#" onClick={pdf('consent-certificate.pdf', `signed-consent-${s.student_code}.pdf`)} title="Consent the student signed in the portal: IP, device, time and typed signature">⬇ Signed consent PDF</a>
              {M.admin() || M.manager() ? <> <a href="#" onClick={pdf('evidence-certificate.pdf', `court-certificate-${s.student_code}.pdf`)} title="Certificate to produce the signed consent in an Indian court (BSA 2023 s.63)">⚖ Court certificate</a></> : null}</b>
            <span>Record</span><b><a href="#" onClick={pdf('full-record.pdf', `full-record-${s.student_code}.pdf`)}>⬇ Full record PDF</a></b>
          </div>
          <div className="quick" style={{ position: 'relative' }}>
            {P.tasks_edit ? <button className="btn sm" onClick={async () => { if (await taskForm({ student_id: s.id })) load(); }}>+ Task</button> : null}
            {P.comments_edit ? <button className="btn sm" onClick={() => router.push(`/students/${s.id}/notes`)}>+ Note</button> : null}
            {P.documents_edit ? <button className="btn sm" onClick={() => router.push(`/students/${s.id}/documents?upload=1`)}>Upload document</button> : null}
            {P.applications_edit ? <button className="btn sm" onClick={() => router.push(`/students/${s.id}/applications?new=1`)}>+ Application</button> : null}
            <button className="btn sm" onClick={(e) => { e.stopPropagation(); setMore(!more); }}>More ▾</button>
            {more ? <MoreMenu ctx={ctx} close={() => setMore(false)} /> : null}
          </div>
        </div>
        {h.warnings.length ? <div className="s-flags">{h.warnings.map((w: any, i: number) => <span key={i} className={`flag ${w.level}`}>⚑ {w.text}</span>)}</div> : null}
        <div className="tabs" style={{ padding: '0 10px' }}>{tabs.map(([k, l]) => (
          <Link key={k} href={`/students/${s.id}/${k}`} className={k === cur ? 'on' : ''}>{l}{badgeN[k] ? <> <span className={`n ${k === 'emails' ? 'red' : ''}`}>{badgeN[k]}</span></> : null}</Link>
        ))}</div>
      </div>
      {children(ctx)}
    </>
  );
}
