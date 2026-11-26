'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { DEL, GET, POST, PUT, SEND, download, openFrom, openUrl } from './api';
import { ago, fmtDT, fmtDate, money, qs } from './format';
import { formModal, toFormData, Options, type Field, type Vals } from './form';
import { confirmBox, showError, toast } from './ui';
import { InfoForm } from './InfoForm';
import { OneClick, StudentTab } from './direct';
import { Page, UStatus, canAct, useGo, useLoad, useQ, useMe, type Any } from './u';

/** The client's applications screens (legacy/public/university/js/apps.js): UP04 dashboard, UP09 inbox, UP10 detail, UP12 action dialogs, UP11 messages. */

const LEVELS = ['Bachelor', 'Master', 'MBA', 'PhD', 'Diploma', 'Foundation', 'Language course'];
const COL: Record<string, string> = { New: 'var(--sky)', Acknowledged: 'var(--indigo)', 'Documents requested': 'var(--warning)', 'Under assessment': 'var(--violet)', 'Interview scheduled': 'var(--royal)', Waitlisted: 'var(--line-2)',
  'Conditional offer': 'var(--warning-ink)', 'Unconditional offer': 'var(--teal)', Rejected: 'var(--error)', 'Offer accepted': 'var(--success-ink)', 'Deposit received': 'var(--info)', Enrolled: 'var(--ink-2)', Withdrawn: 'var(--line)' };
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

// ---------- dashboard ----------
export function Dashboard() {
  const q = useQ(); const go = useGo();
  const st = useLoad(() => GET('/dashboard' + qs(q)), [JSON.stringify(q)]);
  const setF = (k: string, v: string) => go('/dashboard' + qs({ ...q, [k]: v }));
  return <Page state={st}>{() => { const d = st.data as Any;
    const maxI = Math.max(1, ...Object.values(d.intakes as Record<string, Record<string, number>>).map(sum));
    const fmax = Math.max(1, ...d.funnel.map((f: Any) => f.count));
    const withdrawn = d.cards.find((c: Any) => c.key === 'withdrawn');
    return (<>
      <div className="page-head"><h1>Dashboard</h1><span className="grow" /><span className="small muted">Applications La Europa submitted to you</span></div>
      <form className="filters" onSubmit={(e) => e.preventDefault()}>
        <select value={q.intake || ''} onChange={(e) => setF('intake', e.target.value)}><option value="">All intakes</option><Options list={d.filters.intakes} /></select>
        <select value={q.course || ''} onChange={(e) => setF('course', e.target.value)}><option value="">All courses</option><Options list={d.filters.courses.map((c: Any) => [c.id, c.name])} /></select>
        <select value={q.level || ''} onChange={(e) => setF('level', e.target.value)}><option value="">All levels</option><Options list={LEVELS} /></select>
        {d.filters.campuses.length > 1 ? <select value={q.campus || ''} onChange={(e) => setF('campus', e.target.value)}><option value="">All campuses</option><Options list={d.filters.campuses} /></select> : null}
        <input type="date" value={q.from || ''} title="Submitted from" onChange={(e) => setF('from', e.target.value)} />
        <input type="date" value={q.to || ''} title="Submitted to" onChange={(e) => setF('to', e.target.value)} />
      </form>
      <div className="stats uni-stats">{d.cards.filter((c: Any) => c.key !== 'withdrawn').map((c: Any) => (
        <Link key={c.key} className="stat" href={'/applications' + qs({ status: c.statuses.join(','), intake: q.intake, course: q.course })}>
          <div className="lbl">{c.label}</div><div className="val">{c.count}</div><div className={`chg ${c.week ? 'up' : ''}`}>+{c.week} this week</div>
        </Link>))}</div>
      <div className="small muted" style={{ margin: '6px 0 14px' }}>Withdrawn: {withdrawn?.count ?? 0} (not counted above)</div>
      <div className="grid uni-dash"><div className="grid" style={{ gap: 14 }}>
        <div className="card"><div className="hd"><h2>Applications by intake</h2></div><div className="bd">
          {Object.keys(d.intakes).length ? <>
            {Object.entries(d.intakes as Record<string, Record<string, number>>).map(([k, o]) => { const tot = sum(o); return (
              <div key={k} className="sbar"><span className="sl">{k}</span>
                <div className="st" style={{ width: `${(tot / maxI) * 100}%` }}>{Object.entries(o).map(([s, n]) => <Link key={s} href={'/applications' + qs({ status: s })} title={`${s}: ${n}`} style={{ flex: n, background: COL[s] || 'var(--muted)' }} />)}</div>
                <b className="small">{tot}</b></div>); })}
            <div className="legend">{Object.entries(COL).map(([s, c]) => <span key={s}><i style={{ background: c }} />{s}</span>)}</div>
          </> : <div className="empty">No applications yet</div>}
        </div></div>
        <div className="card"><div className="hd"><h2>Conversion funnel</h2>{d.decision_days !== null ? <><span className="grow" /><span className="small muted">Average {d.decision_days} days to first decision</span></> : null}</div><div className="bd">
          {d.funnel.map((f: Any, i: number) => <div key={f.label} className="fun"><span>{f.label}</span><div><i style={{ width: `${(f.count / fmax) * 100}%` }} /></div><b>{f.count}</b><small>{i && d.funnel[0].count ? Math.round((f.count / d.funnel[0].count) * 100) + '%' : ''}</small></div>)}
        </div></div>
        <div className="grid two">
          <div className="card"><div className="hd"><h2>Students by state (India)</h2></div><div className="bd flush"><table className="tbl"><tbody>
            {d.states.length ? d.states.map((s: Any) => <tr key={s.state}><td>{s.state}</td><td className="right"><b>{s.count}</b></td></tr>) : <tr><td className="empty">-</td></tr>}</tbody></table></div></div>
          <div className="card"><div className="hd"><h2>Top courses</h2></div><div className="bd flush"><table className="tbl"><tbody>
            {d.top_courses.length ? d.top_courses.map((s: Any) => <tr key={s.course}><td>{s.course}</td><td className="right"><b>{s.count}</b></td></tr>) : <tr><td className="empty">-</td></tr>}</tbody></table></div></div>
        </div>
      </div>
      <div className="card"><div className="hd"><h2>Pending actions</h2></div><div className="bd flush">
        {d.pending.length ? d.pending.map((p: Any) => <Link key={p.label} className={`pend ${p.red ? 'red' : ''}`} href={p.link}>{p.label}<span>›</span></Link>) : <div className="empty">Nothing waiting. Well done!</div>}
      </div></div></div>
    </>); }}</Page>;
}

