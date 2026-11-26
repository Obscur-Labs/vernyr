'use client';

import { useState } from 'react';
import Link from 'next/link';
import { GET, POST, PUT, SEND, ApiError, download, openFrom } from './api';
import { ago, fmtDT, fmtDate, money, qs } from './format';
import { FormGrid, formModal, toFormData, Options, type Field, type Vals } from './form';
import { Modal, confirmBox, openOverlay, showError, toast } from './ui';
import { Page, refreshMe, signIn, useGo, useLoad, useMe, useQ, type Any } from './u';

/** The client's remaining partner screens (legacy/public/university/js/more.js): UP17 reports, UP15 / UP16 finance, UP03 users, UP18 my account, notifications. */

const LEVELS = ['Bachelor', 'Master', 'MBA', 'PhD', 'Diploma', 'Foundation', 'Language course'];

export function Reports() {
  const q = useQ(); const go = useGo();
  const type = q.type || 'by_intake';
  const filt = { intake: q.intake, course: q.course, level: q.level, contact: q.contact };
  const st = useLoad(async () => { const [r, dash, d] = await Promise.all([GET('/reports'), GET('/dashboard'), GET(`/reports/${type}` + qs(filt))]); return { r, dash, d }; }, [JSON.stringify(q)]);
  const setQ = (p: Record<string, unknown>) => go('/reports' + qs({ ...q, ...p }));
  return <Page state={st}>{() => { const { r, dash, d } = st.data as Any;
    return (<>
      <div className="page-head"><h1>Reports</h1></div>
      <div className="tabs" style={{ marginBottom: 10 }}>{r.reports.map(([k, l]: [string, string]) => <Link key={k} href={'/reports' + qs({ ...q, type: k })} className={k === type ? 'on' : ''}>{l}</Link>)}</div>
      <form className="filters" onSubmit={(e) => e.preventDefault()}>
        <select value={q.intake || ''} onChange={(e) => setQ({ intake: e.target.value })}><option value="">All intakes</option><Options list={dash.filters.intakes} /></select>
        <select value={q.course || ''} onChange={(e) => setQ({ course: e.target.value })}><option value="">All courses</option><Options list={dash.filters.courses.map((c: Any) => [c.id, c.name])} /></select>
        <select value={q.level || ''} onChange={(e) => setQ({ level: e.target.value })}><option value="">All levels</option><Options list={LEVELS} /></select>
        {type === 'list' && r.contact_option ? <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={!!q.contact} onChange={(e) => setQ({ contact: e.target.checked ? '1' : '' })} /> Include contact details (logged)</label> : null}
        <span className="grow" />
        {r.can_export ? ['xlsx', 'pdf'].map((x) => <button key={x} type="button" className="btn sm" onClick={() => download(`/reports/${type}` + qs({ ...filt, format: x }), `${type}.${x}`).catch(showError)}>Export {x === 'xlsx' ? 'Excel' : 'PDF'}</button>) : null}
      </form>
      <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr>{d.columns.map((c: string) => <th key={c}>{c}</th>)}</tr></thead><tbody>
        {d.rows.length ? d.rows.map((row: unknown[], i: number) => <tr key={i}>{row.map((c, j) => <td key={j}>{String(c ?? '')}</td>)}</tr>) : <tr><td colSpan={d.columns.length} className="empty">No data</td></tr>}
      </tbody></table></div></div>
      <p className="small muted">Only applications La Europa submitted to you. Counts below 5 in location reports show as &quot;fewer than 5&quot; to protect students.</p>
    </>); }}</Page>;
}

