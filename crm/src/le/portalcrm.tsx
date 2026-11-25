'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import http from '@/lib/api';
import { DEL, GET, POST, PUT, ApiError } from './api';
import { M } from './meta';
import { ago, fmtDate, fmtDT, money, qs } from './format';
import { formModal } from './form';
import { Modal, confirmBox, openOverlay, showError, toast } from './ui';

/** The client's CRM side of the student portal (legacy/public/js/pages/portalcrm.js). */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
/** Opens a stored file through the API (`{ url }`: a short signed link), never by its delivery URL. */
export const openFile = async (path: string) => {
  try { const r = path.startsWith('http') ? { url: path } : await GET(path); window.open(r.url, '_blank', 'noopener'); } catch (e) { showError(e); }
};
const upload = async (method: 'post' | 'patch', url: string, fd: FormData) => {
  try { return (await http[method](url, fd)).data; } catch (err) { const r = (err as { response?: { status: number; data: Any } }).response; throw new ApiError(r?.status ?? 0, r?.data ?? { error: 'Network error' }); }
};

// ---------- C1: portal status on the student profile ----------
export function PortalBadge({ s, reload }: { s: Any; reload: () => void }) {
  const [p, setP] = useState<Any | null>(null);
  useEffect(() => { GET(`/students/${s.id}/portal`).then(setP).catch(() => {}); }, [s.id]);
  if (!p) return null;
  const col = ({ Active: 'green', Invited: 'orange', Locked: 'red', 'Not invited': 'grey' } as Any)[p.status] || 'grey';
  return (
    <a href="#" title="Student portal" onClick={(e) => { e.preventDefault(); portalMenu(s, p, reload); }}>
      <span className={`badge ${col}`} title={p.last_login ? 'Last portal login ' + fmtDT(p.last_login) : ''}>Portal: {p.status}{p.status === 'Active' && p.completion !== null && p.completion !== undefined ? ` · ${p.completion}%` : ''}</span>
    </a>
  );
}
function portalMenu(s: Any, info: Any, reload: () => void) {
  openOverlay((close) => {
    const invite = async () => {
      try {
        const r = await POST(`/students/${s.id}/portal-invite`);
        close(); toast('Invite email E26 queued (same thread, CC applies). The student needs an OTP to activate.', 'ok');
        if (r.link) openOverlay((c2) => <Modal title="Invite link (sandbox only)" close={c2}><p className="small">Email is in sandbox mode, so here is the link for testing:</p><p className="mono small" style={{ wordBreak: 'break-all' }}>{r.link}</p></Modal>);
        reload();
      } catch (e) { showError(e); }
    };
    const preview = async () => { try { const r = await POST(`/students/${s.id}/portal-preview`); close(); window.open(r.url, '_blank', 'noopener'); } catch (e) { showError(e); } };
    return (
      <Modal title="Student portal" size="sm" close={close} foot={<>
        {info.status !== 'Active' ? <button className="btn primary" onClick={invite}>{info.status === 'Invited' ? 'Resend invite' : 'Invite to student portal'}</button> : null}
        {info.status === 'Active' || info.status === 'Locked' ? <button className="btn" onClick={preview}>View as student</button> : null}
        <button className="btn" onClick={close}>Close</button>
      </>}>
        <div className="kv small">
          <div><div className="k">Status</div><div className="v">{info.status}</div></div>
          <div><div className="k">Last portal login</div><div className="v">{info.last_login ? fmtDT(info.last_login) : '-'}</div></div>
          <div><div className="k">Profile completion</div><div className="v">{info.completion ?? '-'}%</div></div>
          <div><div className="k">Wizard submitted</div><div className="v">{info.profile_submitted_at ? fmtDT(info.profile_submitted_at) : 'No'}</div></div>
          <div><div className="k">Email / mobile verified</div><div className="v">{info.email_verified ? 'Yes' : 'No'} / {info.mobile_verified ? 'Yes' : 'No'}</div></div>
          {info.invite_expires_at ? <div><div className="k">Invite valid until</div><div className="v">{fmtDT(info.invite_expires_at)}</div></div> : null}
        </div>
      </Modal>
    );
  });
}

