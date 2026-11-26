'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GET, POST, PUT, SEND, ApiError, download } from './api';
import { ago, fmtDT, fmtDate, money, qs } from './format';
import { FormGrid, formModal, toFormData, Options, type Field, type Vals } from './form';
import { Modal, confirmBox, openOverlay, showError, toast } from './ui';
import { openFile } from './portalcrm';

/** The client's CRM side of the university portal (legacy/public/js/pages/university.js): Admin > University portal, the University panel of an application, the updates queue, messages, the dashboard strip. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const B = ({ s, map }: { s: string; map: Record<string, string> }) => <span className={`badge ${map[s] || 'grey'}`}>{s}</span>;
const PST: Record<string, string> = { Active: 'green', Invited: 'orange', Draft: 'grey', Suspended: 'red', Closed: 'grey', None: 'grey' };
const AST: Record<string, string> = { Active: 'green', 'Expiring soon': 'orange', Expired: 'red', Terminated: 'grey', Draft: 'grey', None: 'grey' };
const UST: Record<string, string> = { New: 'blue', Acknowledged: 'purple', 'Documents requested': 'orange', 'Under assessment': 'purple', 'Interview scheduled': 'purple', Waitlisted: 'grey', 'Conditional offer': 'orange',
  'Unconditional offer': 'green', Rejected: 'red', 'Offer accepted': 'green', 'Deposit received': 'green', Enrolled: 'green', Withdrawn: 'grey' };
const LEVELS = ['Bachelor', 'Master', 'MBA', 'PhD', 'Diploma', 'Foundation', 'Language course'];

/** load a screen's data; `reload()` fetches again */
function useData<T = Any>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null); const [n, setN] = useState(0);
  useEffect(() => { let live = true; fn().then((d) => { if (live) setData(d); }).catch(showError); return () => { live = false; }; }, [...deps, n]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, reload: () => setN((x) => x + 1) };
}
const Loading = () => <div className="empty">Loading...</div>;
const openPdf = (url: string, name: string) => download(url, name, true).catch(showError);

// =====================================================================================
// Admin > University portal
// =====================================================================================
const ADMIN_TABS: [string, string][] = [['accounts', 'University accounts'], ['agreements', 'Partner agreements'], ['approvals', 'Approvals'], ['announcements', 'Announcements'], ['commission', 'Commission & invoices'], ['settings', 'Portal settings']];
export function UniAdmin({ sub = 'accounts', q }: { sub?: string; q: Record<string, string> }) {
  const s = ADMIN_TABS.some(([k]) => k === sub) ? sub : 'accounts';
  return (<>
    <div className="tabs sub" style={{ marginBottom: 12 }}>{ADMIN_TABS.map(([k, l]) => <Link key={k} href={`/admin/university/${k}`} className={k === s ? 'on' : ''}>{l}</Link>)}</div>
    {s === 'accounts' ? <Accounts /> : s === 'agreements' ? <Agreements /> : s === 'approvals' ? <Approvals q={q} /> : s === 'announcements' ? <Announcements /> : s === 'commission' ? <Commission q={q} /> : <UniSettings />}
  </>);
}

function Accounts() {
  const { data: d, reload } = useData(() => GET('/admin/uni-accounts'), []);
  if (!d) return <Loading />;
  return (<>
    <p className="small muted" style={{ marginTop: 0 }}>No public sign-up: only Admin creates university accounts. Activation needs an Active partner agreement (or an override with reason).</p>
    <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th>University</th><th>Code</th><th>Portal</th><th>Agreement</th><th>Partner manager</th><th>Users</th><th>Applications</th><th /></tr></thead><tbody>
      {d.rows.map((u: Any) => (
        <tr key={u.id}><td><div className="row" style={{ gap: 8 }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={u.logo ? apiImg(u.logo) : ''} alt="" style={{ width: 30, height: 30, borderRadius: 6, objectFit: 'contain', border: '1px solid var(--line)' }} />
          <div><b>{u.display_name}</b><div className="small muted">{u.city || ''}, {u.country}</div></div></div></td>
          <td className="small">{u.account_code || '-'}</td><td><B s={u.portal_status} map={PST} /></td><td><B s={u.agreement_status} map={AST} /></td><td className="small">{u.partner_manager || '-'}</td><td>{u.users}</td><td>{u.applications}</td>
          <td className="nowrap">{u.portal_status === 'None' ? <button className="btn xs primary" onClick={() => accountForm(d, u.id, null, reload)}>Create account</button> : <button className="btn xs" onClick={() => accountDetail(d, u.id, reload)}>Open</button>}</td></tr>))}
    </tbody></table></div></div>
  </>);
}
import { apiSrc as apiImg } from './format';
async function accountForm(d: Any, uniId: string, acc: Any | null, done: () => void) {
  const u = d.rows.find((x: Any) => x.id === uniId); const s = acc ? acc.settings : {};
  const creating = !acc;
  const fields: Field[] = [{ k: 'display_name', label: 'Portal display name', req: true, col: 3 }, { k: 'partner_manager_id', label: 'La Europa partner manager', type: 'select', req: true, opts: d.staff, col: 3 },
    ...(creating ? [{ k: 'contact_name', label: 'Main contact name', req: true, col: 3 }, { k: 'contact_email', label: 'Main contact email', type: 'email', req: true, col: 3, help: 'Official university domain recommended' },
      { k: 'contact_phone', label: 'Main contact phone', col: 3 }, { k: 'contact_designation', label: 'Main contact designation', col: 3 }] as Field[] : []),
    { k: 'notify_mode', label: 'Student notification mode', type: 'select', noBlank: true, opts: [['review', 'Counsellor reviews first (default)'], ['automatic', 'Automatic']], col: 3 },
    { k: 'max_users', label: 'Maximum university users', type: 'number', min: 1, max: 100, col: 1 }, { k: 'doc_access_months', label: 'Access months after decision', type: 'number', min: 0, col: 1, help: 'Empty = global setting' },
    { k: 'doc_access_rule', label: 'After enrolment, count from', type: 'select', noBlank: true, opts: [['enrolment', 'Enrolment date'], ['intake', 'Programme start']], col: 1 },
    { k: 'share_contact', label: 'Share student contact details (reason required)', type: 'checkbox', col: 3 }, { k: 'share_contact_reason', label: 'Reason for sharing contact details', col: 3, show: (v) => !!v.share_contact },
    { k: 'share_passport', label: 'Share full passport number', type: 'checkbox', col: 2 }, { k: 'share_visa', label: 'Share visa outcome', type: 'checkbox', col: 2 }, { k: 'viewer_docs', label: 'Viewer can see documents', type: 'checkbox', col: 2 },
    { k: 'officers_propose', label: 'Officers can propose course changes', type: 'checkbox', col: 2 }, { k: 'watermark', label: 'Watermark documents', type: 'checkbox', col: 2 }, { k: 'zip_download', label: 'Allow ZIP download', type: 'checkbox', col: 2 },
    { k: 'enrol_from_accepted', label: 'Allow "Enrolled" without deposit', type: 'checkbox', col: 2 }, { k: 'viewer_exports', label: 'Viewers can export reports', type: 'checkbox', col: 2 }, { k: 'show_expected_commission', label: 'Show expected commission to university', type: 'checkbox', col: 2 },
    { k: 'ip_allowlist', label: 'IP allow-list (optional, comma separated)', col: 6 }, { k: 'legal_name', label: 'Legal name (invoices)', col: 3 }, { k: 'vat_id', label: 'Tax / VAT ID', col: 3 }, { k: 'billing_address', label: 'Billing address', col: 6 },
    { k: 'internal_note', label: 'Internal note (never shown to the university)', type: 'textarea', col: 6 }];
  const values = acc ? { display_name: acc.display_name, partner_manager_id: acc.partner_manager_id, ...s, internal_note: acc.internal_note }
    : { display_name: u.name, notify_mode: 'review', max_users: 10, officers_propose: true, watermark: true, zip_download: true, viewer_exports: true, doc_access_rule: 'enrolment' };
  const save = async (v: Vals) => {
    try { const x = await POST('/admin/uni-accounts', { ...v, university_id: uniId }); if (x.warning) toast(x.warning); if (x.invite) toast(`Invite sent to ${x.invite.sent_to}`, 'ok'); return x; }
    catch (e) {
      if (e instanceof ApiError && e.data.needs_override) {
        const reason = await confirmBox(e.message, { title: 'No active agreement', ok: 'Invite with override', reason: true, reasonLabel: 'Override reason' });
        if (typeof reason === 'string') return POST('/admin/uni-accounts', { ...v, university_id: uniId, action: 'invite', override_reason: reason });
        return false;
      }
      throw e;
    }
  };
  const r = await formModal({ title: creating ? `Create partner portal account: ${u.name}` : `Settings: ${acc.display_name}`, size: 'lg', fields, values, saveLabel: creating ? 'Save as draft' : 'Save',
    extraButtons: creating ? (doSave) => <button className="btn primary" type="button" onClick={() => doSave({ action: 'invite' })}>Save and invite</button> : undefined, save });
  if (r) done();
}
async function accountDetail(d: Any, uniId: string, done: () => void) {
  let a: Any; try { a = await GET('/admin/uni-accounts/' + uniId); } catch (e) { showError(e); return; }
  openOverlay((close) => <AccountDetail a={a} d={d} uniId={uniId} close={close} done={done} />);
}
function AccountDetail({ a, d, uniId, close, done }: { a: Any; d: Any; uniId: string; close: () => void; done: () => void }) {
  const reopen = () => { close(); done(); accountDetail(d, uniId, done); };
  const act = async (action: string, body: Any = {}) => {
    try { return await POST(`/admin/uni-accounts/${uniId}/${action}`, body); }
    catch (e) {
      if (e instanceof ApiError && e.data.needs_override) {
        const reason = await confirmBox(e.message, { ok: 'Invite with override', reason: true, reasonLabel: 'Override reason' });
        if (typeof reason === 'string') return POST(`/admin/uni-accounts/${uniId}/${action}`, { override_reason: reason });
        return null;
      }
      showError(e); return null;
    }
  };
  const userAct = async (uid: string, x: string) => {
    if (!x) return;
    let body: Any = {};
    if (x === 'role') {
      const r = await formModal<Vals>({ title: 'Change role', fields: [{ k: 'role', label: 'New role', type: 'select', noBlank: true, opts: [['admin', 'University Admin'], ['officer', 'Admissions Officer'], ['viewer', 'University Viewer']], col: 6 }, { k: 'finance', label: 'Finance access', type: 'checkbox', col: 6 }],
        values: { role: 'officer' }, save: async (v) => v });
      if (!r) return; body = r;
    }
    try { await POST(`/admin/uni-users/${uid}/${x}`, body); toast('Done', 'ok'); reopen(); } catch (e) { showError(e); }
  };
  const addUser = async () => {
    if (await formModal({ title: 'Add university user', values: { role: 'officer' },
      fields: [{ k: 'name', label: 'Name', req: true, col: 3 }, { k: 'email', label: 'Email', type: 'email', req: true, col: 3 }, { k: 'role', label: 'Role', type: 'select', noBlank: true, opts: [['admin', 'University Admin'], ['officer', 'Admissions Officer'], ['viewer', 'University Viewer']], col: 3 }, { k: 'finance', label: 'Finance access', type: 'checkbox', col: 3 }],
      save: (v) => POST(`/admin/uni-accounts/${uniId}/users`, v) })) reopen();
  };
  return (
    <Modal title={a.display_name} size="xl" close={close}>
      {a.no_agreement ? <div className="pv-warn">No active agreement: new submissions are blocked for counsellors (Admin can override).</div> : null}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}><B s={a.portal_status} map={PST} /> <B s={a.agreement_status} map={AST} /> <span className="small muted">{a.account_code || ''} · partner manager {a.partner_manager || '-'}</span><span className="grow" />
        <button className="btn sm" onClick={() => { close(); accountForm(d, uniId, a, done); }}>Settings</button>
        {a.portal_status === 'Draft' || a.portal_status === 'Invited' ? <button className="btn sm primary" onClick={async () => { const r = await act('invite'); if (r) { toast(`Invite sent to ${r.sent_to}`, 'ok'); reopen(); } }}>Send / resend invite</button> : null}
        {a.portal_status === 'Active' ? <><button className="btn sm" onClick={async () => { const r = await act('preview'); if (r) window.open(r.url, '_blank', 'noopener'); }}>View as university</button>
          <button className="btn sm danger" onClick={async () => { const reason = await confirmBox('Suspend this university? All logins are blocked at once.', { danger: true, ok: 'Suspend', reason: true }); if (typeof reason === 'string' && (await act('suspend', { reason }))) reopen(); }}>Suspend</button></> : null}
        {a.portal_status === 'Suspended' ? <button className="btn sm" onClick={async () => { if (await act('reactivate')) reopen(); }}>Re-activate</button> : null}
        {a.portal_status !== 'Closed' ? <button className="btn sm danger" onClick={async () => { const name = await confirmBox(`Close the partner portal account? Type the university name "${a.display_name}" to confirm.`, { danger: true, ok: 'Close account', reason: true, reasonLabel: 'University name' }); if (typeof name === 'string' && (await act('close', { confirm_name: name }))) reopen(); }}>Close account</button> : null}
      </div>
      {a.suspend_reason ? <div className="pv-warn">Suspended: {a.suspend_reason}</div> : null}
      <div className="grid two">
        <div className="card"><div className="hd"><h2>Users</h2><span className="grow" /><button className="btn xs" onClick={addUser}>+ Add user</button></div><div className="table-wrap"><table className="tbl"><tbody>
          {a.users_list.map((x: Any) => (
            <tr key={x.id}><td><b>{x.name}</b>{x.main ? <> <span className="badge blue">Main</span></> : null}<div className="small muted">{x.email}</div></td>
              <td className="small">{x.role_label}{x.finance ? ' + finance' : ''}</td><td><B s={x.status} map={{ Active: 'green', Invited: 'orange', Inactive: 'grey' }} />{x.locked ? <> <span className="badge red">Locked</span></> : null}</td>
              <td className="small">{x.last_login_at ? ago(x.last_login_at) : 'never'}</td>
              <td><select className="input" style={{ width: 'auto', height: 28, fontSize: 12 }} value="" onChange={(e) => userAct(x.id, e.target.value)}><option value="">Action...</option>
                {x.status === 'Invited' ? <option value="resend">Resend invite</option> : null}{x.status === 'Inactive' ? <option value="activate">Activate / unlock</option> : <><option value="deactivate">Deactivate</option><option value="activate">Unlock</option></>}
                <option value="logout">Force logout</option><option value="role">Change role</option></select></td></tr>))}
        </tbody></table></div></div>
        <div className="card"><div className="hd"><h2>Agreements</h2><span className="grow" /><Link className="btn xs" href="/admin/university/agreements" onClick={close}>Manage</Link></div><div className="bd small">
          {a.agreements.length ? a.agreements.map((x: Any) => <div key={x.id}>{x.agreement_code} {x.title} · {fmtDate(x.start_date)} to {x.end_date ? fmtDate(x.end_date) : 'open'} <B s={x.status} map={AST} /></div>) : 'No agreement yet'}</div>
          <div className="hd"><h2>Terms accepted</h2></div><div className="bd small">{a.consents.length ? a.consents.map((c: Any, i: number) => <div key={i}>{c.name}: {c.doc_type === 'uni_terms' ? 'Terms' : 'Data Processing'} v{c.version || ''} · {fmtDT(c.created_at)}</div>) : '-'}</div></div>
      </div>
      <div className="card" style={{ marginTop: 12 }}><div className="hd"><h2>Activity</h2></div><div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto' }}><table className="tbl"><tbody>
        {a.activity.length ? a.activity.map((x: Any, i: number) => <tr key={i}><td className="small nowrap">{fmtDT(x.created_at)}</td><td className="small">{x.who || '-'} <span className="muted">({x.actor_type || 'staff'})</span></td><td className="small">{x.action} {x.entity_type || ''}</td><td className="small muted">{x.entity_label || ''}</td><td className="small muted">{x.ip || ''}</td></tr>)
          : <tr><td className="empty">No activity</td></tr>}</tbody></table></div></div>
    </Modal>
  );
}

