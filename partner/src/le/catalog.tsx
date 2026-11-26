'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { GET, POST, SEND, ApiError, apiSrc, download, openFrom } from './api';
import { fmtDT, fmtDate, money, qs } from './format';
import { FormGrid, formModal, toFormData, Options, type Field, type Vals } from './form';
import { Modal, confirmBox, openOverlay, showError, toast } from './ui';
import { Page, useGo, useLoad, useQ, useMe, type Any } from './u';

/** The client's catalogue screens (legacy/public/university/js/catalog.js): UP05 profile, UP06 / UP07 courses, UP08 bulk upload, UP14 intakes and scholarships, UP13 announcements. */

const LANGS = ['English', 'French', 'German', 'Italian', 'Spanish', 'Dutch', 'Chinese', 'Other'];
const LEVELS = ['Bachelor', 'Master', 'MBA', 'PhD', 'Diploma', 'Foundation', 'Language course'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DEPTS = ['Admissions', 'International Office', 'Finance / Accounts', 'Scholarships', 'Accommodation', 'Visa / Immigration support', 'Marketing', 'Other'];
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** a list of small rows edited in place (rankings, English tests, intakes) */
function Rows({ rows, set, cols, add, blank = {} }: { rows: Row[]; set: (r: Row[]) => void; add: string; blank?: Row;
  cols: { k: string; placeholder?: string; type?: string; opts?: [string, string][] | string[]; width?: number; title?: string; check?: string; blank?: string }[] }) {
  const upd = (i: number, k: string, x: unknown) => set(rows.map((r, j) => (j === i ? { ...r, [k]: x } : r)));
  return (<>
    {rows.map((r, i) => (
      <div key={i} className="row mrow" style={{ gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        {cols.map((c) => c.check ? <label key={c.k} className="small row" style={{ gap: 3 }}><input type="checkbox" checked={!!r[c.k]} onChange={(e) => upd(i, c.k, e.target.checked)} />{c.check}</label>
          : c.opts ? <select key={c.k} className="input" style={{ width: c.width }} value={r[c.k] ?? ''} onChange={(e) => upd(i, c.k, e.target.value)}>{c.blank !== undefined ? <option value="">{c.blank}</option> : null}<Options list={c.opts as never} /></select>
          : <input key={c.k} className="input" type={c.type ?? 'text'} placeholder={c.placeholder} title={c.title} style={{ width: c.width }} step={c.type === 'number' ? 'any' : undefined} value={r[c.k] ?? ''} onChange={(e) => upd(i, c.k, e.target.value)} />)}
        <button type="button" className="btn xs ghost" onClick={() => set(rows.filter((_, j) => j !== i))}>✕</button>
      </div>))}
    <button type="button" className="btn xs" onClick={() => set([...rows, { ...blank }])}>{add}</button>
  </>);
}
const asRows = (x: unknown): Row[] => (Array.isArray(x) ? x : []);

// ---------- profile ----------
export function Profile() {
  const me = useMe((s) => s.me);
  const st = useLoad(() => GET('/profile'), []);
  return <Page state={st}>{() => { const d = st.data as Any; const L = d.live; const P = d.pending ? { ...L, ...d.pending.payload } : L;
    const showPending = () => openOverlay((close) => (
      <Modal title="Pending changes" size="lg" close={close}><table className="tbl"><thead><tr><th>Field</th><th>Current</th><th>Requested</th></tr></thead><tbody>
        {['name', 'short_name', 'city', 'uni_type', 'website', 'intl_page', 'about', 'founded_year', 'students_count', 'languages'].filter((k) => JSON.stringify(L[k] ?? null) !== JSON.stringify(d.pending.payload[k] ?? null))
          .map((k) => <tr key={k}><td>{k}</td><td className="small">{JSON.stringify(L[k] ?? '')}</td><td className="small"><b>{JSON.stringify(d.pending.payload[k] ?? '')}</b></td></tr>)}
      </tbody></table></Modal>));
    const withdraw = async (e: React.MouseEvent) => { e.preventDefault(); if (!(await confirmBox('Withdraw the pending changes?'))) return; await POST('/profile/request/withdraw'); st.reload(); };
    const campus = (c: Any | null) => formModal({ title: c ? 'Edit campus' : 'Add campus', saveLabel: 'Submit for approval', values: c ? { ...c } : { status: 'Active' },
      fields: [{ k: 'name', label: 'Campus name', req: true, maxlength: 150, col: 3 }, { k: 'city', label: 'City', req: true, col: 3 }, { k: 'address', label: 'Address', col: 6 }, { k: 'map_link', label: 'Map link', col: 6 },
        { k: 'status', label: 'Status', type: 'select', opts: ['Active', 'Inactive'], noBlank: true, help: 'Inactive campuses cannot be chosen on new courses.', col: 3 }, { k: 'is_main', label: 'Main campus', type: 'checkbox', col: 3 }],
      save: async (x) => { const r = await POST('/campuses', { ...x, is_main: !!x.is_main, id: c?._id ?? c?.id }); toast(r.message, 'ok'); return true; } });
    const contact = (c: Any | null) => formModal({ title: c ? 'Edit contact' : 'Add contact', values: c ? { ...c } : { department: DEPTS[0] },
      fields: [{ k: 'department', label: 'Department', req: true, type: 'select', opts: DEPTS, noBlank: true, col: 3 }, { k: 'name', label: 'Name', req: true, col: 3 }, { k: 'designation', label: 'Designation', col: 3 },
        { k: 'email', label: 'Email', req: true, type: 'email', col: 3 }, { k: 'phone', label: 'Phone', col: 3 }, { k: 'is_primary', label: 'Primary for this department', type: 'checkbox', col: 3 }],
      extraButtons: c ? (doSave) => <button className="btn danger" type="button" onClick={async () => { if (await confirmBox('Delete this contact?', { danger: true, ok: 'Delete' })) doSave({ delete: true }); }}>Delete</button> : undefined,
      save: async (x) => { await POST('/contacts', { ...x, is_primary: !!x.is_primary, id: c?._id ?? c?.id }); st.reload(); return true; } });
    const canContacts = d.can_edit_contacts && !me?.preview;
    return (<>
      <div className="page-head"><h1>University profile</h1><span className="grow" />{d.can_edit ? <button className="btn primary" onClick={() => editProfile(P, st.reload)}>Edit profile</button> : null}</div>
      {d.pending ? <div className="banner warn">Changes waiting for La Europa approval (sent {fmtDate(d.pending.created_at)}). Students keep seeing the current profile. <a href="#" onClick={(e) => { e.preventDefault(); showPending(); }}>View pending changes</a>{d.can_edit ? <> · <a href="#" onClick={withdraw}>Withdraw</a></> : null}</div> : null}
      {d.last_decision?.status === 'Rejected' ? <div className="banner err">Last change request was rejected: {d.last_decision.review_note || ''}</div> : null}
      <div className="grid two">
        <div className="card"><div className="bd">
          <div className="row" style={{ gap: 14 }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img className="cs-logo lg" src={apiSrc(L.logo)} alt="" />
            <div><h2 style={{ margin: 0 }}>{L.name}</h2><div className="muted">{L.short_name || ''} · {L.city || ''}, {L.country} · {L.uni_type || ''}</div>{L.website ? <a href={L.website} target="_blank" rel="noopener noreferrer">{L.website}</a> : null}</div></div>
          {/* the about text is sanitised by the server (bold, italic, lists, https links only) */}
          <div className="about" style={{ marginTop: 12 }}>{L.about ? <span dangerouslySetInnerHTML={{ __html: L.about }} /> : <span className="muted">No description yet</span>}</div>
          <div className="kv" style={{ marginTop: 12 }}><div><div className="k">Founded</div><div className="v">{L.founded_year || '-'}</div></div><div><div className="k">Students</div><div className="v">{L.students_count || '-'}</div></div><div><div className="k">Languages</div><div className="v">{(L.languages || []).join(', ') || '-'}</div></div></div>
          {(L.rankings || []).length ? <><h3>Rankings <span className="small muted">(information provided by the university)</span></h3><ul>{L.rankings.map((x: Any, i: number) => <li key={i}>{x.name} {x.year || ''}: {x.rank || ''}</li>)}</ul></> : null}
          {(L.accreditations || []).length ? <><h3>Accreditations <span className="small muted">(information provided by the university)</span></h3><ul>{L.accreditations.map((x: Any, i: number) => <li key={i}>{x.name}{x.body ? ', ' + x.body : ''}</li>)}</ul></> : null}
          <p className="small muted">Students see the approved name, logo, city, country, type, website, about, languages, rankings and accreditations. Contacts are never shown to students.</p>
        </div></div>
        <div className="grid" style={{ gap: 14 }}>
          <div className="card"><div className="hd"><h2>Campuses</h2><span className="grow" />{d.can_edit ? <button className="btn sm" onClick={() => campus(null)}>+ Add campus</button> : null}</div><div className="bd flush">
            {d.campuses.length ? d.campuses.map((c: Any) => <div key={c._id} className="rowx"><div className="grow"><b>{c.name}</b> {c.is_main ? <span className="badge blue">Main</span> : null} {c.status === 'Inactive' ? <span className="badge grey">Inactive</span> : null}
              <div className="small muted">{c.city}{c.address ? ', ' + c.address : ''}</div></div>{d.can_edit ? <button className="btn xs" onClick={() => campus(c)}>Edit</button> : null}</div>) : <div className="empty">No campus yet</div>}</div></div>
          <div className="card"><div className="hd"><h2>Contacts by department</h2><span className="grow" />{canContacts ? <button className="btn sm" onClick={() => contact(null)}>+ Add contact</button> : null}</div><div className="bd flush">
            {d.contacts.length ? d.contacts.map((c: Any) => <div key={c._id} className="rowx"><div className="grow"><b>{c.department}</b> {c.is_primary ? <span className="badge green">Primary</span> : null}
              <div className="small">{c.name}{c.designation ? ', ' + c.designation : ''} · {c.email}{c.phone ? ' · ' + c.phone : ''}</div></div>{canContacts ? <button className="btn xs" onClick={() => contact(c)}>Edit</button> : null}</div>)
              : <div className="empty">No contacts yet. The Finance / Accounts contact receives invoices.</div>}</div>
            <div className="bd small muted">Contact changes go live at once (La Europa is informed). Profile and campus changes need La Europa approval.</div></div>
        </div>
      </div>
    </>); }}</Page>;
}
function editProfile(P: Any, reload: () => void) {
  const RANK = [{ k: 'name', placeholder: 'Ranking name' }, { k: 'year', placeholder: 'Year' }, { k: 'rank', placeholder: 'Rank or band' }, { k: 'link', placeholder: 'Source link (https://)' }];
  const ACC = [{ k: 'name', placeholder: 'Accreditation' }, { k: 'body', placeholder: 'Body' }, { k: 'valid_until', placeholder: 'Valid until' }, { k: 'link', placeholder: 'Link (https://)' }];
  const fields: Field[] = [
    { k: 'name', label: 'University name', req: true, maxlength: 200, help: 'Official name. Change needs approval.', col: 3 }, { k: 'short_name', label: 'Short name', maxlength: 30, col: 1 },
    { k: 'uni_type', label: 'Type', req: true, type: 'select', opts: ['Public', 'Private'], col: 1 }, { k: 'city', label: 'Main city', req: true, col: 1 },
    { k: 'website', label: 'Website', req: true, help: 'https:// only', col: 3 }, { k: 'intl_page', label: 'International admissions page', col: 3 },
    { k: 'about', label: 'About the university (100 to 3000 characters; bold, italic, bullets, links only)', req: true, type: 'textarea', rows: 7, help: 'You can use <b>, <i>, <ul><li> and <a href="https://...">. No images or scripts.', col: 6 },
    { k: 'founded_year', label: 'Year founded', type: 'number', col: 2 }, { k: 'students_count', label: 'Number of students', type: 'number', col: 2 },
    { k: 'languages', label: 'Languages of instruction', type: 'multi', opts: LANGS, col: 2 },
    { k: 'rankings', type: 'html', html: (v, set) => <><label>Rankings (shown &quot;as provided by the university&quot;)</label><Rows rows={asRows(v.rankings)} set={(r) => set('rankings', r)} cols={RANK} add="+ Add" /></> },
    { k: 'accreditations', type: 'html', html: (v, set) => <><label>Accreditations</label><Rows rows={asRows(v.accreditations)} set={(r) => set('accreditations', r)} cols={ACC} add="+ Add" /></> },
    { k: 'logo', label: 'Logo (PNG / JPG, min 200 x 200 px, max 2 MB)', type: 'file', accept: '.png,.jpg,.jpeg', help: 'Preview below shows the course card as students will see it.', col: 3 },
    { k: 'cover', label: 'Cover image (JPG / PNG, max 3 MB)', type: 'file', accept: '.png,.jpg,.jpeg', col: 3 },
    { k: 'preview', type: 'html', html: (v) => { const f = Array.isArray(v.logo) && v.logo[0] ? URL.createObjectURL(v.logo[0]) : apiSrc(P.logo); return (<><div className="small muted">Preview of a course card:</div>
      <div className="ccard" style={{ maxWidth: 380, marginTop: 6 }}><div className="ccard-hd">{/* eslint-disable-next-line @next/next/no-img-element */}<img className="ccard-logo" src={f} alt="" /><div className="ccard-uni">{v.name}<small>{v.city}</small></div><span className="ccard-country">{P.country}</span></div><h3 className="ccard-title">Sample course (Master)</h3></div></>); } },
  ];
  return formModal({ title: 'Edit university profile', size: 'xl', saveLabel: 'Submit for approval', fields,
    values: { ...P, languages: P.languages || [], rankings: P.rankings || [], accreditations: P.accreditations || [], logo: undefined, cover: undefined },
    save: async (x) => {
      const take = (l: unknown) => asRows(l).map((r) => Object.fromEntries(Object.entries(r).map(([k, y]) => [k, String(y ?? '').trim()]))).filter((r) => r.name);
      const payload = { name: x.name, short_name: x.short_name, uni_type: x.uni_type, city: x.city, website: x.website, intl_page: x.intl_page, about: x.about, founded_year: x.founded_year || null,
        students_count: x.students_count || null, languages: x.languages || [], rankings: take(x.rankings), accreditations: take(x.accreditations), social: P.social || [] };
      const fd = new FormData(); fd.append('payload', JSON.stringify(payload));
      if (Array.isArray(x.logo) && x.logo[0]) fd.append('logo', x.logo[0]); if (Array.isArray(x.cover) && x.cover[0]) fd.append('cover', x.cover[0]);
      const r = await SEND('post', '/profile/request', fd); toast(r.message, 'ok'); reload(); return true;
    } });
}

// ---------- courses ----------
export function Courses() {
  const q = useQ(); const go = useGo();
  const st = useLoad(() => GET('/courses' + qs(q)), [JSON.stringify(q)]);
  const [search, setSearch] = useState(q.q || '');
  const setQ = (p: Record<string, unknown>) => go('/courses' + qs({ ...q, ...p }));
  return <Page state={st}>{() => { const d = st.data as Any; const o = d.options;
    return (<>
      <div className="page-head"><h1>Courses</h1><span className="muted small">{d.rows.length} course(s) · one catalogue shared with La Europa&apos;s course search</span><span className="grow" />
        {d.can_propose ? <><Link className="btn primary" href="/courses/new">+ Add course</Link><Link className="btn" href="/bulk">Bulk upload</Link></> : null}
        <button className="btn" onClick={() => download('/courses-template.xlsx?data=1', 'my-courses.xlsx').catch(showError)}>Download all courses (Excel)</button></div>
      <div className="banner">Every change is approved by La Europa before students see it. Fees show the amount only: words like non-EU, international or foreign are not allowed.</div>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setQ({ q: search }); }}>
        <input type="search" placeholder="Course name or code" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={q.level || ''} onChange={(e) => setQ({ level: e.target.value })}><option value="">All levels</option><Options list={o.levels} /></select>
        <select value={q.field || ''} onChange={(e) => setQ({ field: e.target.value })}><option value="">All fields</option><Options list={o.fields} /></select>
        {o.campuses.length > 1 ? <select value={q.campus || ''} onChange={(e) => setQ({ campus: e.target.value })}><option value="">All campuses</option><Options list={o.campuses} /></select> : null}
        <select value={q.uni_status || ''} onChange={(e) => setQ({ uni_status: e.target.value })}><option value="">Active + closed</option><Options list={['Active', 'Closed']} /></select>
        <select value={q.catalogue_status || ''} onChange={(e) => setQ({ catalogue_status: e.target.value })}><option value="">Any catalogue status</option><Options list={['Live', 'Pending approval', 'Draft', 'Closed', 'Archived']} /></select>
        <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={!!q.pending} onChange={(e) => setQ({ pending: e.target.checked ? '1' : '' })} /> Has pending change</label>
      </form>
      {d.new_pending.length ? <div className="card" style={{ marginBottom: 12 }}><div className="hd"><h2>New courses waiting for approval</h2></div><div className="bd small">
        {d.new_pending.map((x: Any) => <div key={x.id}>{x.name} · {x.status} · {fmtDate(x.created_at)} <a href="#" onClick={async (e) => { e.preventDefault(); await POST(`/courses/requests/${x.id}/withdraw`); st.reload(); }}>withdraw</a></div>)}</div></div> : null}
      <div className="card"><div className="table-wrap"><table className="tbl"><thead><tr><th>Code</th><th>Course</th><th>Level</th><th>Field</th><th>Campus</th><th>Intakes</th><th>Tuition / year</th><th>University</th><th>Catalogue</th><th>Last approved</th><th /></tr></thead><tbody>
        {d.rows.length ? d.rows.map((c: Any) => (
          <tr key={c.id}><td data-label="Code" className="small">{c.code || '-'}</td><td data-label="Course"><b>{c.name}</b>{c.university_course_code ? <div className="small muted">{c.university_course_code}</div> : null}</td>
            <td data-label="Level">{c.level}</td><td data-label="Field" className="small">{c.field || ''}</td><td data-label="Campus" className="small">{c.campus || '-'}</td>
            <td data-label="Intakes">{c.intakes.map((i: Any) => <span key={i.id} className={`chip ${i.open ? 'open' : 'closed'}`}>{i.label}</span>)}</td>
            <td data-label="Tuition">{c.tuition_fee === 0 ? 'Free' : money(c.tuition_fee, c.currency)}</td>
            <td data-label="Univ. status">{c.uni_status === 'Closed' ? <span className="badge grey">Closed</span> : <span className="badge green">Active</span>}</td>
            <td data-label="Catalogue"><span className={`badge ${c.catalogue_status === 'Live' ? 'green' : c.catalogue_status === 'Pending approval' ? 'orange' : 'grey'}`}>{c.catalogue_status}</span></td>
            <td data-label="Approved" className="small">{fmtDate(c.last_approved_on)}</td>
            <td className="nowrap">{c.pending ? <><a href="#" className="small" onClick={async (e) => { e.preventDefault(); try { diffModal(await GET('/courses/requests/' + c.pending.id)); } catch (er) { showError(er); } }}>View change</a> </> : null}
              {d.can_propose ? <Link className="btn xs" href={`/courses/${c.id}`}>Edit</Link> : null}</td></tr>)) : <tr><td colSpan={11} className="empty">No courses yet</td></tr>}
      </tbody></table></div></div>
      <div className="card" style={{ marginTop: 12 }}><div className="hd"><h2>Recent change requests</h2></div><div className="table-wrap"><table className="tbl"><thead><tr><th>Sent</th><th>Change</th><th>Course</th><th>Status</th><th>La Europa note</th></tr></thead><tbody>
        {d.requests.length ? d.requests.slice(0, 20).map((x: Any) => <tr key={x.id}><td className="small">{fmtDate(x.created_at)}</td><td>{x.change_type}{x.urgent ? <> <span className="badge red">Urgent</span></> : null}</td><td>{x.course || ''}</td>
          <td><span className={`badge ${/Approved/.test(x.status) ? 'green' : x.status === 'Rejected' ? 'red' : 'orange'}`}>{x.status}</span></td><td className="small">{x.review_note || ''}</td></tr>) : <tr><td colSpan={5} className="empty">None</td></tr>}
      </tbody></table></div></div>
    </>); }}</Page>;
}
const show = (x: unknown) => (typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x ?? ''));
function diffModal(x: Any) {
  const keys = Object.keys(x.payload).filter((k) => !['english', 'intakes'].includes(k));
  const old = x.old || {};
  openOverlay((close) => (
    <Modal title={`${x.change_type}: ${x.status}`} size="lg" close={close}><table className="tbl"><thead><tr><th>Field</th><th>Current</th><th>Requested</th></tr></thead><tbody>
      {keys.map((k) => { const ov = old[k] ?? old.academic?.[k]; const ch = JSON.stringify(ov ?? null) !== JSON.stringify(x.payload[k] ?? null);
        return <tr key={k} className={ch ? 'row-info' : ''}><td>{k}</td><td className="small">{show(ov)}</td><td className="small">{ch ? <b>{show(x.payload[k])}</b> : show(x.payload[k])}</td></tr>; })}
      <tr><td>intakes</td><td className="small">{(old.intakes || []).map((i: Any) => `${i.label}: ${i.deadline} ${i.status}`).join('; ')}</td><td className="small">{(x.payload.intakes || []).map((i: Any) => `${i.month}/${i.year}: ${i.deadline} ${i.status}`).join('; ')}</td></tr>
      <tr><td>english</td><td className="small">{(old.english || []).map((e: Any) => `${e.test_type} ${e.min_overall}`).join('; ')}</td><td className="small">{(x.payload.english || []).map((e: Any) => `${e.test_type} ${e.min_overall}`).join('; ')}{x.payload.moi_accepted ? ' + MOI' : ''}</td></tr>
    </tbody></table></Modal>));
}

export function CourseForm({ id }: { id: string | null }) {
  const go = useGo();
  const st = useLoad(async () => { const [opts, c] = await Promise.all([GET('/courses'), id ? GET('/courses/' + id) : Promise.resolve(null)]); return { o: opts.options, c }; }, [id]);
  const [v, setV] = useState<Vals | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({}); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!st.data || v) return;
    const { c } = st.data as Any; const ac = c?.academic || {};
    setV({ name: c?.name ?? '', level: c?.level ?? 'Master', course_link: c?.course_link ?? '', tuition_fee: c?.tuition_fee ?? '', currency: c?.currency || 'EUR', application_fee: c ? c.application_fee : 0, application_fee_currency: c?.application_fee_currency || 'EUR',
      fee_note: c?.fee_note ?? '', required_level: ac.required_level || 'Bachelor', min_percent: ac.min_percent ?? '', academic_note: ac.note ?? '', moi_accepted: c ? c.english.some((e: Any) => e.moi_accepted) : false,
      min_12th_english_percent: c?.english?.[0]?.min_12th_english_percent ?? '', field_of_study_id: c?.field_of_study_id ?? '', campus_id: c?.campus_id ?? '', duration_months: c?.duration_months ?? '', language: c?.language || 'English',
      uni_status: c?.uni_status || 'Active', university_course_code: c?.university_course_code ?? '', entrance_test: ac.entrance_test || 'None', min_work_months: ac.min_work_months ?? '', seats_for_le: c?.seats_for_le ?? '',
      description: c?.description ?? '', note_for_le: c?.note_for_le ?? '',
      english: c?.english?.filter((e: Any) => e.test_type).length ? c.english.filter((e: Any) => e.test_type) : [{ test_type: 'IELTS Academic' }],
      intakes: c?.intakes?.length ? c.intakes.map((i: Any) => ({ ...i, month: String(i.month || 9) })) : [{ month: '9', year: new Date().getFullYear() + 1, status: 'Open' }] });
  }, [st.data, v]);
  return <Page state={st}>{() => { if (!v) return null; const { o, c } = st.data as Any;
    const cur = o.currencies.length ? o.currencies : ['EUR', 'CNY', 'USD'];
    const set = (k: string, x: unknown) => setV((s) => ({ ...s!, [k]: x }));
    const f1: Field[] = [{ k: 'name', label: 'Course name (exactly as on your website)', req: true, maxlength: 200, col: 4 }, { k: 'level', label: 'Level', req: true, type: 'select', opts: o.levels, noBlank: true, col: 2 },
      { k: 'course_link', label: 'Course link', req: true, help: 'https:// only. We check that it opens.', col: 6 },
      { k: 'tuition_fee', label: 'Tuition fee (per year)', req: true, type: 'number', min: 0, step: 0.01, help: 'One amount per year. 0 allowed.', col: 2 }, { k: 'currency', label: 'Currency', type: 'select', opts: cur, noBlank: true, col: 1 },
      { k: 'application_fee', label: 'Application fee', req: true, type: 'number', min: 0, step: 0.01, help: '0 = free application', col: 2 }, { k: 'application_fee_currency', label: 'Currency', type: 'select', opts: cur, noBlank: true, col: 1 },
      { k: 'fee_note', label: 'Fee note', maxlength: 200, help: 'For example "Semester contribution of EUR 300 also applies". Amounts only.', col: 6 },
      { k: 'required_level', label: 'Academic requirement: previous level', req: true, type: 'select', opts: ['12th', 'Diploma', 'Bachelor', 'Master'], noBlank: true, col: 3 },
      { k: 'min_percent', label: 'Minimum percentage', req: true, type: 'number', min: 0, max: 100, step: 0.5, help: 'Percentage only (0 to 100). If you accept by grade, enter the equivalent percentage for Indian students.', col: 3 },
      { k: 'academic_note', label: 'Academic requirement note', maxlength: 300, col: 6 },
      { k: 'english', type: 'html', html: (x) => <><label>English proficiency (at least one test, or MOI accepted)<span className="req">*</span></label>
        <Rows rows={asRows(x.english)} set={(r) => set('english', r)} add="+ Add test" blank={{ test_type: o.tests[0] }}
          cols={[{ k: 'test_type', opts: o.tests, width: 160 }, { k: 'min_overall', type: 'number', placeholder: 'Min overall', width: 120 }, { k: 'min_band', type: 'number', placeholder: 'Min band (optional)', width: 150 }]} />
        {errors.english ? <div className="msg" style={{ color: 'var(--error)' }}>{errors.english}</div> : null}</> },
      { k: 'moi_accepted', label: 'MOI accepted instead of a test', type: 'checkbox', col: 3 }, { k: 'min_12th_english_percent', label: '12th English marks waiver: minimum %', type: 'number', min: 0, max: 100, col: 3 }];
    const f2: Field[] = [{ k: 'field_of_study_id', label: 'Field of study', req: true, type: 'select', opts: o.fields, col: 3 },
      { k: 'campus_id', label: 'Campus', req: true, type: 'select', opts: o.campuses.filter((x: Any) => x.status === 'Active' || x.id === c?.campus_id).map((x: Any) => [x.id, `${x.name} (${x.city})`]), help: o.campuses.length ? '' : 'Add a campus in Profile first.', col: 3 },
      { k: 'duration_months', label: 'Duration (months)', req: true, type: 'number', min: 1, max: 96, col: 2 }, { k: 'language', label: 'Language of instruction', req: true, type: 'select', opts: o.languages, noBlank: true, col: 2 },
      { k: 'uni_status', label: 'University status', req: true, type: 'select', opts: ['Active', 'Closed'], noBlank: true, help: 'Closed = no new applications for any intake.', col: 2 },
      { k: 'intakes', type: 'html', html: (x) => <><label>Intakes (deadline required)<span className="req">*</span></label>
        <Rows rows={asRows(x.intakes)} set={(r) => set('intakes', r)} add="+ Add intake" blank={{ month: '9', year: new Date().getFullYear() + 1, status: 'Open' }}
          cols={[{ k: 'month', opts: MON.map((m, i) => [String(i + 1), m] as [string, string]), width: 90 }, { k: 'year', type: 'number', placeholder: 'Year', width: 90 }, { k: 'every_year', check: 'every year' },
            { k: 'open_date', type: 'date', title: 'Application open date', width: 150 }, { k: 'deadline', type: 'date', title: 'Application deadline', width: 150 }, { k: 'deadline_note', placeholder: 'Deadline note (e.g. Round 1)', width: 170 },
            { k: 'status', opts: ['Open', 'Closed'], width: 100 }, { k: 'closed_reason', opts: ['Seats full', 'Deadline passed', 'Course not running this intake', 'Other'], blank: 'Closed reason', width: 180 }]} />
        {errors.intakes ? <div className="msg" style={{ color: 'var(--error)' }}>{errors.intakes}</div> : null}</> },
      { k: 'university_course_code', label: 'Your course code', maxlength: 50, help: 'Used to match rows in bulk upload.', col: 3 },
      { k: 'entrance_test', label: 'Entrance test', type: 'select', opts: ['None', 'GMAT', 'GRE', 'SAT', 'University test', 'Other'], noBlank: true, col: 3 },
      { k: 'min_work_months', label: 'Minimum work experience (months)', type: 'number', min: 0, col: 3 }, { k: 'seats_for_le', label: 'Seats for La Europa students', type: 'number', min: 0, help: 'Internal, never shown to students.', col: 3 },
      { k: 'description', label: 'Short description', type: 'textarea', rows: 4, maxlength: 1500, col: 6 }, { k: 'note_for_le', label: 'Note for La Europa', type: 'textarea', rows: 2, maxlength: 1000, help: 'Visible to La Europa staff only.', col: 6 }];
    const submit = async (draft: boolean) => {
      setBusy(true); setErr(''); setErrors({});
      const b: Vals = { ...v, id: c?.id, draft, english: asRows(v.english).filter((e) => e.min_overall !== '' && e.min_overall !== undefined && e.min_overall !== null) };
      try { const r = await POST('/courses', b); if (r.warnings?.length) toast(r.warnings.join(' ')); toast(r.message, 'ok'); go('/courses'); }
      catch (e) { const d = (e as ApiError).data ?? {}; setErr((e as Error).message + (Array.isArray(d.warnings) && d.warnings.length ? ' ' + d.warnings.join(' ') : '')); setErrors((d.errors as Record<string, string>) ?? {}); }
      finally { setBusy(false); }
    };
    return (<>
      <div className="page-head"><Link className="btn ghost sm" href="/courses">← Courses</Link><h1>{c ? 'Edit course' : 'Add course'}</h1>{c?.pending ? <span className="badge orange">A change is already pending: your edits update it</span> : null}</div>
      <form className="card" noValidate onSubmit={(e) => e.preventDefault()}><div className="bd">
        <h2>Shown in La Europa course search</h2><FormGrid fields={f1} vals={v} set={set} errors={errors} />
        <h2 style={{ marginTop: 18 }}>Course details</h2><FormGrid fields={f2} vals={v} set={set} errors={errors} />
        {err ? <div className="err-box" style={{ marginTop: 10 }}>{err}</div> : null}
        <div className="form-actions"><button type="button" className="btn" disabled={busy} onClick={() => submit(true)}>Save as draft</button><button type="button" className="btn primary" disabled={busy} onClick={() => submit(false)}>Submit for approval</button></div>
      </div></form>
    </>); }}</Page>;
}

