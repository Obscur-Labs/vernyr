// University <-> student directly (Nov 2026): message the student, send a tuition fee invoice, an agreement or a document.
// Offer letters issued with "Issue offer" reach the student automatically. La Europa always gets a copy. Plus the pipeline board.
import { uget, upost, uapi, esc, $, $$, toast, modal, opt, fmtDate, fmtDT, money, canAct, ustatus, showError } from './u.js';
import { go } from './main.js';

const KIND_ICON = { offer_letter: '🎓', loa: '🛂', invoice: '🧾', receipt: '✅', agreement: '✍', document: '📄', message: '💬' };
const FMT = [[1, '1. Classic formal'], [2, '2. Modern header band'], [3, '3. European with reference block'], [4, '4. Compact one-page'], [5, '5. Detailed with terms']];
export async function studentTab(el, v) {
  const [d, df] = await Promise.all([uget(`/applications/${v.id}/student`), uget(`/applications/${v.id}/student/defaults`)]);
  const loaOk = ['Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'].includes(v.status);
  const can = d.can_send && canAct() && !v.withdrawn_at;
  el.innerHTML = `<div class="banner" style="margin-bottom:12px">Send things <b>directly to the student</b>: they appear in the student's La Europa portal and the student gets an email. La Europa (and the student's agency) always gets a copy. The student's phone and email stay private.</div>
    ${can ? `<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:12px"><button class="btn sm primary" data-msg>💬 Message the student</button>${d.invoice_ok ? '<button class="btn sm" data-inv>🧾 Tuition fee invoice</button><button class="btn sm" data-rcpt>✅ Payment receipt</button>' : '<span class="small muted">Invoice and receipt: after an offer</span>'}${loaOk ? '<button class="btn sm primary" data-loa>🛂 Issue final LOA (for visa)</button>' : '<span class="small muted">Final LOA: after an unconditional offer</span>'}
      <button class="btn sm" data-agr>✍ Send agreement</button><button class="btn sm" data-doc>📄 Send a document</button><span class="small muted">Offer letters: use "Issue conditional / unconditional offer".</span></div>
      ${!df.has_bank || !df.has_signature ? `<div class="banner warn" style="margin-bottom:12px">Fill <a href="#/letters">Letters &amp; bank details</a> once (logo, signature, stamp, bank account, fees, contact person) so every letter is complete.</div>` : ''}` : ''}
    ${df.paid_to_date ? `<p class="small">Fees received so far (from receipts): <b>${money(df.paid_to_date, df.currency)}</b></p>` : ''}
    <div class="card"><div class="hd"><h2>Sent to / received from the student</h2></div><div class="bd flush">
      ${d.rows.length ? d.rows.map(x => `<div class="doc-row row" style="gap:10px;align-items:flex-start;flex-wrap:wrap"><span style="font-size:18px">${KIND_ICON[x.kind] || '•'}</span><div class="grow" style="min-width:200px">
        <b>${esc(x.kind_label)}${x.title ? ': ' + esc(x.title) : ''}</b>${x.mine ? '' : ' <span class="badge blue">from the student</span>'}
        ${x.body ? `<div class="small" style="white-space:pre-wrap">${esc(x.body)}</div>` : ''}
        ${x.amount !== null && x.amount !== undefined ? `<div class="small">Total ${money(x.amount, x.currency)}${x.due_date ? ' · due ' + esc(fmtDate(x.due_date)) : ''}</div>` : ''}
        <div class="small muted">${esc(x.sender)} · ${esc(fmtDT(x.created_at))}${x.mine ? ` · ${x.viewed_at ? 'seen by the student ' + esc(fmtDT(x.viewed_at)) : 'not opened yet'}` : ''}</div>
        ${x.needs_acceptance ? (x.accepted_at ? `<div class="small" style="color:var(--success-ink)">✓ Accepted by the student as "${esc(x.accepted_name)}" on ${esc(fmtDT(x.accepted_at))}</div>` : '<div class="small" style="color:var(--warning-ink)">Waiting for the student to accept</div>') : ''}</div>
        ${x.has_file ? `<a class="btn xs" href="/api/university/applications/${v.id}/student/${x.id}/file" target="_blank" rel="noopener">View PDF</a>` : ''}</div>`).join('') : '<div class="empty">Nothing sent yet.</div>'}</div></div>`;
  const reload = () => go(location.hash);
  const F = (k, label, input, help) => `<div class="f" data-k="${k}"><label>${label}</label>${input}${help ? `<div class="help">${help}</div>` : ''}<div class="msg"></div></div>`;
  const on = (sel, fn) => { const b = $(sel, el); if (b) b.onclick = fn; };
  on('[data-msg]', () => {
    const m = modal({ title: `Message to ${v.student_name}`, body: `<form>${F('body', 'Message', '<textarea class="input" name="body" rows="5" maxlength="3000" style="height:auto;padding:8px"></textarea>', 'The student reads and answers it in the La Europa portal.')}</form>`, foot: '<button class="btn primary" data-s>Send</button>' });
    $('[data-s]', m.el).onclick = async () => { try { await upost(`/applications/${v.id}/student/message`, Object.fromEntries(new FormData($('form', m.el)))); m.close(); toast('Sent to the student', 'ok'); reload(); } catch (e) { showError(e, $('form', m.el)); } };
  });
  on('[data-inv]', () => {
    const today = new Date().toISOString().slice(0, 10);
    const m = modal({ title: 'Tuition fee invoice to the student', size: 'lg', body: `<form novalidate><div class="f" data-k="items"><label>Charges *</label><div data-lines></div><button type="button" class="btn xs" data-add>+ Add line</button><div class="msg"></div></div>
      <div class="row" style="gap:10px;flex-wrap:wrap">${F('currency', 'Currency *', `<select class="input" name="currency" style="width:120px">${opt(['EUR', 'USD', 'GBP', 'CNY', 'SEK', 'CHF', 'INR'], df.currency || 'EUR')}</select>`)}${F('scholarship', 'Scholarship / discount', '<input class="input" type="number" min="0" step="0.01" name="scholarship" style="width:160px">')}${F('due_date', 'Due date *', `<input class="input" type="date" name="due_date" min="${today}">`)}</div>
      ${F('format', 'Format', `<select class="input" name="format">${opt(FMT, df.format)}</select>`)}${F('student_uni_id', 'Student ID', `<input class="input" name="student_uni_id" maxlength="50" value="${esc(df.student_uni_id || '')}">`)}
      ${df.has_bank ? '<p class="small muted">Your saved bank account is printed on the invoice.</p>' : F('bank_details', 'How to pay (or save your bank account in Letters & bank details)', '<textarea class="input" name="bank_details" rows="3" maxlength="1500" style="height:auto;padding:8px"></textarea>')}${F('note', 'Note', '<input class="input" name="note" maxlength="1000">')}</form>
      <p class="small muted">A PDF invoice is generated with your university's name and sent to the student. Amounts only: do not write words like non-EU, international or foreign.</p>`, foot: '<button class="btn primary" data-s>Generate and send</button>' });
    const add = (desc = '', amt = '') => { const r = document.createElement('div'); r.className = 'row'; r.style.cssText = 'gap:6px;margin-bottom:6px'; r.innerHTML = `<input class="input grow" placeholder="Description (e.g. Tuition fee year 1)" maxlength="200" data-d value="${esc(desc)}"><input class="input" type="number" min="0" step="0.01" placeholder="Amount" style="width:140px" data-a value="${esc(amt)}"><button type="button" class="btn xs ghost">✕</button>`; $('button', r).onclick = () => r.remove(); $('[data-lines]', m.el).appendChild(r); };
    add('Tuition fee (first year)', df.tuition ?? (v.offer && v.offer.fee ? v.offer.fee.total_amount : '')); for (const x of df.other_fees || []) add(x.label, x.amount); $('[data-add]', m.el).onclick = () => add();
    $('[data-s]', m.el).onclick = async () => { const f = $('form', m.el); const b = Object.fromEntries(new FormData(f)); b.items = $$('[data-lines] .row', m.el).map(r => ({ description: $('[data-d]', r).value.trim(), amount: $('[data-a]', r).value })).filter(i => i.description);
      try { const r = await upost(`/applications/${v.id}/student/invoice`, b); m.close(); toast(`Invoice ${r.invoice_no} sent to the student`, 'ok'); reload(); } catch (e) { showError(e, f); } };
  });
  const docDialog = (kind) => {
    const m = modal({ title: kind === 'agreement' ? 'Send an agreement to the student' : 'Send a document to the student', size: 'lg', body: `<form novalidate>${F('title', 'Title *', `<input class="input" name="title" maxlength="150" placeholder="${kind === 'agreement' ? 'e.g. Student enrolment agreement' : 'e.g. Pre-arrival guide'}">`)}
      ${F('text', 'Text (a PDF is generated from it)', '<textarea class="input" name="text" rows="9" maxlength="20000" style="height:auto;padding:8px"></textarea>')}${F('file', 'Or upload a file (PDF / JPG / PNG)', '<input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png">')}
      ${F('message', 'Message to the student (optional)', '<input class="input" name="message" maxlength="2000">')}
      ${kind === 'agreement' ? '<label class="row small" style="gap:6px"><input type="checkbox" name="needs_acceptance" checked> The student must accept it online (typed name, IP address and time are recorded)</label>' : ''}</form>`, foot: '<button class="btn primary" data-s>Send</button>' });
    $('[data-s]', m.el).onclick = async () => { const f = $('form', m.el); const fd = new FormData(f); fd.set('kind', kind); if (f.needs_acceptance) fd.set('needs_acceptance', String(f.needs_acceptance.checked)); if (!f.file.files.length) fd.delete('file');
      try { await uapi('POST', `/applications/${v.id}/student/document`, fd); m.close(); toast('Sent to the student', 'ok'); reload(); } catch (e) { showError(e, f); } };
  };
  on('[data-rcpt]', () => {
    const today = new Date().toISOString().slice(0, 10);
    const m = modal({ title: 'Fee payment receipt', size: 'lg', body: `<form novalidate><div class="row" style="gap:10px;flex-wrap:wrap">${F('amount', 'Amount received *', '<input class="input" type="number" min="0" step="0.01" name="amount">')}${F('currency', 'Currency', `<select class="input" name="currency">${opt(['EUR', 'USD', 'GBP', 'CNY', 'SEK', 'CHF', 'INR'], df.currency || 'EUR')}</select>`)}${F('payment_date', 'Payment date *', `<input class="input" type="date" name="payment_date" max="${today}" value="${today}">`)}</div>
      <div class="row" style="gap:10px;flex-wrap:wrap">${F('purpose', 'Payment for', `<select class="input" name="purpose">${opt(['Tuition deposit', 'Tuition fee', 'Tuition fee instalment', 'Application fee', 'Accommodation', 'Other'])}</select>`)}${F('method', 'Method', `<select class="input" name="method">${opt(['Bank transfer', 'Card', 'Online payment', 'Cash', 'Other'])}</select>`)}${F('reference', 'Transaction reference', '<input class="input" name="reference" maxlength="100">')}</div>
      <div class="row" style="gap:10px;flex-wrap:wrap">${F('total_fees', 'Total fee (to show the balance)', `<input class="input" type="number" min="0" step="0.01" name="total_fees" value="${esc(df.tuition ?? '')}">`)}${F('student_uni_id', 'Student ID', `<input class="input" name="student_uni_id" maxlength="50" value="${esc(df.student_uni_id || '')}">`)}${F('format', 'Format', `<select class="input" name="format">${opt(FMT, df.format)}</select>`)}</div>
      <p class="small muted">Already received before this payment: ${money(df.paid_to_date || 0, df.currency)}. The receipt is generated on your letterhead and sent to the student.</p></form>`, foot: '<button class="btn primary" data-s>Generate and send receipt</button>' });
    $('[data-s]', m.el).onclick = async () => { const f = $('form', m.el); try { const r = await upost(`/applications/${v.id}/student/receipt`, Object.fromEntries(new FormData(f))); m.close(); toast(`Receipt ${r.receipt_no} sent`, 'ok'); reload(); } catch (e) { showError(e, f); } };
  });
  on('[data-loa]', () => {
    const c = df.contact || {};
    const m = modal({ title: 'Final Letter of Acceptance (for the visa)', size: 'lg', body: `<form novalidate><p class="small muted" style="margin-top:0">The student uses this letter for the visa. It shows the student's details, the programme, fees paid and your contact person.</p>
      <div class="row" style="gap:10px;flex-wrap:wrap">${F('student_uni_id', 'Student ID *', `<input class="input" name="student_uni_id" maxlength="50" value="${esc(df.student_uni_id || '')}">`)}${F('programme_start', 'Programme start *', '<input class="input" type="date" name="programme_start">')}${F('programme_end', 'Expected end', '<input class="input" type="date" name="programme_end">')}${F('duration', 'Duration', '<input class="input" name="duration" placeholder="e.g. 2 years" maxlength="40">')}</div>
      <div class="row" style="gap:10px;flex-wrap:wrap">${F('total_fees', 'Total tuition fee *', `<input class="input" type="number" min="0" step="0.01" name="total_fees" value="${esc(df.tuition ?? '')}">`)}${F('fee_period', 'Fee period', '<input class="input" name="fee_period" placeholder="first year" maxlength="40">')}${F('fees_paid', 'Fees paid', `<input class="input" type="number" min="0" step="0.01" name="fees_paid" value="${esc(df.paid_to_date || '')}">`, 'Default: total of your receipts')}${F('payment_date', 'Last payment date', '<input class="input" type="date" name="payment_date">')}${F('currency', 'Currency', `<select class="input" name="currency">${opt(['EUR', 'USD', 'GBP', 'CNY', 'SEK', 'CHF', 'INR'], df.currency || 'EUR')}</select>`)}</div>
      <div class="row" style="gap:10px;flex-wrap:wrap">${F('reporting_date', 'Reporting / arrival date', '<input class="input" type="date" name="reporting_date">')}${F('accommodation', 'Accommodation (optional)', '<input class="input" name="accommodation" maxlength="500">')}${F('format', 'Format', `<select class="input" name="format">${opt(FMT, df.format)}</select>`)}</div>
      <p class="small"><b>Contact person on the letter</b> (from Letters &amp; bank details, change here only for this letter):</p>
      <div class="row" style="gap:10px;flex-wrap:wrap">${F('contact_name', 'Name', `<input class="input" name="contact_name" value="${esc(c.name || '')}">`)}${F('contact_designation', 'Designation', `<input class="input" name="contact_designation" value="${esc(c.designation || '')}">`)}${F('contact_email', 'Email', `<input class="input" name="contact_email" value="${esc(c.email || '')}">`)}${F('contact_phone', 'Phone', `<input class="input" name="contact_phone" value="${esc(c.phone || '')}">`)}</div>
      ${F('note', 'Closing note (optional)', '<input class="input" name="note" maxlength="500">')}</form>`, foot: '<button class="btn primary" data-s>Generate and send final LOA</button>' });
    $('[data-s]', m.el).onclick = async () => { const f = $('form', m.el); try { const r = await upost(`/applications/${v.id}/student/loa`, Object.fromEntries(new FormData(f))); m.close(); toast(`Final LOA ${r.loa_no} sent to the student`, 'ok'); reload(); } catch (e) { showError(e, f); } };
  });
  on('[data-agr]', () => docDialog('agreement')); on('[data-doc]', () => docDialog('document'));
}

