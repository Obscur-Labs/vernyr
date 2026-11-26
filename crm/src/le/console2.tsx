'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { GET, POST, PUT, download } from './api';
import { fmtDate, fmtDT, qs } from './format';
import { Options, formModal, type Field, type Vals } from './form';
import { Modal, confirmBox, openOverlay, showError, toast } from './ui';
import { Kv, Loading, Pill, act, amt, formErrs, useConsole, useLoad, type Any, type Q } from './console';

/** The client's Admin console, part 2 (legacy/public/js/pages/console2.js): money, communication, documents, insights, health, settings, company. */

const local = (h: string) => String(h ?? '').replace(/^#/, '');
const file = (url: string, name?: string) => download(url, name || 'file', !name).catch(showError);
const fyList = () => { const t = new Date(); const y = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1; return [0, 1, 2].map((i) => `${y - i}-${String(y - i + 1).slice(2)}`); };

// ---------- Money ----------
export function Reconciliation() {
  const { q, go, can } = useConsole();
  const [d, , err] = useLoad('/console/reconciliation' + qs(q));
  if (!d) return <Loading err={err} />;
  const f = (k: string) => ({ value: q[k] || '', onChange: (e: React.ChangeEvent<HTMLSelectElement>) => go('reconciliation', { ...q, [k]: e.target.value }) });
  return (
    <>
      <div className="filters">
        <select {...f('fy')}><option value="">All years</option><Options list={fyList()} /></select><select {...f('quarter')}><option value="">All quarters</option><Options list={['Q1', 'Q2', 'Q3', 'Q4']} /></select>
        <select {...f('university')}><option value="">All universities</option><Options list={d.universities} /></select><select {...f('status')}><option value="">All statuses</option><Options list={d.statuses} /></select>
        <span className="grow" /><button type="button" className="btn sm" onClick={() => file('/console/reconciliation/export' + qs(q), 'reconciliation.xlsx')}>Export Excel</button>
      </div>
      <div className="money-tiles">{[['University commission received', amt(d.cards.received)], ['Exceptions', d.cards.exceptions]].map(([l, v]) => <div key={l} className="t"><div className="l">{l}</div><div className="v">{String(v)}</div></div>)}</div>
      <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th>Enrolment</th><th>University commission<br /><span className="small muted">expected / invoiced / received</span></th>{d.show_net ? <th>Net to La Europa</th> : null}<th>Status</th><th /></tr></thead><tbody>
        {d.rows.length ? d.rows.map((x: Any) => (
          <tr key={x.application_id}><td><b>{x.student}</b><div className="small muted">{x.application_code} · {x.university || ''} · {x.intake || ''}{x.enrolled ? ' · enrolled ' + fmtDate(x.enrolled) : ''}</div></td>
            <td className="small">{x.uni.expected} / {x.uni.invoiced} / <b>{x.uni.received}</b> {x.uni.currency}</td>
            {d.show_net ? <td className="small">{x.net !== null ? <><b>{x.net}</b> {x.uni.currency}</> : x.net_note}</td> : null}
            <td><Pill s={x.status} />{x.exception ? <div className="small" style={{ color: 'var(--error-ink)' }}>{x.exception}</div> : null}</td>
            <td>{x.exception && can('reconciliation', 'edit') ? <button className="btn xs" onClick={act(async () => { await POST('/console/reconciliation/task', { application_id: x.application_id, title: x.exception }); toast('Task created', 'ok'); })}>Create task</button> : null}</td></tr>
        )) : <tr><td colSpan={5} className="empty">No enrolments with commission yet</td></tr>}</tbody></table></div></div>
      <p className="small muted">Amounts are per currency; no automatic conversion.</p>
    </>
  );
}

function Packages() {
  const { can } = useConsole();
  const [d, load, err] = useLoad('/console/packages');
  if (!d) return <Loading err={err} />;
  const fields: Field[] = [{ k: 'name', label: 'Package name', req: true, col: 3 }, { k: 'default_fee', label: 'Default fee (INR)', type: 'number', req: true, col: 3 }, { k: 'gst_percent', label: 'GST % (empty = global setting)', type: 'number', col: 3 }, { k: 'active', label: 'Active', type: 'checkbox', col: 3 },
    { k: 'inst', label: 'Instalments: one per line as name | % or amount | due rule (e.g. On registration | 50% | on registration)', type: 'textarea', rows: 4 }, { k: 'refund_policy', label: 'Refund policy text (by La Europa)', type: 'textarea' }];
  const toBody = (v: Vals) => ({ ...v, instalments: String(v.inst || '').split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((x) => x[0])
    .map(([name, val, due]) => ({ name, percent: /%$/.test(val || '') ? parseFloat(val) : null, amount: val && !/%$/.test(val) ? parseFloat(val) : null, due_rule: due })) });
  const edit = (p: Any | null) => act(async () => {
    if (await formModal({ title: p ? 'Edit package' : 'New package', fields, values: p ? { ...p, inst: (p.instalments || []).map((i: Any) => `${i.name} | ${i.percent ? i.percent + '%' : i.amount || ''} | ${i.due_rule || ''}`).join('\n') } : { active: true },
      save: (v) => POST('/console/packages', p ? { ...toBody(v), id: p.id } : toBody(v)) })) load();
  });
  return (
    <div className="card"><div className="hd"><h2>Service packages</h2><span className="grow" />{can('fees', 'edit') ? <button className="btn sm primary" onClick={edit(null)}>+ Package</button> : null}</div><div className="table-wrap"><table className="tbl"><tbody>
      {d.rows.length ? d.rows.map((p: Any) => (
        <tr key={p.id}><td><b>{p.name}</b>{p.active ? null : <> <span className="badge grey">Inactive</span></>}<div className="small muted">{(p.instalments || []).map((i: Any) => `${i.name}: ${i.percent ? i.percent + '%' : i.amount ? 'INR ' + i.amount : ''} ${i.due_rule || ''}`).join(' · ')}</div></td>
          <td className="right">INR {Number(p.default_fee || 0).toLocaleString('en-IN')}</td><td>{can('fees', 'edit') ? <button className="btn xs" onClick={edit(p)}>Edit</button> : null}</td></tr>
      )) : <tr><td className="empty">No packages. Names and fees are entered by La Europa.</td></tr>}</tbody></table></div></div>
  );
}
function Payments({ tab }: { tab: string }) {
  const { q, go } = useConsole();
  const [d, load, err] = useLoad('/console/payments' + qs({ from: q.from, to: q.to, payment_for: q.payment_for }));
  if (!d) return <Loading err={err} />;
  if (tab === 'discounts') return (
    <>
      <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th>Month</th><th>Student</th><th>Discount</th><th>Requested by</th><th>Reason (internal)</th><th>Status</th></tr></thead><tbody>
        {d.discounts.length ? d.discounts.map((x: Any, i: number) => <tr key={i}><td>{x.month}</td><td>{x.student}</td><td>INR {x.amount}</td><td>{x.by}</td><td className="small">{x.reason || ''}</td><td><Pill s={x.status} />{x.decided ? <div className="small muted">{x.decided}</div> : null}</td></tr>)
          : <tr><td colSpan={6} className="empty">No discounts</td></tr>}</tbody></table></div></div>
      <p className="small muted">Discounts above a role&apos;s limit (role builder) wait in the approvals centre and are not applied until approved.</p>
    </>
  );
  const f = (k: string) => ({ value: q[k] || '', onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => go('fees', { ...q, tab: 'payments', [k]: e.target.value }) });
  const refund = act(async () => {
    if (await formModal({ title: 'Record refund (needs approval)', intro: <p className="small muted">A refund is a negative payment. It counts only after a Finance Admin or Super Admin approves it.</p>, values: { currency: 'INR', payment_for: 'La Europa service fee' },
      fields: [{ k: 'student_code', label: 'Student ID (e.g. LE-S-2026-00001)', req: true, col: 3 }, { k: 'amount', label: 'Amount', type: 'number', req: true, col: 3 }, { k: 'currency', label: 'Currency', type: 'select', noBlank: true, opts: ['INR', 'EUR'], col: 3 },
        { k: 'payment_for', label: 'For', type: 'select', noBlank: true, opts: ['La Europa service fee', 'Tuition fee / deposit', 'Application fee', 'Other'], col: 3 }, { k: 'reason', label: 'Reason', req: true }],
      save: (v) => POST('/console/refunds', v) })) { toast('Refund sent for approval', 'ok'); load(); }
  });
  return (
    <>
      <div className="filters"><input type="date" {...f('from')} /><input type="date" {...f('to')} />
        <select {...f('payment_for')}><option value="">All payments</option><Options list={['La Europa service fee', 'Tuition fee / deposit', 'Application fee', 'Visa fee', 'Other']} /></select>
        <span className="grow" />{d.can_refund ? <button type="button" className="btn sm" onClick={refund}>Record refund</button> : null}</div>
      <div className="money-tiles">{d.totals.map((x: Any, i: number) => <div key={i} className="t"><div className="l">{x.payment_for}</div><div className="v">{Number(x.amount).toLocaleString('en-IN')} {x.currency}</div></div>)}</div>
      {d.proofs.length ? <div className="banner warn">{d.proofs.length} student payment proof(s) waiting more than 2 working days: {d.proofs.slice(0, 5).map((p: Any, i: number) => <span key={i}>{i ? ', ' : ''}<Link href={`/students/${p.student_id}/fees`}>{p.student}</Link></span>)}</div> : null}
      <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th>Date</th><th>Student</th><th>For</th><th className="right">Amount</th><th>Mode</th><th>Recorded by</th><th /></tr></thead><tbody>
        {d.rows.length ? d.rows.map((x: Any) => (
          <tr key={x.id}><td className="small">{fmtDate(x.date)}</td><td><Link href={`/students/${x.student_id}/fees`}>{x.student}</Link></td>
            <td className="small">{x.payment_for}{x.is_refund ? <> <Pill s={'Refund ' + (x.refund_status || '')} c={x.refund_status === 'Approved' ? 'green' : 'orange'} /><div className="muted">{x.refund_reason || ''}</div></> : null}</td>
            <td className="right">{Number(x.amount).toLocaleString('en-IN')} {x.currency}</td><td className="small">{x.mode}{x.reference ? ' · ' + x.reference : ''}</td><td className="small">{x.by || ''}</td>
            <td>{x.payment_for === 'La Europa service fee' && !x.is_refund ? <button className="btn xs" onClick={() => file(`/console/payments/${x.id}/receipt`)}>Receipt</button> : null}</td></tr>
        )) : <tr><td colSpan={7} className="empty">No payments</td></tr>}</tbody></table></div></div>
    </>
  );
}
export function Fees() {
  const { q } = useConsole();
  const tab = q.tab || 'packages';
  return (
    <>
      <div className="tabs" style={{ marginBottom: 10 }}>{[['packages', 'Service packages'], ['payments', 'Payments and refunds'], ['discounts', 'Discounts']].map(([k, l]) => <Link key={k} href={`/console/fees?tab=${k}`} className={k === tab ? 'on' : ''}>{l}</Link>)}</div>
      {tab === 'packages' ? <Packages /> : <Payments tab={tab} />}
    </>
  );
}

// ---------- Communication ----------
export function ConsoleTemplates() {
  const { q } = useConsole();
  const [d, load, err] = useLoad('/console/templates');
  const [senders, setSenders] = useState<Vals | null>(null);
  const [serr, setSerr] = useState<Record<string, string>>({});
  useEffect(() => { if (d) setSenders({ sending_address: d.senders.student || '', uni_sending_address: d.senders.university || '', uni_noreply_address: d.senders.security || '' }); }, [d]);
  if (!d || !senders) return <Loading err={err} />;
  const groups = ['Student', 'University', 'Staff', 'Security'], g = groups.includes(q.group) ? q.group : '';
  const rows = [...d.rows, ...d.security].filter((r: Any) => !g || r.group === g);
  const put = (code: string, body: Any) => act(async () => { await PUT('/console/templates/' + code, body); toast('Saved', 'ok'); load(); });
  const saveSenders = async (e: React.FormEvent) => { e.preventDefault(); setSerr({}); try { await PUT('/console/senders', senders); toast('Saved', 'ok'); } catch (er) { formErrs(setSerr)(er); } };
  return (
    <>
      <div className="banner">CC: <b>{d.cc}</b> (always). It is added by the email service to every email and cannot be removed by any role, template or setting. Security emails go only to the user.</div>
      <div className="tabs" style={{ marginBottom: 10 }}><Link href="/console/templates" className={!g ? 'on' : ''}>All</Link>{groups.map((x) => <Link key={x} href={`/console/templates?group=${x}`} className={x === g ? 'on' : ''}>{x}</Link>)}</div>
      <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th>Code</th><th>Group</th><th>Trigger</th><th>On</th><th>Always to student</th><th>Version</th><th /></tr></thead><tbody>
        {rows.map((t: Any) => (
          <tr key={t.code}><td><b>{t.code}</b></td><td>{t.group}</td><td className="small">{t.name}{t.note ? <div className="muted">{t.note}</div> : null}</td>
            <td>{t.locked ? '🔒 On' : <input type="checkbox" checked={!!t.on} disabled={!d.can_edit} onChange={put(t.code, { on: !t.on })} />}</td>
            <td>{t.group === 'Student' ? <input type="checkbox" checked={!!t.always_to_student} disabled={!d.can_edit} onChange={put(t.code, { always_to_student: !t.always_to_student })} /> : null}</td>
            <td className="small">{t.version ? 'v' + t.version : ''}{t.edited_by ? <div className="muted">{t.edited_by} {fmtDate(t.edited_at)}</div> : null}</td>
            <td>{t.group !== 'Security' ? <Link className="btn xs" href={`/admin/templates/${encodeURIComponent(t.code)}`}>Edit</Link> : null}</td></tr>
        ))}</tbody></table></div></div>
      <div className="card" style={{ marginTop: 14 }}><div className="hd"><h2>Sender addresses</h2></div><div className="bd"><form noValidate onSubmit={saveSenders}>
        <div className="form-grid">{([['sending_address', 'Student emails (counselling@)'], ['uni_sending_address', 'University emails (partners@)'], ['uni_noreply_address', 'Security / no-reply']] as [string, string][]).map(([k, l]) => (
          <div key={k} className={`f c3${serr[k] ? ' err' : ''}`}><label>{l}</label><input value={String(senders[k] ?? '')} disabled={!d.can_edit} onChange={(e) => setSenders({ ...senders, [k]: e.target.value })} /><div className="msg">{serr[k] ?? ''}</div></div>))}</div>
        {d.can_edit ? <button className="btn primary" style={{ marginTop: 8 }}>Save senders</button> : null}<p className="small muted">SPF, DKIM and DMARC must be set on the sending domain.</p>
      </form></div></div>
    </>
  );
}

export function EmailLog() {
  const { q, go, can } = useConsole();
  const [d, load, err] = useLoad('/console/email-log' + qs(q));
  const [s, setS] = useState(q.q || ''), [code, setCode] = useState(q.code || '');
  if (!d) return <Loading err={err} />;
  const st = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none';
  const f = (k: string) => ({ value: q[k] || '', onChange: (e: React.ChangeEvent<HTMLSelectElement>) => go('email-log', { ...q, page: '', [k]: e.target.value }) });
  const page = (p: number) => `/console/email-log${qs({ ...q, page: p })}`;
  return (
    <>
      <div className="money-tiles"><div className="t"><div className="l">Last 24 hours</div><div className="v" style={{ fontSize: 13 }}>{st(d.stats.day)}</div></div><div className="t"><div className="l">Last 7 days</div><div className="v" style={{ fontSize: 13 }}>{st(d.stats.week)}</div></div><div className="t"><div className="l">Bounces (7 days)</div><div className="v">{d.bounces.length}</div></div></div>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); go('email-log', { ...q, page: '', q: s, code }); }}>
        <input type="search" placeholder="Recipient or subject" value={s} onChange={(e) => setS(e.target.value)} onBlur={() => go('email-log', { ...q, page: '', q: s, code })} />
        <select {...f('recipient_type')}><option value="">All recipients</option><Options list={[['student', 'Student'], ['university', 'University'], ['staff', 'Staff'], ['external', 'Other']]} /></select>
        <select {...f('status')}><option value="">All statuses</option><Options list={['Queued', 'Retrying', 'Sent', 'Delivered', 'Opened', 'Bounced', 'Failed', 'Cancelled']} /></select>
        <input placeholder="Code (E01)" style={{ width: 110 }} value={code} onChange={(e) => setCode(e.target.value)} onBlur={() => go('email-log', { ...q, page: '', q: s, code })} />
      </form>
      <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th>Queued</th><th>Code</th><th>To</th><th>CC</th><th>Subject</th><th>Status</th><th /></tr></thead><tbody>
        {d.rows.length ? d.rows.map((x: Any) => (
          <tr key={x.id}><td className="small">{fmtDT(x.queued_at)}</td><td>{x.trigger_code}<div className="small muted">{x.recipient_type}</div></td><td className="small">{x.to_addr}</td><td className="small">{x.cc_addr || d.cc}</td>
            <td className="small">{x.subject || x.update_title || ''}</td><td><Pill s={x.status} />{x.error ? <div className="small muted">{String(x.error).slice(0, 80)}</div> : null}</td>
            <td>{['Failed', 'Bounced', 'Cancelled'].includes(x.status) && can('templates', 'edit') ? <button className="btn xs" onClick={act(async () => { await POST(`/console/email-log/${x.id}/resend`); toast('Queued again', 'ok'); load(); })}>Resend</button> : null}
              {x.status === 'Bounced' && x.student_id ? <> <Link className="btn xs" href={`/students/${x.student_id}`}>Fix email</Link></> : null}</td></tr>
        )) : <tr><td colSpan={7} className="empty">No emails</td></tr>}</tbody></table></div>
        <div className="pager"><span className="grow small muted">{d.total} email(s)</span>{d.page > 1 ? <Link className="btn sm" href={page(d.page - 1)}>Previous</Link> : null}{d.page * 50 < d.total ? <Link className="btn sm" href={page(d.page + 1)}>Next</Link> : null}</div></div>
      <p className="small muted">Email log entries cannot be edited or deleted. An alert goes to Admins when failures in one hour exceed the setting.</p>
    </>
  );
}

