'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { DEL, GET, POST, PUT, SEND, ApiError } from '../api';
import { M, useMeta } from '../meta';
import { fmtDate, fmtDT, fromLocalInput, istToday, money } from '../format';
import { Options, formModal, toFormData, type Field, type Vals } from '../form';
import { Modal, confirmBox, openOverlay, showError, toast } from '../ui';
import { StageBadge } from '../badges';
import { EmailPreview, NotifyButtons } from '../notify';
import { openFile } from '../portalcrm';
import type { Ctx } from '../student/tabs';
import { CUR, LEVELS, courses, unis } from './shortlist';
import { viewDocument } from './documents';
import { UniBox, UniStudentBox } from '../university';

/** The client's Applications & Visa (legacy/public/js/pages/work.js applications / visa, portalcrm.js appPortalBox). */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const kv = (k: string, v: React.ReactNode) => <div key={k}><div className="k">{k}</div><div className="v">{v === null || v === undefined || v === '' ? <span className="muted">-</span> : v}</div></div>;
/** a form field with its error line (module level, so typing never remounts it) */
function Fld({ k, label, req, c = 'c6', e, children }: { k: string; label: React.ReactNode; req?: boolean; c?: string; e: Record<string, string>; children: React.ReactNode }) {
  return <div className={`f ${c}${e[k] ? ' err' : ''}`}><label>{label}{req ? <span className="req">*</span> : null}</label>{children}<div className="msg">{e[k] ?? ''}</div></div>;
}
const appStages = () => useMeta.getState().meta?.app_stages ?? [];
const visaStages = () => useMeta.getState().meta?.visa_stages ?? [];
const CLOSED = ['rejected', 'withdrawn', 'offer_declined'];

function appFields(isNew: boolean): Field[] {
  return [
    { k: 'country_id', label: 'Country', type: 'select', req: true, opts: M.countries() },
    { k: 'university_id', label: 'University', type: 'select', req: true, opts: (v) => unis(v.country_id).map((u: Any) => [u.id, u.name] as [string, string]) },
    { k: 'course_id', label: 'Course (from master)', type: 'select', opts: (v) => [...courses(v.university_id).map((c: Any) => [c.id, `${c.name} (${c.level || ''})`] as [string, string]), ['__text', 'Other course (type name)...']] },
    { k: 'course_name_text', label: 'Course name', req: true, show: (v) => v.course_id === '__text' || !v.course_id },
    { k: 'level', label: 'Level', type: 'select', req: true, opts: LEVELS }, { k: 'intake_id', label: 'Intake', type: 'select', req: true, opts: M.intakes() },
    { k: 'deadline', label: 'Application deadline', type: 'date' }, { k: 'channel', label: 'Application channel', type: 'select', opts: M.list('app_channel').map((x) => [x.name, x.name] as [string, string]) },
    { k: 'university_app_id', label: 'University application ID' }, { k: 'portal_ref', label: 'Portal login reference', placeholder: 'portal URL + username', col: 4, help: 'Do not type passwords here' },
    { k: 'portal_secret', label: 'Portal password (stored encrypted)', type: 'password', help: 'Optional. Shown only on Reveal (logged)' },
    { k: 'app_fee', label: 'Application fee', type: 'number', min: 0, col: 1 }, { k: 'app_fee_currency', label: 'Currency', type: 'select', noBlank: true, opts: CUR, col: 1 },
    { k: 'app_fee_paid', label: 'Application fee paid?', type: 'yesno', req: true },
    { k: 'app_fee_paid_date', label: 'Paid date', type: 'date', req: true, show: (v) => !!v.app_fee_paid }, { k: 'app_fee_paid_by', label: 'Paid by', type: 'select', opts: ['Student', 'La Europa'], show: (v) => !!v.app_fee_paid },
    ...(isNew ? [] : [{ k: 'interview_link', label: 'Interview mode / link' } as Field, { k: 'offer_deadline', label: 'Offer acceptance deadline', type: 'date', help: 'Reminder task 3 days before' } as Field]),
    { k: 'deposit_required', label: 'Deposit / tuition required', type: 'number', col: 1 }, { k: 'deposit_currency', label: 'Currency', type: 'select', noBlank: true, opts: CUR, col: 1 },
    { k: 'handled_by', label: 'Counsellor', type: 'select', opts: M.users(['counsellor', 'manager', 'admin']).map((u) => [u.id, u.name] as [string, string]) },
    { k: 'show_university_ref_to_student', label: 'Show university application ID to student', type: 'checkbox', col: 3 },
    { k: 'remarks_internal', label: 'Remarks (internal, never emailed)', type: 'textarea', col: 6 },
  ];
}
export async function applicationForm(s: Any, row?: Any) {
  let v: Vals;
  if (row) v = { ...row, course_id: row.course_id || '__text', app_fee_paid: !!row.app_fee_paid };
  else { const p = (await GET('/students/' + s.id)).prefs; v = { country_id: p.country_ids?.[0], level: p.level, intake_id: p.intake_id, app_fee_currency: 'EUR', deposit_currency: 'EUR', app_fee_paid: false, handled_by: s.primary_counsellor_id }; }
  return formModal({
    title: row ? `Edit application ${row.application_code}` : 'Add application', size: 'lg', fields: appFields(!row), values: v,
    intro: row ? undefined : <p className="small muted" style={{ marginTop: 0 }}>New applications start at &quot;Documents pending&quot; and the student gets email E05 with the missing document list.</p>,
    onChange: (x, prev, set) => {
      if (x.course_id !== prev.course_id) {
        const c = (useMeta.getState().meta?.courses ?? []).find((y: Any) => y.id === x.course_id) as Any;
        if (c?.level) set('level', c.level);
        if (c && !x.app_fee && c.application_fee !== null && c.application_fee !== undefined) set('app_fee', c.application_fee);
      }
    },
    save: async (vals) => {
      const b = { ...vals };
      if (b.course_id === '__text') b.course_id = null;
      if (!b.portal_secret) delete b.portal_secret;
      const r = row ? await PUT(`/applications/${row.id}`, b) : await POST(`/students/${s.id}/applications`, b);
      toast(row ? 'Application saved' : 'Application created. Email E05 queued.', 'ok');
      return r;
    },
  });
}