// ---------- bulk upload ----------
export function Bulk() {
  const go = useGo();
  const [file, setFile] = useState<File | null>(null); const [r, setR] = useState<Any | null>(null); const [err, setErr] = useState('');
  const send = (mode: string) => { const fd = new FormData(); fd.append('file', file!); return SEND('post', `/courses/bulk/${mode}`, fd); };
  useEffect(() => { if (!file) return; setErr(''); setR(null); send('preview').then(setR).catch((e) => setErr((e as Error).message)); }, [file]); // eslint-disable-line react-hooks/exhaustive-deps
  return (<>
    <div className="page-head"><Link className="btn ghost sm" href="/courses">← Courses</Link><h1>Bulk course upload</h1></div>
    <div className="card"><div className="bd">
      <ol className="small"><li>Download the template (sheets Courses, Intakes, English and Help with allowed values), or download your current courses to edit.</li><li>Fill it in. Max 1000 course rows and 5 MB.</li>
        <li>Upload and check the preview: New, Update, No change, Error.</li><li>Submit valid rows for La Europa approval. Error rows are not submitted.</li></ol>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => download('/courses-template.xlsx', 'course-upload-template.xlsx').catch(showError)}>Download template</button>
        <button className="btn" onClick={() => download('/courses-template.xlsx?data=1', 'my-courses.xlsx').catch(showError)}>Download my courses</button>
        <label className="btn primary">Upload file (.xlsx / .csv)<input type="file" accept=".xlsx,.csv" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label><span className="small muted">{file?.name}</span></div>
      <div style={{ marginTop: 14 }}>
        {err ? <div className="err-box">{err}</div> : null}
        {r ? <>
          <div className="row" style={{ gap: 6, marginBottom: 8 }}>{Object.entries(r.counts as Record<string, number>).map(([k, n]) => <span key={k} className={`badge ${k === 'Error' ? 'red' : k === 'New' ? 'green' : k === 'Update' ? 'blue' : 'grey'}`}>{k}: {n}</span>)}<span className="grow" />
            {r.counts.Error ? <button className="btn sm" onClick={() => download('/courses/bulk-errors.xlsx', 'upload-errors.xlsx', { rows: r.rows }).catch(showError)}>Download error rows</button> : null}
            <button className="btn sm primary" disabled={!((r.counts.New || 0) + (r.counts.Update || 0))} onClick={async () => { try { const x = await send('submit'); toast(`Submitted ${(x.counts.New || 0) + (x.counts.Update || 0)} change(s) for La Europa approval`, 'ok'); go('/courses'); } catch (e) { showError(e); } }}>Submit for approval</button></div>
          <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}><table className="tbl"><thead><tr><th>Row</th><th>Course</th><th>Result</th><th>Reason / warning</th></tr></thead><tbody>
            {r.rows.map((x: Any, i: number) => <tr key={i} className={x.status === 'Error' ? 'row-danger' : ''}><td>{x.row}</td><td>{x.course}</td><td>{x.status}</td><td className="small">{x.reason || (x.warnings || []).join(' ')}</td></tr>)}</tbody></table></div>
        </> : null}
      </div>
    </div></div>
  </>);
}

