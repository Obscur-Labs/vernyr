// UP05 profile, UP06/UP07 courses, UP08 bulk upload, UP14 intakes + scholarships, UP13 announcements
import { us, uget, upost, uput, uapi, download, esc, $, $$, toast, modal, opt, fmtDate, fmtDT, money, qs, isAdmin, canAct, showError, setErrors } from './u.js';
import { go } from './main.js';

const F = (k, label, input, help, col = 6) => `<div class="f c${col}" data-k="${k}"><label>${label}</label>${input}${help ? `<div class="help">${help}</div>` : ''}<div class="msg"></div></div>`;
const val = (v) => esc(v ?? '');

// ---------- profile ----------
export async function profile() {
  const d = await uget('/profile');
  const main = $('.main'); const L = d.live; const P = d.pending ? { ...L, ...d.pending.payload } : L;
  main.innerHTML = `<div class="page-head"><h1>University profile</h1><span class="grow"></span>${d.can_edit ? '<button class="btn primary" data-edit>Edit profile</button>' : ''}</div>
    ${d.pending ? `<div class="banner warn">Changes waiting for La Europa approval (sent ${esc(fmtDate(d.pending.created_at))}). Students keep seeing the current profile. <a href="#" data-pend>View pending changes</a>${d.can_edit ? ' · <a href="#" data-wd>Withdraw</a>' : ''}</div>` : ''}
    ${d.last_decision && d.last_decision.status === 'Rejected' ? `<div class="banner err">Last change request was rejected: ${esc(d.last_decision.review_note || '')}</div>` : ''}
    <div class="grid two"><div class="card"><div class="bd"><div class="row" style="gap:14px"><img class="cs-logo lg" src="${esc(L.logo)}" alt=""><div><h2 style="margin:0">${esc(L.name)}</h2><div class="muted">${esc(L.short_name || '')} · ${esc(L.city || '')}, ${esc(L.country)} · ${esc(L.uni_type || '')}</div>
      ${L.website ? `<a href="${esc(L.website)}" target="_blank" rel="noopener">${esc(L.website)}</a>` : ''}</div></div>
      <div class="about" style="margin-top:12px">${L.about || '<span class="muted">No description yet</span>'}</div>
      <div class="kv" style="margin-top:12px"><div><div class="k">Founded</div><div class="v">${val(L.founded_year || '-')}</div></div><div><div class="k">Students</div><div class="v">${val(L.students_count || '-')}</div></div><div><div class="k">Languages</div><div class="v">${esc((L.languages || []).join(', ') || '-')}</div></div></div>
      ${(L.rankings || []).length ? `<h3>Rankings <span class="small muted">(information provided by the university)</span></h3><ul>${L.rankings.map(x => `<li>${esc(x.name)} ${esc(x.year || '')}: ${esc(x.rank || '')}</li>`).join('')}</ul>` : ''}
      ${(L.accreditations || []).length ? `<h3>Accreditations <span class="small muted">(information provided by the university)</span></h3><ul>${L.accreditations.map(x => `<li>${esc(x.name)}${x.body ? ', ' + esc(x.body) : ''}</li>`).join('')}</ul>` : ''}
      <p class="small muted">Students see the approved name, logo, city, country, type, website, about, languages, rankings and accreditations. Contacts are never shown to students.</p></div></div>
    <div class="grid" style="gap:14px"><div class="card"><div class="hd"><h2>Campuses</h2><span class="grow"></span>${d.can_edit ? '<button class="btn sm" data-camp>+ Add campus</button>' : ''}</div><div class="bd flush">
      ${d.campuses.map(c => `<div class="rowx"><div class="grow"><b>${esc(c.name)}</b> ${c.is_main ? '<span class="badge blue">Main</span>' : ''} ${c.status === 'Inactive' ? '<span class="badge grey">Inactive</span>' : ''}<div class="small muted">${esc(c.city)}${c.address ? ', ' + esc(c.address) : ''}</div></div>${d.can_edit ? `<button class="btn xs" data-ec="${c.id}">Edit</button>` : ''}</div>`).join('') || '<div class="empty">No campus yet</div>'}</div></div>
      <div class="card"><div class="hd"><h2>Contacts by department</h2><span class="grow"></span>${d.can_edit_contacts && !us.me.preview ? '<button class="btn sm" data-ct>+ Add contact</button>' : ''}</div><div class="bd flush">
      ${d.contacts.map(c => `<div class="rowx"><div class="grow"><b>${esc(c.department)}</b> ${c.is_primary ? '<span class="badge green">Primary</span>' : ''}<div class="small">${esc(c.name)}${c.designation ? ', ' + esc(c.designation) : ''} · ${esc(c.email)}${c.phone ? ' · ' + esc(c.phone) : ''}</div></div>${d.can_edit_contacts && !us.me.preview ? `<button class="btn xs" data-ect="${c.id}">Edit</button>` : ''}</div>`).join('') || '<div class="empty">No contacts yet. The Finance / Accounts contact receives invoices.</div>'}</div>
      <div class="bd small muted">Contact changes go live at once (La Europa is informed). Profile and campus changes need La Europa approval.</div></div></div></div>`;
  const pend = $('[data-pend]'); if (pend) pend.onclick = (e) => { e.preventDefault(); modal({ title: 'Pending changes', size: 'lg', body: `<table class="tbl"><thead><tr><th>Field</th><th>Current</th><th>Requested</th></tr></thead><tbody>${['name', 'short_name', 'city', 'uni_type', 'website', 'intl_page', 'about', 'founded_year', 'students_count', 'languages']
    .filter(k => JSON.stringify(L[k] ?? null) !== JSON.stringify(d.pending.payload[k] ?? null)).map(k => `<tr><td>${k}</td><td class="small">${esc(JSON.stringify(L[k] ?? ''))}</td><td class="small"><b>${esc(JSON.stringify(d.pending.payload[k] ?? ''))}</b></td></tr>`).join('')}${d.pending.payload.logo_key ? '<tr><td>Logo</td><td></td><td>New logo uploaded</td></tr>' : ''}</tbody></table>` }); };
  const wd = $('[data-wd]'); if (wd) wd.onclick = async (e) => { e.preventDefault(); if (!confirm('Withdraw the pending changes?')) return; await upost('/profile/request/withdraw'); go(location.hash); };
  const ed = $('[data-edit]'); if (ed) ed.onclick = () => editProfile(P);
  const cmp = (c) => { const m = modal({ title: c ? 'Edit campus' : 'Add campus', body: `<form class="form-grid" novalidate>${F('name', 'Campus name *', `<input class="input" name="name" value="${val(c && c.name)}" maxlength="150">`, '', 3)}${F('city', 'City *', `<input class="input" name="city" value="${val(c && c.city)}">`, '', 3)}
    ${F('address', 'Address', `<input class="input" name="address" value="${val(c && c.address)}">`)}${F('map_link', 'Map link', `<input class="input" name="map_link" value="${val(c && c.map_link)}">`)}
    ${F('status', 'Status', `<select class="input" name="status">${opt(['Active', 'Inactive'], c ? c.status : 'Active')}</select>`, 'Inactive campuses cannot be chosen on new courses.', 3)}<label class="row small c3" style="gap:6px"><input type="checkbox" name="is_main" ${c && c.is_main ? 'checked' : ''}> Main campus</label></form>`, foot: '<button class="btn" data-c>Cancel</button><button class="btn primary" data-s>Submit for approval</button>' });
    $('[data-c]', m.el).onclick = () => m.close(); $('[data-s]', m.el).onclick = async () => { const f = $('form', m.el); const b = Object.fromEntries(new FormData(f)); b.is_main = f.is_main.checked; if (c) b.id = c.id; try { const r = await upost('/campuses', b); m.close(); toast(r.message, 'ok'); } catch (e) { showError(e, f); } }; };
  const ac = $('[data-camp]'); if (ac) ac.onclick = () => cmp(null);
  $$('[data-ec]').forEach(b => b.onclick = () => cmp(d.campuses.find(c => c.id === b.dataset.ec)));
  const contact = (c) => { const m = modal({ title: c ? 'Edit contact' : 'Add contact', body: `<form class="form-grid" novalidate>${F('department', 'Department *', `<select class="input" name="department">${opt(['Admissions', 'International Office', 'Finance / Accounts', 'Scholarships', 'Accommodation', 'Visa / Immigration support', 'Marketing', 'Other'], c && c.department)}</select>`, '', 3)}
    ${F('name', 'Name *', `<input class="input" name="name" value="${val(c && c.name)}">`, '', 3)}${F('designation', 'Designation', `<input class="input" name="designation" value="${val(c && c.designation)}">`, '', 3)}${F('email', 'Email *', `<input class="input" name="email" type="email" value="${val(c && c.email)}">`, '', 3)}
    ${F('phone', 'Phone', `<input class="input" name="phone" value="${val(c && c.phone)}">`, '', 3)}<label class="row small c3" style="gap:6px"><input type="checkbox" name="is_primary" ${c && c.is_primary ? 'checked' : ''}> Primary for this department</label></form>`,
    foot: `${c ? '<button class="btn danger" data-d>Delete</button>' : ''}<button class="btn" data-c>Cancel</button><button class="btn primary" data-s>Save</button>` });
    $('[data-c]', m.el).onclick = () => m.close();
    const save = async (del) => { const f = $('form', m.el); const b = Object.fromEntries(new FormData(f)); b.is_primary = f.is_primary.checked; if (c) b.id = c.id; if (del) b.delete = true; try { await upost('/contacts', b); m.close(); go(location.hash); } catch (e) { showError(e, f); } };
    $('[data-s]', m.el).onclick = () => save(false); const dd = $('[data-d]', m.el); if (dd) dd.onclick = () => confirm('Delete this contact?') && save(true); };
  const act = $('[data-ct]'); if (act) act.onclick = () => contact(null);
  $$('[data-ect]').forEach(b => b.onclick = () => contact(d.contacts.find(c => c.id === b.dataset.ect)));
}
function editProfile(P) {
  const rows = (list, cols) => `<div data-rows>${(list || []).map(x => rowHtml(cols, x)).join('')}</div><button type="button" class="btn xs" data-addrow>+ Add</button>`;
  const rowHtml = (cols, x = {}) => `<div class="row mrow" style="gap:6px;margin-bottom:6px">${cols.map(([k, ph]) => `<input class="input" data-c="${k}" placeholder="${ph}" value="${val(x[k])}">`).join('')}<button type="button" class="btn xs ghost" data-rm>✕</button></div>`;
  const RANK = [['name', 'Ranking name'], ['year', 'Year'], ['rank', 'Rank or band'], ['link', 'Source link (https://)']];
  const ACC = [['name', 'Accreditation'], ['body', 'Body'], ['valid_until', 'Valid until'], ['link', 'Link (https://)']];
  const m = modal({ title: 'Edit university profile', size: 'xl', body: `<form class="form-grid" novalidate>
    ${F('name', 'University name *', `<input class="input" name="name" value="${val(P.name)}" maxlength="200">`, 'Official name. Change needs approval.', 3)}${F('short_name', 'Short name', `<input class="input" name="short_name" value="${val(P.short_name)}" maxlength="30">`, '', 1)}
    ${F('uni_type', 'Type *', `<select class="input" name="uni_type">${opt(['Public', 'Private'], P.uni_type)}</select>`, '', 1)}${F('city', 'Main city *', `<input class="input" name="city" value="${val(P.city)}">`, '', 1)}
    ${F('website', 'Website *', `<input class="input" name="website" value="${val(P.website)}">`, 'https:// only', 3)}${F('intl_page', 'International admissions page', `<input class="input" name="intl_page" value="${val(P.intl_page)}">`, '', 3)}
    ${F('about', 'About the university * (100 to 3000 characters; bold, italic, bullets, links only)', `<textarea class="input" name="about" rows="7" style="height:auto;padding:8px">${val(P.about)}</textarea>`, 'You can use &lt;b&gt;, &lt;i&gt;, &lt;ul&gt;&lt;li&gt; and &lt;a href="https://..."&gt;. No images or scripts.')}
    ${F('founded_year', 'Year founded', `<input class="input" name="founded_year" type="number" value="${val(P.founded_year)}">`, '', 2)}${F('students_count', 'Number of students', `<input class="input" name="students_count" type="number" value="${val(P.students_count)}">`, '', 2)}
    ${F('languages', 'Languages of instruction', `<div class="ms">${['English', 'French', 'German', 'Italian', 'Spanish', 'Dutch', 'Chinese', 'Other'].map(l => `<label><input type="checkbox" data-lang value="${l}" ${(P.languages || []).includes(l) ? 'checked' : ''}>${l}</label>`).join('')}</div>`, '', 2)}
    ${F('rankings', 'Rankings (shown "as provided by the university")', `<div data-rk>${rows(P.rankings, RANK)}</div>`)}${F('accreditations', 'Accreditations', `<div data-ac>${rows(P.accreditations, ACC)}</div>`)}
    ${F('logo', 'Logo (PNG / JPG, min 200 x 200 px, max 2 MB)', '<input type="file" name="logo" accept=".png,.jpg,.jpeg">', 'Preview below shows the course card as students will see it.', 3)}${F('cover', 'Cover image (JPG / PNG, max 3 MB)', '<input type="file" name="cover" accept=".png,.jpg,.jpeg">', '', 3)}
    <div class="c6"><div class="small muted">Preview of a course card:</div><div class="ccard" style="max-width:380px;margin-top:6px"><div class="ccard-hd"><img class="ccard-logo" data-prev src="${esc(P.logo || '')}" alt=""><div class="ccard-uni" data-pn>${val(P.name)}<small>${val(P.city)}</small></div><span class="ccard-country">${val(P.country)}</span></div><h3 class="ccard-title">Sample course (Master)</h3></div></div></form>`,
    foot: '<button class="btn" data-c>Cancel</button><button class="btn primary" data-s>Submit for approval</button>' });
  const f = $('form', m.el);
  $$('[data-addrow]', f).forEach(b => b.onclick = () => { const cols = b.closest('[data-rk]') ? RANK : ACC; b.previousElementSibling.insertAdjacentHTML('beforeend', rowHtml(cols)); bindRm(); });
  const bindRm = () => $$('[data-rm]', f).forEach(b => b.onclick = () => b.parentElement.remove()); bindRm();
  f.name.oninput = () => { $('[data-pn]', f).firstChild.textContent = f.name.value; };
  f.logo.onchange = () => { const file = f.logo.files[0]; if (file) $('[data-prev]', f).src = URL.createObjectURL(file); };
  $('[data-c]', m.el).onclick = () => m.close();
  $('[data-s]', m.el).onclick = async () => {
    const take = (sel) => $$(`${sel} .mrow`, f).map(r => Object.fromEntries($$('[data-c]', r).map(i => [i.dataset.c, i.value.trim()]))).filter(x => x.name);
    const payload = { name: f.name.value, short_name: f.short_name.value, uni_type: f.uni_type.value, city: f.city.value, website: f.website.value, intl_page: f.intl_page.value, about: f.about.value, founded_year: f.founded_year.value || null,
      students_count: f.students_count.value || null, languages: $$('[data-lang]:checked', f).map(i => i.value), rankings: take('[data-rk]'), accreditations: take('[data-ac]'), social: P.social || [] };
    const fd = new FormData(); fd.append('payload', JSON.stringify(payload)); if (f.logo.files[0]) fd.append('logo', f.logo.files[0]); if (f.cover.files[0]) fd.append('cover', f.cover.files[0]);
    try { const r = await uapi('POST', '/profile/request', fd); m.close(); toast(r.message, 'ok'); go(location.hash); } catch (e) { showError(e, f); }
  };
}

