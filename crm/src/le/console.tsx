'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { GET, POST, PUT, ApiError, download } from './api';
import { useMeta } from './meta';
import { ago, apiSrc, fmtDate, fmtDT, qs } from './format';
import { Options, formModal, type Field, type Vals } from './form';
import { Modal, confirmBox, openOverlay, showError, toast } from './ui';

/** The client's Admin console, part 1 (legacy/public/js/pages/console.js): home, people, partners, courses, approvals. */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Any = Record<string, any>;
export type Q = Record<string, string>;
export interface ConsoleCtx { me: Any; can: (m: string, a?: string) => boolean; q: Q; go: (section: string, q?: Q) => void }
export const Ctx = createContext<ConsoleCtx>(null as unknown as ConsoleCtx);
export const useConsole = () => useContext(Ctx);
export const canFor = (me: Any | null) => (m: string, a = 'view') => !!me?.modules?.[m]?.includes(a);

const PILL: Record<string, string> = { Active: 'green', Inactive: 'grey', Pending: 'orange', Open: 'blue', Merged: 'grey', Approved: 'green', Rejected: 'red', Published: 'green', 'In progress': 'purple', Resolved: 'green', Closed: 'grey',
  Scheduled: 'orange', Withdrawn: 'grey', Expired: 'grey', Sent: 'blue', Delivered: 'green', Failed: 'red', Bounced: 'red', Queued: 'grey', Matched: 'green', Mismatch: 'red', 'Reversal needed': 'red', 'Share paid before receipt': 'red', 'Received, share pending': 'orange' };