// 1-click documents (top of every application): everything is filled automatically from the application, the offer, the course and
// Letters & bank details. "Preview" opens the PDF without sending; "Generate & send" stores it and sends it to the student (copy for La Europa).
const DOC_ICON = { offer_conditional: '🎓', offer_unconditional: '🎓', loa: '🛂', invoice: '🧾', receipt: '✅' };
export async function oneClick(host, v) {
  const d = await uget(`/applications/${v.id}/docs`);
  const s = d.summary;
  host.innerHTML = `<div class="card" style="border:1px solid var(--indigo-line);box-shadow:0 0 0 4px var(--indigo-soft)"><div class="hd"><h2>📄 Documents in 1 click</h2><span class="grow"></span>
      <span class="small">Format: <select class="input" data-fmt style="width:auto;display:inline-block;height:30px;padding:2px 6px">${opt(d.formats.map(f => [f.id, `${f.id}. ${f.name}`]), d.format)}</select></span></div>
    <div class="bd"><div class="small muted" style="margin-bottom:10px">Filled automatically: student ID <b>${esc(d.student_uni_id)}</b> · tuition <b>${money(s.tuition, s.currency)}</b>${s.scholarship ? ` · scholarship <b>${money(s.scholarship, s.currency)}</b>` : ''}${s.deposit ? ` · deposit <b>${money(s.deposit, s.currency)}</b>` : ''} · paid <b>${money(s.paid, s.currency)}</b>${s.programme_start ? ` · start <b>${esc(fmtDate(s.programme_start))}</b>` : ''}${s.conditions ? ` · ${s.conditions} open condition(s)` : ''}. <a href="#/letters">Change letterhead, fees, bank, colour</a></div>
      ${!d.settings_ok ? '<div class="banner warn" style="margin-bottom:10px">Your <a href="#/letters">Letters &amp; bank details</a> are not complete (signatory and bank account). Documents will be generated, but fill them once for complete letters.</div>' : ''}
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px">${d.docs.map(x => `<div class="card" style="padding:10px;${x.ready ? '' : 'opacity:.55'}"><div><span style="font-size:18px">${DOC_ICON[x.key]}</span> <b>${esc(x.label)}</b></div>
        <div class="small muted" style="margin:4px 0 8px">${x.ready ? (x.last ? 'Last sent ' + esc(fmtDate(x.last)) : 'Not sent yet') : (x.key === 'loa' ? 'After an unconditional offer' : 'After an offer')}</div>
        <div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn xs" data-pv="${x.key}" ${x.ready ? '' : 'disabled'}>Preview</button>${d.can_send ? `<button class="btn xs primary" data-send="${x.key}" ${x.ready ? '' : 'disabled'}>Generate &amp; send</button>` : ''}</div></div>`).join('')}</div></div></div>`;
  const fmt = () => $('[data-fmt]', host).value;
  const amountFor = (key) => { if (key !== 'receipt') return ''; const doc = d.docs.find(x => x.key === 'receipt'); if (!doc.needs_amount) return null; const a = prompt(`Amount received (${s.currency})`); return a === null ? undefined : a; };
  $$('[data-pv]', host).forEach(b => b.onclick = async () => { const amt = amountFor(b.dataset.pv); if (amt === undefined) return; window.open(`/api/university/applications/${v.id}/docs/${b.dataset.pv}/preview?format=${fmt()}${amt ? '&amount=' + encodeURIComponent(amt) : ''}`, '_blank', 'noopener'); });
  $$('[data-send]', host).forEach(b => b.onclick = async () => { const key = b.dataset.send; const amt = amountFor(key); if (amt === undefined) return;
    if (!confirm(`Generate the ${d.docs.find(x => x.key === key).label} and send it to ${v.student_name}?`)) return;
    b.disabled = true; try { const r = await upost(`/applications/${v.id}/docs/${key}/send`, { format: fmt(), ...(amt ? { amount: amt } : {}) }); toast(`${r.no} sent to the student`, 'ok'); go(location.hash); } catch (e) { toast(e.message, 'err'); b.disabled = false; } });
}