// ---------- inbox ----------
export function Inbox() {
  const q = useQ(); const go = useGo();
  const st = useLoad(async () => ({ d: await GET('/applications' + qs(q)), f: await GET('/dashboard') }), [JSON.stringify(q)]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(q.q || '');
  const setQ = (p: Record<string, unknown>) => go('/applications' + qs({ ...q, ...p }));
  const act = canAct();
  return <Page state={st}>{() => { const { d, f } = st.data as Any;
    const selectable = d.rows.filter((x: Any) => x.status === 'New').map((x: Any) => x.id);
    const toggle = (id: string, on: boolean) => setSel((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
    return (<>
      <div className="page-head"><h1>Applications</h1><span className="muted small">{d.total} application(s)</span><span className="grow" />
        {act ? <button className="btn" disabled={!sel.size} onClick={async () => { try { const r = await POST('/applications/bulk-acknowledge', { ids: [...sel] }); toast(`${r.count} acknowledged`, 'ok'); setSel(new Set()); st.reload(); } catch (e) { showError(e); } }}>Acknowledge selected{sel.size ? ` (${sel.size})` : ''}</button> : null}
        <button className="btn" onClick={() => download('/applications/export.xlsx' + qs({ ...q, ids: sel.size ? [...sel].join(',') : '' }), 'applications.xlsx').catch(showError)}>Export (Excel)</button></div>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setQ({ q: search, page: '' }); }}>
        <input type="search" placeholder="Student, application ID or your reference" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={q.status || ''} onChange={(e) => setQ({ status: e.target.value, page: '' })}><option value="">All statuses</option><Options list={d.statuses} /></select>
        <select value={q.intake || ''} onChange={(e) => setQ({ intake: e.target.value, page: '' })}><option value="">All intakes</option><Options list={f.filters.intakes} /></select>
        <select value={q.course || ''} onChange={(e) => setQ({ course: e.target.value, page: '' })}><option value="">All courses</option><Options list={f.filters.courses.map((c: Any) => [c.id, c.name])} /></select>
        <select value={q.sort || 'submitted'} onChange={(e) => setQ({ sort: e.target.value })}><Options list={[['submitted', 'Newest first'], ['days', 'Days in status'], ['intake', 'Intake'], ['student', 'Student name']]} /></select>
        <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={!!q.docreq} onChange={(e) => setQ({ docreq: e.target.checked ? '1' : '', page: '' })} /> Open document request</label>
        <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={!!q.unread} onChange={(e) => setQ({ unread: e.target.checked ? '1' : '', page: '' })} /> Unread messages</label>
        <select value={q.pending_days || ''} onChange={(e) => setQ({ pending_days: e.target.value, page: '' })}><option value="">Any decision age</option><Options list={[['7', 'Pending > 7 days'], ['14', 'Pending > 14 days'], ['30', 'Pending > 30 days']]} /></select>
      </form>
      <div className="card"><div className="table-wrap"><table className="tbl uni-inbox"><thead><tr>
        {act ? <th><input type="checkbox" checked={!!selectable.length && selectable.every((id: string) => sel.has(id))} onChange={(e) => selectable.forEach((id: string) => toggle(id, e.target.checked))} /></th> : null}
        <th>Application</th><th>Student</th><th>Course</th><th>Intake</th><th>Submitted</th><th>Status</th><th>Days</th><th>Your ref.</th><th /></tr></thead><tbody>
        {d.rows.length ? d.rows.map((x: Any) => (
          <tr key={x.id} className={x.late ? 'row-danger' : x.answered ? 'row-info' : ''} onDoubleClick={() => go('/applications/' + x.id)}>
            {act ? <td><input type="checkbox" disabled={x.status !== 'New'} checked={sel.has(x.id)} onChange={(e) => toggle(x.id, e.target.checked)} /></td> : null}
            <td data-label="Application"><Link href={'/applications/' + x.id}><b>{x.application_code}</b></Link></td><td data-label="Student">{x.student_name}</td>
            <td data-label="Course">{x.course}<div className="small muted">{x.level}{x.campus ? ' · ' + x.campus : ''}</div></td>
            <td data-label="Intake">{x.intake}</td><td data-label="Submitted" className="small">{fmtDate(x.submitted_at)}</td><td data-label="Status"><UStatus s={x.status} /></td><td data-label="Days">{x.days_in_status}</td>
            <td data-label="Ref." className="small">{x.university_ref || '-'}</td>
            <td className="nowrap">{x.unread ? <span className="badge blue" title="Unread messages">✉ {x.unread}</span> : null}{x.open_request ? <> <span className="badge orange" title="Open document request">📄</span></> : null}</td>
          </tr>)) : <tr><td colSpan={10} className="empty">No applications match</td></tr>}
      </tbody></table></div>
        <div className="row between" style={{ padding: '10px 14px' }}><span className="small muted">Page {d.page} of {Math.max(1, Math.ceil(d.total / d.size))}</span>
          <div className="row" style={{ gap: 6 }}>
            <select className="input" style={{ width: 'auto' }} value={String(d.size)} onChange={(e) => setQ({ size: e.target.value, page: '' })}><Options list={['25', '50', '100']} /></select>
            <button className="btn sm" disabled={d.page <= 1} onClick={() => setQ({ page: d.page - 1 })}>‹ Prev</button>
            <button className="btn sm" disabled={d.page * d.size >= d.total} onClick={() => setQ({ page: d.page + 1 })}>Next ›</button></div></div></div>
      <p className="small muted">Light red = new for more than 3 working days. Light blue = La Europa answered a document request you have not opened yet.</p>
    </>); }}</Page>;
}

// ---------- detail ----------
const ACTION_LABEL: Record<string, string> = { acknowledge: 'Acknowledge', doc_request: 'Request documents', interview: 'Schedule interview', interview_result: 'Record interview result', under_assessment: 'Mark under assessment',
  conditional_offer: 'Issue conditional offer', unconditional_offer: 'Issue unconditional offer', conditions_met: 'Mark conditions met', reject: 'Reject', waitlist: 'Waitlist', offer_letter: 'Upload offer letter',
  deposit: 'Mark deposit received', enrolled: 'Mark enrolled', cas: 'Upload CAS / acceptance letter', correction: 'Correct a decision' };
const PRIMARY = ['acknowledge', 'conditional_offer', 'unconditional_offer', 'conditions_met', 'deposit', 'enrolled'];
const TABS: [string, string][] = [['summary', 'Summary'], ['form', 'Application form'], ['academic', 'Academic'], ['english', 'English and experience'], ['documents', 'Documents'], ['messages', 'Messages'], ['student', 'Student (direct)'], ['timeline', 'Timeline']];
const mm = (ym?: string | null) => (ym ? String(ym).split('-').reverse().join('/') : '');
const KV = ({ k, v }: { k: string; v: React.ReactNode }) => <div><div className="k">{k}</div><div className="v">{v}</div></div>;

export function Detail({ id }: { id: string }) {
  const q = useQ(); const me = useMe((s) => s.me);
  const st = useLoad(() => GET('/applications/' + id), [id]);
  const tab = q.tab || 'summary';
  return <Page state={st}>{() => { const v = st.data as Any;
    if (v.access_ended) return (<>
      <div className="page-head"><Link className="btn ghost sm" href="/applications">← Applications</Link></div>
      <div className="card"><div className="bd"><h2>{v.application_code}</h2><p>{v.course} · {v.intake} · <UStatus s={v.status} /></p><div className="banner">Access period ended. Only the summary is available.</div></div></div>
    </>);
    const acts = (v.allowed || []).filter((a: string) => ACTION_LABEL[a]);
    const editRef = async (e: React.MouseEvent) => {
      e.preventDefault();
      await formModal({ title: 'Your reference number', fields: [{ k: 'university_ref', label: 'Your reference number (max 50)', maxlength: 50 }], values: { university_ref: v.university_ref || '' },
        save: async (x) => { await PUT(`/applications/${id}/reference`, { university_ref: x.university_ref || '' }); st.reload(); return true; } });
    };
    return (<>
      <div className="page-head"><Link className="btn ghost sm" href="/applications">← Applications</Link></div>
      {v.withdrawn_at ? <div className="banner warn">Withdrawn by La Europa on {fmtDate(v.withdrawn_at)}. This application is read-only.</div> : null}
      {v.flags.docs_requested ? <div className="banner warn">Documents requested from La Europa: waiting for their answer.</div> : null}
      <div className="card uni-head"><div className="bd"><div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="grow" style={{ minWidth: 260 }}>
          <div className="small muted">{v.application_code} · submitted {fmtDate(v.submitted_at)} · {v.days_in_status} day(s) in status</div>
          <h1 style={{ margin: '4px 0' }}>{v.student_name}</h1>
          <div>{v.course} ({v.level}){v.campus ? ' · ' + v.campus : ''} · <b>{v.intake}</b></div>
          <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}><UStatus s={v.status} />{v.flags.waitlisted ? <span className="badge grey">Waitlisted</span> : null}
            <span className="small">Your reference: <b>{v.university_ref || '-'}</b> {canAct() && !v.withdrawn_at ? <a href="#" className="small" onClick={editRef}>edit</a> : null}</span></div>
          <div className="small muted" style={{ marginTop: 8 }}>La Europa contact: {v.la_europa_contacts.map((c: Any) => `${c.name} (${c.email}${c.phone ? ', ' + c.phone : ''})`).join('; ') || '-'}{v.partner_manager ? ` · Partner manager: ${v.partner_manager.name}` : ''}</div>
        </div>
        <div className="uni-actions">{acts.length ? acts.map((a: string) => <button key={a} className={`btn ${PRIMARY.includes(a) ? 'primary' : a === 'reject' ? 'danger' : ''} sm`} onClick={() => actionDialog(v, a, st.reload)}>{ACTION_LABEL[a]}</button>)
          : <span className="small muted">{me?.role === 'viewer' ? 'View only' : 'No actions in this status'}</span>}</div>
      </div></div></div>
      {!v.withdrawn_at ? <div style={{ marginTop: 12 }}><OneClick v={v} /></div> : null}
      <div className="tabs" style={{ margin: '12px 0' }}>{TABS.map(([k, l]) => <Link key={k} href={`/applications/${id}?tab=${k}`} className={k === tab ? 'on' : ''}>{k === 'messages' && v.unread ? `${l} (${v.unread})` : l}</Link>)}</div>
      <div>
        {tab === 'summary' ? <Summary v={v} /> : null}
        {tab === 'form' ? <>
          <div className="row" style={{ marginBottom: 10 }}><span className="small muted grow">Filled by the student, the agent or La Europa in one common form. Contact and finance details stay with La Europa.</span>
            <button className="btn sm primary" onClick={() => download(`/applications/${id}/application-form.pdf`, `application-form-${v.application_code}.pdf`, undefined, true).catch(showError)}>⬇ Download PDF</button></div>
          <div className="card"><div className="bd"><InfoForm mode="university" load={() => GET(`/applications/${id}/application-form`)} save={async () => ({})} /></div></div>
        </> : null}
        {tab === 'academic' ? <>
          <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th>Level</th><th>Course</th><th>Board / university</th><th>Score</th><th>% equivalent</th><th>Year</th><th>Backlogs (total / active)</th></tr></thead><tbody>
            {v.academic.length ? v.academic.map((a: Any, i: number) => <tr key={i}><td data-label="Level"><b>{a.level}</b></td><td data-label="Course">{a.course || '-'}</td><td data-label="Board">{a.board || '-'}</td>
              <td data-label="Score">{a.score ?? '-'} {a.scale === '%' ? '%' : a.scale}</td><td data-label="%">{a.percent !== null && a.percent !== undefined ? a.percent + '%' : '-'}</td><td data-label="Year">{a.year || '-'}</td>
              <td data-label="Backlogs">{a.backlogs_total ?? '-'} / {a.backlogs_active ?? '-'}</td></tr>) : <tr><td colSpan={7} className="empty">No records</td></tr>}</tbody></table></div></div>
          <p className="small muted">% equivalent of CGPA uses La Europa&apos;s conversion factor.</p>
        </> : null}
        {tab === 'english' ? <div className="grid two">
          <div className="card"><div className="hd"><h2>English tests</h2></div><div className="table-wrap"><table className="tbl"><thead><tr><th>Test</th><th>Overall</th><th>L / R / W / S</th><th>Date</th><th>TRF / ref.</th></tr></thead><tbody>
            {v.english.length ? v.english.map((t: Any, i: number) => <tr key={i}><td>{t.test}</td><td><b>{t.overall ?? '-'}</b></td><td>{[t.listening, t.reading, t.writing, t.speaking].map((x) => x ?? '-').join(' / ')}</td><td>{fmtDate(t.date)}</td><td>{t.trf || '-'}</td></tr>)
              : <tr><td colSpan={5} className="empty">No test</td></tr>}</tbody></table></div></div>
          <div className="card"><div className="hd"><h2>Work experience</h2><span className="grow" /><span className="small muted">{v.work_total || ''}</span></div><div className="bd">
            {v.work.length ? v.work.map((w: Any, i: number) => <div key={i} className="rowx"><b>{w.company}</b> · {w.designation}<div className="small muted">{mm(w.from)} to {w.till_date ? 'till date' : mm(w.to)}</div></div>) : <div className="empty">No work experience</div>}
          </div></div>
        </div> : null}
        {tab === 'documents' ? <DocsTab v={v} reload={st.reload} /> : null}
        {tab === 'messages' ? <Thread k={id} /> : null}
        {tab === 'student' ? <StudentTab v={v} /> : null}
        {tab === 'timeline' ? <>
          <div className="card"><div className="bd"><ul className="tl">{v.timeline.map((e: Any, i: number) => (
            <li key={i}><span className="dot" /><div><b>{e.text}</b>{e.by ? <> <span className="small muted">by {e.by}</span></> : null}{e.received ? <> <span className="badge green">Received by La Europa</span></> : null}
              <div className="small muted">{e.info ? '' : fmtDT(e.at)}</div></div></li>))}</ul></div></div>
          <div className="card" style={{ marginTop: 12 }}><div className="hd"><h2>Document requests</h2></div><div className="bd"><Requests v={v} reload={st.reload} /></div></div>
        </> : null}
      </div>
    </>); }}</Page>;
}