export const Pill = ({ s, c }: { s: string; c?: string }) => <span className={`badge ${c || PILL[s] || ''}`}>{s}</span>;
export const Kv = ({ k, children }: { k: string; children: React.ReactNode }) => <div className="pair"><span>{k}</span><b>{children}</b></div>;
export const amt = (list?: Any[]) => (list || []).map((x) => `${Number(x.amount).toLocaleString('en-IN')} ${x.currency}`).join(' + ') || '0';
export const act = (fn: () => Promise<unknown>) => async () => { try { await fn(); } catch (e) { showError(e); } };
export const formErrs = (setErr: (e: Record<string, string>) => void) => (e: unknown) => { if (e instanceof ApiError && e.data.errors) setErr(e.data.errors); showError(e); };
/** load a section's data; gives [data, reload] and shows the client's "Not allowed" card on a refusal */
export function useLoad<T = Any>(url: string | null): [T | null, () => void, unknown] {
  const [d, setD] = useState<T | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const load = useCallback(() => { if (url) GET<T>(url).then((x) => { setD(x); setErr(null); }).catch(setErr); }, [url]);
  useEffect(() => { load(); }, [load]);
  return [d, load, err];
}
export function Loading({ err }: { err?: unknown }) {
  if (!err) return <div className="empty">Loading...</div>;
  const st = err instanceof ApiError ? err.status : 0;
  return <div className="card"><div className="bd"><h2>{st === 403 ? 'Not allowed' : 'Something went wrong'}</h2><p className="muted">{(err as Error).message}</p></div></div>;
}
export function LinkCard({ title, text, href }: { title: string; text: string; href: string }) {
  return <div className="card"><div className="hd"><h2>{title}</h2></div><div className="bd"><p>{text}</p><Link className="btn primary" href={href}>Open {title}</Link></div></div>;
}
const local = (h: string) => String(h ?? '').replace(/^#/, '');

// ---------- AD01 home ----------
export function Home() {
  const { q, go } = useConsole();
  const [d, , err] = useLoad('/console/home' + qs(q));
  if (!d) return <Loading err={err} />;
  const b = d.badges, k = d.kpi;
  const Badge = ({ n, l, href }: { n: number; l: string; href: string }) => <Link className={`cbadge ${n ? 'hot' : ''}`} href={href}><b>{n}</b><span>{l}</span></Link>;
  const fmax = Math.max(1, ...d.funnel.map((f: [string, number]) => f[1]));
  return (
    <>
      <div className="cbadges"><Badge n={b.approvals} l="Approvals" href="/console/approvals" /><Badge n={b.unassigned} l="Unassigned" href="/console/assignment" />
        <Badge n={b.failed_emails} l="Failed emails (7 days)" href="/console/email-log?status=Failed" /><Badge n={b.privacy} l="Privacy requests" href="/admin/privacy" /></div>
      <div className="filters">
        <select value={q.period || 'month'} onChange={(e) => go('home', { ...q, period: e.target.value })}><Options list={[['month', 'This month'], ['fy', 'Financial year'], ['all', 'All time']]} /></select>
        <select value={q.branch || ''} onChange={(e) => go('home', { ...q, branch: e.target.value })}><option value="">All branches</option><Options list={d.branches} /></select>
      </div>
      <div className="stats uni-stats">
        {([['New leads', k.new_leads], ['Registered students', k.registered], ['Applications submitted', k.applied], ['Offers', k.offers], ['Visa approved', k.visa_approved], ['Enrolled', k.enrolled]] as [string, number][]).map(([l, v]) => <div key={l} className="stat"><div className="lbl">{l}</div><div className="val">{v}</div></div>)}
        <div className="stat"><div className="lbl">Service fee collected</div><div className="val" style={{ fontSize: 16 }}>{amt(k.service_fee)}</div></div>
        {d.finance ? <div className="stat"><div className="lbl">Commission due from universities</div><div className="val" style={{ fontSize: 16 }}>{amt(k.commission_due)}</div></div> : null}
      </div>
      <div className="grid uni-dash" style={{ marginTop: 14 }}>
        <div className="grid" style={{ gap: 14 }}>
          <div className="card"><div className="hd"><h2>Funnel</h2></div><div className="bd">{d.funnel.map(([l, n]: [string, number], i: number) => (
            <div key={l} className="fun"><span>{l}</span><div><i style={{ width: `${n / fmax * 100}%` }} /></div><b>{n}</b><small>{i && d.funnel[i - 1][1] ? Math.round(n / d.funnel[i - 1][1] * 100) + '%' : ''}</small></div>
          ))}</div></div>
          <div className="card"><div className="hd"><h2>Counsellor leaderboard</h2></div><div className="table-wrap"><table className="tbl"><thead><tr><th>Counsellor</th><th className="right">Registered</th><th className="right">Enrolled</th></tr></thead><tbody>
            {d.leaders.length ? d.leaders.map((x: Any) => <tr key={x.name}><td>{x.name}</td><td className="right">{x.registered}</td><td className="right">{x.enrolled}</td></tr>) : <tr><td colSpan={3} className="empty">No counsellors</td></tr>}</tbody></table></div></div>
        </div>
        <div className="grid" style={{ gap: 14 }}>
          <div className="card"><div className="hd"><h2>Expiring agreements (60 days)</h2></div><div className="bd small">{d.expiring.length ? d.expiring.map((x: Any, i: number) => <Kv key={i} k={`${x.kind}: ${x.name}`}>{fmtDate(x.end_date)}</Kv>) : <span className="muted">None</span>}</div></div>
          <div className="card"><div className="hd"><h2>Catalogue quality</h2><span className="grow" /><Link className="small" href="/console/catalogue">Open</Link></div><div className="bd small">
            <Kv k="Universities without logo">{d.quality.missing_logo}</Kv><Kv k="Courses not verified recently">{d.quality.old_verified}</Kv><Kv k="Course link warnings">{d.quality.link_warnings}</Kv></div></div>
        </div>
      </div>
    </>
  );
}

// ---------- AD02 roles ----------
const SCOPES: [string, string][] = [['own', 'Own assigned records'], ['team', 'Own team'], ['branch', 'Own branch'], ['all', 'All']];
function RoleForm({ d, cur, done }: { d: Any; cur: Any; done: () => void }) {
  const ed = !!d.can_edit;
  const [v, setV] = useState<Any>(() => ({ name: cur.name, data_scope: cur.data_scope, description: cur.description || '', status: cur.status, sensitive: { ...cur.sensitive }, limits: { ...cur.limits }, perms: JSON.parse(JSON.stringify(cur.perms)) }));
  const [err, setErr] = useState<Record<string, string>>({});
  const tog = (p: string, a: string, on: boolean) => setV((o: Any) => { const perms = { ...o.perms }; const l = new Set<string>(perms[p] || []); if (on) l.add(a); else l.delete(a); perms[p] = [...l]; return { ...o, perms }; });
  const grid = (mods: [string, string][], prefix: string) => (
    <table className="tbl perm"><thead><tr><th>Module</th>{d.actions.map((a: string) => <th key={a}>{a === 'add' ? 'Create' : a[0].toUpperCase() + a.slice(1)}</th>)}</tr></thead><tbody>
      {mods.map(([m, l]) => <tr key={m}><td>{l}</td>{d.actions.map((a: string) => <td key={a} className="center"><input type="checkbox" disabled={!ed} checked={(v.perms[prefix + m] || []).includes(a)} onChange={(e) => tog(prefix + m, a, e.target.checked)} /></td>)}</tr>)}</tbody></table>
  );
  const save = async (e: React.FormEvent) => { e.preventDefault(); setErr({}); try { await PUT('/console/roles/' + cur.id, v); toast('Role saved', 'ok'); done(); } catch (er) { formErrs(setErr)(er); } };
  const preview = act(async () => {
    const p = await POST(`/console/roles/${cur.id}/preview`);
    openOverlay((close) => <Modal title={`Preview: ${p.name}`} close={close}><Kv k="Data scope">{p.data_scope}</Kv><p className="small">{p.sample}</p><h3>Admin console menu</h3><p className="small">{p.console.join(', ') || 'No access'}</p><h3>CRM</h3><p className="small">{p.crm.join(', ') || 'No access'}</p></Modal>);
  });
  const lim = (k: string) => ({ value: v.limits[k] ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, limits: { ...v.limits, [k]: e.target.value } }) });
  return (
    <form noValidate onSubmit={save}><div className="form-grid">
      <div className={`f c3${err.name ? ' err' : ''}`}><label>Role name</label><input value={v.name} maxLength={50} disabled={cur.is_system || !ed} onChange={(e) => setV({ ...v, name: e.target.value })} /><div className="msg">{err.name ?? ''}</div></div>
      <div className={`f c3${err.data_scope ? ' err' : ''}`}><label>Data scope</label><select value={v.data_scope} disabled={cur.code === 'admin' || !ed} onChange={(e) => setV({ ...v, data_scope: e.target.value })}><Options list={SCOPES} /></select><div className="msg">{err.data_scope ?? ''}</div></div>
      <div className="f c6"><label>Description</label><input value={v.description} disabled={!ed} onChange={(e) => setV({ ...v, description: e.target.value })} /></div>
      <div className="f c6"><label>Sensitive data</label><div className="ms">{[['passport', 'See full passport number'], ['budget', 'See budget / sponsor data'], ['bank', 'See bank details'], ['commission', 'See commission']].map(([k2, l]) => (
        <label key={k2}><input type="checkbox" disabled={!ed} checked={!!v.sensitive[k2]} onChange={(e) => setV({ ...v, sensitive: { ...v.sensitive, [k2]: e.target.checked } })} />{l}</label>))}</div></div>
      <div className="f c2"><label>Max discount (INR)</label><input type="number" disabled={!ed} {...lim('discount_amount')} /></div><div className="f c2"><label>Max discount (%)</label><input type="number" disabled={!ed} {...lim('discount_percent')} /></div>
      <div className="f c2"><label>Max payout / invoice approval</label><input type="number" disabled={!ed} {...lim('payout_amount')} /></div>
      <div className="f c3"><label>Status</label><select value={v.status} disabled={cur.is_system || !ed} onChange={(e) => setV({ ...v, status: e.target.value })}><Options list={['Active', 'Inactive']} /></select></div>
    </div>
      <h3 style={{ margin: '14px 0 6px' }}>Admin console permissions</h3><div className="table-wrap">{grid(d.ad_modules, 'ad_')}</div>
      {cur.code !== 'admin' ? <><h3 style={{ margin: '14px 0 6px' }}>CRM permissions</h3><div className="table-wrap">{grid(d.crm_modules, '')}</div></> : <p className="small muted">The Admin role keeps full CRM access; only its console permissions are edited here.</p>}
      <div className="row" style={{ gap: 8, marginTop: 12 }}>{ed ? <button className="btn primary" type="submit">Save role</button> : null}<button className="btn" type="button" onClick={preview}>Preview as role</button></div>
      <p className="small muted">Changes apply at the next request of every user with this role and are written to the audit log.</p>
    </form>
  );
}
export function Roles() {
  const { q, go } = useConsole();
  const [d, load, err] = useLoad('/console/roles');
  if (!d) return <Loading err={err} />;
  const cur = d.rows.find((r: Any) => r.id === q.id) || d.rows[0];
  const add = act(async () => {
    const r = await formModal<Any>({ title: 'New role', save: (v) => POST('/console/roles', v), fields: [{ k: 'name', label: 'Role name', req: true }, { k: 'based_on', label: 'Based on (copies permissions)', type: 'select', opts: d.rows.map((x: Any) => [x.id, x.name] as [string, string]) },
      { k: 'data_scope', label: 'Data scope', type: 'select', noBlank: true, opts: SCOPES }, { k: 'description', label: 'Description' }] });
    if (r) { toast('Role created', 'ok'); load(); go('roles', { id: r.id }); }
  });
  return (
    <div className="rolegrid">
      <div className="card"><div className="bd flush">
        {d.rows.map((r: Any) => <Link key={r.id} className={`thr ${r.id === cur.id ? 'on' : ''}`} href={`/console/roles?id=${r.id}`}><b>{r.name}</b>{r.is_system ? <> <span className="badge">System</span></> : null}<div className="small muted">{r.users} user(s) · scope: {r.data_scope}{r.status === 'Inactive' ? ' · inactive' : ''}</div></Link>)}
        {d.can_edit ? <div style={{ padding: 10 }}><button className="btn sm primary block" onClick={add}>+ New role</button></div> : <div className="small muted" style={{ padding: 10 }}>Only a Super Admin can create or change roles.</div>}
      </div></div>
      <div className="card"><div className="bd"><RoleForm key={cur.id} d={d} cur={cur} done={load} /></div></div>
    </div>
  );
}

