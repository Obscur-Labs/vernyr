'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { GET, POST, SEND, download } from './api';
import { fmtDate } from './format';
import { Modal, confirmBox, openOverlay, showError, toast } from './ui';

/** The client's promotions, claims, vouchers and referrals (legacy/public/js/pages/promotions.js). */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const ST: Record<string, string> = { Draft: 'grey', Published: 'green', Ended: 'red' };
const RS: Record<string, string> = { Received: 'blue', Contacted: 'blue', Registered: 'green', Enrolled: 'purple', 'Already known': 'grey' };
const VS: Record<string, string> = { Issued: 'blue', Redeemed: 'green', Expired: 'red' };
const d8 = (s?: string | null) => (s ? fmtDate(s) : '');
export const voucherPdf = (id: string, code: string) => download(`/admin/vouchers/${id}.pdf`, `La-Europa-voucher-${code}.pdf`).catch(showError);
const TERMS: Record<string, string> = {
  application: `1. Valid only for students who send an Apply Now request with this code during the offer period ({from} to {to}). Codes entered before or after the period are not valid.
2. Valid only for {scope}.
3. The offer counts only after {counts}.
4. One reward per student. It cannot be exchanged for cash or transferred.
5. La Europa Education may ask for proof of enrolment before issuing the voucher.
6. La Europa Education's decision on eligibility is final. The offer may be withdrawn or changed with notice on the portal.`,
  referral: `1. Valid only for friends who sign up with your referral link or code and send their Apply Now request with this code during the offer period ({from} to {to}).
2. Valid only for {scope}.
3. A friend counts only after {counts_friend}.
4. The reward is given when {n} referred friend(s) count. One reward per student. It cannot be exchanged for cash or transferred.
5. You cannot refer yourself. La Europa Education may ask for proof of enrolment.
6. La Europa Education's decision on eligibility is final. The offer may be withdrawn or changed with notice on the portal.`,
  partner: `1. This offer is given by {provider}. Use it directly with {provider} through the link or the code shown, during the offer period ({from} to {to}).
2. Valid only for {scope}.
3. The product or service, its price, terms and conditions, quality and delivery are the responsibility of {provider}. La Europa Education only shares this offer and is not responsible for them.
4. {provider} may change or end the offer. La Europa Education is not a party to your agreement with {provider}.`,
};
const PROV_TERMS = `
7. The reward is given as a voucher with its own voucher code, issued by La Europa Education and redeemed with {provider}. The voucher is valid for {days} days from the date it is issued; after that it cannot be used.
8. The product or service is provided by {provider} under its own terms and conditions. La Europa Education only issues the voucher and is not responsible for the product or service, its quality or delivery, or for anything after the voucher is redeemed.`;
const PROV_FIELDS: [string, string][] = [['provider_name', 'name'], ['provider_contact', 'contact_person'], ['provider_phone', 'phone'], ['provider_email', 'email'], ['provider_address', 'address']];

