'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiError, GET, POST, blob } from './api';
import { Icon } from './Icon';
import { Modal, confirmBox, openOverlay, showError, toast } from './ui';
import { logout, openLink, t, usePMe, type Any } from './p';
import { saveFile, share, shareCard } from './share';
import { canPrompt, isAndroid, isInstalled, isIOS, onInstallChange, promptInstall } from './install';

/** The client's smaller portal screens: Meet my counsellor, Offers, My wallet, From your university, More, Install. */

const Loading = () => <div className="empty-p">{t('Loading...')}</div>;
const fmtD = (s?: string | null) => (s ? new Date(s.length === 10 ? s + 'T00:00:00Z' : s).toLocaleDateString('en-GB', { timeZone: s.length === 10 ? 'UTC' : undefined, day: '2-digit', month: 'short', year: 'numeric' }) : '');
const inr = (n: unknown) => '₹' + Number(n || 0).toLocaleString('en-IN');
const voucherPdf = async (id: string, code: string) => { try { saveFile(new File([await blob(`/vouchers/${id}.pdf`)], `La-Europa-voucher-${code}.pdf`, { type: 'application/pdf' })); } catch { toast(t('Could not download'), 'err'); } };
const copy = async (v: string, msg = 'Code copied') => { try { await navigator.clipboard.writeText(v); toast(t(msg), 'ok'); } catch { toast(v); } };