// ---------- AD03 staff users ----------
export function Staff() {
  const [d, load, err] = useLoad('/console/users');
  if (!d) return <Loading err={err} />;
  const edit = (u: Any) => act(async () => {
    const r = await formModal({ title: `Edit ${u.name}`, size: 'lg', values: { ...u, languages: (u.languages || []).join(', '), leave: (u.leave || []).map((x: Any) => `${x.from} to ${x.to}`).join('\n') },
      fields: [{ k: 'role_id', label: 'Role', type: 'select', noBlank: true, col: 3, opts: d.roles.map((x: Any) => [x.id, x.name] as [string, string]) }, { k: 'branch_id', label: 'Branch', type: 'select', col: 3, opts: d.branches }, { k: 'team_id', label: 'Team', type: 'select', col: 3, opts: d.teams },
        { k: 'capacity', label: 'Capacity (max active students, 0 = no limit)', type: 'number', col: 3 }, { k: 'countries', label: 'Countries handled', type: 'multi', opts: d.countries }, { k: 'languages', label: 'Languages (comma separated)' },
        { k: 'finance', label: 'Finance permission', type: 'checkbox', col: 2 }, { k: 'discount_approver', label: 'Can approve discounts', type: 'checkbox', col: 2 }, { k: 'partner_manager', label: 'Partner manager', type: 'checkbox', col: 2 },
        ...(d.super ? [{ k: 'signing_authority', label: 'Signing authority', type: 'checkbox' } as Field] : []), { k: 'leave', label: 'Leave periods: one per line as YYYY-MM-DD to YYYY-MM-DD (skipped by auto-assignment)', type: 'textarea' }],
      save: (v) => PUT(`/console/users/${u.id}/profile`, { ...v, languages: String(v.languages || '').split(',').map((x) => x.trim()).filter(Boolean),
        leave: String(v.leave || '').split('\n').map((l) => l.match(/(\d{4}-\d{2}-\d{2})\s*to\s*(\d{4}-\d{2}-\d{2})/)).filter(Boolean).map((m) => ({ from: m![1], to: m![2] })) }) });
    if (r) { toast('Saved', 'ok'); load(); }
  });
  const sup = (u: Any) => act(async () => {
    const on = !u.super_admin;
    if (!(await confirmBox(on ? 'Make this Admin a Super Admin? Super Admins can change roles, security and bank details.' : 'Remove Super Admin? At least one active Super Admin must remain.'))) return;
    await POST(`/console/users/${u.id}/super`, { on }); toast('Saved', 'ok'); load();
  });
  return (
    <div className="card"><div className="hd"><h2>Staff users</h2><span className="grow" /><Link className="btn sm" href="/admin/users">Add / deactivate users</Link></div>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Name</th><th>Role</th><th>Branch / team</th><th>Load</th><th>Flags</th><th /></tr></thead><tbody>
        {d.rows.map((u: Any) => (
          <tr key={u.id}>
            <td><b>{u.name}</b>{u.super_admin ? <> <span className="badge purple">Super Admin</span></> : null}<div className="small muted">{u.email}{u.status !== 'active' ? ' · inactive' : ''}{u.on_leave ? <> · <b>on leave</b></> : null}</div></td><td>{u.role_name}</td>
            <td className="small">{u.branch || '-'}{u.team ? ' / ' + u.team : ''}</td><td className="small">{u.active_load}{u.capacity ? ' / ' + u.capacity : ''}</td>
            <td className="small">{[u.finance && 'Finance', u.discount_approver && 'Discounts', u.partner_manager && 'Partner manager', u.signing_authority && 'Signing'].filter(Boolean).join(', ') || '-'}</td>
            <td className="nowrap"><button className="btn xs" onClick={edit(u)}>Edit</button>{d.super ? <> <button className="btn xs" onClick={sup(u)}>{u.super_admin ? 'Remove Super Admin' : 'Make Super Admin'}</button></> : null}</td>
          </tr>
        ))}</tbody></table></div></div>
  );
}

