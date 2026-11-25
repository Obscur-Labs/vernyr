'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { DEL, GET, POST, PUT } from './api';
import { fmtDate } from './format';
import { formModal, type Field } from './form';
import { Modal, confirmBox, openOverlay, showError, toast } from './ui';
import { voucherPdf } from './promotions';

/** The client's wallet admin (legacy/public/js/pages/wallet.js): voucher requests, student wallets, voucher store, partner companies, settings. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const inr = (n: unknown) => '₹' + Number(n || 0).toLocaleString('en-IN');
const RQ: Record<string, string> = { Requested: 'orange', Approved: 'green', Declined: 'red', Cancelled: 'grey' };
const KIND: Record<string, string> = { referral: 'Referral reward', hold: 'Converted to a voucher', release: 'Returned', adjust: 'Adjustment' };
const local = (h: string) => String(h ?? '').replace(/^#/, '');

export function WalletRequests({ status }: { status: string }) {
  const [rows, setRows] = useState<Any[] | null>(null);
  const load = useCallback(() => GET('/admin/wallet/requests?status=' + encodeURIComponent(status)).then(setRows).catch(showError), [status]);
  useEffect(() => { load(); }, [load]);
  const approve = async (id: string) => { if (!(await confirmBox('Approve? A voucher with its own code is issued to the student.'))) return; try { const r = await POST(`/admin/wallet/requests/${id}/approve`); toast(`Voucher ${r.voucher_code} issued`, 'ok'); load(); } catch (e) { showError(e); } };
  const decline = async (id: string) => {
    const reason = await confirmBox('Decline this voucher request? The amount goes back to the wallet.', { reason: true, reasonLabel: 'Why (the student sees this)', danger: true, ok: 'Decline' });
    if (!reason) return;
    try { await POST(`/admin/wallet/requests/${id}/decline`, { reason }); toast('Declined, amount returned', 'ok'); load(); } catch (e) { showError(e); }
  };
  return (
    <>
      <div className="seg-tabs" style={{ marginBottom: 12 }}>{['Requested', 'Approved', 'Declined', 'all'].map((s) => <Link key={s} href={`/promotions?tab=wallet&status=${s}`} className={s === status ? 'on' : ''}>{s === 'all' ? 'All' : s}</Link>)}</div>
      {!rows ? <div className="empty">Loading...</div> : rows.length ? <div className="card"><div className="table-wrap"><table className="t cards"><thead><tr><th>Student</th><th>Voucher</th><th>Amount</th><th>Requested</th><th>Status</th><th /></tr></thead><tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td data-label="Student"><Link href={local(r.person.link)}>{r.person.name}</Link> <span className="mono small muted">{r.person.code}</span><div className="small muted">Wallet now {inr(r.balance)}</div></td>
            <td data-label="Voucher"><b>{r.item}</b><div className="small muted">{r.company}</div></td><td data-label="Amount"><b>{inr(r.amount)}</b></td>
            <td data-label="Requested" className="small">{fmtDate(r.created_at)}</td>
            <td data-label="Status"><span className={`badge ${RQ[r.status] || 'grey'}`}>{r.status}</span>{r.reason ? <div className="small muted">{r.reason}</div> : null}{r.voucher ? <div className="mono small">{r.voucher.voucher_code}</div> : null}</td>
            <td className="nowrap"><div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {r.status === 'Requested' ? <><button className="btn xs primary" onClick={() => approve(r.id)}>Approve and issue voucher</button><button className="btn xs" onClick={() => decline(r.id)}>Decline</button></> : null}
              {r.voucher ? <button className="btn xs" onClick={() => voucherPdf(r.voucher.id, r.voucher.voucher_code)}>Download voucher</button> : null}
            </div></td>
          </tr>
        ))}</tbody></table></div></div> : <div className="card"><div className="bd empty">{status === 'Requested' ? 'No voucher requests waiting.' : 'Nothing here.'}</div></div>}
    </>
  );
}

function WalletHistory({ suId, close, done }: { suId: string; close: () => void; done: () => void }) {
  const [d, setD] = useState<Any | null>(null);
  const [amount, setAmount] = useState(''), [reason, setReason] = useState('');
  useEffect(() => { GET(`/admin/wallet/students/${suId}`).then(setD).catch(showError); }, [suId]);
  const save = async () => { try { await POST(`/admin/wallet/students/${suId}/adjust`, { amount, reason }); close(); toast('Saved. The student was told.', 'ok'); done(); } catch (e) { showError(e); } };
  return (
    <Modal title={`Wallet: ${d?.person.name ?? ''}`} size="lg" close={close} foot={<><button className="btn" onClick={close}>Close</button><button className="btn primary" onClick={save}>Save adjustment</button></>}>
      {!d ? <div className="empty">Loading...</div> : <>
        <p>Balance <b style={{ fontSize: 20 }}>{inr(d.balance)}</b></p>
        <div className="table-wrap"><table className="t"><thead><tr><th>Date</th><th>What</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead><tbody>{d.rows.map((x: Any, i: number) => (
          <tr key={i}><td className="small">{fmtDate(x.created_at)}</td><td>{KIND[x.kind] || x.kind}<div className="small muted">{x.reason || ''}</div></td>
            <td style={{ textAlign: 'right' }} className={x.amount < 0 ? 'st-Rejected' : 'st-Verified'}><b>{x.amount > 0 ? '+' : ''}{inr(x.amount).replace('₹-', '-₹')}</b></td></tr>
        ))}</tbody></table></div>
        <div className="form-grid" style={{ marginTop: 14 }}>
          <div className="f c2"><label>Adjust (₹, minus to deduct)</label><input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="f c4"><label>Reason</label><input className="input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        </div>
      </>}
    </Modal>
  );
}
export function Wallets() {
  const [rows, setRows] = useState<Any[] | null>(null);
  const load = useCallback(() => GET('/admin/wallet/students').then(setRows).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <div className="empty">Loading...</div>;
  return rows.length ? <div className="card"><div className="table-wrap"><table className="t cards"><thead><tr><th>Student</th><th>Earned from referrals</th><th>Balance</th><th>Last change</th><th /></tr></thead><tbody>
    {rows.map((r) => (
      <tr key={r.student_user_id}>
        <td data-label="Student"><Link href={local(r.person.link)}>{r.person.name}</Link> <span className="mono small muted">{r.person.code}</span></td><td data-label="Earned">{inr(r.earned)}</td>
        <td data-label="Balance"><b>{inr(r.balance)}</b></td><td data-label="Last change" className="small">{fmtDate(r.last)}</td>
        <td className="nowrap"><button className="btn xs" onClick={() => openOverlay((close) => <WalletHistory suId={r.student_user_id} close={close} done={load} />)}>History / adjust</button></td>
      </tr>
    ))}</tbody></table></div></div> : <div className="card"><div className="bd empty">No wallet money yet. It is added when a referred friend enrols at the university.</div></div>;
}

export function Store() {
  const [d, setD] = useState<{ items: Any[]; cos: Any[] } | null>(null);
  const load = useCallback(async () => { try { const [items, cos] = await Promise.all([GET('/admin/wallet/items'), GET('/admin/offer-companies')]); setD({ items, cos }); } catch (e) { showError(e); } }, []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="empty">Loading...</div>;
  const form = async (i: Any | null) => {
    if (!d.cos.length) { toast('Add a partner company first (Partner companies tab).', 'err'); return; }
    const fields: Field[] = [
      { k: 'company_id', label: 'Partner company', type: 'select', req: true, noBlank: true, opts: d.cos.filter((c) => c.active || (i && c.id === i.company_id)).map((c) => [c.id, c.name] as [string, string]), col: 3 },
      { k: 'title', label: 'Title', req: true, maxlength: 120, placeholder: 'e.g. Amazon gift voucher ₹20,000', col: 3 },
      { k: 'value', label: 'Value (₹)', type: 'number', req: true, min: 1, col: 2 }, { k: 'valid_days', label: 'Valid for (days)', type: 'number', min: 1, max: 730, col: 2 },
      { k: 'active', label: 'In the store', type: 'select', noBlank: true, opts: [['1', 'Yes'], ['0', 'No (hidden)']], col: 2 },
      { k: 'description', label: 'Description', maxlength: 500, col: 6 }, { k: 'terms', label: 'Terms of the company', type: 'textarea', rows: 5, maxlength: 3000, col: 6 },
    ];
    const r = await formModal({ title: i ? 'Edit voucher' : 'New voucher', size: 'lg', fields, values: i ? { ...i, active: i.active ? '1' : '0' } : { valid_days: 90, active: '1', company_id: d.cos.find((c) => c.active)?.id },
      save: (v) => (i ? PUT(`/admin/wallet/items/${i.id}`, v) : POST('/admin/wallet/items', v)),
      extraButtons: i ? () => <button className="btn danger" type="button" onClick={async () => { if (await confirmBox('Remove this voucher from the store?', { danger: true, ok: 'Remove' })) { try { await DEL(`/admin/wallet/items/${i.id}`); toast('Removed', 'ok'); load(); } catch (e) { showError(e); } } }}>Remove</button> : undefined });
    if (r) { toast('Saved', 'ok'); load(); }
  };
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}><p className="small muted grow" style={{ margin: 0 }}>Vouchers students can take from their wallet. Each is given by a partner company.</p><button className="btn primary" onClick={() => form(null)}>+ New voucher</button></div>
      {d.items.length ? <div className="card"><div className="table-wrap"><table className="t cards"><thead><tr><th>Voucher</th><th>Company</th><th>Value</th><th>Valid for</th><th>Status</th><th /></tr></thead><tbody>
        {d.items.map((i) => (
          <tr key={i.id}>
            <td data-label="Voucher"><b>{i.title}</b>{i.description ? <div className="small muted">{i.description}</div> : null}</td><td data-label="Company">{i.company}</td><td data-label="Value"><b>{inr(i.value)}</b></td>
            <td data-label="Valid for" className="small">{i.valid_days} days</td><td data-label="Status"><span className={`badge ${i.active && i.company_active ? 'green' : 'grey'}`}>{i.active && i.company_active ? 'In the store' : 'Hidden'}</span></td>
            <td className="nowrap"><button className="btn xs" onClick={() => form(i)}>Edit</button></td>
          </tr>
        ))}</tbody></table></div></div> : <div className="card"><div className="bd empty">No vouchers in the store yet. Add a partner company first, then + New voucher.</div></div>}
    </>
  );
}

export function Companies() {
  const [cos, setCos] = useState<Any[] | null>(null);
  const load = useCallback(() => GET('/admin/offer-companies').then(setCos).catch(showError), []);
  useEffect(() => { load(); }, [load]);
  if (!cos) return <div className="empty">Loading...</div>;
  const form = async (c: Any | null) => {
    const fields: Field[] = [
      { k: 'name', label: 'Company name', req: true, maxlength: 120, col: 3 }, { k: 'contact_person', label: 'Contact person', req: true, maxlength: 100, col: 3 },
      { k: 'phone', label: 'Mobile number', req: true, type: 'tel', maxlength: 20, col: 2 }, { k: 'email', label: 'Email', req: true, type: 'email', maxlength: 120, col: 2 },
      { k: 'active', label: 'Status', type: 'select', noBlank: true, opts: [['1', 'Active'], ['0', 'Inactive']], col: 2 },
      { k: 'address', label: 'Address (optional)', maxlength: 300, col: 3 }, { k: 'website', label: 'Website (optional)', maxlength: 200, placeholder: 'https://', col: 3 },
      { k: 'notes', label: 'Notes (internal)', type: 'textarea', rows: 3, maxlength: 1000, col: 6 },
    ];
    const r = await formModal({ title: c ? `Edit ${c.name}` : 'New partner company', size: 'lg', fields, values: c ? { ...c, active: c.active ? '1' : '0' } : { active: '1' },
      save: (v) => (c ? PUT(`/admin/offer-companies/${c.id}`, v) : POST('/admin/offer-companies', v)),
      extraButtons: c ? () => <button className="btn danger" type="button" onClick={async () => { if (await confirmBox('Remove this company? Its vouchers leave the store. Vouchers already issued stay valid.', { danger: true, ok: 'Remove' })) { try { await DEL(`/admin/offer-companies/${c.id}`); load(); } catch (e) { showError(e); } } }}>Remove</button> : undefined });
    if (r) { toast('Saved', 'ok'); load(); }
  };
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}><p className="small muted grow" style={{ margin: 0 }}>Companies that give offers and vouchers. Their details are printed on each voucher; students redeem with them.</p><button className="btn primary" onClick={() => form(null)}>+ New company</button></div>
      {cos.length ? <div className="card"><div className="table-wrap"><table className="t cards"><thead><tr><th>Company</th><th>Contact person</th><th>Mobile / email</th><th>Used in</th><th>Status</th><th /></tr></thead><tbody>
        {cos.map((c) => (
          <tr key={c.id}>
            <td data-label="Company"><b>{c.name}</b>{c.address ? <div className="small muted">{c.address}</div> : null}{c.website ? <div className="small"><a href={c.website} target="_blank" rel="noopener noreferrer">{c.website}</a></div> : null}</td>
            <td data-label="Contact">{c.contact_person || ''}</td><td data-label="Mobile / email" className="small">{c.phone || ''}<br />{c.email || ''}</td>
            <td data-label="Used in" className="small">{c.items} voucher(s) · {c.promotions} promotion(s)</td><td data-label="Status"><span className={`badge ${c.active ? 'green' : 'grey'}`}>{c.active ? 'Active' : 'Inactive'}</span></td>
            <td className="nowrap"><button className="btn xs" onClick={() => form(c)}>Edit</button></td>
          </tr>
        ))}</tbody></table></div></div> : <div className="card"><div className="bd empty">No partner companies yet.</div></div>}
    </>
  );
}

export function WalletSettings() {
  const [d, setD] = useState<Any | null>(null);
  const [rules, setRules] = useState<Any[]>([]);
  const [rt, setRt] = useState('country'), [ri, setRi] = useState(''), [ra, setRa] = useState('');
  useEffect(() => { GET('/admin/wallet/settings').then((x) => { setD(x); setRules(x.rules.slice()); }).catch(showError); }, []);
  if (!d) return <div className="empty">Loading...</div>;
  const list: Any[] = rt === 'country' ? d.countries : d.universities;
  const add = () => {
    const id = ri || list[0]?.id, amount = Number(ra);
    if (!id || ra === '' || !(amount >= 0)) { toast('Choose and write the amount', 'err'); return; }
    setRules([...rules.filter((r) => !(r.type === rt && r.id === id)), { type: rt, id, amount, name: list.find((x) => x.id === id)?.name }]); setRa('');
  };
  const save = async () => { try { await PUT('/admin/wallet/settings', { referral_default: d.referral_default, min_redeem: d.min_redeem, rules }); toast('Saved', 'ok'); } catch (e) { showError(e); } };
  return (
    <div className="card"><div className="bd">
      <form className="form-grid" noValidate onSubmit={(e) => e.preventDefault()}>
        <div className="f c3"><label>Referral reward (₹ per friend who enrols)</label><input className="input" type="number" min={0} value={d.referral_default} onChange={(e) => setD({ ...d, referral_default: e.target.value })} /></div>
        <div className="f c3"><label>Can turn into a voucher from (₹)</label><input className="input" type="number" min={1} value={d.min_redeem} onChange={(e) => setD({ ...d, min_redeem: e.target.value })} /></div>
        <div className="form-section">Different amount for some countries / universities <span className="small muted" style={{ fontWeight: 400 }}>(a university rule wins over a country rule)</span></div>
        <div className="f c6">{rules.length ? <table className="t"><tbody>{rules.map((r, i) => (
          <tr key={r.type + r.id}><td>{r.type === 'country' ? 'Country' : 'University'}</td><td><b>{r.name}</b></td><td>{'₹' + Number(r.amount).toLocaleString('en-IN')}</td>
            <td style={{ textAlign: 'right' }}><button type="button" className="btn xs" onClick={() => setRules(rules.filter((_, j) => j !== i))}>Remove</button></td></tr>
        ))}</tbody></table> : <p className="small muted" style={{ margin: 0 }}>No special amounts: every referral gives the reward above.</p>}</div>
        <div className="f c2"><label>Rule for</label><select className="input" value={rt} onChange={(e) => { setRt(e.target.value); setRi(''); }}><option value="country">Country</option><option value="university">University</option></select></div>
        <div className="f c2"><label>Which</label><select className="input" value={ri} onChange={(e) => setRi(e.target.value)}>{list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        <div className="f c1"><label>₹</label><input className="input" type="number" min={0} placeholder="1000" value={ra} onChange={(e) => setRa(e.target.value)} /></div>
        <div className="f c1"><label>&nbsp;</label><button type="button" className="btn" onClick={add}>Add</button></div>
      </form>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className="btn primary" onClick={save}>Save settings</button></div>
      <p className="small muted">Money is added to the referrer&apos;s wallet automatically when the referred friend&apos;s application reaches &quot;Enrolment confirmed&quot; (after the visa, enrolled at the university). The wallet cannot be withdrawn as cash; it is only turned into vouchers.</p>
    </div></div>
  );
}
