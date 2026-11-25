'use client';

import { useState } from 'react';
import { DEL, POST, PUT, ApiError } from './api';
import { M, useMeta } from './meta';
import { formModal, type Field, type Vals } from './form';
import { Modal, confirmBox, openOverlay, toast } from './ui';

/** The client's lead forms and dialogs (legacy/public/js/pages/leads.js). */

export const STATUSES = ['New', 'Contacted', 'Follow-up', 'Interested', 'Not interested', 'Converted'];
export const ACT_TYPES = ['Call (outgoing)', 'Call (incoming)', 'WhatsApp', 'Email', 'Meeting / Walk-in', 'Note'];
export const OUTCOMES = ['Connected', 'Not reachable', 'Busy', 'Call back later', 'Wrong number'];
export const TL_ICON: Record<string, string> = { stage: '➜', document: 'D', email: '@', payment: '₹', task: '✓', note: 'N', comment: 'C', profile: 'P', lead: 'L' };
const CITIES = ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Mumbai', 'Pune', 'Delhi', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata', 'Jaipur', 'Indore'];

export type Lead = Vals & { id: string; name: string; lead_code: string; status: string; email?: string };

export function leadFields(v: Vals, allowed?: string[]): Field[] {
  const statusOpts = allowed
    ? [v.status, ...allowed].filter((x, i, a) => x && a.indexOf(x) === i && x !== 'Converted')
    : ['New', 'Contacted', 'Follow-up', 'Interested', 'Not interested'];
  const src = (x: Vals) => M.name(x.source_id);
  return [
    { k: 's1', type: 'section', label: 'Contact' },
    ...(v.lead_code ? [{ k: 'lead_code', label: 'Lead ID', disabled: true, col: 2 } as Field] : []),
    { k: 'first_name', label: 'First name', req: true, maxlength: 50, help: 'Letters, spaces and dot only' }, { k: 'last_name', label: 'Last name', maxlength: 50 },
    { k: 'phone', label: 'Phone', type: 'phone', req: true, help: '10 digits for +91' }, { k: 'is_whatsapp', label: 'This is a WhatsApp number', type: 'checkbox' },
    { k: 'alt_phone', label: 'Alternate phone', type: 'tel' },
    { k: 'email', label: 'Email', type: 'email', help: 'Required before converting to a student' }, { k: 'city', label: 'City', list: CITIES },
    { k: 'state', label: 'State', type: 'select', opts: M.list('indian_state').map((s) => [s.name, s.name] as [string, string]) },
    { k: 's2', type: 'section', label: 'Source (internal, never shown to the student)' },
    { k: 'source_id', label: 'Source', type: 'select', req: true, opts: M.list('lead_source') },
    { k: 'referred_by', label: 'Referred by', req: true, show: (x) => src(x) === 'Referral' },
    { k: 'sub_agent_id', label: 'Sub-agent', type: 'select', req: true, opts: M.list('sub_agent'), show: (x) => src(x) === 'Sub-agent' },
    { k: 'source_details', label: 'Source details', req: true, show: (x) => src(x) === 'Other' },
    { k: 's3', type: 'section', label: 'Interest' },
    { k: 'interested_countries', label: 'Interested country', type: 'multi', col: 6, opts: M.countries() },
    { k: 'course_interest', label: 'Interested course / field', placeholder: 'e.g. MBA, MSc Data Science' },
    { k: 'level', label: 'Study level', type: 'select', opts: ['Bachelor', 'Master', 'MBA', 'PhD', 'Diploma', 'Foundation', 'Language course'] },
    { k: 'intake_id', label: 'Intake', type: 'select', opts: M.intakes() },
    { k: 'highest_qualification', label: 'Highest qualification', type: 'select', opts: ['12th', 'Diploma', 'Bachelor', 'Master'] },
    { k: 's4', type: 'section', label: 'Status' },
    { k: 'status', label: 'Status', type: 'select', req: true, noBlank: true, opts: statusOpts as string[] },
    { k: 'not_interested_reason', label: 'Not interested reason', type: 'select', req: true, opts: M.list('not_interested_reason').map((x) => [x.name, x.name] as [string, string]), show: (x) => x.status === 'Not interested' },
    { k: 'next_followup_at', label: 'Next follow-up date and time', type: 'datetime', req: true, show: (x) => x.status === 'Follow-up' },
    { k: 'assigned_user_id', label: 'Assigned counsellor', type: 'select', req: true, opts: M.users(['counsellor', 'admin', 'manager']).map((u) => [u.id, u.name] as [string, string]), disabled: !M.admin(), help: M.admin() ? '' : 'Only Admin can change' },
    { k: 'notes_internal', label: 'Notes (internal, never emailed)', type: 'textarea', col: 6, maxlength: 2000 },
  ];
}