// ---------- AD04 branches and teams ----------
export function Branches() {
  const [d, load, err] = useLoad('/console/branches');
  if (!d) return <Loading err={err} />;
  const bf: Field[] = [{ k: 'name', label: 'Branch name', req: true }, { k: 'address', label: 'Address', type: 'textarea' }, { k: 'phone', label: 'Phone', col: 3 }, { k: 'email', label: 'Email', col: 3 }, { k: 'manager_id', label: 'Branch manager', type: 'select', opts: d.users, col: 3 }, { k: 'office_hours', label: 'Office hours', col: 3 }, { k: 'status', label: 'Status', type: 'select', noBlank: true, opts: ['Active', 'Inactive'], col: 3 }];
  const tf: Field[] = [{ k: 'name', label: 'Team name', req: true, col: 3 }, { k: 'branch_id', label: 'Branch', type: 'select', opts: d.branches, col: 3 }, { k: 'lead_id', label: 'Team lead', type: 'select', opts: d.users, col: 3 }, { k: 'members', label: 'Members', type: 'multi', opts: d.users }];
  const branch = (b: Any | null) => act(async () => { if (await formModal({ title: b ? 'Edit branch' : 'New branch', fields: bf, values: b ?? { status: 'Active' }, save: (v) => POST('/console/branches', b ? { ...v, id: b.id } : v) })) load(); });
  const team = (t: Any | null) => act(async () => { if (await formModal({ title: t ? 'Edit team' : 'New team', fields: tf, values: t ? { ...t, members: t.members.map((m: Any) => m.id) } : {}, save: (v) => POST('/console/teams', t ? { ...v, id: t.id } : v) })) load(); });
  return (
    <>
      <div className="grid two">
        <div className="card"><div className="hd"><h2>Branches</h2><span className="grow" /><button className="btn sm primary" onClick={branch(null)}>+ Branch</button></div><div className="table-wrap"><table className="tbl"><tbody>
          {d.branches.map((b: Any) => <tr key={b.id}><td><b>{b.name}</b><div className="small muted">{b.address || ''}{b.office_hours ? ' · ' + b.office_hours : ''}</div></td><td className="small">Manager: {b.manager || '-'}<br />{b.users} user(s)</td><td><Pill s={b.status} /></td><td><button className="btn xs" onClick={branch(b)}>Edit</button></td></tr>)}</tbody></table></div></div>
        <div className="card"><div className="hd"><h2>Teams</h2><span className="grow" /><button className="btn sm primary" onClick={team(null)}>+ Team</button></div><div className="table-wrap"><table className="tbl"><tbody>
          {d.teams.length ? d.teams.map((t: Any) => <tr key={t.id}><td><b>{t.name}</b><div className="small muted">{t.branch || ''} · lead {t.lead || '-'}</div><div className="small">{t.members.map((m: Any) => m.name).join(', ') || 'No members'}</div></td><td><button className="btn xs" onClick={team(t)}>Edit</button></td></tr>) : <tr><td className="empty">No teams yet</td></tr>}</tbody></table></div></div>
      </div>
      <p className="small muted">A role with scope &quot;Own branch&quot; sees records of users in the same branch (and branches they manage); &quot;Own team&quot; sees records of team members. Team leads get SLA escalations.</p>
    </>
  );
}

