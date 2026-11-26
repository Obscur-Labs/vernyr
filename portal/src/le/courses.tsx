'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { create } from 'zustand';
import { ApiError, DEL, GET, POST } from './api';
import { fmtDate, money } from './format';
import { Options } from './form';
import { Icon } from './Icon';
import { Modal, openOverlay, showError, toast } from './ui';
import { EligBadge, LockedCard, apiSrc, daysLeftTxt, dlClass, idemKey, t, usePMe, type Any } from './p';
import { openChatWith, uploadDialog } from './docs';

/** The client's courses (legacy/public/portal/js/courses.js): course card, search and filters, detail, compare, Apply Now, shortlist. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CMP_KEY = 'lep:compare';
const readCmp = (): string[] => { try { return JSON.parse(sessionStorage.getItem(CMP_KEY) || '[]'); } catch { return []; } };
export const useCmp = create<{ ids: string[]; set: (a: string[]) => void }>((set) => ({
  ids: typeof window === 'undefined' ? [] : readCmp(),
  set: (ids) => { try { sessionStorage.setItem(CMP_KEY, JSON.stringify(ids)); } catch { /* storage blocked */ } set({ ids }); },
}));
const Loading = () => <div className="empty-p">{t('Loading...')}</div>;

/** the compare tray at the bottom of the course screens */
export function CmpTray() {
  const { ids, set } = useCmp();
  const path = usePathname();
  if (!ids.length || path.startsWith('/compare')) return null;
  return <div className="cmp-tray"><span className="grow">{t('{n} course(s) selected to compare', { n: ids.length })}</span><button className="btn sm ghost" style={{ color: 'var(--white)' }} onClick={() => set([])}>{t('Clear')}</button><Link className="btn sm accent" href="/compare">{t('Compare')}</Link></div>;
}
function CmpBox({ id, label }: { id: string; label: string }) {
  const { ids, set } = useCmp();
  const on = ids.includes(id);
  return <label className="row small" style={{ gap: 5 }}><input type="checkbox" checked={on} onChange={(e) => {
    if (e.target.checked) { if (ids.length >= 3) { toast(t('You can compare up to 3 courses. Remove one first.'), 'err'); return; } set([...new Set([...ids, id])]); } else set(ids.filter((x) => x !== id));
  }} /> {t(label)}</label>;
}
function Heart({ id, saved, onChange, label }: { id: string; saved: boolean; onChange?: (v: boolean) => void; label?: boolean }) {
  const [on, setOn] = useState(saved);
  useEffect(() => setOn(saved), [saved]);
  const tog = async () => {
    try { if (on) await DEL('/saved-courses/' + id); else { const r = await POST('/saved-courses/' + id); toast(t(r?.message || 'Saved to your shortlist'), 'ok'); } setOn(!on); onChange?.(!on); } catch (e) { showError(e); }
  };
  return <><button className={`heart ${on ? 'on' : ''}`} aria-label={t('Save to shortlist')} onClick={tog}>{on ? '♥' : '♡'}</button>{label ? <span className="small">{on ? t('In my shortlist') : t('Shortlist')}</span> : null}</>;
}
const reqAcademic = (rq: Any) => (rq.min_percent ? <em className="pill-green">{t('Min')} {rq.min_percent}%</em> : <b>{rq.required_level ? t(rq.required_level === '12th' ? '12th pass' : rq.required_level + ' degree') : '-'}</b>);

/** course card: logo, university and country, course (level), fee boxes, requirements, View Course / Apply Now */
export function CourseCard({ c, onSaved }: { c: Any; onSaved?: () => void }) {
  const ni = c.next_intake, rq = c.req || {};
  return (
    <div className="ccard">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <div className="ccard-hd"><img className="ccard-logo" src={apiSrc(c.university.logo)} alt="" loading="lazy" width={46} height={46} /><div className="ccard-uni">{c.university.name}{c.city ? <small>{c.city}</small> : null}</div><span className="ccard-country">{c.country.name}</span></div>
      <h3 className="ccard-title"><Link href={`/courses/${c.id}`}>{c.name} ({t(c.level)})</Link></h3>
      <div className="ccard-tags"><EligBadge e={c.eligibility} />{c.suggested ? <span className="badge purple">★ {t('Suggested by your counsellor')}</span> : null}{c.aps_required ? <span className="badge orange">APS</span> : null}{c.scholarship ? <span className="badge green">{t('Scholarship')}</span> : null}</div>
      <div className="ccard-boxes"><div><span>{t('Tuition fees')}</span><b>{c.tuition_fee === 0 ? t('Free') : money(c.tuition_fee, c.currency)}</b>{c.tuition_fee === 0 ? null : <small>/ {t('year')}</small>}</div>
        <div><span>{t('Application fees')}</span><b>{c.application_fee ? money(c.application_fee, c.application_fee_currency) : t('Free')}</b></div></div>
      <div className="ccard-rows">
        <div><span>{t('Academic Requirement')}</span>{reqAcademic(rq)}</div>
        <div><span>{t('English Proficiency')}</span><b>{rq.english || '-'}</b></div>
        <div><span>{t('Next intake')}</span><b>{ni ? ni.label : '-'}</b></div>
        <div><span>{t('Deadline')}</span><b>{ni?.deadline ? <span className={dlClass(ni.days_left)}>{fmtDate(ni.deadline)} · {daysLeftTxt(ni.days_left)}</span> : c.deadline_passed ? <span className="muted">{t('Deadline passed')}</span> : <span className="muted">-</span>}</b></div>
        <div><span>{t('Duration')}</span><b>{c.duration || '-'}{c.language ? ` · ${c.language}` : ''}</b></div>
      </div>
      <div className="ccard-acts"><Link className="ccard-btn light" href={`/courses/${c.id}`}>{t('View Course')} ↗</Link>{ni ? <Link className="ccard-btn dark" href={`/apply/${c.id}`}>{t('Apply Now')}</Link> : <span className="ccard-btn dark off">{t('Deadline passed')}</span>}</div>
      <div className="ccard-ft"><Heart id={c.id} saved={!!c.saved} label onChange={onSaved} /><span className="grow" /><CmpBox id={c.id} label="Compare" /></div>
    </div>
  );
}

