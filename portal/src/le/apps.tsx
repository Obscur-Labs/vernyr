'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiError, GET, POST, SEND } from './api';
import { ago, fmtDate, fmtDT, istToday, money } from './format';
import { Options } from './form';
import { Modal, confirmBox, openOverlay, showError, toast } from './ui';
import { LockedCard, openLink, t, type Any } from './p';
import { openChatWith, taskDone, uploadDialog, uploadFilesDialog } from './docs';
import { ShareConsents } from './share';

/** The client's applications, payments, visa and tasks (legacy/public/portal/js/apps.js). */

const Safety = () => <div className="safety">⚠ {t('Always check payment details with your counsellor before paying. La Europa will never ask you to pay university fees to a personal account.')}</div>;
const Loading = () => <div className="empty-p">{t('Loading...')}</div>;
const ss = (k: string, d: string) => { try { return sessionStorage.getItem(k) || d; } catch { return d; } };
const ssSet = (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* storage blocked */ } };
const errsOf = (e: unknown) => (e instanceof ApiError && e.data.errors ? e.data.errors : {});
const Msg = ({ e, k }: { e: Record<string, string>; k: string }) => <div className="msg">{e[k] ?? ''}</div>;

// ---------- list (SP13) ----------
export function ApplicationsList() {
  const [d, setD] = useState<Any | null>(null);
  const [f, setF] = useState(() => ss('lep:appf', 'active'));
  const load = useCallback(() => GET('/applications').then(setD).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;
  const closed = (a: Any) => ['rejected', 'withdrawn', 'offer_declined'].includes(a.stage);
  const offers = (a: Any) => ['conditional_offer', 'unconditional_offer', 'offer_accepted'].includes(a.stage);
  const apps = d.applications.filter((a: Any) => (f === 'closed' ? closed(a) : f === 'offers' ? offers(a) : !closed(a)));
  const cancel = async (id: string) => {
    const r = await confirmBox(t('Cancel this request?'), { reason: true, reasonLabel: t('Reason (optional)'), ok: t('Yes, cancel'), cancel: t('No') });
    if (r) { try { await POST(`/application-requests/${id}/cancel`, { reason: r }); toast(t('Request cancelled'), 'ok'); load(); } catch (e) { showError(e); } }
  };
  return (
    <>
      <div className="p-head"><h1>{t('My Applications')}</h1><span className="grow" /><Link className="btn sm" href="/courses">{t('Find courses')}</Link></div>
      <ShareConsents onChange={load} />
      {d.locked ? <LockedCard /> : <>
        <div className="chips-x">{[['active', 'Active'], ['offers', 'Offers'], ['closed', 'Closed']].map(([k, l]) => <span key={k} className={`chip ${f === k ? '' : 'off'}`} onClick={() => { ssSet('lep:appf', k); setF(k); }}>{t(l)}</span>)}</div>
        <div className="p-card"><div className="bd flush">{apps.length ? apps.map((a: Any) => (
          <Link key={a.id} className="rowx" href={`/applications/${a.id}`}><div className="grow"><div className="t">{a.university} <span className="country-pill"><i>{a.country_code || ''}</i>{a.country}</span></div>
            <div className="s">{a.course} · {t(a.level)} · {a.intake}{a.applied_date ? ` · ${t('Applied')} ${fmtDate(a.applied_date)}` : ''}</div><div className="s">{t(a.next_step)} · {t('Updated')} {ago(a.updated_at)}</div></div>
            <span className="badge solid" style={{ background: a.stage_color }}>{t(a.stage_name)}</span></Link>
        )) : <div className="empty-p">{t('No applications here yet.')}<br /><Link className="btn primary" href="/courses" style={{ marginTop: 10 }}>{t('Explore courses')}</Link></div>}</div></div>
      </>}
      <h2 style={{ margin: '20px 0 10px' }}>{t('Requests sent to La Europa')}</h2>
      <div className="p-card"><div className="bd flush">{d.requests.length ? d.requests.map((q: Any) => (
        <div key={q.id} className="rowx"><div className="grow"><div className="t">{q.course} · {q.university}</div>
          <div className="s">{q.intake} · <span className="mono">{q.code}</span> · {t('Sent to La Europa on')} {fmtDate(q.requested_at)}</div>
          <div className="s">{t('Status:')} <b>{t(q.status_label)}</b>{q.decline_reason ? ` · ${t('Your counsellor has not taken this request forward. Reason:')} ${q.decline_reason}` : ''}</div></div>
          {q.can_cancel ? <button className="btn sm" onClick={() => cancel(q.id)}>{t('Cancel request')}</button> : ['In review', 'Info needed'].includes(q.status) ? <span className="small muted">{t('Please message your counsellor to cancel.')}</span> : null}</div>
      )) : <div className="empty-p">{t('No requests yet. Use Apply Now on a course.')}</div>}</div></div>
    </>
  );
}

// ---------- visa (SP17): shown inside its application ----------
function VisaDecision({ id, close, done }: { id: string; close: () => void; done: () => void }) {
  const [v, setV] = useState({ decision: '', decision_date: '' }), [files, setFiles] = useState<FileList | null>(null), [err, setErr] = useState<Record<string, string>>({});
  const go = async () => {
    setErr({});
    const fd = new FormData(); fd.append('decision', v.decision); fd.append('decision_date', v.decision_date); for (const x of [...(files ?? [])]) fd.append('files', x);
    try { const r = await SEND('post', `/visa/${id}/decision`, fd); toast(t(r.message), 'ok'); close(); done(); } catch (e) { setErr(errsOf(e)); showError(e); }
  };
  return (
    <Modal title={t('Upload my visa decision')} close={close} foot={<><button className="btn" onClick={close}>{t('Cancel')}</button><button className="btn primary" onClick={go}>{t('Upload')}</button></>}>
      <form noValidate onSubmit={(e) => e.preventDefault()}><div className="form-grid">
        <div className={`f c3${err.decision ? ' err' : ''}`}><label>{t('Decision')}<span className="req">*</span></label><select value={v.decision} onChange={(e) => setV({ ...v, decision: e.target.value })}><option value="">{t('Select...')}</option><option value="Approved">{t('Approved')}</option><option value="Rejected">{t('Rejected')}</option></select><Msg e={err} k="decision" /></div>
        <div className={`f c3${err.decision_date ? ' err' : ''}`}><label>{t('Decision date')}<span className="req">*</span></label><input type="date" max={istToday()} value={v.decision_date} onChange={(e) => setV({ ...v, decision_date: e.target.value })} /><Msg e={err} k="decision_date" /></div>
        <div className={`f c6${err.files ? ' err' : ''}`}><label>{t('Visa page / refusal letter (PDF or photo)')}</label><input type="file" accept=".pdf,.jpg,.jpeg,.png" capture="environment" multiple onChange={(e) => setFiles(e.target.files)} /><Msg e={err} k="files" /></div>
      </div></form>
      <p className="small muted">{t('Your counsellor will check it and update your visa status.')}</p>
    </Modal>
  );
}
function VisaCards({ cases, predeparture, reload }: { cases: Any[]; predeparture: Any[]; reload: () => void }) {
  return <>
    {cases.map((v) => (
      <div key={v.id} className="p-card">
        <div className="hd"><h2>{t('Visa')} · {v.country}</h2><span className="badge blue">{t(v.stage_name)}</span>{v.attempt_no > 1 ? <span className="badge">{t('Attempt')} {v.attempt_no}</span> : null}<span className="grow" /><span className="mono small muted">{v.code}</span></div>
        <div className="bd">
          {v.previous_attempts.length ? <details style={{ marginBottom: 10 }}><summary className="small">{t('Earlier attempts')}</summary>{v.previous_attempts.map((a: Any) => <div key={a.attempt_no} className="small">{t('Attempt')} {a.attempt_no}: {a.decision || ''} {fmtDate(a.decision_date)}</div>)}</details> : null}
          {v.appointment ? <>
            <h4 style={{ margin: '0 0 6px' }}>{t('Appointment')}</h4><div className="money-row"><span>{t('Date and time')}</span><b>{fmtDT(v.appointment.at)} IST</b></div>
            <div className="money-row"><span>{t('Centre')}</span><span>{v.appointment.centre || ''} {v.appointment.map ? <a href={v.appointment.map} target="_blank" rel="noopener noreferrer">{t('Map')}</a> : null}</span></div>
            <div className="money-row"><span>{t('Reference number')}</span><span className="mono">{v.appointment.reference || '-'}</span></div>
            <p className="small">{v.appointment.carry}</p><button className="btn sm" onClick={() => openLink(v.appointment.ics, 'visa-appointment.ics')}>{t('Add to calendar')}</button>
          </> : null}
          <h4 style={{ margin: '14px 0 6px' }}>{t('Status')}</h4>
          {v.funds.type ? <div className="money-row"><span>{t('Proof of funds')}</span><span>{v.funds.type}{v.funds.blocked_status ? ` · ${v.funds.blocked_status}` : ''}{v.funds.provider ? ` (${v.funds.provider})` : ''}</span></div> : null}
          <div className="money-row"><span>{t('Health / travel insurance')}</span><span>{t(v.insurance_status || 'Not started')}</span></div><div className="money-row"><span>{t('Accommodation')}</span><span>{t(v.accommodation_status || 'Not arranged')}</span></div>
          {v.aps ? <><div className="money-row"><span>APS</span><span>{v.aps.status || 'Not applied'}{v.aps.reference ? ` · ${v.aps.reference}` : ''}{v.aps.date ? ` · ${fmtDate(v.aps.date)}` : ''}</span></div>{v.aps.link ? <a className="small" href={v.aps.link} target="_blank" rel="noopener noreferrer">{t('Official APS India website')}</a> : null}</> : null}
          {v.decision ? <div className={`p-banner ${v.decision.decision === 'Approved' ? 'ok' : 'err'}`} style={{ marginTop: 10 }}>{v.decision.decision === 'Approved' ? `${t('Visa approved')}${v.decision.valid_from ? ` · ${t('valid')} ${fmtDate(v.decision.valid_from)} – ${fmtDate(v.decision.valid_to)}` : ''}` : `${t('Visa not approved')}${v.decision.reason ? `: ${v.decision.reason}` : ''}`}</div> : null}
          {['submitted', 'biometrics', 'appointment_booked'].includes(v.stage) ? <button className="btn sm" style={{ marginTop: 8 }} onClick={() => openOverlay((close) => <VisaDecision id={v.id} close={close} done={reload} />)}>{t('Upload my visa decision')}</button> : null}
          {v.travel_date ? <p>{t('Travel date')}: <b>{fmtDate(v.travel_date)}</b></p> : null}
          <h4 style={{ margin: '16px 0 6px' }}>{t('Visa checklist')} <span className="small muted">{t('{a} of {b} ready', { a: v.ready, b: v.checklist.length })}</span></h4>
        </div>
        <div className="bd flush">{v.checklist.map((x: Any) => (
          <div key={x.type_id} className="doc-item"><div className="grow"><b>{t(x.name)}</b><div className={`small st-${x.status}`}>{t(x.status_label)}{x.reason ? ': ' + x.reason : ''}</div></div>
            <div className="acts">{x.doc?.view_url ? <a className="btn xs" href={x.doc.view_url} target="_blank" rel="noopener noreferrer">{t('View')}</a> : null}
              {x.status !== 'Verified' ? <button className="btn xs" onClick={async () => { if (await uploadFilesDialog({ title: `${t('Upload')}: ${x.name}`, url: `/visa/${v.id}/upload`, extra: { document_type_id: x.type_id } })) reload(); }}>{x.status === 'Rejected' ? t('Re-upload') : t('Upload')}</button> : null}</div></div>
        ))}</div>
      </div>
    ))}
    {predeparture.length ? <div className="p-card"><div className="hd"><h2>{t('Pre-departure')}</h2></div><div className="bd flush">{predeparture.map((x, i) => <Link key={i} className="rowx" href="/tasks"><span className="grow t">{x.title}</span><span className="small">{fmtDate(x.due_at)}</span></Link>)}</div></div> : null}
  </>;
}

// ---------- detail (SP14) ----------
function AcceptOffer({ a, close, done }: { a: Any; close: () => void; done: () => void }) {
  const [ok, setOk] = useState(false);
  const go = async () => {
    if (!ok) { toast(t('Please tick the confirmation box'), 'err'); return; }
    try { await POST(`/applications/${a.id}/accept-offer`, { confirm: true }); close(); toast(t('We have received your offer acceptance.'), 'ok'); done(); } catch (e) { showError(e); }
  };
  return (
    <Modal title={t('Accept this offer')} close={close} foot={<><button className="btn" onClick={close}>{t('Cancel')}</button><button className="btn primary" onClick={go}>{t('Accept offer')}</button></>}>
      <div className="kv"><div><div className="k">{t('University')}</div><div className="v">{a.university}</div></div><div><div className="k">{t('Course')}</div><div className="v">{a.course}</div></div>
        <div><div className="k">{t('Intake')}</div><div className="v">{a.intake}</div></div>{a.offer_deadline ? <div><div className="k">{t('Acceptance deadline')}</div><div className="v">{fmtDate(a.offer_deadline)}</div></div> : null}
        {a.deposit_required ? <div><div className="k">{t('Deposit')}</div><div className="v">{money(a.deposit_required, a.deposit_currency)}</div></div> : null}</div>
      <p>{t('Your counsellor will confirm the acceptance with the university for you. Please do not make any payment to the university before talking to your counsellor.')}</p>
      <label className="consent"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> <span>{t('I have read the offer letter and want to accept this offer.')}</span></label>
    </Modal>
  );
}
export function ApplicationDetail({ id }: { id: string }) {
  const [a, setA] = useState<Any | null>(null);
  const [visa, setVisa] = useState<Any | null>(null);
  const load = useCallback(() => {
    GET('/applications/' + id).then(setA).catch(showError);
    GET('/visa').then((d) => setVisa(d.locked ? null : d)).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);
  if (!a) return <Loading />;
  const offerStage = ['conditional_offer', 'unconditional_offer'].includes(a.stage);
  const ask = () => openChatWith('application', a.id, `${a.code}: ${a.course}`);
  const cases = (visa?.cases ?? []).filter((v: Any) => v.application_id === a.id);
  const decline = async () => {
    const r = await confirmBox(`${t('Decline the offer from')} ${a.university}? ${t('The application will close as “Offer declined by student” and your counsellor will be told.')}`, { reason: true, reasonLabel: t('Reason (optional)'), ok: t('Decline offer'), cancel: t('Back'), danger: true });
    if (r) { try { await POST(`/applications/${a.id}/decline-offer`, { confirm: true, reason: typeof r === 'string' ? r : '' }); toast(t('The offer was declined.'), 'ok'); load(); } catch (e) { showError(e); } }
  };
  const undo = async () => { if (await confirmBox(t('Undo your offer acceptance?'))) { try { await POST(`/applications/${a.id}/undo-accept`); load(); } catch (e) { showError(e); } } };
  return (
    <>
      <div className="p-head"><Link className="btn ghost sm" href="/applications">← {t('My Applications')}</Link></div>
      <div className="p-card" style={{ marginBottom: 14 }}><div className="bd">
        <div className="small muted">{a.country} · {a.intake} · <span className="mono">{a.code}</span>{a.university_app_id ? ` · ${t('University reference')}: ${a.university_app_id}` : ''}</div>
        <h1 style={{ margin: '4px 0' }}>{a.university}</h1><div>{a.course} · {t(a.level)}</div>
        <div style={{ marginTop: 8 }}><span className="badge solid" style={{ background: a.stage_color }}>{t(a.stage_name)}</span>{a.offer_response === 'Accepted' ? <> <span className="badge green">{t('You accepted this offer on')} {fmtDate(a.offer_response_at)}</span></> : null}</div>
        <div className="row" style={{ marginTop: 12 }}><button className="btn sm" onClick={ask}>{t('Ask about this application')}</button></div>
      </div></div>
      <div className="p-grid two"><div className="p-grid">
        <div className="p-card"><div className="hd"><h2>{t('Progress')}</h2></div><div className="bd"><ul className="vt">{a.timeline.map((s: Any) => (
          <li key={s.code} className={s.current ? (['rejected', 'withdrawn', 'offer_declined', 'visa_rejected'].includes(s.code) ? 'bad' : 'cur') : s.done ? 'done' : ''}><span className="dot">{s.done ? '✓' : s.current ? '●' : ''}</span>
            <div className="nm">{t(s.name)}{s.date ? <> <span className="small muted">{fmtDate(s.date)}</span></> : null}</div>{s.text ? <div className="tx">{t(s.text)}</div> : null}{s.reason ? <div className="tx">{t('Reason:')} {s.reason}</div> : null}
            {s.current && s.code === 'interview' && a.interview_at ? <div className="tx"><button className="btn xs" onClick={() => openLink(`/api/portal/calendar/interview/${a.id}.ics`, 'interview.ics')}>{t('Add to calendar')}</button></div> : null}
            {s.current && s.code === 'documents_pending' ? <div className="tx">{a.documents.filter((x: Any) => x.required === 'Yes' && ['Pending', 'Rejected'].includes(x.status)).map((x: Any) => (
              <div key={x.type_id} className="row" style={{ marginTop: 4 }}><span className="grow">{x.name} <span className={`small st-${x.status}`}>{t(x.status === 'Rejected' ? 'Rejected' : 'Missing')}</span></span>
                <button className="btn xs" onClick={async () => { if (await uploadDialog({ type_id: x.type_id, name: x.name })) load(); }}>{t('Upload')}</button></div>))}</div> : null}
          </li>
        ))}</ul></div></div>
        {cases.length ? <VisaCards cases={cases} predeparture={visa?.predeparture ?? []} reload={load} /> : null}
        <div className="p-card"><div className="hd"><h2>{t('From the university')}</h2><span className="grow" /><Link className="small" href="/documents?tab=institution">{t('All documents')}</Link></div><div className="bd flush">
          {a.university_documents.length ? a.university_documents.map((x: Any) => <div key={x.id} className="rowx"><div className="grow"><div className="t">{t(x.name)}</div><div className="s">{fmtDate(x.date)}</div></div>
            <a className="btn xs" href={x.view_url} target="_blank" rel="noopener noreferrer">{t('View')}</a><a className="btn xs" href={x.download_url}>{t('Download')}</a></div>)
            : <div className="empty-p small">{t('Offer letters, invoices and other documents from this university will appear here and in Documents.')}</div>}</div></div>
        <div className="p-banner info" style={{ margin: 0 }}><span className="grow">{t('Your documents are uploaded once, in Documents. La Europa uses the same documents for every university.')}</span><Link className="btn sm" href="/documents">{t('Documents')}</Link></div>
      </div><div className="p-grid">
        {a.offer_letter || a.offer_conditions || a.conditions.length || offerStage ? <div className="p-card"><div className="hd"><h2>{t('Offer')}</h2></div><div className="bd">
          {a.offer_letter ? <div className="row" style={{ marginBottom: 10 }}><b className="grow">{t('Offer letter')}</b><a className="btn sm" href={a.offer_letter.view_url} target="_blank" rel="noopener noreferrer">{t('View')}</a><a className="btn sm" href={a.offer_letter.download_url}>{t('Download')}</a></div>
            : offerStage ? <p className="small muted">{t('Your counsellor will share the offer letter with you.')}</p> : null}
          {a.offer_deadline ? <p>{t('Offer acceptance deadline')}: <b>{fmtDate(a.offer_deadline)}</b></p> : null}{a.deposit_required ? <p>{t('Deposit required')}: <b>{money(a.deposit_required, a.deposit_currency)}</b></p> : null}
          {a.conditions.length ? <><h4>{t('Conditions')}</h4><ul className="list-plain">{a.conditions.map((c: Any) => (
            <li key={c.id}><span className={`badge ${c.status === 'Met' ? 'green' : c.status === 'Waived' ? 'grey' : 'orange'}`}>{t(c.status)}</span><span className="grow">{c.text}</span>
              {c.status === 'Open' ? <button className="btn xs" onClick={async () => { if (await uploadFilesDialog({ title: t('Upload proof for this condition'), url: `/offer-conditions/${c.id}/proof` })) load(); }}>{c.proof_document_id ? t('Upload again') : t('Upload proof')}</button> : null}</li>
          ))}</ul></> : a.offer_conditions ? <><h4>{t('Conditions')}</h4><p style={{ whiteSpace: 'pre-wrap' }}>{a.offer_conditions}</p></> : null}
          {a.can_accept ? <button className="btn primary block" onClick={() => openOverlay((close) => <AcceptOffer a={a} close={close} done={load} />)}>{t('I want to accept this offer')}</button> : null}
          {a.accepted_elsewhere ? <div className="p-banner info">{t('You have already accepted an offer from')} {a.accepted_elsewhere}. {t('Message your counsellor if you want to change.')}</div> : null}
          {a.can_undo_accept ? <div className="p-banner ok"><span className="grow">{t('Your counsellor will confirm the acceptance with the university for you.')}</span><button className="btn sm" onClick={undo}>{t('Undo my acceptance')}</button></div> : null}
          {offerStage ? <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={ask}>{t('I have a question')}</button> : null}{a.can_decline ? <button className="btn sm danger" style={{ marginTop: 8 }} onClick={decline}>{t('Decline this offer')}</button> : null}
        </div></div> : null}
        {a.fee_instructions ? <div className="p-card"><div className="hd"><h2>{t('Fee deposit instructions')}</h2></div><div className="bd"><Safety />
          <div className="kv" style={{ margin: '10px 0' }}><div><div className="k">{t('Amount to pay')}</div><div className="v"><b>{money(a.fee_instructions.amount, a.fee_instructions.currency)}</b></div></div>
            <div><div className="k">{t('Pay by')}</div><div className="v">{fmtDate(a.fee_instructions.due_date)}</div></div><div><div className="k">{t('Pay to')}</div><div className="v">{a.fee_instructions.pay_to}</div></div></div>
          <div className="instr" dangerouslySetInnerHTML={{ __html: a.fee_instructions.instructions_html }} />
          {a.fee_instructions.file_url ? <button className="btn sm" onClick={() => openLink(a.fee_instructions.file_url)}>{t('Open attached file')}</button> : null}
          <Link className="btn sm primary" href="/payments" style={{ marginLeft: 6 }}>{t('I have made a payment')}</Link></div></div> : null}
        <div className="p-card"><div className="hd"><h2>{t('Details')}</h2></div><div className="bd"><div className="kv">
          {a.applied_date ? <div><div className="k">{t('Applied date')}</div><div className="v">{fmtDate(a.applied_date)}</div></div> : null}
          {a.deadline ? <div><div className="k">{t('Deadline')}</div><div className="v">{fmtDate(a.deadline)}</div></div> : null}
          {a.interview_at ? <div><div className="k">{t('Interview')}</div><div className="v">{fmtDT(a.interview_at)}{a.interview_link ? <><br />{a.interview_link}</> : null}</div></div> : null}
          {a.app_fee !== null && a.app_fee !== undefined ? <div><div className="k">{t('Application fee')}</div><div className="v">{money(a.app_fee, a.app_fee_currency)} {a.app_fee_paid ? <span className="badge green">{t('paid')}</span> : null}</div></div> : null}
        </div></div></div>
        <div className="p-card"><div className="hd"><h2>{t('Updates')}</h2></div><div className="bd flush">{a.updates.length ? a.updates.map((u: Any, i: number) => <div key={i} className="rowx"><div className="grow"><div>{u.title}</div><div className="s">{ago(u.created_at)}</div></div></div>) : <div className="empty-p">-</div>}</div></div>
      </div></div>
    </>
  );
}

// ---------- payments (SP16) ----------
function Hist({ rows }: { rows: Any[] }) {
  return rows.length ? <table className="t cards"><thead><tr><th>{t('Date')}</th><th>{t('Amount')}</th><th>{t('Mode')}</th><th>{t('Reference')}</th><th>{t('Receipt')}</th></tr></thead><tbody>{rows.map((p, i) => (
    <tr key={p.id ?? i}><td data-label={t('Date')}>{fmtDate(p.date)}</td><td data-label={t('Amount')}><b>{money(p.amount, p.currency)}</b><div className="small muted">{t(p.payment_for)}</div></td>
      <td data-label={t('Mode')} className="small">{p.mode}</td><td data-label={t('Reference')} className="mono small">{p.reference_no || ''}</td>
      <td data-label={t('Receipt')}>{p.receipt_url ? <a href="#" onClick={(e) => { e.preventDefault(); openLink(p.receipt_url); }}>{t('View')}</a> : '-'}</td></tr>
  ))}</tbody></table> : <div className="empty-p small">{t('No payments recorded yet')}</div>;
}
const copy = async (v: string) => { try { await navigator.clipboard.writeText(v); toast(t('Copied'), 'ok'); } catch { /* clipboard blocked */ } };
function InvoiceCard({ i, bank, proof }: { i: Any; bank: Any | null; proof: () => void }) {
  const badge = ({ Unpaid: i.overdue ? 'red' : 'orange', 'Proof submitted': 'blue', Paid: 'green' } as Record<string, string>)[i.status] || '';
  const label = ({ Unpaid: i.overdue ? t('Overdue') : t('To pay'), 'Proof submitted': t('Proof submitted: waiting for confirmation'), Paid: t('Paid') } as Record<string, string>)[i.status] || i.status;
  const row = (k: string, v?: string, cp?: boolean) => (v ? <div className="money-row"><span>{t(k)}</span><b className="mono">{v}{cp ? <> <button className="btn xs" type="button" onClick={() => copy(v)}>{t('Copy')}</button></> : null}</b></div> : null);
  return (
    <div className="p-card" style={{ marginBottom: 12 }}>
      <div className="hd"><span className={`badge ${i.gst ? 'blue' : 'grey'}`}>{t(i.doc_label)}</span><h3 className="mono" style={{ marginLeft: 6 }}>{i.invoice_no}</h3><span className="small muted">{fmtDate(i.invoice_date)} · {t('due')} {fmtDate(i.due_date)}</span><span className="grow" /><span className={`badge ${badge}`}>{label}</span></div>
      <div className="bd">
        <p style={{ margin: '0 0 8px' }}>{i.description} · {t('Student ID')} <b className="mono">{i.student_code}</b></p>
        {!i.gst ? <><div className="money-row"><span>{t('Amount')}</span><b>{money(i.taxable, 'INR')}</b></div><div className="money-row"><span>GST</span><b>{t('Not applicable')}</b></div>{i.note ? <p className="small muted" style={{ margin: '6px 0' }}>{t(i.note)}</p> : null}</>
          : <><div className="money-row"><span>{t('Service fee (taxable)')}</span><b>{money(i.taxable, 'INR')}</b></div>
            {i.igst ? <div className="money-row"><span>IGST 18%</span><b>{money(i.igst, 'INR')}</b></div> : <><div className="money-row"><span>CGST 9%</span><b>{money(i.cgst, 'INR')}</b></div><div className="money-row"><span>SGST 9%</span><b>{money(i.sgst, 'INR')}</b></div></>}</>}
        {i.round_off ? <div className="money-row"><span>{t('Round off')}</span><b>{money(i.round_off, 'INR')}</b></div> : null}
        <div className="money-row" style={{ fontSize: '1.08em' }}><span><b>{t('Total to pay')}</b></span><b>{money(i.total, 'INR')}</b></div>
        <div className="row" style={{ marginTop: 8, gap: 8 }}><button className="btn sm" onClick={() => openLink(`/api/portal/invoices/${i.id}/invoice.pdf`, `${i.invoice_no}.pdf`)}>{i.gst ? t('Download invoice (PDF)') : t('Download payment request (PDF)')}</button>
          {i.receipt_no ? <button className="btn sm primary" onClick={() => openLink(`/api/portal/invoices/${i.id}/receipt.pdf`, `${i.receipt_no}.pdf`)}>{t('Download receipt')} {i.receipt_no}</button> : null}</div>
        {i.status === 'Unpaid' ? <>
          <div className="inv-pay" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            <div style={{ flex: 1, minWidth: 240 }}><h4 style={{ margin: '0 0 6px' }}>{t('Pay by bank transfer or UPI')}</h4>
              <div className="p-banner warn" style={{ margin: '0 0 8px' }}>{t('Payment reference: write')} <b className="mono">{i.invoice_no}</b> {t('in the remarks / reference of your payment.')}</div>
              {bank ? <>{row('Account holder', bank.account_name)}{row('Bank', bank.bank_name)}{row('Account number', bank.account_no, true)}{row('IFSC', bank.ifsc, true)}{row('Account type', bank.account_type)}{row('Branch', bank.branch)}{row('UPI ID', bank.upi_id, true)}</>
                : <p className="muted small">{t('Ask your counsellor for the bank details.')}</p>}</div>
            {i.upi_qr ? <div style={{ textAlign: 'center', minWidth: 180 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={i.upi_qr} alt="UPI QR" width={180} height={180} style={{ border: '1px solid var(--line)', borderRadius: 12 }} /><div className="small muted">{t('Scan with any UPI app: the amount and invoice number are filled in')}</div>
              {i.upi_link ? <a className="btn sm" href={i.upi_link} style={{ marginTop: 6 }}>{t('Open UPI app')}</a> : null}</div> : null}
          </div>
          {i.last_proof?.status === 'Rejected' ? <div className="p-banner warn" style={{ marginTop: 10 }}>{t('Your last payment proof was not accepted')}: {i.last_proof.reject_reason || ''}</div> : null}
          <div style={{ marginTop: 12 }}><button className="btn primary" onClick={proof}>{t('Upload payment proof')}</button> <span className="small muted">{t('After paying, upload the screenshot or bank receipt here.')}</span></div>
        </> : null}
      </div>
    </div>
  );
}
function InvoiceProof({ i, modes, close, done }: { i: Any; modes: string[]; close: () => void; done: () => void }) {
  const [v, setV] = useState({ utr: '', payment_date: istToday(), mode: 'UPI', note: '' }), [file, setFile] = useState<File | null>(null), [err, setErr] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const go = async () => {
    setErr({});
    const fd = new FormData(); for (const [k, x] of Object.entries(v)) if (x) fd.append(k, x.trim()); if (file) fd.append('receipt', file);
    try { const r = await SEND('post', `/invoices/${i.id}/proof`, fd); toast(t(r.message), 'ok'); close(); done(); } catch (e) { setErr(errsOf(e)); showError(e); }
  };
  return (
    <Modal title={`${t('Upload payment proof')}: ${i.invoice_no}`} close={close} foot={<><button className="btn" onClick={close}>{t('Cancel')}</button><button className="btn primary" onClick={go}>{t('Submit proof')}</button></>}>
      <p className="small" style={{ marginTop: 0 }}>{t('Amount')}: <b>{money(i.total, 'INR')}</b> · {t('Reference')}: <b className="mono">{i.invoice_no}</b></p>
      <form noValidate onSubmit={(e) => e.preventDefault()}><div className="form-grid">
        <div className={`f c3${err.utr ? ' err' : ''}`}><label>{t('UTR / transaction number')}<span className="req">*</span></label><input maxLength={60} autoComplete="off" placeholder={t('From your bank or UPI app')} value={v.utr} onChange={set('utr')} /><Msg e={err} k="utr" /></div>
        <div className={`f c3${err.payment_date ? ' err' : ''}`}><label>{t('Payment date')}<span className="req">*</span></label><input type="date" max={istToday()} value={v.payment_date} onChange={set('payment_date')} /><Msg e={err} k="payment_date" /></div>
        <div className={`f c3${err.mode ? ' err' : ''}`}><label>{t('Paid by')}<span className="req">*</span></label><select value={v.mode} onChange={set('mode')}><Options list={['UPI', 'Bank transfer (NEFT / RTGS / IMPS)', ...(modes || []).filter((x) => !/^(UPI|Bank transfer)/i.test(x))]} /></select><Msg e={err} k="mode" /></div>
        <div className={`f c6${err.receipt ? ' err' : ''}`}><label>{t('Payment screenshot / bank receipt')}<span className="req">*</span> (PDF / JPG / PNG, 10 MB)</label><input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /><Msg e={err} k="receipt" /></div>
        <div className="f c6"><label>{t('Note')}</label><textarea rows={2} value={v.note} onChange={set('note')} /></div>
      </div></form>
    </Modal>
  );
}
function PayDialog({ d, close, done }: { d: Any; close: () => void; done: () => void }) {
  const [v, setV] = useState({ payment_for: 'Tuition fee / deposit', application_id: '', amount: '', currency: 'EUR', payment_date: istToday(), mode: '', reference_no: '', note: '' });
  const [file, setFile] = useState<File | null>(null), [err, setErr] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((o) => ({ ...o, [k]: e.target.value, ...(k === 'payment_for' ? { currency: e.target.value === 'La Europa service fee' ? 'INR' : 'EUR' } : {}) }));
  const send = async (dup = false) => {
    setErr({});
    const fd = new FormData(); for (const [k, x] of Object.entries(v)) if (x) fd.append(k, x); if (file) fd.append('receipt', file); if (dup) fd.append('confirm_duplicate', '1');
    try { const r = await SEND('post', '/payment-submissions', fd); toast(t(r.message), 'ok'); close(); done(); }
    catch (e) { if (e instanceof ApiError && e.data.needs_confirm) { if (await confirmBox(t(e.message))) send(true); return; } setErr(errsOf(e)); showError(e); }
  };
  const F = (k: string, label: React.ReactNode, child: React.ReactNode, c = 3) => <div className={`f c${c}${err[k] ? ' err' : ''}`}><label>{label}</label>{child}<Msg e={err} k={k} /></div>;
  const req = <span className="req">*</span>;
  return (
    <Modal title={t('I have made a payment')} close={close} foot={<><button className="btn" onClick={close}>{t('Cancel')}</button><button className="btn primary" onClick={() => send()}>{t('Submit proof')}</button></>}>
      <form noValidate onSubmit={(e) => e.preventDefault()}><div className="form-grid">
        {F('payment_for', <>{t('Payment for')}{req}</>, <select value={v.payment_for} onChange={set('payment_for')}><Options list={[['Tuition fee / deposit', t('Tuition fee / deposit')], ['Application fee', t('Application fee')], ['La Europa service fee', t('La Europa service fee')], ['Other', t('Other')]]} /></select>)}
        {F('application_id', t('Application'), <select value={v.application_id} onChange={set('application_id')}><option value="">{t('Select...')}</option><Options list={d.applications.map((a: Any) => [a.id, a.label] as [string, string])} /></select>)}
        {F('amount', <>{t('Amount')}{req}</>, <input type="number" step="0.01" inputMode="decimal" value={v.amount} onChange={set('amount')} />, 2)}
        {F('currency', t('Currency'), <select value={v.currency} onChange={set('currency')}><Options list={['EUR', 'INR', 'CNY', 'USD']} /></select>, 1)}
        {F('payment_date', <>{t('Payment date')}{req}</>, <input type="date" max={istToday()} value={v.payment_date} onChange={set('payment_date')} />)}
        {F('mode', <>{t('Mode')}{req}</>, <select value={v.mode} onChange={set('mode')}><option value="">{t('Select...')}</option><Options list={d.modes} /></select>)}
        {F('reference_no', t('Transaction / reference no.'), <input value={v.reference_no} onChange={set('reference_no')} />)}
        {F('receipt', <>{t('Receipt / proof')}{req} (PDF / JPG / PNG, 10 MB)</>, <input type="file" accept=".pdf,.jpg,.jpeg,.png" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />, 6)}
        <div className="f c6"><label>{t('Note')}</label><textarea rows={2} value={v.note} onChange={set('note')} /></div>
      </div></form>
      <p className="small muted">{t('This is not recorded until La Europa confirms it.')}</p>
    </Modal>
  );
}
export function Payments() {
  const [all, setAll] = useState<{ d: Any; iv: Any } | null>(null);
  const load = useCallback(() => Promise.all([GET('/payments'), GET('/invoices').catch(() => ({ rows: [], bank: null }))]).then(([d, iv]) => setAll({ d, iv })).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  if (!all) return <Loading />;
  const { d, iv } = all;
  if (d.locked) return <><div className="p-head"><h1>{t('Payments')}</h1></div><LockedCard /></>;
  const waiting = d.submissions.filter((s: Any) => s.status === 'Submitted').length;
  const doc = (i: Any) => <div key={i.url + i.name} className="row"><a href="#" onClick={(e) => { e.preventDefault(); openLink(i.url, i.name); }}>{i.name}</a><span className="small muted">{fmtDate(i.date)}</span></div>;
  return (
    <>
      <div className="p-head"><h1>{t('Payments')}</h1><span className="grow" /><button className="btn primary" onClick={() => openOverlay((close) => <PayDialog d={d} close={close} done={load} />)}>{t('I have made a payment')}</button></div>
      {waiting ? <div className="p-banner info">{t('Payment proof submitted: waiting for confirmation')} ({waiting})</div> : null}
      {iv.rows.length ? <><h2 style={{ margin: '4px 0 10px' }}>{t('My invoices')}</h2>{iv.rows.map((i: Any) => <InvoiceCard key={i.id} i={i} bank={iv.bank} proof={() => openOverlay((close) => <InvoiceProof i={i} modes={d.modes} close={close} done={load} />)} />)}</> : null}
      <h2 style={{ margin: '4px 0 10px' }}>{t('University tuition fee')}</h2>
      {d.tuition.length ? d.tuition.map((x: Any, n: number) => (
        <div key={n} className="p-card" style={{ marginBottom: 12 }}><div className="hd"><h3>{x.university}</h3><span className="small muted">{x.course} · {x.intake} · {t(x.stage_name)}</span></div><div className="bd">
          {x.total === null ? <p className="muted small">{t('Your counsellor will add the fee details from your offer letter.')}</p> : <>
            <div className="money-row"><span>{t('Total tuition fee (first year)')}</span><b>{money(x.total, x.currency)}</b></div>
            {x.scholarship ? <div className="money-row"><span>{t('Scholarship / waiver')}</span><b>- {money(x.scholarship, x.currency)}</b></div> : null}
            {x.deposit_required ? <div className="money-row"><span>{t('Deposit required')}{x.deposit_deadline ? ` (${t('by')} ${fmtDate(x.deposit_deadline)})` : ''}</span><b>{money(x.deposit_required, x.currency)}</b></div> : null}
            <div className="money-row"><span>{t('Total paid')}</span><b className="st-Verified">{money(x.paid, x.currency)}</b></div><div className="money-row"><span>{t('Pending')}</span><b className={x.overdue ? 'days-red' : ''}>{money(x.pending, x.currency)}</b></div>
          </>}
          {x.instructions ? <div style={{ marginTop: 10 }}><Safety /><p><b>{t('Pay')} {money(x.instructions.amount, x.instructions.currency)} {t('by')} {fmtDate(x.instructions.due_date)}</b> · {x.instructions.pay_to}</p><div className="small" dangerouslySetInnerHTML={{ __html: x.instructions.instructions_html }} /></div> : null}
          <details style={{ marginTop: 8 }}><summary className="small">{t('Payment history')}</summary><Hist rows={x.history} /></details>
        </div></div>
      )) : <div className="empty-p">{t('Tuition fees appear here after you have an application.')}</div>}
      <h2 style={{ margin: '20px 0 10px' }}>{t('La Europa service fee')}</h2>
      <div className="p-card"><div className="bd">
        {d.service ? <>{d.service.package ? <p>{d.service.package}</p> : null}
          <div className="money-row"><span>{t('Total service fee')}</span><b>{money(d.service.total, 'INR')}</b></div><div className="money-row"><span>{t('Paid')}</span><b className="st-Verified">{money(d.service.paid, 'INR')}</b></div>
          <div className="money-row"><span>{t('Pending')}</span><b>{money(d.service.pending, 'INR')}</b></div>{d.service.next_due ? <div className="money-row"><span>{t('Next instalment due')}</span><b>{fmtDate(d.service.next_due)}</b></div> : null}
          <details style={{ marginTop: 8 }}><summary className="small">{t('Payment history')}</summary><Hist rows={d.service.history} /></details></> : <p className="muted">{t('No service fee details yet.')}</p>}
        {d.invoices.length ? <><h4 style={{ marginTop: 12 }}>{t('Invoices')}</h4>{d.invoices.map(doc)}</> : null}
        {d.receipts.length ? <><h4 style={{ marginTop: 12 }}>{t('Receipts')}</h4>{d.receipts.map(doc)}</> : null}
      </div></div>
      {d.submissions.length ? <><h2 style={{ margin: '20px 0 10px' }}>{t('My payment proofs')}</h2><div className="p-card"><div className="bd flush">{d.submissions.map((s: Any) => (
        <div key={s.id} className="rowx"><div className="grow"><div className="t">{money(s.amount, s.currency)} · {t(s.payment_for)}</div><div className="s">{fmtDate(s.payment_date)}{s.university ? ' · ' + s.university : ''}{s.reference_no ? ' · ' + s.reference_no : ''}</div>
          {s.reject_reason ? <div className="s days-red">{s.reject_reason}</div> : null}</div><span className={`badge ${s.status === 'Recorded' ? 'green' : s.status === 'Rejected' ? 'red' : 'blue'}`}>{t(s.status_label)}</span></div>
      ))}</div></div></> : null}
    </>
  );
}

// ---------- tasks (SP18) ----------
export function Tasks() {
  const [d, setD] = useState<Any | null>(null);
  const [tab, setTab] = useState(() => ss('lep:ttab', 'todo'));
  const load = useCallback(() => GET('/tasks').then(setD).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;
  const is = (k: string) => (x: Any) => (k === 'done' ? !x.open : k === 'overdue' ? x.open && x.overdue_days : x.open);
  const rows = d.rows.filter(is(tab));
  return (
    <>
      <div className="p-head"><h1>{t('Tasks')}</h1></div>
      <div className="chips-x">{[['todo', 'To do'], ['overdue', 'Overdue'], ['done', 'Done']].map(([k, l]) => <span key={k} className={`chip ${tab === k ? '' : 'off'}`} onClick={() => { ssSet('lep:ttab', k); setTab(k); }}>{t(l)} ({d.rows.filter(is(k)).length})</span>)}</div>
      <div className="p-card"><div className="bd flush">{rows.length ? rows.map((x: Any) => (
        <div key={x.id} className={`rowx ${x.overdue_days ? 'overdue' : ''}`} style={{ alignItems: 'flex-start' }}><div className="grow">
          <div className="t">{x.title} <span className={`badge pri-${x.priority}`}>{t(x.priority)}</span></div>
          {x.description ? <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{x.description}</div> : null}
          <div className="s">{x.overdue_days ? <span className="days-red">{t('Overdue by {n} days', { n: x.overdue_days })}</span> : `${t('Due')} ${fmtDT(x.due_at)}`} · {t('from')} {x.created_by}{x.linked ? ` · ${x.linked.label || ''}` : ''}</div>
          {x.reopen_reason ? <div className="s days-orange">{t('Re-opened:')} {x.reopen_reason}</div> : null}<div className="s">{t('Status:')} {t(x.status)}</div></div>
          {x.open ? <button className="btn sm primary" onClick={async () => { if (await taskDone(x.id)) load(); }}>{t('Mark as done')}</button> : null}</div>
      )) : <div className="empty-p">{tab === 'todo' ? t('You are all caught up!') : t('Nothing here')}</div>}</div></div>
    </>
  );
}
