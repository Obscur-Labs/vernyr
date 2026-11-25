'use client';

import { useState } from 'react';
import Link from 'next/link';
import { GET, POST, PUT } from './api';
import { M, useMeta } from './meta';
import { fmtDT, fromLocalInput } from './format';
import { formModal, type Field } from './form';
import { Modal, confirmBox, openOverlay, showError, toast } from './ui';
import { PriBadge, StatusBadge } from './badges';

/** The client's tasks (legacy/public/js/pages/tasks.js): task form, table and row actions. */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Task = Record<string, any>;
export const TYPES = ['Internal task', 'Student action', 'Follow-up call', 'Document collection', 'Application submission', 'Visa appointment', 'Other'];

/** preset may carry student_id / lead_id. Resolves with the saved task, or null. */
export async function taskForm(preset: Task = {}, task?: Task) {
  const me = useMeta.getState().me!;
  let students: { id: string; name: string; student_code: string }[] = [];
  try { students = (await GET('/students?size=100')).rows; } catch { /* none */ }
  if (preset.student_id && !students.find((s) => s.id === preset.student_id)) {
    try { const d = await GET('/students/' + preset.student_id); students.unshift({ id: d.student.id, name: [d.student.first_name, d.student.last_name].filter(Boolean).join(' '), student_code: d.student.student_code }); } catch { /* ignore */ }
  }
  const fields: Field[] = [
    { k: 'title', label: 'Title', req: true, col: 6, maxlength: 150 }, { k: 'description', label: 'Description', type: 'textarea', col: 6 },
    { k: 'type', label: 'Task type', type: 'select', req: true, noBlank: true, opts: TYPES, col: 3, help: '"Student action" also emails the student (E18)' },
    { k: 'student_id', label: 'Linked student', type: 'select', blank: 'None', opts: students.map((s) => [s.id, `${s.name} (${s.student_code})`] as [string, string]), col: 3 },
    { k: 'assigned_to', label: 'Assigned to', type: 'select', req: true, noBlank: true, opts: M.users().map((u) => [u.id, u.id === me.id ? `${u.name} (me)` : u.name] as [string, string]), col: 2 },
    { k: 'due_at', label: 'Due date and time', type: 'datetime', req: true, col: 2 }, { k: 'priority', label: 'Priority', type: 'select', noBlank: true, opts: ['High', 'Medium', 'Low'], col: 2 },
    { k: 'reminder', label: 'Reminder', type: 'select', noBlank: true, opts: ['None', 'At due time', '15 min', '1 hour', '1 day before'], col: 2 },
    { k: 'repeat_rule', label: 'Repeat', type: 'select', noBlank: true, opts: ['None', 'Daily', 'Weekly', 'Monthly'], col: 2 },
    ...(task ? [{ k: 'status', label: 'Status', type: 'select', noBlank: true, opts: ['Open', 'In progress', 'Done', 'Cancelled'], col: 2 } as Field] : []),
  ];
  const tomorrow = new Date(Date.now() + 864e5); tomorrow.setMinutes(0);
  const values = task ? { ...task } : { type: 'Internal task', priority: 'Medium', reminder: 'At due time', repeat_rule: 'None', assigned_to: me.id, due_at: tomorrow.toISOString(), ...preset };
  return formModal({
    title: task ? 'Edit task' : 'New task', size: 'lg', fields, values,
    extraButtons: task ? undefined : (doSave, v) => v.type === 'Student action'
      ? <button className="btn" type="button" onClick={async () => { if (await confirmBox('The student will NOT receive an email about this task. Are you sure?')) doSave({ notify: false }); }}>Save without notifying</button>
      : null,
    save: async (v) => {
      const r = task ? await PUT(`/tasks/${task.id}`, { ...v, lead_id: task.lead_id }) : await POST('/tasks', { ...v, lead_id: preset.lead_id });
      toast('Task saved', 'ok');
      return r;
    },
  });
}

function Snooze({ id, close, done }: { id: string; close: () => void; done: () => void }) {
  const [until, setUntil] = useState('');
  const go = async (body: Record<string, unknown>) => { try { await POST(`/tasks/${id}/snooze`, body); toast('Snoozed', 'ok'); close(); done(); } catch (e) { showError(e); } };
  return (
    <Modal title="Snooze task" size="sm" close={close} foot={<>
      <button className="btn" onClick={close}>Cancel</button>
      <button className="btn primary" onClick={() => { if (until) go({ until: fromLocalInput(until) }); }}>Snooze until</button>
    </>}>
      <div className="row"><button className="btn" onClick={() => go({ by: '1h' })}>1 hour</button><button className="btn" onClick={() => go({ by: '1d' })}>1 day</button></div>
      <div className="f c6" style={{ marginTop: 12 }}><label>Or until</label><input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} /></div>
    </Modal>
  );
}