// ---------- Meet my counsellor (legacy/public/portal/js/appointments.js) ----------
const AP_BADGE: Record<string, string> = { Requested: 'orange', Confirmed: 'green', Declined: 'red', Cancelled: 'grey', Completed: 'blue', 'No-show': 'red' };
const AP_LABEL: Record<string, string> = { Requested: 'Waiting for your counsellor', Confirmed: 'Confirmed', Declined: 'Not accepted', Cancelled: 'Cancelled', Completed: 'Held', 'No-show': 'Missed' };
function ApRow({ r, done }: { r: Any; done: () => void }) {
  const cancel = async () => {
    const reason = await confirmBox(t('Cancel this meeting?'), { reason: true, optional: true, reasonLabel: t('Why do you want to cancel? (optional)'), ok: t('Cancel meeting'), cancel: t('Back') });
    if (!reason) return;
    try { await POST(`/appointments/${r.id}/cancel`, { reason: typeof reason === 'string' ? reason : '' }); toast(t('Meeting cancelled'), 'ok'); done(); } catch (e) { showError(e); }
  };
  return (
    <div className="ap-row"><div className="grow"><b>{r.when}</b><div className="small muted">{t(r.mode_label)} · {r.code}</div>
      <div className="small" style={{ marginTop: 4 }}>{t('Reason')}: {r.reason}</div>
      {r.status === 'Confirmed' ? (r.mode === 'online' ? <div className="small" style={{ marginTop: 4 }}>{t('Join online')}: <a href={r.meeting_link} target="_blank" rel="noopener noreferrer">{r.meeting_link}</a></div> : <div className="small" style={{ marginTop: 4 }}>{t('Place')}: {r.location || ''}</div>) : null}
      {r.counsellor_note && r.status === 'Confirmed' ? <div className="small muted">{t('Note')}: {r.counsellor_note}</div> : null}
      {r.decline_reason ? <div className="small" style={{ marginTop: 4 }}>{t('Counsellor')}: {r.decline_reason}</div> : null}{r.cancel_reason ? <div className="small muted">{t('Cancelled')}: {r.cancel_reason}</div> : null}
      <div className="row" style={{ gap: 6, marginTop: 8 }}>{r.status === 'Confirmed' && !r.past ? <button className="btn xs" onClick={() => openLink(`/api/portal/appointments/${r.id}.ics`, 'meeting.ics')}>{t('Add to calendar')}</button> : null}
        {['Requested', 'Confirmed'].includes(r.status) && !r.past ? <button className="btn xs ghost" onClick={cancel}>{t('Cancel')}</button> : null}</div></div>
      <span className={`badge ${AP_BADGE[r.status] || 'grey'}`}>{t(AP_LABEL[r.status] || r.status)}</span></div>
  );
}
function Booking({ d, done }: { d: Any; done: () => void }) {
  const [mode, setMode] = useState<string>(d.modes[0]);
  const [days, setDays] = useState<Any[] | null>(null), [day, setDay] = useState<Any | null>(null), [slot, setSlot] = useState<string | null>(null);
  const [reason, setReason] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const load = useCallback(async (m: string) => { try { const s = await GET('/appointments/slots?mode=' + m); setDays(s.days); setDay(s.days[0] || null); setSlot(null); } catch (e) { showError(e); } }, []);
  useEffect(() => { load(mode); }, [load, mode]);
  const book = async () => {
    if (reason.trim().length < 10) { setErr(t('Please write why you want to meet (at least 10 characters).')); return; }
    setErr(''); setBusy(true);
    try { const x = await POST('/appointments', { mode, start_at: slot, reason: reason.trim() }); toast(t(x.message), 'ok'); setReason(''); done(); }
    catch (e) { showError(e); if (e instanceof ApiError && e.data.code === 'slot_taken') load(mode); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="f"><label>{t('How do you want to meet?')}</label><div className="seg ap-mode">{d.modes.map((m: string) => <button key={m} type="button" className={m === mode ? 'on' : ''} onClick={() => setMode(m)}>{m === 'online' ? t('Online (video call)') : t('In person (at the office)')}</button>)}</div></div>
      <div className="f" style={{ marginTop: 12 }}><label>{t('Day')}</label><div className="ap-days">{!days ? <span className="muted small">{t('Loading...')}</span> : days.length ? days.map((x) => <button key={x.date} type="button" className={day?.date === x.date ? 'on' : ''} onClick={() => { setDay(x); setSlot(null); }}>{x.label}</button>)
        : <span className="muted small">{t('No free time in the next days. Please try the other option or send a message in Chat.')}</span>}</div></div>
      {day ? <div className="f" style={{ marginTop: 12 }}><label>{t('Time')} <span className="muted small">({d.slot_min} {t('minutes')}, IST)</span></label><div className="ap-slots">{day.slots.map((s: Any) => <button key={s.start_at} type="button" className={slot === s.start_at ? 'on' : ''} onClick={() => setSlot(s.start_at)}>{s.label}</button>)}</div></div> : null}
      <div className={`f${err ? ' err' : ''}`} style={{ marginTop: 12 }}><label>{t('Why do you want to meet?')}<span className="req">*</span></label>
        <textarea rows={3} maxLength={500} placeholder={t('e.g. I want to discuss which universities to choose for Sep 2027')} value={reason} onChange={(e) => setReason(e.target.value)} /><div className="msg">{err}</div></div>
      <button className="btn primary block" style={{ marginTop: 12 }} disabled={!slot || busy} onClick={book}>{t('Ask for this meeting')}</button>
      <p className="small muted" style={{ margin: '8px 0 0' }}>{t('Your counsellor confirms the meeting. You get the details here and by email.')}</p>
    </>
  );
}
export function Appointments() {
  const [d, setD] = useState<Any | null>(null);
  const load = useCallback(() => GET('/appointments').then(setD).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;
  const upcoming = d.rows.filter((r: Any) => ['Requested', 'Confirmed'].includes(r.status) && !r.past).sort((a: Any, b: Any) => a.start_at.localeCompare(b.start_at));
  const other = d.rows.filter((r: Any) => !upcoming.includes(r));
  return (
    <>
      <div className="p-head"><h1>{t('Meet my counsellor')}</h1><div className="sub">{d.counsellor ? <>{d.counsellor.name} · {t('Counsellor ID')} <b className="mono">{d.counsellor.counsellor_id || ''}</b></> : t('A counsellor will be assigned to you soon.')}</div></div>
      <div className="p-grid two">
        <div className="p-card"><div className="hd"><h2>{t('Book a meeting')}</h2></div><div className="bd">{d.can_book ? <Booking d={d} done={load} /> : <p className="muted" style={{ margin: 0 }}>{d.counsellor ? t('Your counsellor has not opened meeting times yet. Please send a message in Chat.') : t('A counsellor will be assigned to you soon.')}</p>}</div></div>
        <div className="p-grid">
          <div className="p-card"><div className="hd"><h2>{t('My meetings')}</h2></div><div className="bd flush">{upcoming.length ? upcoming.map((r: Any) => <ApRow key={r.id} r={r} done={load} />) : <div className="empty-p">{t('No meeting booked')}</div>}</div></div>
          {other.length ? <div className="p-card"><div className="hd"><h2>{t('Earlier')}</h2></div><div className="bd flush">{other.map((r: Any) => <ApRow key={r.id} r={r} done={load} />)}</div></div> : null}
        </div>
      </div>
    </>
  );
}

// ---------- Offers (legacy/public/portal/js/offers.js) ----------
const VS: Record<string, string> = { Issued: 'green', Redeemed: 'blue', Expired: 'red' };
function Track({ c, voucher, atVisa }: { c: Any; voucher: Any; atVisa: boolean }) {
  const steps: [string, boolean][] = [[t('Code entered'), true], [t('Visa approved'), !!c.visa], ...(atVisa ? [] : [[t('Enrolled at the university'), !!c.enrolled] as [string, boolean]]), [t('Voucher issued'), !!voucher]];
  const cur = steps.findIndex((s) => !s[1]);
  return <><ol className={`o-track ${c.closed ? 'closed' : ''}`} style={{ gridTemplateColumns: `repeat(${steps.length},1fr)` }}>{steps.map(([l, ok], i) => <li key={i} className={ok ? 'ok' : i === cur ? 'now' : ''}><i>{ok ? '✓' : i + 1}</i><span>{l}</span></li>)}</ol>
    {c.closed ? <div className="small st-Rejected">{t(c.state)}</div> : null}</>;
}
function OfferCard({ p, focus, referral }: { p: Any; focus?: string; referral: string }) {
  const mp = p.my_progress, v = mp?.voucher, atVisa = p.counts_at === 'visa', prov = p.provider || t('the partner company');
  const kind = p.kind === 'referral' ? <span className="o-chip ref">{t('Refer a friend')}</span> : p.kind === 'application' ? <span className="o-chip app">{t('Apply and get')}</span> : p.kind === 'partner' ? <span className="o-chip">{t('Partner offer')}</span> : <span className="o-chip">{t('News')}</span>;
  const how = p.kind === 'application' ? [t('Choose a course and click Apply Now during the offer period.'), t('At the last step, enter the offer code and accept the terms.'), atVisa ? t('When your visa is approved, you get a voucher.') : t('When your visa is approved and you are enrolled at the university, you get a voucher.')]
    : p.kind === 'referral' ? [t('Share your link or card with friends.'), t('Your friend signs up and enters the offer code at the last step of Apply Now.'), p.min_referrals > 1 ? (atVisa ? t('When {n} friends get their visa, you get a voucher.', { n: p.min_referrals }) : t('When {n} friends get their visa and enrol at the university, you get a voucher.', { n: p.min_referrals })) : (atVisa ? t('When your friend gets the visa, you get a voucher.') : t('When your friend gets the visa and enrols at the university, you get a voucher.'))]
      : p.kind === 'partner' ? [p.partner_link ? t('Open the offer: it takes you to {c}.', { c: prov }) : t('Contact {c} or visit their website.', { c: prov }), ...(p.partner_code ? [t('Use the code shown above when you buy or sign up.')] : []), t('You deal directly with {c}; their terms apply.', { c: prov })] : [];
  return (
    <article id={`offer-${p.id}`} className={`p-card offer ${p.id === focus ? 'focus' : ''} ${p.live ? '' : 'ended'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {p.image_url ? <img className="offer-img" src={p.image_url} alt="" /> : null}
      <div className="o-hero"><div className="o-chips">{kind}{!p.seen ? <span className="o-chip new">{t('New')}</span> : null}{p.live ? null : <span className="o-chip end">{t('Offer ended')}</span>}</div>
        {p.reward ? <div className="o-reward"><span>🎁</span>{p.reward}</div> : null}<h2>{p.title}</h2></div>
      <div className="bd o-body">
        {p.message ? <p className="o-msg">{p.message}</p> : null}
        <dl className="o-facts">{p.kind !== 'offer' || p.scope_type !== 'all' ? <div><dt>{t('Valid for')}</dt><dd>{p.scope}</dd></div> : null}{p.period ? <div><dt>{t('Offer period')}</dt><dd>{p.period}</dd></div> : null}{p.provider ? <div><dt>{t('Offer by')}</dt><dd>{p.provider}</dd></div> : null}</dl>
        {p.code ? <div className="o-code"><div><small>{t('Offer code')}</small><b className="mono">{p.code}</b></div><button className="btn sm" onClick={() => copy(p.code)}>{t('Copy')}</button></div> : null}
        {p.partner_code ? <div className="o-code"><div><small>{t('Code for {c}', { c: p.provider || t('the partner') })}</small><b className="mono">{p.partner_code}</b></div><button className="btn sm" onClick={() => copy(p.partner_code)}>{t('Copy')}</button></div> : null}
        {p.partner_link ? <a className="btn primary" href={p.partner_link} target="_blank" rel="noopener noreferrer" onClick={() => { POST(`/promotions/${p.id}/click`).catch(() => {}); }}>{t('Open the offer')} ↗</a> : null}
        {v ? <div className="o-voucher"><div className="grow"><small>{t('Your voucher')}</small><b className="mono">{v.voucher_code}</b><div className="small">{t('Valid until')} <b>{fmtD(v.valid_until)}</b> · <span className={`badge ${VS[v.status] || 'grey'}`}>{t(v.status)}</span></div></div>
          <button className="btn primary sm" onClick={() => voucherPdf(v.id, v.voucher_code)}>{t('Download voucher')}</button></div> : null}
        {mp && !v ? (p.kind === 'referral'
          ? <div className="o-progress"><div className="small"><b>{mp.counted}</b> {t('of')} {mp.needed} {t('friends counted')}</div><div className="o-bar"><i style={{ width: `${Math.min(100, mp.counted / mp.needed * 100)}%` }} /></div>{mp.claims.map((c: Any, i: number) => <div key={i} className="small muted">{c.friend || ''}: {t(c.state)}</div>)}</div>
          : mp.claims[0] ? <div className="o-progress"><div className="small"><b>{t('Your progress')}</b>{mp.claims[0].university ? ` · ${mp.claims[0].university}` : ''}</div><Track c={mp.claims[0]} voucher={v} atVisa={atVisa} /></div> : null) : null}
        {how.length && p.live && !mp ? <div className="o-how"><b className="small">{t('How it works')}</b><ol>{how.map((s, i) => <li key={i}>{s}</li>)}</ol></div> : null}
        {p.kind === 'referral' && p.live ? <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary sm" onClick={() => share(p.share_link, `${p.title}${p.reward ? ' - ' + p.reward : ''}. ${t('Sign up with my code')} ${referral}`, p.code)}>{t('Share with a friend')}</button>
          <button className="btn sm" onClick={async () => { try { saveFile(await shareCard(p.code)); } catch (e) { showError(e); } }}>{t('Download card')}</button></div> : null}
        {p.terms || p.provider_note ? <details className="o-terms"><summary>{t('Terms and conditions')}</summary>{p.terms ? <div className="small promo-terms">{p.terms}</div> : null}{p.provider_note ? <p className="small o-note">{p.provider_note}</p> : null}</details> : null}
      </div>
    </article>
  );
}
export function Offers({ focus }: { focus?: string }) {
  const [d, setD] = useState<Any | null>(null);
  const [pick, setPick] = useState(''), [kind, setKind] = useState('');
  useEffect(() => {
    GET('/promotions').then((x) => {
      setD(x);
      try { const c = localStorage.getItem('le_offer_country') || ''; if (x.rows.some((p: Any) => (p.countries || []).some((k: Any) => k.id === c))) setPick(c); } catch { /* storage blocked */ }
      for (const p of x.rows.filter((r: Any) => !r.seen)) POST(`/promotions/${p.id}/seen`).catch(() => {});
    }).catch(showError);
  }, []);
  useEffect(() => { if (d && focus) document.getElementById(`offer-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [d, focus]);
  if (!d) return <Loading />;
  const all: Any[] = focus ? d.rows.filter((x: Any) => x.id === focus).concat(d.rows.filter((x: Any) => x.id !== focus)) : d.rows;
  const countries = [...new Map<string, string>(d.rows.flatMap((p: Any) => p.countries || []).map((c: Any) => [c.id, c.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const KINDS: [string, string][] = [['', t('All offers')], ['application', t('Apply and get')], ['referral', t('Refer a friend')], ['partner', t('Partner offers')], ['offer', t('News')]];
  const list = all.filter((p) => (!pick || !(p.countries || []).length || p.countries.some((c: Any) => c.id === pick)) && (!kind || p.kind === kind));
  return (
    <>
      <div className="p-head"><h1>{t('Offers')}</h1><div className="sub">{t('News and offers from La Europa Education. Your referral code')}: <b className="mono">{d.referral_code || ''}</b></div></div>
      {d.rows.length ? <div className="o-filter"><label className="small">{t('Country')}</label>
        <select className="input" value={pick} onChange={(e) => { setPick(e.target.value); try { localStorage.setItem('le_offer_country', e.target.value); } catch { /* storage blocked */ } }}><option value="">{t('All countries')}</option>{countries.map(([cid, n]) => <option key={cid} value={cid}>{n}</option>)}</select>
        <div className="o-kinds">{KINDS.filter(([k]) => !k || d.rows.some((p: Any) => p.kind === k)).map(([k, l]) => <button key={k} className={`o-kind ${k === kind ? 'on' : ''}`} onClick={() => setKind(k)}>{l}</button>)}</div></div> : null}
      {list.length ? <div className="offer-grid">{list.map((p) => <OfferCard key={p.id} p={p} focus={focus} referral={d.referral_code} />)}</div> : <div className="empty-p">{d.rows.length ? t('No offers for this choice.') : t('No offers right now.')}</div>}
    </>
  );
}

// ---------- My wallet (legacy/public/portal/js/wallet.js) ----------
const RQ: Record<string, string> = { Requested: 'orange', Approved: 'green', Declined: 'red', Cancelled: 'grey' };
function TakeVoucher({ i, close, done }: { i: Any; close: () => void; done: () => void }) {
  const [ok, setOk] = useState(false), [busy, setBusy] = useState(false);
  const go = async () => {
    if (!ok) { toast(t('Please accept the terms of the voucher'), 'err'); return; }
    setBusy(true);
    try { await POST('/wallet/redeem', { item_id: i.id, accept_terms: true }); close(); toast(t('Request sent. You will be told when your voucher is ready.'), 'ok'); done(); } catch (e) { setBusy(false); showError(e); }
  };
  return (
    <Modal title={i.title} close={close} foot={<><button className="btn" onClick={close}>{t('Cancel')}</button><button className="btn primary" disabled={busy} onClick={go}>{t('Request voucher')}</button></>}>
      <p style={{ marginTop: 0 }}>{t('{a} will be taken from your wallet. La Europa checks the request and issues your voucher; if it is not approved, the money comes back.', { a: inr(i.value) })}</p>
      {i.terms ? <div className="small promo-terms">{i.terms}</div> : null}<p className="small o-note">{i.note}</p>
      <label className="consent"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> <span>{t('I accept the terms of this voucher and of {c}.', { c: i.company })}</span></label>
    </Modal>
  );
}
export function Wallet() {
  const [d, setD] = useState<Any | null>(null);
  const load = useCallback(() => GET('/wallet').then(setD).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;
  const pct = Math.min(100, Math.round(d.balance / d.min_redeem * 100));
  const cancel = async (id: string) => { if (!(await confirmBox(t('Cancel this request? The money goes back to your wallet.')))) return; try { await POST(`/wallet/requests/${id}/cancel`); load(); } catch (e) { showError(e); } };
  return (
    <>
      <div className="p-head"><h1>{t('My wallet')}</h1><div className="sub">{t('Refer friends to La Europa. When a friend enrols at the university, money is added here.')}</div></div>
      <div className="w-top">
        <div className="p-card w-bal"><div className="bd"><small>{t('Wallet balance')}</small><div className="w-amt">{inr(d.balance)}</div>
          <div className="o-bar" style={{ marginTop: 12 }}><i style={{ width: `${pct}%` }} /></div>
          <div className="small" style={{ marginTop: 6 }}>{d.can_convert ? <b>{t('You can turn your wallet into a voucher now.')}</b> : t('{a} more to turn it into a voucher (from {b}).', { a: inr(d.min_redeem - d.balance), b: inr(d.min_redeem) })}</div></div></div>
        <div className="p-card"><div className="bd"><b>{t('How it works')}</b><ol className="w-how">
          <li>{t('Share your referral link with friends.')} <Link href="/referral">{t('Refer a friend')}</Link></li>
          <li>{t('When your friend gets the visa and enrols at the university, {a} is added to your wallet (some countries / universities give more).', { a: inr(d.referral_default) })}</li>
          <li>{t('From {a}, turn your wallet into a voucher from our partner companies.', { a: inr(d.min_redeem) })}</li></ol>
          <p className="small muted" style={{ margin: '6px 0 0' }}>{t('The wallet is not cash and cannot be withdrawn. It can only be turned into vouchers.')}</p></div></div>
      </div>
      {d.requests.length ? <><h2 className="w-h">{t('My vouchers')}</h2><div className="w-list">{d.requests.map((r: Any) => (
        <div key={r.id} className="p-card"><div className="bd w-req">
          <div className="grow"><b>{r.item}</b><div className="small muted">{r.company} · {inr(r.amount)} · {fmtD(r.created_at)}</div>
            {r.voucher ? <div className="small" style={{ marginTop: 4 }}>{t('Voucher code')} <b className="mono">{r.voucher.voucher_code}</b> · {t('valid until')} {fmtD(r.voucher.valid_until)} · <span className={`badge ${r.voucher.status === 'Issued' ? 'green' : r.voucher.status === 'Redeemed' ? 'blue' : 'red'}`}>{t(r.voucher.status)}</span></div>
              : <><span className={`badge ${RQ[r.status]}`}>{t(r.status === 'Requested' ? 'Waiting for La Europa' : r.status)}</span>{r.reason ? <> <span className="small muted">{r.reason}</span></> : null}</>}</div>
          {r.voucher ? <button className="btn primary sm" onClick={() => voucherPdf(r.voucher.id, r.voucher.voucher_code)}>{t('Download voucher')}</button> : r.status === 'Requested' ? <button className="btn sm" onClick={() => cancel(r.id)}>{t('Cancel')}</button> : null}
        </div></div>
      ))}</div></> : null}
      <h2 className="w-h">{t('Voucher store')}</h2>
      {d.store.length ? <div className="offer-grid">{d.store.map((i: Any) => {
        const ok = d.can_convert && d.balance >= i.value;
        return (
          <article key={i.id} className="p-card offer"><div className="o-hero"><div className="o-chips"><span className="o-chip">{i.company}</span></div><div className="o-reward"><span>🎁</span>{i.title}</div></div>
            <div className="bd o-body">{i.description ? <p className="o-msg">{i.description}</p> : null}
              <dl className="o-facts"><div><dt>{t('Value')}</dt><dd>{inr(i.value)}</dd></div><div><dt>{t('Offer by')}</dt><dd>{i.company}</dd></div><div><dt>{t('Voucher valid')}</dt><dd>{t('{n} days after it is issued', { n: i.valid_days })}</dd></div></dl>
              <details className="o-terms"><summary>{t('Terms and conditions')}</summary>{i.terms ? <div className="small promo-terms">{i.terms}</div> : null}<p className="small o-note">{i.note}</p></details>
              <button className={`btn ${ok ? 'primary' : ''}`} disabled={!ok} onClick={() => openOverlay((close) => <TakeVoucher i={i} close={close} done={load} />)}>{ok ? t('Get this voucher') : d.can_convert ? t('Needs {a}', { a: inr(i.value) }) : t('Available from {a}', { a: inr(d.min_redeem) })}</button></div></article>
        );
      })}</div> : <div className="empty-p">{t('No vouchers in the store right now.')}</div>}
      {d.rows.length ? <><h2 className="w-h">{t('History')}</h2><div className="p-card"><div className="bd" style={{ padding: 0 }}>{d.rows.map((x: Any, n: number) => (
        <div key={n} className="w-row"><div className="grow"><b>{t(x.label)}</b><div className="small muted">{x.reason || ''} · {fmtD(x.created_at)}</div></div><b className={x.amount < 0 ? 'st-Rejected' : 'st-Verified'}>{x.amount > 0 ? '+' : '−'}{inr(Math.abs(x.amount))}</b></div>
      ))}</div></div></> : null}
    </>
  );
}

// ---------- From your university (legacy/public/portal/js/university.js) ----------
const U_ICON: Record<string, string> = { offer_letter: '🎓', loa: '🛂', invoice: '🧾', receipt: '✅', agreement: '✍', document: '📄', message: '💬' };
const fmtDT = (d?: string) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const umoney = (n: unknown, c?: string) => `${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c || ''}`;
function AcceptItem({ id, title, close, done }: { id: string; title: string; close: () => void; done: () => void }) {
  const [ok, setOk] = useState(false), [sig, setSig] = useState('');
  return (
    <Modal title={`${t('Accept')}: ${title}`} close={close} foot={<button className="btn primary" onClick={async () => { try { await POST(`/university-items/${id}/accept`, { confirm: ok, signature_name: sig.trim() }); close(); toast(t('Thank you. Your acceptance has been recorded.'), 'ok'); done(); } catch (e) { showError(e); } }}>{t('I accept and sign')}</button>}>
      <p className="small">{t('Open the agreement first and read it fully. Then type your full name as your electronic signature. The time and your IP address are recorded.')}</p>
      <label className="consent"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> <span>{t('I have read the agreement and I accept it.')}</span></label>
      <div className="f" style={{ marginTop: 8 }}><label>{t('Type your full name')}</label><input className="input" maxLength={100} autoComplete="name" value={sig} onChange={(e) => setSig(e.target.value)} /></div>
    </Modal>
  );
}
function Reply({ id, done }: { id: string; done: () => void }) {
  const [body, setBody] = useState('');
  return <form className="row" style={{ gap: 6, padding: 10 }} onSubmit={async (e) => { e.preventDefault(); if (!body.trim()) return; try { await POST(`/university-items/reply/${id}`, { body: body.trim() }); toast(t('Sent'), 'ok'); setBody(''); done(); } catch (er) { showError(er); } }}>
    <input className="input grow" maxLength={3000} placeholder={t('Reply to the university...')} value={body} onChange={(e) => setBody(e.target.value)} /><button className="btn sm">{t('Send')}</button></form>;
}
export function University() {
  const [d, setD] = useState<Any | null>(null);
  // the university side is part of the partner portal, which is not live yet: nothing to show until it is
  const load = useCallback(() => GET('/university-items').then(setD).catch((e) => setD(e instanceof ApiError && e.status === 404 ? { groups: [] } : (showError(e), { groups: [] }))), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;
  return (
    <>
      <div className="p-head"><h1>{t('From your university')}</h1></div>
      <div className="p-banner info" style={{ marginBottom: 12 }}><span className="grow">{t('Offer letters, invoices, agreements and messages that your university sent you. Your La Europa counsellor sees them too and will help you.')}</span></div>
      {d.groups.length ? d.groups.map((g: Any) => (
        <div key={g.uapp_id} className="p-card" style={{ marginBottom: 14 }}><div className="hd"><h2>{g.university}</h2><span className="grow" /><span className="small muted">{g.course || ''} · {g.intake || ''}</span></div><div className="bd flush">
          {g.items.map((x: Any) => (
            <div key={x.id} className="rowx" style={{ alignItems: 'flex-start', gap: 10 }}><span style={{ fontSize: 18 }}>{U_ICON[x.kind] || '•'}</span><div className="grow">
              <div className="t">{t(x.kind_label)}{x.title ? ': ' + x.title : ''}{x.mine ? <> <span className="small muted">({t('you')})</span></> : null}</div>
              {x.body ? <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{x.body}</div> : null}
              {x.amount !== null && x.amount !== undefined ? <div className="small"><b>{umoney(x.amount, x.currency)}</b>{x.due_date ? ` · ${t('due')} ${String(x.due_date)}` : ''}</div> : null}
              <div className="small muted">{x.sender} · {fmtDT(x.created_at)}</div>
              {x.needs_acceptance ? (x.accepted_at ? <div className="small" style={{ color: 'var(--success-ink)' }}>✓ {t('You accepted this on')} {fmtDT(x.accepted_at)}</div>
                : <button className="btn sm primary" style={{ marginTop: 6 }} onClick={() => openOverlay((close) => <AcceptItem id={x.id} title={x.title || ''} close={close} done={load} />)}>{t('Read and accept')}</button>) : null}</div>
              {x.file_url ? <button className="btn xs" onClick={() => openLink(x.file_url)}>{t('Open')}</button> : null}</div>
          ))}
          <Reply id={g.uapp_id} done={load} /></div></div>
      )) : <div className="p-card"><div className="bd"><div className="empty">{t('Nothing from a university yet. When a university sends you an offer letter, invoice or message, it appears here.')}</div></div></div>}
    </>
  );
}

// ---------- More (legacy/public/portal/js/main.js more) and Install the app ----------
export function More() {
  const me = usePMe((s) => s.me);
  const items: [string, string, string][] = [['/my-information', 'My information', 'user'], ['/university', 'From your university', 'docs'], ['/shortlist', 'Shortlist', 'shortlist'], ['/payments', 'Payments', 'pay'], ['/tasks', 'Tasks', 'tasks'],
    ['/appointments', 'Meet my counsellor', 'calendar'], ['/offers', 'Offers', 'gift'], ['/wallet', 'My wallet', 'pay'], ['/notifications', 'Notifications', 'bell'], ['/get-app', 'Install app', 'home'], ['/profile', 'My Profile', 'user'],
    ['/settings', 'Settings', 'gear'], ['/privacy', 'Privacy & my data', 'user'], ...(me?.settings.referral ? [['/referral', 'Refer a friend', 'gift'] as [string, string, string]] : [])];
  return (
    <>
      <div className="p-head"><h1>{t('More')}</h1></div>
      <div className="p-card"><div className="bd flush">
        {items.map(([h, l, ic]) => <Link key={h} className="rowx" href={h}><span style={{ width: 22, color: 'var(--brand)' }}><Icon name={ic} /></span><span className="grow t">{t(l)}</span><span className="muted">›</span></Link>)}
        <a className="rowx" href="#" onClick={(e) => { e.preventDefault(); logout(); }}><span className="grow t" style={{ color: 'var(--red)' }}>{t('Logout')}</span></a>
      </div></div>
    </>
  );
}
export function Install() {
  const [, tick] = useState(0), [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); return onInstallChange(() => tick((n) => n + 1)); }, []);
  if (!ready) return null;
  const can = canPrompt();
  const steps = isIOS() ? [t('Open this page in Safari.'), t('Tap the Share button (square with an arrow).'), t('Tap "Add to Home Screen", then "Add".')]
    : isAndroid() ? [t('Tap "Install app" below, or open the Chrome menu (⋮).'), t('Choose "Install app" or "Add to Home screen".'), t('Open it from your home screen.')]
      : [t('Use Google Chrome or Microsoft Edge.'), t('Click "Install app" below, or the install icon at the right end of the address bar.'), t('The app opens in its own window and gets an icon on your desktop / Start menu.')];
  const go = async () => { const r = await promptInstall(); if (r === 'accepted') toast(t('Installed. Open La Europa from your home screen.'), 'ok'); tick((n) => n + 1); };
  return (
    <>
      <div className="p-head"><h1>{t('Install the app')}</h1></div>
      <div className="p-card"><div className="bd">
        {isInstalled() ? <div className="ok-box">{t('The app is installed on this device. Open it from your desktop, Start menu or home screen.')}</div> : <>
          <p>{t('Install')} <b>La Europa Student</b> {t('as an app on this computer or phone. You keep the same login and data; updates arrive by themselves.')}</p>
          <ol className="install-steps">{steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <button className="btn primary" disabled={!can} onClick={go}>{t('Install app')}</button>
          {can ? null : <p className="small muted" style={{ marginTop: 8 }}>{isIOS() ? t('On iPhone / iPad use Safari: Share > Add to Home Screen.') : t('If the button stays grey, use the install icon in the address bar or the browser menu (Install / Add to Home screen).')}</p>}
        </>}
      </div></div>
    </>
  );
}