// counsellor-like board: all your applicants by status, what was sent and what is waiting
export async function pipeline(q = {}) {
  const d = await uget('/pipeline');
  const main = $('.main'); const cols = d.statuses.filter(s => s !== 'Withdrawn');
  const search = String(q.q || '').toLowerCase();
  const rows = d.rows.filter(r => !search || `${r.student} ${r.code} ${r.course}`.toLowerCase().includes(search));
  main.innerHTML = `<div class="page-head"><div><h1>Student pipeline</h1><div class="sub">Every student who applied through La Europa, by status. Open a card to act, message the student or send documents.</div></div><span class="grow"></span>
      <input class="input" id="pq" type="search" placeholder="Search student, application ID or course" value="${esc(q.q || '')}" style="max-width:280px"></div>
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:12px">${cols.map(s => `<span class="small">${ustatus(s)} <b>${rows.filter(r => r.status === s).length}</b></span>`).join('')}</div>
    <div class="kanban">${cols.map(s => `<div class="kcol" style="min-width:240px;max-width:280px"><div class="kh">${ustatus(s)} <span class="small muted">${rows.filter(r => r.status === s).length}</span></div>
      ${rows.filter(r => r.status === s).map(r => `<a class="kcard card" href="#/applications/${r.id}?tab=student" style="display:block;padding:10px;margin-top:8px;color:inherit;text-decoration:none">
        <b>${esc(r.student)}</b>${r.unread_student ? ` <span class="badge red">${r.unread_student} new</span>` : ''}<div class="small muted">${esc(r.code)}</div><div class="small">${esc(r.course || '')} · ${esc(r.intake || '')}</div>
        ${r.invoice ? `<div class="small">🧾 ${money(r.invoice.amount, r.invoice.currency)}${r.invoice.due_date ? ' due ' + esc(fmtDate(r.invoice.due_date)) : ''}</div>` : ''}${r.agreement ? `<div class="small">✍ Agreement: ${esc(r.agreement)}</div>` : ''}
        ${r.last_sent ? `<div class="small muted">Last sent: ${esc(r.last_sent.kind)} · ${esc(fmtDate(r.last_sent.at))}</div>` : ''}</a>`).join('') || '<div class="small muted" style="padding:8px">None</div>'}</div>`).join('')}</div>`;
  const pq = $('#pq'); pq.onchange = () => go('#/pipeline' + (pq.value ? '?q=' + encodeURIComponent(pq.value) : ''));
}