export function Channels() {
  const { can } = useConsole();
  const [d, setD] = useState<Any | null>(null), [n, setN] = useState<Any | null>(null);
  const [v, setV] = useState<Any>({});
  const [err, setErr] = useState<unknown>(null), [ferr, setFerr] = useState<Record<string, string>>({});
  useEffect(() => {
    Promise.all([GET('/console/channels'), can('settings') ? GET('/console/notification-types') : Promise.resolve(null)]).then(([c, nt]) => {
      setD(c); setN(nt);
      setV({ sms_enabled: !!c.sms.enabled, sms_provider: c.sms.provider ?? '', sms_sender_id: c.sms.sender_id ?? '', sms_dlt_entity: c.sms.dlt_entity ?? '', sms_dlt_template: c.sms.dlt_template ?? '', sms_daily_limit: c.sms.daily_limit ?? '', sms_api_key: '',
        wa_enabled: !!c.whatsapp.enabled, wa_provider: c.whatsapp.provider ?? '', wa_phone: c.whatsapp.phone ?? '', wa_optin: c.whatsapp.optin ?? '', wa_api_key: '' });
    }).catch(setErr);
  }, [can]);
  if (!d) return <Loading err={err} />;
  const dis = !d.can_edit;
  const inp = (k: string, extra: Any = {}) => <input value={v[k]} disabled={dis} onChange={(e) => setV({ ...v, [k]: e.target.value })} {...extra} />;
  const chk = (k: string, id: string, label: string) => <div className="f c6 check"><input type="checkbox" id={id} checked={!!v[k]} disabled={dis} onChange={(e) => setV({ ...v, [k]: e.target.checked })} /><label htmlFor={id}>{label}</label></div>;
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setFerr({});
    try { await PUT('/console/channels', { sms: { enabled: v.sms_enabled, provider: v.sms_provider, sender_id: v.sms_sender_id, dlt_entity: v.sms_dlt_entity, dlt_template: v.sms_dlt_template, daily_limit: v.sms_daily_limit, api_key: v.sms_api_key || undefined },
      whatsapp: { enabled: v.wa_enabled, provider: v.wa_provider, phone: v.wa_phone, optin: v.wa_optin, api_key: v.wa_api_key || undefined } }); toast('Saved', 'ok'); } catch (er) { formErrs(setFerr)(er); }
  };
  const test = (channel: string) => act(async () => { const r = await POST('/console/channels/test', { channel }); openOverlay((close) => <Modal title="Test result" size="sm" close={close}><p>{r.result}</p></Modal>); });
  const toggleNt = (key: string, on: boolean) => act(async () => {
    const rows = n!.rows.map((r: Any) => (r.key === key ? { ...r, on } : r)); setN({ ...n, rows });
    await PUT('/console/notification-types', { off: rows.filter((r: Any) => !r.on && !r.mandatory).map((r: Any) => r.key) }); toast('Saved', 'ok');
  });
  return (
    <div className="grid two">
      <div className="card"><div className="hd"><h2>SMS (OTP only)</h2></div><div className="bd"><form noValidate onSubmit={save}>
        <div className="form-grid">{chk('sms_enabled', 'se', 'SMS on')}
          <div className="f c3"><label>Provider</label>{inp('sms_provider')}</div><div className={`f c3${ferr.sms_sender_id ? ' err' : ''}`}><label>DLT sender ID</label>{inp('sms_sender_id', { maxLength: 6 })}<div className="msg">{ferr.sms_sender_id ?? ''}</div></div>
          <div className="f c3"><label>DLT entity ID</label>{inp('sms_dlt_entity')}</div><div className="f c3"><label>DLT template ID</label>{inp('sms_dlt_template')}</div>
          <div className="f c3"><label>Daily limit</label>{inp('sms_daily_limit', { type: 'number' })}</div><div className="f c3"><label>API key {d.sms.key_on_file ? '(saved; leave empty to keep)' : ''}</label>{inp('sms_api_key', { type: 'password', autoComplete: 'off' })}</div></div>
        <h3 style={{ margin: '14px 0 6px' }}>WhatsApp Business (optional)</h3>
        <div className="form-grid">{chk('wa_enabled', 'we', 'WhatsApp on (email still always sent with CC)')}
          <div className="f c3"><label>Provider</label>{inp('wa_provider')}</div><div className="f c3"><label>Phone number</label>{inp('wa_phone')}</div>
          <div className="f c6"><label>Opt-in rule</label>{inp('wa_optin')}</div><div className="f c6"><label>API key {d.whatsapp.key_on_file ? '(saved)' : ''}</label>{inp('wa_api_key', { type: 'password', autoComplete: 'off' })}</div></div>
        {d.can_edit ? <div className="row" style={{ gap: 8, marginTop: 10 }}><button className="btn primary">Save</button><button type="button" className="btn" onClick={test('sms')}>Test SMS</button><button type="button" className="btn" onClick={test('whatsapp')}>Test WhatsApp</button></div>
          : <p className="small muted">Only a Super Admin can change channels.</p>}
      </form><p className="small muted">No SMS or WhatsApp provider is connected in this build; settings are stored (keys encrypted) and the test reports what is missing.</p></div></div>
      {n ? <div className="card"><div className="hd"><h2>Staff in-app notifications</h2></div><div className="bd">{n.rows.map((r: Any) => (
        <label key={r.key} className="row small" style={{ gap: 6, padding: '4px 0' }}><input type="checkbox" checked={!!r.on} disabled={r.mandatory || !can('settings', 'edit')} onChange={(e) => toggleNt(r.key, e.target.checked)()} /> {r.label}{r.mandatory ? <> <span className="muted">(mandatory)</span></> : null}</label>
      ))}</div></div> : null}
    </div>
  );
}