const IST: Record<string, string> = { Invoiced: 'blue', 'Partially paid': 'orange', Paid: 'green', Overdue: 'red', Cancelled: 'grey' };
export function Finance() {
  const me = useMe((s) => s.me);
  const st = useLoad(() => GET('/finance'), []);
  return <Page state={st}>{() => { const d = st.data as Any;
    const details = async (i: Any) => {
      let queries: Any[] = [];
      try { queries = await GET(`/finance/invoices/${i.id}/queries`); } catch (e) { showError(e); return; }
      openOverlay((close) => <InvoiceDetail i={i} queries={queries} preview={!!me?.preview} close={close} done={st.reload} />);
    };
    return (<>
      <div className="page-head"><h1>Commission and invoices</h1><span className="grow" /><span className="small muted">Visible only to users with finance access</span></div>
      {d.rules.length ? <div className="card" style={{ marginBottom: 12 }}><div className="hd"><h2>Agreed commission terms</h2></div><div className="bd small">
        {d.rules.map((x: Any, k: number) => <div key={k}><b>{x.name}</b>: {x.basis}{x.rate ? ` · ${x.rate}%` : ''}{x.fixed ? ` · ${x.fixed}` : ''} · due {x.due}</div>)}</div></div> : null}
      {d.expected ? <div className="card" style={{ marginBottom: 12 }}><div className="hd"><h2>Expected commission (not yet invoiced)</h2></div><div className="bd small">
        {d.expected.length ? d.expected.map((x: Any, k: number) => <div key={k}>{x.status}: {x.n} line(s), {money(x.total, x.currency)}</div>) : 'None'}</div></div> : null}
      {d.agreement?.length ? <div className="card" style={{ marginBottom: 12 }}><div className="hd"><h2>Partner agreement</h2></div><div className="bd small">
        {d.agreement.map((a: Any) => <div key={a.id}><b>{a.agreement_code}</b> {a.title} · {fmtDate(a.start_date)} to {a.end_date ? fmtDate(a.end_date) : 'until terminated'} · <span className="badge">{a.status}</span>
          <div className="muted">Signed by {a.signed_by_le} ({a.party}) and {a.signed_by_uni} on {fmtDate(a.signed_on)}</div>
          {a.has_pdf ? <a href="#" onClick={(e) => { e.preventDefault(); openFrom(`/agreements/${a.id}/pdf`).catch(showError); }}>View PDF</a> : null}</div>)}</div></div> : null}
      <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th>Invoice</th><th>Date</th><th>Total</th><th>Due</th><th>Paid</th><th>Balance</th><th>Status</th><th /></tr></thead><tbody>
        {d.invoices.length ? d.invoices.map((i: Any) => (
          <tr key={i.id}><td><b>{i.invoice_no}</b>{i.kind === 'credit_note' ? <> <span className="badge grey">Credit note</span></> : null}{i.query_open ? <> <span className="badge orange">Query open</span></> : null}</td>
            <td>{fmtDate(i.invoice_date)}</td><td>{money(i.total, i.currency)}</td><td>{fmtDate(i.due_date)}</td><td>{money(i.paid, i.currency)}</td><td><b>{money(i.balance, i.currency)}</b></td>
            <td><span className={`badge ${IST[i.status] || 'grey'}`}>{i.status}</span></td>
            <td className="nowrap"><button className="btn xs" onClick={() => details(i)}>Details</button> <button className="btn xs" onClick={() => openFrom(`/finance/invoices/${i.id}/pdf`).catch(showError)}>PDF</button></td></tr>))
          : <tr><td colSpan={8} className="empty">No invoices yet</td></tr>}
      </tbody></table></div></div>
    </>); }}</Page>;
}
function InvoiceDetail({ i, queries, preview, close, done }: { i: Any; queries: Any[]; preview: boolean; close: () => void; done: () => void }) {
  const open = ['Invoiced', 'Partially paid', 'Overdue'].includes(i.status) && i.kind === 'invoice';
  const [pay, setPay] = useState<Vals>({ amount: i.balance });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [line, setLine] = useState(''); const [body, setBody] = useState('');
  const fields: Field[] = [{ k: 'amount', label: `Amount paid (${i.currency})`, type: 'number', req: true, col: 2 }, { k: 'payment_date', label: 'Payment date', type: 'date', req: true, col: 2 },
    { k: 'reference', label: 'Bank reference / transaction ID', req: true, col: 2 }, { k: 'proof', label: 'Proof (PDF / JPG / PNG)', type: 'file', accept: '.pdf,.jpg,.jpeg,.png', col: 3 }, { k: 'note', label: 'Note', col: 3 }];
  const submitPay = async () => {
    setErrors({});
    try { const r = await SEND('post', `/finance/invoices/${i.id}/payments`, toFormData(pay)); if (r.warning) toast(r.warning); toast('Payment proof sent. La Europa will confirm it.', 'ok'); close(); done(); }
    catch (e) { if (e instanceof ApiError && e.data.errors) setErrors(e.data.errors); showError(e); }
  };
  const query = async () => {
    const open0 = queries.find((x) => x.status === 'Open');
    try { await POST(`/finance/invoices/${i.id}/queries`, { body, commission_id: line || null, query_id: open0?.id }); toast('Query sent to La Europa', 'ok'); close(); done(); } catch (e) { showError(e); }
  };
  return (
    <Modal title={`${i.invoice_no}: ${i.status}`} size="lg" close={close}>
      <table className="tbl"><thead><tr><th>Student</th><th>Application</th><th>Course / intake</th><th>Amount</th></tr></thead><tbody>
        {i.lines.map((l: Any) => <tr key={l.id}><td>{l.student_name}</td><td>{l.application_code || '-'}</td><td>{l.course} ({l.intake})</td><td>{money(l.amount, l.currency)}</td></tr>)}</tbody></table>
      <h3>Payments</h3>
      {i.payments.length ? i.payments.map((p: Any) => <div key={p.id} className="small">{money(p.amount, p.currency)} on {fmtDate(p.payment_date)} · ref {p.reference || '-'} · <b>{p.status}</b>{p.reject_reason ? ' - ' + p.reject_reason : ''}</div>) : <div className="small muted">None yet</div>}
      {open && !preview ? <><h3>Upload payment proof</h3><form noValidate onSubmit={(e) => e.preventDefault()}><FormGrid fields={fields} vals={pay} set={(k, x) => setPay((s) => ({ ...s, [k]: x }))} errors={errors} /></form>
        <button className="btn primary sm" onClick={submitPay}>Submit payment proof</button></> : null}
      <h3>Questions about this invoice</h3>
      {queries.map((q) => <div key={q.id} className="req"><b>Query {q.status}</b>{q.messages.map((m: Any) => <div key={m.id} className="small"><b>{m.sender}:</b> {m.body} <span className="muted">{fmtDT(m.sent_at)}</span></div>)}</div>)}
      {preview ? null : <>
        <div className="row" style={{ gap: 6, marginTop: 6 }}>
          <select className="input" style={{ width: 220 }} value={line} onChange={(e) => setLine(e.target.value)}><option value="">Whole invoice</option><Options list={i.lines.map((l: Any) => [l.id, l.student_name])} /></select>
          <input className="input grow" placeholder="For example: Student not enrolled" value={body} onChange={(e) => setBody(e.target.value)} /><button className="btn sm" onClick={query}>Raise query</button></div>
        <p className="small muted">A query pauses payment reminders until La Europa closes it.</p></>}
    </Modal>
  );
}

