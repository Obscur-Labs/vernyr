// UP17 reports, UP15/UP16 finance, UP03 users, UP18 my account, notifications
import { us, uget, upost, uput, uapi, download, esc, $, $$, toast, modal, opt, fmtDate, fmtDT, ago, money, qs, isAdmin, showError, formHtml, readForm, setErrors } from './u.js';
import { go, refreshMe } from './main.js';
import { showBackup } from './auth.js';

export async function reports(q = {}) {
  const [r, dash] = await Promise.all([uget('/reports'), uget('/dashboard')]);
  const type = q.type || 'by_intake';
  const d = await uget(`/reports/${type}` + qs({ ...q, type: undefined }));
  const main = $('.main');
  main.innerHTML = `<div class="page-head"><h1>Reports</h1></div>
    <div class="tabs" style="margin-bottom:10px">${r.reports.map(([k, l]) => `<a href="#/reports${qs({ ...q, type: k })}" class="${k === type ? 'on' : ''}">${l}</a>`).join('')}</div>
    <form class="filters" id="rf"><select name="intake"><option value="">All intakes</option>${opt(dash.filters.intakes, q.intake)}</select><select name="course"><option value="">All courses</option>${opt(dash.filters.courses.map(c => [c.id, c.name]), q.course)}</select>
      <select name="level"><option value="">All levels</option>${opt(['Bachelor', 'Master', 'MBA', 'PhD', 'Diploma', 'Foundation', 'Language course'], q.level)}</select>
      ${type === 'list' && r.contact_option ? `<label class="row small" style="gap:4px"><input type="checkbox" name="contact" value="1" ${q.contact ? 'checked' : ''}> Include contact details (logged)</label>` : ''}
      <span class="grow"></span>${r.can_export ? '<button type="button" class="btn sm" data-x="xlsx">Export Excel</button><button type="button" class="btn sm" data-x="pdf">Export PDF</button>' : ''}</form>
    <div class="card"><div class="table-wrap"><table class="tbl"><thead><tr>${d.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${d.rows.map(row => `<tr>${row.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${d.columns.length}" class="empty">No data</td></tr>`}</tbody></table></div></div>
    <p class="small muted">Only applications La Europa submitted to you. Counts below 5 in location reports show as "fewer than 5" to protect students.</p>`;
  $$('#rf select, #rf input').forEach(i => i.onchange = () => go('#/reports' + qs({ ...Object.fromEntries(new FormData($('#rf'))), type })));
  $$('[data-x]').forEach(b => b.onclick = () => download(`/reports/${type}` + qs({ ...Object.fromEntries(new FormData($('#rf'))), format: b.dataset.x }), `${type}.${b.dataset.x}`));
}

export async function finance() {
  const d = await uget('/finance');
  const main = $('.main');
  const ST = { Invoiced: 'blue', 'Partially paid': 'orange', Paid: 'green', Overdue: 'red', Cancelled: 'grey' };
  main.innerHTML = `<div class="page-head"><h1>Commission and invoices</h1><span class="grow"></span><span class="small muted">Visible only to users with finance access</span></div>
    ${d.rules.length ? `<div class="card" style="margin-bottom:12px"><div class="hd"><h2>Agreed commission terms</h2></div><div class="bd small">${d.rules.map(x => `<div><b>${esc(x.name)}</b>: ${esc(x.basis)}${x.rate ? ` · ${x.rate}%` : ''}${x.fixed ? ` · ${esc(x.fixed)}` : ''} · due ${esc(x.due)}</div>`).join('')}</div></div>` : ''}
    ${d.expected ? `<div class="card" style="margin-bottom:12px"><div class="hd"><h2>Expected commission (not yet invoiced)</h2></div><div class="bd small">${d.expected.map(x => `<div>${esc(x.status)}: ${x.n} line(s), ${money(x.total, x.currency)}</div>`).join('') || 'None'}</div></div>` : ''}
    ${d.agreement && d.agreement.length ? `<div class="card" style="margin-bottom:12px"><div class="hd"><h2>Partner agreement</h2></div><div class="bd small">${d.agreement.map(a => `<div><b>${esc(a.agreement_code)}</b> ${esc(a.title)} · ${esc(fmtDate(a.start_date))} to ${esc(a.end_date ? fmtDate(a.end_date) : 'until terminated')} · <span class="badge">${esc(a.status)}</span>
      <div class="muted">Signed by ${esc(a.signed_by_le)} (${esc(a.party)}) and ${esc(a.signed_by_uni)} on ${esc(fmtDate(a.signed_on))}</div>${a.has_pdf ? `<a href="/api/university/agreements/${a.id}/pdf" target="_blank" rel="noopener">View PDF</a>` : ''}</div>`).join('')}</div></div>` : ''}
    <div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Invoice</th><th>Date</th><th>Total</th><th>Due</th><th>Paid</th><th>Balance</th><th>Status</th><th></th></tr></thead><tbody>
    ${d.invoices.map(i => `<tr><td><b>${esc(i.invoice_no)}</b>${i.kind === 'credit_note' ? ' <span class="badge grey">Credit note</span>' : ''}${i.query_open ? ' <span class="badge orange">Query open</span>' : ''}</td><td>${esc(fmtDate(i.invoice_date))}</td><td>${money(i.total, i.currency)}</td><td>${esc(fmtDate(i.due_date))}</td>
      <td>${money(i.paid, i.currency)}</td><td><b>${money(i.balance, i.currency)}</b></td><td><span class="badge ${ST[i.status] || 'grey'}">${esc(i.status)}</span></td>
      <td class="nowrap"><button class="btn xs" data-open="${i.id}">Details</button> <button class="btn xs" data-pdf="${i.id}" data-no="${esc(i.invoice_no)}">PDF</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">No invoices yet</td></tr>'}</tbody></table></div></div>`;
  $$('[data-pdf]').forEach(b => b.onclick = () => download(`/finance/invoices/${b.dataset.pdf}/pdf`, `${b.dataset.no}.pdf`));
  $$('[data-open]').forEach(b => b.onclick = async () => {
    const i = d.invoices.find(x => x.id === b.dataset.open);
    const qs0 = await uget(`/finance/invoices/${i.id}/queries`);
    const open = ['Invoiced', 'Partially paid', 'Overdue'].includes(i.status) && i.kind === 'invoice';
    const m = modal({ title: `${i.invoice_no}: ${i.status}`, size: 'lg', body: `<table class="tbl"><thead><tr><th>Student</th><th>Application</th><th>Course / intake</th><th>Amount</th></tr></thead><tbody>${i.lines.map(l => `<tr><td>${esc(l.student_name)}</td><td>${esc(l.application_code || '-')}</td><td>${esc(l.course)} (${esc(l.intake)})</td><td>${money(l.amount, l.currency)}</td></tr>`).join('')}</tbody></table>
      <h3>Payments</h3>${i.payments.map(p => `<div class="small">${money(p.amount, p.currency)} on ${esc(fmtDate(p.payment_date))} · ref ${esc(p.reference || '-')} · <b>${esc(p.status)}</b>${p.reject_reason ? ' - ' + esc(p.reject_reason) : ''}</div>`).join('') || '<div class="small muted">None yet</div>'}
      ${open && !us.me.preview ? `<h3>Upload payment proof</h3><form id="pf" class="form-grid" novalidate>${formHtml([{ k: 'amount', label: `Amount paid (${i.currency})`, type: 'number', req: true, col: 2 }, { k: 'payment_date', label: 'Payment date', type: 'date', req: true, col: 2 }, { k: 'reference', label: 'Bank reference / transaction ID', req: true, col: 2 },
        { k: 'proof', label: 'Proof (PDF / JPG / PNG)', type: 'file', accept: '.pdf,.jpg,.jpeg,.png', col: 3 }, { k: 'note', label: 'Note', col: 3 }], { amount: i.balance })}</form><button class="btn primary sm" data-pay>Submit payment proof</button>` : ''}
      <h3>Questions about this invoice</h3>${qs0.map(q => `<div class="req"><b>Query ${esc(q.status)}</b>${q.messages.map(mm => `<div class="small"><b>${esc(mm.sender)}:</b> ${esc(mm.body)} <span class="muted">${esc(fmtDT(mm.sent_at))}</span></div>`).join('')}</div>`).join('')}
      ${us.me.preview ? '' : `<div class="row" style="gap:6px;margin-top:6px"><select class="input" id="ql" style="width:220px"><option value="">Whole invoice</option>${i.lines.map(l => `<option value="${l.id}">${esc(l.student_name)}</option>`).join('')}</select><input class="input grow" id="qb" placeholder="For example: Student not enrolled"><button class="btn sm" data-q>Raise query</button></div>
      <p class="small muted">A query pauses payment reminders until La Europa closes it.</p>`}` });
    const pay = $('[data-pay]', m.el); if (pay) pay.onclick = async () => { const f = $('#pf', m.el); const fd = new FormData(f); try { const r0 = await uapi('POST', `/finance/invoices/${i.id}/payments`, fd); if (r0.warning) toast(r0.warning, ''); toast('Payment proof sent. La Europa will confirm it.', 'ok'); m.close(); go(location.hash); } catch (e) { showError(e, f); } };
    const qb = $('[data-q]', m.el); if (qb) qb.onclick = async () => { const open0 = qs0.find(x => x.status === 'Open'); try { await upost(`/finance/invoices/${i.id}/queries`, { body: $('#qb', m.el).value, commission_id: $('#ql', m.el).value || null, query_id: open0 && open0.id }); toast('Query sent to La Europa', 'ok'); m.close(); } catch (e) { toast(e.message, 'err'); } };
  });
}

export async function users() {
  const d = await uget('/users');
  const main = $('.main');
  const RL = [['admin', 'University Admin'], ['officer', 'Admissions Officer'], ['viewer', 'University Viewer']];
  main.innerHTML = `<div class="page-head"><h1>Users</h1><span class="muted small">${d.rows.filter(u => u.status !== 'Inactive').length} of ${d.max} allowed</span><span class="grow"></span><button class="btn primary" data-add>+ Add user</button></div>
    <label class="row small" style="gap:6px;margin-bottom:10px"><input type="checkbox" data-op ${d.officers_propose ? 'checked' : ''}> Admissions Officers can propose course changes</label>
    <div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Finance</th><th>Status</th><th>Last login</th><th></th></tr></thead><tbody>
    ${d.rows.map(u => `<tr><td><b>${esc(u.name)}</b>${u.main ? ' <span class="badge blue">Main contact</span>' : ''}</td><td class="small">${esc(u.email)}</td><td>${esc(u.role_label)}</td><td>${u.finance ? '✓' : ''}</td>
      <td><span class="badge ${u.status === 'Active' ? 'green' : u.status === 'Invited' ? 'orange' : 'grey'}">${esc(u.status)}</span></td><td class="small">${esc(u.last_login_at ? ago(u.last_login_at) : '-')}</td>
      <td class="nowrap"><button class="btn xs" data-ed="${u.id}">Edit</button> <select class="input" data-act="${u.id}" style="width:auto;height:28px;font-size:12px"><option value="">More...</option>${u.status === 'Invited' ? '<option value="resend">Resend invite</option>' : ''}
        ${u.status === 'Inactive' ? '<option value="activate">Activate</option>' : '<option value="deactivate">Deactivate</option>'}<option value="logout">Force logout</option></select></td></tr>`).join('')}</tbody></table></div></div>
    <div class="card" style="margin-top:14px"><div class="hd"><h2>Activity of your users</h2></div><div class="table-wrap" style="max-height:340px;overflow:auto"><table class="tbl"><tbody>${d.activity.map(a => `<tr><td class="small nowrap">${esc(fmtDT(a.created_at))}</td><td class="small">${esc(a.user || '-')}</td><td class="small">${esc(a.action)} ${esc(a.entity_type || '')}</td><td class="small muted">${esc(a.entity_label || '')}</td><td class="small muted">${esc(a.ip || '')}</td></tr>`).join('') || '<tr><td class="empty">No activity yet</td></tr>'}</tbody></table></div></div>`;
  $('[data-op]').onchange = async (e) => { await uput('/settings/officers-propose', { on: e.target.checked }); toast('Saved', 'ok'); };
  const form = (u) => {
    const m = modal({ title: u ? 'Edit user' : 'Add user', body: `<form class="form-grid" novalidate>${formHtml([{ k: 'name', label: 'Full name', req: true, col: 3 }, ...(u ? [] : [{ k: 'email', label: 'Work email (login)', type: 'email', req: true, col: 3 }]),
      { k: 'role', label: 'Role', type: 'select', noBlank: true, opts: RL, col: 3 }, { k: 'finance', label: 'Finance access (commission and invoices)', type: 'checkbox', col: 3 }, { k: 'department', label: 'Department', type: 'select', opts: ['Admissions', 'International Office', 'Finance', 'Faculty', 'Management', 'Other'], col: 3 },
      { k: 'phone', label: 'Phone', col: 3 }, { k: 'campuses', label: 'Campuses (empty = all)', type: 'multi', opts: d.campuses, col: 6 }, { k: 'alerts', label: 'Email alerts', type: 'multi', opts: [['applications', 'New applications'], ['messages', 'Messages'], ['deadlines', 'Deadlines and reminders'], ['finance', 'Finance']], col: 6 }],
      u ? { ...u, alerts: u.alerts || ['applications', 'messages', 'deadlines', 'finance'] } : { role: 'officer', alerts: ['applications', 'messages', 'deadlines'] })}</form>${u ? '' : '<p class="small muted">The user gets an invite email. Personal work emails only; shared mailboxes should not be used.</p>'}`,
      foot: `<button class="btn" data-c>Cancel</button><button class="btn primary" data-s>${u ? 'Save' : 'Add and invite'}</button>` });
    $('[data-c]', m.el).onclick = () => m.close();
    $('[data-s]', m.el).onclick = async () => { const f = $('form', m.el); const b = readForm(f); try { const r0 = u ? await uput('/users/' + u.id, b) : await upost('/users', b); if (r0.warning) toast(r0.warning, ''); m.close(); go(location.hash); } catch (e) { showError(e, f); } };
  };
  $('[data-add]').onclick = () => form(null);
  $$('[data-ed]').forEach(b => b.onclick = () => form(d.rows.find(u => u.id === b.dataset.ed)));
  $$('[data-act]').forEach(s => s.onchange = async () => { const a = s.value; if (!a) return; if (a === 'deactivate' && !confirm('Are you sure?')) { s.value = ''; return; }
    try { await upost(`/users/${s.dataset.act}/${a}`); toast('Done', 'ok'); go(location.hash); } catch (e) { toast(e.message, 'err'); s.value = ''; } });
}

export async function account() {
  const d = await uget('/account');
  const me = d.me; const main = $('.main');
  main.innerHTML = `<div class="page-head"><h1>My account</h1></div><div class="grid two"><div class="grid" style="gap:14px">
    <div class="card"><div class="hd"><h2>Profile</h2></div><div class="bd"><form id="pf" class="form-grid" novalidate>${formHtml([{ k: 'name', label: 'Full name', req: true, col: 6 }, { k: 'designation', label: 'Designation', col: 3 }, { k: 'phone', label: 'Phone', col: 3 }], me)}</form>
      <div class="small muted">${esc(me.email)} · ${esc(me.role_label)} · ${esc(me.university.name)}</div><div class="form-actions"><button class="btn primary" data-sp>Save</button></div></div></div>
    <div class="card"><div class="hd"><h2>Email alerts</h2></div><div class="bd"><form id="af">${[['applications', 'New applications'], ['messages', 'Messages from La Europa'], ['deadlines', 'Deadlines and reminders'], ['finance', 'Finance (invoices)']].map(([k, l]) => `<label class="row" style="gap:8px;padding:4px 0"><input type="checkbox" name="${k}" ${!me.alerts || me.alerts.includes(k) ? 'checked' : ''} ${me.main_contact && (k === 'applications' || (k === 'finance' && me.finance)) ? 'disabled checked' : ''}> ${l}</label>`).join('')}</form>
      ${me.main_contact ? '<p class="small muted">As main contact you always receive new-application and invoice emails.</p>' : ''}<div class="form-actions"><button class="btn primary" data-sa>Save</button></div></div></div>
    <div class="card"><div class="hd"><h2>Change password</h2></div><div class="bd"><form id="cp" class="form-grid" novalidate>${formHtml([{ k: 'current', label: 'Current password', type: 'password', req: true, col: 6 }, { k: 'password', label: 'New password (min 10, letter, number, symbol)', type: 'password', autocomplete: 'new-password', req: true, col: 3 }, { k: 'confirm', label: 'Confirm', type: 'password', autocomplete: 'new-password', req: true, col: 3 }], {})}</form>
      <div class="form-actions"><button class="btn primary" data-cp>Change password</button></div></div></div></div>
    <div class="grid" style="gap:14px"><div class="card"><div class="hd"><h2>Active devices</h2><span class="grow"></span><button class="btn sm" data-lo>Log out of all other devices</button></div><div class="bd flush">${d.sessions.map(s => `<div class="rowx"><b>${/Mobile|Android|iPhone/i.test(s.user_agent) ? 'Phone' : 'Computer'}</b> ${s.current ? '<span class="badge green">This device</span>' : ''}<div class="small muted">Last active ${esc(ago(s.last_seen_at))} · ${esc(s.ip || '')}</div></div>`).join('')}</div></div>
    <div class="card"><div class="hd"><h2>Accepted terms</h2></div><div class="bd small">${d.consents.map(c => `<div>${c.doc_type === 'uni_terms' ? 'Portal Terms of Use' : 'Data Processing terms'} v${esc(c.version || '')} · ${esc(fmtDT(c.created_at))}</div>`).join('') || '-'}</div></div></div></div>`;
  $('[data-sp]').onclick = async () => { const f = $('#pf'); try { await uput('/account', readForm(f)); toast('Saved', 'ok'); refreshMe(); } catch (e) { showError(e, f); } };
  $('[data-sa]').onclick = async () => { await uput('/account', { alerts: $$('#af input:checked').map(i => i.name) }); toast('Saved', 'ok'); };
  $('[data-cp]').onclick = async () => { const f = $('#cp'); try { await uput('/account/password', readForm(f)); toast('Password changed. Other devices were logged out.', 'ok'); f.reset(); } catch (e) { showError(e, f); } };
  $('[data-lo]').onclick = async () => { await upost('/account/logout-others'); toast('Done', 'ok'); go(location.hash); };
}

export async function notifications() {
  const d = await uget('/notifications');
  $('.main').innerHTML = `<div class="page-head"><h1>Notifications</h1><span class="grow"></span><button class="btn sm" data-all>Mark all read</button></div>
    <div class="card"><div class="bd flush">${d.rows.map(n => `<a class="notif ${n.is_read ? '' : 'unread'}" href="${esc(n.link || '#/notifications')}" data-id="${n.id}">${esc(n.title)}<div class="when">${esc(fmtDT(n.created_at))}</div></a>`).join('') || '<div class="empty">No notifications</div>'}</div></div>`;
  $('[data-all]').onclick = async () => { await upost('/notifications/read', { all: true }); notifications(); };
  $$('[data-id]').forEach(a => a.addEventListener('click', () => upost('/notifications/read', { ids: [a.dataset.id] })));
}