// ---------- search (SP08) ----------
type Q = Record<string, string>;
function FilterSheet({ fo, q, strict, close, apply }: { fo: Any; q: Q; strict: boolean; close: () => void; apply: (patch: Q | null) => void }) {
  const multi = (k: string) => String(q[k] || '').split(',').filter(Boolean);
  const [sel, setSel] = useState<Record<string, string[]>>(() => Object.fromEntries(['country', 'level', 'field', 'city', 'intake_month', 'duration', 'language'].map((k) => [k, multi(k)])));
  const [fee, setFee] = useState(Number(q.fee_max || fo.fee_max || 30000));
  const [test, setTest] = useState(q.english_test || fo.my_test?.test || ''), [score, setScore] = useState(q.english_score || (fo.my_test ? String(fo.my_test.score) : ''));
  const [freeApp, setFreeApp] = useState(q.free_app === '1'), [hide, setHide] = useState(q.hide_passed !== '0'), [elig, setElig] = useState(q.eligible === '1');
  const tog = (k: string, v: string, on: boolean) => setSel((o) => ({ ...o, [k]: on ? [...o[k], v] : o[k].filter((x) => x !== v) }));
  const checks = (k: string, list: [string | number, string][]) => <div className="ms">{list.map(([v, l]) => <label key={String(v)}><input type="checkbox" checked={sel[k].includes(String(v))} onChange={(e) => tog(k, String(v), e.target.checked)} />{l}</label>)}</div>;
  const max = fo.fee_max || 30000;
  const go = () => {
    const j = (k: string) => sel[k].join(',');
    apply({ country: j('country'), level: j('level'), field: j('field'), city: j('city'), intake_month: j('intake_month'), duration: j('duration'), language: j('language'),
      fee_max: fee < max ? String(fee) : '', english_test: test, english_score: test ? score : '', free_app: freeApp ? '1' : '', hide_passed: hide ? '' : '0', eligible: !strict && elig ? '1' : '', page: '' });
    close();
  };
  return (
    <Modal title={t('Filters')} size="lg" close={close} foot={<><button className="btn" onClick={() => { close(); apply(null); }}>{t('Clear all')}</button><button className="btn primary" onClick={go}>{t('Show courses')}</button></>}>
      <form className="sheet" onSubmit={(e) => e.preventDefault()}>
        <div className="f"><label>{t('Country')}</label>{checks('country', fo.countries.map((c: Any) => [c.id, c.name]))}</div>
        <div className="f"><label>{t('Level')}</label>{checks('level', [['Bachelor', t('Bachelor')], ['Master', t('Master')], ['Other', t('Other (MBA, PhD, Diploma...)')]])}</div>
        <div className="f"><label>{t('Field of study')}</label>{checks('field', fo.fields.map((c: Any) => [c.id, c.name]))}</div>
        <div className="f"><label>{t('City')}</label>{checks('city', fo.cities.filter((c: Any) => !sel.country.length || sel.country.includes(c.country)).map((c: Any) => [c.city, c.city]))}</div>
        <div className="f"><label>{t('Intake month')}</label>{checks('intake_month', MONTHS.map((x, i) => [i + 1, t(x)]))}</div>
        <div className="f"><label>{t('Tuition fee per year (up to, EUR approx.)')}: <b>{fee}</b></label><input type="range" min={0} max={max} step={500} value={fee} onChange={(e) => setFee(Number(e.target.value))} /><div className="help">{t('Courses in other currencies are compared using an approximate rate.')}</div></div>
        <div className="f"><label>{t('Duration')}</label>{checks('duration', [['1', t('Up to 1 year')], ['2', t('1 to 2 years')], ['3', t('2 to 3 years')], ['4', t('More than 3 years')]])}</div>
        <div className="f"><label>{t('English test and my score')}</label><div className="row"><select className="input" style={{ width: 140 }} value={test} onChange={(e) => setTest(e.target.value)}><option value="">{t('Any')}</option><Options list={['IELTS', 'TOEFL', 'PTE', 'Duolingo', 'MOI']} /></select>
          <input className="input" style={{ width: 110 }} type="number" step="0.5" placeholder={t('My score')} value={score} onChange={(e) => setScore(e.target.value)} /></div></div>
        <div className="f"><label>{t('Language of instruction')}</label>{checks('language', fo.languages.map((l: string) => [l, l]))}</div>
        <label className="row" style={{ gap: 8, margin: '6px 0' }}><input type="checkbox" checked={freeApp} onChange={(e) => setFreeApp(e.target.checked)} /> {t('Free application only')}</label>
        <label className="row" style={{ gap: 8, margin: '6px 0' }}><input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> {t('Hide courses whose deadline has passed')}</label>
        {strict ? null : <label className="row" style={{ gap: 8, margin: '6px 0' }}><input type="checkbox" checked={elig} onChange={(e) => setElig(e.target.checked)} /> {t('Show only courses I am eligible for')}</label>}
      </form>
    </Modal>
  );
}
export function CourseSearch({ q }: { q: Q }) {
  const router = useRouter();
  const [fo, setFo] = useState<Any | null>(null);
  const [rows, setRows] = useState<Any[]>([]), [meta, setMeta] = useState<Any | null>(null), [page, setPage] = useState(1);
  const [text, setText] = useState(q.q || '');
  const strict = useRef(false);
  const qs = JSON.stringify(q);
  const setQ = useCallback((patch: Q) => { const n: Q = { ...q, ...patch }; for (const k of Object.keys(n)) if (!n[k]) delete n[k]; router.push('/courses?' + new URLSearchParams(n).toString()); }, [q, router]);
  useEffect(() => {
    GET('/courses/filters').then((f) => {
      let first = false; try { first = !Object.keys(q).length && !sessionStorage.getItem('lep:searched'); if (first) sessionStorage.setItem('lep:searched', '1'); } catch { /* storage blocked */ }
      if (first && (f.defaults?.country || f.defaults?.level)) { setQ({ country: f.defaults.country || '', level: f.defaults.level || '' }); return; }
      setFo(f);
    }).catch(showError);
  }, [qs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); setText(q.q || ''); }, [qs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!fo) return;
    GET('/courses?' + new URLSearchParams({ ...q, page: String(page) }).toString()).then((d) => { strict.current = !!d.strict; setMeta(d); setRows((o) => (page === 1 ? d.rows : [...o, ...d.rows])); }).catch(showError);
  }, [fo, qs, page]); // eslint-disable-line react-hooks/exhaustive-deps
  const multi = (k: string) => String(q[k] || '').split(',').filter(Boolean);
  const chips = useMemo(() => {
    if (!fo) return [] as [string, string, string][];
    const defs: [string, (v: string) => string | undefined][] = [['country', (v) => fo.countries.find((c: Any) => c.id === v)?.name], ['level', (v) => t(v)], ['field', (v) => fo.fields.find((c: Any) => c.id === v)?.name], ['city', (v) => v],
      ['intake_month', (v) => MONTHS[Number(v) - 1]], ['language', (v) => v], ['duration', (v) => ({ 1: t('Up to 1 year'), 2: t('1 to 2 years'), 3: t('2 to 3 years'), 4: t('More than 3 years') } as Record<string, string>)[v]]];
    const out: [string, string, string][] = [];
    for (const [k, f] of defs) for (const v of multi(k)) out.push([k, v, f(v) || v]);
    if (q.fee_max) out.push(['fee_max', '', `${t('Up to')} €${q.fee_max}`]);
    if (q.english_test) out.push(['english_test', '', `${q.english_test} ${q.english_score || ''}`]);
    if (q.free_app === '1') out.push(['free_app', '', t('Free application')]);
    if (q.eligible === '1') out.push(['eligible', '', t('Eligible / Maybe only')]);
    if (q.hide_passed === '0') out.push(['hide_passed', '', t('Including passed deadlines')]);
    return out;
  }, [fo, qs]); // eslint-disable-line react-hooks/exhaustive-deps
  const dropChip = (k: string, v: string) => { const left = multi(k).filter((x) => x !== v); setQ({ [k]: v && left.length ? left.join(',') : '', ...(k === 'english_test' ? { english_score: '' } : {}) }); };
  const d = meta;
  return (
    <>
      <div className="p-head"><h1>{t('Course Search')}</h1><span className="grow" /><Link className="btn sm" href="/shortlist"><Icon name="shortlist" /> {t('My shortlist')}</Link></div>
      {d ? (!d.profile_done
        ? <div className="elig-hero todo"><div className="ring" style={{ '--p': d.completion || 0 } as React.CSSProperties}><span>{d.completion || 0}%</span></div><div className="grow"><b>{t('Complete your profile to unlock your personal course list')}</b>
          <div className="small">{t('Once you submit your profile, we show only the courses you are eligible for, based on your marks, degree, English test and work experience.')}</div></div><Link className="btn accent sm" href="/my-information">{t('Complete profile')}</Link></div>
        : d.mode === 'eligible'
          ? <div className="elig-hero ok"><span className="tick">✓</span><div className="grow"><b>{t('Courses matched to your profile')}</b><div className="small">{t('Only courses where you meet, or are close to, the entry requirements are shown.')}{d.hidden_not_eligible ? ' ' + t('{n} other courses are hidden because your profile does not meet their requirements.', { n: d.hidden_not_eligible }) : ''}</div></div>
            {d.strict ? <Link className="btn sm" href="/chat">{t('Ask about other courses')}</Link> : <button className="btn sm" onClick={() => setQ({ eligible: '', page: '' })}>{t('Show all courses')}</button>}</div>
          : <div className="elig-hero"><div className="grow"><b>{t('Showing all courses')}</b><div className="small">{t('Each course shows whether you are eligible.')}</div></div><button className="btn sm primary" onClick={() => setQ({ eligible: '1', page: '' })}>{t('Only eligible for me')}</button></div>) : null}
      <form className="searchbox" onSubmit={(e) => { e.preventDefault(); setQ({ q: text.trim(), page: '' }); }}><input type="search" placeholder={t('Search courses, universities or cities')} value={text} onChange={(e) => setText(e.target.value)} /><button className="btn primary" type="submit" aria-label={t('Search')}><Icon name="search" /></button></form>
      <div className="filters-p"><button className="btn sm" disabled={!fo} onClick={() => fo && openOverlay((close) => <FilterSheet fo={fo} q={q} strict={strict.current} close={close} apply={(p) => (p ? setQ(p) : router.push('/courses?' + (q.q ? 'q=' + encodeURIComponent(q.q) : 'x=1')))} />)}>{t('Filters')} <span className="badge">{chips.length || ''}</span></button>
        <select className="input" style={{ width: 'auto', height: 34 }} value={q.sort || 'relevance'} onChange={(e) => setQ({ sort: e.target.value })}><Options list={[['relevance', t('Relevance')], ['deadline', t('Deadline (soonest)')], ['fee_asc', t('Tuition fee: low to high')], ['fee_desc', t('Tuition fee: high to low')], ['duration', t('Duration')], ['recent', t('Recently added')]]} /></select>
        <span className="grow" /><span className="small muted">{d ? (d.mode === 'eligible' ? t('{n} courses you are eligible for', { n: d.total }) : t('{n} courses found', { n: d.total })) : ''}</span></div>
      <div className="chips-x">{chips.map(([k, v, l]) => <span key={k + v} className="chip" onClick={() => dropChip(k, v)}>{l} ✕</span>)}</div>
      <div className="courses">{!d ? <Loading /> : rows.length ? rows.map((c) => <CourseCard key={c.id} c={c} />) : <div className="empty-p" style={{ gridColumn: '1/-1' }}><div className="big">🔎</div>{d.mode === 'eligible' ? t('No eligible course matches these filters. Try removing some filters, or ask your counsellor for options.') : t('No courses match your search. Try removing some filters.')}</div>}</div>
      {d?.has_more ? <div className="center" style={{ marginTop: 14 }}><button className="btn" onClick={() => setPage((p) => p + 1)}>{t('Load more')}</button></div> : null}
      <CmpTray />
    </>
  );
}

