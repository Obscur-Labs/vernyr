'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { GET, POST, PUT, ApiError, download } from './api';
import { M, useMeta } from './meta';
import { fmtDT, money, qs } from './format';
import { FormGrid, Options, formModal, visibleValues, type Field, type Vals } from './form';
import { ListView } from './ListView';
import { Modal, confirmBox, openOverlay, showError, toast } from './ui';
import { StatusBadge } from './badges';
import { LEVELS } from './work/shortlist';

/** The client's Admin Settings (legacy/public/js/pages/admin.js): users, masters, email templates, settings, audit log, reports. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const reloadMeta = () => useMeta.getState().load();
export const MASTERS: [string, string][] = [['countries', 'Countries'], ['universities', 'Universities'], ['courses', 'Courses'], ['intakes', 'Intakes'], ['app_stage', 'Application stages'], ['visa_stage', 'Visa stages'],
  ['lead_source', 'Lead sources'], ['sub_agent', 'Sub-agents'], ['document_type', 'Document types'], ['checklists', 'Document checklists'], ['not_interested_reason', 'Not interested reasons'],
  ['doc_rejection_reason', 'Document rejection reasons'], ['service_package', 'Service packages'], ['payment_mode', 'Payment modes'], ['currency', 'Currencies'], ['board', 'Boards'],
  ['test_type', 'Test types'], ['app_channel', 'Application channels'], ['visa_type', 'Visa types'], ['indian_state', 'Indian states'], ['field_of_study', 'Fields of study']];

// ---------- users ----------
function LoginDetails({ title, v, close }: { title: string; v: { username: string; password: string }; close: () => void }) {
  return <Modal title={title} close={close}>
    <p>Give these login details to the staff member:</p>
    <p>Login page: <b>{typeof window !== 'undefined' ? window.location.origin : ''}</b><br />Username: <b className="mono">{v.username}</b><br />Password: <b className="mono">{v.password}</b></p>
    <p className="small muted">The password is shown only now.</p>
  </Modal>;
}
export function Users() {
  const me = useMeta((s) => s.me);
  const [d, setD] = useState<{ rows: Any[]; roles: Any[] } | null>(null);
  const load = useCallback(async () => { try { const [rows, roles] = await Promise.all([GET('/admin/users'), GET('/admin/roles')]); setD({ rows, roles }); } catch (e) { showError(e); } }, []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="empty">Loading...</div>;
  const { rows, roles } = d;
  const base: Field[] = [{ k: 'name', label: 'Full name', req: true, col: 3 }, { k: 'username', label: 'Username (login)', req: true, col: 3, help: 'Small letters, numbers, dot, dash, underscore. Example: neha.patel' },
    { k: 'mobile', label: 'Mobile', type: 'tel', req: true, col: 2 }, { k: 'role', label: 'Role', type: 'select', req: true, noBlank: true, opts: roles.map((r) => [r.code, r.name] as [string, string]), col: 2 }, { k: 'designation', label: 'Designation', col: 2 },
    { k: 'reports_to', label: 'Reports to', type: 'select', opts: rows.map((u) => [u.id, u.name] as [string, string]), col: 3 }, { k: 'email', label: 'Email (optional, not used to log in)', type: 'email', col: 3 }];
  const pwField: Field = { k: 'password', label: 'Password (min 12, a letter and a number)', type: 'text', req: true, col: 3, help: 'Give this password to the staff member. They can change it in My profile.' };
  const shown = (title: string, v: { username: string; password: string }) => openOverlay((close) => <LoginDetails title={title} v={v} close={close} />);
  const act = (fn: () => Promise<unknown>) => async () => { try { await fn(); } catch (e) { showError(e); } };
  const add = act(async () => {
    let pw = '';
    const r = await formModal<Any>({ title: 'Add user', size: 'lg', fields: [...base, pwField], values: { role: 'counsellor' }, save: (v) => { pw = v.password; return POST('/admin/users', v); } });
    if (r) { await reloadMeta(); shown('User created', { username: r.username, password: pw }); load(); }
  });
  const edit = (u: Any) => act(async () => { if (await formModal({ title: 'Edit user', size: 'lg', fields: base, values: u, save: (v) => PUT(`/admin/users/${u.id}`, v) })) { await reloadMeta(); load(); } });
  const reset = (u: Any) => act(async () => {
    let pw = '';
    const r = await formModal({ title: `Set a new password: ${u.name}`, fields: [pwField], values: {}, saveLabel: 'Set password', intro: <p className="small muted" style={{ marginTop: 0 }}>The user is logged out everywhere and logs in again with the new password.</p>, save: (v) => { pw = v.password; return POST(`/admin/users/${u.id}/reset-password`, v); } });
    if (r) shown('Password changed', { username: u.username, password: pw });
  });
  const deactivate = (u: Any) => act(async () => {
    const w = await GET(`/admin/users/${u.id}/workload`);
    const others = M.users().filter((x) => x.id !== u.id);
    const pick = (k: string, label: string, roleFilter?: string[]): Field[] => (w[k] ? [{ k: 'to_' + k, label: `${label} (${w[k]})`, type: 'select', req: true, opts: others.filter((x) => !roleFilter || roleFilter.includes(x.role)).map((x) => [x.id, `${x.name} (${x.role})`] as [string, string]), col: 3 }] : []);
    const f: Field[] = [...pick('primary', 'Students go to counsellor', ['counsellor', 'manager', 'admin']), ...pick('leads', 'Open leads go to', ['counsellor', 'admin']), ...pick('tasks', 'Open tasks go to'), { k: 'reason', label: 'Reason', col: 6 }];
    const r = await formModal({ title: `Deactivate ${u.name}`, size: 'lg', fields: f, values: {}, saveLabel: 'Transfer and deactivate', save: (v) => POST(`/admin/users/${u.id}/deactivate`, v),
      intro: <p style={{ marginTop: 0 }}>{u.name} will not be able to log in. All students, leads and open tasks must be transferred first. Data is never deleted.</p> });
    if (r) { toast('User deactivated and work transferred', 'ok'); await reloadMeta(); load(); }
  });
  return (
    <div className="card">
      <div className="hd"><h2>Users</h2><span className="muted small">No public sign-up. You create the username and password and give them to the staff member. Staff log in with the username; only the Super Admin logs in with email.</span><span className="grow" /><button className="btn primary" onClick={add}>+ Add user</button></div>
      <div className="bd flush"><div className="table-wrap"><table className="t cards">
        <thead><tr><th>Name</th><th>Staff ID</th><th>Username (login)</th><th>Role</th><th>Mobile</th><th>Status</th><th>Workload</th><th>Last login</th><th /></tr></thead>
        <tbody>{rows.map((u) => (
          <tr key={u.id}>
            <td data-label="Name"><b>{u.name}</b><div className="small muted">{u.designation || ''}{u.reports_to_name ? ' · reports to ' + u.reports_to_name : ''}</div></td>
            <td data-label="Staff ID"><span className="badge blue mono">{u.staff_code || '-'}</span></td>
            <td data-label="Username"><span className="mono">{u.username || ''}</span>{u.is_super_admin ? <div className="small muted">Super Admin logs in with {u.email}</div> : u.email ? <div className="small muted">{u.email}</div> : null}</td>
            <td data-label="Role"><span className="badge blue">{u.role_name}</span></td><td data-label="Mobile">{u.mobile}</td>
            <td data-label="Status">{u.status === 'active' ? <span className="badge green">Active</span> : <span className="badge grey">Inactive</span>}{u.locked ? <> <span className="badge red">Locked</span></> : null}</td>
            <td data-label="Workload" className="small">{u.students} students · {u.leads} leads · {u.open_tasks} tasks</td>
            <td data-label="Last login" className="small">{u.last_login_at ? fmtDT(u.last_login_at) : 'Never'}</td>
            <td className="nowrap">
              <button className="btn xs" onClick={edit(u)}>Edit</button> <button className="btn xs" onClick={reset(u)}>Set password</button>{' '}
              <button className="btn xs" onClick={act(async () => { if (await confirmBox('End all sessions of this user?')) { await POST(`/admin/users/${u.id}/force-logout`); toast('User logged out everywhere', 'ok'); } })}>Force logout</button>
              {u.locked ? <> <button className="btn xs" onClick={act(async () => { await POST(`/admin/users/${u.id}/unlock`); toast('Unlocked', 'ok'); load(); })}>Unlock</button></> : null}{' '}
              {u.status === 'active' ? (u.id !== me?.id ? <button className="btn xs danger" onClick={deactivate(u)}>Deactivate</button> : null) : <button className="btn xs" onClick={act(async () => { await POST(`/admin/users/${u.id}/activate`); await reloadMeta(); load(); })}>Activate</button>}
            </td>
          </tr>
        ))}</tbody>
      </table></div></div>
    </div>
  );
}

// ---------- masters (never deleted: set Inactive) ----------
type Col = [string, string, ((r: Any) => React.ReactNode)?];
const dot = (r: Any) => <><span className="dot" style={{ background: r.color }} /> {r.color}</>;
function colsFor(sub: string): Col[] {
  const pending = (r: Any) => (r.approved ? 'Yes' : <span className="badge orange">Pending approval</span>);
  const C: Record<string, Col[]> = {
    countries: [['name', 'Name'], ['code', 'Code'], ['dependant_visa', 'Dependant visa allowed'], ['currency', 'Currency'], ['aps_required', 'APS', (r) => (r.aps_required ? 'Yes' : 'No')]],
    universities: [['name', 'Name'], ['country', 'Country'], ['city', 'City'], ['type', 'Type'], ['approved', 'Approved', pending]],
    courses: [['name', 'Course'], ['university', 'University'], ['level', 'Level'], ['tuition_fee', 'Tuition', (r) => money(r.tuition_fee, r.currency)], ['min_english', 'Min IELTS'], ['approved', 'Approved', pending]],
    intakes: [['name', 'Name'], ['month', 'Month'], ['year', 'Year']],
    checklists: [['country', 'Country'], ['level', 'Level', (r) => r.level || 'All levels'], ['document_type', 'Document type'], ['required', 'Required'], ['sort', 'Order']],
    app_stage: [['sort', 'Order'], ['name', 'Name'], ['code', 'Code'], ['trigger', 'Email trigger'], ['color', 'Colour', dot], ['in_use', 'In use']],
  };
  C.visa_stage = C.app_stage;
  return C[sub] ?? [['name', 'Name'], ...(sub === 'sub_agent' ? [['contact', 'Contact'], ['city', 'City']] as Col[] : sub === 'service_package' ? [['default_fee', 'Default fee (INR)']] as Col[]
    : sub === 'document_type' ? [['description', 'Description'], ['max_mb', 'Max MB'], ['has_expiry', 'Has expiry', (r) => (r.has_expiry ? 'Yes' : '')]] as Col[] : []), ['sort', 'Order']];
}
function fieldsFor(sub: string, docTypes: [string, string][]): Field[] {
  const countries = (useMeta.getState().meta?.countries ?? []).map((c) => [c.id, c.name] as [string, string]);
  const F: Record<string, Field[]> = {
    countries: [{ k: 'name', label: 'Name', req: true }, { k: 'code', label: 'Code' }, { k: 'currency', label: 'Currency', type: 'select', noBlank: true, opts: ['EUR', 'SEK', 'CNY', 'USD', 'GBP', 'CHF', 'DKK', 'NOK', 'PLN', 'CZK', 'HUF'] },
      { k: 'dependant_visa', label: 'Dependant visa allowed', type: 'select', noBlank: true, opts: ['Yes', 'No', 'Depends'], help: 'Used for shortlist warning R2' }, { k: 'aps_required', label: 'APS required', type: 'checkbox' },
      { k: 'dependant_notes', label: 'Dependant visa notes (per level if needed)', type: 'textarea', col: 6 }, { k: 'sort', label: 'Order', type: 'number' }],
    universities: [{ k: 'name', label: 'Name', req: true, col: 3 }, { k: 'country_id', label: 'Country', type: 'select', req: true, opts: countries, col: 3 }, { k: 'city', label: 'City' }, { k: 'website', label: 'Website', type: 'url' },
      { k: 'type', label: 'Type', type: 'select', opts: ['Public', 'Private'] }, { k: 'approved', label: 'Approved', type: 'checkbox' }],
    courses: [{ k: 'name', label: 'Course name', req: true, col: 3 }, { k: 'university_id', label: 'University', type: 'select', req: true, opts: (useMeta.getState().meta?.universities ?? []).map((u) => [u.id, u.name] as [string, string]), col: 3 },
      { k: 'level', label: 'Level', type: 'select', opts: LEVELS }, { k: 'field', label: 'Field' }, { k: 'duration', label: 'Duration' }, { k: 'language', label: 'Language', type: 'select', opts: ['English', 'French', 'German', 'Italian', 'Spanish', 'Dutch', 'Chinese', 'Other'] },
      { k: 'tuition_fee', label: 'Tuition fee / year', type: 'number', col: 1 }, { k: 'currency', label: 'Currency', type: 'select', noBlank: true, opts: ['EUR', 'CNY', 'USD', 'INR', 'SEK'], col: 1 }, { k: 'application_fee', label: 'Application fee', type: 'number' },
      { k: 'min_english', label: 'Min IELTS (or equivalent)', type: 'number', step: 0.5, min: 0, max: 9, help: 'Used for warning R5' }, { k: 'course_link', label: 'Course link', type: 'url', col: 4 }, { k: 'approved', label: 'Approved', type: 'checkbox' }],
    intakes: [{ k: 'name', label: 'Name', req: true, placeholder: 'Sep 2027' }, { k: 'month', label: 'Month (1-12)', type: 'number', req: true, min: 1, max: 12 }, { k: 'year', label: 'Year', type: 'number', req: true }],
    checklists: [{ k: 'country_id', label: 'Country', type: 'select', blank: 'All countries', opts: countries, col: 3 }, { k: 'level', label: 'Level', type: 'select', blank: 'All levels', opts: LEVELS, col: 3 },
      { k: 'document_type_id', label: 'Document type', type: 'select', req: true, opts: docTypes, col: 3 }, { k: 'required', label: 'Required', type: 'select', noBlank: true, opts: ['Yes', 'Optional', 'If Bachelor', 'If Master', 'If work exp', 'If taken'], col: 2 }, { k: 'sort', label: 'Order', type: 'number', col: 1 }],
    app_stage: [{ k: 'name', label: 'Name', req: true, col: 3 }, { k: 'sort', label: 'Order', type: 'number', col: 1 }, { k: 'color', label: 'Colour', type: 'color', col: 2 }],
    sub_agent: [{ k: 'name', label: 'Name', req: true, col: 3 }, { k: 'contact', label: 'Contact', col: 3 }, { k: 'city', label: 'City' }, { k: 'sort', label: 'Order', type: 'number' }],
    service_package: [{ k: 'name', label: 'Name', req: true, col: 3 }, { k: 'default_fee', label: 'Default fee (INR)', type: 'number', col: 3 }],
    document_type: [{ k: 'name', label: 'Name', req: true, col: 3 }, { k: 'max_mb', label: 'Max size (MB, up to 25)', type: 'number', min: 1, max: 25, col: 1 }, { k: 'has_expiry', label: 'Has expiry', type: 'checkbox', col: 2 },
      { k: 'description', label: 'Description', col: 6 }, { k: 'allowed', label: 'Allowed file types', type: 'multi', opts: ['pdf', 'jpg', 'jpeg', 'png'], col: 6 }, { k: 'visa', label: 'Visa document', type: 'checkbox' }],
  };
  F.visa_stage = F.app_stage;
  const stage = ['app_stage', 'visa_stage'].includes(sub);
  return [...(F[sub] ?? [{ k: 'name', label: 'Name', req: true, col: 4 }, { k: 'sort', label: 'Order', type: 'number', col: 2 }]), ...(stage ? [] : [{ k: 'active', label: 'Active', type: 'checkbox' } as Field])];
}
export function Masters({ sub = 'countries' }: { sub?: string }) {
  const [rows, setRows] = useState<Any[] | null>(null);
  const [docTypes, setDocTypes] = useState<[string, string][]>([]);
  const load = useCallback(async () => {
    try { const [r, dt] = await Promise.all([GET('/admin/masters/' + sub), GET('/admin/masters/document_type')]); setRows(r); setDocTypes(dt.map((x: Any) => [x.id, x.name] as [string, string])); } catch (e) { showError(e); }
  }, [sub]);
  useEffect(() => { setRows(null); load(); }, [load]);
  const label = MASTERS.find((m) => m[0] === sub)?.[1] ?? sub;
  const stage = ['app_stage', 'visa_stage'].includes(sub);
  const save = async (id: string | null, v: Vals) => { if (id) await PUT(`/admin/masters/${sub}/${id}`, v); else await POST(`/admin/masters/${sub}`, v); await reloadMeta(); return true; };
  const act = (fn: () => Promise<unknown>) => async () => { try { await fn(); } catch (e) { showError(e); } };
  const cols = colsFor(sub);
  return (
    <div className="grid" style={{ gridTemplateColumns: '220px minmax(0,1fr)' }}>
      <div className="card"><div className="bd" style={{ padding: 8 }}>{MASTERS.map(([k, l]) => (
        <Link key={k} href={`/admin/masters/${k}`} className={k === sub ? 'on' : ''} style={{ display: 'block', padding: '7px 10px', borderRadius: 7, ...(k === sub ? { background: 'var(--brand-soft)', fontWeight: 600 } : {}) }}>{l}</Link>
      ))}</div></div>
      <div className="card">
        <div className="hd"><h2>{label}</h2><span className="muted small">Masters are never deleted: set Inactive instead</span><span className="grow" />
          {stage ? null : <button className="btn primary sm" onClick={act(async () => { if (await formModal({ title: 'Add ' + label, size: 'lg', fields: fieldsFor(sub, docTypes), values: { active: true, approved: true, currency: 'EUR', required: 'Yes', allowed: ['pdf', 'jpg', 'jpeg', 'png'], max_mb: 10 }, save: (v) => save(null, v) })) load(); })}>+ Add</button>}</div>
        <div className="bd flush"><div className="table-wrap"><table className="t cards">
          <thead><tr>{cols.map((c) => <th key={c[0]}>{c[1]}</th>)}<th>Active</th><th /></tr></thead>
          <tbody>{!rows ? <tr><td colSpan={cols.length + 2} className="empty">Loading...</td></tr> : rows.map((r) => (
            <tr key={r.id} className={r.active ? '' : 'muted'}>
              {cols.map((c) => <td key={c[0]} data-label={c[1]}>{c[2] ? c[2](r) : String(r[c[0]] ?? '')}</td>)}
              <td data-label="Active">{r.active ? <span className="badge green">Active</span> : <span className="badge grey">Inactive</span>}</td>
              <td className="nowrap">
                <button className="btn xs" onClick={act(async () => { if (await formModal({ title: 'Edit ' + label, size: 'lg', fields: fieldsFor(sub, docTypes), values: { ...r, active: !!r.active, approved: !!r.approved, aps_required: !!r.aps_required }, save: (v) => save(r.id, v) })) load(); })}>Edit</button>
                {stage ? null : <> <button className="btn xs" onClick={act(async () => { await save(r.id, { active: !r.active }); load(); })}>{r.active ? 'Set inactive' : 'Set active'}</button></>}
                {(sub === 'universities' || sub === 'courses') && !r.approved ? <> <button className="btn xs primary" onClick={act(async () => { await save(r.id, { approved: true }); toast('Approved into the master', 'ok'); load(); })}>Approve</button></> : null}
              </td>
            </tr>
          ))}</tbody>
        </table></div></div>
      </div>
    </div>
  );
}

// ---------- email templates ----------
export function Templates() {
  const [d, setD] = useState<Any | null>(null);
  const load = useCallback(() => GET('/admin/templates').then(setD).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="empty">Loading...</div>;
  const act = (fn: () => Promise<unknown>) => async () => { try { await fn(); } catch (e) { showError(e); } };
  return (
    <div className="card">
      <div className="hd"><h2>Email templates and triggers</h2><span className="grow" /><span className="badge blue">CC: {d.cc} (always, cannot be changed)</span></div>
      <div className="bd flush"><div className="table-wrap"><table className="t cards">
        <thead><tr><th>Code</th><th>Trigger event</th><th>Update title</th><th>On / Off</th><th>Version</th><th>Last edited</th><th /></tr></thead>
        <tbody>{d.rows.map((t: Any) => (
          <tr key={t.trigger_code}>
            <td className="mono" data-label="Code">{t.trigger_code}</td>
            <td data-label="Trigger">{t.name}{t.trigger_code === 'E21' ? <div className="small"><label className="row" style={{ gap: 5 }}><input type="checkbox" defaultChecked={!!d.e21_not_interested} onChange={act(async () => { await PUT('/admin/templates/E21', { e21_not_interested: !d.e21_not_interested }); toast('Saved', 'ok'); load(); })} /> also for &quot;Not interested&quot;</label></div> : null}</td>
            <td data-label="Title">{t.update_title}</td>
            <td data-label="On / Off"><label className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!t.is_active} onChange={act(async () => { await PUT(`/admin/templates/${t.trigger_code}`, { is_active: !t.is_active }); toast(`${t.trigger_code} switched ${!t.is_active ? 'On' : 'Off'}`, 'ok'); load(); })} /> {t.is_active ? 'On' : 'Off'}</label></td>
            <td data-label="Version">v{t.version}</td>
            <td data-label="Last edited" className="small">{t.last_edited_by || '-'}<br /><span className="muted">{t.last_edited_at ? fmtDT(t.last_edited_at) : ''}</span></td>
            <td className="nowrap"><Link className="btn xs" href={`/admin/templates/${t.trigger_code}`}>Edit</Link> <button className="btn xs" onClick={act(async () => { const r = await POST(`/admin/templates/${t.trigger_code}/test`); toast(`Test email sent to ${r.to} (CC ${r.cc})`, 'ok'); })}>Send test</button></td>
          </tr>
        ))}</tbody>
      </table></div></div>
    </div>
  );
}
const previewHtml = (title: string, body: string) => `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;max-width:600px;margin:16px auto;background:#FFFFFF;border:1px solid #E6E8F0;border-radius:20px;overflow:hidden;color:#0B1020"><div style="height:4px;background:linear-gradient(90deg,#8B5CF6,#5B56E9,#3B82F6)"></div><div style="padding:18px 24px 4px;font-weight:700;font-size:18px;display:flex;gap:10px;align-items:center"><img src="/brand/vernyr-icon-192.png" width="32" height="32" alt="">La Europa Education</div><div style="padding:12px 24px 24px;line-height:1.6"><h2 style="color:#0B1020;font-size:21px">${title.replace(/[<>&]/g, '')}</h2><p>Dear {student_first_name},</p>${body}<p>Warm regards,<br>{counsellor_name}</p></div></div>`;
export function TemplateEdit({ code }: { code: string }) {
  const [t, setT] = useState<Any | null>(null);
  const [list, setList] = useState<Any | null>(null);
  const [v, setV] = useState<Vals>({});
  const [err, setErr] = useState<Record<string, string>>({});
  const body = useRef<HTMLTextAreaElement>(null);
  const load = useCallback(async () => {
    try { const [x, l] = await Promise.all([GET('/admin/templates/' + code), GET('/admin/templates')]); setT(x); setList(l); setV({ update_title: x.update_title, body_html: x.body_html, is_active: !!x.is_active }); } catch (e) { showError(e); }
  }, [code]);
  useEffect(() => { load(); }, [load]);
  if (!t || !list) return <div className="empty">Loading...</div>;
  const fail = (e: unknown) => { if (e instanceof ApiError && e.data.errors) setErr(e.data.errors); showError(e); };
  const insert = (p: string) => {
    const el = body.current, s = el?.selectionStart ?? String(v.body_html).length, e = el?.selectionEnd ?? s;
    setV((x) => ({ ...x, body_html: String(x.body_html).slice(0, s) + `{${p}}` + String(x.body_html).slice(e) }));
  };
  return (
    <>
      <div className="page-head"><Link className="btn ghost sm" href="/admin/templates">← All templates</Link><h2>{t.trigger_code}: {t.name}</h2></div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)' }}>
        <div className="card"><div className="bd">
          <form noValidate onSubmit={(e) => e.preventDefault()}><div className="form-grid">
            <div className="f c6"><label>CC</label><input type="text" value={`CC: ${t.cc} (always)`} disabled /></div>
            <div className="f c6"><label>Subject</label><input type="text" value="La Europa Education | {student_name} ({student_id}) | Your Study Abroad Updates (fixed, keeps one thread)" disabled /></div>
            <div className={`f c6${err.update_title ? ' err' : ''}`}><label>Update title (bold first line)<span className="req">*</span></label><input type="text" value={v.update_title ?? ''} onChange={(e) => setV({ ...v, update_title: e.target.value })} /><div className="msg">{err.update_title ?? ''}</div></div>
            <div className={`f c6${err.body_html ? ' err' : ''}`}><label>Body (HTML)<span className="req">*</span></label><textarea ref={body} rows={12} className="mono" value={v.body_html ?? ''} onChange={(e) => setV({ ...v, body_html: e.target.value })} /><div className="msg">{err.body_html ?? ''}</div></div>
            <div className="f check c6 inline"><input type="checkbox" id="ia" checked={!!v.is_active} onChange={(e) => setV({ ...v, is_active: e.target.checked })} /><label htmlFor="ia">Trigger is On</label></div>
          </div>
            <div className="form-actions">
              <button className="btn" type="button" onClick={async () => { try { const r = await POST(`/admin/templates/${code}/test`, { update_title: v.update_title, body_html: v.body_html }); toast(`Test sent to ${r.to} (CC ${r.cc})`, 'ok'); } catch (e) { fail(e); } }}>Send test email to me</button>
              <button className="btn primary" type="button" onClick={async () => { setErr({}); try { await PUT('/admin/templates/' + code, v); toast('Template saved (new version)', 'ok'); load(); } catch (e) { fail(e); } }}>Save (new version)</button>
            </div>
          </form>
          <h4 style={{ margin: '16px 0 6px' }}>Preview</h4>
          <div className="email-preview"><iframe sandbox="" srcDoc={previewHtml(String(v.update_title ?? ''), String(v.body_html ?? ''))} style={{ height: 340 }} title="Preview" /></div>
        </div></div>
        <div className="stack">
          <div className="card"><div className="hd"><h3>Placeholders (whitelist)</h3></div><div className="bd">
            <p className="small muted" style={{ marginTop: 0 }}>Click to insert. Internal data (sub-agent, source, notes, remarks, budget, income, funds, discount, marital status, portal login, passport) is never available.</p>
            <div className="row">{list.whitelist.map((p: string) => <button key={p} className="btn xs" type="button" onClick={() => insert(p)}>{`{${p}}`}</button>)}</div>
          </div></div>
          <div className="card"><div className="hd"><h3>Versions</h3></div><div className="bd"><ul className="list-plain small">{t.versions.length ? t.versions.map((x: Any) => (
            <li key={x.id}><span className="grow">v{x.version} · {x.update_title}<br /><span className="muted">{x.saved_by_name || ''} {fmtDT(x.saved_at)}</span></span>
              <button className="btn xs" onClick={async () => { if (await confirmBox('Restore this version? The current text is kept as a version.')) { try { await POST(`/admin/templates/${code}/restore`, { version_id: x.id }); toast('Restored', 'ok'); load(); } catch (e) { showError(e); } } }}>Restore</button></li>
          )) : <li className="muted">No previous versions</li>}</ul></div></div>
        </div>
      </div>
    </>
  );
}

// ---------- settings ----------
const BOOLS = ['otp_enabled', 'otp_admin_only', 'drive_sync_enabled', 'parent_cc_enabled', 'attach_offer_letter', 'show_passport_last4'];
function SmtpTest() {
  const [res, setRes] = useState<{ ok: boolean; message: string } | null>(null);
  const run = async (send: boolean) => { setRes({ ok: true, message: 'Checking...' }); try { setRes(await POST('/admin/mail/verify', { send_to_me: send })); } catch (e) { setRes({ ok: false, message: (e as Error).message }); } };
  return <div className="row" style={{ marginTop: 8 }}><button className="btn sm" type="button" onClick={() => run(false)}>Test SMTP connection</button><button className="btn sm" type="button" onClick={() => run(true)}>Test and send me an email</button>
    {res ? <span className="small" style={{ color: res.ok ? 'var(--green)' : 'var(--red)' }}>{res.message}</span> : null}</div>;
}
export function Settings() {
  const [s, setS] = useState<Any | null>(null);
  const [v, setV] = useState<Vals>({});
  const [err, setErr] = useState<Record<string, string>>({});
  useEffect(() => { GET('/admin/settings').then((x) => { setS(x); setV({ ...x, ...Object.fromEntries(BOOLS.map((k) => [k, x[k] === '1'])) }); }).catch(showError); }, []);
  if (!s) return <div className="empty">Loading...</div>;
  const fields: Field[] = [{ k: 'a', type: 'section', label: 'Security' },
    { k: 'session_timeout_min', label: 'Idle session timeout (minutes, 15-120)', type: 'number', min: 15, max: 120 }, { k: 'otp_enabled', label: 'Enable OTP on login', type: 'checkbox' },
    { k: 'otp_admin_only', label: 'OTP only for Admin users', type: 'checkbox', show: (x) => !!x.otp_enabled },
    { k: 'b', type: 'section', label: 'Files' }, { k: 'max_file_mb', label: 'Max file size (MB, up to 25)', type: 'number', min: 1, max: 25 },
    { k: 'folder_trigger', label: 'Create student folder when', type: 'select', noBlank: true, opts: [['enrolment_confirmed', 'Enrolment confirmed'], ['offer_accepted', 'Offer accepted']] },
    { k: 'c', type: 'section', label: 'Student emails' },
    { k: 'h', type: 'html', html: () => <>
      <div className="info-box">CC on every student email: <b>{s.hard_cc}</b> (hard-coded, cannot be removed). Mail provider: <b>{s.mail_provider}</b>{s.mail_provider === 'sandbox' ? ' (staging: emails are written to the outbox folder, nobody is emailed)' : ''}{s.mail_redirect ? <> · <b>all emails redirected to {s.mail_redirect}</b> (MAIL_REDIRECT_TO)</> : null}. SMTP server, login and password are set on the server, never in this screen.</div>
      <SmtpTest />
    </> },
    { k: 'batching_window_min', label: 'Batching window (minutes, 0-10)', type: 'number', min: 0, max: 10 }, { k: 'sending_address', label: 'Sending address (La Europa domain)', type: 'email' },
    { k: 'sending_domain', label: 'Sending domain (Message-ID)' }, { k: 'display_name_format', label: 'From display name format' },
    { k: 'email_footer', label: 'Footer text', type: 'textarea', col: 6 }, { k: 'parent_cc_enabled', label: 'Allow parent email in CC (per student)', type: 'checkbox' },
    { k: 'attach_offer_letter', label: 'Attach offer letter to offer email', type: 'checkbox' }, { k: 'show_passport_last4', label: 'Allow {passport_last4} placeholder', type: 'checkbox' },
    { k: 'd', type: 'section', label: 'Leads and fees' },
    { k: 'auto_assign_rule', label: 'Auto-assignment of new leads (by Admin)', type: 'select', noBlank: true, opts: [['none', 'None'], ['round_robin', 'Round robin among active counsellors'], ['by_country', 'By interested country']] },
    { k: 'discount_limit_inr', label: 'Service fee discount limit without approval (INR)', type: 'number', min: 0 },
    { k: 'company_address', label: 'Company address (emails)', type: 'textarea', col: 6 }];
  const save = async () => {
    setErr({});
    const out = visibleValues(fields, v);
    for (const [k, x] of Object.entries(out)) if (typeof x === 'boolean') out[k] = x ? '1' : '0';
    if (out.otp_enabled !== '1') out.otp_admin_only = '0';
    for (const k of ['hard_cc', 'mail_provider', 'mail_redirect', 'drive_connected']) delete out[k];
    try { await PUT('/admin/settings', out); toast('Settings saved (logged)', 'ok'); await reloadMeta(); } catch (e) { if (e instanceof ApiError && e.data.errors) setErr(e.data.errors); showError(e); }
  };
  return (
    <div className="card"><div className="bd"><form noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
      <FormGrid fields={fields} vals={v} set={(k, x) => setV((o) => ({ ...o, [k]: x }))} errors={err} />
      <div className="form-actions"><button className="btn primary" type="button" onClick={save}>Save settings</button></div>
    </form></div></div>
  );
}

// ---------- audit log ----------
const ACTIONS = ['Login', 'Logout', 'Failed login', 'Lockout', 'Create', 'Update', 'Delete', 'View sensitive', 'Download', 'Export', 'Transfer', 'Save without notifying', 'Template edit', 'Setting change'];
const ENTITIES = ['Student', 'Lead', 'Application', 'Document', 'Payment', 'VisaCase', 'Task', 'User', 'EmailTemplate', 'Setting', 'Master'];
export function Audit() {
  const [f, setF] = useState<Record<string, string>>({ user: '', action: '', entity: '', q: '', from: '', to: '' });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <ListView<Any & { id: string }> listKey="audit" filters={f} setFilters={(x) => setF((s) => ({ ...s, ...x }))} fetch={(p) => GET('/admin/audit' + qs(p))}
      filtersUi={<>
        <select value={f.user} onChange={set('user')}><option value="">All users</option><Options list={M.users().map((u) => [u.id, u.name] as [string, string])} /></select>
        <select value={f.action} onChange={set('action')}><option value="">All actions</option><Options list={ACTIONS} /></select>
        <select value={f.entity} onChange={set('entity')}><option value="">All entities</option><Options list={ENTITIES} /></select>
        <input type="search" placeholder="Record / ID" value={f.q} onChange={set('q')} /><input type="date" value={f.from} onChange={set('from')} /><input type="date" value={f.to} onChange={set('to')} />
      </>}
      columns={[
        { k: 'created_at', label: 'Date-time (IST)', render: (r) => <span className="nowrap">{fmtDT(r.created_at)}</span> }, { k: 'user_name', label: 'User' },
        { k: 'action', label: 'Action', render: (r) => <span className={`badge ${r.action === 'Save without notifying' ? 'orange' : /Fail|Lock|Delete/.test(r.action) ? 'red' : 'blue'}`}>{r.action}</span> },
        { k: 'entity', label: 'Entity and record', render: (r) => <>{r.entity_type || ''} <span className="small">{r.entity_label || ''}</span></> },
        { k: 'values', label: 'Old → new', render: (r) => (r.old_value_json || r.new_value_json ? <details><summary className="small">view</summary><pre className="mono small" style={{ whiteSpace: 'pre-wrap', maxWidth: 420 }}>{r.old_value_json || ''}{'\n→\n'}{r.new_value_json || ''}</pre></details> : '') },
        { k: 'ip', label: 'IP / device', render: (r) => <span className="small muted">{r.ip || ''}<br />{String(r.user_agent || '').slice(0, 60)}</span> },
      ]} />
  );
}

// ---------- reports ----------
function Bars({ rows, k, v }: { rows: Any[]; k: string; v: string }) {
  const max = Math.max(1, ...rows.map((r) => r[v]));
  return rows.length ? <>{rows.map((r, i) => (
    <div key={i} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 40px', gap: 8, alignItems: 'center', margin: '5px 0' }}>
      <span className="small">{r[k] || '(none)'}</span><div className="progress"><i style={{ width: `${r[v] / max * 100}%`, background: 'var(--brand-2)' }} /></div><b className="small">{r[v]}</b>
    </div>
  ))}</> : <p className="muted">No data</p>;
}
export function Reports() {
  const [d, setD] = useState<Any | null>(null);
  useEffect(() => { GET('/admin/reports').then(setD).catch(showError); }, []);
  if (!d) return <div className="empty">Loading...</div>;
  const ex = (e: string) => download(`/admin/export/${e}`, `${e}.xlsx`).catch(showError);
  return (
    <div className="grid g2">
      <div className="card"><div className="hd"><h2>Students per counsellor</h2></div><div className="bd"><Bars rows={d.by_counsellor} k="user" v="students" /></div></div>
      <div className="card"><div className="hd"><h2>Applications by stage</h2></div><div className="bd"><Bars rows={d.by_stage} k="stage" v="count" /></div></div>
      <div className="card"><div className="hd"><h2>Leads by source</h2></div><div className="bd"><Bars rows={d.leads_by_source} k="source" v="count" /></div></div>
      <div className="card"><div className="hd"><h2>&quot;Save without notifying&quot; per user</h2><span className="muted small">Review for misuse</span></div><div className="bd"><Bars rows={d.without_notify} k="user" v="count" /></div></div>
      <div className="card"><div className="hd"><h2>Student emails, last 24 hours</h2></div><div className="bd"><div className="row">{d.emails_24h.length ? d.emails_24h.map((x: Any) => <span key={x.status}><StatusBadge s={x.status} /> <b>{x.c}</b>&nbsp; </span>) : <span className="muted">No emails</span>}</div></div></div>
      <div className="card"><div className="hd"><h2>Exports</h2></div><div className="bd row"><button className="btn" onClick={() => ex('leads')}>Leads (.xlsx)</button><button className="btn" onClick={() => ex('students')}>Students (.xlsx)</button><button className="btn" onClick={() => ex('applications')}>Applications (.xlsx)</button></div></div>
    </div>
  );
}