function NewAnnouncement({ d, close, done }: { d: Any; close: () => void; done: () => void }) {
  const [v, setV] = useState<Any>({ title: '', body: '', a_staff: false, staff_branch: '', staff_team: '', a_students: false, st_country: '', st_intake: '', a_unis: false, uni_ids: [] as string[], c_banner: true, c_dashboard: false, c_email: false, publish_at: '', expire_at: '', priority: 'Normal' });
  const [err, setErr] = useState<Record<string, string>>({});
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });
  const iso = (x: string) => (x ? new Date(x + ':00+05:30').toISOString() : null);
  const go = async () => {
    setErr({});
    const body = { title: v.title, body: v.body, priority: v.priority, publish_at: iso(v.publish_at), expire_at: iso(v.expire_at), channels: ['banner', 'dashboard', 'email'].filter((c) => v['c_' + c]),
      audience: { staff: { on: v.a_staff, branch: v.staff_branch, team: v.staff_team }, students: { on: v.a_students, country: v.st_country, intake: v.st_intake }, universities: { on: v.a_unis, ids: v.uni_ids } } };
    try { const r = await POST('/console/announcements', body); close(); toast(r.counts ? `Published: ${Object.entries(r.counts).map(([k, x]) => `${k} ${x}`).join(', ')}` : 'Scheduled', 'ok'); done(); } catch (e) { formErrs(setErr)(e); }
  };
  const F = (k: string, label: string, child: React.ReactNode, c = 6) => <div className={`f c${c}${err[k] ? ' err' : ''}`}><label>{label}</label>{child}<div className="msg">{err[k] ?? ''}</div></div>;
  return (
    <Modal title="New announcement" size="lg" close={close} foot={<button className="btn primary" onClick={go}>Publish / schedule</button>}>
      <form noValidate onSubmit={(e) => e.preventDefault()}><div className="form-grid">
        {F('title', 'Title', <input maxLength={150} value={v.title} onChange={set('title')} />)}
        {F('body', 'Message', <textarea rows={5} value={v.body} onChange={set('body')} />)}
        {F('audience', 'Audience', <>
          <div className="ms"><label><input type="checkbox" checked={v.a_staff} onChange={set('a_staff')} /> Staff</label><select value={v.staff_branch} onChange={set('staff_branch')}><option value="">all branches</option><Options list={d.branches} /></select><select value={v.staff_team} onChange={set('staff_team')}><option value="">all teams</option><Options list={d.teams} /></select></div>
          <div className="ms"><label><input type="checkbox" checked={v.a_students} onChange={set('a_students')} /> Students</label><select value={v.st_country} onChange={set('st_country')}><option value="">all countries</option><Options list={d.countries} /></select><select value={v.st_intake} onChange={set('st_intake')}><option value="">all intakes</option><Options list={d.intakes} /></select></div>
          <div className="ms"><label><input type="checkbox" checked={v.a_unis} onChange={set('a_unis')} /> Universities</label>
            <select multiple size={3} value={v.uni_ids} onChange={(e) => setV({ ...v, uni_ids: [...e.target.selectedOptions].map((o) => o.value) })}><Options list={d.universities} /></select><span className="small muted">none selected = all</span></div>
        </>)}
        {F('channels', 'Channels', <div className="ms"><label><input type="checkbox" checked={v.c_banner} onChange={set('c_banner')} /> In-app banner</label><label><input type="checkbox" checked={v.c_dashboard} onChange={set('c_dashboard')} /> Dashboard card</label><label><input type="checkbox" checked={v.c_email} onChange={set('c_email')} /> Email (with CC)</label></div>)}
        {F('publish_at', 'Publish at', <input type="datetime-local" value={v.publish_at} onChange={set('publish_at')} />, 2)}
        {F('expire_at', 'Expire at', <input type="datetime-local" value={v.expire_at} onChange={set('expire_at')} />, 2)}
        {F('priority', 'Priority', <select value={v.priority} onChange={set('priority')}><Options list={['Normal', 'Important']} /></select>, 2)}
      </div></form>
    </Modal>
  );
}
export function Announcements() {
  const [d, load, err] = useLoad('/console/announcements');
  if (!d) return <Loading err={err} />;
  return (
    <>
      <div className="card"><div className="hd"><h2>Announcements</h2><span className="grow" />{d.can_edit ? <button className="btn sm primary" onClick={() => openOverlay((close) => <NewAnnouncement d={d} close={close} done={load} />)}>+ Announcement</button> : null}</div>
        <div className="table-wrap"><table className="tbl"><tbody>
          {d.rows.length ? d.rows.map((a: Any) => (
            <tr key={a.id}><td><b>{a.title}</b>{a.priority === 'Important' ? <> <span className="badge red">Important</span></> : null}<div className="small muted">{Object.keys(a.audience).filter((k) => a.audience[k]?.on).join(', ')} · {a.channels.join(', ')} · by {a.by || ''}</div></td>
              <td className="small">{fmtDT(a.publish_at)}{a.expire_at ? <><br />until {fmtDT(a.expire_at)}</> : null}</td>
              <td><Pill s={a.status} /><div className="small muted">{Object.entries(a.counts).map(([k, v]) => `${k} ${v}`).join(', ')}{a.reads ? ` · ${a.reads} staff read` : ''}</div></td>
              <td>{['Scheduled', 'Published'].includes(a.status) && d.can_edit ? <button className="btn xs" onClick={act(async () => { await POST(`/console/announcements/${a.id}/withdraw`); load(); })}>Withdraw</button> : null}</td></tr>
          )) : <tr><td className="empty">No announcements yet</td></tr>}</tbody></table></div></div>
      <div className="card" style={{ marginTop: 14 }}><div className="hd"><h2>From universities</h2></div><div className="table-wrap"><table className="tbl"><tbody>
        {d.uni_inbox.length ? d.uni_inbox.map((a: Any, i: number) => <tr key={i}><td><b>{a.title}</b><div className="small muted">{a.university} · {a.type}</div></td><td><Pill s={a.status} /></td><td className="small">{fmtDate(a.created_at)}</td></tr>)
          : <tr><td className="empty">None</td></tr>}</tbody></table></div></div>
    </>
  );
}