function Summary({ v }: { v: Any }) {
  const i = v.identity;
  return (
    <div className="grid two">
      <div className="card"><div className="hd"><h2>Student (as in passport)</h2></div><div className="bd">
        <div className="kv">
          <KV k="First name" v={i.first_name} /><KV k="Middle name" v={i.middle_name || '-'} /><KV k="Last name" v={i.last_name || '-'} />
          <KV k="Gender" v={i.gender || '-'} /><KV k="Date of birth" v={fmtDate(i.dob)} /><KV k="Nationality" v={i.nationality || '-'} />
          <KV k="Passport" v={<>{i.passport || '-'}{i.passport_masked && i.passport ? <> <span className="small muted">(masked)</span></> : null}</>} /><KV k="Passport expiry" v={fmtDate(i.passport_expiry)} />
          <KV k="Residence" v={[i.city, i.state, i.country].filter(Boolean).join(', ')} />
        </div>
        {v.contact ? <div className="banner" style={{ marginTop: 12 }}>Contact (shared by La Europa): {v.contact.phone} · {v.contact.email}</div> : <p className="small muted" style={{ marginTop: 12 }}>{v.contact_note}</p>}
        {v.visa_outcome ? <p className="small">Visa: <b>{v.visa_outcome.outcome}</b> ({fmtDate(v.visa_outcome.date)})</p> : null}
      </div></div>
      <div className="grid" style={{ gap: 14 }}>
        <div className="card"><div className="hd"><h2>Academic summary</h2></div><div className="bd"><p style={{ margin: 0, lineHeight: 1.7 }}>{String(v.summary_line || '').split(' | ').filter(Boolean).map((x: string, k: number) => <span key={k}><span className="chip-line">{x}</span> </span>)}</p></div></div>
        {v.cover_note ? <div className="card"><div className="hd"><h2>Cover note from La Europa</h2></div><div className="bd" style={{ whiteSpace: 'pre-wrap' }}>{v.cover_note}</div></div> : null}
        {v.offer ? <div className="card"><div className="hd"><h2>Current offer</h2></div><div className="bd small">
          {String(v.offer.type || '').replace('_', ' ')}{v.offer.deadline ? ` · acceptance deadline ${fmtDate(v.offer.deadline)}` : ''}
          {v.offer.fee ? <div>Tuition: {money(v.offer.fee.total_amount, v.offer.fee.currency)}{v.offer.fee.deposit_required ? ` · deposit ${money(v.offer.fee.deposit_required, v.offer.fee.currency)}` : ''}</div> : null}
          {v.offer.conditions.length ? <ul>{v.offer.conditions.map((c: Any) => <li key={c.id}>{c.text} <span className={`badge ${c.status === 'Open' ? 'orange' : 'green'}`}>{c.status}</span></li>)}</ul> : null}
          {v.offer.letters.length ? <div className="muted">Letters: {v.offer.letters.map((l: Any) => `${l.type} (${fmtDate(l.issue_date)})`).join(', ')}</div> : null}
        </div></div> : null}
        {v.interview ? <div className="card"><div className="hd"><h2>Interview</h2></div><div className="bd small">{fmtDT(v.interview.at)} · {v.interview.link || ''}</div></div> : null}
        <div className="card"><div className="hd"><h2>Received by La Europa</h2></div><div className="bd small">
          {v.received.length ? v.received.map((x: Any) => <div key={x.id}>{x.label} · {fmtDT(x.created_at)} {x.received ? <span className="badge green">✓ Received by La Europa</span> : <span className="badge grey">Sent</span>}</div>) : 'No actions yet'}
        </div></div>
      </div>
    </div>
  );
}

