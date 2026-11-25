// UP04 dashboard, UP09 inbox, UP10 detail + UP12 action dialogs, UP11 messages
import { us, uget, upost, uput, udel, uapi, download, esc, $, $$, toast, modal, opt, fmtDate, fmtDT, ago, money, qs, ustatus, canAct, isAdmin, showError } from './u.js';
import { go } from './main.js';

// ---------- dashboard ----------
export async function dashboard(q = {}) {
  const d = await uget('/dashboard' + qs(q));
  const main = $('.main');
  const maxI = Math.max(1, ...Object.values(d.intakes).map(o => Object.values(o).reduce((a, b) => a + b, 0)));
  const COL = { New: 'var(--sky)', Acknowledged: 'var(--indigo)', 'Documents requested': 'var(--warning)', 'Under assessment': 'var(--violet)', 'Interview scheduled': 'var(--royal)', Waitlisted: 'var(--line-2)', 'Conditional offer': 'var(--warning-ink)',
    'Unconditional offer': 'var(--teal)', Rejected: 'var(--error)', 'Offer accepted': 'var(--success-ink)', 'Deposit received': 'var(--info)', Enrolled: 'var(--ink-2)', Withdrawn: 'var(--line)' };
  const fmax = Math.max(1, ...d.funnel.map(f => f.count));
  main.innerHTML = `<div class="page-head"><h1>Dashboard</h1><span class="grow"></span><span class="small muted">Applications La Europa submitted to you</span></div>
    <form class="filters" id="df"><select name="intake"><option value="">All intakes</option>${opt(d.filters.intakes, q.intake)}</select><select name="course"><option value="">All courses</option>${opt(d.filters.courses.map(c => [c.id, c.name]), q.course)}</select>
      <select name="level"><option value="">All levels</option>${opt(['Bachelor', 'Master', 'MBA', 'PhD', 'Diploma', 'Foundation', 'Language course'], q.level)}</select>${d.filters.campuses.length > 1 ? `<select name="campus"><option value="">All campuses</option>${opt(d.filters.campuses, q.campus)}</select>` : ''}
      <input type="date" name="from" value="${esc(q.from || '')}" title="Submitted from"><input type="date" name="to" value="${esc(q.to || '')}" title="Submitted to"></form>
    <div class="stats uni-stats">${d.cards.filter(c => c.key !== 'withdrawn').map(c => `<a class="stat" href="#/applications${qs({ status: c.statuses.join(','), intake: q.intake, course: q.course })}"><div class="lbl">${esc(c.label)}</div><div class="val">${c.count}</div><div class="chg ${c.week ? 'up' : ''}">+${c.week} this week</div></a>`).join('')}</div>
    <div class="small muted" style="margin:6px 0 14px">Withdrawn: ${d.cards.find(c => c.key === 'withdrawn').count} (not counted above)</div>
    <div class="grid uni-dash"><div class="grid" style="gap:14px">
      <div class="card"><div class="hd"><h2>Applications by intake</h2></div><div class="bd">${Object.keys(d.intakes).length ? Object.entries(d.intakes).map(([k, o]) => { const tot = Object.values(o).reduce((a, b) => a + b, 0);
        return `<div class="sbar"><span class="sl">${esc(k)}</span><div class="st" style="width:${tot / maxI * 100}%">${Object.entries(o).map(([s, n]) => `<a href="#/applications${qs({ status: s })}" title="${esc(s)}: ${n}" style="flex:${n};background:${COL[s] || 'var(--muted)'}"></a>`).join('')}</div><b class="small">${tot}</b></div>`; }).join('')
        + `<div class="legend">${Object.entries(COL).map(([s, c]) => `<span><i style="background:${c}"></i>${esc(s)}</span>`).join('')}</div>` : '<div class="empty">No applications yet</div>'}</div></div>
      <div class="card"><div class="hd"><h2>Conversion funnel</h2>${d.decision_days !== null ? `<span class="grow"></span><span class="small muted">Average ${d.decision_days} days to first decision</span>` : ''}</div><div class="bd">
        ${d.funnel.map((f, i) => `<div class="fun"><span>${esc(f.label)}</span><div><i style="width:${f.count / fmax * 100}%"></i></div><b>${f.count}</b><small>${i && d.funnel[0].count ? Math.round(f.count / d.funnel[0].count * 100) + '%' : ''}</small></div>`).join('')}</div></div>
      <div class="grid two"><div class="card"><div class="hd"><h2>Students by state (India)</h2></div><div class="bd flush"><table class="tbl"><tbody>${d.states.map(s => `<tr><td>${esc(s.state)}</td><td class="right"><b>${esc(s.count)}</b></td></tr>`).join('') || '<tr><td class="empty">-</td></tr>'}</tbody></table></div></div>
        <div class="card"><div class="hd"><h2>Top courses</h2></div><div class="bd flush"><table class="tbl"><tbody>${d.top_courses.map(s => `<tr><td>${esc(s.course)}</td><td class="right"><b>${s.count}</b></td></tr>`).join('') || '<tr><td class="empty">-</td></tr>'}</tbody></table></div></div></div>
    </div><div class="card"><div class="hd"><h2>Pending actions</h2></div><div class="bd flush">${d.pending.length ? d.pending.map(p => `<a class="pend ${p.red ? 'red' : ''}" href="${esc(p.link)}">${esc(p.label)}<span>›</span></a>`).join('') : '<div class="empty">Nothing waiting. Well done!</div>'}</div></div></div>`;
  $$('#df select, #df input').forEach(i => i.onchange = () => { const v = Object.fromEntries(new FormData($('#df'))); go('#/dashboard' + qs(v)); });
}

