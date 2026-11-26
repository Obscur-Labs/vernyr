'use client';

import { useState } from 'react';
import Link from 'next/link';
import { GET, POST, SEND, download, openFrom } from './api';
import { fmtDT, fmtDate, money } from './format';
import { formModal, toFormData, Options, type Field, type Vals } from './form';
import { confirmBox, showError, toast } from './ui';
import { Page, UStatus, canAct, useGo, useLoad, useQ, type Any } from './u';

/** The client's university to student screens (legacy/public/university/js/direct.js): the Student (direct) tab, documents in 1 click, the pipeline board. */

const KIND_ICON: Record<string, string> = { offer_letter: '🎓', loa: '🛂', invoice: '🧾', receipt: '✅', agreement: '✍', document: '📄', message: '💬' };
const FMT: [number, string][] = [[1, '1. Classic formal'], [2, '2. Modern header band'], [3, '3. European with reference block'], [4, '4. Compact one-page'], [5, '5. Detailed with terms']];
const CUR = ['EUR', 'USD', 'GBP', 'CNY', 'SEK', 'CHF', 'INR'];
const today = () => new Date().toISOString().slice(0, 10);
type Line = { description?: string; amount?: string | number };

export function StudentTab({ v }: { v: Any }) {
  const st = useLoad(async () => { const [d, df] = await Promise.all([GET(`/applications/${v.id}/student`), GET(`/applications/${v.id}/student/defaults`)]); return { d, df }; }, [v.id]);
  return <Page state={st}>{() => { const { d, df } = st.data as Any;
    const loaOk = ['Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'].includes(v.status);
    const can = d.can_send && canAct() && !v.withdrawn_at;
    const sent = (m: string) => { toast(m, 'ok'); st.reload(); };
    const message = () => formModal({ title: `Message to ${v.student_name}`, saveLabel: 'Send',
      fields: [{ k: 'body', label: 'Message', type: 'textarea', rows: 5, maxlength: 3000, help: 'The student reads and answers it in the La Europa portal.', col: 6 }],
      save: async (x) => { await POST(`/applications/${v.id}/student/message`, x); sent('Sent to the student'); return true; } });
    const invoice = () => {
      const lines: Line[] = [{ description: 'Tuition fee (first year)', amount: df.tuition ?? v.offer?.fee?.total_amount ?? '' }, ...(df.other_fees || []).map((x: Any) => ({ description: x.label, amount: x.amount }))];
      return formModal({ title: 'Tuition fee invoice to the student', size: 'lg', saveLabel: 'Generate and send', values: { items: lines, currency: df.currency || 'EUR', format: String(df.format || 1), student_uni_id: df.student_uni_id || '' },
        fields: [
          { k: 'items', type: 'html', html: (x, set) => <Lines lines={x.items} set={(l) => set('items', l)} /> },
          { k: 'currency', label: 'Currency', req: true, type: 'select', opts: CUR, noBlank: true, col: 2 }, { k: 'scholarship', label: 'Scholarship / discount', type: 'number', min: 0, step: 0.01, col: 2 },
          { k: 'due_date', label: 'Due date', req: true, type: 'date', min: today(), col: 2 },
          { k: 'format', label: 'Format', type: 'select', opts: FMT, noBlank: true, col: 3 }, { k: 'student_uni_id', label: 'Student ID', maxlength: 50, col: 3 },
          df.has_bank ? { k: 'bankok', type: 'html', html: () => <p className="small muted">Your saved bank account is printed on the invoice.</p> }
            : { k: 'bank_details', label: 'How to pay (or save your bank account in Letters & bank details)', type: 'textarea', maxlength: 1500, col: 6 },
          { k: 'note', label: 'Note', maxlength: 1000, col: 6 },
          { k: 'hint', type: 'html', html: () => <p className="small muted">A PDF invoice is generated with your university&apos;s name and sent to the student. Amounts only: do not write words like non-EU, international or foreign.</p> }],
        save: async (x) => { const r = await POST(`/applications/${v.id}/student/invoice`, { ...x, items: (x.items as Line[]).filter((i) => String(i.description || '').trim()) }); sent(`Invoice ${r.invoice_no} sent to the student`); return true; } });
    };
    const receipt = () => formModal({ title: 'Fee payment receipt', size: 'lg', saveLabel: 'Generate and send receipt',
      values: { currency: df.currency || 'EUR', payment_date: today(), purpose: 'Tuition deposit', method: 'Bank transfer', total_fees: df.tuition ?? '', student_uni_id: df.student_uni_id || '', format: String(df.format || 1) },
      fields: [{ k: 'amount', label: 'Amount received', req: true, type: 'number', min: 0, step: 0.01, col: 2 }, { k: 'currency', label: 'Currency', type: 'select', opts: CUR, noBlank: true, col: 2 },
        { k: 'payment_date', label: 'Payment date', req: true, type: 'date', max: today(), col: 2 },
        { k: 'purpose', label: 'Payment for', type: 'select', opts: ['Tuition deposit', 'Tuition fee', 'Tuition fee instalment', 'Application fee', 'Accommodation', 'Other'], noBlank: true, col: 2 },
        { k: 'method', label: 'Method', type: 'select', opts: ['Bank transfer', 'Card', 'Online payment', 'Cash', 'Other'], noBlank: true, col: 2 }, { k: 'reference', label: 'Transaction reference', maxlength: 100, col: 2 },
        { k: 'total_fees', label: 'Total fee (to show the balance)', type: 'number', min: 0, step: 0.01, col: 2 }, { k: 'student_uni_id', label: 'Student ID', maxlength: 50, col: 2 }, { k: 'format', label: 'Format', type: 'select', opts: FMT, noBlank: true, col: 2 },
        { k: 'hint', type: 'html', html: () => <p className="small muted">Already received before this payment: {money(df.paid_to_date || 0, df.currency)}. The receipt is generated on your letterhead and sent to the student.</p> }],
      save: async (x) => { const r = await POST(`/applications/${v.id}/student/receipt`, x); sent(`Receipt ${r.receipt_no} sent`); return true; } });
    const loa = () => { const c = df.contact || {};
      return formModal({ title: 'Final Letter of Acceptance (for the visa)', size: 'lg', saveLabel: 'Generate and send final LOA',
        intro: <p className="small muted" style={{ marginTop: 0 }}>The student uses this letter for the visa. It shows the student&apos;s details, the programme, fees paid and your contact person.</p>,
        values: { student_uni_id: df.student_uni_id || '', total_fees: df.tuition ?? '', fees_paid: df.paid_to_date || '', currency: df.currency || 'EUR', format: String(df.format || 1),
          contact_name: c.name || '', contact_designation: c.designation || '', contact_email: c.email || '', contact_phone: c.phone || '' },
        fields: [{ k: 'student_uni_id', label: 'Student ID', req: true, maxlength: 50, col: 2 }, { k: 'programme_start', label: 'Programme start', req: true, type: 'date', col: 2 }, { k: 'programme_end', label: 'Expected end', type: 'date', col: 2 },
          { k: 'duration', label: 'Duration', placeholder: 'e.g. 2 years', maxlength: 40, col: 2 }, { k: 'total_fees', label: 'Total tuition fee', req: true, type: 'number', min: 0, step: 0.01, col: 2 }, { k: 'fee_period', label: 'Fee period', placeholder: 'first year', maxlength: 40, col: 2 },
          { k: 'fees_paid', label: 'Fees paid', type: 'number', min: 0, step: 0.01, help: 'Default: total of your receipts', col: 2 }, { k: 'payment_date', label: 'Last payment date', type: 'date', col: 2 }, { k: 'currency', label: 'Currency', type: 'select', opts: CUR, noBlank: true, col: 2 },
          { k: 'reporting_date', label: 'Reporting / arrival date', type: 'date', col: 2 }, { k: 'accommodation', label: 'Accommodation (optional)', maxlength: 500, col: 2 }, { k: 'format', label: 'Format', type: 'select', opts: FMT, noBlank: true, col: 2 },
          { k: 'cp', type: 'html', html: () => <p className="small"><b>Contact person on the letter</b> (from Letters &amp; bank details, change here only for this letter):</p> },
          { k: 'contact_name', label: 'Name', col: 3 }, { k: 'contact_designation', label: 'Designation', col: 3 }, { k: 'contact_email', label: 'Email', col: 3 }, { k: 'contact_phone', label: 'Phone', col: 3 },
          { k: 'note', label: 'Closing note (optional)', maxlength: 500, col: 6 }],
        save: async (x) => { const r = await POST(`/applications/${v.id}/student/loa`, x); sent(`Final LOA ${r.loa_no} sent to the student`); return true; } }); };
    const docDialog = (kind: 'agreement' | 'document') => formModal({ title: kind === 'agreement' ? 'Send an agreement to the student' : 'Send a document to the student', size: 'lg', saveLabel: 'Send',
      values: { needs_acceptance: true },
      fields: [{ k: 'title', label: 'Title', req: true, maxlength: 150, placeholder: kind === 'agreement' ? 'e.g. Student enrolment agreement' : 'e.g. Pre-arrival guide', col: 6 },
        { k: 'text', label: 'Text (a PDF is generated from it)', type: 'textarea', rows: 9, maxlength: 20000, col: 6 }, { k: 'file', label: 'Or upload a file (PDF / JPG / PNG)', type: 'file', accept: '.pdf,.jpg,.jpeg,.png', col: 6 },
        { k: 'message', label: 'Message to the student (optional)', maxlength: 2000, col: 6 },
        ...(kind === 'agreement' ? [{ k: 'needs_acceptance', label: 'The student must accept it online (typed name, IP address and time are recorded)', type: 'checkbox' } as Field] : [])],
      save: async (x) => { await SEND('post', `/applications/${v.id}/student/document`, toFormData({ ...x, kind, needs_acceptance: kind === 'agreement' ? !!x.needs_acceptance : undefined })); sent('Sent to the student'); return true; } });
    return (<>
      <div className="banner" style={{ marginBottom: 12 }}>Send things <b>directly to the student</b>: they appear in the student&apos;s La Europa portal and the student gets an email. La Europa (and the student&apos;s agency) always gets a copy. The student&apos;s phone and email stay private.</div>
      {can ? <>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button className="btn sm primary" onClick={message}>💬 Message the student</button>
          {d.invoice_ok ? <><button className="btn sm" onClick={invoice}>🧾 Tuition fee invoice</button><button className="btn sm" onClick={receipt}>✅ Payment receipt</button></> : <span className="small muted">Invoice and receipt: after an offer</span>}
          {loaOk ? <button className="btn sm primary" onClick={loa}>🛂 Issue final LOA (for visa)</button> : <span className="small muted">Final LOA: after an unconditional offer</span>}
          <button className="btn sm" onClick={() => docDialog('agreement')}>✍ Send agreement</button><button className="btn sm" onClick={() => docDialog('document')}>📄 Send a document</button>
          <span className="small muted">Offer letters: use &quot;Issue conditional / unconditional offer&quot;.</span>
        </div>
        {!df.has_bank || !df.has_signature ? <div className="banner warn" style={{ marginBottom: 12 }}>Fill <Link href="/letters">Letters &amp; bank details</Link> once (logo, signature, stamp, bank account, fees, contact person) so every letter is complete.</div> : null}
      </> : null}
      {df.paid_to_date ? <p className="small">Fees received so far (from receipts): <b>{money(df.paid_to_date, df.currency)}</b></p> : null}
      <div className="card"><div className="hd"><h2>Sent to / received from the student</h2></div><div className="bd flush">
        {d.rows.length ? d.rows.map((x: Any) => (
          <div key={x.id} className="doc-row row" style={{ gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}><span style={{ fontSize: 18 }}>{KIND_ICON[x.kind] || '•'}</span>
            <div className="grow" style={{ minWidth: 200 }}>
              <b>{x.kind_label}{x.title ? ': ' + x.title : ''}</b>{x.mine ? null : <> <span className="badge blue">from the student</span></>}
              {x.body ? <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{x.body}</div> : null}
              {x.amount !== null && x.amount !== undefined ? <div className="small">Total {money(x.amount, x.currency)}{x.due_date ? ' · due ' + fmtDate(x.due_date) : ''}</div> : null}
              <div className="small muted">{x.sender} · {fmtDT(x.created_at)}{x.mine ? ` · ${x.viewed_at ? 'seen by the student ' + fmtDT(x.viewed_at) : 'not opened yet'}` : ''}</div>
              {x.needs_acceptance ? (x.accepted_at ? <div className="small" style={{ color: 'var(--success-ink)' }}>✓ Accepted by the student as &quot;{x.accepted_name}&quot; on {fmtDT(x.accepted_at)}</div>
                : <div className="small" style={{ color: 'var(--warning-ink)' }}>Waiting for the student to accept</div>) : null}
            </div>
            {x.has_file ? <button className="btn xs" onClick={() => openFrom(`/applications/${v.id}/student/${x.id}/file`).catch(showError)}>View PDF</button> : null}
          </div>)) : <div className="empty">Nothing sent yet.</div>}
      </div></div>
    </>); }}</Page>;
}
function Lines({ lines, set }: { lines: Line[]; set: (l: Line[]) => void }) {
  const upd = (i: number, k: keyof Line, x: string) => set(lines.map((l, j) => (j === i ? { ...l, [k]: x } : l)));
  return (<><label>Charges<span className="req">*</span></label>
    {lines.map((l, i) => (
      <div key={i} className="row" style={{ gap: 6, marginBottom: 6 }}>
        <input className="input grow" placeholder="Description (e.g. Tuition fee year 1)" maxLength={200} value={l.description ?? ''} onChange={(e) => upd(i, 'description', e.target.value)} />
        <input className="input" type="number" min={0} step={0.01} placeholder="Amount" style={{ width: 140 }} value={l.amount ?? ''} onChange={(e) => upd(i, 'amount', e.target.value)} />
        <button type="button" className="btn xs ghost" onClick={() => set(lines.filter((_, j) => j !== i))}>✕</button>
      </div>))}
    <button type="button" className="btn xs" onClick={() => set([...lines, {}])}>+ Add line</button></>);
}

// 1-click documents: everything is filled automatically; Preview opens the PDF without sending, Generate & send stores it and sends it to the student (copy for La Europa)
const DOC_ICON: Record<string, string> = { offer_conditional: '🎓', offer_unconditional: '🎓', loa: '🛂', invoice: '🧾', receipt: '✅' };
export function OneClick({ v }: { v: Any }) {
  const st = useLoad(() => GET(`/applications/${v.id}/docs`), [v.id]);
  const [fmt, setFmt] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  if (st.error || !st.data) return null;
  const d = st.data as Any; const s = d.summary; const format = fmt ?? String(d.format);
  const amountFor = async (key: string): Promise<string | null | undefined> => {
    if (key !== 'receipt' || !d.docs.find((x: Any) => x.key === 'receipt')?.needs_amount) return null;
    const r = await formModal<Vals>({ title: 'Amount received', fields: [{ k: 'amount', label: `Amount received (${s.currency})`, type: 'number', min: 0, step: 0.01, req: true, col: 6 }], save: async (x) => x });
    return r ? String(r.amount ?? '') : undefined;
  };
  const preview = async (key: string) => {
    const amt = await amountFor(key); if (amt === undefined) return;
    download(`/applications/${v.id}/docs/${key}/preview?format=${format}${amt ? '&amount=' + encodeURIComponent(amt) : ''}`, `preview-${key}.pdf`, undefined, true).catch(showError);
  };
  const send = async (key: string) => {
    const amt = await amountFor(key); if (amt === undefined) return;
    if (!(await confirmBox(`Generate the ${d.docs.find((x: Any) => x.key === key).label} and send it to ${v.student_name}?`, { ok: 'Generate & send' }))) return;
    setBusy(key);
    try { const r = await POST(`/applications/${v.id}/docs/${key}/send`, { format, ...(amt ? { amount: amt } : {}) }); toast(`${r.no} sent to the student`, 'ok'); st.reload(); } catch (e) { showError(e); } finally { setBusy(''); }
  };
  return (
    <div className="card" style={{ border: '1px solid var(--indigo-line)', boxShadow: '0 0 0 4px var(--indigo-soft)' }}>
      <div className="hd"><h2>📄 Documents in 1 click</h2><span className="grow" />
        <span className="small">Format: <select className="input" style={{ width: 'auto', display: 'inline-block', height: 30, padding: '2px 6px' }} value={format} onChange={(e) => setFmt(e.target.value)}><Options list={d.formats.map((f: Any) => [f.id, `${f.id}. ${f.name}`])} /></select></span></div>
      <div className="bd">
        <div className="small muted" style={{ marginBottom: 10 }}>Filled automatically: student ID <b>{d.student_uni_id}</b> · tuition <b>{money(s.tuition, s.currency)}</b>{s.scholarship ? <> · scholarship <b>{money(s.scholarship, s.currency)}</b></> : null}
          {s.deposit ? <> · deposit <b>{money(s.deposit, s.currency)}</b></> : null} · paid <b>{money(s.paid, s.currency)}</b>{s.programme_start ? <> · start <b>{fmtDate(s.programme_start)}</b></> : null}
          {s.conditions ? ` · ${s.conditions} open condition(s)` : ''}. <Link href="/letters">Change letterhead, fees, bank, colour</Link></div>
        {!d.settings_ok ? <div className="banner warn" style={{ marginBottom: 10 }}>Your <Link href="/letters">Letters &amp; bank details</Link> are not complete (signatory and bank account). Documents will be generated, but fill them once for complete letters.</div> : null}
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>{d.docs.map((x: Any) => (
          <div key={x.key} className="card" style={{ padding: 10, ...(x.ready ? {} : { opacity: 0.55 }) }}>
            <div><span style={{ fontSize: 18 }}>{DOC_ICON[x.key]}</span> <b>{x.label}</b></div>
            <div className="small muted" style={{ margin: '4px 0 8px' }}>{x.ready ? (x.last ? 'Last sent ' + fmtDate(x.last) : 'Not sent yet') : x.key === 'loa' ? 'After an unconditional offer' : 'After an offer'}</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button className="btn xs" disabled={!x.ready} onClick={() => preview(x.key)}>Preview</button>
              {d.can_send ? <button className="btn xs primary" disabled={!x.ready || busy === x.key} onClick={() => send(x.key)}>Generate &amp; send</button> : null}
            </div>
          </div>))}</div>
      </div>
    </div>
  );
}

/** every student who applied through La Europa, by status */
export function Pipeline() {
  const q = useQ(); const go = useGo();
  const st = useLoad(() => GET('/pipeline'), []);
  const [search, setSearch] = useState(q.q || '');
  return <Page state={st}>{() => { const d = st.data as Any;
    const cols = (d.statuses as string[]).filter((s) => s !== 'Withdrawn');
    const t = String(q.q || '').toLowerCase();
    const rows = (d.rows as Any[]).filter((r) => !t || `${r.student} ${r.code} ${r.course}`.toLowerCase().includes(t));
    return (<>
      <div className="page-head"><div><h1>Student pipeline</h1><div className="sub">Every student who applied through La Europa, by status. Open a card to act, message the student or send documents.</div></div><span className="grow" />
        <input className="input" type="search" placeholder="Search student, application ID or course" style={{ maxWidth: 280 }} value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') go('/pipeline' + (search ? '?q=' + encodeURIComponent(search) : '')); }} onBlur={() => go('/pipeline' + (search ? '?q=' + encodeURIComponent(search) : ''))} /></div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>{cols.map((s) => <span key={s} className="small"><UStatus s={s} /> <b>{rows.filter((r) => r.status === s).length}</b></span>)}</div>
      <div className="kanban">{cols.map((s) => { const list = rows.filter((r) => r.status === s); return (
        <div key={s} className="kcol" style={{ minWidth: 240, maxWidth: 280 }}><div className="kh"><UStatus s={s} /> <span className="small muted">{list.length}</span></div>
          {list.length ? list.map((r) => (
            <Link key={r.id} className="kcard card" href={`/applications/${r.id}?tab=student`} style={{ display: 'block', padding: 10, marginTop: 8, color: 'inherit', textDecoration: 'none' }}>
              <b>{r.student}</b>{r.unread_student ? <> <span className="badge red">{r.unread_student} new</span></> : null}<div className="small muted">{r.code}</div><div className="small">{r.course || ''} · {r.intake || ''}</div>
              {r.invoice ? <div className="small">🧾 {money(r.invoice.amount, r.invoice.currency)}{r.invoice.due_date ? ' due ' + fmtDate(r.invoice.due_date) : ''}</div> : null}
              {r.agreement ? <div className="small">✍ Agreement: {r.agreement}</div> : null}
              {r.last_sent ? <div className="small muted">Last sent: {r.last_sent.kind} · {fmtDate(r.last_sent.at)}</div> : null}
            </Link>)) : <div className="small muted" style={{ padding: 8 }}>None</div>}
        </div>); })}</div>
    </>); }}</Page>;
}