// ---------- intakes and scholarships ----------
export function Intakes() {
  const st = useLoad(async () => { const [d, s] = await Promise.all([GET('/intakes'), GET('/scholarships')]); return { d, s }; }, []);
  const [sel, setSel] = useState<Set<string>>(new Set());
  return <Page state={st}>{() => { const { d, s } = st.data as Any;
    const bulkAct = (action: 'deadline' | 'close') => formModal({ title: action === 'deadline' ? 'Set a new deadline' : 'Close intake', size: 'sm', saveLabel: 'Submit for approval',
      values: { closed_reason: 'Seats full' },
      fields: action === 'deadline' ? [{ k: 'deadline', label: 'New deadline', type: 'date', col: 6 }] : [{ k: 'closed_reason', label: 'Closed reason', type: 'select', opts: ['Seats full', 'Deadline passed', 'Course not running this intake', 'Other'], noBlank: true, col: 6 }],
      save: async (x) => {
        const groups: Record<string, string[]> = {}; for (const k of sel) { const [cid, ik] = k.split('|'); (groups[ik] = groups[ik] || []).push(cid); }
        let n = 0;
        for (const [ik, ids] of Object.entries(groups)) n += (await POST('/intakes/bulk', { course_ids: ids, intake_key: ik, action, deadline: action === 'deadline' ? x.deadline : undefined, closed_reason: action === 'close' ? x.closed_reason : undefined })).count;
        toast(`${n} change(s) sent for approval`, 'ok'); setSel(new Set()); st.reload(); return true;
      } });
    const sch = (x: Any | null) => { const ap = x ? x.applies : { scope: 'all' };
      return formModal({ title: x ? 'Edit scholarship' : 'Add scholarship', size: 'lg', saveLabel: 'Submit for approval',
        values: { ...(x ?? {}), currency: x?.currency || 'EUR', scope: ap.scope || 'all', levels: ap.levels || [], courses: ap.courses || [] },
        fields: [{ k: 'name', label: 'Scholarship name', req: true, maxlength: 150, col: 6 }, { k: 'description', label: 'Description', req: true, type: 'textarea', maxlength: 2000, col: 6 },
          { k: 'benefit_type', label: 'Benefit type', req: true, type: 'select', opts: s.benefit_types, col: 2 }, { k: 'amount', label: 'Amount', type: 'number', min: 0, help: 'Amount only', col: 2 },
          { k: 'currency', label: 'Currency', type: 'select', opts: ['EUR', 'USD', 'GBP', 'CNY', 'SEK', 'CHF'], noBlank: true, col: 1 }, { k: 'percent', label: '% of tuition', type: 'number', min: 1, max: 100, col: 1 },
          { k: 'min_percent', label: 'Eligibility: minimum academic %', type: 'number', min: 0, max: 100, col: 2 }, { k: 'other_criteria', label: 'Other criteria', maxlength: 1000, col: 4 },
          { k: 'scope', label: 'Applies to', req: true, type: 'select', opts: [['all', 'All courses'], ['levels', 'Selected levels'], ['courses', 'Selected courses']], noBlank: true, col: 2 },
          { k: 'levels', label: 'Levels', type: 'multi', opts: LEVELS, col: 4 }, { k: 'courses', label: 'Courses', type: 'multi', opts: s.courses.map((c: Any) => [c.id, `${c.name} (${c.level})`]), col: 6 },
          { k: 'deadline', label: 'Scholarship deadline', type: 'date', col: 2 }, { k: 'valid_until', label: 'Valid until', type: 'date', col: 2 },
          { k: 'how_apply', label: 'How the student applies', req: true, type: 'select', opts: s.how_apply, help: 'Students always apply through La Europa.', col: 2 }, { k: 'link', label: 'Official link', col: 6 }],
        save: async (b) => { const r = await POST('/scholarships', { ...b, id: x?._id }); toast(r.message, 'ok'); st.reload(); return true; } }); };
    return (<>
      <div className="page-head"><h1>Intakes, deadlines and scholarships</h1></div>
      <div className="card"><div className="hd"><h2>Intake calendar</h2><span className="grow" />{d.can_propose ? <><button className="btn sm" disabled={!sel.size} onClick={() => bulkAct('deadline')}>Set deadline</button><button className="btn sm" disabled={!sel.size} onClick={() => bulkAct('close')}>Close intake</button></> : null}</div>
        <div className="table-wrap"><table className="tbl"><thead><tr>{d.can_propose ? <th /> : null}<th>Course</th><th>Level</th><th>Intake</th><th>Opens</th><th>Deadline</th><th>Status</th><th /></tr></thead><tbody>
          {d.rows.length ? d.rows.map((r: Any) => { const k = `${r.course_id}|${r.intake_key}`; return (
            <tr key={k}>{d.can_propose ? <td><input type="checkbox" checked={sel.has(k)} onChange={(e) => setSel((x) => { const n = new Set(x); if (e.target.checked) n.add(k); else n.delete(k); return n; })} /></td> : null}
              <td>{r.course}</td><td>{r.level}</td><td>{r.intake}</td><td className="small">{fmtDate(r.open_date)}</td><td><b>{fmtDate(r.deadline)}</b></td>
              <td><span className={`badge ${r.status === 'Open' ? 'green' : 'grey'}`}>{r.status}</span></td><td>{r.pending ? <span className="badge orange">Pending change</span> : null}</td></tr>); })
            : <tr><td colSpan={8} className="empty">No intakes yet</td></tr>}</tbody></table></div>
        <div className="bd small muted">Moving a deadline earlier or closing an intake is urgent for La Europa. After approval, counsellors of affected students are told and the course search shows the new deadline.</div></div>
      <div className="card" style={{ marginTop: 14 }}><div className="hd"><h2>Scholarships</h2><span className="grow" />{s.can_propose ? <button className="btn sm primary" onClick={() => sch(null)}>+ Add scholarship</button> : null}</div>
        <div className="table-wrap"><table className="tbl"><thead><tr><th>ID</th><th>Name</th><th>Benefit</th><th>Applies to</th><th>Deadline</th><th>Status</th><th /></tr></thead><tbody>
          {s.rows.length ? s.rows.map((x: Any) => <tr key={x._id}><td className="small">{x.code}</td><td><b>{x.name}</b></td>
            <td>{x.benefit_type === 'Fixed amount' ? money(x.amount, x.currency) : x.benefit_type === 'Percentage of tuition' ? x.percent + '% of tuition' : x.benefit_type}</td>
            <td className="small">{!x.applies?.scope || x.applies.scope === 'all' ? 'All courses' : x.applies.scope === 'levels' ? (x.applies.levels || []).join(', ') : (x.applies.courses || []).length + ' course(s)'}</td>
            <td>{fmtDate(x.deadline)}</td><td><span className={`badge ${x.status === 'Live' ? 'green' : 'grey'}`}>{x.status}</span></td><td>{s.can_propose ? <button className="btn xs" onClick={() => sch(x)}>Edit</button> : null}</td></tr>)
            : <tr><td colSpan={7} className="empty">No scholarships yet</td></tr>}</tbody></table></div>
        {s.requests.length ? <div className="bd small"><b>Requests:</b> {s.requests.slice(0, 10).map((x: Any) => `${x.name} (${x.status}${x.review_note ? ': ' + x.review_note : ''})`).join(' · ')}</div> : null}
        <div className="bd small muted">Shown to students as: &quot;Scholarships are decided by the university. Your counsellor will tell you if you can apply.&quot;</div></div>
    </>); }}</Page>;
}

