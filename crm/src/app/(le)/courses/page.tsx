'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { GET, POST } from '@/le/api';
import { M } from '@/le/meta';
import { fmtDate, money, qs } from '@/le/format';
import { Options } from '@/le/form';
import { Modal, openOverlay, showError, toast } from '@/le/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const ELIG: Record<string, [string, string]> = { yes: ['Eligible', 'green'], maybe: ['Likely / close', 'orange'], no: ['Not eligible', 'red'], incomplete: ['Profile incomplete', 'grey'], unknown: ['No requirements', 'grey'] };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const days = (n?: number | null) => (n === null || n === undefined ? '' : n < 0 ? 'passed' : n === 0 ? 'today' : `${n} days left`);
const Elig = ({ e }: { e?: Any }) => (e ? <span className={`badge ${ELIG[e.overall]?.[1] ?? 'grey'}`}>{ELIG[e.overall]?.[0] ?? e.overall}</span> : null);

function AddShortlist({ st, c, fo, close, done }: { st: Any; c: Any; fo: Any; close: () => void; done: () => void }) {
  const intakes = (c.intakes || []).filter((i: Any) => i.open && i.intake_id);
  const [intake, setIntake] = useState(st.defaults.intake_id ?? (intakes[0]?.intake_id || ''));
  const [note, setNote] = useState('');
  const add = async () => {
    try {
      const r = await POST(`/students/${st.id}/shortlist/from-catalogue/${c.id}`, { intake_id: intake, note });
      close(); toast(r.warnings?.length ? `Added with ${r.warnings.length} warning(s): check the Shortlist tab` : 'Added to shortlist', r.warnings?.length ? '' : 'ok'); done();
    } catch (e) { showError(e); }
  };
  return (
    <Modal title="Add to shortlist" size="sm" close={close} foot={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={add}>Add</button></>}>
      <p className="small"><b>{c.name}</b><br />{c.university.name} for <b>{st.name}</b></p>
      <div className="f"><label>Intake</label><select className="input" value={intake} onChange={(e) => setIntake(e.target.value)}>
        <Options list={intakes.length ? intakes.map((i: Any) => [i.intake_id, `${i.label}${i.deadline ? ' (deadline ' + fmtDate(i.deadline) + ')' : ''}`] as [string, string]) : fo.intakes} /></select></div>
      <div className="f" style={{ marginTop: 8 }}><label>Internal remark (optional, never shown to the student)</label><input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <p className="small muted">Added as &quot;Suggested&quot;. Share it with the student from the Shortlist tab.</p>
    </Modal>
  );
}
function Card({ c, st, fo, onAdded }: { c: Any; st: Any; fo: Any; onAdded: () => void }) {
  const ni = c.next_intake, rq = c.req || {};
  const link = `/courses/${c.id}${st ? qs({ student_id: st.id }) : ''}`;
  const right = st
    ? c.in_shortlist ? <span className="ccard-btn dark off">✓ In shortlist</span> : M.can('shortlist', 'add') ? <button className="ccard-btn dark" onClick={() => openOverlay((close) => <AddShortlist st={st} c={c} fo={fo} close={close} done={onAdded} />)}>+ Shortlist</button> : null
    : c.official_link ? <a className="ccard-btn dark" href={c.official_link} target="_blank" rel="noopener noreferrer">Official page ↗</a> : null;
  return (
    <div className="ccard">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <div className="ccard-hd"><img className="ccard-logo" src={c.university.logo || c.logo || ''} alt="" loading="lazy" width={46} height={46} /><div className="ccard-uni">{c.university.name}{c.city ? <small>{c.city}</small> : null}</div><span className="ccard-country">{c.country.name}</span></div>
      <h3 className="ccard-title"><Link href={link}>{c.name} ({c.level})</Link></h3>
      <div className="ccard-tags"><Elig e={c.eligibility} />{c.field ? <span className="badge">{c.field}</span> : null}{c.aps_required ? <span className="badge orange">APS</span> : null}{c.scholarship ? <span className="badge green">Scholarship</span> : null}</div>
      <div className="ccard-boxes">
        <div><span>Tuition fees</span><b>{c.tuition_fee === 0 ? 'Free' : money(c.tuition_fee, c.currency)}</b>{c.tuition_fee === 0 ? null : <small>/ year</small>}</div>
        <div><span>Application fees</span><b>{c.application_fee ? money(c.application_fee, c.application_fee_currency) : 'Free'}</b></div>
      </div>
      <div className="ccard-rows">
        <div><span>Academic Requirement</span>{rq.min_percent ? <em className="pill-green">Min {rq.min_percent}%</em> : <b>{rq.required_level ? (rq.required_level === '12th' ? '12th pass' : rq.required_level + ' degree') : '-'}</b>}</div>
        <div><span>English Proficiency</span><b>{rq.english || '-'}</b></div>
        <div><span>Next intake</span><b>{ni ? ni.label : '-'}</b></div>
        <div><span>Deadline</span><b className={ni && ni.days_left !== null && ni.days_left <= 14 ? 'text-red' : ''}>{ni?.deadline ? `${fmtDate(ni.deadline)} · ${days(ni.days_left)}` : c.deadline_passed ? 'passed' : '-'}</b></div>
        <div><span>Duration</span><b>{c.duration || '-'}{c.language ? ` · ${c.language}` : ''}</b></div>
      </div>
      {c.eligibility?.checks?.length ? <div className="cs-why">{(() => {
        const bad = c.eligibility.checks.filter((x: Any) => x.result !== 'yes').slice(0, 2);
        return bad.length ? bad.map((x: Any, i: number) => <div key={i} className={x.result === 'no' ? 'text-red' : 'text-orange'}>{x.result === 'no' ? '✕' : '?'} {x.reason}</div>) : <div className="text-green">✓ Meets all entry requirements on file</div>;
      })()}</div> : null}
      <div className="ccard-acts"><Link className="ccard-btn light" href={link}>View Course ↗</Link>{right}</div>
    </div>
  );
}
function StudentPicker({ q }: { q: Record<string, string> }) {
  const [v, setV] = useState('');
  const [rows, setRows] = useState<Any[] | null>(null);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  const type = (x: string) => {
    setV(x); clearTimeout(t.current);
    if (x.trim().length < 2) { setRows(null); return; }
    t.current = setTimeout(() => { GET('/students' + qs({ q: x.trim(), limit: 8 })).then((r) => setRows((r.rows || []).slice(0, 8))).catch(() => setRows([])); }, 250);
  };
  return (
    <div className="cs-pick"><input className="input" placeholder="Type student name or ID" autoComplete="off" value={v} onChange={(e) => type(e.target.value)} />
      {rows ? <div className="results">{rows.length ? rows.map((s) => <Link key={s.id} href={'/courses' + qs({ ...q, student_id: s.id, elig: 'eligible' })}><b>{s.name || [s.first_name, s.last_name].filter(Boolean).join(' ')}</b> <span className="muted small">{s.student_code || ''}</span></Link>) : <div className="empty small">No student found</div>}</div> : null}</div>
  );
}