const RL: [string, string][] = [['admin', 'University Admin'], ['officer', 'Admissions Officer'], ['viewer', 'University Viewer']];
const ALERTS: [string, string][] = [['applications', 'New applications'], ['messages', 'Messages'], ['deadlines', 'Deadlines and reminders'], ['finance', 'Finance']];
export function Users() {
  const st = useLoad(() => GET('/users'), []);
  return <Page state={st}>{() => { const d = st.data as Any;
    const form = (u: Any | null) => formModal({ title: u ? 'Edit user' : 'Add user', saveLabel: u ? 'Save' : 'Add and invite',
      intro: u ? null : <p className="small muted" style={{ marginTop: 0 }}>The user gets an invite email. Personal work emails only; shared mailboxes should not be used.</p>,
      values: u ? { ...u, alerts: u.alerts || ALERTS.map((a) => a[0]) } : { role: 'officer', alerts: ['applications', 'messages', 'deadlines'], campuses: [] },
      fields: [{ k: 'name', label: 'Full name', req: true, col: 3 }, ...(u ? [] : [{ k: 'email', label: 'Work email (login)', type: 'email', req: true, col: 3 } as Field]),
        { k: 'role', label: 'Role', type: 'select', noBlank: true, opts: RL, col: 3 }, { k: 'finance', label: 'Finance access (commission and invoices)', type: 'checkbox', col: 3 },
        { k: 'department', label: 'Department', type: 'select', opts: ['Admissions', 'International Office', 'Finance', 'Faculty', 'Management', 'Other'], col: 3 }, { k: 'phone', label: 'Phone', col: 3 },
        { k: 'campuses', label: 'Campuses (empty = all)', type: 'multi', opts: d.campuses, col: 6 }, { k: 'alerts', label: 'Email alerts', type: 'multi', opts: ALERTS, col: 6 }],
      save: async (b) => { const r = u ? await PUT('/users/' + u.id, b) : await POST('/users', b); if (r.warning) toast(r.warning); st.reload(); return true; } });
    const act = async (u: Any, a: string) => {
      if (!a) return;
      if (a === 'deactivate' && !(await confirmBox('Are you sure?', { danger: true, ok: 'Deactivate' }))) return;
      try { await POST(`/users/${u.id}/${a}`); toast('Done', 'ok'); st.reload(); } catch (e) { showError(e); }
    };
    return (<>
      <div className="page-head"><h1>Users</h1><span className="muted small">{d.rows.filter((u: Any) => u.status !== 'Inactive').length} of {d.max} allowed</span><span className="grow" /><button className="btn primary" onClick={() => form(null)}>+ Add user</button></div>
      <label className="row small" style={{ gap: 6, marginBottom: 10 }}><input type="checkbox" defaultChecked={d.officers_propose} onChange={async (e) => { try { await PUT('/settings/officers-propose', { on: e.target.checked }); toast('Saved', 'ok'); refreshMe(); } catch (er) { showError(er); } }} /> Admissions Officers can propose course changes</label>
      <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Finance</th><th>Status</th><th>Last login</th><th /></tr></thead><tbody>
        {d.rows.map((u: Any) => (
          <tr key={u.id}><td><b>{u.name}</b>{u.main ? <> <span className="badge blue">Main contact</span></> : null}</td><td className="small">{u.email}</td><td>{u.role_label}</td><td>{u.finance ? '✓' : ''}</td>
            <td><span className={`badge ${u.status === 'Active' ? 'green' : u.status === 'Invited' ? 'orange' : 'grey'}`}>{u.status}</span></td><td className="small">{u.last_login_at ? ago(u.last_login_at) : '-'}</td>
            <td className="nowrap"><button className="btn xs" onClick={() => form(u)}>Edit</button>{' '}
              <select className="input" style={{ width: 'auto', height: 28, fontSize: 12 }} value="" onChange={(e) => act(u, e.target.value)}><option value="">More...</option>
                {u.status === 'Invited' ? <option value="resend">Resend invite</option> : null}{u.status === 'Inactive' ? <option value="activate">Activate</option> : <option value="deactivate">Deactivate</option>}<option value="logout">Force logout</option></select></td></tr>))}
      </tbody></table></div></div>
      <div className="card" style={{ marginTop: 14 }}><div className="hd"><h2>Activity of your users</h2></div><div className="table-wrap" style={{ maxHeight: 340, overflow: 'auto' }}><table className="tbl"><tbody>
        {d.activity.length ? d.activity.map((a: Any, k: number) => <tr key={k}><td className="small nowrap">{fmtDT(a.created_at)}</td><td className="small">{a.user || '-'}</td><td className="small">{a.action} {a.entity_type || ''}</td><td className="small muted">{a.entity_label || ''}</td><td className="small muted">{a.ip || ''}</td></tr>)
          : <tr><td className="empty">No activity yet</td></tr>}</tbody></table></div></div>
    </>); }}</Page>;
}