export function TaskTable({ rows, reload }: { rows: Task[]; reload: () => void }) {
  const act = (fn: () => Promise<unknown>) => async () => { try { await fn(); } catch (e) { showError(e); } };
  const done = (id: string) => act(async () => { await POST(`/tasks/${id}/done`); toast('Done', 'ok'); reload(); });
  const reassign = (t: Task) => act(async () => {
    const r = await formModal({ title: 'Reassign task', size: 'sm', fields: [{ k: 'assigned_to', label: 'Assign to', type: 'select', noBlank: true, opts: M.users().map((u) => [u.id, u.name] as [string, string]), col: 6 }],
      values: t, save: (v) => PUT(`/tasks/${t.id}`, { ...t, assigned_to: v.assigned_to }) });
    if (r) { toast('Reassigned. The new user is notified.', 'ok'); reload(); }
  });
  const reopenStudent = (id: string) => act(async () => {
    const r = await confirmBox('Re-open this task for the student?', { reason: true, reasonLabel: 'Reason (shown to the student, e.g. File unclear)' });
    if (r) { await POST(`/tasks/${id}/reopen-student`, { reason: r }); toast('Task re-opened. The student is notified.', 'ok'); reload(); }
  });
  if (!rows.length) return <div className="empty">No tasks here</div>;
  return (
    <div className="table-wrap"><table className="t cards">
      <thead><tr><th className="chk" /><th>Task</th><th>Type</th><th>Linked to</th><th>Due</th><th>Priority</th><th>Status</th><th>Assigned to</th><th /></tr></thead>
      <tbody>{rows.map((t) => (
        <tr key={t.id} className={t.overdue ? 'overdue' : ''}>
          <td className="chk"><input type="checkbox" checked={t.status === 'Done'} disabled={t.status === 'Done'} title="Mark done" onChange={done(t.id)} /></td>
          <td data-label="Task"><b>{t.title}</b> {t.is_system ? <span className="badge grey">System</span> : null}
            {t.description ? <div className="small muted">{String(t.description).slice(0, 140)}</div> : null}
            {t.overdue ? <div className="small days-red">Overdue by {t.overdue_days} day(s)</div> : null}</td>
          <td data-label="Type" className="small">{t.type}</td>
          <td data-label="Linked">{t.student_id ? <Link href={`/students/${t.student_id}/tasks`}>{t.student_name}</Link> : t.lead_id ? <Link href={`/leads/${t.lead_id}`}>{t.lead_name}</Link> : '-'}
            {t.application_code ? <div className="small mono muted">{t.application_code}</div> : null}</td>
          <td data-label="Due" className="nowrap">{fmtDT(t.due_at)}</td>
          <td data-label="Priority"><PriBadge p={t.priority} /></td>
          <td data-label="Status"><StatusBadge s={t.status} />
            {t.completed_by_type === 'student' ? <>
              <div><span className="badge purple">{t.status === 'Done' ? 'Done by student' : 'Student says done: confirm'}</span></div>
              {t.student_comment ? <div className="small">&quot;{t.student_comment}&quot;</div> : null}
              <div className="row" style={{ gap: 4, marginTop: 3 }}>
                {t.status !== 'Done' ? <button className="btn xs primary" onClick={act(async () => { await POST(`/tasks/${t.id}/confirm-student`); toast('Confirmed', 'ok'); reload(); })}>Confirm</button> : null}
                <button className="btn xs" onClick={reopenStudent(t.id)}>Re-open</button>
              </div>
            </> : null}
            {t.reopen_reason && t.status !== 'Done' ? <div className="small muted">Re-opened: {t.reopen_reason}</div> : null}</td>
          <td data-label="Assigned" className="small">{t.assigned_to_name}{t.assigned_by && t.assigned_by !== t.assigned_to ? <div className="muted">by {t.assigned_by_name}</div> : null}</td>
          <td className="nowrap">
            {t.can_edit && !['Done', 'Cancelled'].includes(t.status) ? <>
              <button className="btn xs" onClick={() => openOverlay((close) => <Snooze id={t.id} close={close} done={reload} />)}>Snooze</button>{' '}
              <button className="btn xs" onClick={reassign(t)}>Reassign</button>{' '}
            </> : null}
            {t.can_edit ? <button className="btn xs" onClick={act(async () => { if (await taskForm({}, t)) reload(); })}>Edit</button> : null}
            {t.status === 'Done' && t.can_edit ? <> <button className="btn xs ghost" onClick={act(async () => { await POST(`/tasks/${t.id}/reopen`); reload(); })}>Reopen</button></> : null}
          </td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}
