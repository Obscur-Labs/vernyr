'use client';

import { useCallback, useEffect, useState } from 'react';
import { DEL, GET, POST, SEND, download } from '../api';
import { M } from '../meta';
import { ago, fmtDate, fmtDT, istToday, money } from '../format';
import { formModal, toFormData, type Field, type Vals } from '../form';
import { confirmBox, showError, toast } from '../ui';
import { confirmSilent } from '../notify';
import { openFile } from '../portalcrm';
import type { Ctx } from '../student/tabs';
import { CUR } from './shortlist';

/** The client's Payments tab (legacy/public/js/pages/work.js feesTab, portalcrm.js serviceInvoices / paymentProofs). */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const kv = (k: string, v: React.ReactNode) => <div key={k}><div className="k">{k}</div><div className="v">{v === null || v === undefined || v === '' ? <span className="muted">-</span> : v}</div></div>;

/** The GST line, worked out by the server as the amount changes. */
function GstPreview({ v }: { v: Vals }) {
  const [txt, setTxt] = useState<React.ReactNode>('Enter the amount to see the total.');
  const key = JSON.stringify([v.kind, v.amount, v.includes_gst, v.pos_code, v.bill_gstin]);
  useEffect(() => {
    if (!v.amount) return;
    const t = setTimeout(async () => {
      try {
        const c = await POST('/service-invoices/preview', { kind: v.kind, amount: v.amount, includes_gst: v.includes_gst, pos_code: v.bill_gstin ? String(v.bill_gstin).slice(0, 2) : v.pos_code });
        setTxt(c.supply_type === 'none' ? <>No GST (university application fee) = <b>{money(c.total, 'INR')}</b></>
          : <>Taxable {money(c.taxable, 'INR')} + {c.supply_type === 'intra' ? `CGST 9% ${money(c.cgst, 'INR')} + SGST 9% ${money(c.sgst, 'INR')}` : `IGST 18% ${money(c.igst, 'INR')}`}{c.round_off ? ` + round off ${money(c.round_off, 'INR')}` : ''} = <b>{money(c.total, 'INR')}</b></>);
      } catch { /* not ready */ }
    }, 250);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="p-banner info" style={{ margin: 0 }}>{txt}</div>;
}
const INV_COL: Record<string, string> = { Unpaid: 'orange', 'Proof submitted': 'blue', Paid: 'green', Cancelled: 'grey' };
function ServiceInvoices({ s, reload }: { s: Any; reload: () => void }) {
  const [d, setD] = useState<Any | null>(null);
  const load = useCallback(() => GET(`/students/${s.id}/service-invoices`).then(setD).catch(() => setD(null)), [s.id]);
  useEffect(() => { load(); }, [load]);
  if (!d) return null;
  const raise = async () => {
    const r = await formModal<Any>({
      title: 'Raise an invoice / payment request', saveLabel: 'Raise invoice', save: (v) => POST(`/students/${s.id}/service-invoices`, v),
      intro: <p className="small muted" style={{ marginTop: 0 }}>Made at once and shown to the student with the bank details and a UPI QR code. Our 3 services: GST {d.gst_rate}% (CGST + SGST when the place of supply is Gujarat, IGST for any other state). University application fee: no GST (a payment request, not a tax invoice).</p>,
      values: { kind: 'service', pos_code: d.student_pos || '', due_date: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) },
      fields: [
        { k: 'kind', label: 'What is this payment for?', type: 'select', req: true, noBlank: true, opts: d.kinds.map((x: Any) => [x.key, x.label] as [string, string]), col: 6 },
        { k: 'service_code', label: 'Service', type: 'select', req: true, opts: d.services, col: 6, show: (v) => v.kind === 'service' },
        { k: 'application_id', label: 'Application (university)', type: 'select', req: true, opts: d.applications.map((a: Any) => [a.id, a.label] as [string, string]), col: 6, show: (v) => v.kind === 'uni_app_fee', help: d.applications.length ? '' : 'This student has no application yet' },
        { k: 'description', label: 'Description (optional: filled in from the service / university)', col: 6 }, { k: 'amount', label: 'Amount (INR)', type: 'number', req: true, min: 1, step: 0.01, col: 2 },
        { k: 'includes_gst', label: 'This amount already includes GST', type: 'checkbox', col: 4, show: (v) => v.kind === 'service' },
        { k: 'pos_code', label: `Place of supply (student's state)${d.student_state ? '' : ': not in the profile, choose it'}`, type: 'select', req: true, opts: d.states.map(([c, n]: [string, string]) => [c, `${n} (${c})`] as [string, string]), col: 3, show: (v) => v.kind === 'service' },
        { k: 'due_date', label: 'Due date', type: 'date', col: 3 }, { k: 'bill_gstin', label: 'Payer GSTIN (only for a registered business)', maxlength: 15, col: 3, show: (v) => v.kind === 'service' },
        { k: 'gst_preview', type: 'html', html: (v) => <GstPreview v={v} /> },
      ],
    });
    if (r) { toast(`${r.doc_label} ${r.invoice_no} raised: ${money(r.total, 'INR')}. The student can see it now.`, 'ok'); load(); reload(); }
  };
  const cancel = async (id: string) => { const r = await confirmBox('Cancel this invoice? The student will not see it any more.', { reason: true, reasonLabel: 'Reason', danger: true, ok: 'Cancel invoice' }); if (r) { try { await POST(`/service-invoices/${id}/cancel`, { reason: r }); load(); } catch (e) { showError(e); } } };
  return (
    <div className="card">
      <div className="hd"><h2>Invoices and payment requests</h2><span className="muted small">Service A / B / C: 18% GST (CGST + SGST in Gujarat, IGST outside). University application fee: no GST.</span><span className="grow" />{d.can_add ? <button className="btn sm primary" onClick={raise}>+ Raise invoice</button> : null}</div>
      <div className="bd flush">
        {!d.gstin_set ? <div className="p-banner warn" style={{ margin: 12 }}>The company GSTIN is not set: a Super Admin must add it in Admin console &gt; Company profile before invoices can be raised.</div> : null}
        {!d.bank_set ? <div className="small muted" style={{ margin: 12 }}>Bank details / UPI ID are not set in Admin console &gt; Company profile: the invoice will not show how to pay.</div> : null}
        {d.rows.length ? <div className="table-wrap"><table className="t cards"><thead><tr><th>Invoice</th><th>For</th><th>Taxable</th><th>GST</th><th>Total</th><th>Status</th><th /></tr></thead><tbody>{d.rows.map((i: Any) => (
          <tr key={i.id}>
            <td data-label="Invoice"><b className="mono">{i.invoice_no}</b><div className="small muted">{fmtDate(i.invoice_date)} · due {fmtDate(i.due_date)}</div></td>
            <td data-label="For" className="small"><span className={`badge ${i.kind === 'service' ? 'blue' : 'grey'}`}>{i.doc_label}</span> {i.description}{i.supply_type !== 'none' ? <div className="muted">Place of supply: {i.place}</div> : null}</td>
            <td data-label="Taxable">{money(i.taxable, 'INR')}</td>
            <td data-label="GST" className="small">{i.supply_type === 'intra' ? <>CGST {money(i.cgst, 'INR')}<br />SGST {money(i.sgst, 'INR')}</> : i.supply_type === 'inter' ? `IGST ${money(i.igst, 'INR')}` : 'No GST'}</td>
            <td data-label="Total"><b>{money(i.total, 'INR')}</b></td>
            <td data-label="Status"><span className={`badge ${INV_COL[i.status] || ''}`}>{i.status}</span>{i.receipt_no ? <div className="small mono">{i.receipt_no}</div> : null}{i.cancel_reason ? <div className="small">{i.cancel_reason}</div> : null}</td>
            <td className="nowrap">
              <button className="btn xs" onClick={() => download(`/service-invoices/${i.id}/invoice.pdf`, `${i.invoice_no}.pdf`, true).catch(showError)}>Invoice PDF</button>
              {i.receipt_no ? <> <button className="btn xs" onClick={() => download(`/service-invoices/${i.id}/receipt.pdf`, `${i.receipt_no}.pdf`, true).catch(showError)}>Receipt</button></> : null}
              {['Unpaid', 'Proof submitted'].includes(i.status) && d.can_add ? <> <button className="btn xs danger" onClick={() => cancel(i.id)}>Cancel</button></> : null}
            </td>
          </tr>
        ))}</tbody></table></div> : <div className="empty">No invoices yet</div>}
      </div>
    </div>
  );
}
function PaymentProofs({ s, reload }: { s: Any; reload: () => void }) {
  const [rows, setRows] = useState<Any[] | null>(null);
  const load = useCallback(() => GET(`/students/${s.id}/payment-submissions`).then(setRows).catch(() => setRows([])), [s.id]);
  useEffect(() => { load(); }, [load]);
  if (!rows?.length) return null;
  const rec = async (x: Any) => {
    const r = await formModal<Any>({ title: 'Record as payment', size: 'sm', values: { ...x, paid_by: 'Student', remarks: '' }, save: (v) => POST(`/payment-submissions/${x.id}/record`, v),
      intro: <p className="small muted" style={{ marginTop: 0 }}>Creates the payment entry (receipt attached). E12 / E13 goes to the student as usual.</p>,
      fields: [{ k: 'amount', label: 'Amount', type: 'number', col: 3 }, { k: 'currency', label: 'Currency', type: 'select', noBlank: true, opts: CUR, col: 3 },
        { k: 'payment_date', label: 'Payment date', type: 'date', col: 3 }, { k: 'paid_by', label: 'Paid by', type: 'select', opts: ['Student', 'Parent', 'Sponsor', 'Loan bank'], col: 3 }, { k: 'remarks', label: 'Remarks (internal)', type: 'textarea', col: 6 }] });
    if (r) { toast(r.receipt_no ? `Payment accepted. Receipt ${r.receipt_no} issued to the student.` : 'Payment recorded', 'ok'); load(); reload(); }
  };
  const rej = async (id: string) => { const r = await confirmBox('Reject this payment proof? The student sees the reason.', { reason: true, reasonLabel: 'Reason (e.g. Amount not received, Receipt unclear)', danger: true, ok: 'Reject' }); if (r) { try { await POST(`/payment-submissions/${id}/reject`, { reason: r }); load(); } catch (e) { showError(e); } } };
  return (
    <div className="card"><div className="hd"><h2>Payment proofs from the student portal</h2><span className="muted small">Not payments until recorded</span></div><div className="bd flush">
      <table className="t cards"><thead><tr><th>Submitted</th><th>For</th><th>Amount</th><th>Date / mode / ref</th><th>Receipt</th><th>Status</th><th /></tr></thead><tbody>{rows.map((x) => (
        <tr key={x.id}>
          <td>{ago(x.created_at)}</td><td>{x.payment_for}{x.application_code ? <div className="small mono">{x.application_code}</div> : null}</td><td><b>{money(x.amount, x.currency)}</b></td>
          <td className="small">{fmtDate(x.payment_date)} · {x.mode}<div className="mono">{x.reference_no || ''}</div>{x.note ? <div>{x.note}</div> : null}</td>
          <td>{x.receipt_url ? <a href="#" onClick={(e) => { e.preventDefault(); openFile(x.receipt_url); }}>View</a> : '-'}</td>
          <td><span className={`badge ${x.status === 'Recorded' ? 'green' : x.status === 'Rejected' ? 'red' : 'orange'}`}>{x.status}</span>{x.reject_reason ? <div className="small">{x.reject_reason}</div> : null}</td>
          <td className="nowrap">{x.status === 'Submitted' ? <><button className="btn xs primary" onClick={() => rec(x)}>{x.invoice_id ? 'Accept & issue receipt' : 'Record as payment'}</button> <button className="btn xs danger" onClick={() => rej(x.id)}>Reject</button></> : null}</td>
        </tr>
      ))}</tbody></table>
    </div></div>
  );
}

export function FeesTab({ s, P, reload: reloadFrame }: Ctx) {
  const [d, setD] = useState<Any | null>(null);
  const [apps, setApps] = useState<Any[]>([]);
  const load = useCallback(async () => {
    try { const [f, a] = await Promise.all([GET(`/students/${s.id}/fees`), GET(`/students/${s.id}/applications`)]); setD(f); setApps(a); } catch (e) { showError(e); }
  }, [s.id]);
  useEffect(() => { load(); }, [load]);
  const reload = () => { load(); reloadFrame(); };
  if (!d) return <div className="empty">Loading...</div>;
  const payFields = (): Field[] => [
    { k: 'payment_for', label: 'Payment for', type: 'select', req: true, opts: d.tuition_only ? ['Tuition fee / deposit'] : ['Tuition fee / deposit', 'Application fee', 'La Europa service fee', 'Other'], col: 3 },
    { k: 'application_id', label: 'Application', type: 'select', req: true, opts: apps.map((a) => [a.id, `${a.application_code} - ${a.university}`] as [string, string]), col: 3, show: (v) => ['Tuition fee / deposit', 'Application fee'].includes(v.payment_for) },
    { k: 'amount', label: 'Amount', type: 'number', req: true, min: 0.01, step: 0.01 }, { k: 'currency', label: 'Currency', type: 'select', req: true, noBlank: true, opts: CUR },
    { k: 'payment_date', label: 'Payment date', type: 'date', req: true, max: undefined }, { k: 'mode', label: 'Payment mode', type: 'select', req: true, opts: M.list('payment_mode').map((x) => [x.name, x.name] as [string, string]) },
    { k: 'paid_by', label: 'Paid by', type: 'select', opts: ['Student', 'Parent', 'Sponsor', 'Loan bank'] }, { k: 'reference_no', label: 'Transaction / reference no.' }, { k: 'instalment_no', label: 'Instalment no.', type: 'number', min: 1 },
    { k: 'receipt', label: 'Receipt (PDF / JPG / PNG, 10 MB): required for tuition', type: 'file', accept: '.pdf,.jpg,.jpeg,.png', col: 6 },
    { k: 'remarks', label: 'Remarks (internal)', type: 'textarea', col: 6 },
  ];
  const payForm = async (p?: Any) => {
    const r = await formModal({
      title: p ? 'Edit payment' : 'Record payment', size: 'lg', fields: payFields(), values: p || { payment_for: 'Tuition fee / deposit', currency: 'EUR', payment_date: istToday() },
      intro: <p className="small muted" style={{ marginTop: 0 }}>{p ? 'Payments can be edited within 48 hours by the person who recorded them. All edits are logged.' : 'Tuition payments email the student (E12); service fee payments send E13 (if On).'}</p>,
      onChange: (v, prev, set) => { if (v.payment_for !== prev.payment_for) set('currency', v.payment_for === 'La Europa service fee' ? 'INR' : 'EUR'); },
      extraButtons: p ? undefined : (doSave) => <button className="btn" type="button" onClick={async () => { if (await confirmSilent()) doSave({ notify: false }); }}>Save without notifying</button>,
      save: async (v) => { const r0 = p ? await SEND('put', `/payments/${p.id}`, toFormData(v)) : await SEND('post', `/students/${s.id}/payments`, toFormData(v)); toast('Payment saved', 'ok'); return r0; },
    });
    if (r) reload();
  };
  const delPay = async (id: string) => { const r = await confirmBox('Delete this payment? (Admin, logged)', { danger: true, ok: 'Delete', reason: true }); if (r) { try { await DEL(`/payments/${id}`, { reason: r }); reload(); } catch (e) { showError(e); } } };
  const summary = async (t: Any) => {
    const r = await formModal({ title: `Tuition fee summary: ${t.university}`, values: t.summary || { currency: 'EUR' }, save: (v) => POST(`/students/${s.id}/fee-summary`, { ...v, fee_kind: 'tuition', application_id: t.application_id }),
      fields: [{ k: 'total_amount', label: 'Total tuition fee (first year)', type: 'number', req: true, min: 0 }, { k: 'currency', label: 'Currency', type: 'select', noBlank: true, opts: CUR },
        { k: 'scholarship', label: 'Scholarship / waiver', type: 'number', min: 0 }, { k: 'deposit_required', label: 'Deposit required to confirm seat', type: 'number', min: 0 }, { k: 'deposit_deadline', label: 'Deposit deadline', type: 'date', help: 'Reminder task 5 days before' }] });
    if (r) load();
  };
  const service = async () => {
    const r = await formModal<Any>({ title: 'La Europa service fee', values: d.service?.summary || {}, save: (v) => POST(`/students/${s.id}/fee-summary`, { ...v, fee_kind: 'service' }),
      fields: [{ k: 'package_id', label: 'Package / service', type: 'select', opts: M.list('service_package'), col: 3 }, { k: 'total_amount', label: 'Total service fee agreed (INR)', type: 'number', req: true, min: 0, col: 3 },
        { k: 'discount', label: 'Discount (INR)', type: 'number', min: 0, col: 3, help: 'Above your approval limit it waits for approval' }, { k: 'next_instalment_due', label: 'Next instalment due date', type: 'date', col: 3 },
        { k: 'discount_reason', label: 'Discount reason (internal, never shown to the student)', show: (x) => Number(x.discount) > 0 }] });
    if (r) { if (r.discount_pending) toast('Discount sent to Admin for approval', 'ok'); load(); }
  };
  const approve = async (id: string) => { try { await POST(`/fee-summaries/${id}/approve-discount`, { approve: true }); toast('Discount approved', 'ok'); load(); } catch (e) { showError(e); } };
  return (
    <div className="stack">
      <div className="card">
        <div className="hd"><h2>Tuition fee (per application)</h2><span className="muted small">Paid to the university. Totals per currency, no conversion.</span><span className="grow" />{P.fees_edit ? <button className="btn sm primary" onClick={() => payForm()}>+ Record payment</button> : null}</div>
        <div className="bd flush">{d.tuition.length ? <div className="table-wrap"><table className="t cards"><thead><tr><th>Application</th><th>Total (1st year)</th><th>Scholarship</th><th>Deposit</th><th>Paid</th><th>Pending</th><th /></tr></thead><tbody>
          {d.tuition.map((t: Any) => (
            <tr key={t.application_id} className={t.overdue ? 'overdue' : ''}>
              <td data-label="Application"><b>{t.university}</b><div className="small muted">{t.course} · {t.stage} · <span className="mono">{t.application_code}</span></div></td>
              <td data-label="Total">{t.summary ? money(t.summary.total_amount, t.currency) : <span className="muted">not set</span>}</td>
              <td data-label="Scholarship">{t.summary?.scholarship ? money(t.summary.scholarship, t.currency) : '-'}</td>
              <td data-label="Deposit">{t.summary?.deposit_required ? <>{money(t.summary.deposit_required, t.currency)}{t.summary.deposit_deadline ? <div className="small muted">by {fmtDate(t.summary.deposit_deadline)}</div> : null}</> : '-'}</td>
              <td data-label="Paid">{money(t.paid, t.currency)}{Object.entries(t.paid_other ?? {}).map(([c, a]) => <div key={c} className="small">+ {money(a, c)}</div>)}</td>
              <td data-label="Pending" className={t.overdue ? 'days-red' : ''}>{t.pending === null ? '-' : money(t.pending, t.currency)}{t.overdue ? <div className="small">deadline passed</div> : null}</td>
              <td>{P.fees_edit ? <button className="btn xs" onClick={() => summary(t)}>Fee summary</button> : null}</td>
            </tr>
          ))}</tbody></table></div> : <div className="empty">No applications yet</div>}</div>
      </div>
      {d.service ? (
        <div className="card"><div className="hd"><h2>La Europa service fee</h2><span className="grow" />{P.fees_edit ? <button className="btn sm" onClick={service}>Edit service fee</button> : null}</div><div className="bd"><div className="kv">
          {kv('Package / service', d.service.summary?.package_name ?? '')}{kv('Total agreed', d.service.summary ? money(d.service.summary.total_amount, 'INR') : '')}
          {kv('Discount', d.service.summary?.discount ? <>{money(d.service.summary.discount, 'INR')} {d.service.summary.discount_approved ? <span className="badge green">approved</span> : <><span className="badge orange">waiting for Admin approval</span>{M.admin() ? <> <button className="btn xs" onClick={() => approve(d.service.summary.id)}>Approve</button></> : null}</>}</> : '')}
          {kv('Paid', money(d.service.paid, 'INR'))}{kv('Pending', d.service.pending === null ? '' : money(d.service.pending, 'INR'))}{kv('Next instalment due', fmtDate(d.service.summary?.next_instalment_due))}
        </div></div></div>
      ) : null}
      <ServiceInvoices s={s} reload={load} />
      <div className="card">
        <div className="hd"><h2>Payments</h2>{d.totals.length ? <><span className="grow" />{d.totals.map((t: Any, i: number) => <span key={i} className="badge blue">{t.payment_for}: {money(t.amount, t.currency)}</span>)}</> : null}</div>
        <div className="bd flush">
          <div style={{ margin: 12 }}><PaymentProofs s={s} reload={load} /></div>
          {d.payments.length ? <div className="table-wrap"><table className="t cards"><thead><tr><th>Date</th><th>For</th><th>Amount</th><th>Mode</th><th>Paid by / ref</th><th>Receipt</th><th>By</th><th /></tr></thead><tbody>
            {d.payments.map((p: Any) => (
              <tr key={p.id}>
                <td data-label="Date" className="nowrap">{fmtDate(p.payment_date)}</td>
                <td data-label="For">{p.payment_for}{p.application_code ? <div className="small mono muted">{p.application_code}</div> : null}{p.instalment_no ? <div className="small muted">Instalment {p.instalment_no}</div> : null}</td>
                <td data-label="Amount"><b>{money(p.amount, p.currency)}</b></td><td data-label="Mode" className="small">{p.mode}</td>
                <td data-label="Paid by" className="small">{p.paid_by || ''}<div className="mono">{p.reference_no || ''}</div></td>
                <td data-label="Receipt">{p.receipt_url ? <a href="#" onClick={(e) => { e.preventDefault(); openFile(p.receipt_url); }}>View</a> : '-'}</td>
                <td data-label="By" className="small">{p.created_by_name}<br /><span className="muted">{fmtDT(p.created_at)}</span></td>
                <td className="nowrap">{p.editable ? <button className="btn xs" onClick={() => payForm(p)}>Edit</button> : null}{M.can('fees', 'delete') ? <> <button className="btn xs danger" onClick={() => delPay(p.id)}>Delete</button></> : null}</td>
              </tr>
            ))}</tbody></table></div> : <div className="empty">No payments recorded</div>}
        </div>
      </div>
    </div>
  );
}