export function Account() {
  const st = useLoad(() => GET('/account'), []);
  const [prof, setProf] = useState<Vals | null>(null); const [alerts, setAlerts] = useState<string[] | null>(null);
  const [pw, setPw] = useState<Vals>({}); const [errs, setErrs] = useState<Record<string, string>>({});
  return <Page state={st}>{() => { const d = st.data as Any; const me = d.me;
    const p = prof ?? { name: me.name, designation: me.designation ?? '', phone: me.phone ?? '' };
    const al = alerts ?? (me.alerts || ALERTS.map((a) => a[0]));
    const locked = (k: string) => me.main_contact && (k === 'applications' || (k === 'finance' && me.finance));
    const saveProfile = async () => { try { await PUT('/account', p); toast('Saved', 'ok'); refreshMe(); } catch (e) { showError(e); } };
    const savePw = async () => {
      setErrs({});
      try { const r = await PUT('/account/password', pw); if (r.token) signIn(r.token); toast('Password changed. Other devices were logged out.', 'ok'); setPw({}); refreshMe(); }
      catch (e) { if (e instanceof ApiError && e.data.errors) setErrs(e.data.errors); showError(e); }
    };
    const others = async () => { try { const r = await POST('/account/logout-others'); if (r.token) signIn(r.token); toast('Done', 'ok'); refreshMe(); } catch (e) { showError(e); } };
    return (<>
      <div className="page-head"><h1>My account</h1></div>
      <div className="grid two"><div className="grid" style={{ gap: 14 }}>
        <div className="card"><div className="hd"><h2>Profile</h2></div><div className="bd">
          <FormGrid fields={[{ k: 'name', label: 'Full name', req: true, col: 6 }, { k: 'designation', label: 'Designation', col: 3 }, { k: 'phone', label: 'Phone', col: 3 }]} vals={p} set={(k, x) => setProf({ ...p, [k]: x })} />
          <div className="small muted">{me.email} · {me.role_label} · {me.university.name}</div><div className="form-actions"><button className="btn primary" onClick={saveProfile}>Save</button></div></div></div>
        <div className="card"><div className="hd"><h2>Email alerts</h2></div><div className="bd">
          {[['applications', 'New applications'], ['messages', 'Messages from La Europa'], ['deadlines', 'Deadlines and reminders'], ['finance', 'Finance (invoices)']].map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 8, padding: '4px 0' }}><input type="checkbox" disabled={locked(k)} checked={locked(k) || al.includes(k)}
              onChange={(e) => setAlerts(e.target.checked ? [...al, k] : al.filter((x: string) => x !== k))} /> {l}</label>))}
          {me.main_contact ? <p className="small muted">As main contact you always receive new-application and invoice emails.</p> : null}
          <div className="form-actions"><button className="btn primary" onClick={async () => { try { await PUT('/account', { alerts: al }); toast('Saved', 'ok'); } catch (e) { showError(e); } }}>Save</button></div></div></div>
        <div className="card"><div className="hd"><h2>Change password</h2></div><div className="bd">
          <FormGrid fields={[{ k: 'current', label: 'Current password', type: 'password', req: true, col: 6 }, { k: 'password', label: 'New password (min 10, letter, number, symbol)', type: 'password', req: true, col: 3 }, { k: 'confirm', label: 'Confirm', type: 'password', req: true, col: 3 }]}
            vals={pw} set={(k, x) => setPw((s) => ({ ...s, [k]: x }))} errors={errs} />
          <div className="form-actions"><button className="btn primary" onClick={savePw}>Change password</button></div></div></div>
      </div>
      <div className="grid" style={{ gap: 14 }}>
        <div className="card"><div className="hd"><h2>Active devices</h2><span className="grow" /><button className="btn sm" onClick={others}>Log out of all other devices</button></div><div className="bd flush">
          <div className="rowx"><b>{typeof navigator !== 'undefined' && /Mobile|Android|iPhone/i.test(navigator.userAgent) ? 'Phone' : 'Computer'}</b> <span className="badge green">This device</span></div></div></div>
        <div className="card"><div className="hd"><h2>Accepted terms</h2></div><div className="bd small">
          {d.consents.length ? d.consents.map((c: Any, k: number) => <div key={k}>{c.doc_type === 'uni_terms' ? 'Portal Terms of Use' : 'Data Processing terms'} v{c.version || ''} · {fmtDT(c.createdAt)}</div>) : '-'}</div></div>
      </div></div>
    </>); }}</Page>;
}

export function Notifications() {
  const st = useLoad(() => GET('/notifications'), []);
  return <Page state={st}>{() => { const d = st.data as Any;
    return (<>
      <div className="page-head"><h1>Notifications</h1><span className="grow" /><button className="btn sm" onClick={async () => { await POST('/notifications/read', { all: true }); st.reload(); }}>Mark all read</button></div>
      <div className="card"><div className="bd flush">{d.rows.length ? d.rows.map((n: Any) => (
        <Link key={n.id} className={`notif ${n.is_read ? '' : 'unread'}`} href={n.link || '/notifications'} onClick={() => { POST('/notifications/read', { ids: [n.id] }).catch(() => {}); }}>{n.title}<div className="when">{fmtDT(n.created_at)}</div></Link>))
        : <div className="empty">No notifications</div>}</div></div>
    </>); }}</Page>;
}
void Modal;