// ---------- AD05 assignment rules ----------
const TARGET: Record<string, string> = { user: 'User', team_rr: 'Team (round robin)', team_least: 'Team (least active)', branch_queue: 'Branch queue' };
const LVLS = ['Bachelor', 'Master', 'MBA', 'PhD', 'Diploma', 'Foundation', 'Language course'];
export function Assignment() {
  const { can } = useConsole();
  const [all, setAll] = useState<{ d: Any; u: Any; br: Any } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const load = useCallback(() => Promise.all([GET('/console/assignment'), GET('/console/users'), GET('/console/branches')]).then(([d, u, br]) => setAll({ d, u, br })).catch(setErr), []);
  useEffect(() => { load(); }, [load]);
  if (!all) return <Loading err={err} />;
  const { d, u, br } = all;
  const edit = can('assignment', 'edit');
  const teams = br.teams.map((t: Any) => [t.id, t.name] as [string, string]);
  const users = u.rows.filter((x: Any) => x.status === 'active').map((x: Any) => [x.id, x.name] as [string, string]);
  const fields: Field[] = [{ k: 'name', label: 'Rule name', req: true, col: 3 }, { k: 'priority', label: 'Priority (1 = first)', type: 'number', req: true, col: 3 }, { k: 'applies_to', label: 'Applies to (none = all)', type: 'multi', opts: Object.entries(d.applies) as [string, string][] },
    { k: 'c_sources', label: 'Lead source', type: 'multi', opts: d.sources }, { k: 'c_countries', label: 'Interested country', type: 'multi', opts: u.countries }, { k: 'c_levels', label: 'Level', type: 'multi', opts: LVLS },
    { k: 'c_cities', label: 'Cities (comma separated)', col: 3 }, { k: 'c_states', label: 'States (comma separated)', col: 3 },
    { k: 'assign_to_type', label: 'Assign to', type: 'select', req: true, noBlank: true, col: 3, opts: [['user', 'Specific user'], ['team_rr', 'Team (round robin)'], ['team_least', 'Team (least active students)'], ['branch_queue', 'Branch queue (manual pick)']] },
    { k: 'assign_to_id', label: 'User / team / branch', type: 'select', req: true, col: 3, opts: (v) => (v.assign_to_type === 'user' ? users : v.assign_to_type === 'branch_queue' ? br.branches.map((b: Any) => [b.id, b.name] as [string, string]) : teams) },
    { k: 'also_app_id', label: 'Also assign application team member', type: 'select', col: 3, opts: users }, { k: 'also_visa_id', label: 'Also assign visa team member', type: 'select', col: 3, opts: users }, { k: 'status', label: 'Status', type: 'select', noBlank: true, opts: ['Active', 'Inactive'], col: 3 }];
  const toBody = (v: Vals) => ({ ...v, conditions: { sources: v.c_sources, countries: v.c_countries, levels: v.c_levels, agencies: v.c_agencies, cities: v.c_cities, states: v.c_states } });
  const fromRule = (r: Any) => ({ ...r, c_sources: r.conditions.sources, c_countries: r.conditions.countries, c_levels: r.conditions.levels, c_agencies: r.conditions.agencies, c_cities: (r.conditions.cities || []).join(', '), c_states: (r.conditions.states || []).join(', ') });
  const rule = (r: Any | null) => act(async () => {
    if (await formModal({ title: r ? 'Edit rule' : 'New assignment rule', size: 'lg', fields, values: r ? fromRule(r) : { priority: (d.rules.length + 1) * 10, assign_to_type: 'user', status: 'Active' },
      save: (v) => POST('/console/assignment/rules', r ? { ...toBody(v), id: r.id } : toBody(v)) })) load();
  });
  const test = act(async () => {
    await formModal({ title: 'Test rule', saveLabel: 'Test', fields: [{ k: 'applies_to', label: 'Record type', type: 'select', noBlank: true, opts: Object.entries(d.applies) as [string, string][], col: 3 }, { k: 'source_id', label: 'Lead source', type: 'select', opts: d.sources, col: 3 },
      { k: 'countries', label: 'Interested country', type: 'multi', opts: u.countries }, { k: 'level', label: 'Level', type: 'select', opts: ['Bachelor', 'Master', 'MBA', 'PhD'], col: 3 }, { k: 'city', label: 'City', col: 3 }],
    save: async (v) => {
      const r = await POST('/console/assignment/test', v);
      openOverlay((close) => <Modal title={r.user_id ? `Would assign to ${r.user_name}` : r.queue_branch ? 'Goes to the branch queue' : 'Goes to the Unassigned queue'} close={close}><ol className="small">{r.trace.map((t: string, i: number) => <li key={i}>{t}</li>)}</ol></Modal>);
      return false;
    } });
  });
  const assign = async (id: string, user_id: string) => { if (!user_id) return; try { await POST(`/console/assignment/queue/${id}`, { user_id }); toast('Assigned', 'ok'); load(); } catch (e) { showError(e); } };
  return (
    <>
      <div className="card"><div className="hd"><h2>Assignment rules</h2><span className="muted small">First matching active rule wins (priority 1 first). Inactive, on-leave and at-capacity users are skipped.</span><span className="grow" />
        <button className="btn sm" onClick={test}>Test rule</button>{edit ? <button className="btn sm primary" onClick={rule(null)}>+ Rule</button> : null}</div>
        <div className="table-wrap"><table className="tbl"><thead><tr><th>#</th><th>Rule</th><th>Applies to</th><th>Conditions</th><th>Assign to</th><th>Status</th><th /></tr></thead><tbody>
          {d.rules.length ? d.rules.map((r: Any) => (
            <tr key={r.id}><td>{r.priority}</td><td><b>{r.name}</b></td><td className="small">{r.applies_to.map((a: string) => d.applies[a]).join(', ') || 'All'}</td>
              <td className="small">{Object.entries(r.conditions).filter(([, v]) => v && (v as unknown[]).length).map(([k, v]) => `${k}: ${(v as unknown[]).length}`).join(', ') || 'Any'}</td>
              <td className="small">{TARGET[r.assign_to_type]}: {r.target || ''}</td><td><Pill s={r.status} /></td><td>{edit ? <button className="btn xs" onClick={rule(r)}>Edit</button> : null}</td></tr>
          )) : <tr><td colSpan={7} className="empty">No rules yet: the old simple rule (Admin Settings) is used, and unmatched records go to the Unassigned queue.</td></tr>}</tbody></table></div></div>
      <div className="card" style={{ marginTop: 14 }}><div className="hd"><h2>Unassigned queue</h2></div><div className="table-wrap"><table className="tbl"><tbody>
        {d.queue.length ? d.queue.map((x: Any) => (
          <tr key={x.id}><td><b>{x.label}</b><div className="small muted">{d.applies[x.applies_to] || x.applies_to} · {ago(x.created_at)}</div></td><td className="small">{x.reason}</td>
            <td><select defaultValue="" onChange={(e) => assign(x.id, e.target.value)}><option value="">Assign to...</option><Options list={users} /></select></td></tr>
        )) : <tr><td className="empty">Nothing waiting</td></tr>}</tbody></table></div></div>
      <div className="card" style={{ marginTop: 14 }}><div className="hd"><h2>Latest assignments</h2></div><div className="table-wrap"><table className="tbl"><tbody>
        {d.history.length ? d.history.map((h: Any, i: number) => (
          <tr key={i}><td className="small">{fmtDT(h.at)}</td><td className="small">{h.record_type}</td><td className="small">{h.from || '-'} → <b>{h.to || '-'}</b></td><td className="small">{h.rule ? 'Rule: ' + h.rule : h.by ? 'By ' + h.by : ''} {h.reason || ''}</td></tr>
        )) : <tr><td className="empty">No history</td></tr>}</tbody></table></div></div>
    </>
  );
}