// ---------- Documents and data ----------
function ChecklistEdit({ d, t, close, done }: { d: Any; t: Any | null; close: () => void; done: () => void }) {
  const [head, setHead] = useState({ name: t?.name || '', country_id: t?.country_id || '', level: t?.level || '', stage: t ? t.stage : 'Application' });
  const [rows, setRows] = useState<Any[]>(() => { const items = t ? t.items.filter((x: Any) => x.active).map((x: Any) => ({ ...x })) : []; return items.length ? items : [{ required: 'Yes', visible_student: true, visible_agent: true }]; });
  const ch = (i: number, k: string, val: unknown) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: val } : r)));
  const save = act(async () => {
    await POST('/console/checklists', { ...head, items: rows.map((r) => ({ id: r.id || null, document_type_id: r.document_type_id || d.doc_types[0]?.[0] || d.doc_types[0]?.id, required: r.required || 'Yes', note: r.note || '', visible_student: r.visible_student !== false, visible_agent: r.visible_agent !== false, expiry_check: !!r.expiry_check })) });
    close(); toast('Saved', 'ok'); done();
  });
  return (
    <Modal title={t ? `Edit: ${t.name}` : 'New checklist template'} size="lg" close={close} foot={<button className="btn primary" onClick={save}>Save template</button>}>
      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="form-grid">
          <div className="f c3"><label>Name</label><input value={head.name} onChange={(e) => setHead({ ...head, name: e.target.value })} /></div>
          <div className="f c3"><label>Country</label><select disabled={!!t} value={head.country_id} onChange={(e) => setHead({ ...head, country_id: e.target.value })}><option value="">All countries</option><Options list={d.countries} /></select></div>
          <div className="f c3"><label>Level</label><select disabled={!!t} value={head.level} onChange={(e) => setHead({ ...head, level: e.target.value })}><option value="">All levels</option><Options list={d.levels} /></select></div>
          <div className="f c3"><label>Stage</label><select disabled={!!t} value={head.stage} onChange={(e) => setHead({ ...head, stage: e.target.value })}><Options list={d.stages} /></select></div>
        </div>
        <table className="tbl" style={{ marginTop: 10 }}><thead><tr><th>Document type</th><th>Required</th><th>Note for student</th><th>Student</th><th>Sub-agent</th><th>Expiry</th><th /></tr></thead><tbody>
          {rows.map((r, i) => (
            <tr key={i}><td><select value={r.document_type_id || ''} onChange={(e) => ch(i, 'document_type_id', e.target.value)}><Options list={d.doc_types} /></select></td>
              <td><select value={r.required || 'Yes'} onChange={(e) => ch(i, 'required', e.target.value)}><Options list={d.rules} /></select></td>
              <td><input value={r.note || ''} onChange={(e) => ch(i, 'note', e.target.value)} /></td>
              <td className="center"><input type="checkbox" checked={r.visible_student !== false} onChange={(e) => ch(i, 'visible_student', e.target.checked)} /></td>
              <td className="center"><input type="checkbox" checked={r.visible_agent !== false} onChange={(e) => ch(i, 'visible_agent', e.target.checked)} /></td>
              <td className="center"><input type="checkbox" checked={!!r.expiry_check} onChange={(e) => ch(i, 'expiry_check', e.target.checked)} /></td>
              <td><button type="button" className="btn xs" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button></td></tr>
          ))}</tbody></table>
        <button type="button" className="btn sm" onClick={() => setRows([...rows, { required: 'Yes', visible_student: true, visible_agent: true }])}>+ Document</button>
      </form>
    </Modal>
  );
}
export function Checklists() {
  const { can } = useConsole();
  const [d, load, err] = useLoad('/console/checklists');
  if (!d) return <Loading err={err} />;
  const ed = can('checklists', 'edit');
  const apply = (t: Any) => act(async () => {
    const body = { country_id: t.country_id, level: t.level, stage: t.stage };
    const p = await POST('/console/checklists/apply-existing', body);
    if (!(await confirmBox(<>Apply {p.items.length} new item(s) ({p.items.join(', ')}) to {p.students} existing student(s)?{p.sample.length ? <><br /><span className="small muted">{p.sample.join(', ')}</span></> : null}</>))) return;
    await POST('/console/checklists/apply-existing', { ...body, confirm: true }); toast('Applied', 'ok'); load();
  });
  const copy = act(async () => {
    if (await formModal({ title: 'Copy a template to a new country', fields: [{ k: 'src', label: 'From template', type: 'select', req: true, opts: d.templates.map((t: Any, i: number) => [String(i), t.name] as [string, string]) }, { k: 'to_country', label: 'To country', type: 'select', req: true, opts: d.countries }],
      save: (v) => { const t = d.templates[Number(v.src)]; return POST('/console/checklists/copy', { from_country: t.country_id, from_level: t.level, from_stage: t.stage, to_country: v.to_country }); } })) { toast('Copied', 'ok'); load(); }
  });
  const edit = (t: Any | null) => openOverlay((close) => <ChecklistEdit d={d} t={t} close={close} done={load} />);
  return (
    <>
      <div className="card"><div className="hd"><h2>Checklist templates</h2><span className="grow" />{ed ? <><button className="btn sm primary" onClick={() => edit(null)}>+ Template</button> <button className="btn sm" onClick={copy}>Copy template</button></> : null}</div>
        <div className="table-wrap"><table className="tbl"><tbody>{d.templates.map((t: Any, i: number) => (
          <tr key={i}><td><b>{t.name}</b>{t.new_only ? <> <span className="badge orange">new items: new students only</span></> : null}
            <div className="small muted">{t.items.filter((x: Any) => x.active).map((x: Any) => `${x.document_type}${x.required !== 'Yes' ? ' (' + x.required + ')' : ''}${!x.visible_student ? ' [internal]' : ''}`).join(', ')}</div></td>
            <td className="nowrap">{ed ? <><button className="btn xs" onClick={() => edit(t)}>Edit</button>{t.new_only ? <> <button className="btn xs" onClick={apply(t)}>Apply to existing students</button></> : null}</> : null}</td></tr>
        ))}</tbody></table></div></div>
      <p className="small muted">Files are renamed {'{student_id}_{document_type}_v{version}.{ext}'}. &quot;Internal only&quot; items are never shown in the student portal. Template changes affect new students; existing students get new items only after &quot;Apply to existing students&quot;.</p>
    </>
  );
}
export function Storage() {
  const [d, , err] = useLoad('/console/storage');
  if (!d) return <Loading err={err} />;
  return (
    <>
      <div className="grid two">
        <div className="card"><div className="hd"><h2>Folder rule</h2></div><div className="bd small"><p>{d.rule}</p>
          <Kv k="Folder created at">{d.settings.folder_trigger === 'offer_accepted' ? 'Offer accepted' : 'Enrolment confirmed'}</Kv><Kv k="Max file size">{d.settings.max_file_mb} MB</Kv>
          <Kv k="Google Drive sync">{d.settings.drive_sync_enabled ? 'On' : 'Off'}</Kv><Kv k="Drive connected">{d.settings.connected ? 'Yes' : 'No (service account not configured)'}</Kv>
          <p className="muted">Change these in System settings &gt; Files.</p></div></div>
        <div className="card"><div className="hd"><h2>Sync status</h2></div><div className="bd small"><Kv k="Synced">{d.counts.synced}</Kv><Kv k="Pending">{d.counts.pending}</Kv><Kv k="Failed">{d.counts.failed}</Kv><Kv k="Local only">{d.counts.local}</Kv></div></div>
      </div>
      <div className="card" style={{ marginTop: 14 }}><div className="table-wrap"><table className="tbl"><tbody>
        {d.rows.length ? d.rows.map((x: Any) => <tr key={x.id}><td><Link href={`/students/${x.id}/documents`}>{x.student}</Link><div className="small muted">{x.folder}</div></td><td><Pill s={x.status} c={x.status === 'Failed' ? 'red' : x.status === 'Synced' ? 'green' : ''} /></td></tr>)
          : <tr><td className="empty">No student folders yet</td></tr>}</tbody></table></div></div>
    </>
  );
}