// ---------- C2: Apply Now requests ----------
const REQ_COL: Record<string, string> = { 'Requested by student': 'orange', 'In review': 'blue', 'Info needed': 'purple', Accepted: 'green', Declined: 'grey', 'Cancelled by student': 'grey', Expired: 'grey' };
export const ReqBadge = ({ s }: { s: string }) => <span className={`badge ${REQ_COL[s] || ''}`}>{s}</span>;
export const REQ_STATUSES = ['Requested by student', 'In review', 'Info needed', 'Accepted', 'Declined', 'Cancelled by student', 'Expired'];
export async function requestDetail(id: string, reload?: () => void) {
  let r: Any;
  try { r = await GET('/portal-requests/' + id); } catch (e) { showError(e); return; }
  const open = ['Requested by student', 'In review', 'Info needed'].includes(r.status);
  openOverlay((close) => {
    const accept = async () => {
      if (!(await confirmBox(<>Create an application for <b>{r.university}</b>, {r.course} ({r.intake})? It starts at Documents pending and the student gets email E05 with the missing documents.</>, { ok: 'Create application' }))) return;
      try { await POST(`/portal-requests/${r.id}/accept`); toast('Application created from the request', 'ok'); close(); reload?.(); } catch (e) { showError(e); }
    };
    const decline = async () => {
      const x = await formModal({ title: 'Decline request', size: 'sm', saveLabel: 'Decline and email E24', values: {}, save: (v) => POST(`/portal-requests/${r.id}/decline`, v),
        fields: [{ k: 'reason', label: 'Reason for the student', type: 'select', req: true, opts: ['Not eligible for this course', 'Deadline too close', 'Better options suggested', 'Duplicate', 'Other'], col: 6 },
          { k: 'text', label: 'Details for the student', type: 'textarea', col: 6 }, { k: 'internal_note', label: 'Internal note (never shown)', type: 'textarea', col: 6 }] });
      if (x) { toast('Request declined', 'ok'); close(); reload?.(); }
    };
    const ask = async () => {
      const x = await formModal({ title: 'Ask the student', size: 'sm', saveLabel: 'Send', values: {}, save: (v) => POST(`/portal-requests/${r.id}/ask`, v),
        fields: [{ k: 'message', label: 'Your question (sent in chat with the request attached)', type: 'textarea', req: true, col: 6 }] });
      if (x) { toast('Question sent. Status: Info needed', 'ok'); close(); reload?.(); }
    };
    return (
      <Modal title={`${r.code}: ${r.course}`} size="lg" close={close} foot={open ? <>
        <button className="btn" onClick={ask}>Ask student</button><button className="btn danger" onClick={decline}>Decline</button>
        <button className="btn primary" disabled={r.is_lead} title={r.is_lead ? 'Convert the lead to a student first' : ''} onClick={accept}>Accept and create application</button>
      </> : undefined}>
        <div className="row" style={{ marginBottom: 10 }}><ReqBadge s={r.status} /><b>{r.student_name}</b><span className="mono small muted">{r.student_code}</span>
          {r.student_id ? <Link className="small" href={`/students/${r.student_id}`} onClick={close}>Open student</Link> : r.lead_id ? <Link className="small" href={`/leads/${r.lead_id}`} onClick={close}>Open lead</Link> : null}</div>
        <div className="kv">
          <div><div className="k">University</div><div className="v">{r.university}</div></div><div><div className="k">Country / level</div><div className="v">{r.country} · {r.level}</div></div>
          <div><div className="k">Intake / deadline</div><div className="v">{r.intake} · {fmtDate(r.deadline)}</div></div><div><div className="k">Eligibility hint (at request)</div><div className="v">{r.eligibility || '-'}</div></div>
          <div><div className="k">Source</div><div className="v">{r.source_screen || ''}</div></div><div><div className="k">Requested</div><div className="v">{fmtDT(r.requested_at)}</div></div>
          <div className="full"><div className="k">Message from student</div><div className="v">{r.message || '-'}</div></div>
          <div className="full"><div className="k">Missing documents at request time</div><div className="v">{(r.missing ?? []).join(', ') || 'None'}</div></div>
          {r.summary ? <div className="full"><div className="k">Mini assessment</div><div className="summary-line">{r.summary}</div></div> : null}
          {r.warnings?.length ? <div className="full"><div className="k">Warnings (internal)</div>{r.warnings.map((w: Any, i: number) => <div key={i} className={`flag ${w.level}`} style={{ margin: '3px 0' }}>⚑ {w.text}</div>)}</div> : null}
          {r.decline_reason ? <div className="full"><div className="k">Decline reason</div><div className="v">{r.decline_reason}</div></div> : null}
          {r.internal_note ? <div className="full"><div className="k">Internal note</div><div className="v">{r.internal_note}</div></div> : null}
          {r.application_id ? <div className="full"><Link href={`/students/${r.student_id}/applications`} onClick={close}>View the application</Link></div> : null}
        </div>
      </Modal>
    );
  });
}
export function StudentRequests({ s }: { s: Any }) {
  const [d, setD] = useState<{ rows: Any[]; saved: Any[] } | null>(null);
  const load = useCallback(async () => {
    try { const [r, saved] = await Promise.all([GET('/portal-requests' + qs({ student: s.id, status: '' })), GET(`/students/${s.id}/saved-courses`)]); setD({ rows: r.rows, saved }); } catch (e) { showError(e); }
  }, [s.id]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="empty">Loading...</div>;
  const add = async (courseId: string) => {
    const r = await formModal({ title: 'Add to shortlist (status Student agreed)', size: 'sm', values: {}, fields: [{ k: 'intake_id', label: 'Intake', type: 'select', req: true, opts: M.intakes(), col: 6 }],
      save: (v) => POST(`/students/${s.id}/saved-courses/${courseId}/add`, v) });
    if (r) { toast('Added to shortlist', 'ok'); load(); }
  };
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}><div className="hd"><h2>Apply Now requests</h2><span className="muted small">From the student portal</span></div><div className="bd flush">
        {d.rows.length ? <table className="t cards"><thead><tr><th>Request</th><th>University / course</th><th>Intake</th><th>Eligibility</th><th>Status</th><th>Requested</th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.id} className="click" onClick={() => requestDetail(r.id, load)}><td className="mono">{r.code}</td><td><b>{r.university}</b><div className="small">{r.course}</div></td><td>{r.intake}</td><td>{r.eligibility || ''}</td><td><ReqBadge s={r.status} /></td><td>{ago(r.requested_at)}</td></tr>)}</tbody></table>
          : <div className="empty">No requests</div>}
      </div></div>
      <div className="card"><div className="hd"><h2>Saved by student</h2><span className="muted small">Courses the student hearted in Course Search</span></div><div className="bd flush">
        {d.saved.length ? <table className="t"><thead><tr><th>Course</th><th>University</th><th>Country</th><th>Tuition</th><th>Saved</th><th /></tr></thead>
          <tbody>{d.saved.map((c) => <tr key={c.course_id}><td>{c.name} <span className="badge">{c.level || ''}</span></td><td>{c.university}</td><td>{c.country}</td><td>{money(c.tuition_fee, c.currency)}</td><td>{ago(c.saved_at)}</td>
            <td>{c.in_shortlist ? <span className="badge green">In shortlist</span> : <button className="btn xs" onClick={() => add(c.course_id)}>Add to shortlist</button>}</td></tr>)}</tbody></table>
          : <div className="empty">Nothing saved yet</div>}
      </div></div>
    </>
  );
}