function Agreements() {
  const { data, reload } = useData(async () => ({ d: await GET('/admin/agreements'), accs: await GET('/admin/uni-accounts') }), []);
  if (!data) return <Loading />;
  const { d, accs } = data;
  const form = async (a: Any | null) => {
    const fields: Field[] = [...(a ? [] : [{ k: 'university_id', label: 'University', type: 'select', req: true, opts: accs.rows.map((u: Any) => [u.id, u.display_name]), col: 6 } as Field]), { k: 'title', label: 'Agreement title / type', req: true, col: 6 },
      { k: 'start_date', label: 'Start date', type: 'date', req: true, col: 2 }, { k: 'end_date', label: 'End date (empty = until terminated)', type: 'date', col: 2 }, { k: 'signed_on', label: 'Signed on', type: 'date', req: true, col: 2 },
      { k: 'signed_by_le', label: 'Signed by (La Europa): name and designation', req: true, col: 3 }, { k: 'signed_by_uni', label: 'Signed by (University)', req: true, col: 3 },
      { k: 'auto_renew', label: 'Auto-renew', type: 'checkbox', col: 2 }, { k: 'notice_days', label: 'Notice period (days)', type: 'number', min: 0, max: 365, col: 2 }, { k: 'payment_terms_days', label: 'Payment terms (days)', type: 'number', col: 1 }, { k: 'invoice_currency', label: 'Invoice currency', type: 'select', opts: d.currencies, col: 1 },
      { k: 'territory', label: 'Territory / countries of recruitment', type: 'multi', opts: d.countries, col: 6 }, { k: 'scope_text', label: 'Levels / courses covered', col: 6 }, { k: 'commission_terms', label: 'Commission terms summary (no rates here: use Commission rules)', type: 'textarea', col: 6 },
      { k: 'file', label: 'Agreement PDF (max 25 MB)' + (a ? ' - upload only to add a new version' : ''), type: 'file', accept: '.pdf', col: 3 }, { k: 'show_to_uni', label: 'Show agreement to the University Admin', type: 'checkbox', col: 3 },
      { k: 'internal_note', label: 'Internal note', type: 'textarea', col: 6 }];
    const r = await formModal({ title: a ? `Edit ${a.agreement_code}` : 'Record partner agreement', size: 'lg', fields, values: a ? { ...a, territory: a.territory ?? [] } : { show_to_uni: true, territory: [] },
      save: (v) => SEND('post', '/admin/agreements', toFormData({ ...v, territory: JSON.stringify(v.territory || []), id: a?.id })) });
    if (r) reload();
  };
  return (<>
    <div className="row" style={{ marginBottom: 10 }}><span className="small muted grow">Agreements are signed in the name of Euroverse Service LLP, trading as La Europa Education. PDFs are never emailed; only viewed here through signed links.</span><button className="btn primary sm" onClick={() => form(null)}>+ Record agreement</button></div>
    <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th>Agreement</th><th>University</th><th>Period</th><th>Signed</th><th>Payment terms</th><th>Status</th><th /></tr></thead><tbody>
      {d.rows.length ? d.rows.map((a: Any) => (
        <tr key={a.id}><td><b>{a.agreement_code}</b><div className="small">{a.title}</div></td><td>{a.university}</td><td className="small">{fmtDate(a.start_date)} to {a.end_date ? fmtDate(a.end_date) : 'until terminated'}</td>
          <td className="small">{fmtDate(a.signed_on)}<div className="muted">{a.signed_by_uni || ''}</div></td><td className="small">{a.payment_terms_days ? a.payment_terms_days + ' days' : '-'} {a.invoice_currency || ''}</td><td><B s={a.status} map={AST} /></td>
          <td className="nowrap">{a.has_pdf ? <><button className="btn xs" onClick={() => openFile(`/admin/agreements/${a.id}/pdf`)}>PDF</button> </> : null}<button className="btn xs" onClick={() => form(a)}>Edit</button>{' '}
            {a.status !== 'Terminated' ? <button className="btn xs danger" onClick={async () => { const reason = await confirmBox('Terminate this agreement?', { danger: true, ok: 'Terminate', reason: true }); if (typeof reason === 'string') { try { await POST(`/admin/agreements/${a.id}/terminate`, { reason }); reload(); } catch (e) { showError(e); } } }}>Terminate</button> : null}</td></tr>))
        : <tr><td colSpan={7} className="empty">No agreements yet</td></tr>}
    </tbody></table></div></div>
  </>);
}