// ---------- inbox ----------
export async function inbox(q = {}) {
  const d = await uget('/applications' + qs(q));
  const f = await uget('/dashboard');
  const main = $('.main'); const sel = new Set();
  main.innerHTML = `<div class="page-head"><h1>Applications</h1><span class="muted small">${d.total} application(s)</span><span class="grow"></span>
      ${canAct() ? '<button class="btn" data-ack disabled>Acknowledge selected</button>' : ''}<button class="btn" data-exp>Export (Excel)</button></div>
    <form class="filters" id="fi"><input type="search" name="q" placeholder="Student, application ID or your reference" value="${esc(q.q || '')}">
      <select name="status"><option value="">All statuses</option>${opt(d.statuses, q.status)}</select><select name="intake"><option value="">All intakes</option>${opt(f.filters.intakes, q.intake)}</select>
      <select name="course"><option value="">All courses</option>${opt(f.filters.courses.map(c => [c.id, c.name]), q.course)}</select>
      <select name="sort">${opt([['submitted', 'Newest first'], ['days', 'Days in status'], ['intake', 'Intake'], ['student', 'Student name']], q.sort || 'submitted')}</select>
      <label class="row small" style="gap:4px"><input type="checkbox" name="docreq" value="1" ${q.docreq ? 'checked' : ''}> Open document request</label><label class="row small" style="gap:4px"><input type="checkbox" name="unread" value="1" ${q.unread ? 'checked' : ''}> Unread messages</label>
      <select name="pending_days"><option value="">Any decision age</option>${opt([['7', 'Pending > 7 days'], ['14', 'Pending > 14 days'], ['30', 'Pending > 30 days']], q.pending_days)}</select></form>
    <div class="card"><div class="table-wrap"><table class="tbl uni-inbox"><thead><tr>${canAct() ? '<th><input type="checkbox" data-all></th>' : ''}<th>Application</th><th>Student</th><th>Course</th><th>Intake</th><th>Submitted</th><th>Status</th><th>Days</th><th>Your ref.</th><th></th></tr></thead><tbody>
    ${d.rows.map(x => `<tr class="${x.late ? 'row-danger' : x.answered ? 'row-info' : ''}" data-id="${x.id}">${canAct() ? `<td><input type="checkbox" data-sel="${x.id}" ${x.status !== 'New' ? 'disabled' : ''}></td>` : ''}
      <td data-label="Application"><a href="#/applications/${x.id}"><b>${esc(x.application_code)}</b></a></td><td data-label="Student">${esc(x.student_name)}</td><td data-label="Course">${esc(x.course)}<div class="small muted">${esc(x.level)}${x.campus ? ' · ' + esc(x.campus) : ''}</div></td>
      <td data-label="Intake">${esc(x.intake)}</td><td data-label="Submitted" class="small">${esc(fmtDate(x.submitted_at))}</td><td data-label="Status">${ustatus(x.status)}</td><td data-label="Days">${x.days_in_status}</td>
      <td data-label="Ref." class="small">${esc(x.university_ref || '-')}</td><td class="nowrap">${x.unread ? `<span class="badge blue" title="Unread messages">✉ ${x.unread}</span>` : ''}${x.open_request ? ' <span class="badge orange" title="Open document request">📄</span>' : ''}</td></tr>`).join('') || `<tr><td colspan="10" class="empty">No applications match</td></tr>`}</tbody></table></div>
    <div class="row between" style="padding:10px 14px"><span class="small muted">Page ${d.page} of ${Math.max(1, Math.ceil(d.total / d.size))}</span><div class="row" style="gap:6px"><select class="input" data-size style="width:auto">${opt([25, 50, 100], String(d.size))}</select>
      <button class="btn sm" data-prev ${d.page <= 1 ? 'disabled' : ''}>‹ Prev</button><button class="btn sm" data-next ${d.page * d.size >= d.total ? 'disabled' : ''}>Next ›</button></div></div></div>
    <p class="small muted">Light red = new for more than 3 working days. Light blue = La Europa answered a document request you have not opened yet.</p>`;
  const setQ = (p) => go('#/applications' + qs({ ...q, ...p }));
  $$('#fi select, #fi input[type=checkbox]').forEach(i => i.onchange = () => { const v = Object.fromEntries(new FormData($('#fi'))); go('#/applications' + qs(v)); });
  $('#fi input[name=q]').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); setQ({ q: e.target.value, page: '' }); } };
  $('[data-prev]').onclick = () => setQ({ page: d.page - 1 }); $('[data-next]').onclick = () => setQ({ page: d.page + 1 }); $('[data-size]').onchange = (e) => setQ({ size: e.target.value, page: '' });
  $$('tr[data-id]').forEach(tr => tr.ondblclick = () => go('#/applications/' + tr.dataset.id));
  const ackBtn = $('[data-ack]');
  $$('[data-sel]').forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.sel) : sel.delete(c.dataset.sel); if (ackBtn) { ackBtn.disabled = !sel.size; ackBtn.textContent = `Acknowledge selected${sel.size ? ' (' + sel.size + ')' : ''}`; } });
  const all = $('[data-all]'); if (all) all.onchange = () => $$('[data-sel]:not([disabled])').forEach(c => { c.checked = all.checked; c.onchange(); });
  if (ackBtn) ackBtn.onclick = async () => { const r = await upost('/applications/bulk-acknowledge', { ids: [...sel] }); toast(`${r.count} acknowledged`, 'ok'); go(location.hash); };
  $('[data-exp]').onclick = () => download('/applications/export.xlsx' + qs({ ...q, ids: sel.size ? [...sel].join(',') : '' }), 'applications.xlsx');
}

// ---------- detail ----------
const ACTION_LABEL = { acknowledge: 'Acknowledge', doc_request: 'Request documents', interview: 'Schedule interview', interview_result: 'Record interview result', under_assessment: 'Mark under assessment',
  conditional_offer: 'Issue conditional offer', unconditional_offer: 'Issue unconditional offer', conditions_met: 'Mark conditions met', reject: 'Reject', waitlist: 'Waitlist', offer_letter: 'Upload offer letter',
  deposit: 'Mark deposit received', enrolled: 'Mark enrolled', cas: 'Upload CAS / acceptance letter', correction: 'Correct a decision' };
