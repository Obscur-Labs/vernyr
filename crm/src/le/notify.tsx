'use client';

import { useMeta } from './meta';
import { confirmBox } from './ui';

/** The client's email preview and "Save and notify" / "Save without notifying" pair (legacy/public/js/core.js). */

/* eslint-disable @typescript-eslint/no-explicit-any */
export function EmailPreview({ pv }: { pv: any }) {
  const cc = useMeta((s) => s.meta?.settings.hard_cc);
  if (!pv) return null;
  return (
    <div className="email-preview">
      <div className="eh"><b>To:</b> {pv.to || ''}<br /><b>CC:</b> {pv.cc || cc} <span className="muted">(always)</span><br /><b>Subject:</b> {pv.subject || ''}
        {pv.active === false ? <><br /><span className="badge orange">This email trigger is switched Off by Admin: no email will be sent</span></> : null}</div>
      <iframe sandbox="" srcDoc={pv.html || ''} title="Email preview" />
    </div>
  );
}
export const confirmSilent = () => confirmBox('The student will NOT receive an email about this change. Are you sure?', { title: 'Save without notifying', ok: 'Yes, save without email', cancel: 'No' });
export function NotifyButtons({ onSave, label = 'Save and notify student', busy }: { onSave: (notify: boolean) => void; label?: string; busy?: boolean }) {
  return <>
    <button className="btn" type="button" disabled={busy} onClick={async () => { if (await confirmSilent()) onSave(false); }}>Save without notifying</button>
    <button className="btn primary" type="button" disabled={busy} onClick={() => onSave(true)}>{label}</button>
  </>;
}