const show = (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? ''));
function diff(x: Any) {
  const p = x.payload || {}; const o = x.old || {};
  const keys = [...new Set(Object.keys(p))].filter((k) => !['english', 'intakes', 'applies', 'logo', 'cover'].includes(k));
  const ov = (k: string) => o[k] ?? o.academic?.[k];
  openOverlay((close) => (
    <Modal title={`${x.university}: ${x.change_type}`} size="xl" close={close}>
      {x.entity === 'profile' && x.logo_new ? <div className="row" style={{ gap: 20, marginBottom: 10 }}>
        <div className="small">Logo now<br />{/* eslint-disable-next-line @next/next/no-img-element */}<img src={apiImg(x.logo_old)} alt="" style={{ width: 80, height: 80, objectFit: 'contain', border: '1px solid var(--line)', borderRadius: 10 }} /></div>
        <div className="small">New logo<br /><button className="btn xs" onClick={() => openFile(String(x.logo_new).replace(/^\/api/, ''))}>View new logo</button></div></div> : null}
      <table className="tbl"><thead><tr><th>Field</th><th>Current (live)</th><th>Requested</th></tr></thead><tbody>
        {keys.map((k) => { const ch = show(ov(k)) !== show(p[k]); return <tr key={k} className={ch ? 'row-danger' : ''}><td>{k}</td><td className="small">{show(ov(k))}</td><td className="small">{ch ? <b>{show(p[k])}</b> : show(p[k])}</td></tr>; })}
        {p.intakes ? <tr><td>intakes</td><td className="small">{(o.intakes || []).map((i: Any) => `${i.label} deadline ${i.deadline} ${i.status}`).join('; ')}</td><td className="small"><b>{p.intakes.map((i: Any) => `${i.month}/${i.year || 'every year'} deadline ${i.deadline} ${i.status}${i.closed_reason ? ' (' + i.closed_reason + ')' : ''}`).join('; ')}</b></td></tr> : null}
        {p.english ? <tr><td>english</td><td className="small">{(o.english || []).map((e: Any) => `${e.test_type} ${e.min_overall}${e.min_band ? '/' + e.min_band : ''}`).join('; ')}</td><td className="small"><b>{p.english.map((e: Any) => `${e.test_type} ${e.min_overall}${e.min_band ? '/' + e.min_band : ''}`).join('; ')}{p.moi_accepted ? ' + MOI' : ''}</b></td></tr> : null}
        {p.applies ? <tr><td>applies to</td><td /><td className="small">{JSON.stringify(p.applies)}</td></tr> : null}
      </tbody></table>
      {x.entity === 'course' ? <div className="small muted" style={{ marginTop: 8 }}>Preview as students will see it: {p.name || ''} ({p.level || ''}) · {p.tuition_fee ?? ''} {p.currency || ''} / year · Application fee {p.application_fee ?? ''} · Min {p.min_percent ?? ''}%</div> : null}
    </Modal>));
}
function Approvals({ q }: { q: Record<string, string> }) {
  const { data: d, reload } = useData(() => GET('/admin/uni-approvals'), []);
  if (!d) return <Loading />;
  const tab = q.tab || 'courses';
  const tabs: [string, string][] = [['courses', `Courses (${d.courses.length})`], ['profiles', `Profiles (${d.profiles.length})`], ['campuses', `Campuses (${d.campuses.length})`], ['scholarships', `Scholarships (${d.scholarships.length})`], ['batches', `Bulk batches (${d.batches.length})`], ['history', 'History']];
  const kind = (x: Any) => (x.entity === 'profile' ? 'profile' : 'course');
  const approve = async (x: Any) => { try { await POST(`/admin/uni-approvals/${kind(x)}/${x.id}/approve`, {}); toast('Approved: live now', 'ok'); reload(); } catch (e) { showError(e); } };
  const reject = async (x: Any) => { const reason = await confirmBox('Reject this change? The reason is shown to the university.', { danger: true, ok: 'Reject', reason: true }); if (typeof reason === 'string') { try { await POST(`/admin/uni-approvals/${kind(x)}/${x.id}/reject`, { reason }); reload(); } catch (e) { showError(e); } } };
  const withEdits = async (x: Any) => {
    const keys = ['name', 'short_name', 'about', 'description', 'fee_note', 'course_link', 'academic_note', 'city'].filter((k) => x.payload[k] !== undefined);
    const r = await formModal({ title: 'Approve with edits', size: 'lg', saveLabel: 'Approve', values: x.payload,
      fields: [...keys.map((k) => ({ k, label: k.replace(/_/g, ' '), type: ['about', 'description'].includes(k) ? 'textarea' : 'text', col: 6 } as Field)), { k: '__note', label: 'Note to the university', col: 6 }],
      save: (v) => { const note = v.__note; const edits = Object.fromEntries(Object.entries(v).filter(([k, val]) => k !== '__note' && keys.includes(k) && String(val ?? '') !== String(x.payload[k] ?? ''))); return POST(`/admin/uni-approvals/${kind(x)}/${x.id}/approve`, { edits, note }); } });
    if (r) reload();
  };
  const Row = ({ x }: { x: Any }) => (
    <div className={`card appr ${x.urgent ? 'urgent' : ''}`} style={{ marginBottom: 10 }}><div className="hd">
      <div><b>{x.university}</b>: {x.change_type} {x.urgent ? <span className="badge red">URGENT: {x.urgent_reason}</span> : null}{x.late ? <> <span className="badge red">More than 3 working days</span></> : null}{x.fee_flag ? <> <span className="badge orange">Fee wording</span></> : null}
        <div className="small muted">{x.by || ''} · {fmtDT(x.created_at)}{x.batch_id ? ' · bulk batch' : ''}</div></div><span className="grow" />
      <button className="btn sm" onClick={() => diff(x)}>Old vs new</button><button className="btn sm primary" onClick={() => approve(x)}>Approve</button>
      <button className="btn sm" onClick={() => withEdits(x)}>Approve with edits</button><button className="btn sm danger" onClick={() => reject(x)}>Reject</button></div>
      {(x.warnings || []).length ? <div className="bd small text-orange">{x.warnings.join(' ')}</div> : null}
    </div>);
  return (<>
    <div className="tabs sub" style={{ marginBottom: 10 }}>{tabs.map(([k, l]) => <Link key={k} href={`/admin/university/approvals?tab=${k}`} className={k === tab ? 'on' : ''}>{l}</Link>)}</div>
    {tab === 'batches' ? <div className="card"><div className="table-wrap"><table className="tbl"><tbody>
      {d.batches.length ? d.batches.map((b: Any) => <tr key={b.id}><td><b>{b.university}</b><div className="small muted">{b.file_name} · {fmtDT(b.createdAt)}</div></td><td className="small">{Object.entries(b.counts || {}).map(([k, v]) => k + ' ' + v).join(', ')}</td><td>{b.pending} pending</td>
        <td><button className="btn xs primary" onClick={async () => { try { const r = await POST(`/admin/uni-approvals/batch/${b.id}/approve`); toast(`${r.approved} approved${r.errors.length ? ', ' + r.errors.length + ' failed' : ''}`, 'ok'); reload(); } catch (e) { showError(e); } }}>Approve whole batch</button> <Link className="btn xs" href="/admin/university/approvals?tab=courses">Row by row</Link></td></tr>)
        : <tr><td className="empty">No pending batches</td></tr>}</tbody></table></div></div>
      : tab === 'history' ? <div className="card"><div className="table-wrap"><table className="tbl"><tbody>
        {d.history.length ? d.history.map((h: Any) => <tr key={h.id}><td className="small">{fmtDT(h.reviewed_at)}</td><td>{h.university}</td><td>{h.change_type}: {h.name || ''}</td>
          <td><B s={h.status} map={{ Approved: 'green', 'Approved with edits': 'green', Rejected: 'red', Withdrawn: 'grey' }} />{h.auto_approved ? <> <span className="badge grey">auto</span></> : null}</td><td className="small muted">{h.review_note || ''}</td></tr>)
          : <tr><td className="empty">None</td></tr>}</tbody></table></div></div>
      : (d[tab] || []).length ? (d[tab] as Any[]).map((x) => <Row key={x.id} x={x} />) : <div className="empty">Nothing waiting for approval</div>}
  </>);
}

function Announcements() {
  const { data: d, reload } = useData(() => GET('/admin/uni-announcements'), []);
  const [n, setN] = useState<Vals>({}); const [errs, setErrs] = useState<Record<string, string>>({});
  if (!d) return <Loading />;
  const act = async (id: string, a: string, body: Any = {}) => { try { await POST(`/admin/uni-announcements/${id}/${a}`, body); reload(); return true; } catch (e) { showError(e); return false; } };
  const reply = async (id: string) => { const r = await formModal<Vals>({ title: 'Reply', fields: [{ k: 'body', label: 'Reply (posted in the General thread with the university)', type: 'textarea', req: true, col: 6 }], save: async (v) => v }); if (r && (await act(id, 'reply', r))) toast('Reply sent', 'ok'); };
  const notice = async () => { setErrs({}); try { await POST('/admin/uni-notices', n); toast('Notice posted', 'ok'); setN({}); reload(); } catch (e) { if (e instanceof ApiError && e.data.errors) setErrs(e.data.errors); showError(e); } };
  return (
    <div className="grid two">
      <div><h3 style={{ marginTop: 0 }}>From universities</h3>
        {d.rows.length ? d.rows.map((a: Any) => (
          <div key={a.id} className="card" style={{ marginBottom: 10 }}><div className="hd"><div><b>{a.important ? <span className="text-red">IMPORTANT </span> : null}{a.title}</b><div className="small muted">{a.university} · {a.type} · {fmtDT(a.createdAt)}{a.by ? ' · ' + a.by : ''}</div></div><span className="grow" />
            <B s={a.status} map={{ Posted: 'orange', 'Seen by La Europa': 'blue', Handled: 'green' }} /></div>
            <div className="bd"><div className="small" style={{ whiteSpace: 'pre-wrap' }}>{a.body}</div>{a.related.length ? <div className="small muted">Courses: {a.related.join(', ')}</div> : null}
              {a.attachments.map((x: Any) => <a key={x.id} className="small" href="#" onClick={(e) => { e.preventDefault(); openFile(`/admin/uni-announcements/${a.id}/attachment/${x.id}`); }}>📎 {x.name} </a>)}
              <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {a.published_at ? <span className="badge green">Published {fmtDate(a.published_at)}</span> : <>
                  <button className="btn xs primary" onClick={async () => { if (await act(a.id, 'publish', { scope: 'all' })) toast('Published to counsellors', 'ok'); }}>Publish to all counsellors</button>
                  <button className="btn xs" onClick={async () => { if (await act(a.id, 'publish', { scope: 'active' })) toast('Published to counsellors', 'ok'); }}>Publish to counsellors with active applications</button></>}
                <Link className="btn xs" href="/admin/university/approvals">Create change from this</Link><button className="btn xs" onClick={() => reply(a.id)}>Reply</button>
                {a.status !== 'Handled' ? <button className="btn xs" onClick={() => act(a.id, 'handled')}>Mark as handled</button> : null}
              </div></div></div>)) : <div className="empty">No announcements</div>}
        <p className="small muted">A deadline or fee in an announcement does not change the catalogue. Ask the university to submit the change, or edit the course directly (logged).</p></div>
      <div><h3 style={{ marginTop: 0 }}>Partner notices from La Europa</h3>
        <div className="card"><div className="bd"><form noValidate onSubmit={(e) => e.preventDefault()}>
          <FormGrid fields={[{ k: 'university_id', label: 'To', type: 'select', blank: 'All universities', opts: d.universities, col: 6 }, { k: 'title', label: 'Title', req: true, col: 6 }, { k: 'body', label: 'Text', type: 'textarea', col: 6 }, { k: 'active_until', label: 'Show until', type: 'date', col: 3 }]}
            vals={n} set={(k, x) => setN((s) => ({ ...s, [k]: x }))} errors={errs} /></form>
          <div className="form-actions"><button className="btn primary sm" onClick={notice}>Post notice</button></div></div></div>
        {d.notices.map((x: Any) => <div key={x.id} className="card" style={{ marginTop: 8 }}><div className="bd small"><b>{x.title}</b> → {x.university}<div>{x.body || ''}</div>
          <div className="muted">{fmtDT(x.createdAt)}{x.active_until ? ' · until ' + fmtDate(x.active_until) : ''} <a href="#" onClick={async (e) => { e.preventDefault(); try { await POST('/admin/uni-notices', { delete: x.id }); reload(); } catch (er) { showError(er); } }}>delete</a></div></div></div>)}
      </div>
    </div>
  );
}