// ---------- Insights ----------
export function ConsoleReports() {
  const { q, go, can } = useConsole();
  const [list, loadList, err] = useLoad('/console/reports');
  const key = list ? (list.reports.some((r: Any) => r.key === q.key) ? q.key : list.reports[0]?.key) : null;
  const [d, , err2] = useLoad(key ? `/console/reports/${key}` + qs({ period: q.period, from: q.from, to: q.to }) : null);
  if (!list) return <Loading err={err} />;
  if (!key) return <div className="card"><div className="empty">No reports for your role</div></div>;
  const f = (k: string) => ({ value: q[k] || '', onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => go('reports', { ...q, key, [k]: e.target.value }) });
  const schedule = act(async () => {
    if (await formModal({ title: 'Schedule this report', fields: [{ k: 'frequency', label: 'Frequency', type: 'select', noBlank: true, opts: [['weekly', 'Weekly (Monday)'], ['monthly', 'Monthly (1st)']] }, { k: 'recipients', label: 'Send to', type: 'multi', opts: list.staff }],
      save: (v) => POST('/console/reports/scheduled', { ...v, report_type: key }) })) { toast('Scheduled', 'ok'); loadList(); }
  });
  return (
    <>
      <div className="tabs" style={{ marginBottom: 10 }}>{list.reports.map((r: Any) => <Link key={r.key} href={`/console/reports?key=${r.key}`} className={r.key === key ? 'on' : ''}>{r.label}</Link>)}</div>
      <div className="filters"><select {...f('period')}><Options list={[['', 'Last 12 months'], ['month', 'This month'], ['fy', 'Financial year']]} /></select><input type="date" {...f('from')} /><input type="date" {...f('to')} /><span className="grow" />
        {['xlsx', 'pdf'].map((x) => <button key={x} type="button" className="btn sm" onClick={() => file(`/console/reports/${key}` + qs({ period: q.period, from: q.from, to: q.to, format: x }), `${key}.${x}`)}>{x === 'xlsx' ? 'Excel' : 'PDF'}</button>)}
        {can('reports', 'edit') ? <button type="button" className="btn sm" onClick={schedule}>Schedule by email</button> : null}</div>
      {!d ? <Loading err={err2} /> : <div className="card"><div className="hd"><h2>{d.label}</h2><span className="grow" /><span className="small muted">{d.basis}</span></div><div className="table-wrap"><table className="tbl"><thead><tr>{d.columns.map((c: string) => <th key={c}>{c}</th>)}</tr></thead><tbody>
        {d.rows.length ? d.rows.map((r: unknown[], i: number) => <tr key={i}>{r.map((c, j) => <td key={j}>{String(c ?? '')}</td>)}</tr>) : <tr><td colSpan={d.columns.length} className="empty">No data</td></tr>}</tbody></table></div></div>}
      {list.scheduled.length ? <div className="card" style={{ marginTop: 14 }}><div className="hd"><h2>Scheduled reports</h2></div><div className="table-wrap"><table className="tbl"><tbody>{list.scheduled.map((s: Any) => (
        <tr key={s.id}><td>{s.report_type}</td><td>{s.frequency}</td><td className="small">{s.recipients.join(', ')}</td><td className="small">{s.last_sent_at ? fmtDT(s.last_sent_at) : 'Not sent yet'}</td>
          <td><button className="btn xs" onClick={act(async () => { await POST(`/console/reports/scheduled/${s.id}/delete`); loadList(); })}>Remove</button></td></tr>
      ))}</tbody></table></div></div> : null}
    </>
  );
}
export function ConsoleAudit() {
  const { q, go } = useConsole();
  const [d, , err] = useLoad('/console/audit' + qs(q));
  const [s, setS] = useState(q.q || '');
  if (!d) return <Loading err={err} />;
  const f = (k: string) => ({ value: q[k] || '', onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => go('audit', { ...q, page: '', [k]: e.target.value }) });
  const page = (p: number) => `/console/audit${qs({ ...q, page: p })}`;
  return (
    <>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); go('audit', { ...q, page: '', q: s }); }}>
        <input type="search" placeholder="Record, label or IP" value={s} onChange={(e) => setS(e.target.value)} onBlur={() => go('audit', { ...q, page: '', q: s })} />
        <select {...f('actor_type')}><option value="">All actors</option><Options list={d.actor_types} /></select><select {...f('action')}><option value="">All actions</option><Options list={d.actions} /></select>
        <input type="date" {...f('from')} /><input type="date" {...f('to')} /><span className="grow" />
        {d.can_export ? <button type="button" className="btn sm" onClick={() => file('/console/audit/export' + qs(q), 'audit_log.xlsx')}>Export (Super Admin)</button> : null}
      </form>
      <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th><th>IP</th></tr></thead><tbody>
        {d.rows.map((a: Any, i: number) => (
          <tr key={a.id ?? i}><td className="small nowrap">{fmtDT(a.created_at)}</td><td className="small">{a.actor}</td><td className="small"><b>{a.action}</b></td><td className="small">{a.entity_type || ''}</td>
            <td className="small">{a.entity_label || ''}{a.new_value_json ? <details><summary className="muted">old / new</summary><code style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{String(a.old_value_json || '').slice(0, 400)}{'\n→ '}{String(a.new_value_json).slice(0, 400)}</code></details> : null}</td><td className="small">{a.ip || ''}</td></tr>
        ))}</tbody></table></div>
        <div className="pager"><span className="grow small muted">{d.total} entr(ies) · read only, never edited or deleted</span>{d.page > 1 ? <Link className="btn sm" href={page(d.page - 1)}>Previous</Link> : null}{d.page * d.size < d.total ? <Link className="btn sm" href={page(d.page + 1)}>Next</Link> : null}</div></div>
    </>
  );
}