// ---------- stage change with the live email preview ----------
function StagePopup({ app, close, done, initial }: { app: Any; close: () => void; done: () => void; initial?: string }) {
  const stages = appStages();
  const opts = stages.filter((x) => x.code !== app.stage);
  const [v, setV] = useState<Vals>({ stage: initial ?? opts[0]?.code, applied_date: app.applied_date || istToday(), interview_link: app.interview_link || '', offer_conditions: app.offer_conditions || '', offer_deadline: app.offer_deadline || '' });
  const [file, setFile] = useState<File | null>(null);
  const [pv, setPv] = useState<Any | null>(null);
  const [pvErr, setPvErr] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  const st = v.stage as string;
  const sortOf = (c: string) => stages.find((x) => x.code === c)?.sort ?? 0;
  const back = sortOf(st) < sortOf(app.stage);
  const offer = ['conditional_offer', 'unconditional_offer'].includes(st);
  const body = () => ({ ...v, interview_at: v.interview_at ? fromLocalInput(v.interview_at) : null });
  useEffect(() => {
    const t = setTimeout(async () => {
      try { const r = await POST(`/applications/${app.id}/stage-preview`, { ...body(), has_file: !!file }); setPv(r); setPvErr(''); } catch (e) { setPvErr((e as Error).message); }
    }, 350);
    return () => clearTimeout(t);
  }, [JSON.stringify(v), !!file]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (notify: boolean) => {
    setBusy(true); setErrors({});
    try {
      const fd = toFormData({ ...body(), notify });
      if (file) fd.append('file', file);
      const r = await SEND('post', `/applications/${app.id}/stage`, fd);
      toast(notify ? 'Stage changed. Student email queued.' : 'Stage changed without notifying', 'ok'); close();
      if (r.suggest_enrolled) toast('Visa approved and enrolment confirmed: consider marking the student as Enrolled.', 'ok');
      done();
    } catch (e) { if (e instanceof ApiError && e.data.errors) setErrors(e.data.errors); showError(e); } finally { setBusy(false); }
  };
  const problems: string[] = pv?.problems ?? [], warnings: string[] = pv?.warnings ?? [];
  return (
    <Modal title={`Change stage: ${app.application_code}`} size="xl" close={close} foot={<NotifyButtons onSave={save} busy={busy} />}>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)' }}>
        <form noValidate onSubmit={(e) => e.preventDefault()}>
          <div className="info-box" style={{ marginBottom: 12 }}>{app.university} · {app.course} · {app.intake}<br />Current: <b>{app.stage_name}</b></div>
          <div className="form-grid">
            <Fld e={errors} k="stage" label="New stage" req><select value={st} onChange={set('stage')}>{opts.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></Fld>
            {st === 'applied' ? <Fld e={errors} k="applied_date" label="Applied date" req c="c3"><input type="date" max={istToday()} value={v.applied_date} onChange={set('applied_date')} /></Fld> : null}
            {st === 'interview' ? <>
              <Fld e={errors} k="interview_at" label="Interview date and time" req c="c3"><input type="datetime-local" value={v.interview_at ?? ''} onChange={set('interview_at')} /></Fld>
              <Fld e={errors} k="interview_link" label="Interview mode / link" c="c3"><input type="text" value={v.interview_link} onChange={set('interview_link')} /></Fld>
            </> : null}
            {offer ? <Fld e={errors} k="file" label={<>Offer letter (PDF, max 10 MB){app.offer_letter ? <> <span className="badge green">already uploaded</span></> : <span className="req">*</span>}</>}><input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Fld> : null}
            {st === 'conditional_offer' ? <Fld e={errors} k="offer_conditions" label="Offer conditions (included in student email)" req><textarea rows={3} value={v.offer_conditions} onChange={set('offer_conditions')} /></Fld> : null}
            {offer ? <Fld e={errors} k="offer_deadline" label="Offer acceptance deadline" c="c3"><input type="date" value={v.offer_deadline} onChange={set('offer_deadline')} /></Fld> : null}
            <Fld e={errors} k="reason" label={<>Reason / remark <span className="muted small">{CLOSED.includes(st) ? '(required)' : back ? '(required: moving back)' : CLOSED.includes(app.stage) ? '(required: re-opening)' : ''}</span></>}><textarea rows={2} value={v.reason ?? ''} onChange={set('reason')} /></Fld>
            {st === 'rejected' ? <div className="f check c6 inline"><input type="checkbox" id="ir" checked={!!v.include_reason} onChange={set('include_reason')} /><label htmlFor="ir">Include the reason in the student email / show to student in the portal</label></div> : null}
            <div className="f c6"><label>Message from counsellor (optional, added to the email)</label><textarea rows={2} maxLength={500} value={v.message ?? ''} onChange={set('message')} /></div>
            {problems.length || errors.override_reason ? <Fld e={errors} k="override_reason" label={<>Override reason<span className="req">*</span> <span className="muted small">(Admin is notified)</span></>}>
              <div className="warn-box" style={{ marginBottom: 6 }}>{problems.map((p, i) => <div key={i}>• {p}</div>)}</div>
              <textarea rows={2} placeholder="e.g. offer by email only" value={v.override_reason ?? ''} onChange={set('override_reason')} /></Fld> : null}
            {warnings.length ? <div className="f check c6 inline"><input type="checkbox" id="cw" checked={!!v.confirm_warning} onChange={set('confirm_warning')} /><label htmlFor="cw">{warnings.join(' ')} I understand, continue.</label></div> : null}
          </div>
        </form>
        <div><h4 style={{ marginBottom: 6 }}>Email preview (read-only)</h4>
          {pvErr ? <div className="err-box">{pvErr}</div> : pv ? <><EmailPreview pv={pv.email} /><p className="small muted">Trigger {pv.email?.code}. CC is added by the system and cannot be removed.</p></> : <div className="empty">Loading preview...</div>}</div>
      </div>
    </Modal>
  );
}
export const stagePopup = (app: Any, done: () => void, initial?: string) => openOverlay((close) => <StagePopup app={app} close={close} done={done} initial={initial} />);
async function historyPopup(app: Any) {
  try {
    const d = await GET(`/applications/${app.id}`);
    openOverlay((close) => (
      <Modal title={`Stage history: ${app.application_code}`} size="lg" close={close}>
        <table className="t"><thead><tr><th>Date</th><th>From</th><th>To</th><th>By</th><th>Reason</th><th>Notified</th></tr></thead>
          <tbody>{d.history.map((h: Any, i: number) => (
            <tr key={i}><td className="nowrap">{fmtDT(h.changed_at)}</td><td>{h.from_name || '-'}</td><td>{h.to_name}</td><td>{h.by}</td>
              <td>{h.reason || ''}{h.override_reason ? <div className="small" style={{ color: 'var(--orange)' }}>Override: {h.override_reason}</div> : null}</td>
              <td>{h.notified ? 'Yes' : <span className="badge orange">Without notifying</span>}</td></tr>
          ))}</tbody></table>
      </Modal>
    ));
  } catch (e) { showError(e); }
}
/** ONE flow: application stages, then the visa stages, then enrolment. */
function FlowStrip({ a }: { a: Any }) {
  const ENR = 'enrolment_confirmed';
  const all = appStages();
  const appSt = all.filter((x) => ![...CLOSED, ENR].includes(x.code));
  const enr = all.find((x) => x.code === ENR);
  const vSt = visaStages();
  const cur = appSt.findIndex((x) => x.code === a.stage);
  const vIdx = a.visa ? vSt.findIndex((x) => x.code === a.visa.stage) : -1;
  const closed = CLOSED.includes(a.stage);
  const chip = (name: string, state: string, key: string) => <span key={key} className={`flow-chip ${state}`}>{name}</span>;
  return (
    <div className="flow-strip">
      <div className="small muted" style={{ marginBottom: 4 }}>Application, visa and enrolment flow{closed ? <> · <b>{M.stage(a.stage).name}</b></> : null}</div>
      <div className="flow-row">
        {appSt.map((x, i) => chip(x.name, closed ? 'off' : a.visa || a.stage === ENR || i < cur ? 'done' : i === cur ? 'now' : '', x.code))}
        <span className="flow-sep">Visa</span>
        {vSt.filter((x) => !(vIdx >= 0 && vSt[vIdx].code === 'approved' && x.code === 'rejected') && !(vIdx >= 0 && vSt[vIdx].code === 'rejected' && x.code === 'approved'))
          .map((x) => { const i = vSt.indexOf(x); return chip(x.name, vIdx < 0 ? '' : i < vIdx ? 'done' : i === vIdx ? (x.code === 'rejected' ? 'bad' : 'now') : '', 'v' + x.code); })}
        {enr ? <><span className="flow-sep">Enrolment</span>{chip(enr.name, closed ? 'off' : a.stage === ENR ? (a.visa?.stage === 'approved' ? 'done' : 'now') : '', 'enr')}</> : null}
      </div>
    </div>
  );
}

// ---------- the portal side of one application: offer conditions and fee deposit instructions ----------
function AppPortalBox({ app, reload }: { app: Any; reload: () => void }) {
  const [d, setD] = useState<Any | null>(null);
  const load = useCallback(() => GET(`/applications/${app.id}/portal`).then(setD).catch(() => {}), [app.id]);
  useEffect(() => { load(); }, [load]);
  if (!d) return null;
  const conds = async () => {
    const r = await formModal({ title: 'Add offer conditions', values: { items: app.offer_conditions || '' }, fields: [{ k: 'items', label: 'One condition per line (student sees each and can upload proof)', type: 'textarea', rows: 5, col: 6 }],
      save: (v) => POST(`/applications/${app.id}/conditions`, { items: String(v.items || '').split('\n') }) });
    if (r) { load(); reload(); }
  };
  const instr = async (i: Any | null) => {
    const r = await formModal({
      title: 'Fee deposit instructions for student', size: 'lg', values: i || { amount: app.deposit_required, currency: app.deposit_currency || 'EUR' },
      intro: <div className="warn-box small">Students always see: &quot;Always check payment details with your counsellor before paying. La Europa will never ask you to pay university fees to a personal account.&quot;</div>,
      fields: [{ k: 'amount', label: 'Amount to pay', type: 'number', req: true, col: 2 }, { k: 'currency', label: 'Currency', type: 'select', noBlank: true, opts: CUR, col: 1 },
        { k: 'due_date', label: 'Pay by (deadline)', type: 'date', req: true, col: 3 }, { k: 'pay_to', label: 'Pay to', req: true, col: 6, placeholder: 'e.g. University (as per offer letter)' },
        { k: 'instructions_html', label: 'Instructions (how to pay, reference, bank details as given by the university)', type: 'textarea', rows: 6, req: true, col: 6 },
        { k: 'file', label: 'Instruction file (optional)', type: 'file', accept: '.pdf,.jpg,.jpeg,.png', col: 6 }],
      save: (v) => SEND('post', `/applications/${app.id}/fee-instructions`, toFormData({ ...v, ...(i ? { id: i.id } : {}) })),
    });
    if (r) load();
  };
  return (
    <div className="small" style={{ marginTop: 10, borderTop: '1px dashed var(--line)', paddingTop: 8 }}>
      <b>Student portal</b>
      {d.offer_response === 'Accepted' ? <> <span className="badge green">Student accepted offer on {fmtDT(d.offer_response_at)}</span></> : d.offer_response === 'Undone' ? <> <span className="badge grey">Student undid acceptance</span></> : null}
      <div className="row" style={{ marginTop: 6 }}><button className="btn xs" onClick={conds}>Offer conditions ({d.conditions.length})</button><button className="btn xs" onClick={() => instr(null)}>Fee deposit instructions ({d.instructions.length})</button></div>
      {d.conditions.map((c: Any) => (
        <div key={c.id} className="row" style={{ marginTop: 4 }}>
          <span className={`badge ${c.status === 'Met' ? 'green' : c.status === 'Waived' ? 'grey' : 'orange'}`}>{c.status}</span><span className="grow">{c.text}</span>
          {c.proof_url ? <a href="#" onClick={(e) => { e.preventDefault(); openFile(c.proof_url); }}>proof</a> : null}
          <select className="input" style={{ width: 110, height: 26 }} defaultValue={c.status} onChange={async (e) => { try { await PUT(`/offer-conditions/${c.id}`, { status: e.target.value }); toast('Condition updated', 'ok'); load(); } catch (er) { showError(er); } }}><Options list={['Open', 'Met', 'Waived']} /></select>
        </div>
      ))}
      {d.instructions.map((i: Any) => (
        <div key={i.id} className="row" style={{ marginTop: 4 }}>
          {i.is_published ? <span className="badge green">Published</span> : <span className="badge grey">Draft</span>}
          <span className="grow">{money(i.amount, i.currency)} by {fmtDate(i.due_date)} · {i.pay_to}</span>
          <button className="btn xs" onClick={async () => { try { await POST(`/fee-instructions/${i.id}/publish`, { published: !i.is_published }); toast(!i.is_published ? 'Published to the student (E28 queued)' : 'Hidden from the student', 'ok'); load(); } catch (e) { showError(e); } }}>{i.is_published ? 'Unpublish' : 'Publish (E28)'}</button>
          <button className="btn xs" onClick={() => instr(i)}>Edit</button>
        </div>
      ))}
    </div>
  );
}

// ---------- visa: shown inside its application card ----------
function VisaStagePopup({ v, close, done }: { v: Any; close: () => void; done: () => void }) {
  const opts = visaStages().filter((x) => x.code !== v.stage && x.code !== 'reapply');
  const [x, setX] = useState<Vals>({ stage: opts[0]?.code, centre: v.centre || '', vfs_reference: v.vfs_reference || '' });
  const [file, setFile] = useState<File | null>(null);
  const [pv, setPv] = useState<Any | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setX((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  const st = x.stage as string, decision = ['approved', 'rejected'].includes(st);
  const body = () => ({ ...x, appointment_at: x.appointment_at ? fromLocalInput(x.appointment_at) : null });
  useEffect(() => {
    const t = setTimeout(() => { POST(`/visa/${v.id}/stage-preview`, { ...body(), has_file: !!file }).then(setPv).catch(() => {}); }, 300);
    return () => clearTimeout(t);
  }, [JSON.stringify(x), !!file]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (notify: boolean) => {
    setErrors({});
    try {
      const fd = toFormData({ ...body(), notify });
      if (file) fd.append('file', file);
      const r = await SEND('post', `/visa/${v.id}/stage`, fd);
      toast('Visa stage saved', 'ok'); close();
      if (r.suggest_enrolled) toast('Visa approved and enrolment confirmed: consider marking the student as Enrolled (More ▾).', 'ok');
      done();
    } catch (e) { if (e instanceof ApiError && e.data.errors) setErrors(e.data.errors); showError(e); }
  };
  return (
    <Modal title={`Visa stage: ${v.visa_code}`} size="xl" close={close} foot={<NotifyButtons onSave={save} />}>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)' }}>
        <form noValidate onSubmit={(e) => e.preventDefault()}>
          <div className="info-box" style={{ marginBottom: 12 }}>{v.country} · attempt {v.attempt_no} · current: <b>{v.stage_name}</b></div>
          <div className="form-grid">
            <Fld e={errors} k="stage" label="New stage" req><select value={st} onChange={set('stage')}>{opts.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}</select></Fld>
            {st === 'appointment_booked' ? <>
              <Fld e={errors} k="appointment_at" label="Appointment date and time" req c="c3"><input type="datetime-local" value={x.appointment_at ?? ''} onChange={set('appointment_at')} /></Fld>
              <Fld e={errors} k="centre" label="Appointment centre" req c="c3"><input type="text" list="centres" value={x.centre} onChange={set('centre')} />
                <datalist id="centres">{['VFS Mumbai', 'VFS New Delhi', 'VFS Bengaluru', 'VFS Chennai', 'VFS Kolkata', 'VFS Ahmedabad', 'Embassy New Delhi'].map((c) => <option key={c} value={c} />)}</datalist></Fld>
              <Fld e={errors} k="vfs_reference" label="VFS / Embassy reference no." c="c3"><input type="text" value={x.vfs_reference} onChange={set('vfs_reference')} /></Fld>
            </> : null}
            {decision ? <>
              <Fld e={errors} k="decision_date" label="Decision date" req c="c3"><input type="date" max={istToday()} value={x.decision_date ?? ''} onChange={set('decision_date')} /></Fld>
              <Fld e={errors} k="file" label="Decision upload (visa copy / refusal letter)" req c="c3"><input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Fld>
            </> : null}
            {st === 'approved' ? <>
              <Fld e={errors} k="valid_from" label="Visa valid from" c="c3"><input type="date" value={x.valid_from ?? ''} onChange={set('valid_from')} /></Fld>
              <Fld e={errors} k="valid_to" label="Visa valid to" c="c3"><input type="date" value={x.valid_to ?? ''} onChange={set('valid_to')} /></Fld>
            </> : null}
            {st === 'rejected' ? <>
              <Fld e={errors} k="rejection_reason" label="Rejection reason (internal unless ticked)"><textarea rows={2} value={x.rejection_reason ?? ''} onChange={set('rejection_reason')} /></Fld>
              <div className="f check c6 inline"><input type="checkbox" id="vir" checked={!!x.include_reason} onChange={set('include_reason')} /><label htmlFor="vir">Include the reason in the student email</label></div>
            </> : null}
            <Fld e={errors} k="reason" label="Remark / reason"><textarea rows={2} value={x.reason ?? ''} onChange={set('reason')} /></Fld>
            <div className="f c6"><label>Message from counsellor (optional)</label><textarea rows={2} value={x.message ?? ''} onChange={set('message')} /></div>
            {pv?.problems?.length || errors.override_reason ? <Fld e={errors} k="override_reason" label="Override reason" req><div className="warn-box" style={{ marginBottom: 6 }}>{(pv?.problems ?? []).map((p: string, i: number) => <div key={i}>• {p}</div>)}</div><textarea rows={2} value={x.override_reason ?? ''} onChange={set('override_reason')} /></Fld> : null}
          </div>
        </form>
        <div><h4 style={{ marginBottom: 6 }}>Email preview (read-only)</h4>{pv ? <><EmailPreview pv={pv.email} /><p className="small muted">Trigger {pv.email?.code}</p></> : <div className="empty">Loading preview...</div>}</div>
      </div>
    </Modal>
  );
}
const UPLOADS: Record<string, string> = { insurance: 'Insurance policy', accommodation: 'Accommodation proof', cover_letter: 'Cover letter', aps: 'APS certificate' };
function VisaFile({ v, kind, done, close }: { v: Any; kind: string; done: () => void; close: () => void }) {
  const [f, setF] = useState<File | null>(null);
  const go = async () => {
    if (!f) return;
    const fd = new FormData(); fd.append('file', f); fd.append('kind', kind);
    try { await SEND('post', `/visa/${v.id}/upload`, fd); toast('Uploaded (also saved in Documents)', 'ok'); close(); done(); } catch (e) { showError(e); }
  };
  return <Modal title={'Upload ' + UPLOADS[kind]} size="sm" close={close} foot={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={go}>Upload</button></>}><input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setF(e.target.files?.[0] ?? null)} /></Modal>;
}
async function visaEdit(v: Any, done: () => void) {
  const r = await formModal({
    title: `Visa details: ${v.visa_code}`, size: 'lg', values: v, save: (x) => PUT(`/visa/${v.id}`, x),
    fields: [
      { k: 'visa_type', label: 'Visa type', type: 'select', noBlank: true, opts: M.list('visa_type').map((x) => [x.name, x.name] as [string, string]) }, { k: 'centre', label: 'Appointment centre' }, { k: 'vfs_reference', label: 'VFS / Embassy reference no.' },
      { k: 'sf', type: 'section', label: 'Funds (internal)' },
      { k: 'funds_type', label: 'Proof of funds type', type: 'select', opts: ['Blocked account', 'Bank statement', 'Education loan sanction', 'Sponsor letter', 'Scholarship letter', 'Other'] },
      { k: 'blocked_provider', label: 'Blocked account provider', show: (x) => x.funds_type === 'Blocked account' },
      { k: 'blocked_account_status', label: 'Blocked account status', type: 'select', opts: ['Not started', 'Opened', 'Funded', 'Confirmation received'], show: (x) => x.funds_type === 'Blocked account' },
      { k: 'funds_amount', label: 'Funds amount', type: 'number', col: 1 }, { k: 'funds_currency', label: 'Currency', type: 'select', noBlank: true, opts: CUR, col: 1 },
      { k: 'so', type: 'section', label: 'Insurance, accommodation, travel' },
      { k: 'insurance_status', label: 'Health / travel insurance', type: 'select', noBlank: true, opts: ['Not started', 'Purchased'] },
      { k: 'accommodation_status', label: 'Accommodation', type: 'select', noBlank: true, opts: ['Not arranged', 'Temporary', 'Confirmed'] },
      { k: 'travel_date', label: 'Travel date', type: 'date', help: 'Creates a pre-departure task' },
      ...(v.is_germany ? [{ k: 'sa', type: 'section', label: 'APS (Germany only)' } as Field, { k: 'aps_status', label: 'APS status', type: 'select', noBlank: true, opts: ['Not applied', 'Applied', 'Documents sent', 'Interview / test scheduled', 'Certificate received'] } as Field,
        { k: 'aps_reference', label: 'APS reference' } as Field, { k: 'aps_date', label: 'APS date', type: 'date' } as Field] : []),
      { k: 'valid_from', label: 'Visa valid from', type: 'date', show: () => v.stage === 'approved' }, { k: 'valid_to', label: 'Visa valid to', type: 'date', show: () => v.stage === 'approved' },
      { k: 'remarks', label: 'Remarks (internal)', type: 'textarea', col: 6 },
    ],
  });
  if (r) { toast('Saved', 'ok'); done(); }
}
function VisaCard({ v, P, reload, embedded }: { v: Any; P: Any; reload: () => void; embedded: boolean }) {
  const link = (url: string | null | undefined, label: string) => (url ? <a href="#" onClick={(e) => { e.preventDefault(); openFile(url); }}>{label}</a> : null);
  const reapply = async () => {
    const r = await confirmBox('Start a new attempt for this visa case? History is kept and the student gets email E14.', { reason: true, reasonLabel: 'Note' });
    if (r) { try { await POST(`/visa/${v.id}/reapply`, { reason: r }); toast('Re-apply started', 'ok'); reload(); } catch (e) { showError(e); } }
  };
  const hist = () => openOverlay((close) => (
    <Modal title={`Visa history: ${v.visa_code}`} size="lg" close={close}>
      <table className="t"><thead><tr><th>Date</th><th>Attempt</th><th>From</th><th>To</th><th>By</th><th>Reason</th><th>Notified</th></tr></thead>
        <tbody>{v.history.map((h: Any, i: number) => <tr key={i}><td className="nowrap">{fmtDT(h.changed_at)}</td><td>{h.attempt_no}</td><td>{h.from_name || '-'}</td><td>{h.to_name}</td><td>{h.by}</td><td>{h.reason || ''}</td><td>{h.notified ? 'Yes' : <span className="badge orange">No</span>}</td></tr>)}</tbody></table>
    </Modal>
  ));
  return (
    <div className={embedded ? 'app-visa' : 'card'}>
      <div className="hd">{embedded ? <b>Visa</b> : null}<StageBadge code={v.stage} type="visa" /><h2>{v.country}</h2><span className="mono small muted">{v.visa_code}</span><span className="badge">Attempt {v.attempt_no}</span>{v.is_open ? null : <span className="badge grey">Closed</span>}<span className="grow" />
        {P.visa_edit ? <>
          <button className="btn sm primary" onClick={() => openOverlay((close) => <VisaStagePopup v={v} close={close} done={reload} />)}>Change stage</button>
          <button className="btn sm" onClick={() => visaEdit(v, reload)}>Edit details</button>
          {v.stage === 'rejected' ? <button className="btn sm" onClick={reapply}>Re-apply</button> : null}
        </> : null}
        <button className="btn sm" onClick={hist}>History</button></div>
      <div className="bd">
        <div className="kv">
          {kv('Linked application', `${v.application_code || ''} ${v.university || ''}`)}{kv('Visa type', v.visa_type)}
          {kv('Appointment', v.appointment_at ? <>{fmtDT(v.appointment_at)}<br /><span className="small">{v.centre || ''} {v.vfs_reference ? '· ' + v.vfs_reference : ''}</span></> : '')}
          {kv('Submission date', fmtDate(v.submission_date))}
          {kv('Proof of funds', <>{v.funds_type}{v.funds_type === 'Blocked account' ? <div className="small">{v.blocked_provider || ''} · {v.blocked_account_status || ''}</div> : null}{v.funds_amount ? <div className="small">{money(v.funds_amount, v.funds_currency)} <span className="internal-label">Internal</span></div> : null}</>)}
          {kv('Health / travel insurance', <>{v.insurance_status} {link(v.files?.insurance, 'policy')}</>)}{kv('Accommodation', <>{v.accommodation_status} {link(v.files?.accommodation, 'proof')}</>)}
          {v.is_germany ? kv('APS (Germany)', <>{v.aps_status || 'Not applied'}{v.aps_reference ? <><br /><span className="small">Ref {v.aps_reference}</span></> : null}{v.aps_date ? <><br /><span className="small">{fmtDate(v.aps_date)}</span></> : null} {link(v.files?.aps, 'certificate')}</>) : null}
          {kv('Cover letter', link(v.files?.cover_letter, 'View'))}{kv('Decision', v.decision ? <>{v.decision} {fmtDate(v.decision_date)} {link(v.files?.decision, 'file')}</> : '')}
          {v.valid_from ? kv('Visa valid', `${fmtDate(v.valid_from)} to ${fmtDate(v.valid_to)}`) : null}
          {v.rejection_reason ? kv('Rejection reason', <>{v.rejection_reason} <span className="internal-label">Internal</span></>) : null}{kv('Travel date', fmtDate(v.travel_date))}
          {v.remarks ? <div className="full">{kv('Remarks', <>{v.remarks} <span className="internal-label">Internal</span></>)}</div> : null}
        </div>
        {P.visa_edit ? <div className="row" style={{ marginTop: 12 }}><span className="small muted">Upload:</span>
          {['insurance', 'accommodation', 'cover_letter', ...(v.is_germany ? ['aps'] : [])].map((k) => <button key={k} className="btn xs" onClick={() => openOverlay((close) => <VisaFile v={v} kind={k} close={close} done={reload} />)}>{UPLOADS[k]}</button>)}</div> : null}
        {v.attempts?.length ? <><h4 style={{ margin: '14px 0 6px' }}>Previous attempts</h4><ul className="list-plain small">{v.attempts.map((a: Any, i: number) => <li key={i}>Attempt {a.attempt_no}: {a.decision || a.stage} {fmtDate(a.decision_date)} {a.rejection_reason ? '· ' + a.rejection_reason : ''}</li>)}</ul></> : null}
      </div>
    </div>
  );
}

// ---------- the Applications & Visa tab ----------
export function ApplicationsTab({ s, P, reload: reloadFrame, openNew }: Ctx & { openNew?: boolean }) {
  const [apps, setApps] = useState<Any[] | null>(null);
  const [visa, setVisa] = useState<Any | null>(null);
  const opened = useRef(false);
  const load = useCallback(async () => {
    try { const [a, v] = await Promise.all([GET(`/students/${s.id}/applications`), GET(`/students/${s.id}/visa`).catch(() => null)]); setApps(a); setVisa(v); } catch (e) { showError(e); }
  }, [s.id]);
  useEffect(() => { load(); }, [load]);
  const reload = () => { load(); reloadFrame(); };
  useEffect(() => { if (openNew && !opened.current) { opened.current = true; applicationForm(s).then((r) => { if (r) reload(); }); } }, [openNew]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!apps) return <div className="empty">Loading...</div>;
  const reveal = async (id: string, el: HTMLButtonElement) => { try { const r = await POST(`/applications/${id}/reveal-secret`); el.outerHTML = `<span class="mono">${String(r.secret || '').replace(/[<>&]/g, '')}</span> <span class="small muted">(logged)</span>`; } catch (e) { showError(e); } };
  const del = async (id: string) => { const r = await confirmBox('Delete this application? (Admin only, soft delete)', { danger: true, ok: 'Delete', reason: true }); if (r) { try { await DEL(`/applications/${id}`, { reason: r }); reload(); } catch (e) { showError(e); } } };
  const startVisa = async (id: string) => {
    const r = await formModal({ title: 'Start visa', values: {}, save: (v) => POST(`/students/${s.id}/visa`, { ...v, application_id: id }),
      intro: <p className="small muted" style={{ marginTop: 0 }}>The visa starts at &quot;Visa document preparation&quot; and the student gets email E14 with the visa document checklist.</p>,
      fields: [{ k: 'visa_type', label: 'Visa type', type: 'select', req: true, opts: M.list('visa_type').map((x) => [x.name, x.name] as [string, string]), col: 6 }] });
    if (r) { toast('Visa started', 'ok'); reload(); }
  };
  return (
    <div className="card">
      <div className="hd"><h2>Applications &amp; Visa</h2><span className="grow" />{P.applications_edit ? <button className="btn sm primary" onClick={async () => { if (await applicationForm(s)) reload(); }}>+ Add application</button> : null}</div>
      <div className="bd">{apps.length ? apps.map((a) => (
        <div key={a.id} className="app-card">
          <div className="top"><StageBadge code={a.stage} /><b>{a.university}</b><span>{a.course}</span><span className="badge">{a.intake}</span><span className="badge">{a.country}</span><span className="grow" /><span className="mono small muted">{a.application_code}</span></div>
          <div className="kv small" style={{ marginTop: 10 }}>
            {kv('Applied date', fmtDate(a.applied_date))}{kv('Deadline', fmtDate(a.deadline))}{kv('Days in stage', a.days_in_stage)}{kv('Channel', a.channel)}{kv('University app ID', a.university_app_id)}
            {kv('Portal login', <>{a.portal_ref}{a.has_portal_secret ? <> <button className="btn xs" onClick={(e) => reveal(a.id, e.currentTarget)}>Reveal password</button></> : null}</>)}
            {kv('Application fee', a.app_fee !== null && a.app_fee !== undefined ? <>{money(a.app_fee, a.app_fee_currency)} {a.app_fee_paid ? <span className="badge green">paid {fmtDate(a.app_fee_paid_date)}</span> : <span className="badge orange">not paid</span>}</> : '')}
            {a.interview_at ? kv('Interview', `${fmtDT(a.interview_at)}${a.interview_link ? ' · ' + a.interview_link : ''}`) : null}
            {a.offer_deadline ? kv('Offer acceptance deadline', fmtDate(a.offer_deadline)) : null}{a.offer_conditions ? kv('Offer conditions', a.offer_conditions) : null}{kv('Handled by', a.handled_by_name)}
            {a.offer_letter ? kv('Offer letter', <a href="#" onClick={(e) => { e.preventDefault(); viewDocument(a.offer_letter.id); }}>View</a>) : null}
            {a.remarks_internal ? <div className="full">{kv('Remarks', <>{a.remarks_internal} <span className="internal-label">Internal</span></>)}</div> : null}
            {a.source_channel === 'student_portal' ? <div>{kv('Source', <span className="badge purple">Student portal request</span>)}</div> : null}
          </div>
          <FlowStrip a={a} />
          {(visa?.cases ?? []).filter((v: Any) => v.application_id === a.id).map((v: Any) => <VisaCard key={v.id} v={v} P={P} reload={reload} embedded />)}
          <AppPortalBox app={a} reload={reload} />
          <UniBox app={a} studentId={String(s.id)} reload={reload} />
          <UniStudentBox appId={a.id} />
          <div className="row" style={{ marginTop: 10 }}>
            {P.applications_edit ? <>
              <button className="btn sm primary" onClick={() => stagePopup(a, reload)}>Change stage</button>
              <button className="btn sm" onClick={async () => { if (await applicationForm(s, a)) reload(); }}>Edit</button>
              {a.stage !== 'withdrawn' ? <button className="btn sm" onClick={() => stagePopup(a, reload, 'withdrawn')}>Withdraw</button> : null}
            </> : null}
            {P.visa_edit && a.visa_ready && !a.visa ? <button className="btn sm primary" onClick={() => startVisa(a.id)}>Start visa</button> : null}
            <button className="btn sm" onClick={() => historyPopup(a)}>View history</button>
            {P.applications_delete ? <button className="btn sm danger" onClick={() => del(a.id)}>Delete</button> : null}
          </div>
        </div>
      )) : <div className="empty">No applications yet. Create one here or from the Shortlist tab.</div>}</div>
    </div>
  );
}
export { Link };