const CS: Record<string, string> = { Expected: 'grey', 'Needs rule': 'red', Due: 'orange', Invoiced: 'blue', Paid: 'green', Overdue: 'red', Cancelled: 'grey' };
const IS: Record<string, string> = { Draft: 'grey', Invoiced: 'blue', 'Partially paid': 'orange', Paid: 'green', Overdue: 'red', Cancelled: 'grey' };
function Commission({ q }: { q: Record<string, string> }) {
  const tab = q.tab || 'records';
  const tabs: [string, string][] = [['records', 'Commission records'], ['invoices', 'Invoices'], ['rules', 'Commission rules'], ['reports', 'Reports']];
  return (<>
    <div className="pv-warn">Confidential: commission is visible only to La Europa Admin and to university users with finance access of that one university.</div>
    <div className="tabs sub" style={{ marginBottom: 10 }}>{tabs.map(([k, l]) => <Link key={k} href={`/admin/university/commission?tab=${k}`} className={k === tab ? 'on' : ''}>{l}</Link>)}</div>
    {tab === 'rules' ? <Rules /> : tab === 'reports' ? <CReports q={q} /> : <Records q={q} tab={tab} />}
  </>);
}
function Records({ q, tab }: { q: Record<string, string>; tab: string }) {
  const router = useRouter();
  const { data: d, reload } = useData(() => GET('/admin/commission' + qs({ university: q.university, status: q.status })), [q.university, q.status]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  if (!d) return <Loading />;
  const setQ = (p: Record<string, string>) => router.push('/admin/university/commission' + qs({ university: q.university, status: q.status, ...p, tab }));
  const act = async (path: string, body?: Any) => { try { await POST(path, body); toast('Done', 'ok'); reload(); } catch (e) { showError(e); } };
  if (tab === 'records') {
    const invoice = async () => {
      const r = await formModal({ title: 'Create invoice (draft)', values: { invoice_date: new Date().toISOString().slice(0, 10) },
        fields: [{ k: 'invoice_date', label: 'Invoice date', type: 'date', col: 3 }, { k: 'due_date', label: 'Due date (empty = payment terms of the agreement)', type: 'date', col: 3 },
          { k: 'tax_name', label: 'Tax line name (optional, set by your accountant)', col: 2 }, { k: 'tax_percent', label: 'Tax %', type: 'number', col: 2 }, { k: 'tax_na', label: 'Tax not applicable', type: 'checkbox', col: 2 },
          { k: 'tax_note', label: 'Tax note (e.g. exemption)', col: 6 }, { k: 'notes', label: 'Notes printed on the invoice', type: 'textarea', col: 6 }],
        save: (v) => POST('/admin/commission/invoices', { commission_ids: [...sel], invoice_date: v.invoice_date, due_date: v.due_date, notes: v.notes, taxes: v.tax_name ? [{ name: v.tax_name, percent: v.tax_percent, not_applicable: v.tax_na, note: v.tax_note }] : [] }) });
      if (r) { toast('Draft invoice created: check the PDF and issue it', 'ok'); setSel(new Set()); router.push('/admin/university/commission?tab=invoices'); }
    };
    const edit = async (c: Any) => {
      const r = await formModal({ title: `Commission ${c.commission_code}`, values: { ...c, rule_id: c.rule_id ? String(c.rule_id) : '' },
        fields: [{ k: 'rule_id', label: 'Rule', type: 'select', opts: d.rules.filter((x: Any) => String(x.university_id) === String(c.university_id)).map((x: Any) => [x.id, x.name]), col: 3 }, { k: 'basis_amount', label: 'Basis amount', type: 'number', col: 3 },
          { k: 'amount', label: 'Commission amount (manual)', type: 'number', col: 2 }, { k: 'fx_rate', label: 'Exchange rate to invoice currency', type: 'number', step: 0.0001, col: 2 }, { k: 'invoice_currency', label: 'Invoice currency', col: 1 }, { k: 'fx_date', label: 'Rate date', type: 'date', col: 1 },
          { k: 'reason', label: 'Reason (required for a manual change or cancel)', col: 6 }, { k: 'internal_note', label: 'Internal note', type: 'textarea', col: 6 }, { k: 'cancel', label: 'Cancel this commission line', type: 'checkbox', col: 6 }],
        save: (v) => PUT('/admin/commission/' + c.id, v) });
      if (r) reload();
    };
    return (<>
      <form className="filters" onSubmit={(e) => e.preventDefault()}>
        <select value={q.university || ''} onChange={(e) => setQ({ university: e.target.value })}><option value="">All universities</option><Options list={d.universities} /></select>
        <select value={q.status || ''} onChange={(e) => setQ({ status: e.target.value })}><option value="">All statuses</option><Options list={Object.keys(CS)} /></select><span className="grow" />
        <button type="button" className="btn sm primary" disabled={!sel.size} onClick={invoice}>Create invoice from selected</button></form>
      <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th /><th>ID</th><th>University</th><th>Student / application</th><th>Course · intake</th><th>Enrolled</th><th>Basis</th><th>Rate</th><th>Amount</th><th>Status</th><th /></tr></thead><tbody>
        {d.rows.length ? d.rows.map((c: Any) => (
          <tr key={c.id}><td>{c.status === 'Due' && !c.invoice_id ? <input type="checkbox" checked={sel.has(c.id)} onChange={(e) => setSel((s) => { const x = new Set(s); if (e.target.checked) x.add(c.id); else x.delete(c.id); return x; })} /> : null}</td>
            <td className="small">{c.commission_code}</td><td>{c.university}</td><td>{c.student}<div className="small muted">{c.application_code}</div></td><td className="small">{c.course} · {c.intake}</td>
            <td className="small">{fmtDate(c.enrol_date)}</td><td>{c.basis_amount != null ? money(c.basis_amount, c.basis_currency) : '-'}</td><td className="small">{c.rate ? c.rate + '%' : c.fixed_amount ? 'Fixed' : '-'}<div className="muted">{c.rule || ''}</div></td>
            <td><b>{c.amount != null ? money(c.amount, c.currency) : '-'}</b>{c.invoice_amount ? <div className="small muted">{money(c.invoice_amount, c.invoice_currency)} @ {c.fx_rate}</div> : null}</td>
            <td><B s={c.status} map={CS} />{c.invoice_no ? <div className="small">{c.invoice_no}</div> : null}</td><td><button className="btn xs" onClick={() => edit(c)}>Edit</button></td></tr>))
          : <tr><td colSpan={11} className="empty">No commission records yet. They are created automatically when a university marks a student as enrolled.</td></tr>}
      </tbody></table></div></div>
    </>);
  }
  const recordPay = async (id: string) => {
    const r = await formModal({ title: 'Record payment from bank statement', fields: [{ k: 'amount', label: 'Amount', type: 'number', req: true, col: 2 }, { k: 'payment_date', label: 'Date', type: 'date', req: true, col: 2 }, { k: 'reference', label: 'Bank reference', col: 2 }, { k: 'note', label: 'Note', col: 6 }],
      save: (v) => POST(`/admin/commission/invoices/${id}/record-payment`, v) });
    if (r) reload();
  };
  const confirmPay = async (id: string) => {
    const r = await formModal<Vals>({ title: 'Confirm payment received', fields: [{ k: 'amount', label: 'Confirmed amount (adjust for bank charges if needed). Leave empty to confirm the submitted amount.', type: 'number', col: 6 }], save: async (v) => v });
    if (r) act(`/admin/commission/payments/${id}/confirm`, r.amount ? { amount: r.amount } : {});
  };
  const replyQ = async (id: string) => { const r = await formModal<Vals>({ title: 'Reply to the university', fields: [{ k: 'body', label: 'Reply', type: 'textarea', req: true, col: 6 }], save: async (v) => v }); if (r) act(`/admin/commission/queries/${id}/reply`, r); };
  return d.invoices.length ? <>{d.invoices.map((i: Any) => (
    <div key={i.id} className="card" style={{ marginBottom: 10 }}>
      <div className="hd"><div><b>{i.invoice_no}</b> {i.kind === 'credit_note' ? <span className="badge grey">Credit note</span> : null} <B s={i.status} map={IS} />{i.query_open ? <> <span className="badge orange">Query open</span></> : null}{i.reminders_paused ? <> <span className="badge grey">Reminders paused</span></> : null}
        <div className="small muted">{i.university} · {fmtDate(i.invoice_date)} · due {fmtDate(i.due_date)} · {i.lines} line(s)</div></div><span className="grow" /><b>{money(i.total, i.currency)}</b>&nbsp;<span className="small muted">balance {money(i.balance, i.currency)}</span></div>
      <div className="bd">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="btn xs" onClick={() => (i.status === 'Draft' ? openPdf(`/admin/commission/invoices/${i.id}/pdf`, `${i.invoice_no}.pdf`) : openFile(`/admin/commission/invoices/${i.id}/pdf`))}>{i.status === 'Draft' ? 'Preview PDF' : 'PDF'}</button>
          {i.status === 'Draft' ? <><button className="btn xs primary" onClick={async () => { if (await confirmBox('Issue the invoice? The number is fixed and the university finance contacts are emailed.', { ok: 'Issue and send' })) act(`/admin/commission/invoices/${i.id}/issue`); }}>Issue and send</button>
            <button className="btn xs" onClick={() => act(`/admin/commission/invoices/${i.id}/discard`)}>Discard draft</button></> : null}
          {['Invoiced', 'Partially paid', 'Overdue'].includes(i.status) && i.kind === 'invoice' ? <><button className="btn xs" onClick={() => recordPay(i.id)}>Record payment from bank</button>
            <button className="btn xs" onClick={() => act(`/admin/commission/invoices/${i.id}/${i.reminders_paused ? 'resume' : 'pause'}`)}>{i.reminders_paused ? 'Resume' : 'Pause'} reminders</button></> : null}
          {['Invoiced', 'Partially paid', 'Overdue', 'Paid'].includes(i.status) && i.kind === 'invoice' ? <button className="btn xs danger" onClick={async () => { const reason = await confirmBox('Cancel this invoice? A credit note with its own number is generated and sent. Issued invoices are never edited.', { danger: true, ok: 'Cancel with credit note', reason: true }); if (typeof reason === 'string') act(`/admin/commission/invoices/${i.id}/cancel`, { reason }); }}>Cancel with credit note</button> : null}
        </div>
        {i.payments.map((p: Any) => <div key={p.id} className="small" style={{ marginTop: 6 }}>Payment {money(p.amount, p.currency)} on {fmtDate(p.payment_date)} · ref {p.reference || '-'} · {p.source} · <b>{p.status}</b>{' '}
          {p.proof_url ? <a href="#" onClick={(e) => { e.preventDefault(); openFile(`/admin/commission/payments/${p.id}/proof`); }}>proof</a> : null}
          {p.status === 'Submitted' ? <> <button className="btn xs primary" onClick={() => confirmPay(p.id)}>Confirm received</button> <button className="btn xs" onClick={async () => { const reason = await confirmBox('Reject this payment proof? The reason is shown to the university.', { reason: true, ok: 'Reject' }); if (typeof reason === 'string') act(`/admin/commission/payments/${p.id}/reject`, { reason }); }}>Reject</button></> : null}</div>)}
        {i.queries.map((qq: Any) => <div key={qq.id} className="req" style={{ marginTop: 6 }}><b className="small">Query ({qq.status})</b>{(qq.messages || []).map((m: Any, k: number) => <div key={k} className="small">{m.sender_type === 'university' ? 'University' : 'La Europa'}: {m.body}</div>)}
          {qq.status === 'Open' ? <><button className="btn xs" onClick={() => replyQ(qq.id)}>Reply</button> <button className="btn xs" onClick={() => act(`/admin/commission/queries/${qq.id}/close`)}>Close query</button></> : null}</div>)}
      </div></div>))}</> : <div className="empty">No invoices yet</div>;
}
function Rules() {
  const { data: d, reload } = useData(() => GET('/admin/commission/rules'), []);
  if (!d) return <Loading />;
  const form = async (r0: Any | null) => {
    const fields: Field[] = [{ k: 'university_id', label: 'University', type: 'select', req: true, opts: d.universities, col: 3 },
      { k: 'agreement_id', label: 'Partner agreement', type: 'select', req: true, opts: (v) => d.agreements.filter((a: Any) => String(a.university_id) === String(v.university_id)).map((a: Any) => [a.id, `${a.agreement_code} ${a.title}`]), col: 3 },
      { k: 'name', label: 'Rule name', req: true, col: 6 }, { k: 'scope', label: 'Scope', type: 'select', noBlank: true, opts: [['all', 'All courses'], ['levels', 'Selected levels'], ['courses', 'Selected courses (IDs)'], ['campuses', 'Selected campuses (IDs)']], col: 2 },
      { k: 'scope_ids', label: 'Levels (for "Selected levels")', type: 'multi', opts: LEVELS, col: 4, show: (v) => v.scope === 'levels' },
      { k: 'basis', label: 'Basis', type: 'select', noBlank: true, opts: [['gross', '% of first-year tuition (gross)'], ['net', '% of first-year tuition after scholarship'], ['fixed', 'Fixed amount per enrolled student']], col: 3 },
      { k: 'rate', label: 'Rate %', type: 'number', step: 0.01, col: 1, show: (v) => v.basis !== 'fixed' }, { k: 'fixed_amount', label: 'Fixed amount', type: 'number', col: 1, show: (v) => v.basis === 'fixed' }, { k: 'fixed_currency', label: 'Currency', type: 'select', opts: d.currencies, col: 1, show: (v) => v.basis === 'fixed' },
      { k: 'due_event', label: 'Becomes due on', type: 'select', noBlank: true, opts: [['enrolled', 'Enrolled'], ['deposit', 'Deposit received'], ['days', 'Enrolment date + N days']], col: 2 }, { k: 'due_days', label: 'N days', type: 'number', col: 1, show: (v) => v.due_event === 'days' },
      { k: 'valid_from', label: 'Valid from', type: 'date', req: true, col: 2 }, { k: 'valid_to', label: 'Valid to', type: 'date', col: 2 }, { k: 'min_amount', label: 'Minimum per student', type: 'number', col: 1 }, { k: 'max_amount', label: 'Maximum per student', type: 'number', col: 1 },
      { k: 'show_to_uni', label: 'Show summary to university finance users', type: 'checkbox', col: 3 }, { k: 'status', label: 'Status', type: 'select', noBlank: true, opts: ['Active', 'Inactive'], col: 3 }, { k: 'internal_note', label: 'Internal note', type: 'textarea', col: 6 }];
    const r = await formModal({ title: r0 ? 'Edit commission rule' : 'New commission rule', size: 'lg', fields,
      values: r0 ? { ...r0, university_id: String(r0.university_id), agreement_id: r0.agreement_id ? String(r0.agreement_id) : '' } : { scope: 'all', basis: 'gross', due_event: 'enrolled', status: 'Active', show_to_uni: true, valid_from: new Date().toISOString().slice(0, 10), scope_ids: [] },
      save: (v) => POST('/admin/commission/rules', { ...v, id: r0?.id }) });
    if (r) reload();
  };
  return (<>
    <div className="row" style={{ marginBottom: 10 }}><span className="small muted grow">No rate is pre-defined: enter the rates from each partner agreement. The most specific active rule wins (course &gt; campus &gt; level &gt; all).</span><button className="btn sm primary" onClick={() => form(null)}>+ New rule</button></div>
    <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th>Rule</th><th>University</th><th>Scope</th><th>Basis</th><th>Due</th><th>Valid</th><th>Status</th><th /></tr></thead><tbody>
      {d.rows.length ? d.rows.map((r0: Any) => (
        <tr key={r0.id}><td><b>{r0.name}</b><div className="small muted">{r0.rule_code}</div></td><td>{r0.university}</td><td className="small">{r0.scope}{(r0.scope_ids || []).length ? ' (' + r0.scope_ids.length + ')' : ''}</td>
          <td className="small">{r0.basis === 'fixed' ? money(r0.fixed_amount, r0.fixed_currency) + ' fixed' : `${r0.rate}% of ${r0.basis === 'net' ? 'net' : 'gross'} first-year tuition`}</td>
          <td className="small">{r0.due_event === 'days' ? `enrolment + ${r0.due_days} days` : r0.due_event}</td><td className="small">{fmtDate(r0.valid_from)} to {r0.valid_to ? fmtDate(r0.valid_to) : 'open'}</td>
          <td><B s={r0.status} map={{ Active: 'green', Inactive: 'grey' }} /></td><td><button className="btn xs" onClick={() => form(r0)}>Edit</button></td></tr>)) : <tr><td colSpan={8} className="empty">No rules yet</td></tr>}
    </tbody></table></div></div>
  </>);
}
const CR: [string, string][] = [['by_university', 'By university'], ['by_intake', 'By intake'], ['ageing', 'Ageing'], ['forecast', 'Forecast'], ['collections', 'Collections'], ['attention', 'Needs attention'], ['universities', 'University summary']];
function CReports({ q }: { q: Record<string, string> }) {
  const t = q.type || 'by_university';
  const { data: d } = useData(() => GET(`/admin/commission/reports/${t}`), [t]);
  return (<>
    <div className="row" style={{ gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>{CR.map(([k, l]) => <Link key={k} className={`btn sm ${k === t ? 'primary' : ''}`} href={`/admin/university/commission?tab=reports&type=${k}`}>{l}</Link>)}<span className="grow" />
      <button className="btn sm" onClick={() => download(`/admin/commission/reports/${t}?format=xlsx`, `${t}.xlsx`).catch(showError)}>Excel</button><button className="btn sm" onClick={() => download(`/admin/commission/reports/${t}?format=pdf`, `${t}.pdf`).catch(showError)}>PDF</button></div>
    {d ? <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr>{d.columns.map((c: string) => <th key={c}>{c}</th>)}</tr></thead><tbody>
      {d.rows.length ? d.rows.map((r0: unknown[], i: number) => <tr key={i}>{r0.map((c, j) => <td key={j}>{String(c ?? '')}</td>)}</tr>) : <tr><td colSpan={d.columns.length} className="empty">No data</td></tr>}
    </tbody></table></div></div> : <Loading />}
    <p className="small muted">Totals per currency, no conversion.</p>
  </>);
}
const CHECKS = ['uni_portal_enabled', 'uni_always_review_rejections', 'uni_ack_email', 'uni_auto_approve_minor', 'uni_small_numbers', 'uni_officers_edit_contacts'];
function UniSettings() {
  const { data: d } = useData(() => GET('/admin/uni-settings'), []);
  const [v, setV] = useState<Vals | null>(null); const [countries, setCountries] = useState<Any[] | null>(null); const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => { if (d && !v) { setV(Object.fromEntries(Object.entries(d.values as Record<string, string>).map(([k, x]) => [k, CHECKS.includes(k) ? x === '1' : x]))); setCountries(d.countries); } }, [d, v]);
  if (!d || !v || !countries) return <Loading />;
  const yes = (k: string, label: string, col: number): Field => ({ k, label, type: 'checkbox', col });
  const fields: Field[] = [{ type: 'section', k: 's1', label: 'Portal' }, yes('uni_portal_enabled', 'University portal on', 2), { k: 'uni_idle_min', label: 'Idle timeout (15 to 120 min)', type: 'number', col: 2 },
    { k: 'uni_invite_days', label: 'Invite link valid (days)', type: 'number', col: 2 }, { k: 'partner_portal_url', label: 'Partner portal link (https://partners.your-domain)', col: 4 },
    { type: 'section', k: 's2', label: 'Decisions and review' }, yes('uni_always_review_rejections', 'Always review rejections before the student is told', 3), yes('uni_ack_email', 'Email the student when the university acknowledges (E05)', 3),
    { k: 'uni_review_reminder_days', label: 'Remind counsellor after (working days)', type: 'number', col: 2 }, { k: 'uni_review_admin_days', label: 'Notify Admin after (working days)', type: 'number', col: 2 }, { k: 'uni_ack_days', label: 'New application late after (working days)', type: 'number', col: 2 },
    yes('uni_auto_approve_minor', 'Auto-approve minor course changes (description, fee note, link)', 6),
    { type: 'section', k: 's3', label: 'Data protection' }, { k: 'uni_access_months', label: 'University access after final decision (months, 0 = no limit)', type: 'number', col: 3 }, { k: 'uni_download_alert', label: 'Download alert (documents per hour per user)', type: 'number', col: 3 },
    yes('uni_small_numbers', 'Small number protection in reports', 3), { k: 'uni_max_file_mb', label: 'Max university upload (MB, up to 25)', type: 'number', col: 3 }, { k: 'uni_bulk_max_rows', label: 'Bulk upload max rows', type: 'number', col: 2 }, yes('uni_officers_edit_contacts', 'Officers can edit department contacts', 4),
    { type: 'section', k: 's4', label: 'Emails to universities' }, { k: 'uni_sending_address', label: 'Sending address (e.g. partners@your-domain)', col: 3 }, { k: 'uni_display_name', label: 'Sender name', col: 3 }, { k: 'uni_noreply_address', label: 'No-reply Reply-To address', col: 3 },
    { k: 'uni_email_footer', label: 'University email footer', type: 'textarea', col: 6 }, { k: 'uni_agreement_reminders', label: 'Agreement end reminders (days before, comma separated)', col: 3 }, { k: 'uni_invoice_reminders', label: 'Invoice reminders: days before, on due (0), every N days overdue', col: 3 },
    { type: 'section', k: 's5', label: 'Invoices (from Euroverse Service LLP, trading as La Europa Education)' }, { k: 'invoice_prefix', label: 'Invoice prefix', col: 2 }, { k: 'credit_note_prefix', label: 'Credit note prefix', col: 2 },
    { k: 'invoice_tax_ids', label: 'Tax / registration numbers printed on invoices (GSTIN, PAN, LLPIN)', type: 'textarea', col: 6 }, { k: 'invoice_bank_details', label: 'Bank details printed on invoices', type: 'textarea', col: 6 }];
  const save = async () => { setErrs({}); try { await PUT('/admin/uni-settings', { ...v, countries: countries.map((c) => ({ id: c.id, transfers_allowed: c.transfers_allowed })) }); toast('Saved', 'ok'); } catch (e) { if (e instanceof ApiError && e.data.errors) setErrs(e.data.errors); showError(e); } };
  return (
    <div className="card"><div className="bd">
      <form noValidate onSubmit={(e) => e.preventDefault()}><FormGrid fields={fields} vals={v} set={(k, x) => setV((s) => ({ ...s!, [k]: x }))} errors={errs} /></form>
      <h3>Cross-border transfers (India DPDP Act)</h3><p className="small muted">Untick a country to block submissions to universities there if the Government of India restricts transfers.</p>
      <div className="ms">{countries.map((c, i) => <label key={c.id}><input type="checkbox" checked={c.transfers_allowed !== false} onChange={(e) => setCountries(countries.map((x, j) => (j === i ? { ...x, transfers_allowed: e.target.checked } : x)))} />{c.name}</label>)}</div>
      <div className="form-actions"><button className="btn primary" onClick={save}>Save settings</button></div>
      <p className="small muted">Portal Terms of Use and Data Processing terms are versioned in Admin &gt; Legal &amp; privacy &gt; Legal documents.</p>
    </div></div>
  );
}

// =====================================================================================
// S47: the University panel inside each application (counsellor)
// =====================================================================================
const CNS: Record<string, string> = { Given: 'green', Requested: 'orange', 'Not requested': 'grey', Withdrawn: 'red', Declined: 'red' };
const PROC: Record<string, string> = { 'Pending review': 'orange', Held: 'red', Applied: 'green', 'Applied without notifying': 'green', Info: 'grey' };
export function UniBox({ app, studentId, reload }: { app: Any; studentId: string; reload: () => void }) {
  const router = useRouter();
  const { data: d, reload: again } = useData(() => GET(`/applications/${app.id}/university`).catch(() => null), [app.id, app.stage]);
  if (!d || !d.university || d.university.portal_status === 'None') return null;
  const u = d.university; const ua = d.ua;
  const done = () => { again(); reload(); };
  const offline = async () => {
    const r = await formModal({ title: 'Record offline consent', fields: [{ k: 'file', label: 'Signed consent form (PDF / JPG / PNG)', type: 'file', accept: '.pdf,.jpg,.jpeg,.png', col: 6 }, { k: 'reason', label: 'Reason (why offline)', req: true, col: 6 }],
      save: (v) => SEND('post', `/students/${studentId}/uni-consents/offline`, toFormData({ ...v, application_id: app.id })) });
    if (r) done();
  };
  return (
    <div className="uni-box">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><b>🏛 University portal</b><B s={u.portal_status} map={PST} />
        {ua ? <> <B s={ua.status} map={UST} />{ua.flags.docs_requested ? <> <span className="badge orange">Documents requested by university</span></> : null}{ua.flags.waitlisted ? <> <span className="badge grey">Waitlisted</span></> : null}</> : null}
        <span className="small muted">Sharing consent: <B s={d.consent.status} map={CNS} /></span>{!d.agreement ? <span className="badge red">No active agreement</span> : null}<span className="grow" />
        {!ua && u.portal_status === 'Active' ? <>
          {d.consent.status !== 'Given' ? <><button className="btn xs" onClick={async () => { try { await POST(`/students/${studentId}/uni-consents/request`, { application_id: app.id }); toast('Consent requested (E49 email + student portal)', 'ok'); done(); } catch (e) { showError(e); } }}>Request consent</button>
            <button className="btn xs" onClick={offline}>Record offline consent</button></> : null}
          <button className="btn xs primary" disabled={!d.can_submit} title={d.can_submit ? '' : 'Needs: active portal, active agreement and student consent'} onClick={() => submitPopup(app, d, done)}>Submit to university portal</button></> : null}
        {ua ? <><button className="btn xs" onClick={() => router.push(`/university-messages?t=${ua.id}`)}>Messages{d.unread ? ` (${d.unread})` : ''}</button><button className="btn xs" onClick={() => openOverlay((close) => <DetailPopup app={app} d={d} close={close} done={done} />)}>Details</button></> : null}
      </div>
      {ua ? <>
        <div className="small muted" style={{ marginTop: 4 }}>Submitted {fmtDate(ua.submitted_at)}{ua.university_ref ? ' · university ref ' + ua.university_ref : ''} · {d.shares.filter((s: Any) => !['Revoked', 'Expired'].includes(s.status)).length} document(s) shared · downloaded {d.downloads.count} time(s){d.downloads.last ? ', last by ' + d.downloads.last : ''}</div>
        {d.actions.filter((a: Any) => ['Pending review', 'Held'].includes(a.processing)).map((a: Any) => <div key={a.id} className="uni-pending">{a.label} from {a.by || 'university'} · {ago(a.created_at)} <B s={a.processing} map={PROC} /> <Link href={`/university-updates?open=${a.id}`}>Review</Link></div>)}
        {d.requests.filter((q0: Any) => ['Open', 'Partly fulfilled'].includes(q0.status)).map((q0: Any) => <div key={q0.id} className="uni-pending">📄 University requested: {q0.items.filter((i: Any) => i.status === 'Open').map((i: Any) => i.name).join(', ')} <button className="btn xs" onClick={() => openOverlay((close) => <AnswerPopup app={app} d={d} q0={q0} close={close} done={done} />)}>Share documents and send</button></div>)}
      </> : null}
    </div>
  );
}
async function submitPopup(app: Any, d: Any, done: () => void) {
  let pv: Any; try { pv = await GET(`/applications/${app.id}/university/preview`); } catch (e) { showError(e); return; }
  openOverlay((close) => <SubmitPopup app={app} d={d} pv={pv} close={close} done={done} />);
}
function SubmitPopup({ app, d, pv, close, done }: { app: Any; d: Any; pv: Any; close: () => void; done: () => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set(d.shareable.filter((x: Any) => x.in_checklist).map((x: Any) => x.version_id)));
  const [note, setNote] = useState(''); const [notify, setNotify] = useState(true); const [busy, setBusy] = useState(false);
  const submit = async () => {
    const body = { version_ids: [...sel], cover_note: note, notify };
    setBusy(true);
    try { await POST(`/applications/${app.id}/university/submit`, body); close(); toast('Submitted to the university portal (E31 sent)', 'ok'); done(); }
    catch (e) {
      if (e instanceof ApiError && e.data.needs_override) {
        const reason = await confirmBox(e.message, { ok: 'Submit anyway', reason: true, reasonLabel: 'Override reason' });
        if (typeof reason === 'string') { try { await POST(`/applications/${app.id}/university/submit`, { ...body, override_reason: reason }); close(); done(); } catch (er) { showError(er); } }
      } else showError(e);
    } finally { setBusy(false); }
  };
  const i = pv.identity || {};
  return (
    <Modal title={`Submit to ${d.university.name} partner portal`} size="xl" close={close} foot={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={busy} onClick={submit}>Submit</button></>}>
      <div className="grid two">
        <div><h3 style={{ marginTop: 0 }}>Documents to share</h3><p className="small muted">Only Verified documents can be shared. Visa, finance and La Europa invoice documents are never shareable.</p>
          {d.shareable.length ? d.shareable.map((x: Any) => <label key={x.version_id} className="row" style={{ gap: 6, padding: '3px 0' }}><input type="checkbox" checked={sel.has(x.version_id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(x.version_id); else n.delete(x.version_id); return n; })} /> {x.name}{x.in_checklist ? null : <> <span className="small muted">(not in checklist)</span></>}</label>)
            : <div className="empty small">No verified documents yet</div>}
          <div className="f" style={{ marginTop: 10 }}><label>Cover note to university (max 1000)</label><textarea className="input" rows={4} maxLength={1000} style={{ height: 'auto', padding: 8 }} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <label className="row small" style={{ gap: 6, marginTop: 6 }}><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email the student that the application is submitted (E05)</label></div>
        <div><h3 style={{ marginTop: 0 }}>What the university will see</h3>
          <div className="preview-box small"><b>{pv.student_name}</b> · {pv.course} ({pv.level}) · {pv.intake}<br />
            {i.gender || ''}, born {fmtDate(i.dob)}, {i.nationality || ''} · passport {i.passport || '-'} ({i.passport_masked ? 'masked' : 'full'}) · {[i.city, i.state].filter(Boolean).join(', ')}<br />
            <div style={{ margin: '6px 0' }}>{pv.summary_line}</div>Academic rows: {pv.academic.length} · English tests: {pv.english.length} · Work: {pv.work_total || 'none'}<br />
            Contact details: {pv.contact ? 'SHARED (Admin setting)' : 'not shared'}{pv.visa_outcome !== undefined ? ' · visa outcome shared' : ''}<br />La Europa contact: {pv.la_europa_contacts.map((c: Any) => c.name).join(', ')}</div>
          <p className="small muted">Never shared: internal notes, other universities, budget and finances, family details, marital status, sub-agent / lead source, La Europa fees.</p></div>
      </div>
    </Modal>
  );
}
function AnswerPopup({ app, d, q0, close, done }: { app: Any; d: Any; q0: Any; close: () => void; done: () => void }) {
  const open = q0.items.filter((i: Any) => i.status === 'Open');
  const [rows, setRows] = useState<Record<string, { version_id: string; not_available: boolean; reply: string }>>(Object.fromEntries(open.map((i: Any) => [i.id, { version_id: '', not_available: false, reply: '' }])));
  const upd = (id: string, k: string, x: unknown) => setRows((s) => ({ ...s, [id]: { ...s[id], [k]: x } }));
  const send = async () => {
    const items = Object.entries(rows).map(([item_id, r]) => ({ item_id, version_id: r.version_id || null, not_available: r.not_available, reply: r.reply })).filter((i) => i.version_id || i.not_available);
    try { const r = await POST(`/applications/${app.id}/university/requests/${q0.id}/answer`, { items }); close(); toast(`Sent to the university (${r.status})`, 'ok'); done(); } catch (e) { showError(e); }
  };
  return (
    <Modal title="Answer document request" size="lg" close={close} foot={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={send}>Send to university</button></>}>
      <div className="small" style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}>{q0.message}</div>
      {open.map((i: Any) => (
        <div key={i.id} className="req"><b>{i.name}</b>{i.note ? <> <span className="small muted">({i.note})</span></> : null}
          <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <select className="input" style={{ width: 'auto' }} value={rows[i.id].version_id} onChange={(e) => upd(i.id, 'version_id', e.target.value)}><option value="">Choose a verified document...</option><Options list={d.shareable.map((x: Any) => [x.version_id, x.name])} /></select>
            <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={rows[i.id].not_available} onChange={(e) => upd(i.id, 'not_available', e.target.checked)} /> Not available</label>
            <input className="input grow" placeholder="Message (required if not available)" value={rows[i.id].reply} onChange={(e) => upd(i.id, 'reply', e.target.value)} /></div></div>))}
      <p className="small muted">Need it from the student? Use &quot;Request document&quot; on the Documents tab (E11), then share it here once verified.</p>
    </Modal>
  );
}
function DetailPopup({ app, d, close, done }: { app: Any; d: Any; close: () => void; done: () => void }) {
  const ua = d.ua;
  const fin = () => { close(); done(); };
  const run = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); if (msg) toast(msg, 'ok'); fin(); } catch (e) { showError(e); } };
  const withdraw = async (declined: boolean) => {
    const r = await formModal({ title: declined ? 'Offer declined by student' : 'Withdraw from university',
      fields: declined ? [{ k: 'reason_internal', label: 'Internal note', col: 6 }] : [{ k: 'reason_university', label: 'Reason for the university (sent in E40)', req: true, col: 6 }, { k: 'reason_internal', label: 'Internal reason', req: true, col: 6 }],
      save: (v) => POST(`/applications/${app.id}/university/withdraw`, { ...v, declined }) });
    if (r) fin();
  };
  const shareMore = () => openOverlay((c2) => <ShareMore app={app} d={d} close={c2} done={fin} />);
  return (
    <Modal title={`${d.university.name}: ${app.application_code}`} size="xl" close={close}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}><B s={ua.status} map={UST} /><span className="grow" />
        {['Conditional offer', 'Unconditional offer'].includes(ua.status) ? <>
          <button className="btn sm primary" onClick={async () => { if (await confirmBox('Confirm to the university that the student accepts the offer? The student gets E05, the university gets E34.', { ok: 'Confirm acceptance' })) run(() => POST(`/applications/${app.id}/university/confirm-acceptance`), 'Acceptance confirmed'); }}>Confirm acceptance to university</button>
          <button className="btn sm" onClick={() => withdraw(true)}>Offer declined by student</button></> : null}
        {!['Withdrawn', 'Enrolled'].includes(ua.status) ? <button className="btn sm danger" onClick={() => withdraw(false)}>Withdraw from university</button> : null}
        <button className="btn sm" onClick={shareMore}>Share more documents</button></div>
      <div className="grid two">
        <div className="card"><div className="hd"><h2>University actions</h2></div><div className="table-wrap"><table className="tbl"><tbody>
          {d.actions.length ? d.actions.map((a: Any) => <tr key={a.id}><td className="small nowrap">{fmtDT(a.created_at)}</td><td><b>{a.label || a.type}</b><div className="small muted">{a.by || ''}</div></td><td>{a.processing}{a.held_note ? <div className="small">{a.held_note}</div> : null}</td></tr>) : <tr><td className="empty">None</td></tr>}</tbody></table></div></div>
        <div className="card"><div className="hd"><h2>Document shares</h2></div><div className="table-wrap"><table className="tbl"><tbody>
          {d.shares.length ? d.shares.map((s: Any) => (
            <tr key={s.id}><td>{s.name} v{s.version_no}{s.newer ? <> <span className="badge orange">New version not shared yet</span></> : null}</td><td>{s.status}{s.viewed_at ? <div className="small muted">Viewed {fmtDT(s.viewed_at)}</div> : null}</td>
              <td>{!['Revoked', 'Expired'].includes(s.status) ? <button className="btn xs" onClick={async () => { const reason = await confirmBox('Revoke access? The university loses access immediately.', { danger: true, ok: 'Revoke', reason: true }); if (typeof reason === 'string') run(() => POST(`/university-shares/${s.id}/revoke`, { reason })); }}>Revoke</button> : null}
                {s.newer ? <> <button className="btn xs primary" onClick={() => { const x = d.shareable.find((y: Any) => y.document_id === s.document_id); if (!x) { toast('The new version must be Verified first', 'err'); return; } run(() => POST(`/applications/${app.id}/university/share`, { version_ids: [x.version_id] })); }}>Share new version</button></> : null}</td></tr>))
            : <tr><td className="empty">None</td></tr>}</tbody></table></div></div>
      </div>
      <div className="card" style={{ marginTop: 12 }}><div className="hd"><h2>Uploaded by the university</h2></div><div className="table-wrap"><table className="tbl"><tbody>
        {d.uploads.length ? d.uploads.map((x: Any) => (
          <tr key={x.version_id}><td><b>{x.name}</b> v{x.version_no}<div className="small muted">{x.by || ''} · {fmtDT(x.uploaded_at)}{x.note_for_counsellor ? ' · ' + x.note_for_counsellor : ''}</div></td><td>{x.status}</td>
            <td className="nowrap">{x.url ? <button className="btn xs" onClick={() => window.open(x.url, '_blank', 'noopener')}>View</button> : null}{' '}
              {x.status === 'Uploaded' ? <><button className="btn xs primary" onClick={() => run(() => POST(`/documents/${x.document_id}/verify`, { notify: false }), 'Accepted (university informed)')}>Verify</button>{' '}
                <button className="btn xs" onClick={async () => { const text = await confirmBox('Return this document to the university? Give the reason (e.g. wrong student name, wrong intake).', { reason: true, ok: 'Return' }); if (typeof text === 'string') run(() => POST(`/documents/${x.document_id}/reject`, { reason: 'Other', text })); }}>Return</button></> : null}</td></tr>))
          : <tr><td className="empty">Nothing uploaded</td></tr>}</tbody></table></div>
        <div className="bd small muted">Verifying or returning a university upload never emails the student. Share it with the student from the Documents tab when ready.</div></div>
    </Modal>
  );
}
function ShareMore({ app, d, close, done }: { app: Any; d: Any; close: () => void; done: () => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  return (
    <Modal title="Share documents" close={close} foot={<button className="btn primary" onClick={async () => { try { const r = await POST(`/applications/${app.id}/university/share`, { version_ids: [...sel] }); toast(`${r.shared} shared`, 'ok'); close(); done(); } catch (e) { showError(e); } }}>Share</button>}>
      {d.shareable.length ? d.shareable.map((x: Any) => <label key={x.version_id} className="row" style={{ gap: 6, padding: '3px 0' }}><input type="checkbox" checked={sel.has(x.version_id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(x.version_id); else n.delete(x.version_id); return n; })} /> {x.name}</label>) : 'No verified documents'}
    </Modal>
  );
}
/** copy for La Europa of what the university sent directly to the student */
export function UniStudentBox({ appId }: { appId: string }) {
  const { data: r } = useData(() => GET(`/applications/${appId}/university-student`).catch(() => ({ rows: [] })), [appId]);
  if (!r?.rows?.length) return null;
  const ic: Record<string, string> = { offer_letter: '🎓', loa: '🛂', invoice: '🧾', receipt: '✅', agreement: '✍', document: '📄', message: '💬' };
  return (
    <details style={{ marginTop: 10 }}><summary className="small"><b>University ↔ student (direct)</b> · {r.rows.length} item(s) · copy for La Europa</summary>
      <div className="small" style={{ marginTop: 6 }}>{r.rows.map((x: Any) => (
        <div key={x.id} style={{ padding: '4px 0', borderBottom: '1px dashed var(--line)' }}>{ic[x.kind] || ''} <b>{x.kind_label}{x.title ? ': ' + x.title : ''}</b> · {x.mine ? 'from university' : 'from student'} ({x.sender}) · {fmtDT(x.created_at)}
          {x.body ? <div style={{ whiteSpace: 'pre-wrap' }}>{x.body}</div> : null}{x.amount != null ? ` · ${money(x.amount, x.currency)}${x.due_date ? ' due ' + fmtDate(x.due_date) : ''}` : ''}
          {x.needs_acceptance ? (x.accepted_at ? <> · <span style={{ color: 'var(--success-ink)' }}>accepted by the student</span></> : <> · <span style={{ color: 'var(--warning-ink)' }}>waiting for the student</span></>) : null}
          {x.file_url ? <> · <a href={x.file_url} target="_blank" rel="noopener noreferrer">PDF</a></> : null}</div>))}</div>
    </details>
  );
}