// ---------- courses ----------
export async function courses(q = {}) {
  const d = await uget('/courses' + qs(q));
  const main = $('.main'); const o = d.options;
  main.innerHTML = `<div class="page-head"><h1>Courses</h1><span class="muted small">${d.rows.length} course(s) · one catalogue shared with La Europa's course search</span><span class="grow"></span>
    ${d.can_propose ? '<a class="btn primary" href="#/courses/new">+ Add course</a><a class="btn" href="#/bulk">Bulk upload</a>' : ''}<button class="btn" data-dl>Download all courses (Excel)</button></div>
    <div class="banner">Every change is approved by La Europa before students see it. Fees show the amount only: words like non-EU, international or foreign are not allowed.</div>
    <form class="filters" id="cf"><input type="search" name="q" placeholder="Course name or code" value="${esc(q.q || '')}"><select name="level"><option value="">All levels</option>${opt(o.levels, q.level)}</select>
      <select name="field"><option value="">All fields</option>${opt(o.fields, q.field)}</select>${o.campuses.length > 1 ? `<select name="campus"><option value="">All campuses</option>${opt(o.campuses, q.campus)}</select>` : ''}
      <select name="uni_status"><option value="">Active + closed</option>${opt(['Active', 'Closed'], q.uni_status)}</select><select name="catalogue_status"><option value="">Any catalogue status</option>${opt(['Live', 'Pending approval', 'Draft', 'Closed', 'Archived'], q.catalogue_status)}</select>
      <label class="row small" style="gap:4px"><input type="checkbox" name="pending" value="1" ${q.pending ? 'checked' : ''}> Has pending change</label></form>
    ${d.new_pending.length ? `<div class="card" style="margin-bottom:12px"><div class="hd"><h2>New courses waiting for approval</h2></div><div class="bd small">${d.new_pending.map(x => `<div>${esc(x.name)} · ${esc(x.status)} · ${esc(fmtDate(x.created_at))} <a href="#" data-withdraw="${x.id}">withdraw</a></div>`).join('')}</div></div>` : ''}
    <div class="card"><div class="table-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Course</th><th>Level</th><th>Field</th><th>Campus</th><th>Intakes</th><th>Tuition / year</th><th>University</th><th>Catalogue</th><th>Last approved</th><th></th></tr></thead><tbody>
    ${d.rows.map(c => `<tr><td data-label="Code" class="small">${esc(c.code || '-')}</td><td data-label="Course"><b>${esc(c.name)}</b>${c.university_course_code ? `<div class="small muted">${esc(c.university_course_code)}</div>` : ''}</td><td data-label="Level">${esc(c.level)}</td><td data-label="Field" class="small">${esc(c.field || '')}</td>
      <td data-label="Campus" class="small">${esc(c.campus || '-')}</td><td data-label="Intakes">${c.intakes.map(i => `<span class="chip ${i.open ? 'open' : 'closed'}">${esc(i.label)}</span>`).join(' ')}</td><td data-label="Tuition">${c.tuition_fee === 0 ? 'Free' : money(c.tuition_fee, c.currency)}</td>
      <td data-label="Univ. status">${c.uni_status === 'Closed' ? '<span class="badge grey">Closed</span>' : '<span class="badge green">Active</span>'}</td><td data-label="Catalogue"><span class="badge ${c.catalogue_status === 'Live' ? 'green' : c.catalogue_status === 'Pending approval' ? 'orange' : 'grey'}">${esc(c.catalogue_status)}</span></td>
      <td data-label="Approved" class="small">${esc(fmtDate(c.last_approved_on))}</td><td class="nowrap">${c.pending ? `<a href="#" data-view="${c.pending.id}" class="small">View change</a> ` : ''}${d.can_propose ? `<a class="btn xs" href="#/courses/${c.id}">Edit</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="11" class="empty">No courses yet</td></tr>'}</tbody></table></div></div>
    <div class="card" style="margin-top:12px"><div class="hd"><h2>Recent change requests</h2></div><div class="table-wrap"><table class="tbl"><thead><tr><th>Sent</th><th>Change</th><th>Course</th><th>Status</th><th>La Europa note</th></tr></thead><tbody>
      ${d.requests.slice(0, 20).map(x => `<tr><td class="small">${esc(fmtDate(x.created_at))}</td><td>${esc(x.change_type)}${x.urgent ? ' <span class="badge red">Urgent</span>' : ''}</td><td>${esc(x.course || '')}</td><td><span class="badge ${/Approved/.test(x.status) ? 'green' : x.status === 'Rejected' ? 'red' : 'orange'}">${esc(x.status)}</span></td><td class="small">${esc(x.review_note || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">None</td></tr>'}</tbody></table></div></div>`;
  $$('#cf select, #cf input[type=checkbox]').forEach(i => i.onchange = () => go('#/courses' + qs(Object.fromEntries(new FormData($('#cf'))))));
  $('#cf input[name=q]').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go('#/courses' + qs(Object.fromEntries(new FormData($('#cf'))))); } };
  $('[data-dl]').onclick = () => download('/courses-template.xlsx?data=1', 'my-courses.xlsx');
  $$('[data-withdraw]').forEach(a => a.onclick = async (e) => { e.preventDefault(); await upost(`/courses/requests/${a.dataset.withdraw}/withdraw`); go(location.hash); });
  $$('[data-view]').forEach(a => a.onclick = async (e) => { e.preventDefault(); const x = await uget('/courses/requests/' + a.dataset.view); diffModal(x); });
}
function diffModal(x) {
  const keys = Object.keys(x.payload).filter(k => !['english', 'intakes'].includes(k));
  const old = x.old || {};
  modal({ title: `${x.change_type}: ${x.status}`, size: 'lg', body: `<table class="tbl"><thead><tr><th>Field</th><th>Current</th><th>Requested</th></tr></thead><tbody>${keys.map(k => { const ov = old[k] ?? (old.academic && old.academic[k]); const ch = JSON.stringify(ov ?? null) !== JSON.stringify(x.payload[k] ?? null);
    return `<tr class="${ch ? 'row-info' : ''}"><td>${esc(k)}</td><td class="small">${esc(ov ?? '')}</td><td class="small">${ch ? '<b>' : ''}${esc(x.payload[k] ?? '')}${ch ? '</b>' : ''}</td></tr>`; }).join('')}
    <tr><td>intakes</td><td class="small">${esc((old.intakes || []).map(i => `${i.label}: ${i.deadline} ${i.status}`).join('; '))}</td><td class="small">${esc((x.payload.intakes || []).map(i => `${i.month}/${i.year}: ${i.deadline} ${i.status}`).join('; '))}</td></tr>
    <tr><td>english</td><td class="small">${esc((old.english || []).map(e => `${e.test_type} ${e.min_overall}`).join('; '))}</td><td class="small">${esc((x.payload.english || []).map(e => `${e.test_type} ${e.min_overall}`).join('; '))}${x.payload.moi_accepted ? ' + MOI' : ''}</td></tr></tbody></table>` });
}
export async function courseForm(id) {
  const [opts, c] = await Promise.all([uget('/courses'), id ? uget('/courses/' + id) : Promise.resolve(null)]);
  const o = opts.options; const ac = (c && c.academic) || {}; const moi = c ? c.english.some(e => e.moi_accepted) : false;
  const main = $('.main');
  main.innerHTML = `<div class="page-head"><a class="btn ghost sm" href="#/courses">← Courses</a><h1>${c ? 'Edit course' : 'Add course'}</h1>${c && c.pending ? '<span class="badge orange">A change is already pending: your edits update it</span>' : ''}</div>
    <form id="cf" class="card" novalidate><div class="bd"><h2>Shown in La Europa course search</h2><div class="form-grid">
      ${F('name', 'Course name * (exactly as on your website)', `<input class="input" name="name" value="${val(c && c.name)}" maxlength="200">`, '', 4)}${F('level', 'Level *', `<select class="input" name="level">${opt(o.levels, c && c.level)}</select>`, '', 2)}
      ${F('course_link', 'Course link *', `<input class="input" name="course_link" value="${val(c && c.course_link)}">`, 'https:// only. We check that it opens.')}
      ${F('tuition_fee', 'Tuition fee (per year) *', `<div class="row" style="gap:6px"><input class="input" name="tuition_fee" type="number" min="0" step="0.01" value="${val(c && c.tuition_fee)}"><select class="input" name="currency" style="width:100px">${opt(o.currencies.length ? o.currencies : ['EUR', 'CNY', 'USD'], (c && c.currency) || 'EUR')}</select></div>`, 'One amount per year. 0 allowed.', 3)}
      ${F('application_fee', 'Application fee *', `<div class="row" style="gap:6px"><input class="input" name="application_fee" type="number" min="0" step="0.01" value="${val(c ? c.application_fee : 0)}"><select class="input" name="application_fee_currency" style="width:100px">${opt(o.currencies.length ? o.currencies : ['EUR', 'CNY', 'USD'], (c && c.application_fee_currency) || 'EUR')}</select></div>`, '0 = free application', 3)}
      ${F('fee_note', 'Fee note', `<input class="input" name="fee_note" value="${val(c && c.fee_note)}" maxlength="200">`, 'For example "Semester contribution of EUR 300 also applies". Amounts only.')}
      ${F('required_level', 'Academic requirement: previous level *', `<select class="input" name="required_level">${opt(['12th', 'Diploma', 'Bachelor', 'Master'], ac.required_level || 'Bachelor')}</select>`, '', 3)}
      ${F('min_percent', 'Minimum percentage *', `<input class="input" name="min_percent" type="number" min="0" max="100" step="0.5" value="${val(ac.min_percent)}">`, 'Percentage only (0 to 100). If you accept by grade, enter the equivalent percentage for Indian students.', 3)}
      ${F('academic_note', 'Academic requirement note', `<input class="input" name="academic_note" value="${val(ac.note)}" maxlength="300">`)}
      <div class="f c6" data-k="english"><label>English proficiency * (at least one test, or MOI accepted)</label><div data-eng></div><button type="button" class="btn xs" data-addeng>+ Add test</button><div class="msg"></div></div>
      <label class="row c3" style="gap:6px"><input type="checkbox" name="moi_accepted" ${moi ? 'checked' : ''}> MOI accepted instead of a test</label>
      ${F('min_12th_english_percent', '12th English marks waiver: minimum %', `<input class="input" name="min_12th_english_percent" type="number" min="0" max="100" value="${val(c && c.english[0] && c.english[0].min_12th_english_percent)}">`, '', 3)}</div>
      <h2 style="margin-top:18px">Course details</h2><div class="form-grid">
      ${F('field_of_study_id', 'Field of study *', `<select class="input" name="field_of_study_id"><option value="">Select...</option>${opt(o.fields, c && c.field_of_study_id)}</select>`, '', 3)}
      ${F('campus_id', 'Campus *', `<select class="input" name="campus_id"><option value="">Select...</option>${opt(o.campuses.filter(x => x.status === 'Active' || (c && x.id === c.campus_id)).map(x => [x.id, `${x.name} (${x.city})`]), c && c.campus_id)}</select>`, o.campuses.length ? '' : 'Add a campus in Profile first.', 3)}
      ${F('duration_months', 'Duration (months) *', `<input class="input" name="duration_months" type="number" min="1" max="96" value="${val(c && c.duration_months)}">`, '', 2)}${F('language', 'Language of instruction *', `<select class="input" name="language">${opt(o.languages, (c && c.language) || 'English')}</select>`, '', 2)}
      ${F('uni_status', 'University status *', `<select class="input" name="uni_status">${opt(['Active', 'Closed'], (c && c.uni_status) || 'Active')}</select>`, 'Closed = no new applications for any intake.', 2)}
      <div class="f c6" data-k="intakes"><label>Intakes * (deadline required)</label><div data-ints></div><button type="button" class="btn xs" data-addint>+ Add intake</button><div class="msg"></div></div>
      ${F('university_course_code', 'Your course code', `<input class="input" name="university_course_code" value="${val(c && c.university_course_code)}" maxlength="50">`, 'Used to match rows in bulk upload.', 3)}
      ${F('entrance_test', 'Entrance test', `<select class="input" name="entrance_test">${opt(['None', 'GMAT', 'GRE', 'SAT', 'University test', 'Other'], ac.entrance_test || 'None')}</select>`, '', 3)}
      ${F('min_work_months', 'Minimum work experience (months)', `<input class="input" name="min_work_months" type="number" min="0" value="${val(ac.min_work_months)}">`, '', 3)}
      ${F('seats_for_le', 'Seats for La Europa students', `<input class="input" name="seats_for_le" type="number" min="0" value="${val(c && c.seats_for_le)}">`, 'Internal, never shown to students.', 3)}
      ${F('description', 'Short description', `<textarea class="input" name="description" rows="4" maxlength="1500" style="height:auto;padding:8px">${val(c && c.description)}</textarea>`)}
      ${F('note_for_le', 'Note for La Europa', `<textarea class="input" name="note_for_le" rows="2" maxlength="1000" style="height:auto;padding:8px">${val(c && c.note_for_le)}</textarea>`, 'Visible to La Europa staff only.')}</div>
      <div class="err-box hide" style="margin-top:10px"></div><div class="form-actions"><button type="button" class="btn" data-draft>Save as draft</button><button type="button" class="btn primary" data-sub>Submit for approval</button></div></div></form>`;
  const f = $('#cf');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const addEng = (e = {}) => { const r = document.createElement('div'); r.className = 'row mrow'; r.style.cssText = 'gap:6px;margin-bottom:6px;flex-wrap:wrap';
    r.innerHTML = `<select class="input" data-e="test_type" style="width:160px">${opt(o.tests, e.test_type || 'IELTS Academic')}</select><input class="input" data-e="min_overall" type="number" step="0.5" placeholder="Min overall" value="${val(e.min_overall)}" style="width:120px"><input class="input" data-e="min_band" type="number" step="0.5" placeholder="Min band (optional)" value="${val(e.min_band)}" style="width:150px"><button type="button" class="btn xs ghost">✕</button>`;
    $('button', r).onclick = () => r.remove(); $('[data-eng]', f).appendChild(r); };
  const addInt = (i = {}) => { const r = document.createElement('div'); r.className = 'row mrow'; r.style.cssText = 'gap:6px;margin-bottom:6px;flex-wrap:wrap'; r.dataset.id = i.id || '';
    r.innerHTML = `<select class="input" data-i="month" style="width:90px">${opt(MON.map((m, k) => [String(k + 1), m]), String(i.month || 9))}</select><input class="input" data-i="year" type="number" placeholder="Year" value="${val(i.year || new Date().getFullYear() + 1)}" style="width:90px">
      <label class="small row" style="gap:3px"><input type="checkbox" data-i="every_year" ${i.every_year ? 'checked' : ''}>every year</label><input class="input" data-i="open_date" type="date" title="Application open date" value="${val(i.open_date)}" style="width:150px">
      <input class="input" data-i="deadline" type="date" title="Application deadline" value="${val(i.deadline)}" style="width:150px"><input class="input" data-i="deadline_note" placeholder="Deadline note (e.g. Round 1)" value="${val(i.deadline_note)}" style="width:170px">
      <select class="input" data-i="status" style="width:100px">${opt(['Open', 'Closed'], i.status || 'Open')}</select><select class="input" data-i="closed_reason" style="width:180px"><option value="">Closed reason</option>${opt(['Seats full', 'Deadline passed', 'Course not running this intake', 'Other'], i.closed_reason)}</select><button type="button" class="btn xs ghost">✕</button>`;
    $('button', r).onclick = () => r.remove(); $('[data-ints]', f).appendChild(r); };
  (c ? c.english.filter(e => e.test_type) : []).forEach(addEng); if (!c || !c.english.some(e => e.test_type)) addEng();
  (c ? c.intakes : []).forEach(addInt); if (!c || !c.intakes.length) addInt();
  $('[data-addeng]', f).onclick = () => addEng(); $('[data-addint]', f).onclick = () => addInt();
  const submit = async (draft) => {
    const b = Object.fromEntries(new FormData(f)); b.moi_accepted = f.moi_accepted.checked; if (c) b.id = c.id; b.draft = draft;
    b.english = $$('[data-eng] .mrow', f).map(r => Object.fromEntries($$('[data-e]', r).map(x => [x.dataset.e, x.value]))).filter(e => e.min_overall);
    b.intakes = $$('[data-ints] .mrow', f).map(r => ({ id: r.dataset.id || null, ...Object.fromEntries($$('[data-i]', r).map(x => [x.dataset.i, x.type === 'checkbox' ? x.checked : x.value])) }));
    try { const r = await upost('/courses', b); if (r.warnings && r.warnings.length) toast(r.warnings.join(' '), ''); toast(r.message, 'ok'); go('#/courses'); }
    catch (e) { const eb = $('.err-box', f); eb.textContent = e.message + (e.data.warnings && e.data.warnings.length ? ' ' + e.data.warnings.join(' ') : ''); eb.classList.remove('hide'); setErrors(f, e.data.errors || {}); }
  };
  $('[data-draft]', f).onclick = () => submit(true); $('[data-sub]', f).onclick = () => submit(false);
}

// ---------- bulk upload ----------
export async function bulk() {
  const main = $('.main'); let rows = null; let file = null;
  main.innerHTML = `<div class="page-head"><a class="btn ghost sm" href="#/courses">← Courses</a><h1>Bulk course upload</h1></div>
    <div class="card"><div class="bd"><ol class="small"><li>Download the template (sheets Courses, Intakes, English and Help with allowed values), or download your current courses to edit.</li><li>Fill it in. Max 1000 course rows and 5 MB.</li><li>Upload and check the preview: New, Update, No change, Error.</li><li>Submit valid rows for La Europa approval. Error rows are not submitted.</li></ol>
      <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn" data-t>Download template</button><button class="btn" data-cur>Download my courses</button><label class="btn primary">Upload file (.xlsx / .csv)<input type="file" accept=".xlsx,.csv" hidden data-file></label><span class="small muted" data-fn></span></div>
      <div data-prev style="margin-top:14px"></div></div></div>`;
  $('[data-t]').onclick = () => download('/courses-template.xlsx', 'course-upload-template.xlsx');
  $('[data-cur]').onclick = () => download('/courses-template.xlsx?data=1', 'my-courses.xlsx');
  const send = async (mode) => { const fd = new FormData(); fd.append('file', file); return uapi('POST', `/courses/bulk/${mode}`, fd); };
  $('[data-file]').onchange = async (e) => {
    file = e.target.files[0]; if (!file) return; $('[data-fn]').textContent = file.name;
    try {
      const r = await send('preview'); rows = r.rows;
      $('[data-prev]').innerHTML = `<div class="row" style="gap:6px;margin-bottom:8px">${Object.entries(r.counts).map(([k, n]) => `<span class="badge ${k === 'Error' ? 'red' : k === 'New' ? 'green' : k === 'Update' ? 'blue' : 'grey'}">${k}: ${n}</span>`).join('')}<span class="grow"></span>
        ${r.counts.Error ? '<button class="btn sm" data-err>Download error rows</button>' : ''}<button class="btn sm primary" data-go ${(r.counts.New || 0) + (r.counts.Update || 0) ? '' : 'disabled'}>Submit for approval</button></div>
        <div class="table-wrap" style="max-height:420px;overflow:auto"><table class="tbl"><thead><tr><th>Row</th><th>Course</th><th>Result</th><th>Reason / warning</th></tr></thead><tbody>${r.rows.map(x => `<tr class="${x.status === 'Error' ? 'row-danger' : ''}"><td>${esc(x.row)}</td><td>${esc(x.course)}</td><td>${esc(x.status)}</td><td class="small">${esc(x.reason || (x.warnings || []).join(' '))}</td></tr>`).join('')}</tbody></table></div>`;
      const er = $('[data-err]'); if (er) er.onclick = () => download('/courses/bulk/errors.xlsx', 'upload-errors.xlsx', { rows });
      $('[data-go]').onclick = async () => { try { const x = await send('submit'); toast(`Submitted ${(x.counts.New || 0) + (x.counts.Update || 0)} change(s) for La Europa approval`, 'ok'); go('#/courses'); } catch (er2) { toast(er2.message, 'err'); } };
    } catch (er) { $('[data-prev]').innerHTML = `<div class="err-box">${esc(er.message)}</div>`; }
  };
}

// ---------- intakes + scholarships ----------
export async function intakes(q = {}) {
  const [d, s] = await Promise.all([uget('/intakes'), uget('/scholarships')]);
  const main = $('.main'); const sel = new Set();
  main.innerHTML = `<div class="page-head"><h1>Intakes, deadlines and scholarships</h1></div>
    <div class="card"><div class="hd"><h2>Intake calendar</h2><span class="grow"></span>${d.can_propose ? '<button class="btn sm" data-bd disabled>Set deadline</button><button class="btn sm" data-bc disabled>Close intake</button>' : ''}</div><div class="table-wrap"><table class="tbl"><thead><tr>${d.can_propose ? '<th></th>' : ''}<th>Course</th><th>Level</th><th>Intake</th><th>Opens</th><th>Deadline</th><th>Status</th><th></th></tr></thead><tbody>
    ${d.rows.map(r => `<tr>${d.can_propose ? `<td><input type="checkbox" data-sel="${r.course_id}|${r.intake_key}"></td>` : ''}<td>${esc(r.course)}</td><td>${esc(r.level)}</td><td>${esc(r.intake)}</td><td class="small">${esc(fmtDate(r.open_date))}</td><td><b>${esc(fmtDate(r.deadline))}</b></td>
      <td><span class="badge ${r.status === 'Open' ? 'green' : 'grey'}">${esc(r.status)}</span></td><td>${r.pending ? '<span class="badge orange">Pending change</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No intakes yet</td></tr>'}</tbody></table></div>
    <div class="bd small muted">Moving a deadline earlier or closing an intake is urgent for La Europa. After approval, counsellors of affected students are told and the course search shows the new deadline.</div></div>
    <div class="card" style="margin-top:14px"><div class="hd"><h2>Scholarships</h2><span class="grow"></span>${s.can_propose ? '<button class="btn sm primary" data-ns>+ Add scholarship</button>' : ''}</div><div class="table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Name</th><th>Benefit</th><th>Applies to</th><th>Deadline</th><th>Status</th><th></th></tr></thead><tbody>
    ${s.rows.map(x => `<tr><td class="small">${esc(x.code)}</td><td><b>${esc(x.name)}</b></td><td>${esc(x.benefit_type === 'Fixed amount' ? money(x.amount, x.currency) : x.benefit_type === 'Percentage of tuition' ? x.percent + '% of tuition' : x.benefit_type)}</td>
      <td class="small">${esc(x.applies.scope === 'all' || !x.applies.scope ? 'All courses' : x.applies.scope === 'levels' ? (x.applies.levels || []).join(', ') : (x.applies.courses || []).length + ' course(s)')}</td><td>${esc(fmtDate(x.deadline))}</td><td><span class="badge ${x.status === 'Live' ? 'green' : 'grey'}">${esc(x.status)}</span></td>
      <td>${s.can_propose ? `<button class="btn xs" data-es="${x.id}">Edit</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No scholarships yet</td></tr>'}</tbody></table></div>
    ${s.requests.length ? `<div class="bd small"><b>Requests:</b> ${s.requests.slice(0, 10).map(x => `${esc(x.name)} (${esc(x.status)}${x.review_note ? ': ' + esc(x.review_note) : ''})`).join(' · ')}</div>` : ''}
    <div class="bd small muted">Shown to students as: "Scholarships are decided by the university. Your counsellor will tell you if you can apply."</div></div>`;
  const bd = $('[data-bd]'), bc = $('[data-bc]');
  $$('[data-sel]').forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.sel) : sel.delete(c.dataset.sel); [bd, bc].forEach(b => b && (b.disabled = !sel.size)); });
  const bulkAct = (action) => { const m = modal({ title: action === 'deadline' ? 'Set a new deadline' : 'Close intake', size: 'sm', body: action === 'deadline' ? '<div class="f"><label>New deadline</label><input class="input" type="date" id="nd"></div>' : `<div class="f"><label>Closed reason</label><select class="input" id="cr">${opt(['Seats full', 'Deadline passed', 'Course not running this intake', 'Other'])}</select></div>`, foot: '<button class="btn" data-c>Cancel</button><button class="btn primary" data-s>Submit for approval</button>' });
    $('[data-c]', m.el).onclick = () => m.close();
    $('[data-s]', m.el).onclick = async () => { const groups = {}; for (const k of sel) { const [cid, ik] = k.split('|'); (groups[ik] = groups[ik] || []).push(cid); } let n = 0;
      try { for (const [ik, ids] of Object.entries(groups)) { const r = await upost('/intakes/bulk', { course_ids: ids, intake_key: ik, action, deadline: action === 'deadline' ? $('#nd').value : undefined, closed_reason: action === 'close' ? $('#cr').value : undefined }); n += r.count; } m.close(); toast(`${n} change(s) sent for approval`, 'ok'); go(location.hash); } catch (e) { toast(e.message, 'err'); } }; };
  if (bd) bd.onclick = () => bulkAct('deadline'); if (bc) bc.onclick = () => bulkAct('close');
  const sch = (x) => { const ap = x ? x.applies : { scope: 'all' };
    const m = modal({ title: x ? 'Edit scholarship' : 'Add scholarship', size: 'lg', body: `<form class="form-grid" novalidate>${F('name', 'Scholarship name *', `<input class="input" name="name" value="${val(x && x.name)}" maxlength="150">`)}
      ${F('description', 'Description *', `<textarea class="input" name="description" rows="3" maxlength="2000" style="height:auto;padding:8px">${val(x && x.description)}</textarea>`)}
      ${F('benefit_type', 'Benefit type *', `<select class="input" name="benefit_type">${opt(s.benefit_types, x && x.benefit_type)}</select>`, '', 2)}${F('amount', 'Amount', `<input class="input" name="amount" type="number" min="0" value="${val(x && x.amount)}">`, 'Amount only', 2)}
      ${F('currency', 'Currency', `<select class="input" name="currency">${opt(['EUR', 'USD', 'GBP', 'CNY', 'SEK', 'CHF'], (x && x.currency) || 'EUR')}</select>`, '', 1)}${F('percent', '% of tuition', `<input class="input" name="percent" type="number" min="1" max="100" value="${val(x && x.percent)}">`, '', 1)}
      ${F('min_percent', 'Eligibility: minimum academic %', `<input class="input" name="min_percent" type="number" min="0" max="100" value="${val(x && x.min_percent)}">`, '', 2)}${F('other_criteria', 'Other criteria', `<input class="input" name="other_criteria" value="${val(x && x.other_criteria)}" maxlength="1000">`, '', 4)}
      ${F('scope', 'Applies to *', `<select class="input" name="scope">${opt([['all', 'All courses'], ['levels', 'Selected levels'], ['courses', 'Selected courses']], ap.scope || 'all')}</select>`, '', 2)}
      ${F('levels', 'Levels', `<div class="ms">${['Bachelor', 'Master', 'MBA', 'PhD', 'Diploma', 'Foundation', 'Language course'].map(l => `<label><input type="checkbox" data-lv value="${l}" ${(ap.levels || []).includes(l) ? 'checked' : ''}>${l}</label>`).join('')}</div>`, '', 4)}
      ${F('courses', 'Courses', `<div class="ms" style="max-height:140px;overflow:auto">${s.courses.map(c => `<label><input type="checkbox" data-co value="${c.id}" ${(ap.courses || []).includes(c.id) ? 'checked' : ''}>${esc(c.name)} (${esc(c.level)})</label>`).join('')}</div>`)}
      ${F('deadline', 'Scholarship deadline', `<input class="input" name="deadline" type="date" value="${val(x && x.deadline)}">`, '', 2)}${F('valid_until', 'Valid until', `<input class="input" name="valid_until" type="date" value="${val(x && x.valid_until)}">`, '', 2)}
      ${F('how_apply', 'How the student applies *', `<select class="input" name="how_apply">${opt(s.how_apply, x && x.how_apply)}</select>`, 'Students always apply through La Europa.', 2)}${F('link', 'Official link', `<input class="input" name="link" value="${val(x && x.link)}">`)}</form>`,
      foot: '<button class="btn" data-c>Cancel</button><button class="btn primary" data-s>Submit for approval</button>' });
    $('[data-c]', m.el).onclick = () => m.close();
    $('[data-s]', m.el).onclick = async () => { const f = $('form', m.el); const b = Object.fromEntries(new FormData(f)); b.levels = $$('[data-lv]:checked', f).map(i => i.value); b.courses = $$('[data-co]:checked', f).map(i => i.value); if (x) b.id = x.id;
      try { const r = await upost('/scholarships', b); m.close(); toast(r.message, 'ok'); go(location.hash); } catch (e) { showError(e, f); } }; };
  const ns = $('[data-ns]'); if (ns) ns.onclick = () => sch(null);
  $$('[data-es]').forEach(b => b.onclick = () => sch(s.rows.find(x => x.id === b.dataset.es)));
}

// ---------- announcements ----------
export async function announcements() {
  const d = await uget('/announcements');
  const main = $('.main');
  main.innerHTML = `<div class="page-head"><h1>Announcements to La Europa</h1><span class="grow"></span>${d.can_post ? '<button class="btn primary" data-new>+ New announcement</button>' : ''}</div>
    <div class="banner">Announcements go to La Europa only, never directly to students. A deadline or fee in an announcement does not change the course search: use Courses or Intakes for that.</div>
    ${d.notices.length ? `<div class="card" style="margin-bottom:12px"><div class="hd"><h2>Notices from La Europa</h2></div><div class="bd">${d.notices.map(n => `<div class="rowx"><b>${esc(n.title)}</b><div class="small">${esc(n.body || '')}</div><div class="small muted">${esc(fmtDT(n.created_at))}</div></div>`).join('')}</div></div>` : ''}
    <div class="card"><div class="bd flush">${d.rows.map(a => `<div class="rowx"><div class="row between"><b>${a.important ? '❗ ' : ''}${esc(a.title)}</b><span class="badge ${a.status === 'Handled' ? 'green' : a.status === 'Seen by La Europa' ? 'blue' : 'grey'}">${esc(a.status)}</span></div>
      <div class="small muted">${esc(a.type)} · ${esc(fmtDT(a.created_at))}${a.valid_until ? ' · valid until ' + esc(fmtDate(a.valid_until)) : ''}</div><div class="small" style="white-space:pre-wrap;margin-top:4px">${esc(a.body)}</div>
      ${a.attachments.map(x => `<a class="small" href="/api/university/announcements/${a.id}/attachment/${x.id}">📎 ${esc(x.name)}</a>`).join(' ')}</div>`).join('') || '<div class="empty">No announcements yet</div>'}</div></div>`;
  const nb = $('[data-new]'); if (nb) nb.onclick = () => {
    const m = modal({ title: 'New announcement', size: 'lg', body: `<form class="form-grid" novalidate>${F('type', 'Type *', `<select class="input" name="type">${opt(d.types)}</select>`, '', 3)}${F('valid_until', 'Valid until', '<input class="input" type="date" name="valid_until">', '', 3)}
      ${F('title', 'Title *', '<input class="input" name="title" maxlength="150">')}${F('body', 'Message *', '<textarea class="input" name="body" rows="5" maxlength="5000" style="height:auto;padding:8px"></textarea>', 'Fee amounts only, no category words.')}
      ${F('related', 'Related courses', `<div class="ms" style="max-height:130px;overflow:auto">${d.courses.map(c => `<label><input type="checkbox" data-rc value="${c.id}">${esc(c.name)}</label>`).join('')}</div>`)}
      ${F('files', 'Attachments (up to 5, 10 MB each)', '<input type="file" name="files" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xlsx,.csv">', '', 4)}<label class="row c2" style="gap:6px"><input type="checkbox" name="important"> Important</label></form>`,
      foot: '<button class="btn" data-c>Cancel</button><button class="btn primary" data-s>Post to La Europa</button>' });
    $('[data-c]', m.el).onclick = () => m.close();
    $('[data-s]', m.el).onclick = async () => { const f = $('form', m.el); const fd = new FormData(f); fd.set('important', f.important.checked); fd.append('related', JSON.stringify($$('[data-rc]:checked', f).map(i => i.value)));
      try { await uapi('POST', '/announcements', fd); m.close(); toast('Posted to La Europa', 'ok'); go(location.hash); } catch (e) { showError(e, f); } };
  };
}