function Requests({ v, reload }: { v: Any; reload: () => void }) {
  const cancel = async (rid: string) => {
    const reason = await confirmBox('Cancel this document request?', { reason: true, reasonLabel: 'Reason for cancelling the request', ok: 'Cancel request', cancel: 'Keep' });
    if (typeof reason !== 'string') return;
    try { await POST(`/applications/${v.id}/requests/${rid}/cancel`, { reason }); reload(); } catch (e) { showError(e); }
  };
  if (!v.requests.length) return <div className="empty small">No document requests</div>;
  return <>{v.requests.map((r: Any) => (
    <div key={r.id} className="req">
      <div className="row between"><b>{fmtDate(r.created_at)}: {r.status}</b>{['Open', 'Partly fulfilled'].includes(r.status) && canAct() ? <button className="btn xs" onClick={() => cancel(r.id)}>Cancel request</button> : null}</div>
      <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{r.message}</div>{r.needed_by ? <div className="small muted">Needed by {fmtDate(r.needed_by)}</div> : null}
      <ul className="small">{r.items.map((i: Any) => <li key={i.id}>{i.name}{i.note ? ' (' + i.note + ')' : ''}: <b>{i.status}</b>{i.reply ? ' - ' + i.reply : ''}</li>)}</ul>
    </div>))}</>;
}