// The client's Course search (legacy/public/js/pages/coursesearch.js page)
function CourseSearch() {
  const router = useRouter();
  const sp = useSearchParams();
  const q: Record<string, string> = Object.fromEntries(sp.entries());
  const [fo, setFo] = useState<Any | null>(null);
  const [res, setRes] = useState<{ rows: Any[]; total: number; counts?: Any; has_more: boolean } | null>(null);
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => { GET('/course-search/filters' + qs({ student_id: q.student_id })).then(setFo).catch(showError); }, [q.student_id]);
  const st = fo?.student;
  // with a student: their first country and eligible courses first
  const eff: Record<string, string> = { ...q };
  if (st && q._first !== '0' && !q.country && st.defaults?.country && !q.q) eff.country = st.defaults.country;
  if (st && q.elig === undefined) eff.elig = 'eligible';
  const effKey = JSON.stringify(eff);
  useEffect(() => { setForm({ q: eff.q ?? '', country: eff.country ?? '', level: eff.level ?? '', field: eff.field ?? '', intake_month: eff.intake_month ?? '', fee_max: eff.fee_max ?? '', sort: eff.sort || 'relevance', free_app: eff.free_app ?? '' }); setPage(1); }, [effKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = useCallback(async (pg: number) => {
    const params: Any = { ...eff, page: pg, eligible: st && (eff.elig || 'eligible') === 'eligible' ? '1' : '' };
    delete params.elig; delete params._first;
    try { const d = await GET('/course-search' + qs(params)); setRes((r) => (pg > 1 && r ? { ...d, rows: [...r.rows, ...d.rows] } : d)); } catch (e) { showError(e); }
  }, [effKey, !!st]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (fo) load(page); }, [fo, page, load]);
  const setQ = (patch: Record<string, string>) => { const n: Record<string, string> = { ...q, ...patch }; for (const k of Object.keys(n)) if (!n[k]) delete n[k]; router.push('/courses' + qs(n)); };
  const submit = (f = form) => setQ({ ...f, page: '', _first: '0' });
  const setF = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = e.target.type === 'checkbox' ? ((e.target as HTMLInputElement).checked ? '1' : '') : e.target.value;
    const n = { ...form, [k]: v };
    setForm(n);
    if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') submit(n);
  };
  if (!fo) return <div className="empty">Loading...</div>;
  const c = res?.counts;
  return (
    <>
      <div className="page-head"><h1>Course search</h1><span className="muted small">{fo.countries.length} countries · same catalogue the students see in the portal</span><span className="grow" />{M.admin() ? <Link className="btn" href="/admin/catalogue">Manage catalogue</Link> : null}</div>
      <div className="cs-student card"><div className="bd">{st ? (
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <span className="avatar">{st.name.split(' ').map((x: string) => x[0]).slice(0, 2).join('')}</span>
          <div className="grow"><div><b><Link href={`/students/${st.id}`}>{st.name}</Link></b> <span className="muted small">{st.code}</span></div><div className="small muted">{st.profile_line || 'No academic details yet'}</div></div>
          <div className="seg-tabs">{[['eligible', 'Eligible for this student'], ['all', 'All courses']].map(([k, l]) => <Link key={k} href={'/courses' + qs({ ...q, elig: k, page: '' })} className={(eff.elig || 'eligible') === k ? 'on' : ''}>{l}</Link>)}</div>
          <Link className="btn sm ghost" href={'/courses' + qs({ ...q, student_id: '', elig: '' })}>✕ Clear student</Link>
        </div>
      ) : (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}><b className="small">Check eligibility for a student:</b><StudentPicker q={q} /><span className="small muted">Without a student you see all published courses.</span></div>
      )}</div></div>
      <form className="cs-bar" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input className="input" type="search" placeholder="Course, university or city" value={form.q ?? ''} onChange={setF('q')} />
        <select className="input" value={form.country ?? ''} onChange={setF('country')}><option value="">All countries</option><Options list={fo.countries} /></select>
        <select className="input" value={form.level ?? ''} onChange={setF('level')}><option value="">All levels</option><Options list={['Bachelor', 'Master', 'MBA', 'PhD', 'Diploma', 'Foundation', 'Language course']} /></select>
        <select className="input" value={form.field ?? ''} onChange={setF('field')}><option value="">All fields</option><Options list={fo.fields} /></select>
        <select className="input" value={form.intake_month ?? ''} onChange={setF('intake_month')}><option value="">Any intake</option><Options list={MONTHS.map((m, i) => [String(i + 1), m] as [string, string])} /></select>
        <input className="input" type="number" placeholder="Max fee € / yr" min={0} step={500} value={form.fee_max ?? ''} onChange={setF('fee_max')} />
        <select className="input" value={form.sort ?? 'relevance'} onChange={setF('sort')}><Options list={[['relevance', 'Best match'], ['deadline', 'Deadline soonest'], ['fee_asc', 'Fee low to high'], ['fee_desc', 'Fee high to low'], ['recent', 'Recently added']]} /></select>
        <label className="row small" style={{ gap: 5 }}><input type="checkbox" checked={form.free_app === '1'} onChange={setF('free_app')} /> Free application</label>
        <button className="btn primary">Search</button>
      </form>
      <div className="row small muted" style={{ margin: '6px 0 10px' }}>{res ? <>{res.total} course{res.total === 1 ? '' : 's'}{c ? <> · <span className="badge green">{c.yes || 0} eligible</span> <span className="badge orange">{c.maybe || 0} likely</span> <span className="badge red">{c.no || 0} not eligible</span>{c.incomplete ? <> <span className="badge grey">{c.incomplete} need profile</span></> : null}</> : null}</> : null}</div>
      <div className="cs-grid">{!res ? <div className="empty">Loading...</div> : res.rows.length ? res.rows.map((x) => <Card key={x.id} c={x} st={st} fo={fo} onAdded={() => setRes((r) => r && { ...r, rows: r.rows.map((y) => (y.id === x.id ? { ...y, in_shortlist: true } : y)) })} />) : (
        <div className="empty" style={{ gridColumn: '1/-1' }}>{st && (eff.elig || 'eligible') === 'eligible' ? <>No eligible course with these filters. <Link href={'/courses' + qs({ ...q, elig: 'all' })}>Show all courses</Link></> : 'No courses match. Remove some filters.'}</div>
      )}</div>
      {res?.has_more ? <div className="center" style={{ marginTop: 12 }}><button className="btn" onClick={() => setPage((p) => p + 1)}>Load more</button></div> : null}
    </>
  );
}
export default function Page() { return <Suspense><CourseSearch /></Suspense>; }