// ---------- Backups and system health ----------
export function Health() {
  const { me } = useConsole();
  const [d, load, err] = useLoad('/console/health');
  if (!d) return <Loading err={err} />;
  const mb = (b: number) => (b / 1048576).toFixed(1) + ' MB';
  const tiles: [string, string | number][] = [['Email queue', d.queues.email], ['Unassigned', d.queues.unassigned], ['Approvals waiting', d.queues.approvals], ['Email failures (1 h)', `${d.email_last_hour.failed} / ${d.email_last_hour.total}`],
    ['Storage', mb(d.storage_bytes)], ['Database', mb(d.db_bytes)], ['Uptime', Math.round(d.uptime_sec / 3600) + ' h']];
  const record = act(async () => {
    if (await formModal({ title: 'Record a restore test', fields: [{ k: 'tested_on', label: 'Date', type: 'date', req: true, col: 3 }, { k: 'result', label: 'Result', type: 'select', req: true, opts: ['Passed', 'Failed'], col: 3 }, { k: 'note', label: 'Note' }], save: (v) => POST('/console/restore-tests', v) })) load();
  });
  return (
    <>
      <div className="money-tiles">{tiles.map(([l, v]) => <div key={l} className="t"><div className="l">{l}</div><div className="v">{v}</div></div>)}</div>
      <div className="grid two">
        <div className="card"><div className="hd"><h2>Backups</h2></div><div className="bd small"><p className="muted">{d.note}</p></div></div>
        <div className="card"><div className="hd"><h2>Restore tests</h2><span className="grow" />{me.super_admin ? <button className="btn sm" onClick={record}>Record a test</button> : null}</div><div className="bd small">
          <p className="muted">Test before go-live and every quarter.</p>
          {d.restore_tests.length ? d.restore_tests.map((t: Any) => <div key={t.id} className="pair"><span>{fmtDate(t.tested_on)} · {t.by || ''}</span><b>{t.result}</b></div>) : 'No restore test recorded'}</div></div>
      </div>
    </>
  );
}