// =====================================================================================
// S45 University updates queue
// =====================================================================================
export function UpdatesPage({ q }: { q: Record<string, string> }) {
  const st = q.status || '';
  const { data: d, reload } = useData(() => GET('/university-updates' + qs({ status: st, counsellor: q.counsellor })), [st, q.counsellor]);
  const opened = useRef<string | null>(null);
  useEffect(() => { if (q.open && opened.current !== q.open) { opened.current = q.open; openUpdate(q.open, reload); } }, [q.open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (<>
    <div className="page-head"><h1>University updates</h1><span className="muted small">Decisions from university partner portals waiting for you</span><span className="grow" />
      <div className="seg-tabs">{[['', 'To review'], ['held', 'Held'], ['done', 'Applied']].map(([k, l]) => <Link key={k} href={'/university-updates' + qs({ status: k })} className={st === k ? 'on' : ''}>{l}</Link>)}</div></div>
    {d ? <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th>Received</th><th>University</th><th>Student</th><th>Decision</th><th>Waiting</th><th>Status</th><th /></tr></thead><tbody>
      {d.rows.length ? d.rows.map((x: Any) => (
        <tr key={x.id}><td className="small">{fmtDT(x.created_at)}</td><td>{x.university}</td><td><Link href={`/students/${x.student_id}/applications`}>{x.student}</Link><div className="small muted">{x.application_code} · {x.course} ({x.intake})</div></td>
          <td><b>{x.label}</b>{x.forced ? <> <span className="badge red">Review required</span></> : null}</td><td className={x.waiting_hours > 24 ? 'text-red' : ''}>{x.waiting_hours} h</td><td>{x.processing}</td>
          <td><button className="btn xs primary" onClick={() => openUpdate(x.id, reload)}>Open</button></td></tr>)) : <tr><td colSpan={7} className="empty">Nothing waiting</td></tr>}
    </tbody></table></div></div> : <Loading />}
  </>);
}
async function openUpdate(id: string, done: () => void) {
  let x: Any; try { x = await GET('/university-updates/' + id); } catch (e) { showError(e); return; }
  openOverlay((close) => <UpdateBody x={x} id={id} close={close} done={done} />);
}
function UpdateBody({ x, id, close, done }: { x: Any; id: string; close: () => void; done: () => void }) {
  const d = x.data || {}; const pend = ['Pending review', 'Held'].includes(x.processing);
  const [msg, setMsg] = useState(''); const [incl, setIncl] = useState(false);
  const facts = Object.entries(d).filter(([k, v]) => v !== null && v !== undefined && v !== '' && !['letter', 'document_id', 'version'].includes(k));
  const apply = async (notify: boolean) => {
    if (!notify && !(await confirmBox('Apply this decision without telling the student? This is logged.', { ok: 'Apply without notifying' }))) return;
    try { await POST(`/university-updates/${id}/apply`, { notify, confirm_silent: !notify, message: msg, include_reason: incl }); close(); toast('Applied', 'ok'); done(); } catch (e) { showError(e); }
  };
  const hold = async () => { const note = await confirmBox('Hold this update (for example "call the student first")', { reason: true, ok: 'Hold', reasonLabel: 'Note' }); if (typeof note === 'string') { try { await POST(`/university-updates/${id}/hold`, { note }); close(); done(); } catch (e) { showError(e); } } };
  return (
    <Modal title={`${x.university}: ${x.label}`} size="xl" close={close} foot={pend ? <><button className="btn" onClick={hold}>Hold</button><button className="btn" onClick={() => apply(false)}>Apply without notifying</button><button className="btn primary" onClick={() => apply(true)}>Apply and notify student</button></> : <button className="btn" onClick={close}>Close</button>}>
      <p className="small muted">{x.student} · {x.application_code} · received {fmtDT(x.created_at)} · university status {x.from_status || ''} → <b>{x.to_status || 'no change'}</b> · CRM stage now {x.current_stage}{x.target_stage && x.target_stage !== x.current_stage ? <> → <b>{x.target_stage}</b></> : null}</p>
      {x.held_note ? <div className="pv-warn">Held: {x.held_note}</div> : null}
      <div className="kv">{facts.length ? facts.map(([k, v]) => <div key={k}><div className="k">{k.replace(/_/g, ' ')}</div><div className="v">{Array.isArray(v) ? v.map((c: Any) => (c?.text ? `${c.text}${c.due ? ' (by ' + c.due + ')' : ''}` : JSON.stringify(c))).join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}</div></div>) : <div className="muted">No extra data</div>}</div>
      {x.letters.length ? <p>Offer letters: {x.letters.map((l: Any, i: number) => <span key={i}>{i ? ', ' : ''}<a href={l.url || '#'} target="_blank" rel="noopener noreferrer">{l.type} ({fmtDate(l.issue_date)})</a></span>)}</p> : null}
      {x.student_payment_proofs.length && x.type === 'deposit' ? <p className="small">Student payment proofs: {x.student_payment_proofs.map((p: Any) => `${money(p.amount, p.currency)} on ${fmtDate(p.payment_date)} (${p.status})`).join(', ')}. Record the payment from the Fees tab (&quot;Record payment from university confirmation&quot;).</p> : null}
      {x.email ? <>
        <h3>Student email preview ({x.email.code})</h3><div className="small muted">To {x.email.to || ''} · CC {String(x.email.cc ?? '')} · {x.email.subject}</div>
        <iframe className="email-frame" sandbox="" title="Email preview" srcDoc={x.email.html} style={{ width: '100%', height: 300, border: '1px solid var(--line)', borderRadius: 8 }} />
        {pend ? <><div className="f" style={{ marginTop: 8 }}><label>Personal line for the student (optional)</label><input className="input" maxLength={500} value={msg} onChange={(e) => setMsg(e.target.value)} /></div>
          {x.type === 'reject' && d.share_reason ? <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={incl} onChange={(e) => setIncl(e.target.checked)} /> Include the university reason in the email</label> : null}</> : null}
      </> : <p className="small muted">This decision does not email the student.</p>}
    </Modal>
  );
}

// =====================================================================================
// S48 University messages
// =====================================================================================
export function MessagesPage({ q }: { q: Record<string, string> }) {
  const router = useRouter();
  const { data: d } = useData(() => GET('/university-messages'), []);
  if (!d) return <Loading />;
  const key = q.t || d.rows[0]?.key;
  return (<>
    <div className="page-head"><h1>University messages</h1><span className="muted small">Threads with partner universities. Separate from student chat and internal notes; students never see them.</span>
      {d.universities.length ? <><span className="grow" /><select className="input" style={{ width: 'auto' }} value="" onChange={(e) => { if (e.target.value) router.push('/university-messages?t=general:' + e.target.value); }}><option value="">Open a General thread...</option><Options list={d.universities} /></select></> : null}</div>
    <div className="grid" style={{ gridTemplateColumns: '300px minmax(0,1fr)', gap: 14, alignItems: 'start' }}>
      <div className="card"><div className="bd flush">{d.rows.length ? d.rows.map((t: Any) => (
        <Link key={t.key} className={`thr ${t.key === key ? 'on' : ''}`} href={`/university-messages?t=${encodeURIComponent(t.key)}`}>
          <div className="row between"><b className="small">{t.title}</b>{t.unread ? <span className="badge blue">{t.unread}</span> : null}</div><div className="small muted">{t.university} · {t.sub}</div><div className="small">{t.last_text}</div>
        </Link>)) : <div className="empty">No threads yet</div>}</div></div>
      <div>{key ? <Thread k={key} /> : null}</div>
    </div>
  </>);
}
function Thread({ k }: { k: string }) {
  const { data: d, reload } = useData(() => GET('/university-messages/' + encodeURIComponent(k)), [k]);
  const [body, setBody] = useState(''); const [files, setFiles] = useState<File[]>([]);
  const box = useRef<HTMLDivElement>(null); const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [d]);
  if (!d) return <Loading />;
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const go = async (confirm: boolean) => { const fd = new FormData(); if (body) fd.append('body', body); files.forEach((f) => fd.append('files', f)); if (confirm) fd.append('confirm_contact', 'true'); return SEND('post', '/university-messages/' + encodeURIComponent(k), fd); };
    const sent = () => { setBody(''); setFiles([]); if (fileRef.current) fileRef.current.value = ''; reload(); };
    try { await go(false); sent(); }
    catch (er) {
      if (er instanceof ApiError && er.data.needs_confirm === 'contact') { if (await confirmBox(er.message, { ok: 'Send anyway' })) { try { await go(true); sent(); } catch (e2) { showError(e2); } } }
      else showError(er);
    }
  };
  return (
    <div className="card"><div className="hd"><h2>{d.university}</h2>{d.share_contact ? null : <span className="small muted">Student contact details are not shared with this university</span>}</div><div className="bd">
      <div className="uthread" ref={box}>{d.rows.length ? d.rows.map((m: Any) => (
        <div key={m.id} className={`umsg ${m.side === 'La Europa' ? 'me' : 'le'}`}><div className="who">{m.side} · {m.sender || ''}</div>
          <div className="bub">{m.deleted ? <i>message deleted</i> : String(m.body || '').split('\n').map((l, i) => <span key={i}>{i ? <br /> : null}{l}</span>)}
            {m.attachments.map((a: Any) => <div key={a.id}><a href="#" onClick={(e) => { e.preventDefault(); openFile(`/university-messages/attachment/${a.id}`); }}>📎 {a.original_name}</a>
              {!a.saved_document_id && /\.(pdf|jpe?g|png)$/i.test(a.original_name) && !k.startsWith('general') ? <> <a href="#" className="small" onClick={async (e) => { e.preventDefault(); try { await POST(`/university-messages/attachment/${a.id}/save`); toast('Saved to student documents', 'ok'); reload(); } catch (er) { showError(er); } }}>save to student documents</a></> : null}</div>)}</div>
          <div className="when">{fmtDT(m.sent_at)}{m.side === 'La Europa' && m.seen ? ' · seen by university' : ''}{m.can_edit ? <> · <a href="#" onClick={async (e) => { e.preventDefault(); try { await PUT('/university-messages/m/' + m.id, { delete: true }); reload(); } catch (er) { showError(er); } }}>delete</a></> : null}</div></div>))
        : <div className="empty">No messages yet</div>}</div>
      {d.closed ? <p className="small muted">Application withdrawn: thread closed.</p> : (
        <form onSubmit={send}><textarea className="input" rows={2} maxLength={5000} style={{ height: 'auto', padding: 8 }} placeholder="Write to the university..." value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="row" style={{ gap: 8, marginTop: 6 }}><input ref={fileRef} type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /><span className="grow" /><button className="btn primary">Send</button></div></form>)}
    </div></div>
  );
}