// ---------- C3: chat with the student ----------
function Msg({ m, d, reload }: { m: Any; d: Any; reload: () => void }) {
  if (m.sender_type === 'system') return <div className="cm-sys">{m.body}</div>;
  const edit = async () => { const r = await formModal({ title: 'Edit message', fields: [{ k: 'body', label: 'Message', type: 'textarea', col: 6 }], values: m, save: async (v) => { try { return (await http.patch(`/chat/messages/${m.id}`, v)).data; } catch (err) { const x = (err as { response?: { status: number; data: Any } }).response; throw new ApiError(x?.status ?? 0, x?.data ?? {}); } } }); if (r) reload(); };
  const del = async () => { if (await confirmBox('Delete this message?', { danger: true, ok: 'Delete' })) { try { await DEL(`/chat/messages/${m.id}`); reload(); } catch (e) { showError(e); } } };
  const report = async () => { if (await confirmBox('Report this message to Admin?')) { try { await POST(`/chat/messages/${m.id}/report`); toast('Reported', 'ok'); } catch (e) { showError(e); } } };
  const save = async (aid: string) => {
    const r = await formModal({ title: 'Save chat file to documents', size: 'sm', values: {}, save: (v) => POST(`/chat/attachments/${aid}/save`, v),
      fields: [{ k: 'document_type_id', label: 'Document type', type: 'select', req: true, opts: M.list('document_type'), col: 6 }, { k: 'title', label: 'Title (for Others)', col: 6 }] });
    if (r) { toast('Saved as a new document version (status Uploaded)', 'ok'); reload(); }
  };
  void d;
  return (
    <div className={`cm ${m.sender_type === 'student' ? '' : 'me'}`}>
      <div className="who">{m.sender_type === 'student' ? 'Student' : m.sender_name} <span className="muted">{fmtDT(m.sent_at)}</span>{m.edited ? <span className="muted"> (edited)</span> : null}
        {m.sender_type === 'staff' ? <span className="muted"> · {m.read_at ? 'read ' + fmtDT(m.read_at) : m.delivered_at ? 'delivered' : 'sent'}</span> : null}</div>
      {m.context ? <div className="small" style={{ borderLeft: '3px solid var(--brand-2)', paddingLeft: 6, margin: '3px 0' }}>{m.context.title}<br /><span className="muted">{m.context.sub || ''}</span></div> : null}
      <div className="txt">{m.deleted ? <i className="muted">message deleted</i> : m.body || ''}</div>
      {(m.attachments ?? []).map((a: Any) => (
        <div key={a.id} className="small">📎 <a href="#" onClick={(e) => { e.preventDefault(); openFile(a.url); }}>{a.name}</a>
          {m.sender_type === 'student' && !a.saved ? <> <button className="btn xs" onClick={() => save(a.id)}>Save to documents</button></> : a.saved ? <> <span className="badge green">saved</span></> : null}</div>
      ))}
      <div className="row" style={{ gap: 4, marginTop: 2 }}>
        {m.can_edit ? <><button className="btn xs ghost" onClick={edit}>Edit</button><button className="btn xs ghost" onClick={del}>Delete</button></> : null}
        {m.sender_type === 'student' && !m.deleted ? <button className="btn xs ghost" onClick={report}>Report</button> : null}
      </div>
    </div>
  );
}