// ---------- Settings ----------
export function ConsoleSettings() {
  const { q } = useConsole();
  const [d, load, err] = useLoad('/console/settings');
  const [v, setV] = useState<Record<string, string>>({});
  const [orig, setOrig] = useState<Record<string, string>>({});
  const [ferr, setFerr] = useState<Record<string, string>>({});
  const g = q.group || 'general';
  const norm = useCallback((s: Any) => (s.type === 'bool' ? (String(s.value) === 'true' || String(s.value) === '1' ? '1' : '0') : String(s.value ?? '')), []);
  useEffect(() => { if (d) { const o = Object.fromEntries(d.rows.map((s: Any) => [s.key, norm(s)])); setV(o); setOrig(o); } }, [d, norm]);
  if (!d) return <Loading err={err} />;
  const rows = d.rows.filter((r: Any) => r.group === g);
  const input = (s: Any) => {
    const dis = s.fixed || !s.editable;
    const p = { value: v[s.key] ?? '', disabled: dis, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [s.key]: e.target.value }) };
    if (s.type === 'bool') return <select {...p}><Options list={[['1', 'On'], ['0', 'Off']]} /></select>;
    if (s.type === 'select') return <select {...p}><Options list={s.opts} /></select>;
    if (s.type === 'number') return <input type="number" min={s.min} max={s.max} step={s.step || 1} {...p} />;
    return <input {...p} />;
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setFerr({});
    const changed = Object.fromEntries(rows.filter((s: Any) => v[s.key] !== orig[s.key]).map((s: Any) => [s.key, v[s.key]]));
    if (!Object.keys(changed).length) { toast('Nothing changed', 'ok'); return; }
    try { await PUT('/console/settings', changed); toast('Saved', 'ok'); load(); } catch (er) { formErrs(setFerr)(er); }
  };
  const reset = (key: string) => act(async () => { await PUT('/console/settings', { __reset: [key] }); toast('Reset to default', 'ok'); load(); });
  const defLabel = (s: Any) => (s.type === 'bool' ? (s.def === '1' ? 'On' : 'Off') : s.type === 'select' ? (s.opts.find((o: [string, string]) => o[0] === s.def) || [])[1] || s.def : s.def || '-');
  return (
    <>
      <div className="tabs" style={{ marginBottom: 10 }}>{d.groups.map(([k, l]: [string, string]) => <Link key={k} href={`/console/settings?group=${k}`} className={k === g ? 'on' : ''}>{l}</Link>)}<Link href="/console/settings?group=fixed" className={g === 'fixed' ? 'on' : ''}>Fixed rules</Link></div>
      {g === 'fixed' ? <div className="card"><div className="hd"><h2>Fixed rules (read only)</h2></div><div className="table-wrap"><table className="tbl"><tbody>{d.fixed.map(([t, s]: [string, string]) => <tr key={t}><td>🔒 {t}</td><td className="small muted">{s}</td></tr>)}</tbody></table></div></div> : (
        <form className="card" noValidate onSubmit={save}><div className="table-wrap"><table className="tbl"><thead><tr><th>Setting</th><th>Value</th><th>Default</th><th>Range</th><th>Source</th><th>Last changed</th><th /></tr></thead><tbody>
          {rows.map((s: Any) => (
            <tr key={s.key}><td>{s.label}{s.fixed ? ' 🔒' : ''}</td><td className={`f${ferr[s.key] ? ' err' : ''}`}>{input(s)}<div className="msg">{ferr[s.key] ?? ''}</div></td>
              <td className="small">{defLabel(s)}</td><td className="small">{s.type === 'number' ? `${s.min} to ${s.max}` : ''}</td><td className="small muted">{s.source}</td>
              <td className="small">{s.changed_by || ''}{s.changed_at ? <><br />{fmtDate(s.changed_at)}</> : null}</td>
              <td>{!s.fixed && s.editable && String(s.value) !== String(s.def) ? <button type="button" className="btn xs" onClick={reset(s.key)}>Reset</button> : null}</td></tr>
          ))}</tbody></table></div>
          {rows.some((s: Any) => s.editable && !s.fixed) ? <div className="bd"><button className="btn primary">Save changes</button> <span className="small muted">Values outside the range are rejected.</span></div> : null}
        </form>
      )}
    </>
  );
}