// C17 dashboard: University updates card and University news
export function DashStrip() {
  const { data } = useData(async () => { try { const [c, news] = await Promise.all([GET('/university-counts'), GET('/university-news')]); return { c, news }; } catch { return null; } }, []);
  if (!data) return null;
  const { c, news } = data;
  if (!c.total && !c.approvals && !news.length) return null;
  return (
    <div className="uni-strip"><div className="card">
      <div className="hd"><h2>🏛 University updates</h2><span className="grow" /><Link className="btn sm" href="/university-updates">Open queue</Link></div>
      <div className="bd row" style={{ gap: 18, flexWrap: 'wrap' }}>
        <Link href="/university-updates"><b className="big">{c.pending}</b> decisions to review</Link><Link href="/applications"><b className="big">{c.requests}</b> document requests</Link>
        <Link href="/university-messages"><b className="big">{c.messages}</b> unread messages</Link>{c.approvals ? <Link href="/admin/university/approvals"><b className="big">{c.approvals}</b> catalogue approvals</Link> : null}</div>
      {news.length ? <><div className="hd"><h2>University news</h2></div><div className="bd">{news.slice(0, 4).map((n: Any) => <div key={n.id} className="small" style={{ marginBottom: 6 }}>{n.important ? <><span className="badge red">Important</span> </> : null}<b>{n.university}:</b> {n.title} <span className="muted">({n.type}, {fmtDate(n.published_at)})</span></div>)}</div></> : null}
    </div></div>
  );
}