// ---------- AD06 bulk transfer ----------
export function Transfer() {
  const [all, setAll] = useState<{ u: Any; br: Any } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [v, setV] = useState<Any>({ from_user: '', branch_id: '', team_id: '', country_id: '', stage: '', to_type: 'user', to_id: '', reason: '', move_tasks: true, move_partner: true, include_leads: true });
  const [ferr, setFerr] = useState<Record<string, string>>({});
  const [res, setRes] = useState<React.ReactNode>(null);
  useEffect(() => { Promise.all([GET('/console/users'), GET('/console/branches')]).then(([u, br]) => setAll({ u, br })).catch(setErr); }, []);
  if (!all) return <Loading err={err} />;
  const { u, br } = all;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });
  const preview = act(async () => { const p = await POST('/console/transfer/preview', v); setRes(<div className="banner">{p.students} student(s), {p.leads} lead(s), {p.tasks} open task(s), partner manager of {p.partner.universities} universit(ies).{p.sample.length ? <><br />{p.sample.join(', ')}</> : null}</div>); });
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setFerr({});
    if (!(await confirmBox('Transfer all matching records now?'))) return;
    try {
      const r = await POST('/console/transfer', v);
      setRes(<><div className="banner">{r.count} record(s) transferred.</div><div className="table-wrap"><table className="tbl"><tbody>{r.summary.map((x: string[], i: number) => <tr key={i}>{x.map((c, j) => <td key={j} className="small">{c || '-'}</td>)}</tr>)}</tbody></table></div></>);
      toast('Transferred', 'ok');
    } catch (er) { formErrs(setFerr)(er); }
  };
  const F = ({ k, label, children, c = 3 }: { k: string; label: string; children: React.ReactNode; c?: number }) => <div className={`f c${c}${ferr[k] ? ' err' : ''}`}><label>{label}</label>{children}<div className="msg">{ferr[k] ?? ''}</div></div>;
  return (
    <div className="card"><div className="hd"><h2>Bulk transfer</h2></div><div className="bd"><form noValidate onSubmit={go}>
      <div className="form-grid">
        {F({ k: 'from_user', label: 'From user', children: <select value={v.from_user} onChange={set('from_user')}><option value="">Any</option><Options list={u.rows.map((x: Any) => [x.id, x.name + (x.status !== 'active' ? ' (inactive)' : '')] as [string, string])} /></select> })}
        {F({ k: 'branch_id', label: 'Branch', children: <select value={v.branch_id} onChange={set('branch_id')}><option value="">Any</option><Options list={br.branches} /></select> })}
        {F({ k: 'team_id', label: 'Team', children: <select value={v.team_id} onChange={set('team_id')}><option value="">Any</option><Options list={br.teams} /></select> })}
        {F({ k: 'country_id', label: 'Country (application)', children: <select value={v.country_id} onChange={set('country_id')}><option value="">Any</option><Options list={u.countries} /></select> })}
        {F({ k: 'stage', label: 'Stage', children: <select value={v.stage} onChange={set('stage')}><option value="">Any</option><Options list={(useMeta.getState().meta?.app_stages ?? []).map((s) => [s.code, s.name] as [string, string])} /></select> })}
        {F({ k: 'to_type', label: 'New owner', children: <select value={v.to_type} onChange={set('to_type')}><Options list={[['user', 'A user'], ['team', 'Round robin in a team']]} /></select> })}
        {F({ k: 'to_id', label: 'User / team', children: <select value={v.to_id} onChange={set('to_id')}><option value="">Choose...</option><optgroup label="Users"><Options list={u.rows.filter((x: Any) => x.status === 'active').map((x: Any) => [x.id, x.name] as [string, string])} /></optgroup><optgroup label="Teams"><Options list={br.teams} /></optgroup></select> })}
        {F({ k: 'reason', label: 'Reason (required; students get E20 if switched on)', c: 6, children: <input maxLength={300} value={v.reason} onChange={set('reason')} /> })}
      </div>
      <div className="ms" style={{ margin: '8px 0' }}><label><input type="checkbox" checked={v.move_tasks} onChange={set('move_tasks')} /> Also transfer open tasks</label><label><input type="checkbox" checked={v.move_partner} onChange={set('move_partner')} /> Also move partner manager roles</label><label><input type="checkbox" checked={v.include_leads} onChange={set('include_leads')} /> Include leads</label></div>
      <div className="row" style={{ gap: 8 }}><button className="btn" type="button" onClick={preview}>Preview</button><button className="btn primary" type="submit">Transfer</button></div>
      <div style={{ marginTop: 10 }}>{res}</div>
    </form></div></div>
  );
}

// ---------- AD07 duplicates ----------
function Merge({ c, close, done }: { c: Any; close: () => void; done: () => void }) {
  const recs = c.records.filter((r: Any) => !r.merged_into);
  const keys = Object.keys(recs[0].fields);
  const [surv, setSurv] = useState(recs[0].id);
  const [pick, setPick] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, recs[0].id])));
  const [ok, setOk] = useState(false);
  const go = async () => {
    const take = Object.fromEntries(Object.entries(pick).filter(([, v]) => v !== surv));
    try { const r = await POST(`/console/duplicates/${c.id}/merge`, { survivor_id: surv, take, confirm: ok }); close(); toast(`Merged. Moved: ${Object.entries(r.moved).map(([t, n]) => `${t} ${n}`).join(', ') || 'no linked rows'}`, 'ok'); done(); } catch (e) { showError(e); }
  };
  return (
    <Modal title="Compare and merge" size="lg" close={close} foot={<button className="btn danger solid" onClick={go}>Merge</button>}>
      <p className="small">Choose the surviving record, then for each field which value to keep. Applications, documents, payments, emails, tasks and thread IDs move to the surviving record. The other record becomes read-only with a &quot;Merged into&quot; link. <b>A merge cannot be undone.</b></p>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Field</th>{recs.map((r: Any) => <th key={r.id}><label><input type="radio" checked={surv === r.id} onChange={() => setSurv(r.id)} /> Keep {r.code}</label></th>)}</tr></thead><tbody>
        {keys.map((k) => <tr key={k}><td className="small">{k}</td>{recs.map((r: Any) => <td key={r.id} className="small"><label><input type="radio" checked={pick[k] === r.id} onChange={() => setPick({ ...pick, [k]: r.id })} /> {String(r.fields[k] ?? '-')}</label></td>)}</tr>)}</tbody></table></div>
      <label className="row small" style={{ gap: 6, marginTop: 8 }}><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I understand the merge cannot be undone</label>
    </Modal>
  );
}
export function Duplicates() {
  const { q } = useConsole();
  const status = q.status || 'Open';
  const [d, load, err] = useLoad('/console/duplicates' + qs({ status, scan: q.scan }));
  if (!d) return <Loading err={err} />;
  return (
    <>
      <div className="page-head" style={{ margin: '0 0 10px' }}><div className="tabs">{['Open', 'Merged', 'Not duplicate'].map((s) => <Link key={s} href={`/console/duplicates?status=${encodeURIComponent(s)}`} className={status === s ? 'on' : ''}>{s}</Link>)}</div><span className="grow" /><Link className="btn sm" href="/console/duplicates?scan=1">Scan now</Link></div>
      {d.rows.length ? d.rows.map((c: Any) => (
        <div key={c.id} className="card" style={{ marginBottom: 12 }}>
          <div className="hd"><h2>{c.match_type} · {c.record_kind}</h2><span className="small muted">{c.source || ''} · {fmtDate(c.created_at)}</span><span className="grow" />
            {c.status === 'Open' && d.can_merge ? <><button className="btn xs primary" onClick={() => openOverlay((close) => <Merge c={c} close={close} done={load} />)}>Compare and merge</button> <button className="btn xs" onClick={act(async () => { await POST(`/console/duplicates/${c.id}/not-duplicate`, {}); load(); })}>Not a duplicate</button></> : <Pill s={c.status} />}</div>
          <div className="table-wrap"><table className="tbl"><thead><tr><th>Record</th><th>Status</th><th>Counsellor</th><th>Linked data</th></tr></thead><tbody>
            {c.records.map((r: Any) => (
              <tr key={r.id}><td><Link href={`/${c.record_kind === 'student' ? 'students' : 'leads'}/${r.id}`}><b>{r.code}</b> {r.name}</Link>{r.merged_into ? <> <span className="badge grey">merged</span></> : null}{r.sub_agent ? <> <span className="badge">{r.sub_agent}</span></> : null}</td>
                <td>{r.status}</td><td>{r.counsellor || '-'}</td><td className="small">{Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(', ')}</td></tr>
            ))}</tbody></table></div>
        </div>
      )) : <div className="card"><div className="empty">No duplicate cases. &quot;Scan now&quot; checks passport, email, mobile and name + date of birth.</div></div>}
    </>
  );
}