const BANK: [string, string][] = [['account_name', 'Account name'], ['bank_name', 'Bank'], ['account_no', 'Account number'], ['ifsc', 'IFSC'], ['account_type', 'Account type'], ['branch', 'Branch'], ['city', 'City'], ['state', 'State'], ['pin', 'PIN code'], ['upi_id', 'UPI ID (for the QR code)'], ['swift', 'SWIFT (international)']];
export function Company() {
  const [d, load, err] = useLoad('/console/company');
  const [v, setV] = useState<Record<string, string>>({});
  const [bank, setBank] = useState<Record<string, string>>({});
  const [withBank, setWithBank] = useState(false);
  const [ferr, setFerr] = useState<Record<string, string>>({});
  useEffect(() => { if (d) { setV({ ...d.values }); setBank({ ...(d.bank || {}) }); } }, [d]);
  if (!d) return <Loading err={err} />;
  const dis = !d.can_edit;
  const f1 = (k: string, l: string, extra: Any = {}) => <div key={k} className={`f c3${ferr[k] ? ' err' : ''}`}><label>{l}</label><input value={v[k] || ''} disabled={dis} onChange={(e) => setV({ ...v, [k]: e.target.value })} {...extra} /><div className="msg">{ferr[k] ?? ''}</div></div>;
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setFerr({});
    const keys = ['company_llpin', 'company_gstin', 'company_pan', 'company_address', 'company_signatory', 'company_signatory_designation', 'invoice_prefix_university', 'invoice_prefix_credit', 'receipt_prefix'];
    const body: Any = Object.fromEntries(keys.map((k) => [k, v[k] ?? '']));
    if (withBank) body.bank = Object.fromEntries(BANK.map(([k]) => [k, String(bank[k] ?? '').trim()]));
    try { await PUT('/console/company', body); toast('Saved', 'ok'); load(); } catch (er) { formErrs(setFerr)(er); }
  };
  return (
    <form className="card" noValidate onSubmit={save}><div className="hd"><h2>Company profile</h2><span className="grow" /><span className="small muted">Used on invoices, receipts, agreements and email footers</span></div><div className="bd">
      <div className="form-grid">
        <div className="f c3"><label>Legal name (fixed)</label><input value={d.fixed.company_legal_name} disabled /></div><div className="f c3"><label>Trading name (fixed)</label><input value={d.fixed.company_trading_name} disabled /></div>
        {f1('company_llpin', 'LLPIN')}{f1('company_gstin', 'GSTIN', { style: { textTransform: 'uppercase' }, maxLength: 15 })}{f1('company_pan', 'PAN', { style: { textTransform: 'uppercase' }, maxLength: 10 })}
        <div className="f c6"><label>Registered address</label><textarea rows={2} disabled={dis} value={v.company_address || ''} onChange={(e) => setV({ ...v, company_address: e.target.value })} /></div>
        {f1('company_signatory', 'Authorised signatory')}{f1('company_signatory_designation', 'Designation')}{f1('invoice_prefix_university', 'University invoice prefix')}{f1('invoice_prefix_credit', 'Credit note prefix')}{f1('receipt_prefix', 'Receipt prefix')}
      </div>
      {d.can_edit ? <>
        <h3 style={{ margin: '14px 0 6px' }}>Bank details (university payments and student invoices) {d.bank_on_file ? '(saved)' : ''}</h3>
        <p className="small muted" style={{ margin: '0 0 6px' }}>Shown on every student GST invoice with a UPI QR code (amount and invoice number filled in).</p>
        <div className="form-grid">{BANK.map(([k, l]) => <div key={k} className="f c3"><label>{l}</label><input autoComplete="off" value={bank[k] || ''} onChange={(e) => setBank({ ...bank, [k]: e.target.value })} /></div>)}</div>
        <label className="row small" style={{ gap: 6, marginTop: 6 }}><input type="checkbox" checked={withBank} onChange={(e) => setWithBank(e.target.checked)} /> Save bank details too</label>
        <div style={{ marginTop: 10 }}><button className="btn primary">Save company profile</button></div>
      </> : <p className="small muted">Only a Super Admin can edit the company profile and bank details.</p>}
    </div></form>
  );
}
export type { Q };
