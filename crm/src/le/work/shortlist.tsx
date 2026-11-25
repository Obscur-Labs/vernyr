'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DEL, GET, POST, PUT, ApiError } from '../api';
import { M, useMeta } from '../meta';
import { fmtDate, istToday, money } from '../format';
import { formModal, type Field, type Vals } from '../form';
import { Modal, confirmBox, openOverlay, showError, toast } from '../ui';
import { StatusBadge } from '../badges';
import { NotifyButtons } from '../notify';
import type { Ctx } from '../student/tabs';

/** The client's Shortlist tab (legacy/public/js/pages/work.js shortlist). */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
export const CUR = ['EUR', 'INR', 'CNY', 'USD'];
export const LANGS = ['English', 'French', 'German', 'Italian', 'Spanish', 'Dutch', 'Chinese', 'Other'];
export const LEVELS = ['Bachelor', 'Master', 'MBA', 'PhD', 'Diploma', 'Foundation', 'Language course'];
export const unis = (country?: string) => (useMeta.getState().meta?.universities ?? []).filter((u: Any) => u.active !== false && (!country || u.country_id === country));
export const courses = (uni?: string) => (useMeta.getState().meta?.courses ?? []).filter((c: Any) => c.active !== false && c.university_id === uni);

/** Shortlist warnings (R1 to R5), checked live as the form changes. */
function Warnings({ s, v, set }: { s: Any; v: Vals; set: (k: string, x: unknown) => void }) {
  const [w, setW] = useState<Any[]>([]);
  const key = JSON.stringify([v.country_id, v.level, v.university_id, v.course_id, v.intake_id, v.deadline, v.tuition_fee, v.currency, v.language]);
  useEffect(() => {
    if (!v.country_id || !v.level) { setW([]); return; }
    const t = setTimeout(() => {
      POST(`/students/${s.id}/shortlist/check`, { ...v, university_id: v.university_id === '__new' ? null : v.university_id, course_id: v.course_id === '__text' ? null : v.course_id })
        .then(setW).catch(() => setW([]));
    }, 300);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>
    {w.map((i, n) => <div key={n} className={`flag ${i.level}`} style={{ margin: '3px 0', display: 'flex' }}>⚑ {i.text}</div>)}
    {w.some((i) => i.code === 'R1') ? <label className="row small" style={{ gap: 6, marginTop: 4 }}><input type="checkbox" checked={!!v.checked_similar} onChange={(e) => set('checked_similar', e.target.checked)} /> I have checked: the student has a similar completed qualification</label> : null}
  </>;
}
const noMasterCourse = (v: Vals) => v.university_id === '__new' || v.course_id === '__text' || !courses(v.university_id).length;
function slFields(s: Any): Field[] {
  return [
    { k: 'country_id', label: 'Country', type: 'select', req: true, opts: M.countries() },
    { k: 'university_id', label: 'University', type: 'select', req: true, opts: (v) => [...unis(v.country_id).map((u: Any) => [u.id, u.name + (u.approved === false ? ' (pending approval)' : '')] as [string, string]), ['__new', '+ Add new university...']] },
    { k: 'new_university', label: 'New university name', req: true, show: (v) => v.university_id === '__new', help: 'Sent to Admin for approval, usable immediately' },
    { k: 'course_id', label: 'Course (from master)', type: 'select', opts: (v) => [...courses(v.university_id).map((c: Any) => [c.id, `${c.name} (${c.level || ''})`] as [string, string]), ['__text', 'Other course (type name)...']], show: (v) => !!v.university_id && v.university_id !== '__new' },
    { k: 'course_name_text', label: 'Course name', req: true, show: noMasterCourse },
    { k: 'save_course_to_master', label: 'Send this course to Admin for the master', type: 'checkbox', show: noMasterCourse },
    { k: 'level', label: 'Level', type: 'select', req: true, opts: LEVELS }, { k: 'intake_id', label: 'Intake', type: 'select', req: true, opts: M.intakes() },
    { k: 'tuition_fee', label: 'Tuition fee (per year)', type: 'number', min: 0, col: 1 }, { k: 'currency', label: 'Currency', type: 'select', noBlank: true, opts: CUR, col: 1 },
    { k: 'application_fee', label: 'Application fee (0 if free)', type: 'number', min: 0, col: 1 }, { k: 'app_fee_currency', label: 'Currency', type: 'select', noBlank: true, opts: CUR, col: 1 },
    { k: 'deadline', label: 'Application deadline', type: 'date' }, { k: 'course_link', label: 'Course link', type: 'url', placeholder: 'https://', col: 4 },
    { k: 'duration', label: 'Duration', placeholder: 'e.g. 2 years' }, { k: 'language', label: 'Language of instruction', type: 'select', opts: LANGS },
    { k: 'priority', label: 'Priority', type: 'select', opts: ['Dream', 'Target', 'Safe'] },
    { k: 'status', label: 'Status', type: 'select', req: true, noBlank: true, opts: ['Suggested', 'Shared with student', 'Student agreed', 'Rejected by student'] },
    { k: 'remarks', label: 'Remarks (internal, never emailed)', type: 'textarea', col: 6 },
    { k: 'remark_for_student', label: 'Remark for student (shown in the student portal)', type: 'textarea', col: 4, maxlength: 500 },
    { k: 'show_priority_to_student', label: 'Show priority to student', type: 'checkbox', col: 2 },
    { k: 'warn', type: 'html', html: (v, set) => <Warnings s={s} v={v} set={set} /> },
  ];
}
export async function shortlistForm(s: Any, row?: Any) {
  let v: Vals;
  if (row) v = { ...row, course_id: row.course_id || (row.course_name_text ? '__text' : '') };
  else { const p = (await GET('/students/' + s.id)).prefs; v = { status: 'Suggested', currency: 'EUR', app_fee_currency: 'EUR', intake_id: p.intake_id, level: p.level }; }
  return formModal<Any>({
    title: row ? 'Edit shortlist option' : 'Add course option', size: 'lg', fields: slFields(s), values: v,
    onChange: (x, prev, set) => {
      if (x.country_id !== prev.country_id && prev.country_id !== undefined) set('university_id', '');
      // fill in from the course master
      if (x.course_id && x.course_id !== '__text' && x.course_id !== prev.course_id) {
        const c = (useMeta.getState().meta?.courses ?? []).find((cc: Any) => cc.id === x.course_id) as Any;
        if (c) for (const k of ['tuition_fee', 'application_fee', 'course_link', 'duration', 'language']) if (c[k] !== null && c[k] !== undefined && !x[k]) set(k, c[k]);
        if (c?.level) set('level', c.level);
      }
    },
    save: async (vals) => {
      const b = { ...vals };
      if (b.university_id === '__new') b.university_id = null;
      if (b.course_id === '__text') b.course_id = null;
      const r = row ? await PUT(`/shortlist/${row.id}`, b) : await POST(`/students/${s.id}/shortlist`, b);
      toast(r.warnings?.length ? `Saved with ${r.warnings.length} warning(s)` : 'Saved', 'ok');
      if (b.new_university || b.save_course_to_master) await useMeta.getState().load();
      return r;
    },
  });
}

const WARN_LABEL: Record<string, string> = { R3: 'Deadline passed', R4: 'Above budget', R2: 'Dependant visa', R1: 'Similar qualification' };
function Share({ s, list, close, done }: { s: Any; list: Any[]; close: () => void; done: () => void }) {
  const [msg, setMsg] = useState('');
  const send = async (notify: boolean) => {
    try { await POST(`/students/${s.id}/shortlist/share`, { ids: list.map((r) => r.id), notify, message: msg }); toast(notify ? 'Shared. Email queued.' : 'Marked as shared (no email)', 'ok'); close(); done(); } catch (e) { showError(e); }
  };
  return (
    <Modal title="Share options with student (E04)" size="lg" close={close} foot={<><button className="btn" onClick={close}>Cancel</button><NotifyButtons onSave={send} label="Share and email student" /></>}>
      <p>{list.length} option(s) will be emailed to <b>{s.email}</b>. Only country, university, course, intake, tuition fee, deadline and link are included. Remarks and budget notes are NOT included.</p>
      <div className="f c6"><label>Message from counsellor (optional)</label><textarea rows={2} maxLength={500} value={msg} onChange={(e) => setMsg(e.target.value)} /></div>
    </Modal>
  );
}
export function ShortlistTab({ s, P }: Ctx) {
  const router = useRouter();
  const [rows, setRows] = useState<Any[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const load = useCallback(async () => { try { setRows(await GET(`/students/${s.id}/shortlist`)); } catch (e) { showError(e); } }, [s.id]);
  useEffect(() => { load(); }, [load]);
  const creating = useRef(false);
  if (!rows) return <div className="empty">Loading...</div>;
  const picked = rows.filter((r) => sel.has(r.id));
  const createApp = async (r: Any, extra: Any = {}) => {
    if (creating.current) return;
    creating.current = true;
    try { await POST(`/shortlist/${r.id}/create-application`, extra); toast('Application created. Student email E05 queued.', 'ok'); router.push(`/students/${s.id}/applications`); }
    catch (e) {
      if (e instanceof ApiError && e.data.needs_confirm === 'deadline') { creating.current = false; if (await confirmBox('The application deadline has passed. Create the application anyway?')) return createApp(r, { ...extra, confirm_deadline: true }); }
      else showError(e);
    } finally { creating.current = false; }
  };
  const compare = () => {
    if (picked.length < 2) { toast('Select at least 2 options to compare', 'err'); return; }
    const def: [string, (r: Any) => string][] = [['Country', (r) => r.country], ['University', (r) => r.university], ['Course', (r) => r.course], ['Level', (r) => r.level], ['Intake', (r) => r.intake],
      ['Tuition / year', (r) => money(r.tuition_fee, r.currency)], ['Application fee', (r) => money(r.application_fee, r.app_fee_currency)], ['Deadline', (r) => fmtDate(r.deadline)], ['Duration', (r) => r.duration],
      ['Language', (r) => r.language], ['Priority', (r) => r.priority], ['Status', (r) => r.status], ['Warnings', (r) => r.warnings.map((w: Any) => w.text).join('; ')]];
    openOverlay((close) => <Modal title="Compare options" size="xl" close={close}><div className="table-wrap"><table className="t compare"><tbody>{def.map(([l, f]) => <tr key={l}><th>{l}</th>{picked.map((r) => <td key={r.id}>{f(r) || '-'}</td>)}</tr>)}</tbody></table></div></Modal>);
  };
  return (
    <div className="card">
      <div className="hd"><h2>Course shortlist</h2><span className="grow" />
        <button className="btn sm" onClick={compare}>Compare selected</button><Link className="btn sm" href={`/courses?student_id=${s.id}`}>🔎 Find eligible courses</Link>
        {P.shortlist_edit ? <>
          <button className="btn sm" onClick={() => { if (!picked.length) { toast('Select the options to share', 'err'); return; } openOverlay((close) => <Share s={s} list={picked} close={close} done={load} />); }}>Share selected with student</button>
          <button className="btn sm primary" onClick={async () => { if (await shortlistForm(s)) load(); }}>+ Add option</button>
        </> : null}
      </div>
      <div className="bd flush">{rows.length ? (
        <div className="table-wrap"><table className="t cards"><thead><tr><th className="chk" /><th>Country</th><th>University</th><th>Course</th><th>Level</th><th>Intake</th><th>Tuition / yr</th><th>Deadline</th><th>Priority</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td className="chk"><input type="checkbox" checked={sel.has(r.id)} onChange={(e) => setSel((x) => { const n = new Set(x); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} /></td>
              <td data-label="Country">{r.country}</td>
              <td data-label="University">{r.university}{r.university_pending ? <> <span className="badge orange">pending approval</span></> : null}</td>
              <td data-label="Course">{r.course_link ? <a href={r.course_link} target="_blank" rel="noopener noreferrer">{r.course}</a> : r.course}
                {r.warnings.length ? <div className="sl-warn">{r.warnings.map((w: Any, i: number) => <span key={i} className={`flag ${w.level}`} title={w.text}>⚑ {WARN_LABEL[w.code] ?? 'English below requirement'}</span>)}</div> : null}
                {r.remarks ? <div className="small muted">{r.remarks} <span className="internal-label">Internal</span></div> : null}</td>
              <td data-label="Level">{r.level}</td><td data-label="Intake">{r.intake}</td><td data-label="Tuition">{money(r.tuition_fee, r.currency)}</td>
              <td data-label="Deadline" className={`nowrap ${r.deadline && r.deadline < istToday() ? 'muted' : ''}`}>{fmtDate(r.deadline)}</td><td data-label="Priority">{r.priority || ''}</td>
              <td data-label="Status"><StatusBadge s={r.status} />
                {r.student_response ? <div className="small"><span className={`badge ${r.student_response === 'Accepted' ? 'green' : r.student_response === 'Rejected' ? 'red' : 'purple'}`}>Student: {r.student_response}</span>{r.student_response_reason ? ` ${r.student_response_reason}` : ''}</div> : null}
                {r.remark_for_student ? <div className="small muted">For student: {r.remark_for_student}</div> : null}</td>
              <td className="nowrap">
                {P.applications_edit && !r.application_id ? <button className="btn xs primary" onClick={() => createApp(r)}>Create application</button> : null}{' '}
                {P.shortlist_edit ? <>
                  <button className="btn xs" onClick={async () => { if (await shortlistForm(s, r)) load(); }}>Edit</button>{' '}
                  <button className="btn xs danger" onClick={async () => { if (await confirmBox('Remove this option from the shortlist? (logged)', { danger: true, ok: 'Remove' })) { try { await DEL(`/shortlist/${r.id}`); load(); } catch (e) { showError(e); } } }}>Remove</button>
                </> : null}
              </td>
            </tr>
          ))}</tbody></table></div>
      ) : <div className="empty">No course options yet</div>}</div>
    </div>
  );
}