// ---------- AD08 universities ----------
export function Universities() {
  const { can } = useConsole();
  const [d, load, err] = useLoad('/console/universities');
  if (!d) return <Loading err={err} />;
  const note = (u: Any) => act(async () => { if (await formModal({ title: 'Logo source note (internal)', fields: [{ k: 'note', label: 'Where the logo comes from (e.g. university website, press kit)' }], values: { note: u.logo_source_note || '' }, save: (v) => PUT(`/console/universities/${u.id}/logo-note`, v) })) load(); });
  return (
    <>
      <div className="card"><div className="hd"><h2>Universities</h2><span className="grow" /><Link className="btn sm" href="/admin/masters/universities">Universities master</Link></div>
        <div className="table-wrap"><table className="tbl"><thead><tr><th>University</th><th>Country / city</th><th>Portal</th><th>Agreement</th><th>Partner manager</th><th className="right">Active apps</th><th className="right">Enrolled</th>{d.finance ? <th>Commission due</th> : null}<th>Logo</th></tr></thead><tbody>
          {d.rows.map((u: Any) => (
            <tr key={u.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <td><div className="row" style={{ gap: 8 }}><img className="cs-logo" style={{ width: 32, height: 32 }} src={apiSrc(u.logo)} alt="" /><b>{u.name}</b></div></td>
              <td className="small">{u.country || ''} · {u.city || ''}</td><td><Pill s={u.portal_status} /></td><td><Pill s={u.agreement} c={u.agreement === 'Active' ? 'green' : u.agreement === 'Expiring soon' ? 'orange' : 'grey'} /></td>
              <td className="small">{u.partner_manager || '-'}</td><td className="right">{u.active_apps}</td><td className="right">{u.enrolled}</td>{d.finance ? <td className="small">{u.commission_due || '-'}</td> : null}
              <td className="small">{u.has_logo ? 'OK' : <span style={{ color: 'var(--error-ink)' }}>Missing</span>}{can('universities', 'edit') ? <> <button className="btn xs" title={u.logo_source_note || ''} onClick={note(u)}>Source note</button></> : null}</td>
            </tr>
          ))}</tbody></table></div></div>
      <p className="small muted">Logos: PNG or JPG, transparent background, at least 200 px high (upload in Admin Settings &gt; Course catalogue &gt; University logos). Courses of a university without a logo show initials and appear in the catalogue quality report.</p>
    </>
  );
}

function Sec({ title, rows, cols, render }: { title: string; rows: Any[]; cols: string[]; render: (x: Any, i: number) => React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 12 }}><div className="hd"><h2>{title}</h2><span className={`badge ${rows.length ? 'orange' : 'green'}`}>{rows.length}</span></div>
      {rows.length ? <div className="table-wrap"><table className="tbl"><thead><tr>{cols.map((c, i) => <th key={i}>{c}</th>)}</tr></thead><tbody>{rows.slice(0, 50).map(render)}</tbody></table></div> : null}</div>
  );
}
export function CatalogueQuality() {
  const { can } = useConsole();
  const [d, load, err] = useLoad('/console/catalogue-quality');
  const [sel, setSel] = useState<Set<string>>(new Set());
  if (!d) return <Loading err={err} />;
  const verify = act(async () => { if (!sel.size) { toast('Select courses', 'err'); return; } await POST('/console/catalogue/bulk', { ids: [...sel], action: 'verified' }); toast('Updated', 'ok'); setSel(new Set()); load(); });
  return (
    <>
      <div className="banner">Course Search shows only 7 fields: University (with logo), Course, Course Link, Tuition Fees, Application Fees, Academic Requirement (%), English Proficiency. Import and edit courses in <Link href="/admin/catalogue">Course catalogue</Link>.</div>
      <Sec title="Universities without a logo (published courses)" rows={d.missing_logo} cols={['University', 'Courses']} render={(x, i) => <tr key={i}><td>{x.name}</td><td>{x.courses}</td></tr>} />
      <Sec title="Course link not on the university domain" rows={d.link_warnings} cols={['Course', 'University', 'Reason']} render={(x, i) => <tr key={i}><td>{x.name}</td><td>{x.university}</td><td className="small">{x.link_warning_reason || ''}</td></tr>} />
      <Sec title={`"Last verified" older than ${d.months} months`} rows={d.old_verified} cols={['', 'Course', 'University', 'Last verified']} render={(x) => (
        <tr key={x.id}><td><input type="checkbox" checked={sel.has(x.id)} onChange={(e) => setSel((o) => { const n = new Set(o); if (e.target.checked) n.add(x.id); else n.delete(x.id); return n; })} /></td><td>{x.name}</td><td>{x.university}</td><td>{x.last_verified_on ? fmtDate(x.last_verified_on) : 'Never'}</td></tr>)} />
      {d.old_verified.length && can('catalogue', 'edit') ? <div style={{ margin: '-6px 0 12px' }}><button className="btn sm" onClick={verify}>Mark selected as verified today</button></div> : null}
      <Sec title="Forbidden fee words in fee notes" rows={d.fee_words} cols={['Course', 'University']} render={(x, i) => <tr key={i}><td>{x.name}</td><td>{x.university}</td></tr>} />
      <Sec title="Duplicate courses (same university, name, level)" rows={d.duplicates} cols={['University', 'Course', 'Level', 'Count']} render={(x, i) => <tr key={i}><td>{x.university}</td><td>{x.name}</td><td>{x.level || ''}</td><td>{x.n}</td></tr>} />
      <Sec title="Deadline passed but intake still open" rows={d.passed_open} cols={['Course', 'University', 'Deadline']} render={(x, i) => <tr key={i}><td>{x.course}</td><td>{x.university}</td><td>{fmtDate(x.deadline)}</td></tr>} />
    </>
  );
}

