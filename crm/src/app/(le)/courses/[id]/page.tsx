'use client';

import { Suspense, use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { GET } from '@/le/api';
import { apiSrc, fmtDate, money, qs } from '@/le/format';
import { showError } from '@/le/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const ELIG: Record<string, [string, string]> = { yes: ['Eligible', 'green'], maybe: ['Likely / close', 'orange'], no: ['Not eligible', 'red'], incomplete: ['Profile incomplete', 'grey'], unknown: ['No requirements', 'grey'] };
const Elig = ({ e }: { e?: Any }) => (e ? <span className={`badge ${ELIG[e.overall]?.[1] ?? 'grey'}`}>{ELIG[e.overall]?.[0] ?? e.overall}</span> : null);
const days = (n?: number | null) => (n === null || n === undefined ? '' : n < 0 ? 'passed' : n === 0 ? 'today' : `${n} days left`);
const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (children ? <div className="cd-row"><div className="cd-k">{k}</div><div className="cd-v">{children}</div></div> : null);

// The client's course detail (legacy/public/js/pages/coursesearch.js detail)
function Course({ id }: { id: string }) {
  const studentId = useSearchParams().get('student_id') ?? '';
  const [c, setC] = useState<Any | null>(null);
  useEffect(() => { GET(`/course-search/${id}` + qs({ student_id: studentId })).then(setC).catch(showError); }, [id, studentId]);
  if (!c) return <div className="empty">Loading...</div>;
  const e = c.eligibility, ints: Any[] = c.intakes || [], next = c.next_intake;
  const fresh = c.last_verified_on && (Date.now() - Date.parse(c.last_verified_on)) / 864e5 > 183;
  const state = (i: Any) => !i.open ? <span className="badge grey">Deadline passed</span> : !i.deadline ? <span className="badge">Dates not announced</span>
    : i.days_left <= 30 ? <span className="badge red">{days(i.days_left)}</span> : <span className="badge green">Open · {days(i.days_left)}</span>;
  return (
    <>
      <div className="page-head"><Link className="btn ghost sm" href={'/courses' + qs({ student_id: studentId })}>← Course search</Link></div>
      <div className="card"><div className="bd">
        <div className="cs-hd">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="cs-logo lg" src={apiSrc(c.logo || c.university.logo)} alt="" width={72} height={72} />
          <div className="grow" style={{ minWidth: 0 }}><div className="cs-uni" style={{ fontSize: 15 }}>{c.university.name}</div>
            <div className="small muted">{[c.city, c.country.name].filter(Boolean).join(', ')}{c.university.website ? <> · <a href={c.university.website} target="_blank" rel="noopener noreferrer">University website ↗</a></> : null}</div></div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{c.code ? <span className="badge blue mono">{c.code}</span> : null}
            {c.status !== 'Published' ? <span className="badge orange">{c.status || 'Draft'}: not visible to students</span> : <span className="badge green">Published</span>}</div>
        </div>
        <h1 style={{ margin: '14px 0 8px' }}>{c.name}</h1>
        <div className="cs-tags"><span className="badge blue">{c.level}</span>{c.field ? <span className="badge">{c.field}</span> : null}<Elig e={e} />{c.aps_required ? <span className="badge orange">APS required</span> : null}{c.in_shortlist ? <span className="badge green">In shortlist</span> : null}</div>
        {c.official_link ? <div className="row" style={{ marginTop: 14, gap: 8 }}><a className="btn primary sm" href={c.official_link} target="_blank" rel="noopener noreferrer">Official course page ↗</a></div> : null}
      </div></div>
      <div className="cd-tiles">
        <div className="cd-tile"><div className="cd-k">Tuition / year</div><b>{c.tuition_fee === 0 ? 'Free' : money(c.tuition_fee, c.currency)}</b>{c.tuition_fee_non_eu ? <div className="small muted">non-EU {money(c.tuition_fee_non_eu, c.currency)}</div> : null}</div>
        <div className="cd-tile"><div className="cd-k">Application fee</div><b>{c.application_fee ? money(c.application_fee, c.application_fee_currency) : 'Free'}</b></div>
        <div className="cd-tile"><div className="cd-k">Duration · language</div><b>{c.duration || '-'}</b><div className="small muted">{c.language || '-'}</div></div>
        <div className={`cd-tile ${next?.deadline && next.days_left <= 30 ? 'warn' : ''}`}><div className="cd-k">Next deadline</div>
          {next ? (next.deadline ? <><b>{fmtDate(next.deadline)}</b><div className="small muted">{next.label} · {days(next.days_left)}</div></> : <><b>{next.label}</b><div className="small muted">Deadline not announced yet</div></>)
            : ints.length ? <><b>Closed</b><div className="small muted">All deadlines passed</div></> : <><b>-</b><div className="small muted">No intake added</div></>}</div>
      </div>
      <div className="cd-grid">
        <div className="cd-col">
          <div className="card"><div className="hd"><h2>Intakes and deadlines</h2></div><div className="table-wrap"><table className="t cards"><thead><tr><th>Intake</th><th>Application opens</th><th>Deadline</th><th>Status</th></tr></thead><tbody>
            {ints.length ? ints.map((i, n) => (
              <tr key={n} className={i.open ? '' : 'muted'}><td className="nowrap" data-label="Intake"><b>{i.label}</b></td>
                <td data-label="Application opens">{i.open_date ? fmtDate(i.open_date) : <span className="muted">Not announced</span>}</td>
                <td data-label="Deadline">{i.deadline ? <b>{fmtDate(i.deadline)}</b> : <span className="muted">Not announced</span>}{i.deadline_note ? <div className="small muted">{i.deadline_note}</div> : null}</td>
                <td data-label="Status">{state(i)}</td></tr>
            )) : <tr><td colSpan={4} className="empty">No intake added yet</td></tr>}
          </tbody></table></div></div>
          <div className="card"><div className="hd"><h2>Fees</h2></div><div className="bd">
            <Row k="Tuition per year"><b>{c.tuition_fee === 0 ? 'Free' : money(c.tuition_fee, c.currency)}</b></Row>
            <Row k="Tuition non-EU">{c.tuition_fee_non_eu ? money(c.tuition_fee_non_eu, c.currency) : null}</Row>
            <Row k="Application fee">{c.application_fee ? money(c.application_fee, c.application_fee_currency) : 'Free'}</Row>
            {c.fee_note ? <div className="cd-note">{c.fee_note}</div> : null}
          </div></div>
          {c.scholarship ? <div className="card"><div className="hd"><h2>Scholarship</h2></div><div className="bd"><p className="cd-text">{c.scholarship}</p></div></div> : null}
          {c.description ? <div className="card"><div className="hd"><h2>About the course</h2></div><div className="bd"><p className="cd-text">{c.description}</p></div></div> : null}
        </div>
        <div className="cd-col">
          <div className="card"><div className="hd"><h2>Entry requirements</h2></div><div className="bd">
            <Row k="English">{(c.english || []).filter(Boolean).length ? (c.english || []).filter(Boolean).map((x: string, i: number) => <div key={i}>{x}</div>) : null}</Row>
            <Row k="Previous study">{c.academic || null}</Row>
            {(c.other || []).map((o: string, i: number) => <Row key={i} k="Other">{o}</Row>)}
            {c.aps_required ? <Row k="Germany">APS certificate needed</Row> : null}
            {!(c.english || []).length && !c.academic ? <p className="muted small" style={{ margin: 0 }}>No requirements added yet.</p> : null}
          </div></div>
          {e ? <div className="card"><div className="hd"><h2>Eligibility for this student</h2><Elig e={e} /></div><div className="bd">
            {e.checks?.length ? <ul className="plain">{e.checks.map((x: Any, i: number) => <li key={i}><b className={x.result === 'yes' ? 'text-green' : x.result === 'maybe' ? 'text-orange' : 'text-red'}>{x.result === 'yes' ? '✓' : x.result === 'maybe' ? '?' : '✕'} {x.name}</b><div className="small">{x.reason}</div></li>)}</ul> : <p className="muted">{e.label}</p>}
            <p className="small muted">Guide only. The university decides.</p>
          </div></div> : null}
          <div className="card"><div className="bd small">
            <Row k="Last verified"><span className={fresh ? 'days-red' : ''}>{fmtDate(c.last_verified_on) || 'never'}</span>{fresh ? ' · older than 6 months' : ''}</Row>
            {c.official_link ? <Row k="Course page"><a href={c.official_link} target="_blank" rel="noopener noreferrer" style={{ wordBreak: 'break-all' }}>{String(c.official_link).replace(/^https:\/\//, '')}</a></Row> : null}
          </div></div>
        </div>
      </div>
    </>
  );
}
export default function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <Suspense><Course id={id} /></Suspense>; }
