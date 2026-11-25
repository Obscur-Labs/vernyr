'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import http from '@/lib/api';
import { DEL, GET, POST, PUT, ApiError } from '../api';
import { M, useMeta } from '../meta';
import { fmtDT, initials, qs } from '../format';
import { formModal } from '../form';
import { Modal, confirmBox, openOverlay, showError, toast } from '../ui';
import { StatusBadge } from '../badges';
import { TL_ICON } from '../leads';
import { TaskTable, taskForm } from '../tasks';
import { openFile } from '../portalcrm';

/** Student profile tabs from legacy/public/js/pages/students.js: notes, emails, history; plus the student Tasks tab. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
export interface Ctx { s: Any; d: Any; P: Any; reload: () => void }

export function TasksTab({ s, P }: Ctx) {
  const [rows, setRows] = useState<Any[] | null>(null);
  const load = useCallback(async () => { try { setRows((await GET('/tasks' + qs({ student: s.id }))).rows); } catch (e) { showError(e); } }, [s.id]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="card">
      <div className="hd"><h2>Tasks for {s.first_name}</h2><span className="grow" />{P.tasks_edit ? <button className="btn sm primary" onClick={async () => { if (await taskForm({ student_id: s.id })) load(); }}>+ New task</button> : null}</div>
      <div className="bd flush">{rows ? <TaskTable rows={rows} reload={load} /> : <div className="empty">Loading...</div>}</div>
    </div>
  );
}

// ---------- notes: pinned internal notes + comment thread with @mentions ----------
const MENTION = /@\[([^\]]+)\]\(([0-9a-f]{24}|[0-9a-f-]{36})\)/g;
function Body({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION)) { parts.push(text.slice(last, m.index)); parts.push(<span key={m.index} className="mention">@{m[1]}</span>); last = m.index! + m[0].length; }
  parts.push(text.slice(last));
  return <>{parts}</>;
}
export function NotesTab({ s, P }: Ctx) {
  const [d, setD] = useState<Any | null>(null);
  const [pinned, setPinned] = useState('');
  const [txt, setTxt] = useState('');
  const [pin, setPin] = useState(false);
  const [picker, setPicker] = useState<{ q: string; at: number } | null>(null);
  const mentions = useRef(new Map<string, string>());
  const files = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => { try { const x = await GET(`/students/${s.id}/comments`); setD(x); setPinned(x.pinned_notes ?? ''); } catch (e) { showError(e); } }, [s.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [d]);
  if (!d) return <div className="empty">Loading...</div>;
  const users = M.users();
  const onType = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTxt(e.target.value);
    const pos = e.target.selectionStart, m = e.target.value.slice(0, pos).match(/@([\w ]{0,20})$/);
    setPicker(m ? { q: m[1].toLowerCase(), at: pos } : null);
  };
  const choose = (u: { id: string; name: string }) => {
    if (!picker) return;
    const before = txt.slice(0, picker.at).replace(/@([\w ]{0,20})$/, '');
    mentions.current.set(u.name, u.id);
    setTxt(before + '@' + u.name + ' ' + txt.slice(picker.at)); setPicker(null);
  };
  const post = async () => {
    let body = txt.trim();
    if (!body) { toast('Write a comment first', 'err'); return; }
    for (const [name, id] of mentions.current) body = body.split('@' + name).join(`@[${name}](${id})`);
    const fd = new FormData(); fd.append('body', body); fd.append('is_pinned', pin ? '1' : '0');
    const fl = Array.from(files.current?.files ?? []);
    if (fl.length > 5) { toast('Maximum 5 attachments', 'err'); return; }
    for (const f of fl) { if (f.size > 10 * 1024 * 1024) { toast(`${f.name} is larger than 10 MB`, 'err'); return; } fd.append('files', f); }
    try { await http.post(`/students/${s.id}/comments`, fd); setTxt(''); setPin(false); mentions.current.clear(); if (files.current) files.current.value = ''; load(); }
    catch (err) { const r = (err as { response?: { status: number; data: Any } }).response; showError(new ApiError(r?.status ?? 0, r?.data ?? {})); }
  };
  const opts = picker ? users.filter((u) => u.name.toLowerCase().includes(picker.q)).slice(0, 8) : [];
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr)' }}>
      <div className="card"><div className="hd"><h2>Internal notes (pinned)</h2></div><div className="bd">
        <div className="internal-label" style={{ marginBottom: 8 }}>Internal: never emailed, never in any student email</div>
        <textarea className="input" style={{ height: 220, padding: 10 }} disabled={!P.comments_edit} value={pinned} onChange={(e) => setPinned(e.target.value)} />
        {P.comments_edit ? <div className="form-actions"><button className="btn primary" onClick={async () => { try { await PUT(`/students/${s.id}/pinned-notes`, { pinned_notes: pinned }); toast('Notes saved (no email sent)', 'ok'); } catch (e) { showError(e); } }}>Save notes</button></div> : null}
      </div></div>
      <div className="card"><div className="hd"><h2>Comment thread</h2><span className="muted small">Visible to staff with access to this student</span></div><div className="bd">
        <div className="comments" ref={list}>{d.comments.length ? d.comments.map((c: Any) => (
          <div key={c.id} className={`cmt ${c.is_pinned ? 'pinned' : ''}`}><span className="avatar">{initials(c.user_name)}</span><div className="bubble">
            <div className="who">{c.user_name} <span className="muted small">{fmtDT(c.created_at)}{c.edited_at ? ' (edited)' : ''}</span>{c.is_pinned ? <span className="badge orange">Pinned</span> : null}<span className="grow" />
              {!c.deleted && P.comments_edit ? <button className="btn xs ghost" onClick={async () => { await POST(`/students/${s.id}/comments/${c.id}/pin`).catch(showError); load(); }}>{c.is_pinned ? 'Unpin' : 'Pin'}</button> : null}
              {c.can_edit ? <button className="btn xs ghost" onClick={async () => { const r = await formModal({ title: 'Edit comment', fields: [{ k: 'body', label: 'Comment', type: 'textarea', req: true, col: 6, rows: 5 }], values: c, save: (v) => PUT(`/students/${s.id}/comments/${c.id}`, v) }); if (r) load(); }}>Edit</button> : null}
              {c.can_delete ? <button className="btn xs ghost" onClick={async () => { if (await confirmBox('Delete this comment?', { danger: true, ok: 'Delete' })) { try { await DEL(`/students/${s.id}/comments/${c.id}`); load(); } catch (e) { showError(e); } } }}>Delete</button> : null}</div>
            <div className="txt">{c.deleted ? <i className="muted">comment deleted</i> : <Body text={c.body} />}</div>
            {c.attachments?.length ? <div className="row small" style={{ marginTop: 6 }}>{c.attachments.map((a: Any, i: number) => <a key={i} href="#" onClick={(e) => { e.preventDefault(); openFile(a.url); }}>📎 {a.name}</a>)}</div> : null}
          </div></div>
        )) : <div className="empty">No comments yet</div>}</div>
        {P.comments_edit ? (
          <div style={{ marginTop: 12, position: 'relative' }}>
            <div className="internal-label" style={{ marginBottom: 6 }}>Internal: not visible to student</div>
            <textarea className="input" style={{ height: 90, padding: '8px 10px' }} maxLength={3000} placeholder="Write a comment. Type @ to mention a colleague." value={txt} onChange={onType} />
            {opts.length ? <div className="mention-list" style={{ left: 0, bottom: 130 }}>{opts.map((u) => <a key={u.id} href="#" onClick={(e) => { e.preventDefault(); choose(u); }}>{u.name} <span className="muted small">{u.role}</span></a>)}</div> : null}
            <div className="row" style={{ marginTop: 8 }}><input type="file" ref={files} multiple /><label className="row small" style={{ gap: 5 }}><input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} /> Pin</label><span className="grow" /><button className="btn primary" onClick={post}>Post comment</button></div>
          </div>
        ) : null}
      </div></div>
    </div>
  );
}

// ---------- emails ----------
const kv = (k: string, v: React.ReactNode) => <div key={k}><div className="k">{k}</div><div className="v">{v === null || v === undefined || v === '' ? <span className="muted">-</span> : v}</div></div>;
export function EmailsTab({ s }: Ctx) {
  const hardCc = useMeta((x) => x.meta?.settings.hard_cc);
  const [d, setD] = useState<Any | null>(null);
  const load = useCallback(async () => { try { setD(await GET(`/students/${s.id}/emails`)); } catch (e) { showError(e); } }, [s.id]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="empty">Loading...</div>;
  const view = async (id: string) => {
    try {
      const e = await GET(`/students/${s.id}/emails/${id}`);
      openOverlay((close) => (
        <Modal title={e.update_title || 'Email'} size="lg" close={close}>
          <div className="kv small" style={{ marginBottom: 12 }}>
            {kv('From', e.from_addr || '(set when sent)')}{kv('To', e.to_addr)}{kv('CC', `${e.cc_addr} (always)`)}{kv('Reply-To', e.reply_to || '')}{kv('Subject', e.subject)}
            {kv('Status', <StatusBadge s={e.status} />)}{kv('Message-ID', <span className="mono">{e.message_id || ''}</span>)}{kv('In-Reply-To', <span className="mono">{e.in_reply_to || '(thread root)'}</span>)}{kv('Attempts', e.attempts)}
          </div>
          <div className="email-preview"><iframe sandbox="" srcDoc={e.body_html || '<p>Not rendered yet</p>'} style={{ height: 460 }} title="Email" /></div>
        </Modal>
      ));
    } catch (er) { showError(er); }
  };
  const act = (what: 'resend' | 'cancel', id: string) => async () => {
    if (!(await confirmBox(what === 'resend' ? 'Resend this email? A new log entry is created in the same thread.' : 'Cancel this queued email?'))) return;
    try { await POST(`/students/${s.id}/emails/${id}/${what}`); toast(what === 'resend' ? 'Email queued again' : 'Cancelled', 'ok'); load(); } catch (e) { showError(e); }
  };
  return (
    <div className="card">
      <div className="hd"><h2>Email log</h2><span className="muted small">All emails to {s.email} go in one thread. CC {hardCc} (always).</span>
        {d.paused ? <span className="badge orange">Student emails paused</span> : null}{d.email_status === 'Bounced' ? <span className="badge red">Address bounced: correct the email in the Information tab</span> : null}</div>
      <div className="bd flush">{d.rows.length ? (
        <div className="table-wrap"><table className="t cards"><thead><tr><th>Code</th><th>Update title</th><th>To / CC</th><th>Triggered by</th><th>Queued / sent</th><th>Status</th><th>Attempts</th><th /></tr></thead>
          <tbody>{d.rows.map((e: Any) => (
            <tr key={e.id}>
              <td data-label="Code" className="mono">{e.trigger_code}</td>
              <td data-label="Update title">{e.update_title || ''}{e.resend_of ? <> <span className="badge">Resend</span></> : null}{e.error ? <div className="small" style={{ color: 'var(--red)' }}>{e.error}</div> : null}</td>
              <td data-label="To / CC" className="small">{e.to_addr}<br /><span className="muted">CC {e.cc_addr}</span></td>
              <td data-label="Triggered by">{e.triggered_by_name || 'System'}</td>
              <td data-label="Queued / sent" className="small nowrap">{fmtDT(e.queued_at)}<br />{e.sent_at ? fmtDT(e.sent_at) : e.status === 'Queued' ? <span className="muted">sends ~{fmtDT(e.scheduled_at)}</span> : null}</td>
              <td data-label="Status"><StatusBadge s={e.status} /></td><td data-label="Attempts">{e.attempts}</td>
              <td className="nowrap"><button className="btn xs" onClick={() => view(e.id)}>View</button>{' '}
                {['Queued', 'Retrying'].includes(e.status) ? <button className="btn xs" onClick={act('cancel', e.id)}>Cancel</button> : <button className="btn xs" onClick={act('resend', e.id)}>Resend</button>}</td>
            </tr>
          ))}</tbody></table></div>
      ) : <div className="empty">No emails yet</div>}</div>
    </div>
  );
}

// ---------- history (timeline) ----------
const F: [string, string][] = [['', 'All'], ['stages', 'Stages'], ['documents', 'Documents'], ['emails', 'Emails'], ['payments', 'Payments'], ['tasks', 'Tasks'], ['notes', 'Notes']];
export function TimelineTab({ s, type }: Ctx & { type: string }) {
  const [rows, setRows] = useState<Any[] | null>(null);
  useEffect(() => { setRows(null); GET(`/students/${s.id}/timeline` + qs({ type })).then(setRows).catch(showError); }, [s.id, type]);
  return (
    <div className="card">
      <div className="hd"><h2>Timeline</h2><span className="muted small">System generated, cannot be edited</span><span className="grow" />
        <div className="btn-group">{F.map(([k, l]) => <Link key={k} className={`btn sm ${type === k ? 'on' : ''}`} href={`/students/${s.id}/timeline${k ? '?type=' + k : ''}`}>{l}</Link>)}</div></div>
      <div className="bd">{!rows ? <div className="empty">Loading...</div> : rows.length ? (
        <ul className="tl">{rows.map((t, i) => (
          <li key={i}><span className={`ic ${t.type}`}>{TL_ICON[t.type] || '•'}</span>
            <div className="grow"><div>{t.description}{t.from_lead ? <> <span className="badge">Lead</span></> : null}</div><div className="when">{fmtDT(t.created_at)} IST · {t.user_name || 'System'}</div></div></li>
        ))}</ul>
      ) : <div className="empty">No entries</div>}</div>
    </div>
  );
}