// ---------- announcements ----------
export function Announcements() {
  const st = useLoad(() => GET('/announcements'), []);
  return <Page state={st}>{() => { const d = st.data as Any;
    const post = () => formModal({ title: 'New announcement', size: 'lg', saveLabel: 'Post to La Europa', values: { type: d.types[0], related: [] },
      fields: [{ k: 'type', label: 'Type', req: true, type: 'select', opts: d.types, noBlank: true, col: 3 }, { k: 'valid_until', label: 'Valid until', type: 'date', col: 3 },
        { k: 'title', label: 'Title', req: true, maxlength: 150, col: 6 }, { k: 'body', label: 'Message', req: true, type: 'textarea', rows: 5, maxlength: 5000, help: 'Fee amounts only, no category words.', col: 6 },
        { k: 'related', label: 'Related courses', type: 'multi', opts: d.courses.map((c: Any) => [c.id, c.name]), col: 6 },
        { k: 'files', label: 'Attachments (up to 5, 10 MB each)', type: 'file', multiple: true, accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xlsx,.csv', col: 4 }, { k: 'important', label: 'Important', type: 'checkbox', col: 2 }],
      save: async (x) => { await SEND('post', '/announcements', toFormData({ ...x, important: !!x.important, related: JSON.stringify(x.related || []) })); toast('Posted to La Europa', 'ok'); st.reload(); return true; } });
    return (<>
      <div className="page-head"><h1>Announcements to La Europa</h1><span className="grow" />{d.can_post ? <button className="btn primary" onClick={post}>+ New announcement</button> : null}</div>
      <div className="banner">Announcements go to La Europa only, never directly to students. A deadline or fee in an announcement does not change the course search: use Courses or Intakes for that.</div>
      {d.notices.length ? <div className="card" style={{ marginBottom: 12 }}><div className="hd"><h2>Notices from La Europa</h2></div><div className="bd">
        {d.notices.map((n: Any) => <div key={n._id} className="rowx"><b>{n.title}</b><div className="small">{n.body || ''}</div><div className="small muted">{fmtDT(n.createdAt)}</div></div>)}</div></div> : null}
      <div className="card"><div className="bd flush">{d.rows.length ? d.rows.map((a: Any) => (
        <div key={a.id} className="rowx">
          <div className="row between"><b>{a.important ? '❗ ' : ''}{a.title}</b><span className={`badge ${a.status === 'Handled' ? 'green' : a.status === 'Seen by La Europa' ? 'blue' : 'grey'}`}>{a.status}</span></div>
          <div className="small muted">{a.type} · {fmtDT(a.createdAt)}{a.valid_until ? ' · valid until ' + fmtDate(a.valid_until) : ''}</div>
          <div className="small" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{a.body}</div>
          {a.attachments.map((x: Any) => <a key={x.id} className="small" href="#" onClick={(e) => { e.preventDefault(); openFrom(`/announcements/${a.id}/attachment/${x.id}`).catch(showError); }}>📎 {x.name} </a>)}
        </div>)) : <div className="empty">No announcements yet</div>}</div></div>
    </>); }}</Page>;
}