export function ChatPanel({ base }: { base: string }) {
  const [d, setD] = useState<Any | null>(null);
  const [txt, setTxt] = useState('');
  const files = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => { try { setD(await GET(base)); } catch (e) { showError(e); } }, [base]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [d]);
  if (!d) return <div className="empty">Loading...</div>;
  const send = async () => {
    const fd = new FormData(); fd.append('body', txt);
    for (const f of Array.from(files.current?.files ?? [])) fd.append('files', f);
    try { await upload('post', base, fd); setTxt(''); if (files.current) files.current.value = ''; load(); } catch (e) { showError(e); }
  };
  const editQuick = async () => {
    const r = await formModal({ title: 'My quick replies', values: { items: d.quick_replies.join('\n') }, fields: [{ k: 'items', label: 'One reply per line', type: 'textarea', rows: 8, col: 6 }],
      save: (v) => PUT('/chat/quick-replies', { items: String(v.items || '').split('\n') }) });
    if (r) load();
  };
  return (
    <div className="card">
      <div className="hd"><h2>Chat with student</h2><span className="badge green">Visible to student</span><span className="muted small">Separate from internal notes</span><span className="grow" /><span className="small">Portal: {d.portal?.status}</span></div>
      <div className="bd">
        <div className="comments" ref={box} style={{ maxHeight: 460 }}>{d.rows.length ? d.rows.map((m: Any) => <Msg key={m.id} m={m} d={d} reload={load} />) : <div className="empty">No messages yet</div>}</div>
        {d.can_reply ? (
          <div style={{ marginTop: 10 }}>
            <div className="row" style={{ marginBottom: 6 }}>{(d.quick_replies ?? []).map((q: string, i: number) => <button key={i} className="btn xs" onClick={() => setTxt(q)}>{q.slice(0, 30)}</button>)}<button className="btn xs ghost" onClick={editQuick}>Edit quick replies</button></div>
            <textarea className="input" style={{ height: 80, padding: '8px 10px' }} maxLength={2000} placeholder="Message to the student (visible to the student)" value={txt} onChange={(e) => setTxt(e.target.value)} />
            <div className="row" style={{ marginTop: 6 }}><input type="file" ref={files} multiple /><span className="grow" /><button className="btn primary" onClick={send}>Send</button></div>
          </div>
        ) : <p className="small muted">You can read this chat. Replying is limited to the primary counsellor (Admin setting &quot;Team can reply in chat&quot;).</p>}
      </div>
    </div>
  );
}