function PromoForm({ p, d, close, done }: { p: Any | null; d: Any; close: () => void; done: () => void }) {
  const locked = !!p && p.status !== 'Draft';
  const [v, setV] = useState<Any>(() => ({ kind: p?.kind ?? Object.keys(d.kinds)[0], audience: p?.audience ?? Object.keys(d.audiences)[0], title: p?.title ?? '', message: p?.message ?? '', reward: p?.reward ?? '',
    min_referrals: p?.min_referrals ?? 1, counts_at: p?.counts_at ?? 'enrolment', partner_link: p?.partner_link ?? '', partner_code: p?.partner_code ?? '', starts_on: p?.starts_on ?? '', ends_on: p?.ends_on ?? '',
    scope_type: p?.scope_type ?? Object.keys(d.scopes)[0], provider_company_id: p?.provider_company_id ?? '', provider_name: p?.provider_name ?? '', provider_contact: p?.provider_contact ?? '',
    provider_phone: p?.provider_phone ?? '', provider_email: p?.provider_email ?? '', provider_address: p?.provider_address ?? '', voucher_valid_days: p?.voucher_valid_days ?? 90, terms: p?.terms ?? '', remove_image: false }));
  const [scope, setScope] = useState<Set<string>>(new Set(p?.scope_ids ?? []));
  const [img, setImg] = useState<File | null>(null);
  const [uq, setUq] = useState('');
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((x: Any) => ({ ...x, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  const company = (d.companies ?? []).find((c: Any) => c.id === v.provider_company_id);
  useEffect(() => { if (company) setV((x: Any) => ({ ...x, ...Object.fromEntries(PROV_FIELDS.map(([k, c]) => [k, company[c] || ''])) })); }, [v.provider_company_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const k = v.kind, s = v.scope_type;
  const list: Any[] = s === 'country' ? d.countries : s === 'university' ? d.universities : [];
  const fillTerms = () => {
    const kk = ['referral', 'partner'].includes(k) ? k : 'application';
    const names = list.filter((x) => scope.has(x.id)).map((x) => x.name);
    const prov = String(v.provider_name).trim() || 'the provider';
    setV((x: Any) => ({ ...x, terms: (TERMS[kk] + (kk === 'partner' ? '' : PROV_TERMS)).replace(/\{provider\}/g, prov).replace('{days}', String(v.voucher_valid_days || 90))
      .replace('{counts}', v.counts_at === 'visa' ? "the student's visa is approved" : "the student's visa is approved and the student has physically enrolled at the university (arrived and completed enrolment)")
      .replace('{counts_friend}', v.counts_at === 'visa' ? 'their visa is approved' : 'their visa is approved and they have physically enrolled at the university (arrived and completed enrolment)')
      .replace('{from}', d8(v.starts_on) || '...').replace('{to}', d8(v.ends_on) || '...')
      .replace('{scope}', s === 'all' ? 'applications to any university through La Europa Education' : names.join(', ') || '...').replace('{n}', String(v.min_referrals || 1)) }));
  };
  const save = async () => {
    const fd = new FormData();
    for (const [key, x] of Object.entries(v)) if (x !== null && x !== undefined && x !== '' && !(locked && ['kind', 'min_referrals', 'counts_at', 'starts_on', 'scope_type'].includes(key))) fd.append(key, typeof x === 'boolean' ? (x ? '1' : '') : String(x));
    if (s !== 'all') for (const id of scope) if (list.some((x) => x.id === id)) fd.append('scope_ids', id);
    if (img) fd.append('image', img);
    try { await SEND(p ? 'put' : 'post', p ? `/admin/promotions/${p.id}` : '/admin/promotions', fd); close(); toast('Saved', 'ok'); done(); } catch (e) { showError(e); }
  };
  const showProv = k !== 'offer';
  return (
    <Modal title={p ? `Edit ${p.code}` : 'New promotion'} size="lg" close={close} foot={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={save}>{p ? 'Save' : 'Save as draft'}</button></>}>
      <form className="form-grid" noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="f c3"><label>Kind</label><select className="input" value={k} disabled={locked} onChange={set('kind')}>{Object.entries(d.kinds).map(([a, l]) => <option key={a} value={a}>{l as string}</option>)}</select></div>
        <div className="f c3"><label>Who gets the notice</label><select className="input" value={v.audience} onChange={set('audience')}>{Object.entries(d.audiences).map(([a, l]) => <option key={a} value={a}>{l as string}</option>)}</select></div>
        <div className="f c4"><label>Title <span className="req">*</span></label><input className="input" maxLength={120} placeholder="e.g. Free flight ticket for partner university students" value={v.title} onChange={set('title')} /></div>
        {!['offer', 'partner'].includes(k) ? <div className="f c2"><label>Promotion code</label><div className="input mono" style={{ display: 'flex', alignItems: 'center', background: 'var(--soft)' }}>{p ? p.code : 'Made by the system'}</div></div> : null}
        <div className="f c6"><label>Message</label><textarea className="input" rows={3} maxLength={2000} value={v.message} onChange={set('message')} /></div>
        <div className="f c4"><label>Reward {k !== 'offer' ? <span className="req">*</span> : null}</label><input className="input" maxLength={200} placeholder="e.g. Free flight ticket / INR 10,000 Amazon voucher / Free Kerala trip" value={v.reward} onChange={set('reward')} /></div>
        {k === 'referral' ? <div className="f c2"><label>Friends needed</label><input type="number" className="input" min={1} max={50} disabled={locked} value={v.min_referrals} onChange={set('min_referrals')} /></div> : null}
        {['application', 'referral'].includes(k) ? <div className="f c6"><label>The offer counts</label><select className="input" disabled={locked} value={v.counts_at} onChange={set('counts_at')}>{Object.entries(d.counts ?? {}).map(([a, l]) => <option key={a} value={a}>{l as string}</option>)}</select></div> : null}
        {k === 'partner' ? <>
          <div className="f c4"><label>Partner&apos;s link (https)</label><input className="input" maxLength={500} placeholder="https://partner.example/la-europa-offer" value={v.partner_link} onChange={set('partner_link')} /></div>
          <div className="f c2"><label>Partner&apos;s code</label><input className="input mono" maxLength={60} placeholder="e.g. LAEUROPA10" value={v.partner_code} onChange={set('partner_code')} /></div>
          <div className="f c6 small muted" style={{ marginTop: -6 }}>The company gave a direct link or a code (fixed or made for La Europa). Students use it directly with the company; La Europa does nothing more. Add one or both.</div>
        </> : null}
        <div className="f c3"><label>Starts on {k !== 'offer' ? <span className="req">*</span> : null}</label><input type="date" className="input" disabled={locked} value={v.starts_on} onChange={set('starts_on')} /></div>
        <div className="f c3"><label>Ends on {k !== 'offer' ? <span className="req">*</span> : null}</label><input type="date" className="input" value={v.ends_on} onChange={set('ends_on')} /></div>
        <div className="f c6"><label>Valid for</label><select className="input" disabled={locked} value={s} onChange={set('scope_type')}>{Object.entries(d.scopes).map(([a, l]) => <option key={a} value={a}>{l as string}</option>)}</select>
          {list.length ? <div className="pick-box">
            {s === 'university' ? <input className="input" placeholder="Search universities" style={{ marginBottom: 6 }} value={uq} onChange={(e) => setUq(e.target.value)} /> : null}
            {list.filter((x) => !uq || x.name.toLowerCase().includes(uq.toLowerCase())).map((x) => (
              <label key={x.id} className="row small" style={{ gap: 6 }}><input type="checkbox" disabled={locked} checked={scope.has(x.id)} onChange={(e) => setScope((o) => { const n = new Set(o); if (e.target.checked) n.add(x.id); else n.delete(x.id); return n; })} /> {x.name}</label>
            ))}
          </div> : null}</div>
        {showProv ? <>
          <div className="form-section">Offer given by <span className="small muted" style={{ fontWeight: 400 }}>(the company the student redeems the voucher with)</span></div>
          <div className="f c6"><label>Partner company</label><select className="input" value={v.provider_company_id} onChange={set('provider_company_id')}><option value="">Choose a partner company (Partner companies tab)...</option>{(d.companies ?? []).map((c: Any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="f c3"><label>Company / organisation <span className="req">*</span></label><input className="input" maxLength={120} readOnly={!!company} placeholder="e.g. SkyWay Travels Pvt Ltd" value={v.provider_name} onChange={set('provider_name')} /></div>
          <div className="f c3"><label>Contact person <span className="req">*</span></label><input className="input" maxLength={100} readOnly={!!company} value={v.provider_contact} onChange={set('provider_contact')} /></div>
          <div className="f c2"><label>Mobile number <span className="req">*</span></label><input className="input" maxLength={20} inputMode="tel" readOnly={!!company} value={v.provider_phone} onChange={set('provider_phone')} /></div>
          <div className="f c2"><label>Email <span className="req">*</span></label><input className="input" type="email" maxLength={120} readOnly={!!company} value={v.provider_email} onChange={set('provider_email')} /></div>
          {k !== 'partner' ? <div className="f c2"><label>Voucher valid for (days)</label><input className="input" type="number" min={1} max={730} value={v.voucher_valid_days} onChange={set('voucher_valid_days')} /></div> : null}
          <div className="f c6"><label>Address (optional)</label><input className="input" maxLength={300} readOnly={!!company} value={v.provider_address} onChange={set('provider_address')} /></div>
        </> : null}
        <div className="f c6"><label>Terms and conditions <span className="req">*</span> <button type="button" className="btn xs" style={{ marginLeft: 8 }} onClick={fillTerms}>Fill standard terms</button></label><textarea className="input" rows={8} maxLength={5000} value={v.terms} onChange={set('terms')} /></div>
        <div className="f c6"><label>Image (PNG / JPG, max 3 MB)</label><input type="file" accept=".png,.jpg,.jpeg" onChange={(e) => setImg(e.target.files?.[0] ?? null)} />
          {p?.has_image ? <label className="small row" style={{ gap: 6, marginTop: 6 }}><input type="checkbox" checked={!!v.remove_image} onChange={set('remove_image')} /> Remove the current image</label> : null}</div>
      </form>
    </Modal>
  );
}

function IssueVoucher({ p, row, close, done }: { p: Any; row: Any; close: () => void; done: () => void }) {
  const [until, setUntil] = useState(new Date(Date.now() + (p.voucher_valid_days || 90) * 864e5).toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const go = async () => {
    try { const x = await POST(`/admin/promotions/${p.id}/reward`, { student_user_id: row.student_user_id, valid_until: until, note }); close(); toast(`Voucher ${x.voucher_code} issued. The student was told.`, 'ok'); done(); } catch (e) { showError(e); }
  };
  return (
    <Modal title={`Issue voucher: ${row.person.name}`} close={close} foot={<><button className="btn" onClick={close}>Cancel</button><button className="btn primary" onClick={go}>Issue voucher</button></>}>
      <p className="small" style={{ marginTop: 0 }}>A voucher with its own code is made for <b>{row.person.name}</b>: {p.reward || ''}, redeemed with <b>{p.provider_name || '-'}</b>. The student gets it in the portal (Offers) to download.</p>
      <div className="form-grid">
        <div className="f c3"><label>Valid until</label><input type="date" className="input" min={new Date().toISOString().slice(0, 10)} value={until} onChange={(e) => setUntil(e.target.value)} /></div>
        <div className="f c6"><label>Note (internal, optional)</label><input className="input" maxLength={300} placeholder="e.g. Approved by Manager" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
    </Modal>
  );
}
/** who used the code, how far each one got, and the voucher once it counts */
export function Claims({ id }: { id: string }) {
  const [d, setD] = useState<Any | null>(null);
  const load = useCallback(() => GET(`/admin/promotions/${id}/claims`).then(setD).catch(showError), [id]);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="empty">Loading...</div>;
  const p = d.promotion, ref = p.kind === 'referral';
  const redeemed = async (vid: string) => {
    const note = await confirmBox('Mark this voucher as redeemed?', { reason: true, reasonLabel: 'Note (e.g. confirmed by the provider on the phone)', ok: 'Mark redeemed' });
    if (!note) return;
    try { await POST(`/admin/vouchers/${vid}/redeemed`, { note }); toast('Marked as redeemed', 'ok'); load(); } catch (e) { showError(e); }
  };
  return (
    <>
      <p className="small"><Link href="/promotions">← All promotions</Link></p>
      <div className="card" style={{ marginBottom: 14 }}><div className="bd">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}><h2 style={{ margin: 0 }}>{p.title}</h2><span className="badge blue mono">{p.code}</span><span className={`badge ${ST[p.status]}`}>{p.status}</span></div>
        <div className="small" style={{ marginTop: 6 }}>🎁 {p.reward || ''}{p.provider_name ? ` (by ${p.provider_name})` : ''} · {p.scope_label} · {d8(p.starts_on)} → {d8(p.ends_on)}{ref ? ` · ${p.min_referrals} friend(s) needed` : ''}</div>
        <div className="small muted" style={{ marginTop: 4 }}>{p.counts_at === 'visa' ? 'Counts when the visa is approved.' : 'Counts only when the visa is approved and the student is enrolled at the university (application stage "Enrolment confirmed").'}</div>
      </div></div>
      {d.rows.length ? (
        <div className="card"><div className="table-wrap"><table className="t cards"><thead><tr><th>{ref ? 'Referred by' : 'Student'}</th><th>{ref ? 'Friends who used the code' : 'Application'}</th><th>Counted</th><th>Voucher</th></tr></thead><tbody>
          {d.rows.map((r: Any) => (
            <tr key={r.student_user_id}>
              <td data-label={ref ? 'Referred by' : 'Student'}>{r.person.link ? <Link href={String(r.person.link).replace(/^#/, '')}>{r.person.name}</Link> : r.person.name} <span className="mono small muted">{r.person.code}</span></td>
              <td data-label="Claims"><div className="claim-list">{r.claims.map((c: Any) => <div key={c.id} className="small">{c.friend ? <><b>{c.friend}</b> · </> : null}{c.university} · <span className={c.counts ? 'st-Verified' : 'muted'}>{c.state}</span> <span className="muted">(code {fmtDate(c.entered_at)})</span></div>)}</div></td>
              <td data-label="Counted"><b>{r.counted}</b> / {r.needed}</td>
              <td data-label="Voucher">{r.reward ? <>
                <div className="mono"><b>{r.reward.voucher_code}</b></div><span className={`badge ${VS[r.reward.status] || 'grey'}`}>{r.reward.status}</span> <span className="small muted">until {d8(r.reward.valid_until)}</span>
                <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}><button className="btn xs" onClick={() => voucherPdf(r.reward.id, r.reward.voucher_code)}>Download voucher</button>
                  {r.reward.status === 'Issued' ? <button className="btn xs" onClick={() => redeemed(r.reward.id)}>Mark redeemed</button> : null}</div>
              </> : r.eligible ? <button className="btn xs primary" onClick={() => openOverlay((close) => <IssueVoucher p={p} row={r} close={close} done={load} />)}>Issue voucher</button> : <span className="small muted">after visa + enrolment</span>}</td>
            </tr>
          ))}</tbody></table></div></div>
      ) : <div className="card"><div className="bd empty">Nobody has used this code yet.</div></div>}
    </>
  );
}
export function Referrals({ promo }: { promo?: string }) {
  const [rows, setRows] = useState<Any[] | null>(null);
  useEffect(() => { GET('/admin/referrals' + (promo ? '?promo=' + encodeURIComponent(promo) : '')).then((d) => setRows(d.rows)).catch(showError); }, [promo]);
  if (!rows) return <div className="empty">Loading...</div>;
  return (
    <>
      {promo ? <p className="small">Showing promotion <b className="mono">{promo}</b> · <Link href="/promotions?tab=referrals">show all</Link></p> : null}
      {rows.length ? <div className="card"><div className="table-wrap"><table className="t cards"><thead><tr><th>Referred by</th><th>Friend</th><th>Promotion</th><th>Date</th><th>How far</th></tr></thead><tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td data-label="Referred by"><Link href={String(r.referrer_link).replace(/^#/, '')}>{r.referrer}</Link> <span className="mono small muted">{r.referrer_code} · {r.referral_code || ''}</span></td>
            <td data-label="Friend">{r.friend_lead_id ? <Link href={`/leads/${r.friend_lead_id}`}>{r.friend}</Link> : r.friend}</td>
            <td data-label="Promotion" className="mono small">{r.promo_code || '-'}</td><td data-label="Date" className="small">{fmtDate(r.created_at)}</td>
            <td data-label="How far"><span className={`badge ${RS[r.status] || 'grey'}`}>{r.status}</span></td>
          </tr>
        ))}</tbody></table></div></div> : <div className="card"><div className="bd empty">No referrals yet.</div></div>}
      <p className="small muted">Rewards are given from the promotion&apos;s &quot;Claims and rewards&quot; page.</p>
    </>
  );
}
export function PromotionsList({ addSignal }: { addSignal: number }) {
  const [d, setD] = useState<Any | null>(null);
  const load = useCallback(() => GET('/admin/promotions').then(setD).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  const open = useMemo(() => (p: Any | null) => { if (d) openOverlay((close) => <PromoForm p={p} d={d} close={close} done={load} />); }, [d, load]);
  useEffect(() => { if (addSignal) open(null); }, [addSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="empty">Loading...</div>;
  const publish = async (id: string) => { try { const r = await POST(`/admin/promotions/${id}/publish`); toast(`Published. In-app notice sent to ${r.notified} of ${r.audience} student(s) (those who said yes to News and offers).`, 'ok'); load(); } catch (e) { showError(e); } };
  const end = async (id: string) => { if (!(await confirmBox('End this promotion now? Codes entered after this will not count.', { danger: true, ok: 'End now' }))) return; try { await POST(`/admin/promotions/${id}/end`); toast('Ended', 'ok'); load(); } catch (e) { showError(e); } };
  return d.rows.length ? (
    <div className="card"><div className="table-wrap"><table className="t cards"><thead><tr><th /><th>Promotion</th><th>Code</th><th>For</th><th>Period</th><th>Results</th><th>Status</th><th /></tr></thead><tbody>
      {d.rows.map((p: Any) => (
        <tr key={p.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <td>{p.image_url ? <img className="promo-thumb" src={p.image_url} alt="" /> : null}</td>
          <td data-label="Promotion"><b>{p.title}</b>{p.reward ? <div className="small">🎁 {p.reward}</div> : null}
            <div className="small muted">{p.kind_label}{p.kind === 'referral' && p.min_referrals > 1 ? ` · ${p.min_referrals} friends` : ''}{['application', 'referral'].includes(p.kind) ? ` · counts at ${p.counts_at === 'visa' ? 'visa approved' : 'enrolment'}` : ''}</div></td>
          <td data-label="Code">{p.kind === 'offer' ? <span className="small muted">no code</span> : p.kind === 'partner' ? <span className="small">Partner {[p.partner_link ? 'link' : '', p.partner_code ? `code ${p.partner_code}` : ''].filter(Boolean).join(' + ')}</span>
            : p.status === 'Ended' ? <><s className="mono small muted">{p.code}</s><div className="small muted">expired</div></> : <span className="badge blue mono">{p.code}</span>}
            {p.provider_name ? <div className="small muted" style={{ marginTop: 4 }}>by {p.provider_name}</div> : null}</td>
          <td data-label="For" className="small">{p.scope_label}<div className="muted">{p.audience_label}</div></td>
          <td data-label="Period" className="small">{d8(p.starts_on) || 'now'} → {d8(p.ends_on) || 'open'}</td>
          <td data-label="Results" className="small">Notified {p.stats.notified} · seen {p.stats.seen}{p.kind === 'partner' ? <><br />Link opened {p.partner_clicks || 0}</> : null}
            {!['offer', 'partner'].includes(p.kind) ? <><br />Codes used {p.stats.codes_used} · counted {p.stats.counted}<br /><b>Reward due {p.stats.eligible - p.stats.rewards}</b> · given {p.stats.rewards}</> : null}</td>
          <td data-label="Status"><span className={`badge ${ST[p.status]}`}>{p.status}</span>{p.status === 'Published' && !p.live ? <div className="small muted">starts later</div> : null}</td>
          <td className="nowrap"><div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button className="btn xs" onClick={() => open(p)}>Edit</button>
            {p.status !== 'Ended' ? <button className="btn xs primary" onClick={() => publish(p.id)}>{p.status === 'Draft' ? 'Publish' : 'Notify again'}</button> : null}
            {p.status === 'Published' ? <button className="btn xs" onClick={() => end(p.id)}>End now</button> : null}
            {!['offer', 'partner'].includes(p.kind) ? <Link className="btn xs" href={`/promotions?claims=${p.id}`}>Claims and rewards</Link> : null}
          </div></td>
        </tr>
      ))}</tbody></table></div></div>
  ) : <div className="card"><div className="bd empty">No promotions yet. Make the first one with + New promotion.</div></div>;
}