// ---------- detail (SP09) ----------
function EligPanel({ e }: { e?: Any | null }) {
  if (!e) return null;
  if (['unknown', 'incomplete'].includes(e.overall)) return <div className="p-banner info">{t(e.label)}{e.overall === 'incomplete' ? <> <Link href="/my-information?step=3">{t('Complete profile')}</Link></> : null}</div>;
  const ic: Record<string, string> = { yes: '✓', maybe: '?', no: '✕' };
  return (
    <div className="p-card"><div className="hd"><h2>{t('Eligibility guide')}</h2><EligBadge e={e} /></div><div className="bd">
      <ul className="list-plain">{e.checks.map((c: Any, i: number) => <li key={i}><b className={c.result === 'yes' ? 'st-Verified' : c.result === 'maybe' ? 'days-orange' : 'st-Rejected'} style={{ width: 18 }}>{ic[c.result]}</b><div><b>{t(c.name)}</b><div className="small">{c.reason}</div></div></li>)}</ul>
      <p className="small muted" style={{ marginBottom: 0 }}>{t(e.guide)}</p></div></div>
  );
}
export function CourseDetail({ id }: { id: string }) {
  const [c, setC] = useState<Any | null>(null);
  useEffect(() => { GET('/courses/' + id).then(setC).catch(showError); }, [id]);
  if (!c) return <Loading />;
  const ask = () => openChatWith('course', c.id, `${c.name} – ${c.university.name}`);
  const share = async () => { try { await navigator.clipboard.writeText(window.location.href); toast(t('Link copied (works for logged-in students)'), 'ok'); } catch { toast(window.location.href); } };
  return (
    <>
      <div className="p-head"><Link className="btn ghost sm" href="/courses">← {t('Courses')}</Link></div>
      <div className="p-card" style={{ marginBottom: 14 }}><div className="bd">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="course-hd"><img className="uni-logo lg" src={apiSrc(c.university.logo)} alt="" width={64} height={64} /><div className="grow" style={{ minWidth: 0 }}><div className="uni-name">{c.university.name}</div>
          <div className="uni small muted">{c.city || ''}, {c.country.name} {c.university.website ? <>· <a href={c.university.website} target="_blank" rel="noopener noreferrer">{t('University website')}</a></> : null}</div></div></div>
        <h1 style={{ margin: '10px 0 6px' }}>{c.name}</h1>
        <div className="row" style={{ gap: 6 }}><span className="badge blue">{t(c.level)}</span><EligBadge e={c.eligibility} />{c.suggested ? <span className="badge purple">★ {t('Suggested by your counsellor')}</span> : null}{c.aps_required ? <span className="badge orange">{t('APS required')}</span> : null}</div>
        <div className="row" style={{ marginTop: 14 }}>{c.next_intake ? <Link className="btn primary" href={`/apply/${c.id}`}>{t('Apply Now')}</Link> : <button className="btn primary" onClick={ask}>{t('Ask my counsellor')}</button>}
          <Heart id={c.id} saved={!!c.saved} /><CmpBox id={c.id} label="Add to compare" />
          {c.next_intake ? <button className="btn" onClick={ask}>{t('Ask my counsellor')}</button> : null}<button className="btn ghost" onClick={share}>{t('Share')}</button></div>
      </div></div>
      <div className="p-grid two"><div className="p-grid">
        <div className="p-card"><div className="hd"><h2>{t('Key facts')}</h2></div><div className="bd"><div className="kv">
          <div><div className="k">{t('Field of study')}</div><div className="v">{c.field || '-'}</div></div><div><div className="k">{t('Language')}</div><div className="v">{c.language || '-'}</div></div>
          <div><div className="k">{t('Duration')}</div><div className="v">{c.duration}</div></div>
          <div><div className="k">{t('Tuition fee per year')}</div><div className="v"><b>{c.tuition_fee === 0 ? t('No tuition fee') : money(c.tuition_fee, c.currency)}</b>{c.tuition_fee_non_eu ? <div className="small">{t('Non-EU')}: {money(c.tuition_fee_non_eu, c.currency)}</div> : null}{c.fee_note ? <div className="small muted">{c.fee_note}</div> : null}</div></div>
          <div><div className="k">{t('Application fee')}</div><div className="v">{c.application_fee ? money(c.application_fee, c.application_fee_currency) : t('Free')}</div></div>
          {c.scholarship ? <div><div className="k">{t('Scholarship')}</div><div className="v">{c.scholarship}</div></div> : null}</div>
          {c.description ? <p style={{ marginBottom: 0 }}>{c.description}</p> : null}</div></div>
        <div className="p-card"><div className="hd"><h2>{t('Intakes')}</h2></div><div className="bd flush"><table className="t"><thead><tr><th>{t('Intake')}</th><th>{t('Opens')}</th><th>{t('Deadline')}</th><th>{t('Days left')}</th></tr></thead><tbody>
          {c.intakes.length ? c.intakes.map((i: Any, n: number) => <tr key={n} className={i.open ? '' : 'muted'}><td>{i.label}</td><td>{fmtDate(i.open_date)}</td><td>{fmtDate(i.deadline)}{i.deadline_note ? <div className="small muted">{i.deadline_note}</div> : null}</td><td className={dlClass(i.days_left)}>{i.open ? daysLeftTxt(i.days_left) : t('Deadline passed')}</td></tr>)
            : <tr><td colSpan={4} className="muted">{t('No intake information yet')}</td></tr>}</tbody></table></div></div>
        <div className="p-card"><div className="hd"><h2>{t('Requirements')}</h2></div><div className="bd"><ul className="list-plain">
          {c.english?.length ? <li><b>{t('English')}:</b> {c.english.map((x: string, i: number) => <div key={i}>{x}</div>)}</li> : null}{c.academic ? <li><b>{t('Academic')}:</b> {c.academic}</li> : null}
          {(c.other || []).map((o: string, i: number) => <li key={i}>{o}</li>)}{c.aps_required ? <li>{t('APS certificate needed (Germany)')}</li> : null}
          {!c.english?.length && !c.academic ? <li className="muted">{t('Requirements not available. Ask your counsellor.')}</li> : null}</ul>
          {c.official_link ? <><a className="btn sm" href={c.official_link} target="_blank" rel="noopener noreferrer">{t('View on university website')}</a><p className="small muted">{t('To apply, use Apply Now. La Europa will apply on your behalf.')}</p></> : null}</div></div>
        {(c.scholarships || []).length ? <div className="p-card"><div className="hd"><h2>{t('Scholarships')}</h2></div><div className="bd">{c.scholarships.map((s: Any, i: number) => (
          <div key={i} className="rowx" style={{ padding: '6px 0' }}><div className="grow"><b>{s.name}</b> · {s.benefit}{s.deadline ? ` · ${t('deadline')} ${fmtDate(s.deadline)}` : ''}{s.eligibility ? <div className="small muted">{s.eligibility}</div> : null}</div><button className="btn xs" onClick={ask}>{t('Ask my counsellor')}</button></div>))}
          <p className="small muted" style={{ marginBottom: 0 }}>{t('Scholarships are decided by the university. Your counsellor will tell you if you can apply.')}</p></div></div> : null}
        <p className="small muted">{t('Information last checked on')} {fmtDate(c.last_verified_on)}. {t('Please confirm details with your counsellor.')}</p>
      </div><div><EligPanel e={c.eligibility} /></div></div>
      <CmpTray />
    </>
  );
}