// ---------- C4: profile change requests ----------
const fmtV = (v: unknown) => (v === null || v === undefined ? '-' : typeof v === 'object' ? Object.entries(v as Any).filter(([, x]) => x !== null && x !== '').map(([k, x]) => `${k}: ${x}`).join(', ') : String(v));
const CR_COL: Record<string, string> = { Pending: 'grey', Approved: 'green', Rejected: 'red' };
export function ChangeRequests({ s, reload }: { s: Any; reload: () => void }) {
  const [d, setD] = useState<Any | null>(null);
  useEffect(() => { GET(`/students/${s.id}/change-requests`).then(setD).catch(showError); }, [s.id]);
  if (!d) return <div className="empty">Loading...</div>;
  const ok = async (id: string) => { if (await confirmBox('Approve and apply this change? The student gets email E22.')) { try { await POST(`/change-requests/${id}/approve`); toast('Change applied', 'ok'); reload(); } catch (e) { showError(e); } } };
  const no = async (id: string) => {
    const r = await confirmBox('Reject this change request? The student sees the reason and gets email E25.', { reason: true, reasonLabel: 'Reason (shown to the student)', danger: true, ok: 'Reject' });
    if (r) { try { await POST(`/change-requests/${id}/reject`, { reason: r }); reload(); } catch (e) { showError(e); } }
  };
  return (
    <div className="card"><div className="hd"><h2>Profile change requests</h2><span className="muted small">Locked fields the student asked to change in the portal</span></div><div className="bd flush">
      {d.applied_count ? <div className="warn-box" style={{ margin: 12 }}>This student has {d.applied_count} application(s) already submitted with the old values. Please inform the universities if needed.</div> : null}
      {d.rows.length ? <table className="t cards"><thead><tr><th>Field</th><th>Current</th><th>Requested</th><th>Reason</th><th>Status</th><th /></tr></thead><tbody>{d.rows.map((c: Any) => (
        <tr key={c.id} className={c.overdue ? 'overdue' : ''}>
          <td data-label="Field"><b>{c.field_label}</b><div className="small muted">{ago(c.created_at)}</div></td><td data-label="Current">{fmtV(c.old_value)}</td><td data-label="Requested"><b>{fmtV(c.new_value)}</b></td>
          <td data-label="Reason">{c.reason || ''}{c.file_url ? <div><a className="small" href="#" onClick={(e) => { e.preventDefault(); openFile(c.file_url); }}>Supporting file</a></div> : null}</td>
          <td data-label="Status"><span className={`badge ${CR_COL[c.status] ?? 'grey'}`}>{c.status}</span>{c.reject_reason ? <div className="small">{c.reject_reason}</div> : null}{c.reviewed_by_name ? <div className="small muted">{c.reviewed_by_name}</div> : null}</td>
          <td className="nowrap">{c.status === 'Pending' ? <><button className="btn xs primary" onClick={() => ok(c.id)}>Approve</button> <button className="btn xs danger" onClick={() => no(c.id)}>Reject</button></> : null}</td>
        </tr>
      ))}</tbody></table> : <div className="empty">No change requests</div>}
    </div></div>
  );
}
