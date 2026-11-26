'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { GET, POST, download } from '@/le/api';
import { ago, fmtDate, fmtDT, initials } from '@/le/format';
import { showError, toast } from '@/le/ui';
import { dlClass, local, t, usePMe, type Any } from '@/le/p';
import { downloadConsent } from '@/le/Gate';
import { taskDone, uploadDialog } from '@/le/docs';
import { ComplBar } from '@/le/compl';

const ics = (u: string) => download(u.replace(/^\/api\/portal/, ''), 'event.ics').catch(showError);

// The client's Home (legacy/public/portal/js/home.js)
export default function Page() {
  const me = usePMe((s) => s.me);
  const [d, setD] = useState<Any | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const load = useCallback(() => GET('/dashboard').then(setD).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (d?.counsellor?.has_photo) GET('/counsellor-photo').then((r) => setPhoto(r.url)).catch(() => {}); }, [d?.counsellor?.has_photo]);
  if (!d) return <div className="empty-p">{t('Loading...')}</div>;
  const j = d.journey, cc = d.counsellor;
  const lock = <div className="lock-card">🔒 {t('Available after your registration with La Europa')}</div>;
  const callback = async () => { try { const r = await POST('/callback'); toast(t(r.message), 'ok'); } catch (e) { showError(e); } };
  return (
    <>
      {d.read_only ? <div className="p-banner warn">{t('Your file is currently inactive. Contact your counsellor to restart.')}</div> : null}
      {!d.email_verified ? <div className="p-banner info"><span className="grow">{t('Please verify your email to receive updates from La Europa.')}</span><Link className="btn sm" href="/settings">{t('Verify now')}</Link></div> : null}
      {d.payment_overdue ? <div className="p-banner err">{t('Payment overdue:')} {d.payment_overdue}. {t('Please contact your counsellor.')}</div> : null}
      {me?.pending_deletion ? <div className="p-banner warn">{t('Your account deletion request is being reviewed by La Europa.')}</div> : null}
      <div className="p-head"><div><h1>{t('Hi')} {d.first_name}!</h1><div className="sub">{d.code} · {d.account_type === 'lead' ? t('Inquiry account') : t('Registered student')}</div></div></div>
      {!d.profile_submitted ? <div className="p-card" style={{ marginBottom: 14, borderColor: 'var(--brand-2)' }}><div className="bd"><div className="row between"><h2>{t('Complete your profile')} ({d.completion.percent}%)</h2><Link className="btn primary" href="/my-information">{t('Continue')}</Link></div><div style={{ marginTop: 10 }}><ComplBar c={d.completion} /></div></div></div>
        : d.completion.percent < 100 ? <div className="p-card" style={{ marginBottom: 14 }}><div className="bd"><div className="small muted" style={{ marginBottom: 6 }}>{t('Profile completion')}</div><ComplBar c={d.completion} /></div></div> : null}
      <div className="p-card" style={{ marginBottom: 14 }}><div className="bd"><div className="journey">{j.steps.map((s: string, i: number) => (
        <div key={i} className={`st ${i < j.current || (i === j.current && i === 7) ? 'done' : i === j.current ? 'cur' : ''} ${i === 6 && j.visa_warning ? 'warn' : ''}`} data-n={i + 1}>{t(s)}{i === 6 && j.visa_approved ? ' ✓' : ''}</div>
      ))}</div><div style={{ marginTop: 8, fontWeight: 600 }}>{t(j.text)}</div></div></div>
      <div className="p-card" style={{ marginBottom: 14 }}><div className="bd" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ fontSize: 20 }}>✍</span>
        <div className="grow" style={{ minWidth: 180 }}><b>{t('My signed consent')}</b><div className="small muted">{t('The Student Declaration & Consent you signed, with the date, time and IP address of your signature.')}</div></div>
        <button className="btn primary" onClick={downloadConsent}>⬇ {t('Download PDF')}</button></div></div>
      <div className="p-grid two">
        <div className="p-grid">
          <div className="p-card"><div className="hd"><h2>{t('My counsellor')}</h2><span className="grow" /><span className={`online ${d.online ? '' : 'off'}`}><i />{d.online ? t('Online now') : t('Offline')}</span></div><div className="bd">
            {cc ? <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <div className="cc"><span className="avatar">{photo ? <img src={photo} alt="" /> : initials(cc.name)}</span><div><b>{cc.name}</b><div className="small muted">{cc.designation || t('Counsellor')}</div>
                {cc.counsellor_id ? <div className="small">{t('Counsellor ID')}: <b className="mono">{cc.counsellor_id}</b></div> : null}</div></div>
              <div className="cc-actions"><Link className="btn primary" href="/chat">{t('Message')}</Link>{cc.whatsapp ? <a className="btn" href={cc.whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp</a> : <span />}<a className="btn" href={`tel:${cc.phone || ''}`}>{t('Call')}</a></div>
              <Link className="btn block" href="/appointments" style={{ marginTop: 8 }}>{t('Book a meeting (online or at the office)')}</Link>
              <div className="small muted" style={{ marginTop: 8 }}>{t('Replies during office hours:')} {d.office_hours}</div>
              {d.team.length ? <div className="small" style={{ marginTop: 8 }}>{d.team.map((x: Any, i: number) => <div key={i}>{x.role}: <b>{x.name}</b></div>)}</div> : null}
            </> : <><p>{t('We are assigning a counsellor to you. You will hear from us soon.')}</p><button className="btn" onClick={callback}>{t('Request a call back')}</button></>}
          </div></div>
          <div className="p-card"><div className="hd"><h2>{t('My to-do')}</h2><span className="grow" /><Link className="small" href="/tasks">{t('View all')}</Link></div><div className="bd flush">
            {d.locked ? lock : d.tasks.length ? d.tasks.map((x: Any) => (
              <div key={x.id} className={`rowx ${x.overdue_days ? 'overdue' : ''}`}><input type="checkbox" checked={false} title={t('Mark as done')} style={{ width: 18, height: 18 }} onChange={async () => { if (await taskDone(x.id)) load(); }} />
                <div className="grow"><div className="t">{x.title}</div><div className={`s ${x.overdue_days ? 'days-red' : x.due_today ? 'days-orange' : ''}`}>{x.overdue_days ? t('Overdue by {n} days', { n: x.overdue_days }) : x.due_today ? t('Due today') : fmtDT(x.due_at)}</div></div></div>
            )) : <div className="empty-p">{t('You are all caught up!')}</div>}</div></div>
          <div className="p-card"><div className="hd"><h2>{t('Pending documents')}</h2><span className="grow" /><Link className="small" href="/documents">{t('View all')}</Link></div><div className="bd flush">
            {d.locked ? lock : <>
              <div style={{ padding: '12px 15px 4px' }}><div className="small">{t('{a} of {b} documents verified', { a: d.documents.verified, b: d.documents.total })}</div><div className="progress"><i style={{ width: `${d.documents.total ? Math.round(d.documents.verified / d.documents.total * 100) : 0}%` }} /></div></div>
              {d.documents.pending.length ? d.documents.pending.map((x: Any) => (
                <div key={x.type_id} className="rowx"><div className="grow"><div className="t">{x.name}</div><div className={`s ${x.status === 'Rejected' ? 'days-red' : ''}`}>{x.status === 'Rejected' ? `${t('Rejected:')} ${x.reason || ''}` : t('Missing: please upload')}</div></div>
                  <button className="btn sm" onClick={async () => { if (await uploadDialog({ type_id: x.type_id, name: x.name })) load(); }}>{x.status === 'Rejected' ? t('Re-upload') : t('Upload')}</button></div>
              )) : <div className="empty-p">{t('Nothing missing right now')}</div>}
            </>}</div></div>
        </div>
        <div className="p-grid">
          <div className="p-card"><div className="hd"><h2>{t('My applications')}</h2><span className="grow" /><Link className="small" href="/applications">{t('View all')}</Link></div><div className="bd flush">
            {d.locked ? lock : (d.applications || []).length ? d.applications.map((a: Any) => (
              <Link key={a.id} className="rowx" href={`/applications/${a.id}`}><div className="grow"><div className="t">{a.university}</div><div className="s">{a.course} · {a.intake}</div><div className="s">{t('Updated')} {ago(a.updated_at)}</div></div>
                <span className="badge solid" style={{ background: a.stage_color }}>{t(a.stage_name)}</span></Link>
            )) : <div className="empty-p"><Link className="btn primary" href="/courses">{t('Explore courses')}</Link> <Link className="btn" href="/shortlist">{t('View your shortlist')}</Link></div>}
            {d.requests_open ? <div className="rowx"><span className="badge blue">{d.requests_open}</span><span className="grow s">{t('requests are being reviewed by La Europa')}</span></div> : null}</div></div>
          <div className="p-card"><div className="hd"><h2>{t('Upcoming deadlines and appointments')}</h2></div><div className="bd flush">
            {d.deadlines.length ? d.deadlines.map((x: Any, i: number) => (
              <Link key={i} className="rowx" href={local(x.link)}><div className="grow"><div className="t">{x.title}</div><div className="s">{x.date.length > 10 ? fmtDT(x.date) : fmtDate(x.date)}</div></div>
                <span className={`${dlClass(x.days_left)} small nowrap`}>{x.days_left === 0 ? t('Today') : t('{n} days', { n: x.days_left })}</span>
                {x.ics ? <> <button className="btn xs" onClick={(e) => { e.preventDefault(); e.stopPropagation(); ics(x.ics); }}>{t('Add to calendar')}</button></> : null}</Link>
            )) : <div className="empty-p">{t('Nothing in the next 30 days')}</div>}</div></div>
          <div className="p-card"><div className="hd"><h2>{t('Latest updates')}</h2></div><div className="bd flush">
            {d.updates.length ? d.updates.map((n: Any) => (
              <Link key={n.id} className="rowx" href={local(n.link)} onClick={() => { POST('/notifications/read', { ids: [n.id] }).catch(() => {}); }}><div className="grow"><div className={n.is_read ? '' : 't'}>{n.title}</div><div className="s">{ago(n.created_at)}</div></div></Link>
            )) : <div className="empty-p">{t('Updates from La Europa will appear here.')}</div>}</div></div>
        </div>
      </div>
    </>
  );
}