// ---------- compare (SP10) ----------
const EUR: Record<string, number> = { EUR: 1, CNY: 0.13, USD: 0.92, INR: 0.011, SEK: 0.087, GBP: 1.17, CHF: 1.05 };
const eur = (amt: unknown, cur?: string) => (amt === null || amt === undefined ? null : Number(amt) * (EUR[cur || 'EUR'] ?? 1));
export function Compare() {
  const { ids, set } = useCmp();
  const [cs, setCs] = useState<Any[] | null>(null);
  useEffect(() => { if (ids.length < 2) { setCs([]); return; } Promise.all(ids.map((id) => GET('/courses/' + id).catch(() => null))).then((a) => setCs(a.filter(Boolean))); }, [ids]);
  if (ids.length < 2) return <><div className="p-head"><h1>{t('Compare courses')}</h1></div><div className="empty-p">{t('Select 2 or 3 courses with the Compare box to compare them.')}<br /><Link className="btn primary" href="/courses" style={{ marginTop: 10 }}>{t('Course Search')}</Link></div></>;
  if (!cs) return <Loading />;
  type Row = [string, (c: Any) => React.ReactNode, ((c: Any) => number | null)?, ('min' | 'max')?];
  const rows: Row[] = [
    ['Eligibility', (c) => (c.eligibility ? <EligBadge e={c.eligibility} /> : '-'), (c) => ({ yes: 3, maybe: 2, no: 0 } as Record<string, number>)[c.eligibility?.overall] ?? 1, 'max'],
    ['Tuition fees / year', (c) => (c.tuition_fee === 0 ? t('Free') : money(c.tuition_fee, c.currency)), (c) => eur(c.tuition_fee, c.currency), 'min'],
    ['Application fees', (c) => (c.application_fee ? money(c.application_fee, c.application_fee_currency) : t('Free')), (c) => eur(c.application_fee || 0, c.application_fee_currency), 'min'],
    ['Next intake', (c) => (c.next_intake ? c.next_intake.label : t('No open intake'))],
    ['Deadline', (c) => (c.next_intake?.deadline ? `${fmtDate(c.next_intake.deadline)} (${daysLeftTxt(c.next_intake.days_left)})` : c.deadline_passed ? t('Deadline passed') : '-'), (c) => (c.next_intake ? c.next_intake.days_left : null), 'max'],
    ['Academic requirement', (c) => (c.req?.min_percent ? `${t('Min')} ${c.req.min_percent}%` : c.academic || '-'), (c) => c.req?.min_percent ?? null, 'min'],
    ['English proficiency', (c) => (c.english || []).join('; ') || c.req?.english || '-'],
    ['Duration', (c) => c.duration], ['Language', (c) => c.language], ['City', (c) => `${c.city || '-'}, ${c.country.name}`], ['APS required', (c) => (c.aps_required ? t('Yes') : t('No'))], ['Scholarship', (c) => c.scholarship || '-']];
  return (
    <>
      <div className="p-head"><Link className="btn ghost sm" href="/courses">← {t('Courses')}</Link><h1>{t('Compare courses')}</h1><span className="grow" /><span className="small muted">🟩 {t('best value in the row')}</span></div>
      <div className="p-card"><div className="table-wrap"><table className="t compare2"><thead><tr><th />{cs.map((c) => (
        <th key={c.id}><div className="cmp-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="ccard-logo" src={apiSrc(c.university.logo)} alt="" width={46} height={46} /><div className="small muted">{c.university.name}</div>
          <Link href={`/courses/${c.id}`}><b>{c.name} ({t(c.level)})</b></Link><button className="btn xs ghost" onClick={() => set(ids.filter((x) => x !== c.id))}>✕ {t('Remove')}</button></div></th>))}</tr></thead>
        <tbody>{rows.map(([l, f, num, dir]) => {
          const nums = num ? cs.map(num) : []; const valid = nums.filter((n): n is number => n !== null && n !== undefined);
          const best = valid.length > 1 && new Set(valid).size > 1 ? (dir === 'min' ? Math.min(...valid) : Math.max(...valid)) : null;
          return <tr key={l}><th>{t(l)}</th>{cs.map((c, i) => <td key={c.id} className={best !== null && nums[i] === best ? 'best' : ''}>{f(c) ?? '-'}</td>)}</tr>;
        })}
          <tr className="acts"><th />{cs.map((c) => <td key={c.id}><div className="ccard-acts"><Link className="ccard-btn light" href={`/courses/${c.id}`}>{t('View Course')} ↗</Link>{c.next_intake ? <Link className="ccard-btn dark" href={`/apply/${c.id}?src=Compare`}>{t('Apply Now')}</Link> : null}</div>
            <div className="row small" style={{ marginTop: 6, gap: 6 }}><Heart id={c.id} saved={!!c.saved} />{t('Shortlist')}</div></td>)}</tr></tbody></table></div></div>
    </>
  );
}