/** Duplicate popup (4.6): open the existing record, request access, or (Admin) save anyway with a reason. */
function duplicatePopup(err: ApiError, retry: (extra: Vals) => Promise<unknown>) {
  const d = err.data.duplicate as { kind: string; id: string; can_open: boolean };
  const href = d.kind === 'student' ? `/students/${d.id}` : `/leads/${d.id}`;
  return new Promise<unknown>((resolve) => {
    openOverlay((close) => <DupBody err={err} d={d} href={href} close={close} resolve={resolve} retry={retry} />, { onClose: () => resolve(null) });
  });
}
function DupBody({ err, d, href, close, resolve, retry }: { err: ApiError; d: { kind: string; id: string; can_open: boolean }; href: string; close: () => void; resolve: (v: unknown) => void; retry: (x: Vals) => Promise<unknown> }) {
  const admin = M.admin();
  const [reason, setReason] = useState('');
  return (
    <Modal title="Duplicate found" size="sm" close={close} foot={<>
      <button className="btn" onClick={close}>Cancel</button>
      {d.can_open ? <a className="btn" href={href}>Open existing</a> : (
        <button className="btn" onClick={async () => { try { const r = await POST('/leads/request-access', { kind: d.kind, id: d.id }); toast(r.message, 'ok'); close(); } catch (e) { toast((e as Error).message, 'err'); } }}>Request access</button>
      )}
      {admin ? <button className="btn primary" onClick={async () => { if (!reason.trim()) { toast('Please give a reason', 'err'); return; } close(); resolve(await retry({ save_anyway: true, save_anyway_reason: reason.trim() })); }}>Save anyway</button> : null}
    </>}>
      <div className="warn-box">{err.message}</div>
      {admin ? <div className="f c6" style={{ marginTop: 12 }}><label>Reason (for &quot;Save anyway&quot;)</label><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        : <p className="small muted">You cannot create a duplicate record.</p>}
    </Modal>
  );
}

export async function leadForm(lead: Lead | null, allowed?: string[]): Promise<unknown> {
  const me = useMeta.getState().me!;
  const v: Vals = lead ? { ...lead, interested_countries: lead.interested_countries || [] } : { status: 'New', is_whatsapp: true, country_code: '+91', assigned_user_id: me.id };
  let another = false;
  const res = await formModal({
    title: lead ? `Edit lead ${lead.lead_code}` : 'Add lead', size: 'lg', fields: leadFields(v, allowed), values: v,
    extraButtons: lead ? undefined : (doSave) => <button className="btn" type="button" onClick={() => { another = true; doSave(); }}>Save and add another</button>,
    save: async (vals) => {
      const send = async (extra: Vals = {}): Promise<unknown> => {
        try { return lead ? (await PUT(`/leads/${lead.id}`, { ...vals, ...extra }), { id: lead.id }) : await POST('/leads', { ...vals, ...extra }); }
        catch (e) { if (e instanceof ApiError && e.status === 409 && e.data.duplicate) return duplicatePopup(e, send); throw e; }
      };
      const r = (await send()) as { lead_code?: string } | null;
      if (!r) return false;
      toast(lead ? 'Lead saved' : `Lead ${r.lead_code || ''} created`, 'ok');
      return r;
    },
  });
  if (res && another) return leadForm(null);
  return res;
}

export const logCall = (l: Lead) => formModal({
  title: `Log call / note: ${l.name}`, values: { type: 'Call (outgoing)' },
  fields: [
    { k: 'type', label: 'Type', type: 'select', req: true, opts: ACT_TYPES, col: 3 },
    { k: 'outcome', label: 'Outcome', type: 'select', req: true, opts: OUTCOMES, col: 3, show: (v) => String(v.type || '').startsWith('Call') },
    { k: 'notes', label: 'Notes (internal)', type: 'textarea', req: true, col: 6, maxlength: 2000 },
    { k: 'next_followup_at', label: 'Next follow-up (optional)', type: 'datetime', col: 3, help: 'If filled, sets status to Follow-up' },
  ],
  save: async (v) => { await POST(`/leads/${l.id}/activities`, v); toast('Logged', 'ok'); return true; },
});

export const setFollowup = (l: Lead) => formModal({
  title: `Set follow-up: ${l.name}`, size: 'sm', values: {},
  fields: [
    { k: 'next_followup_at', label: 'Follow-up date and time', type: 'datetime', req: true, col: 6 },
    { k: 'html', type: 'html', html: () => <p className="small muted">{l.email ? 'If trigger E03 is On, the lead receives an email with this date and time.' : 'No email on this lead, so no email will be sent.'}</p> },
  ],
  save: async (v) => { await POST(`/leads/${l.id}/followup`, v); toast('Follow-up set', 'ok'); return true; },
});

export async function deleteLead(l: Lead) {
  const r = await confirmBox(<>Delete lead {l.name}? This is a soft delete and is logged.</>, { danger: true, ok: 'Delete', reason: true });
  if (!r) return false;
  await DEL(`/leads/${l.id}`, { reason: r });
  toast('Lead deleted', 'ok');
  return true;
}
