'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { GET, POST, PUT, ApiError, download } from './api';
import { fmtDate, fmtDT, qs } from './format';
import { FormGrid, Options, formModal, type Field, type Vals } from './form';
import { Modal, confirmBox, openOverlay, showError, toast } from './ui';

/** The client's Admin > Legal & privacy (legacy/public/js/pages/privacy.js): GDPR, India DPDP, US state laws. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const STATUS_CLS: Record<string, string> = { Open: 'orange', 'In progress': 'blue', Completed: 'green', Rejected: 'red', Withdrawn: 'grey' };
const Badge = ({ s, cls }: { s: string; cls?: string }) => <span className={`badge ${cls || STATUS_CLS[s] || 'grey'}`}>{s}</span>;
const METHOD: Record<string, string> = { signup_checkbox: 'Ticked at sign-up', login_checkbox: 'Ticked at login', invite_checkbox: 'Ticked at invite activation', advisory_screen: 'Read in full + accepted (advisory screen)',
  document_screen: 'Read in full + accepted', declined_on_screen: 'Declined on screen', privacy_center: 'Privacy centre', signup_form: 'Sign-up form', checkbox: 'Checkbox' };
export const PRIVACY_TABS: [string, string][] = [['overview', 'Overview'], ['dpdp', 'India DPDP'], ['requests', 'Rights requests'], ['consents', 'Consent log'], ['documents', 'Legal documents'], ['breaches', 'Breach register'], ['laws', 'Law coverage']];
const errs = (setErr: (e: Record<string, string>) => void) => (e: unknown) => { if (e instanceof ApiError && e.data.errors) setErr(e.data.errors); showError(e); };
const openDoc = async (id: string) => {
  try {
    const x = await GET('/admin/privacy/documents/' + id);
    openOverlay((close) => <Modal title={`${x.title} v${x.version}`} size="lg" close={close}><p className="small muted">SHA-256 {x.body_hash}</p><div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{x.filled}</div></Modal>);
  } catch (e) { showError(e); }
};
const run = (fn: () => Promise<unknown>) => async () => { try { await fn(); } catch (e) { showError(e); } };

const LEGAL: Field[] = [
  { k: 'legal_name', label: 'Legal name of the company', col: 3, placeholder: 'Euroverse Service LLP (trading as La Europa Education)' }, { k: 'company_address', label: 'Registered address', col: 3 },
  { k: 'privacy_email', label: 'Privacy contact email', type: 'email', col: 2 }, { k: 'grievance_officer_name', label: 'Grievance Officer (India DPDP)', col: 2 }, { k: 'grievance_officer_email', label: 'Grievance Officer email', type: 'email', col: 2 },
  { k: 'grievance_officer_phone', label: 'Grievance Officer phone', col: 2 }, { k: 'dpo_contact', label: 'Data Protection Officer (if appointed)', col: 2, help: 'Needed under GDPR for large-scale processing; DPDP for a Significant Data Fiduciary' },
  { k: 'eu_representative', label: 'EU / UK representative (Art. 27)', col: 2, help: 'Needed if you target students in the EU / UK without an office there' },
  { k: 'retention_years', label: 'Keep closed files for (years)', type: 'number', min: 1, max: 15, col: 2 }];
function Overview() {
  const [d, setD] = useState<Any | null>(null);
  const [v, setV] = useState<Vals>({});
  const [err, setErr] = useState<Record<string, string>>({});
  const load = useCallback(() => GET('/admin/privacy/overview').then((x) => { setD(x); setV(Object.fromEntries(LEGAL.map((f) => [f.k, x.settings[f.k]]))); }).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="empty">Loading...</div>;
  const c = d.counts;
  const missing = ['legal_name', 'company_address', 'privacy_email', 'grievance_officer_name', 'grievance_officer_email'].filter((k) => !d.settings[k]);
  const stats: [string, number, string?][] = [['Open rights requests', c.open, 'requests'], ['Overdue requests', c.overdue, 'requests'], ['Yet to accept current documents', c.pending_consent, 'consents'],
    ['Portal accounts', c.accounts], ['Under 18 (guardian consent)', c.minors], ['Open breaches', c.breaches_open, 'breaches']];
  return (
    <>
      {missing.length ? <div className="pv-warn">Fill in the legal contacts below. They are shown to students in the Privacy Policy, Terms and Advisory (placeholders are shown until then).</div> : null}
      <div className="stats pv-stats" style={{ marginBottom: 14 }}>{stats.map(([l, n, h]) => {
        const inner = <><div className="lbl">{l}</div><div className="val">{n}</div></>;
        const cls = `stat ${/Overdue|breaches/.test(l) && n ? 'red' : ''}`;
        return h ? <Link key={l} className={cls} href={`/admin/privacy/${h}`}>{inner}</Link> : <div key={l} className={cls}>{inner}</div>;
      })}</div>
      <div className="card"><div className="hd"><h2>Legal entity and privacy contacts</h2></div><div className="bd"><form noValidate onSubmit={(e) => e.preventDefault()}>
        <FormGrid fields={LEGAL} vals={v} set={(k, x) => setV((o) => ({ ...o, [k]: x }))} errors={err} />
        <div className="form-actions"><button type="button" className="btn primary" onClick={async () => { setErr({}); try { await PUT('/admin/privacy/settings', v); toast('Saved', 'ok'); load(); } catch (e) { errs(setErr)(e); } }}>Save</button></div>
      </form></div></div>
      <p className="small muted" style={{ marginTop: 10 }}>The default Privacy Policy, Terms, Student Advisory and Cookie Notice were written to meet GDPR, the India DPDP Act and US state privacy laws, but they are a template: have them reviewed by your lawyer before go-live.</p>
    </>
  );
}

const HINT: Record<string, string> = { access: 'Use "Download data" on the student file, or ask the student to use Download my data in the portal, then mark Completed.', portability: 'Send the machine-readable export (JSON + documents ZIP).',
  erasure: 'Check Admin > Student portal > Deletion requests. Keep only what the law requires (accounting, disputes) and say so in the reply.', correction: 'Correct the student file, then reply.',
  withdraw_consent: 'Stop the processing based on consent. If it is needed for the service, explain the consequence in the reply.', restriction: 'Completing this marks the account as restricted: use the data only for storage / legal claims.',
  grievance: 'India DPDP: reply by the date shown with the outcome and how to escalate to the Data Protection Board of India.' };
function Requests() {
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState<Any[] | null>(null);
  const load = useCallback(() => GET('/admin/privacy/requests' + qs({ status: status === 'all' ? '' : status })).then((d) => setRows(d.rows)).catch(showError), [status]);
  useEffect(() => { load(); }, [load]);
  const handle = async (x: Any) => {
    const r = await formModal({ title: `${x.request_code}: ${x.label}`, values: { status: 'Completed', response: x.response || '' }, saveLabel: 'Save and inform student', save: (v) => PUT('/admin/privacy/requests/' + x.id, v),
      intro: <><p className="small"><b>{x.name}</b> {x.code} · received {fmtDT(x.created_at)} · reply by <b>{fmtDate(x.due_at)}</b></p>
        {x.details ? <p className="small" style={{ whiteSpace: 'pre-wrap', background: 'var(--soft)', padding: '10px 12px', borderRadius: 12 }}>{x.details}</p> : null}
        {HINT[x.type] ? <p className="small muted">{HINT[x.type]}</p> : null}</>,
      fields: [{ k: 'status', label: 'New status', type: 'select', noBlank: true, opts: [['In progress', 'In progress'], ['Completed', 'Completed'], ['Rejected', 'Rejected (give the legal reason)'], ['Extended', 'Need more time (+45 days, once)']], col: 6 },
        { k: 'response', label: 'Reply to the student (emailed and shown in the portal)', type: 'textarea', rows: 5, col: 6 }] });
    if (r) load();
  };
  return (
    <>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <select className="input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}><Options list={[['open', 'Open + in progress'], ['Completed', 'Completed'], ['Rejected', 'Rejected'], ['Withdrawn', 'Withdrawn'], ['all', 'All']]} /></select>
        <span className="small muted">Deadlines: grievance in the published working days (India DPDP tab, max 90 days); other requests 30 days (GDPR, DPDP), 45 days (US), extendable once with a reason. Withdrawal of consent: 7 days.</span>
      </div>
      <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th>Reference</th><th>Student</th><th>Request</th><th>Received</th><th>Reply by</th><th>Status</th><th /></tr></thead><tbody>
        {!rows ? <tr><td colSpan={7} className="empty">Loading...</td></tr> : rows.length ? rows.map((x) => (
          <tr key={x.id} className={x.overdue ? 'row-danger' : ''}>
            <td data-label="Reference"><b>{x.request_code}</b></td>
            <td data-label="Student">{x.student_id ? <Link href={`/students/${x.student_id}`}>{x.name}</Link> : x.name}<div className="small muted">{x.code}</div></td>
            <td data-label="Request">{x.label}{x.details ? <div className="small muted" style={{ maxWidth: 340, whiteSpace: 'pre-wrap' }}>{x.details}</div> : null}</td>
            <td data-label="Received" className="small">{fmtDT(x.created_at)}</td>
            <td data-label="Reply by" className="small">{fmtDate(x.due_at)}{x.overdue ? <> <Badge s="Overdue" cls="red" /></> : null}</td>
            <td data-label="Status"><Badge s={x.status} />{x.handled_by_name ? <div className="small muted">{x.handled_by_name}</div> : null}</td>
            <td className="nowrap">{['Open', 'In progress'].includes(x.status) ? <button className="btn xs primary" onClick={run(() => handle(x))}>Handle</button>
              : x.response ? <button className="btn xs" onClick={() => openOverlay((close) => <Modal title={x.request_code} close={close}><p style={{ whiteSpace: 'pre-wrap' }}>{x.response}</p></Modal>)}>Reply</button> : null}</td>
          </tr>
        )) : <tr><td colSpan={7} className="empty">No requests</td></tr>}</tbody></table></div></div>
    </>
  );
}

const CONSENT_TYPES: [string, string][] = [['advisory', 'Student Advisory & Consent'], ['terms', 'Terms of Use'], ['privacy', 'Privacy Policy'], ['communication', 'Service communication'], ['marketing', 'Marketing'], ['guardian', 'Parent / guardian'],
  ['age_declaration', 'Age declaration'], ['nomination', 'Nomination'], ['sale_share_opt_out', 'Do not sell / share'], ['referral_contact', 'Referral']];
function Consents() {
  const blank = { q: '', type: '', value: '', from: '', to: '' };
  const [f, setF] = useState(blank), [applied, setApplied] = useState(blank);
  const [rows, setRows] = useState<Any[] | null>(null);
  useEffect(() => { setRows(null); GET('/admin/privacy/consents' + qs(applied)).then((d) => setRows(d.rows)).catch(showError); }, [applied]);
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const evidence = (x: Any) => [x.scrolled_to_end === 1 || x.scrolled_to_end === true ? 'Scrolled to end' : null, x.time_spent_sec != null ? `read ${x.time_spent_sec}s` : null, x.extra?.signature_name ? `signed "${x.extra.signature_name}"` : null,
    x.extra?.guardian_confirmed ? 'guardian confirmed' : null, x.extra?.name && x.consent_type === 'guardian' ? `guardian ${x.extra.name} (${x.extra.email || ''})` : null, x.ip ? `IP ${x.ip}` : null, x.timezone || null,
    x.document_hash ? `hash ${String(x.document_hash).slice(0, 10)}…` : null].filter(Boolean).join(' · ');
  return (
    <>
      <form className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }} onSubmit={(e) => { e.preventDefault(); setApplied(f); }}>
        <input className="input" placeholder="Name, email or ID" style={{ maxWidth: 220 }} value={f.q} onChange={set('q')} />
        <select className="input" style={{ width: 'auto' }} value={f.type} onChange={set('type')}><option value="">All consents</option><Options list={CONSENT_TYPES} /></select>
        <select className="input" style={{ width: 'auto' }} value={f.value} onChange={set('value')}><option value="">Accepted + declined</option><Options list={[['yes', 'Accepted'], ['no', 'Declined / withdrawn']]} /></select>
        <input className="input" type="date" style={{ width: 'auto' }} value={f.from} onChange={set('from')} /><input className="input" type="date" style={{ width: 'auto' }} value={f.to} onChange={set('to')} />
        <button className="btn">Filter</button><button type="button" className="btn" onClick={() => download('/admin/privacy/consents.xlsx' + qs(applied), 'consent-log.xlsx').catch(showError)}>Export Excel</button>
      </form>
      <p className="small muted" style={{ margin: '0 0 8px' }}>Append-only: records cannot be edited or deleted. Each legal document record stores the version and SHA-256 of the exact text shown.</p>
      <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th>When</th><th>Student</th><th>Consent</th><th>Value</th><th>How</th><th>Evidence</th></tr></thead><tbody>
        {!rows ? <tr><td colSpan={6} className="empty">Loading...</td></tr> : rows.length ? rows.map((x, i) => (
          <tr key={x.id ?? i}>
            <td data-label="When" className="small nowrap">{fmtDT(x.created_at)}</td>
            <td data-label="Student">{x.student_id ? <Link href={`/students/${x.student_id}`}>{x.name}</Link> : x.name}<div className="small muted">{x.code}</div></td>
            <td data-label="Consent">{x.title}{x.document_version ? <> <span className="muted small">v{x.document_version}</span></> : null}{x.document_id ? <> <a href="#" className="small" onClick={(e) => { e.preventDefault(); openDoc(x.document_id); }}>text</a></> : null}</td>
            <td data-label="Value">{x.value === 'yes' ? <Badge s="Accepted" cls="green" /> : <Badge s="Declined" cls="red" />}</td>
            <td data-label="How" className="small">{METHOD[x.method] || x.method || '-'}</td><td data-label="Evidence" className="small">{evidence(x)}</td>
          </tr>
        )) : <tr><td colSpan={6} className="empty">No records</td></tr>}</tbody></table></div></div>
    </>
  );
}

function Documents() {
  const [d, setD] = useState<Any | null>(null);
  const load = useCallback(() => GET('/admin/privacy/overview').then(setD).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="empty">Loading...</div>;
  const publish = async (doc: Any) => {
    const cur = doc.versions.find((v: Any) => v.is_current);
    const x = cur ? await GET('/admin/privacy/documents/' + cur.id) : { body: '' };
    const r = await formModal<Any>({ title: `Publish new version: ${doc.title}`, size: 'lg', values: { body: x.body, notify: true }, saveLabel: 'Publish', save: (v) => POST(`/admin/privacy/documents/${doc.type}/publish`, v),
      intro: <p className="small muted">Edit the text below. Keep the {'{placeholders}'}. Students will see the new version immediately.</p>,
      fields: [{ k: 'body', label: 'Text', type: 'textarea', rows: 18, col: 6 }, { k: 'change_note', label: 'What changed (shown in history)', col: 6 }, ...(doc.required ? [{ k: 'notify', label: 'Send a portal notification to every student', type: 'checkbox', col: 6 } as Field] : [])] });
    if (r) { toast(`Published v${r.version}`, 'ok'); load(); }
  };
  return (
    <>
      <p className="small muted" style={{ marginTop: 0 }}>Published versions can never be edited. Publishing a new version of a required document (Advisory, Terms, Privacy) makes every student read and accept it again at the next login.
        Placeholders like {'{company_legal_name}'}, {'{privacy_email}'}, {'{grievance_officer_name}'} are filled from the Overview contacts.</p>
      {d.documents.map((doc: Any) => (
        <div key={doc.type} className="card" style={{ marginBottom: 12 }}>
          <div className="hd"><h2>{doc.title}</h2>{doc.required ? <span className="badge blue">Must accept</span> : <span className="badge grey">Notice</span>}<span className="grow" /><button className="btn sm primary" onClick={run(() => publish(doc))}>Publish new version</button></div>
          <div className="table-wrap"><table className="tbl"><thead><tr><th>Version</th><th>Published</th><th>By</th><th>What changed</th><th>Accepted by</th><th /></tr></thead><tbody>
            {doc.versions.map((v: Any) => (
              <tr key={v.id}><td data-label="Version"><b>v{v.version}</b> {v.is_current ? <span className="badge green">Current</span> : null}</td><td data-label="Published" className="small">{fmtDT(v.published_at)}</td><td data-label="By" className="small">{v.by}</td>
                <td data-label="What changed" className="small">{v.change_note || ''}</td><td data-label="Accepted by">{doc.required ? `${v.accepted} students` : '-'}</td><td><button className="btn xs" onClick={() => openDoc(v.id)}>View</button></td></tr>
            ))}</tbody></table></div>
        </div>
      ))}
    </>
  );
}

const PF: Field[] = [{ k: 'name', label: 'Company', col: 3 }, { k: 'service', label: 'What it does for us', col: 3, placeholder: 'e.g. Cloud hosting of the CRM' }, { k: 'data_categories', label: 'Which personal data', col: 6, placeholder: 'e.g. all CRM data, documents' },
  { k: 'location', label: 'Where (country)', col: 2 }, { k: 'dpa_signed_on', label: 'Contract / DPA signed on', type: 'date', col: 2 }, { k: 'breach_notice_hours', label: 'Must tell us of a breach within (hours)', type: 'number', col: 2 },
  { k: 'sub_processors', label: 'Its sub-processors', col: 6 }, { k: 'contact', label: 'Contact', col: 3 }, { k: 'active', label: 'In use', type: 'select', noBlank: true, opts: [['1', 'Yes'], ['0', 'No']], col: 3 }, { k: 'notes', label: 'Notes', type: 'textarea', col: 6 }];
function Dpdp({ portalUrl }: { portalUrl: string }) {
  const [d, setD] = useState<Any | null>(null);
  const [s, setS] = useState<Vals>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => GET('/admin/privacy/dpdp').then((x) => { setD(x); setS({ grievance_response_days: x.reply_days, retention_cold_lead_months: x.retention.months }); }).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="empty">Loading...</div>;
  const n = d.notices, rt = d.retention;
  const send = async () => {
    if (!(await confirmBox(`Email the privacy notice to ${Math.min(500, n.pending)} person(s) now?`, { ok: 'Send notice' }))) return;
    setBusy(true);
    try { const r = await POST('/admin/privacy/notices/send', {}); toast(`Sent to ${r.sent}. Still to send: ${r.pending}`, 'ok'); load(); } catch (e) { showError(e); } finally { setBusy(false); }
  };
  const erase = async () => {
    if (!(await confirmBox(`Erase ${rt.due_now} cold lead(s)? Names and contact details are removed for good (the lead code stays).`, { danger: true, ok: 'Erase now' }))) return;
    try { const r = await POST('/admin/privacy/retention/run', {}); toast(`Erased ${r.erased} lead(s)`, 'ok'); load(); } catch (e) { showError(e); }
  };
  const proc = async (p: Any | null) => {
    if (await formModal({ title: p ? 'Edit ' + p.name : 'Add a Data Processor', size: 'lg', fields: PF, values: p ? { ...p, active: p.active ? '1' : '0', dpa_signed_on: p.dpa_signed_on ? String(p.dpa_signed_on).slice(0, 10) : '' } : { breach_notice_hours: 24, active: '1' },
      save: (v) => (p ? PUT('/admin/privacy/processors/' + p.id, v) : POST('/admin/privacy/processors', v)) })) load();
  };
  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}><div className="hd"><h2>When the law applies</h2></div><div className="table-wrap"><table className="tbl"><tbody>{d.phases.map((p: Any) => (
        <tr key={p.label}><td><b>{p.label}</b></td><td className="small">{p.what}</td><td>{p.done ? <Badge s="In force" cls="green" /> : <Badge s={`${p.days_left} days left`} cls="orange" />}</td></tr>
      ))}</tbody></table></div></div>
      <div className="grid two" style={{ gap: 12, marginBottom: 12 }}>
        <div className="card"><div className="hd"><h2>Privacy notice to people in the CRM (s.5(2))</h2></div><div className="bd">
          <p className="small" style={{ marginTop: 0 }}>Everyone whose data we already have must get the notice. One email per person per Privacy Policy version ({n.version}); it links to the policy and the privacy contact page.</p>
          <p><b>{n.pending}</b> lead(s) / student(s) with an email have not got it yet · {n.sent} sent so far</p>
          <label className="small row" style={{ gap: 6 }}><input type="checkbox" defaultChecked={!!n.auto_from} onChange={(e) => { const on = e.target.checked; run(async () => { await PUT('/admin/privacy/dpdp/settings', { auto_notice: on }); toast('Saved', 'ok'); })(); }} /> Send it automatically to every new lead (notice at collection)</label>
          <div className="row" style={{ gap: 8, marginTop: 10 }}><button className="btn primary" disabled={!n.pending || busy} onClick={send}>Send notice now (up to 500)</button>
            <button className="btn" onClick={() => openOverlay((close) => <Modal title="Privacy notice email" size="lg" close={close}><p className="small muted">Sent from the student sending address. The name is filled per person.</p><div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{n.text || ''}</div></Modal>)}>Read the email</button></div>
        </div></div>
        <div className="card"><div className="hd"><h2>Grievances and retention</h2></div><div className="bd">
          <form noValidate className="form-grid" onSubmit={(e) => e.preventDefault()}>
            <div className="f c3"><label>Reply to a grievance within (working days)</label><input className="input" type="number" min={1} max={90} value={String(s.grievance_response_days ?? '')} onChange={(e) => setS({ ...s, grievance_response_days: e.target.value })} /><div className="small muted">Published on the privacy contact page. Law: max 90 days.</div></div>
            <div className="f c3"><label>Erase cold leads after (months)</label><input className="input" type="number" min={0} max={120} value={String(s.retention_cold_lead_months ?? '')} onChange={(e) => setS({ ...s, retention_cold_lead_months: e.target.value })} /><div className="small muted">0 = off. Minimum 12 (1 year). Leads never converted, no portal account, no activity.</div></div>
          </form>
          <p className="small">{rt.months ? <><b>{rt.due_now}</b> cold lead(s) would be erased now.{rt.last_run ? ` Last run ${rt.last_run}.` : ''}</> : 'Automatic erasure is off.'}</p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><button className="btn primary" onClick={run(async () => { await PUT('/admin/privacy/dpdp/settings', s); toast('Saved', 'ok'); load(); })}>Save</button>
            {rt.months && rt.due_now ? <button className="btn danger" onClick={erase}>Erase now</button> : null}
            <a className="btn" href={`${portalUrl}/legal/privacy-contact`} target="_blank" rel="noopener noreferrer">Open the public privacy contact page</a></div>
        </div></div>
      </div>
      <div className="card"><div className="hd"><h2>Data Processors (s.8(2))</h2><span className="grow" /><button className="btn sm primary" onClick={run(() => proc(null))}>+ Add processor</button></div>
        <div className="bd small muted" style={{ paddingBottom: 0 }}>Every provider that handles personal data for La Europa (hosting, email, WhatsApp, cloud drive, payment, website) needs a contract / DPA: our instructions only, security, breach notice within hours, delete or return at the end.</div>
        <div className="table-wrap"><table className="tbl"><thead><tr><th>Processor</th><th>Does what</th><th>Data</th><th>Where</th><th>DPA signed</th><th>Breach notice</th><th /></tr></thead><tbody>
          {d.processors.length ? d.processors.map((p: Any) => (
            <tr key={p.id}><td><b>{p.name}</b>{p.active ? null : <> <Badge s="Not used" cls="grey" /></>}{p.contact ? <div className="small muted">{p.contact}</div> : null}</td><td className="small">{p.service || ''}</td><td className="small">{p.data_categories || ''}</td><td className="small">{p.location || ''}</td>
              <td>{p.dpa_signed_on ? fmtDate(p.dpa_signed_on) : <Badge s="Missing" cls="red" />}</td><td className="small">{p.breach_notice_hours} h</td><td><button className="btn xs" onClick={run(() => proc(p))}>Edit</button></td></tr>
          )) : <tr><td colSpan={7} className="empty">No processors yet. Add hosting, email (SMTP), WhatsApp provider, Google Drive, payment gateway, website host.</td></tr>}</tbody></table></div></div>
    </>
  );
}

const BF: Field[] = [{ k: 'description', label: 'What happened', type: 'textarea', col: 6 }, { k: 'data_affected', label: 'Which personal data', col: 6 }, { k: 'people_affected', label: 'People affected (approx.)', type: 'number', col: 2 },
  { k: 'risk', label: 'Risk to people', type: 'select', noBlank: true, opts: ['Low', 'Medium', 'High'], col: 2 }, { k: 'detected_at', label: 'Detected at', type: 'datetime', col: 2 }, { k: 'actions', label: 'Actions taken', type: 'textarea', col: 6 }];
function Letters({ id, close }: { id: string; close: () => void }) {
  const [x, setX] = useState<Any | null>(null);
  useEffect(() => { GET(`/admin/privacy/breaches/${id}/templates`).then(setX).catch(showError); }, [id]);
  const box = (t: string, s: string) => <><h3 style={{ margin: '14px 0 6px' }}>{t}</h3><textarea className="input" rows={9} readOnly style={{ width: '100%', fontSize: 12.5 }} value={s} /></>;
  return (
    <Modal title="Breach letters (DPDP Rules, Rule 7)" size="lg" close={close}>
      <p className="small muted" style={{ marginTop: 0 }}>Fill the [brackets], then send. Board: the first intimation without delay, the detailed report within 72 hours. Each affected person: without delay, by email / WhatsApp.</p>
      {x ? <>{box('1. Board: first intimation (now)', x.board_initial)}{box('2. Board: detailed report (within 72 hours)', x.board_report)}{box('3. Each affected student / parent', x.person)}</> : <div className="empty">Loading...</div>}
    </Modal>
  );
}
function Breaches() {
  const [rows, setRows] = useState<Any[] | null>(null);
  const load = useCallback(() => GET('/admin/privacy/breaches').then(setRows).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  const record = async () => { if (await formModal({ title: 'Record a personal data breach', fields: BF, values: { risk: 'Medium', detected_at: new Date().toISOString() }, save: (v) => POST('/admin/privacy/breaches', v) })) load(); };
  const update = async (x: Any) => {
    if (await formModal({ title: 'Update breach', values: x, save: (v) => PUT('/admin/privacy/breaches/' + x.id, v), fields: [...BF.filter((f) => f.k !== 'description' && f.k !== 'detected_at'),
      { k: 'board_initial_at', label: 'Board: first intimation at', type: 'datetime', col: 3 }, { k: 'board_report_at', label: 'Board: 72-hour report at', type: 'datetime', col: 3 },
      { k: 'reported_authority_at', label: 'Other authority notified at (EU / UK)', type: 'datetime', col: 3 }, { k: 'notified_people_at', label: 'People notified at', type: 'datetime', col: 3 },
      { k: 'status', label: 'Status', type: 'select', noBlank: true, opts: ['Open', 'Contained', 'Closed'], col: 2 }] })) load();
  };
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}><span className="small muted grow">GDPR: tell the supervisory authority within 72 hours unless unlikely to cause risk, and the people affected without delay if high risk. India DPDP: inform the Data Protection Board and each affected person. Most US states: notify affected residents (and sometimes the Attorney General).</span>
        <button className="btn primary sm" onClick={run(record)}>Record a breach</button></div>
      <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th>Detected</th><th>What happened</th><th>Risk</th><th>People</th><th>Board told</th><th>People told</th><th>Status</th><th /></tr></thead><tbody>
        {!rows ? <tr><td colSpan={8} className="empty">Loading...</td></tr> : rows.length ? rows.map((b) => (
          <tr key={b.id}>
            <td data-label="Detected" className="small">{fmtDT(b.detected_at)}<div className="muted">72h: {fmtDT(b.authority_deadline)}</div></td>
            <td data-label="What happened" className="small" style={{ maxWidth: 320 }}>{b.description}{b.data_affected ? <div className="muted">Data: {b.data_affected}</div> : null}</td>
            <td data-label="Risk"><Badge s={b.risk} cls={({ High: 'red', Medium: 'orange', Low: 'grey' } as Record<string, string>)[b.risk]} /></td><td data-label="People">{b.people_affected ?? '-'}</td>
            <td data-label="Board told" className="small">{b.board_initial_at ? `first: ${fmtDT(b.board_initial_at)}` : '-'}{b.board_report_at ? <><br />report: {fmtDT(b.board_report_at)}</> : b.status !== 'Closed' && new Date(b.authority_deadline) < new Date() ? <><br /><Badge s="72h report late" cls="red" /></> : null}</td>
            <td data-label="People told" className="small">{b.notified_people_at ? fmtDT(b.notified_people_at) : '-'}</td>
            <td data-label="Status"><Badge s={b.status} cls={({ Open: 'red', Contained: 'orange', Closed: 'green' } as Record<string, string>)[b.status]} /></td>
            <td className="nowrap"><button className="btn xs" onClick={run(() => update(b))}>Update</button> <button className="btn xs" onClick={() => openOverlay((close) => <Letters id={b.id} close={close} />)}>Letters</button></td>
          </tr>
        )) : <tr><td colSpan={8} className="empty">No breaches recorded</td></tr>}</tbody></table></div></div>
    </>
  );
}

const LAWS: [string, string, string][] = [
  ['Clear notice before collecting data', 'GDPR Art. 13, DPDP s.5, CCPA notice at collection', 'Privacy Policy linked on sign-up, login and every page footer; versioned and hashed'],
  ['Freely given, specific, recorded consent', 'GDPR Art. 6-7, DPDP s.6', 'Separate ticks (Terms + Privacy, service messages, optional marketing); append-only consent log with version, text hash, IP, device, time zone'],
  ['Student Advisory read in full before use', 'Consumer protection, DPDP s.6 (informed consent)', 'Full-screen document, "I accept" unlocks only after scrolling to the end; reading time measured on the server; typed signature'],
  ['Accept again when documents change', 'GDPR Art. 7, DPDP s.6', 'New version = new hash; students are blocked until they accept'],
  ['Children', 'GDPR Art. 8, DPDP s.9, Rule 10, US COPPA', 'Age question at sign-up; under 13 blocked; 13-17: parent / guardian signs the Declaration with a code to their own email and confirms they are 18+; no offers / promotions are sent to under-18 accounts (s.9(3))'],
  ['Notice to people already in the CRM', 'DPDP s.5(2)', 'India DPDP tab: send the privacy notice to every lead and student with an email once per policy version; new leads get it automatically'],
  ['Data Processors under contract', 'DPDP s.8(2), Rule 6', 'Processor register with DPA date, breach-notice hours and sub-processors; shown to students in "Who my data was shared with"'],
  ['Access and portability', 'GDPR Art. 15 / 20, DPDP s.11, CCPA right to know', 'Download my data (JSON + documents ZIP), access request with deadline'],
  ['Correction', 'GDPR Art. 16, DPDP s.12', 'Change requests from the profile + correction request'],
  ['Erasure', 'GDPR Art. 17, DPDP s.12, CCPA delete', 'Delete my account request (reviewed, legal retention explained)'],
  ['Withdraw consent, object, restrict', 'GDPR Art. 7(3), 18, 21; DPDP s.6(4)', 'Privacy centre; marketing stops immediately; others handled by Admin with deadline'],
  ['Do not sell or share; limit sensitive data', 'CCPA/CPRA, Virginia, Colorado, Texas and other US state laws', 'La Europa does not sell or share data; opt-out recorded instantly'],
  ['Nominate a person', 'DPDP s.14', 'Nominee in the privacy centre'],
  ['Grievance redressal', 'DPDP s.13, s.8(9), Rules 9 and 14, GDPR Art. 77', 'Public page /legal/privacy-contact (Grievance Officer, how to make a request, reply period, Board complaint); grievance requests due in the published working days (max 90)'],
  ['Who the data was shared with', 'DPDP s.11(1)(b)', 'Student portal > Privacy & my data lists the universities and service providers'],
  ['Security', 'GDPR Art. 32, DPDP s.8(5)', 'HTTPS, encrypted passport numbers, role-based access, signed 5-minute file links, audit log, lockouts'],
  ['Breach notification', 'GDPR Art. 33-34, DPDP s.8(6), Rule 7, US state laws', 'Breach register with the 72-hour clock, Board first intimation and 72-hour report times, ready letters for the Board and each affected person'],
  ['Cookies', 'EU ePrivacy, UK PECR', 'Only strictly necessary cookies; Cookie Notice explains them; no trackers'],
  ['Data retention', 'GDPR Art. 5(1)(e), DPDP s.8(7), Rule 8(3)', 'Retention period setting; cold leads erased after the set months (never before 1 year)'],
  ['International transfers', 'GDPR Chapter V, DPDP s.16', 'Explained in the Privacy Policy; SCCs to be signed with processors (legal task)']];
function Laws() {
  return (
    <>
      <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th>Requirement</th><th>Laws</th><th>How the system covers it</th></tr></thead><tbody>
        {LAWS.map((r) => <tr key={r[0]}><td data-label="Requirement"><b>{r[0]}</b></td><td data-label="Laws" className="small">{r[1]}</td><td data-label="How" className="small">{r[2]}</td></tr>)}</tbody></table></div></div>
      <p className="small muted">Still needed outside the software: lawyer review of the texts, data processing agreements with hosting / email providers, a DPO / EU representative decision, and staff training. Software cannot make a company compliant on its own.</p>
    </>
  );
}

export function Privacy({ sub = 'overview', portalUrl }: { sub?: string; portalUrl: string }) {
  const body = sub === 'dpdp' ? <Dpdp portalUrl={portalUrl} /> : sub === 'requests' ? <Requests /> : sub === 'consents' ? <Consents /> : sub === 'documents' ? <Documents />
    : sub === 'breaches' ? <Breaches /> : sub === 'laws' ? <Laws /> : <Overview />;
  return (
    <>
      <div className="tabs sub" style={{ marginBottom: 12 }}>{PRIVACY_TABS.map(([k, l]) => <Link key={k} href={`/admin/privacy/${k}`} className={k === sub ? 'on' : ''}>{l}</Link>)}</div>
      {body}
    </>
  );
}