// ---------- Apply Now (SP12) ----------
export function Apply({ courseId, src }: { courseId: string; src?: string }) {
  const [d, setD] = useState<Any | null>(null), [err, setErr] = useState<ApiError | null>(null);
  const [step, setStep] = useState(1), [intake, setIntake] = useState('');
  const [msg, setMsg] = useState(''), [und, setUnd] = useState(false), [apc, setApc] = useState(false), [miss, setMiss] = useState<Record<string, boolean>>({});
  const [promo, setPromo] = useState<{ code: string; info: Any | null; error: string | null; agreed: boolean }>({ code: '', info: null, error: null, agreed: false });
  const [typed, setTyped] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState<Any | null>(null);
  const key = useRef(idemKey());
  const load = useCallback(() => GET('/apply/' + courseId).then((x) => { setD(x); setIntake((o) => o || x.preselect); setTyped((o) => o || x.suggested_promo || ''); }).catch((e) => setErr(e)), [courseId]);
  useEffect(() => { load(); }, [load]);
  const checkPromo = useCallback(async (codeIn: string) => {
    const code = codeIn.trim().toUpperCase();
    let info = null, error = null;
    if (code && d) { try { info = await GET(`/promotions/check?code=${encodeURIComponent(code)}&course_id=${encodeURIComponent(d.course.id)}`); } catch (e) { error = (e as Error).message; } }
    const next = { code, info, error, agreed: false }; setPromo(next); return next;
  }, [d]);
  useEffect(() => { if (step === 3 && typed && !promo.info && !promo.error && promo.code !== typed.toUpperCase()) checkPromo(typed); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <><div className="p-head"><Link className="btn ghost sm" href={`/courses/${courseId}`}>← {t('Back')}</Link><h1>{t('Apply Now')}</h1></div>
    <div className="p-banner warn"><span className="grow">{t(err.message)}</span>{err.data.link ? <Link className="btn sm" href={String(err.data.link).replace(/^#/, '')}>{t('Open')}</Link> : null}{err.data.code === 'A5' ? <Link className="btn sm" href="/settings">{t('Verify now')}</Link> : null}</div></>;
  if (!d) return <Loading />;
  const c = d.course, it = d.intakes.find((i: Any) => i.id === intake) ?? d.intakes[0];
  if (done) return <div className="p-card"><div className="bd center" style={{ padding: '30px 16px' }}><div style={{ fontSize: 44, color: 'var(--green)' }}>✓</div><h2>{t('Request sent to La Europa')}</h2><p className="mono">{done.request_code}</p><p>{t(done.message)}</p>
    <div className="row" style={{ justifyContent: 'center' }}><Link className="btn primary" href="/applications">{t('Go to My Applications')}</Link><Link className="btn" href="/courses">{t('Continue browsing')}</Link></div></div></div>;
  const missing = d.documents.filter((x: Any) => x.required === 'Yes' && ['Pending', 'Rejected'].includes(x.status));
  const e = c.eligibility;
  const send = async () => {
    if (!und) { setMiss({ und: true }); toast(t('Please tick the confirmation box'), 'err'); return; }
    if (!apc) { setMiss({ apc: true }); toast(t('Please give your consent for this application'), 'err'); return; }
    const code = typed.trim().toUpperCase();
    let p = promo;
    if (code && (code !== promo.code || (!promo.info && !promo.error))) p = await checkPromo(code);
    if (code && p.error) { toast(t(p.error), 'err'); return; }
    if (code && !p.agreed) { setMiss({ pt: true }); toast(t('Please accept the terms and conditions of the offer'), 'err'); return; }
    setBusy(true);
    try { setDone(await POST('/application-requests', { course_id: c.id, course_intake_id: it.id, message: msg, understood: true, apply_consent: true, idempotency_key: key.current, source_screen: src || 'Course detail', promo_code: code || undefined, promo_terms: code ? true : undefined })); }
    catch (er) { setBusy(false); showError(er); }
  };
  const p = promo.info;
  return (
    <>
      <div className="p-head"><Link className="btn ghost sm" href={`/courses/${c.id}`}>← {t('Back')}</Link><h1>{t('Apply Now')}</h1><span className="sub">{c.name} · {c.university.name}</span></div>
      <div className="stepper">{[t('Choose intake'), t('Documents'), t('Review and send')].map((s, i) => <a key={i} className={i + 1 === step ? 'on' : i + 1 < step ? 'ok' : ''}><b>{i + 1 < step ? '✓' : i + 1}</b>{s}</a>)}</div>
      <div className="p-card"><div className="bd">
        {step === 1 ? <>
          {d.offer_already_accepted ? <div className="p-banner warn">{t('You have already accepted an offer for this intake. Do you still want to send this request?')}</div> : null}
          <h3>{t('Step 1 of 3: Choose intake')}</h3>
          <div className="f" style={{ marginTop: 10 }}><select className="input" value={it?.id ?? ''} onChange={(ev) => setIntake(ev.target.value)}>{d.intakes.map((i: Any) => <option key={i.id} value={i.id}>{i.label}{i.deadline ? ` (${t('deadline')} ${fmtDate(i.deadline)}, ${daysLeftTxt(i.days_left)})` : ''}</option>)}</select></div>
          <div className="w-actions" style={{ position: 'static' }}><span /><button className="btn primary" onClick={() => setStep(2)}>{t('Next')} →</button></div>
        </> : step === 2 ? <>
          <h3>{t('Step 2 of 3: Documents for')} {c.country.name}, {t(c.level)}</h3>
          {d.lead_account ? <p className="muted">{t('Your document checklist will be available after your registration with La Europa. You can still send the request.')}</p> : <>
            <p className="small">{t('{a} of {b} ready', { a: d.documents.filter((x: Any) => ['Verified', 'Uploaded'].includes(x.status)).length, b: d.documents.length })}</p>
            <div className="p-card" style={{ boxShadow: 'none' }}>{d.documents.map((x: Any) => (
              <div key={x.type_id} className="doc-item"><div className="grow"><b>{x.name}</b>{x.required === 'Yes' ? null : <> <span className="badge grey">{t('Optional')}</span></>}
                <div className={`small st-${x.status}`}>{x.status === 'Verified' ? t('Verified') : x.status === 'Uploaded' ? t('Uploaded: being checked') : x.status === 'Rejected' ? `${t('Rejected:')} ${x.reason || ''}` : t('Missing')}</div></div>
                {['Pending', 'Rejected'].includes(x.status) ? <button className="btn sm" onClick={async () => { if (await uploadDialog({ type_id: x.type_id, name: x.name })) load(); }}>{t('Upload now')}</button> : null}</div>))}</div>
            <p className="small muted">{t('Missing documents will not stop your request. Your counsellor will ask for them.')}</p></>}
          <div className="w-actions" style={{ position: 'static' }}><button className="btn" onClick={() => setStep(1)}>← {t('Back')}</button><button className="btn primary" onClick={() => setStep(3)}>{t('Next')} →</button></div>
        </> : <>
          <h3>{t('Step 3 of 3: Review and send')}</h3>
          <div className="kv" style={{ margin: '12px 0' }}>
            <div><div className="k">{t('University')}</div><div className="v">{c.university.name}</div></div><div><div className="k">{t('Course')}</div><div className="v">{c.name}</div></div><div><div className="k">{t('Level')}</div><div className="v">{t(c.level)}</div></div>
            <div><div className="k">{t('Intake')}</div><div className="v">{it?.label}</div></div><div><div className="k">{t('Tuition fee')}</div><div className="v">{money(c.tuition_fee, c.currency)}</div></div>
            <div><div className="k">{t('Application fee')}</div><div className="v">{c.application_fee ? money(c.application_fee, c.application_fee_currency) : t('Free')}</div></div>
            <div><div className="k">{t('Eligibility')}</div><div className="v"><EligBadge e={e} /></div></div><div><div className="k">{t('Missing documents')}</div><div className="v">{d.lead_account ? '-' : missing.length}</div></div></div>
          {e?.overall === 'no' ? <div className="p-banner warn">{t('Based on your profile this course may not be a match. You can still send the request and your counsellor will advise you.')}</div> : null}
          <p className="small muted">{t(e?.guide || '')}</p>
          <div className="p-banner info">{t('La Europa will review your request and apply to the university on your behalf. You do not need to contact the university.')}</div>
          <div className="f"><label>{t('Message to my counsellor (optional)')}</label><textarea className="input" rows={3} maxLength={500} style={{ height: 'auto', padding: 8 }} value={msg} onChange={(ev) => setMsg(ev.target.value)} /></div>
          <label className={`consent${miss.und ? ' err' : ''}`}><input type="checkbox" checked={und} onChange={(ev) => setUnd(ev.target.checked)} /> <span>{t('I understand that La Europa will review my request and apply to the university on my behalf. This is not a direct application to the university.')}</span></label>
          <label className={`consent${miss.apc ? ' err' : ''}`}><input type="checkbox" checked={apc} onChange={(ev) => setApc(ev.target.checked)} /> <span>{t('I agree that La Europa applies on my behalf to')} <b>{c.university.name}</b> ({c.name}, {it?.label}) {t('and shares my application and documents with this university, as set out in my Student Declaration & Consent.')}</span></label>
          <div className="promo-box"><label htmlFor="pcode">{t('Promotion code (optional)')}</label>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input id="pcode" className={`input mono${p ? ' ok' : ''}${promo.error ? ' bad' : ''}`} maxLength={20} placeholder={t('e.g. PR-4HX8KD')} style={{ textTransform: 'uppercase', maxWidth: 240 }} value={typed} onChange={(ev) => setTyped(ev.target.value)} onBlur={() => checkPromo(typed)} />
              <button className="btn sm" onClick={() => checkPromo(typed)}>{t('Check code')}</button>{p ? <span className="promo-verified"><i>✓</i>{t('Code verified')}</span> : null}</div>
            {promo.error ? <div className="small st-Rejected" style={{ marginTop: 6 }}>{t(promo.error)}</div> : p ? <div className="promo-ok">
              <div><b>🎁 {p.title}</b>{p.reward ? ` · ${p.reward}` : ''}</div><div className="small muted">{t('Offer period')}: {p.period}</div>
              {p.provider ? <div className="small">{t('Offer by')}: <b>{p.provider}</b></div> : null}
              <details open><summary className="small">{t('Terms and conditions')}</summary><div className="small promo-terms">{p.terms || ''}</div>{p.provider_note ? <p className="small o-note">{p.provider_note}</p> : null}</details>
              <label className={`consent${miss.pt ? ' err' : ''}`}><input type="checkbox" checked={promo.agreed} onChange={(ev) => setPromo({ ...promo, agreed: ev.target.checked })} /> <span>{t('I have read and accept the terms and conditions of this offer. I understand it counts only when my visa is approved and I am enrolled at the university.')}</span></label>
            </div> : null}</div>
          <div className="w-actions" style={{ position: 'static' }}><button className="btn" onClick={() => setStep(2)}>← {t('Back')}</button><button className="btn primary" disabled={busy} onClick={send}>{t('Send request to La Europa')}</button></div>
        </>}
      </div></div>
    </>
  );
}

// ---------- shortlist (SP11) ----------
const REJECT = ['Not interested in this course', 'Too expensive', 'Do not like the city / country', 'Already applied elsewhere', 'Other'];
function RejectOption({ id, close, done }: { id: string; close: () => void; done: () => void }) {
  const [reason, setReason] = useState(''), [text, setText] = useState('');
  return (
    <Modal title={t('Reject this option')} size="sm" close={close} foot={<><button className="btn" onClick={close}>{t('Cancel')}</button><button className="btn danger solid" onClick={async () => { try { await POST(`/shortlist/${id}/reject`, { reason, text }); close(); done(); } catch (e) { showError(e); } }}>{t('Reject')}</button></>}>
      <div className="f"><label>{t('Reason')}<span className="req">*</span></label><select className="input" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">{t('Select...')}</option>{REJECT.map((x) => <option key={x} value={x}>{t(x)}</option>)}</select></div>
      <div className="f" style={{ marginTop: 8 }}><label>{t('Details')}</label><input className="input" maxLength={300} value={text} onChange={(e) => setText(e.target.value)} /></div>
      <p className="small muted">{t('You can undo this within 7 days.')}</p>
    </Modal>
  );
}
function Suggestion({ x, load }: { x: Any; load: () => void }) {
  const rq = x.req || {}, view = x.course_id && x.catalogue ? `/courses/${x.course_id}` : x.course_link;
  const stCls = x.status === 'Shared with student' ? 'orange' : x.status === 'Student agreed' ? 'green' : x.status === 'Rejected by student' ? 'grey' : 'blue';
  const accept = async () => { try { const r = await POST(`/shortlist/${x.id}/accept`); toast(t(r.message), 'ok'); load(); } catch (e) { showError(e); } };
  const reject = () => openOverlay((close) => <RejectOption id={x.id} close={close} done={load} />);
  const title = `${x.course} (${t(x.level)})`;
  return (
    <div className={`ccard ${x.deadline_passed || x.status === 'Rejected by student' ? 'dim' : ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <div className="ccard-hd"><img className="ccard-logo" src={apiSrc(x.logo)} alt="" loading="lazy" width={46} height={46} /><div className="ccard-uni">{x.university}{x.city ? <small>{x.city}</small> : null}</div><span className="ccard-country">{x.country}</span></div>
      <h3 className="ccard-title">{view ? (x.catalogue ? <Link href={view}>{title}</Link> : <a href={view} target="_blank" rel="noopener noreferrer">{title}</a>) : title}</h3>
      <div className="ccard-tags"><span className={`badge ${stCls}`}>{t(x.status_label)}</span>{x.is_new ? <span className="badge red">{t('New')}</span> : null}{x.student_response === 'Question asked' ? <span className="badge purple">{t('Question asked')}</span> : null}{x.priority ? <span className="badge">{x.priority}</span> : null}<EligBadge e={x.eligibility} /></div>
      <div className="ccard-boxes"><div><span>{t('Tuition fees')}</span><b>{x.tuition_fee === 0 ? t('Free') : money(x.tuition_fee, x.currency)}</b>{x.tuition_fee === 0 ? null : <small>/ {t('year')}</small>}</div>
        <div><span>{t('Application fees')}</span><b>{x.application_fee ? money(x.application_fee, x.app_fee_currency) : t('Free')}</b></div></div>
      <div className="ccard-rows">
        <div><span>{t('Academic Requirement')}</span>{reqAcademic(rq)}</div><div><span>{t('English Proficiency')}</span><b>{rq.english || '-'}</b></div><div><span>{t('Intake')}</span><b>{x.intake || '-'}</b></div>
        <div><span>{t('Deadline')}</span><b>{x.deadline ? <span className={x.deadline_passed ? 'muted' : dlClass(x.intake_deadline_days)}>{fmtDate(x.deadline)}{x.deadline_passed ? ' · ' + t('passed') : ' · ' + daysLeftTxt(x.intake_deadline_days)}</span> : '-'}</b></div>
        {x.duration ? <div><span>{t('Duration')}</span><b>{x.duration}{x.language ? ` · ${x.language}` : ''}</b></div> : null}</div>
      {x.remark_for_student ? <div className="info-box small">💬 {x.remark_for_student}</div> : null}{x.student_response_reason ? <div className="small muted">{t('Your reason')}: {x.student_response_reason}</div> : null}
      {x.deadline_passed ? <div className="small muted">{t('Deadline passed. Ask your counsellor about the next intake.')}</div> : null}
      <div className="ccard-acts">{x.status === 'Shared with student' ? <><button className="ccard-btn light" onClick={reject}>{t('Reject')}</button><button className="ccard-btn dark" disabled={x.deadline_passed} onClick={accept}>{t('Accept')}</button></>
        : x.status === 'Converted to application' && x.application_id ? <Link className="ccard-btn dark" href={`/applications/${x.application_id}`}>{t('View application')}</Link>
          : x.status === 'Student agreed' ? <><button className="ccard-btn light" onClick={reject}>{t('Reject')}</button><span className="ccard-btn dark off">✓ {t('Accepted')}</span></>
            : x.can_undo ? <button className="ccard-btn light" onClick={async () => { await POST(`/shortlist/${x.id}/undo`).catch(showError); load(); }}>{t('Undo')}</button> : null}</div>
      <div className="ccard-ft"><button className="btn xs ghost" onClick={() => openChatWith('shortlist', x.id, `${x.course} – ${x.university}`)}>💬 {t('Ask a question')}</button><span className="grow" />{x.course_link ? <a className="small" href={x.course_link} target="_blank" rel="noopener noreferrer">{t('Official page')} ↗</a> : null}</div>
    </div>
  );
}
export function Shortlist() {
  const me = usePMe((s) => s.me);
  const [d, setD] = useState<Any | null>(null);
  const load = useCallback(() => GET('/shortlist').then(setD).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;
  return (
    <>
      <div className="p-head"><h1>{t('My shortlist')}</h1><span className="grow" /><Link className="btn sm" href="/courses">{t('Course Search')}</Link></div>
      <h2 style={{ margin: '4px 0 10px' }}>{t('Suggested by your counsellor')}</h2>
      {me?.account_type === 'lead' ? <LockedCard /> : d.suggested.length ? <div className="courses">{d.suggested.map((x: Any) => <Suggestion key={x.id} x={x} load={load} />)}</div> : <div className="empty-p">{t('Your counsellor will share course options with you here.')}</div>}
      <h2 style={{ margin: '20px 0 10px' }}>{t('Saved by you')} ({d.saved.length})</h2>
      {d.saved.length ? <div className="courses">{d.saved.map((c: Any) => <CourseCard key={c.id} c={c} />)}</div> : <div className="empty-p">{t('Tap ♡ on a course to save it here.')} <Link href="/courses">{t('Course Search')}</Link></div>}
      <CmpTray />
    </>
  );
}