function DocsTab({ v, reload }: { v: Any; reload: () => void }) {
  const st = useLoad(() => GET(`/applications/${v.id}/documents`), [v.id]);
  const [zipping, setZipping] = useState(false);
  const link = (body: Any) => openFrom(`/applications/${v.id}/documents/link`, body).catch(showError);
  const remove = async (vid: string) => { if (!(await confirmBox('Remove this upload?', { danger: true, ok: 'Remove' }))) return; try { await DEL(`/applications/${v.id}/documents/version/${vid}`); st.reload(); } catch (e) { showError(e); } };
  const zip = async () => { setZipping(true); try { const r = await POST(`/applications/${v.id}/documents/zip`); openUrl(r.url); } catch (e) { showError(e); } finally { setZipping(false); } };
  return <Page state={st}>{() => { const d = st.data as Any;
    if (d.hidden) return <div className="card"><div className="bd muted">Your role does not have access to student documents.</div></div>;
    if (d.access_ended) return <div className="card"><div className="bd muted">Access period ended.</div></div>;
    const upload = () => formModal({ title: 'Upload a document', saveLabel: 'Upload', intro: null,
      fields: [{ k: 'document_type', label: 'Document type', type: 'select', opts: d.upload_types, noBlank: true }, { k: 'title', label: 'Title (for "Other")', maxlength: 150 },
        { k: 'file', label: 'File (PDF for invoices; PDF / JPG / PNG for others, max 10 MB)', type: 'file', accept: '.pdf,.jpg,.jpeg,.png' }, { k: 'note', label: 'Note for La Europa', maxlength: 500 },
        { k: 'hint', type: 'html', html: () => <p className="small muted">Offer letters, interview results, deposit receipts, enrolment and visa letters are uploaded with their actions.</p> }],
      values: { document_type: d.upload_types[0] },
      save: async (x) => { await SEND('post', `/applications/${v.id}/documents/upload`, toFormData(x)); toast('Sent to La Europa', 'ok'); st.reload(); return true; } });
    return (<>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        {d.zip && d.shared.length ? <button className="btn sm" disabled={zipping} onClick={zip}>{zipping ? 'Preparing...' : 'Download all (ZIP)'}</button> : null}
        {canAct() && !v.withdrawn_at ? <button className="btn sm primary" onClick={upload}>+ Upload document</button> : null}<span className="grow" />
        <span className="small muted">Files are watermarked with your email and every view / download is logged.</span></div>
      <div className="grid two">
        <div className="card"><div className="hd"><h2>Shared by La Europa</h2></div><div className="bd flush">
          {d.shared.length ? d.shared.map((x: Any) => <div key={x.document_id} className="doc-row"><div className="grow"><b>{x.name}</b>
            {x.versions.map((ver: Any) => <div key={ver.share_id} className="small">v{ver.version_no} · {ver.status}{ver.updated ? ` · Updated by La Europa on ${fmtDate(ver.shared_at)}` : ''}{' '}
              {ver.active ? <><a href="#" onClick={(e) => { e.preventDefault(); link({ share_id: ver.share_id }); }}>View</a> · <a href="#" onClick={(e) => { e.preventDefault(); link({ share_id: ver.share_id, download: true }); }}>Download</a></> : null}</div>)}
          </div></div>) : <div className="empty">No documents shared yet</div>}
        </div></div>
        <div className="card"><div className="hd"><h2>Uploaded by your university</h2></div><div className="bd flush">
          {d.uploads.length ? d.uploads.map((x: Any) => <div key={x.document_id} className="doc-row"><div className="grow"><b>{x.name}</b>
            {x.versions.map((ver: Any) => <div key={ver.version_id} className="small">v{ver.version_no} · {ver.status} · {ver.by} {fmtDate(ver.uploaded_at)}{' '}
              {ver.active ? <a href="#" onClick={(e) => { e.preventDefault(); link({ version_id: ver.version_id }); }}>View</a> : null}
              {ver.can_remove ? <> · <a href="#" className="text-red" onClick={(e) => { e.preventDefault(); remove(ver.version_id); }}>Remove</a></> : null}</div>)}
          </div></div>) : <div className="empty">Nothing uploaded yet</div>}
        </div></div>
      </div>
      <div className="card" style={{ marginTop: 12 }}><div className="hd"><h2>Document requests</h2></div><div className="bd"><Requests v={v} reload={reload} /></div></div>
    </>); }}</Page>;
}