const PRIMARY = ['acknowledge', 'conditional_offer', 'unconditional_offer', 'conditions_met', 'deposit', 'enrolled'];
export async function detail(id, q = {}) {
  const v = await uget('/applications/' + id);
  const main = $('.main');
  if (v.access_ended) { main.innerHTML = `<div class="page-head"><a class="btn ghost sm" href="#/applications">← Applications</a></div><div class="card"><div class="bd"><h2>${esc(v.application_code)}</h2><p>${esc(v.course)} · ${esc(v.intake)} · ${ustatus(v.status)}</p><div class="banner">Access period ended. Only the summary is available.</div></div></div>`; return; }
  const tab = q.tab || 'summary';
  const acts = (v.allowed || []).filter(a => ACTION_LABEL[a]);
  main.innerHTML = `<div class="page-head"><a class="btn ghost sm" href="#/applications">← Applications</a></div>
    ${v.withdrawn_at ? `<div class="banner warn">Withdrawn by La Europa on ${esc(fmtDate(v.withdrawn_at))}. This application is read-only.</div>` : ''}
    ${v.flags.docs_requested ? '<div class="banner warn">Documents requested from La Europa: waiting for their answer.</div>' : ''}
    <div class="card uni-head"><div class="bd"><div class="row" style="gap:16px;align-items:flex-start;flex-wrap:wrap"><div class="grow" style="min-width:260px">
      <div class="small muted">${esc(v.application_code)} · submitted ${esc(fmtDate(v.submitted_at))} · ${v.days_in_status} day(s) in status</div><h1 style="margin:4px 0">${esc(v.student_name)}</h1>
      <div>${esc(v.course)} (${esc(v.level)})${v.campus ? ' · ' + esc(v.campus) : ''} · <b>${esc(v.intake)}</b></div>
      <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">${ustatus(v.status)}${v.flags.waitlisted ? '<span class="badge grey">Waitlisted</span>' : ''}
        <span class="small">Your reference: <b data-ref>${esc(v.university_ref || '-')}</b> ${canAct() && !v.withdrawn_at ? '<a href="#" data-editref class="small">edit</a>' : ''}</span></div>
      <div class="small muted" style="margin-top:8px">La Europa contact: ${v.la_europa_contacts.map(c => `${esc(c.name)} (${esc(c.email)}${c.phone ? ', ' + esc(c.phone) : ''})`).join('; ') || '-'}${v.partner_manager ? ` · Partner manager: ${esc(v.partner_manager.name)}` : ''}</div></div>
      <div class="uni-actions">${acts.length ? acts.map(a => `<button class="btn ${PRIMARY.includes(a) ? 'primary' : a === 'reject' ? 'danger' : ''} sm" data-act="${a}">${ACTION_LABEL[a]}</button>`).join('') : `<span class="small muted">${us.me.role === 'viewer' ? 'View only' : 'No actions in this status'}</span>`}</div></div></div></div>
    <div id="oneclick" style="margin-top:12px"></div>
    <div class="tabs" style="margin:12px 0">${[['summary', 'Summary'], ['form', 'Application form'], ['academic', 'Academic'], ['english', 'English and experience'], ['documents', 'Documents'], ['messages', `Messages${v.unread ? ' (' + v.unread + ')' : ''}`], ['student', 'Student (direct)'], ['timeline', 'Timeline']]
      .map(([k, l]) => `<a href="#/applications/${id}?tab=${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div><div id="tb"></div>`;
  const tb = $('#tb');
  const et = $('[data-editref]'); if (et) et.onclick = async (e) => { e.preventDefault(); const val = prompt('Your reference number (max 50)', v.university_ref || ''); if (val === null) return; await uput(`/applications/${id}/reference`, { university_ref: val }); go(location.hash); };
  $$('[data-act]').forEach(b => b.onclick = () => actionDialog(v, b.dataset.act));
  if (!v.withdrawn_at) import('./direct.js').then(D => D.oneClick($('#oneclick'), v)).catch(() => {});
  if (tab === 'summary') {
    const i = v.identity;
    tb.innerHTML = `<div class="grid two"><div class="card"><div class="hd"><h2>Student (as in passport)</h2></div><div class="bd"><div class="kv">
      <div><div class="k">First name</div><div class="v">${esc(i.first_name)}</div></div><div><div class="k">Middle name</div><div class="v">${esc(i.middle_name || '-')}</div></div><div><div class="k">Last name</div><div class="v">${esc(i.last_name || '-')}</div></div>
      <div><div class="k">Gender</div><div class="v">${esc(i.gender || '-')}</div></div><div><div class="k">Date of birth</div><div class="v">${esc(fmtDate(i.dob))}</div></div><div><div class="k">Nationality</div><div class="v">${esc(i.nationality || '-')}</div></div>
      <div><div class="k">Passport</div><div class="v">${esc(i.passport || '-')}${i.passport_masked && i.passport ? ' <span class="small muted">(masked)</span>' : ''}</div></div><div><div class="k">Passport expiry</div><div class="v">${esc(fmtDate(i.passport_expiry))}</div></div>
      <div><div class="k">Residence</div><div class="v">${esc([i.city, i.state, i.country].filter(Boolean).join(', '))}</div></div></div>
      ${v.contact ? `<div class="banner" style="margin-top:12px">Contact (shared by La Europa): ${esc(v.contact.phone)} · ${esc(v.contact.email)}</div>` : `<p class="small muted" style="margin-top:12px">${esc(v.contact_note)}</p>`}
      ${v.visa_outcome ? `<p class="small">Visa: <b>${esc(v.visa_outcome.outcome)}</b> (${esc(fmtDate(v.visa_outcome.date))})</p>` : ''}</div></div>
      <div class="grid" style="gap:14px"><div class="card"><div class="hd"><h2>Academic summary</h2></div><div class="bd"><p style="margin:0;line-height:1.7">${esc(v.summary_line).split(' | ').map(x => `<span class="chip-line">${x}</span>`).join(' ')}</p></div></div>
        ${v.cover_note ? `<div class="card"><div class="hd"><h2>Cover note from La Europa</h2></div><div class="bd" style="white-space:pre-wrap">${esc(v.cover_note)}</div></div>` : ''}
        ${v.offer ? `<div class="card"><div class="hd"><h2>Current offer</h2></div><div class="bd small">${esc((v.offer.type || '').replace('_', ' '))}${v.offer.deadline ? ` · acceptance deadline ${esc(fmtDate(v.offer.deadline))}` : ''}
          ${v.offer.fee ? `<div>Tuition: ${money(v.offer.fee.total_amount, v.offer.fee.currency)}${v.offer.fee.deposit_required ? ` · deposit ${money(v.offer.fee.deposit_required, v.offer.fee.currency)}` : ''}</div>` : ''}
          ${v.offer.conditions.length ? `<ul>${v.offer.conditions.map(c => `<li>${esc(c.text)} <span class="badge ${c.status === 'Open' ? 'orange' : 'green'}">${esc(c.status)}</span></li>`).join('')}</ul>` : ''}
          ${v.offer.letters.length ? `<div class="muted">Letters: ${v.offer.letters.map(l => `${esc(l.type)} (${esc(fmtDate(l.issue_date))})`).join(', ')}</div>` : ''}</div></div>` : ''}
        ${v.interview ? `<div class="card"><div class="hd"><h2>Interview</h2></div><div class="bd small">${esc(fmtDT(v.interview.at))} · ${esc(v.interview.link || '')}</div></div>` : ''}
        <div class="card"><div class="hd"><h2>Received by La Europa</h2></div><div class="bd small">${v.received.length ? v.received.map(x => `<div>${esc(x.label)} · ${esc(fmtDT(x.created_at))} ${x.received ? '<span class="badge green">✓ Received by La Europa</span>' : '<span class="badge grey">Sent</span>'}</div>`).join('') : 'No actions yet'}</div></div>
      </div></div>`;
  }
  if (tab === 'academic') tb.innerHTML = `<div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Level</th><th>Course</th><th>Board / university</th><th>Score</th><th>% equivalent</th><th>Year</th><th>Backlogs (total / active)</th></tr></thead><tbody>
    ${v.academic.map(a => `<tr><td data-label="Level"><b>${esc(a.level)}</b></td><td data-label="Course">${esc(a.course || '-')}</td><td data-label="Board">${esc(a.board || '-')}</td><td data-label="Score">${esc(a.score ?? '-')} ${esc(a.scale === '%' ? '%' : a.scale)}</td>
      <td data-label="%">${a.percent !== null && a.percent !== undefined ? esc(a.percent) + '%' : '-'}</td><td data-label="Year">${esc(a.year || '-')}</td><td data-label="Backlogs">${esc(a.backlogs_total ?? '-')} / ${esc(a.backlogs_active ?? '-')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No records</td></tr>'}</tbody></table></div></div>
    <p class="small muted">% equivalent of CGPA uses La Europa's conversion factor.</p>`;
  if (tab === 'english') tb.innerHTML = `<div class="grid two"><div class="card"><div class="hd"><h2>English tests</h2></div><div class="table-wrap"><table class="tbl"><thead><tr><th>Test</th><th>Overall</th><th>L / R / W / S</th><th>Date</th><th>TRF / ref.</th></tr></thead><tbody>
    ${v.english.map(t => `<tr><td>${esc(t.test)}</td><td><b>${esc(t.overall ?? '-')}</b></td><td>${[t.listening, t.reading, t.writing, t.speaking].map(x => esc(x ?? '-')).join(' / ')}</td><td>${esc(fmtDate(t.date))}</td><td>${esc(t.trf || '-')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No test</td></tr>'}</tbody></table></div></div>
    <div class="card"><div class="hd"><h2>Work experience</h2><span class="grow"></span><span class="small muted">${esc(v.work_total || '')}</span></div><div class="bd">${v.work.map(w => `<div class="rowx"><b>${esc(w.company)}</b> · ${esc(w.designation)}<div class="small muted">${esc(mm(w.from))} to ${w.till_date ? 'till date' : esc(mm(w.to))}</div></div>`).join('') || '<div class="empty">No work experience</div>'}</div></div></div>`;
  if (tab === 'documents') await docsTab(tb, v);
  if (tab === 'messages') await thread(tb, id, v);
  if (tab === 'student') await (await import('./direct.js')).studentTab(tb, v);
  if (tab === 'form') { tb.innerHTML = `<div class="row" style="margin-bottom:10px"><span class="small muted grow">Filled by the student, the agent or La Europa in one common form. Contact and finance details stay with La Europa.</span><a class="btn sm primary" href="/api/university/applications/${id}/application-form.pdf" target="_blank" rel="noopener">⬇ Download PDF</a></div><div class="card"><div class="bd" id="uif"></div></div>`;
    const F = await import('/js/infoform.js'); await F.renderInfoForm($('#uif'), { mode: 'university', load: () => uget(`/applications/${id}/application-form`) }); }
  if (tab === 'timeline') tb.innerHTML = `<div class="card"><div class="bd"><ul class="tl">${v.timeline.map(e => `<li><span class="dot"></span><div><b>${esc(e.text)}</b>${e.by ? ` <span class="small muted">by ${esc(e.by)}</span>` : ''}${e.received ? ' <span class="badge green">Received by La Europa</span>' : ''}<div class="small muted">${e.info ? '' : esc(fmtDT(e.at))}</div></div></li>`).join('')}</ul></div></div>
    <div class="card" style="margin-top:12px"><div class="hd"><h2>Document requests</h2></div><div class="bd">${requests(v)}</div></div>`;
  $$('[data-cancelreq]').forEach(b => b.onclick = async () => { const reason = prompt('Reason for cancelling the request'); if (!reason) return; try { await upost(`/applications/${id}/requests/${b.dataset.cancelreq}/cancel`, { reason }); go(location.hash); } catch (e) { toast(e.message, 'err'); } });
}
const mm = (ym) => ym ? String(ym).split('-').reverse().join('/') : '';
function requests(v) {
  return v.requests.length ? v.requests.map(r => `<div class="req"><div class="row between"><b>${esc(fmtDate(r.created_at))}: ${esc(r.status)}</b>${['Open', 'Partly fulfilled'].includes(r.status) && canAct() ? `<button class="btn xs" data-cancelreq="${r.id}">Cancel request</button>` : ''}</div>
    <div class="small" style="white-space:pre-wrap">${esc(r.message)}</div>${r.needed_by ? `<div class="small muted">Needed by ${esc(fmtDate(r.needed_by))}</div>` : ''}
    <ul class="small">${r.items.map(i => `<li>${esc(i.name)}${i.note ? ' (' + esc(i.note) + ')' : ''}: <b>${esc(i.status)}</b>${i.reply ? ' - ' + esc(i.reply) : ''}</li>`).join('')}</ul></div>`).join('') : '<div class="empty small">No document requests</div>';
}
async function docsTab(tb, v) {
  const d = await uget(`/applications/${v.id}/documents`);
  if (d.hidden) { tb.innerHTML = '<div class="card"><div class="bd muted">Your role does not have access to student documents.</div></div>'; return; }
  if (d.access_ended) { tb.innerHTML = '<div class="card"><div class="bd muted">Access period ended.</div></div>'; return; }
  tb.innerHTML = `<div class="row" style="gap:8px;margin-bottom:10px">${d.zip && d.shared.length ? '<button class="btn sm" data-zip>Download all (ZIP)</button>' : ''}${canAct() && !v.withdrawn_at ? '<button class="btn sm primary" data-up>+ Upload document</button>' : ''}<span class="grow"></span>
    <span class="small muted">Files are watermarked with your email and every view / download is logged.</span></div>
    <div class="grid two"><div class="card"><div class="hd"><h2>Shared by La Europa</h2></div><div class="bd flush">${d.shared.map(x => `<div class="doc-row"><div class="grow"><b>${esc(x.name)}</b>
      ${x.versions.map(ver => `<div class="small">v${ver.version_no} · ${esc(ver.status)}${ver.updated ? ` · Updated by La Europa on ${esc(fmtDate(ver.shared_at))}` : ''} ${ver.active ? `<a href="#" data-view="${ver.share_id}">View</a> · <a href="#" data-dl="${ver.share_id}">Download</a>` : ''}</div>`).join('')}</div></div>`).join('') || '<div class="empty">No documents shared yet</div>'}</div></div>
    <div class="card"><div class="hd"><h2>Uploaded by your university</h2></div><div class="bd flush">${d.uploads.map(x => `<div class="doc-row"><div class="grow"><b>${esc(x.name)}</b>
      ${x.versions.map(ver => `<div class="small">v${ver.version_no} · ${esc(ver.status)} · ${esc(ver.by)} ${esc(fmtDate(ver.uploaded_at))} ${ver.active ? `<a href="#" data-vv="${ver.version_id}">View</a>` : ''} ${ver.can_remove ? `· <a href="#" data-rm="${ver.version_id}" class="text-red">Remove</a>` : ''}</div>`).join('')}</div></div>`).join('') || '<div class="empty">Nothing uploaded yet</div>'}</div></div></div>
    <div class="card" style="margin-top:12px"><div class="hd"><h2>Document requests</h2></div><div class="bd">${requests(v)}</div></div>`;
  const link = async (body) => { const r = await upost(`/applications/${v.id}/documents/link`, body); window.open(r.url, '_blank', 'noopener'); };
  $$('[data-view]', tb).forEach(a => a.onclick = (e) => { e.preventDefault(); link({ share_id: a.dataset.view }).catch(er => toast(er.message, 'err')); });
  $$('[data-dl]', tb).forEach(a => a.onclick = (e) => { e.preventDefault(); link({ share_id: a.dataset.dl, download: true }).catch(er => toast(er.message, 'err')); });
  $$('[data-vv]', tb).forEach(a => a.onclick = (e) => { e.preventDefault(); link({ version_id: a.dataset.vv }).catch(er => toast(er.message, 'err')); });
  $$('[data-rm]', tb).forEach(a => a.onclick = async (e) => { e.preventDefault(); if (!confirm('Remove this upload?')) return; try { await udel(`/applications/${v.id}/documents/version/${a.dataset.rm}`); go(location.hash); } catch (er) { toast(er.message, 'err'); } });
  const z = $('[data-zip]', tb); if (z) z.onclick = async () => { z.disabled = true; z.textContent = 'Preparing...'; try { const r = await upost(`/applications/${v.id}/documents/zip`); window.location.href = r.url; } catch (er) { toast(er.message, 'err'); } finally { z.disabled = false; z.textContent = 'Download all (ZIP)'; } };
  const up = $('[data-up]', tb); if (up) up.onclick = () => {
    const m = modal({ title: 'Upload a document', body: `<form novalidate><div class="f" data-k="document_type"><label>Document type</label><select class="input" name="document_type">${opt(d.upload_types)}</select><div class="msg"></div></div>
      <div class="f" data-k="title"><label>Title (for "Other")</label><input class="input" name="title" maxlength="150"><div class="msg"></div></div>
      <div class="f" data-k="file"><label>File (PDF for invoices; PDF / JPG / PNG for others, max 10 MB)</label><input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png"><div class="msg"></div></div>
      <div class="f"><label>Note for La Europa</label><input class="input" name="note" maxlength="500"></div></form>
      <p class="small muted">Offer letters, interview results, deposit receipts, enrolment and visa letters are uploaded with their actions.</p>`, foot: '<button class="btn" data-c>Cancel</button><button class="btn primary" data-s>Upload</button>' });
    $('[data-c]', m.el).onclick = () => m.close();
    $('[data-s]', m.el).onclick = async () => { const fd = new FormData($('form', m.el)); try { await uapi('POST', `/applications/${v.id}/documents/upload`, fd); m.close(); toast('Sent to La Europa', 'ok'); go(location.hash); } catch (er) { showError(er, $('form', m.el)); } };
  };
}

// ---------- action dialogs (UP12) ----------
function actionDialog(v, act) {
  const F = (k, label, input, help) => `<div class="f" data-k="${k}"><label>${label}</label>${input}${help ? `<div class="help">${help}</div>` : ''}<div class="msg"></div></div>`;
  const inp = (k, type = 'text', extra = '') => `<input class="input" name="${k}" type="${type}" ${extra}>`;
  const ta = (k, max) => `<textarea class="input" name="${k}" rows="3" maxlength="${max}" style="height:auto;padding:8px"></textarea>`;
  const cur = (k) => `<select class="input" name="${k}" style="width:110px">${opt(['EUR', 'USD', 'GBP', 'CNY', 'SEK', 'CHF', 'INR'], 'EUR')}</select>`;
  const money2 = (k, label, req) => F(k, label + (req ? ' *' : ''), `<div class="row" style="gap:6px">${inp(k, 'number', 'min="0" step="0.01"')}${k === 'tuition' || k === 'amount' || k === 'final_tuition' ? cur('currency') : ''}</div>`, 'Amount only. Do not write words like non-EU, international or foreign.');
  const today = new Date().toISOString().slice(0, 10);
  let body = ''; let multipart = false;
  if (act === 'acknowledge') body = F('reference', 'Your reference number', inp('reference', 'text', 'maxlength="50"')) + F('expected_decision', 'Expected decision date', inp('expected_decision', 'date', `min="${today}"`)) + F('note', 'Note to La Europa', ta('note', 1000));
  if (act === 'under_assessment') body = '<p>Mark this application as under assessment. La Europa will see the update.</p>';
  if (act === 'doc_request') body = `<div data-k="items" class="f"><label>Documents needed *</label><div data-items></div><button type="button" class="btn xs" data-additem>+ Add document</button><div class="msg"></div></div>
    ${F('message', 'Message to La Europa *', ta('message', 2000), 'This goes to the La Europa counsellor, not to the student.')}${F('needed_by', 'Needed by', inp('needed_by', 'date', `min="${today}"`))}
    <label class="row small" style="gap:6px"><input type="checkbox" name="pause" checked> Pause decision until received</label>`;
  if (act === 'interview') body = F('at', 'Interview date and time *', inp('at', 'datetime-local'), `Your local time (${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}). La Europa sees it in IST too.`) + F('mode', 'Mode *', `<select class="input" name="mode">${opt(['Online video', 'Phone', 'In person', 'Written / online test'])}</select>`)
    + F('link', 'Link or address', inp('link', 'text', 'maxlength="300"'), 'Shared with the student only through La Europa.') + F('duration', 'Duration (minutes)', inp('duration', 'number', 'min="10" max="240"'))
    + F('instructions', 'Instructions for the student', ta('instructions', 1000)) + F('note', 'Note to La Europa', ta('note', 1000)) + (v.status === 'Interview scheduled' ? F('reason', 'Reason for rescheduling *', inp('reason')) : '');
  if (act === 'interview_result') { multipart = true; body = F('result', 'Result *', `<select class="input" name="result">${opt(['Passed', 'Not passed', 'Pending', 'No show'])}</select>`) + F('feedback', 'Feedback for La Europa', ta('feedback', 1000)) + F('file', 'Result file (PDF, optional)', '<input type="file" name="file" accept=".pdf">'); }
  if (act === 'conditional_offer' || act === 'unconditional_offer') { multipart = true; body = `<label class="row" style="gap:6px;margin-bottom:8px;font-weight:600"><input type="checkbox" name="generate" checked> Generate the ${act === 'conditional_offer' ? 'conditional' : 'unconditional'} offer letter for me (PDF from this form)</label>`
    + `<div class="row" style="gap:10px;flex-wrap:wrap">${F('format', 'Letter format', `<select class="input" name="format">${opt([[1, '1. Classic formal'], [2, '2. Modern header band'], [3, '3. European with reference block'], [4, '4. Compact one-page'], [5, '5. Detailed with terms']])}</select>`, '<a href="#/letters" target="_blank">Preview formats</a>')}${F('student_uni_id', 'Student ID (your university)', inp('student_uni_id', 'text', 'maxlength="50"'))}</div>`
    + F('file', 'Or upload your own offer letter (PDF, max 10 MB)', '<input type="file" name="file" accept=".pdf">', 'Untick "Generate" above to use your own file.') + F('letter_note', 'Extra text for the generated letter (optional)', ta('letter_note', 1500))
    + `<label class="row small" style="gap:6px;margin-bottom:8px"><input type="checkbox" name="letter_to_follow"> Offer letter to follow on</label>${F('letter_date', 'Letter will follow on', inp('letter_date', 'date', `min="${today}"`))}`
    + (act === 'conditional_offer' ? `<div class="f" data-k="conditions"><label>Conditions *</label><div data-conds></div><button type="button" class="btn xs" data-addcond>+ Add condition</button><div class="msg"></div></div>` : '')
    + money2('tuition', 'Tuition fee for first year', true) + money2('scholarship', 'Scholarship / waiver') + F('scholarship_text', 'Scholarship description', inp('scholarship_text', 'text', 'maxlength="200"'))
    + money2('deposit', 'Deposit required to confirm seat') + F('deposit_deadline', 'Deposit deadline', inp('deposit_deadline', 'date')) + F('acceptance_deadline', 'Offer acceptance deadline', inp('acceptance_deadline', 'date', `min="${today}"`))
    + F('programme_start', 'Programme start date', inp('programme_start', 'date')) + F('note', 'Note to La Europa', ta('note', 1000)); }
  if (act === 'conditions_met') { multipart = true; body = `<p>Mark each condition as met or waived.</p>${(v.offer && v.offer.conditions || []).map(c => `<div class="row" style="gap:8px;margin:4px 0"><span class="grow small">${esc(c.text)}</span><select class="input" style="width:110px" data-cond="${c.id}">${opt(['Met', 'Waived'])}</select></div>`).join('')}`
    + `<label class="row" style="gap:6px;margin:8px 0;font-weight:600"><input type="checkbox" name="generate" checked> Generate the unconditional offer letter for me</label>` + F('format', 'Letter format', `<select class="input" name="format">${opt([[1, '1. Classic formal'], [2, '2. Modern header band'], [3, '3. European with reference block'], [4, '4. Compact one-page'], [5, '5. Detailed with terms']])}</select>`) + money2('tuition', 'Tuition fee for first year') + money2('deposit', 'Deposit') + F('file', 'Or upload your own unconditional offer letter (PDF)', '<input type="file" name="file" accept=".pdf">'); }
  if (act === 'reject') body = F('reason', 'Reason *', `<select class="input" name="reason"><option value="">Select...</option>${opt(v.reject_reasons)}</select>`) + F('details', 'Details for La Europa', ta('details', 1000), 'Never shown to the student unless La Europa decides to.')
    + `<label class="row small" style="gap:6px;margin:6px 0"><input type="checkbox" name="share_reason"> La Europa may share the reason with the student</label>` + F('suggest_course_id', 'Suggest another course', `<select class="input" name="suggest_course_id"><option value="">No suggestion</option>${opt(v.courses.map(c => [c.id, `${c.name} (${c.level})`]))}</select>`);
  if (act === 'waitlist') body = F('note', 'Reason / note to La Europa *', ta('note', 1000)) + F('expected_decision', 'Expected decision date', inp('expected_decision', 'date', `min="${today}"`)) + F('position', 'Waitlist position', inp('position', 'number', 'min="1"'));
  if (act === 'offer_letter') { multipart = true; body = F('file', 'Offer letter (PDF) *', '<input type="file" name="file" accept=".pdf">') + F('letter_type', 'Letter type *', `<select class="input" name="letter_type">${opt(['Conditional', 'Unconditional', 'Revised'])}</select>`) + F('issue_date', 'Issue date', inp('issue_date', 'date')) + F('note', 'Note', inp('note')); }
  if (act === 'deposit') { multipart = true; body = money2('amount', 'Amount received', true) + F('date', 'Date received *', inp('date', 'date', `max="${today}"`)) + F('reference', 'Payment reference', inp('reference')) + F('file', 'Receipt / confirmation (PDF / JPG / PNG)', '<input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png">') + money2('balance', 'Remaining balance'); }
  if (act === 'enrolled') { multipart = true; body = F('enrol_date', 'Enrolment date *', inp('enrol_date', 'date', `max="${today}"`)) + F('student_uni_id', 'Student university ID / matriculation number', inp('student_uni_id', 'text', 'maxlength="50"')) + F('programme_start', 'Programme start date *', inp('programme_start', 'date'))
    + money2('final_tuition', 'Final first-year tuition fee', true) + money2('scholarship', 'Scholarship / waiver applied') + F('file', 'Enrolment proof (PDF)', '<input type="file" name="file" accept=".pdf">'); }
  if (act === 'cas') { multipart = true; body = F('letter_type', 'Letter type *', `<select class="input" name="letter_type">${opt(['Acceptance / admission letter for visa', 'CAS', 'Pre-enrolment or visa support letter', 'JW201 / JW202 (China)', 'Other'])}</select>`) + F('file', 'File (PDF) *', '<input type="file" name="file" accept=".pdf">')
    + F('reference', 'Reference number', inp('reference')) + F('issue_date', 'Issue date', inp('issue_date', 'date')) + F('valid_until', 'Valid until', inp('valid_until', 'date')); }
  if (act === 'correction') body = `<div class="banner warn">Use this only to correct a mistake. La Europa reviews every correction before the student is told.</div>` + F('status', 'Correct status *', `<select class="input" name="status"><option value="">Select...</option>${opt(['Acknowledged', 'Documents requested', 'Under assessment', 'Interview scheduled', 'Waitlisted', 'Conditional offer', 'Unconditional offer', 'Rejected', 'Deposit received', 'Enrolled'].filter(s => s !== v.status))}</select>`) + F('reason', 'Reason *', ta('reason', 1000));
  const m = modal({ title: ACTION_LABEL[act], size: ['conditional_offer', 'unconditional_offer', 'doc_request'].includes(act) ? 'lg' : '', body: `<form novalidate>${body}</form><p class="small muted">${esc(v.student_name)} · ${esc(v.application_code)} · current status ${esc(v.status)}</p>`,
    foot: `<button class="btn" data-c>Cancel</button><button class="btn ${act === 'reject' ? 'danger solid' : 'primary'}" data-s>${ACTION_LABEL[act]}</button>` });
  const form = $('form', m.el);
  const addItem = () => { const row = document.createElement('div'); row.className = 'row'; row.style.cssText = 'gap:6px;margin-bottom:6px'; row.innerHTML = `<input class="input" placeholder="Document needed (e.g. Course descriptions)" data-it-title maxlength="150"><input class="input" placeholder="Note" data-it-note maxlength="300"><button type="button" class="btn xs ghost">✕</button>`; $('button', row).onclick = () => row.remove(); $('[data-items]', form).appendChild(row); };
  const addCond = () => { const row = document.createElement('div'); row.className = 'row'; row.style.cssText = 'gap:6px;margin-bottom:6px;flex-wrap:wrap'; row.innerHTML = `<input class="input grow" placeholder="Condition" data-c-text maxlength="500"><select class="input" data-c-type style="width:130px">${opt(['Academic', 'English', 'Document', 'Financial', 'Other'])}</select><input class="input" type="date" data-c-due style="width:150px"><button type="button" class="btn xs ghost">✕</button>`; $('button', row).onclick = () => row.remove(); $('[data-conds]', form).appendChild(row); };
  if ($('[data-additem]', form)) { $('[data-additem]', form).onclick = addItem; addItem(); }
  if ($('[data-addcond]', form)) { $('[data-addcond]', form).onclick = addCond; addCond(); }
  // fees, format and student ID come from Letters & bank details (filled once)
  if (['conditional_offer', 'unconditional_offer', 'conditions_met'].includes(act)) uget(`/applications/${v.id}/student/defaults`).then(df => { const set = (k, val) => { const el = form.elements[k]; if (el && (el.value === '' || el.tagName === 'SELECT') && val !== null && val !== undefined && val !== '') el.value = val; };
    set('format', df.format); set('student_uni_id', df.student_uni_id); set('tuition', df.tuition); set('deposit', df.deposit); set('currency', df.currency);
    if (form.elements.acceptance_deadline && !form.elements.acceptance_deadline.value) form.elements.acceptance_deadline.value = new Date(Date.now() + df.validity_days * 864e5).toISOString().slice(0, 10); }).catch(() => {});
  $('[data-c]', m.el).onclick = () => m.close();
  $('[data-s]', m.el).onclick = async () => {
    const btn = $('[data-s]', m.el); btn.disabled = true;
    try {
      const raw = Object.fromEntries(new FormData(form)); raw.version = v.version;
      for (const k of ['pause', 'share_reason', 'letter_to_follow', 'generate']) if (form.elements[k]) raw[k] = form.elements[k].checked;
      if (raw.generate && raw.file instanceof File && raw.file.size) raw.generate = false; // an uploaded file wins
      if (act === 'doc_request') raw.items = $$('[data-items] .row', form).map(r => ({ title: $('[data-it-title]', r).value.trim(), note: $('[data-it-note]', r).value.trim() })).filter(i => i.title);
      if ($('[data-conds]', form)) raw.conditions = $$('[data-conds] .row', form).map(r => ({ text: $('[data-c-text]', r).value.trim(), type: $('[data-c-type]', r).value, due: $('[data-c-due]', r).value || null })).filter(c => c.text);
      if (act === 'conditions_met') raw.conditions = $$('[data-cond]', form).map(s => ({ id: s.dataset.cond, result: s.value }));
      if (act === 'interview' && raw.at) { raw.at = new Date(raw.at).toISOString(); raw.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; }
      let body2 = raw;
      if (multipart) { body2 = new FormData(); for (const [k, val] of Object.entries(raw)) { if (val instanceof File) { if (val.size) body2.append(k, val); } else if (typeof val === 'object' && val !== null) body2.append(k, JSON.stringify(val)); else if (val !== undefined && val !== '') body2.append(k, val); } }
      if (act === 'reject' && !confirm('Reject this application? La Europa will review it before the student is told.')) { btn.disabled = false; return; }
      await uapi('POST', `/applications/${v.id}/actions/${act}`, body2);
      m.close(); toast(`${ACTION_LABEL[act]}: sent to La Europa`, 'ok'); go(location.hash);
    } catch (e) { if (e.status === 409) { toast(e.message, 'err'); } showError(e, form); btn.disabled = false; }
  };
}

// ---------- messages ----------
async function thread(el, key, v) {
  const d = await uget('/messages/' + key);
  if (d.access_ended) { el.innerHTML = '<div class="card"><div class="bd muted">Access period ended.</div></div>'; return; }
  el.innerHTML = `<div class="card"><div class="bd"><div class="small muted" style="margin-bottom:8px">Messages with La Europa Education only. The student never sees this thread.</div>
    <div class="uthread">${d.rows.map(m => `<div class="umsg ${m.mine ? 'me' : 'le'}"><div class="who">${esc(m.side)}${m.sender ? ' · ' + esc(m.sender) : ''}</div>
      <div class="bub">${m.deleted ? '<i class="muted">message deleted</i>' : esc(m.body || '').replace(/\n/g, '<br>').replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')}
      ${m.attachments.map(a => `<div><a href="/api/university/messages/attachment/${a.id}">📎 ${esc(a.original_name)}</a></div>`).join('')}</div>
      <div class="when">${esc(fmtDT(m.sent_at))}${m.edited ? ' · edited' : ''}${m.mine && m.seen ? ` · Seen by La Europa ${esc(ago(m.seen))}` : ''}${m.can_edit ? ` · <a href="#" data-del="${m.id}">delete</a>` : ''}</div></div>`).join('') || '<div class="empty">No messages yet</div>'}</div>
    ${d.can_post ? `<form class="ucompose" id="mf"><textarea class="input" name="body" rows="2" maxlength="5000" placeholder="Write to La Europa..." style="height:auto;padding:8px"></textarea>
      <div class="row" style="gap:8px;margin-top:6px"><input type="file" name="files" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xlsx,.csv"><span class="grow"></span><button class="btn primary">Send</button></div></form>` : '<p class="small muted">View only.</p>'}</div></div>`;
  const th = $('.uthread', el); th.scrollTop = th.scrollHeight;
  $$('[data-del]', el).forEach(a => a.onclick = async (e) => { e.preventDefault(); await uput('/messages/m/' + a.dataset.del, { delete: true }); go(location.hash); });
  const f = $('#mf'); if (f) f.onsubmit = async (e) => { e.preventDefault(); const fd = new FormData(f); if (!fd.get('body') && !f.files.files.length) return; try { await uapi('POST', '/messages/' + key, fd); go(location.hash); } catch (er) { toast(er.message, 'err'); } };
}
export async function messages(q = {}) {
  const d = await uget('/messages' + qs(q));
  const main = $('.main'); const key = q.t || (d.rows[0] && d.rows[0].uapp_id);
  main.innerHTML = `<div class="page-head"><h1>Messages</h1><span class="grow"></span><label class="row small" style="gap:4px"><input type="checkbox" data-f="unread" ${q.unread ? 'checked' : ''}> Unread</label><label class="row small" style="gap:4px;margin-left:10px"><input type="checkbox" data-f="waiting" ${q.waiting ? 'checked' : ''}> Waiting for La Europa</label></div>
    <div class="grid uni-msgs"><div class="card"><div class="bd flush">${d.rows.map(t => `<a class="thr ${t.uapp_id === key ? 'on' : ''}" href="#/messages${qs({ ...q, t: t.uapp_id })}"><div class="row between"><b>${esc(t.application_code)}</b>${t.unread ? `<span class="badge blue">${t.unread}</span>` : ''}</div>
      <div class="small">${esc(t.student_name)}</div><div class="small muted">${esc(t.last_text || '')}</div></a>`).join('')}</div></div><div data-th></div></div>`;
  $$('[data-f]').forEach(c => c.onchange = () => go('#/messages' + qs({ ...q, [c.dataset.f]: c.checked ? '1' : '' })));
  if (key) await thread($('[data-th]'), key);
}