// ---------- AD12 approvals centre ----------
function DiffTable({ oldV, newV }: { oldV: Any | null; newV: Any | null }) {
  if (!newV) return null;
  const keys = [...new Set([...Object.keys(newV || {}), ...Object.keys(oldV || {})])].filter((k) => !/(_key|_json|^id$)/.test(k) && typeof newV[k] !== 'object');
  return <div className="table-wrap"><table className="tbl"><thead><tr><th>Field</th><th>Now</th><th>Proposed</th></tr></thead><tbody>{keys.map((k) => {
    const o = oldV ? oldV[k] : undefined, n = newV[k], ch = String(o ?? '') !== String(n ?? '');
    return <tr key={k} className={ch ? 'row-info' : ''}><td className="small">{k}</td><td className="small">{String(o ?? '-')}</td><td className="small">{ch ? <b>{String(n ?? '-')}</b> : String(n ?? '-')}</td></tr>;
  })}</tbody></table></div>;
}
function ApprovalItem({ x, close, done }: { x: Any; close: () => void; done: () => void }) {
  const fin = () => { close(); toast('Done', 'ok'); done(); };
  const approve = act(async () => { await POST(x.approve.url, x.approve.body || {}); fin(); });
  const reject = act(async () => {
    const reason = x.reject.body && x.reject.body.approve === false ? true : await confirmBox('Reason (shown to the requester)', { reason: true, reasonLabel: 'Reason', ok: x.reject.label || 'Reject' });
    if (!reason) return;
    const body = { ...(x.reject.body || {}) }; if (reason !== true) body[x.reject.reasonKey || 'reason'] = reason;
    await POST(x.reject.url, body); fin();
  });
  const info = act(async () => { const t = await confirmBox('What information do you need?', { reason: true, reasonLabel: 'Message to the requester', ok: 'Send' }); if (!t) return; await POST('/console/approvals/info', { key: x.key, text: t }); fin(); });
  return (
    <Modal title={x.type} size="lg" close={close} foot={<>{x.approve || x.reject ? <button className="btn" onClick={info}>Ask for info</button> : null}{x.reject ? <button className="btn" onClick={reject}>{x.reject.label || 'Reject'}</button> : null}{x.approve ? <button className="btn primary" onClick={approve}>{x.approve.label || 'Approve'}</button> : null}</>}>
      <p><b>{x.source_name || x.source}</b> · {x.summary}</p>
      <p className="small muted">Submitted {fmtDT(x.submitted_at)} · waiting {x.waiting_days} working day(s){x.urgent_reason ? ' · urgent: ' + x.urgent_reason : ''}</p>
      <DiffTable oldV={x.old} newV={x.new} />
      {x.file ? <p><a href="#" onClick={(e) => { e.preventDefault(); download(x.file, 'file', true).catch(showError); }}>View the file</a></p> : null}
      {x.notes.length ? <><h3>Notes</h3>{x.notes.map((n: Any, i: number) => <div key={i} className="small">{fmtDT(n.at)} {n.by}: {n.text}</div>)}</> : null}
      {x.link ? <p><Link className="btn" href={local(x.link)} onClick={close}>Open the original screen</Link></p> : null}
    </Modal>
  );
}
export function Approvals() {
  const { q } = useConsole();
  const [d, load, err] = useLoad('/console/approvals');
  if (!d) return <Loading err={err} />;
  const types = Object.keys(d.counts), tab = q.type && types.includes(q.type) ? q.type : '';
  const rows = tab ? d.rows.filter((x: Any) => x.type === tab) : d.rows;
  return (
    <>
      <div className="tabs" style={{ marginBottom: 10 }}><Link href="/console/approvals" className={!tab ? 'on' : ''}>All <span className="badge">{d.rows.length}</span></Link>
        {types.map((t) => <Link key={t} href={`/console/approvals?type=${encodeURIComponent(t)}`} className={t === tab ? 'on' : ''}>{t} <span className="badge">{d.counts[t]}</span></Link>)}</div>
      <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th>Type</th><th>Source</th><th>Summary</th><th>Waiting</th><th /></tr></thead><tbody>
        {rows.length ? rows.map((x: Any) => (
          <tr key={x.key} className="click" onClick={() => openOverlay((close) => <ApprovalItem x={x} close={close} done={load} />)}>
            <td>{x.urgent ? <><span className="badge red">Urgent</span> </> : null}{x.type}</td><td className="small">{x.source}<br />{x.source_name || ''}</td>
            <td className="small">{x.summary}{x.notes.length ? <div className="muted">{x.notes.length} note(s)</div> : null}</td>
            <td className="small" style={x.late ? { color: 'var(--error-ink)', fontWeight: 600 } : undefined}>{x.waiting_days} working day(s)</td><td><button className="btn xs">Open</button></td>
          </tr>
        )) : <tr><td colSpan={5} className="empty">Nothing waiting for approval</td></tr>}</tbody></table></div></div>
      <p className="small muted">SLA {d.sla_days} working days (setting). Items over the SLA are red and listed in the 9:00 AM summary.</p>
    </>
  );
}