// ---------- action dialogs (UP12) ----------
const FMT: [number, string][] = [[1, '1. Classic formal'], [2, '2. Modern header band'], [3, '3. European with reference block'], [4, '4. Compact one-page'], [5, '5. Detailed with terms']];
const CUR = ['EUR', 'USD', 'GBP', 'CNY', 'SEK', 'CHF', 'INR'];
const AMOUNT_HELP = 'Amount only. Do not write words like non-EU, international or foreign.';
type Row = Record<string, string>;
function RowsEditor({ rows, set, cols, add }: { rows: Row[]; set: (r: Row[]) => void; cols: { k: string; placeholder?: string; type?: string; opts?: string[]; width?: number; grow?: boolean; maxlength?: number }[]; add: string }) {
  const upd = (i: number, k: string, x: string) => set(rows.map((r, j) => (j === i ? { ...r, [k]: x } : r)));
  return (<>
    {rows.map((r, i) => (
      <div key={i} className="row" style={{ gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        {cols.map((c) => c.opts
          ? <select key={c.k} className="input" style={{ width: c.width }} value={r[c.k] ?? c.opts[0]} onChange={(e) => upd(i, c.k, e.target.value)}><Options list={c.opts} /></select>
          : <input key={c.k} className={`input${c.grow ? ' grow' : ''}`} type={c.type ?? 'text'} placeholder={c.placeholder} maxLength={c.maxlength} style={{ width: c.width }} value={r[c.k] ?? ''} onChange={(e) => upd(i, c.k, e.target.value)} />)}
        <button type="button" className="btn xs ghost" onClick={() => set(rows.filter((_, j) => j !== i))}>✕</button>
      </div>))}
    <button type="button" className="btn xs" onClick={() => set([...rows, {}])}>{add}</button>
  </>);
}
async function actionDialog(v: Any, act: string, reload: () => void) {
  const today = new Date().toISOString().slice(0, 10);
  const money2 = (k: string, label: string, req = false): Field[] => [{ k, label, type: 'number', req, min: 0, step: 0.01, help: AMOUNT_HELP, col: ['tuition', 'amount', 'final_tuition'].includes(k) ? 4 : 6 },
    ...(['tuition', 'amount', 'final_tuition'].includes(k) ? [{ k: 'currency', label: 'Currency', type: 'select', opts: CUR, noBlank: true, col: 2 } as Field] : [])];
  const offer = act === 'conditional_offer' || act === 'unconditional_offer';
  const letterGen = (label: string): Field[] => [{ k: 'generate', label, type: 'checkbox' }, { k: 'format', label: 'Letter format', type: 'select', opts: FMT, noBlank: true, col: 3, help: 'Preview formats under Letters & bank details' }];
  let fields: Field[] = [];
  let multipart = false;
  const vals: Vals = { currency: 'EUR', generate: true, format: '1', pause: true, items: [{}], conditions: [{}] };
  if (act === 'acknowledge') fields = [{ k: 'reference', label: 'Your reference number', maxlength: 50 }, { k: 'expected_decision', label: 'Expected decision date', type: 'date', min: today }, { k: 'note', label: 'Note to La Europa', type: 'textarea', maxlength: 1000 }];
  if (act === 'under_assessment') fields = [{ k: 'i', type: 'html', html: () => <p>Mark this application as under assessment. La Europa will see the update.</p> }];
  if (act === 'doc_request') fields = [
    { k: 'items', label: 'Documents needed *', type: 'html', html: (x, set) => <><label>Documents needed *</label><RowsEditor rows={x.items} set={(r) => set('items', r)} add="+ Add document"
      cols={[{ k: 'title', placeholder: 'Document needed (e.g. Course descriptions)', maxlength: 150 }, { k: 'note', placeholder: 'Note', maxlength: 300 }]} /></> },
    { k: 'message', label: 'Message to La Europa', req: true, type: 'textarea', maxlength: 2000, help: 'This goes to the La Europa counsellor, not to the student.' },
    { k: 'needed_by', label: 'Needed by', type: 'date', min: today }, { k: 'pause', label: 'Pause decision until received', type: 'checkbox' }];
  if (act === 'interview') fields = [
    { k: 'at', label: 'Interview date and time', req: true, type: 'datetime', help: `Your local time (${Intl.DateTimeFormat().resolvedOptions().timeZone}). La Europa sees it in IST too.` },
    { k: 'mode', label: 'Mode', req: true, type: 'select', opts: ['Online video', 'Phone', 'In person', 'Written / online test'], noBlank: true },
    { k: 'link', label: 'Link or address', maxlength: 300, help: 'Shared with the student only through La Europa.' }, { k: 'duration', label: 'Duration (minutes)', type: 'number', min: 10, max: 240 },
    { k: 'instructions', label: 'Instructions for the student', type: 'textarea', maxlength: 1000 }, { k: 'note', label: 'Note to La Europa', type: 'textarea', maxlength: 1000 },
    ...(v.status === 'Interview scheduled' ? [{ k: 'reason', label: 'Reason for rescheduling', req: true } as Field] : [])];
  if (act === 'interview_result') { multipart = true; fields = [{ k: 'result', label: 'Result', req: true, type: 'select', opts: ['Passed', 'Not passed', 'Pending', 'No show'], noBlank: true }, { k: 'feedback', label: 'Feedback for La Europa', type: 'textarea', maxlength: 1000 }, { k: 'file', label: 'Result file (PDF, optional)', type: 'file', accept: '.pdf' }]; }
  if (offer) { multipart = true; fields = [
    ...letterGen(`Generate the ${act === 'conditional_offer' ? 'conditional' : 'unconditional'} offer letter for me (PDF from this form)`), { k: 'student_uni_id', label: 'Student ID (your university)', maxlength: 50, col: 3 },
    { k: 'file', label: 'Or upload your own offer letter (PDF, max 10 MB)', type: 'file', accept: '.pdf', help: 'Untick "Generate" above to use your own file.' },
    { k: 'letter_note', label: 'Extra text for the generated letter (optional)', type: 'textarea', maxlength: 1500 },
    { k: 'letter_to_follow', label: 'Offer letter to follow on', type: 'checkbox' }, { k: 'letter_date', label: 'Letter will follow on', type: 'date', min: today },
    ...(act === 'conditional_offer' ? [{ k: 'conditions', type: 'html', html: (x: Vals, set: (k: string, v: unknown) => void) => <><label>Conditions *</label><RowsEditor rows={x.conditions} set={(r) => set('conditions', r)} add="+ Add condition"
      cols={[{ k: 'text', placeholder: 'Condition', grow: true, maxlength: 500 }, { k: 'type', opts: ['Academic', 'English', 'Document', 'Financial', 'Other'], width: 130 }, { k: 'due', type: 'date', width: 150 }]} /></> } as Field] : []),
    ...money2('tuition', 'Tuition fee for first year', true), ...money2('scholarship', 'Scholarship / waiver'), { k: 'scholarship_text', label: 'Scholarship description', maxlength: 200 },
    ...money2('deposit', 'Deposit required to confirm seat'), { k: 'deposit_deadline', label: 'Deposit deadline', type: 'date', col: 3 }, { k: 'acceptance_deadline', label: 'Offer acceptance deadline', type: 'date', min: today, col: 3 },
    { k: 'programme_start', label: 'Programme start date', type: 'date' }, { k: 'note', label: 'Note to La Europa', type: 'textarea', maxlength: 1000 }]; }
  if (act === 'conditions_met') { multipart = true; vals.met = Object.fromEntries((v.offer?.conditions ?? []).map((c: Any) => [c.id, 'Met'])); fields = [
    { k: 'met', type: 'html', html: (x, set) => <><p>Mark each condition as met or waived.</p>{(v.offer?.conditions ?? []).map((c: Any) => (
      <div key={c.id} className="row" style={{ gap: 8, margin: '4px 0' }}><span className="grow small">{c.text}</span>
        <select className="input" style={{ width: 110 }} value={x.met[c.id]} onChange={(e) => set('met', { ...x.met, [c.id]: e.target.value })}><Options list={['Met', 'Waived']} /></select></div>))}</> },
    ...letterGen('Generate the unconditional offer letter for me'), ...money2('tuition', 'Tuition fee for first year'), ...money2('deposit', 'Deposit'), { k: 'file', label: 'Or upload your own unconditional offer letter (PDF)', type: 'file', accept: '.pdf' }]; }
  if (act === 'reject') fields = [{ k: 'reason', label: 'Reason', req: true, type: 'select', opts: v.reject_reasons }, { k: 'details', label: 'Details for La Europa', type: 'textarea', maxlength: 1000, help: 'Never shown to the student unless La Europa decides to.' },
    { k: 'share_reason', label: 'La Europa may share the reason with the student', type: 'checkbox' }, { k: 'suggest_course_id', label: 'Suggest another course', type: 'select', blank: 'No suggestion', opts: v.courses.map((c: Any) => [c.id, `${c.name} (${c.level})`]) }];
  if (act === 'waitlist') fields = [{ k: 'note', label: 'Reason / note to La Europa', req: true, type: 'textarea', maxlength: 1000 }, { k: 'expected_decision', label: 'Expected decision date', type: 'date', min: today }, { k: 'position', label: 'Waitlist position', type: 'number', min: 1 }];
  if (act === 'offer_letter') { multipart = true; fields = [{ k: 'file', label: 'Offer letter (PDF)', req: true, type: 'file', accept: '.pdf' }, { k: 'letter_type', label: 'Letter type', req: true, type: 'select', opts: ['Conditional', 'Unconditional', 'Revised'], noBlank: true }, { k: 'issue_date', label: 'Issue date', type: 'date' }, { k: 'note', label: 'Note' }]; }
  if (act === 'deposit') { multipart = true; fields = [...money2('amount', 'Amount received', true), { k: 'date', label: 'Date received', req: true, type: 'date', max: today }, { k: 'reference', label: 'Payment reference' },
    { k: 'file', label: 'Receipt / confirmation (PDF / JPG / PNG)', type: 'file', accept: '.pdf,.jpg,.jpeg,.png' }, ...money2('balance', 'Remaining balance')]; }
  if (act === 'enrolled') { multipart = true; fields = [{ k: 'enrol_date', label: 'Enrolment date', req: true, type: 'date', max: today }, { k: 'student_uni_id', label: 'Student university ID / matriculation number', maxlength: 50 },
    { k: 'programme_start', label: 'Programme start date', req: true, type: 'date' }, ...money2('final_tuition', 'Final first-year tuition fee', true), ...money2('scholarship', 'Scholarship / waiver applied'), { k: 'file', label: 'Enrolment proof (PDF)', type: 'file', accept: '.pdf' }]; }
  if (act === 'cas') { multipart = true; fields = [{ k: 'letter_type', label: 'Letter type', req: true, type: 'select', opts: ['Acceptance / admission letter for visa', 'CAS', 'Pre-enrolment or visa support letter', 'JW201 / JW202 (China)', 'Other'], noBlank: true },
    { k: 'file', label: 'File (PDF)', req: true, type: 'file', accept: '.pdf' }, { k: 'reference', label: 'Reference number' }, { k: 'issue_date', label: 'Issue date', type: 'date' }, { k: 'valid_until', label: 'Valid until', type: 'date' }]; }
  if (act === 'correction') fields = [{ k: 'w', type: 'html', html: () => <div className="banner warn">Use this only to correct a mistake. La Europa reviews every correction before the student is told.</div> },
    { k: 'status', label: 'Correct status', req: true, type: 'select', opts: ['Acknowledged', 'Documents requested', 'Under assessment', 'Interview scheduled', 'Waitlisted', 'Conditional offer', 'Unconditional offer', 'Rejected', 'Deposit received', 'Enrolled'].filter((s) => s !== v.status) },
    { k: 'reason', label: 'Reason', req: true, type: 'textarea', maxlength: 1000 }];
  for (const f of fields) if (!f.col && f.type !== 'html') f.col = 6;
  // fees, format and student ID come from Letters & bank details (filled once)
  if (['conditional_offer', 'unconditional_offer', 'conditions_met'].includes(act)) {
    try {
      const df = await GET(`/applications/${v.id}/student/defaults`);
      Object.assign(vals, { format: String(df.format || 1), student_uni_id: df.student_uni_id || '', tuition: df.tuition ?? '', deposit: df.deposit ?? '', currency: df.currency || 'EUR' });
      if (df.validity_days) vals.acceptance_deadline = new Date(Date.now() + df.validity_days * 864e5).toISOString().slice(0, 10);
    } catch { /* defaults are a convenience */ }
  }
  await formModal({ title: ACTION_LABEL[act], size: ['conditional_offer', 'unconditional_offer', 'doc_request'].includes(act) ? 'lg' : '', fields, values: vals, saveLabel: ACTION_LABEL[act],
    intro: <p className="small muted" style={{ marginTop: 0 }}>{v.student_name} · {v.application_code} · current status {v.status}</p>,
    save: async (raw) => {
      if (act === 'reject' && !(await confirmBox('Reject this application? La Europa will review it before the student is told.', { danger: true, ok: 'Reject' }))) return false;
      const b: Vals = { ...raw, version: v.version };
      delete b.items; delete b.conditions; delete b.met;
      const files = Array.isArray(raw.file) ? raw.file : [];
      if (b.generate && files.length) b.generate = false; // an uploaded file wins
      if (act === 'doc_request') b.items = JSON.stringify((raw.items as Row[]).map((i) => ({ title: (i.title || '').trim(), note: (i.note || '').trim() })).filter((i) => i.title));
      if (act === 'conditional_offer') b.conditions = JSON.stringify((raw.conditions as Row[]).map((c) => ({ text: (c.text || '').trim(), type: c.type || 'Academic', due: c.due || null })).filter((c) => c.text));
      if (act === 'conditions_met') b.conditions = JSON.stringify(Object.entries(raw.met as Row).map(([id, result]) => ({ id, result })));
      if (act === 'interview' && b.at) b.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!['doc_request', 'conditional_offer', 'conditions_met'].includes(act)) { delete b.pause; }
      if (!offer && act !== 'conditions_met') { delete b.generate; delete b.format; }
      const url = `/applications/${v.id}/actions/${act}`;
      if (multipart) await SEND('post', url, toFormData(b));
      else { if (b.items) b.items = JSON.parse(b.items); if (b.conditions) b.conditions = JSON.parse(b.conditions); await POST(url, b); }
      toast(`${ACTION_LABEL[act]}: sent to La Europa`, 'ok'); reload(); return true;
    } });
}

// ---------- messages ----------
const linkify = (s: string) => s.split(/(https:\/\/[^\s<]+)/g).map((p, i) => (/^https:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a> : <span key={i}>{p}</span>));
export function Thread({ k }: { k: string }) {
  const st = useLoad(() => GET('/messages/' + k), [k]);
  const [body, setBody] = useState(''); const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null); const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [st.data]);
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); if (!body.trim() && !files.length) return;
    setBusy(true);
    try { const fd = new FormData(); if (body.trim()) fd.append('body', body); files.forEach((f) => fd.append('files', f)); await SEND('post', '/messages/' + k, fd); setBody(''); setFiles([]); if (fileRef.current) fileRef.current.value = ''; st.reload(); }
    catch (er) { showError(er); } finally { setBusy(false); }
  };
  return <Page state={st}>{() => { const d = st.data as Any;
    if (d.access_ended) return <div className="card"><div className="bd muted">Access period ended.</div></div>;
    return (
      <div className="card"><div className="bd">
        <div className="small muted" style={{ marginBottom: 8 }}>Messages with La Europa Education only. The student never sees this thread.</div>
        <div className="uthread" ref={box}>{d.rows.length ? d.rows.map((m: Any) => (
          <div key={m.id} className={`umsg ${m.mine ? 'me' : 'le'}`}>
            <div className="who">{m.side}{m.sender ? ' · ' + m.sender : ''}</div>
            <div className="bub">{m.deleted ? <i className="muted">message deleted</i> : String(m.body || '').split('\n').map((l, i) => <span key={i}>{i ? <br /> : null}{linkify(l)}</span>)}
              {m.attachments.map((a: Any) => <div key={a.id}><a href="#" onClick={(e) => { e.preventDefault(); openFrom('/messages/attachment/' + a.id).catch(showError); }}>📎 {a.original_name}</a></div>)}</div>
            <div className="when">{fmtDT(m.sent_at)}{m.edited ? ' · edited' : ''}{m.mine && m.seen ? ` · Seen by La Europa ${ago(m.seen)}` : ''}
              {m.can_edit ? <> · <a href="#" onClick={async (e) => { e.preventDefault(); try { await PUT('/messages/m/' + m.id, { delete: true }); st.reload(); } catch (er) { showError(er); } }}>delete</a></> : null}</div>
          </div>)) : <div className="empty">No messages yet</div>}</div>
        {d.can_post ? (
          <form className="ucompose" onSubmit={send}>
            <textarea className="input" rows={2} maxLength={5000} placeholder="Write to La Europa..." style={{ height: 'auto', padding: 8 }} value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="row" style={{ gap: 8, marginTop: 6 }}><input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xlsx,.csv" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /><span className="grow" />
              <button className="btn primary" disabled={busy}>Send</button></div>
          </form>) : <p className="small muted">View only.</p>}
      </div></div>
    ); }}</Page>;
}
export function Messages() {
  const q = useQ(); const go = useGo();
  const st = useLoad(() => GET('/messages' + qs({ unread: q.unread, waiting: q.waiting })), [q.unread, q.waiting]);
  return <Page state={st}>{() => { const d = st.data as Any; const key = q.t || d.rows[0]?.uapp_id;
    return (<>
      <div className="page-head"><h1>Messages</h1><span className="grow" />
        <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={!!q.unread} onChange={(e) => go('/messages' + qs({ ...q, unread: e.target.checked ? '1' : '' }))} /> Unread</label>
        <label className="row small" style={{ gap: 4, marginLeft: 10 }}><input type="checkbox" checked={!!q.waiting} onChange={(e) => go('/messages' + qs({ ...q, waiting: e.target.checked ? '1' : '' }))} /> Waiting for La Europa</label></div>
      <div className="grid uni-msgs">
        <div className="card"><div className="bd flush">{d.rows.map((t: Any) => (
          <Link key={t.uapp_id} className={`thr ${t.uapp_id === key ? 'on' : ''}`} href={'/messages' + qs({ ...q, t: t.uapp_id })}>
            <div className="row between"><b>{t.application_code}</b>{t.unread ? <span className="badge blue">{t.unread}</span> : null}</div>
            <div className="small">{t.student_name}</div><div className="small muted">{t.last_text || ''}</div>
          </Link>))}</div></div>
        <div>{key ? <Thread k={key} /> : null}</div>
      </div>
    </>); }}</Page>;
}
