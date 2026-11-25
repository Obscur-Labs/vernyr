'use strict';
// La Europa Admin approvals (University doc 3.5, 4.8, 9.4; screen S46). Nothing a university submits goes live before approval.
const fs = require('fs');
const path = require('path');
const { all, get, run, insert, update, uuid, now, getSetting, tx, DATA_DIR } = require('../db');
const U = require('../util');
const { masterName, fmtDate, notify } = U;
const files = require('../files');
const C = require('./common');
const UE = require('./uemail');

function e39(x, status, note, summary) {
  const u = C.uni(x.university_id);
  const to = [x.requested_by && get('SELECT email FROM uni_users WHERE id = ?', x.requested_by), ...C.usersOf(x.university_id, { roles: ['admin'] })].filter(Boolean).map(y => y.email);
  UE.trigger('E39', { to, university_id: x.university_id, ctx: { change_summary: summary, change_status: status.toLowerCase(), reject_reason_block: note ? `<p>${status === 'Rejected' ? 'Reason' : 'Note from La Europa'}: ${require('../email').esc(note)}</p>` : '' }, link: '/#/courses' });
  C.unotify([x.requested_by, ...C.usersOf(x.university_id, { roles: ['admin'] }).map(y => y.id)], `${summary}: ${status.toLowerCase()}${note ? ' - ' + note : ''}`, x.entity === 'scholarship' ? '#/intakes' : x.entity === 'profile' ? '#/profile' : '#/courses');
}
const merge = (payload, edits) => ({ ...payload, ...(edits || {}) });

// ---------- courses ----------
function applyCourse(x, p, by) {
  if (p.archive) { run(`UPDATE courses SET status = 'Archived', active = 0, updated_at = ?, change_source = 'university' WHERE id = ?`, now(), x.course_id); return x.course_id; }
  const campus = p.campus_id ? get('SELECT * FROM campuses WHERE id = ?', p.campus_id) : null;
  const f = { university_id: x.university_id, name: p.name, level: p.level, field_of_study_id: p.field_of_study_id, field: masterName(p.field_of_study_id), campus_id: p.campus_id, city: campus ? campus.city : null,
    duration_months: p.duration_months, duration: p.duration_months % 12 === 0 ? `${p.duration_months / 12} year${p.duration_months > 12 ? 's' : ''}` : `${p.duration_months} months`, language: p.language, course_link: p.course_link,
    tuition_fee: p.tuition_fee, currency: p.currency, tuition_fee_non_eu: null, fee_note: p.fee_note, application_fee: p.application_fee, application_fee_currency: p.application_fee_currency,
    university_course_code: p.university_course_code, description: p.description, seats_for_le: p.seats_for_le, uni_status: p.uni_status, note_for_le: p.note_for_le,
    status: p.uni_status === 'Closed' ? 'Hidden' : 'Published', active: 1, approved: 1, last_verified_on: U.istDate(), change_source: 'university' };
  let id = x.course_id;
  if (id) {
    const old = get('SELECT * FROM courses WHERE id = ?', id);
    for (const k of Object.keys(f)) if (String(old[k] ?? '') !== String(f[k] ?? '') && !['duration', 'last_verified_on'].includes(k)) insert('course_change_history', { id: uuid(), course_id: id, field: k, old_value: old[k] === null ? null : String(old[k]), new_value: f[k] === null ? null : String(f[k]), changed_by: by, changed_at: now() });
    update('courses', id, f, by);
  } else {
    const n = get(`SELECT COUNT(*) c FROM courses WHERE course_code IS NOT NULL`).c + 1;
    id = insert('courses', { ...f, course_code: `LE-C-${String(n).padStart(5, '0')}` }, by);
  }
  run('UPDATE course_english_requirements SET is_deleted = 1 WHERE course_id = ?', id);
  for (const e of p.english || []) insert('course_english_requirements', { course_id: id, test_type: e.test_type, min_overall: e.min_overall, min_band: e.min_band, moi_accepted: p.moi_accepted ? 1 : 0, min_12th_english_percent: p.min_12th_english_percent }, by);
  if (!(p.english || []).length && p.moi_accepted) insert('course_english_requirements', { course_id: id, test_type: null, moi_accepted: 1, min_12th_english_percent: p.min_12th_english_percent }, by);
  const ie = (p.english || []).find(e => /IELTS/.test(e.test_type)); run('UPDATE courses SET min_english = ? WHERE id = ?', ie ? ie.min_overall : null, id);
  const ac = get('SELECT id FROM course_academic_requirements WHERE course_id = ?', id);
  const af = { required_level: p.required_level, min_percent: p.min_percent, note: p.academic_note, entrance_test: p.entrance_test && p.entrance_test !== 'None' ? p.entrance_test : null, min_work_months: p.min_work_months, is_deleted: 0 };
  if (ac) update('course_academic_requirements', ac.id, af, by); else insert('course_academic_requirements', { course_id: id, ...af }, by);
  // intakes: keep ids (applications reference course_intake_id)
  const old = all('SELECT * FROM course_intakes WHERE course_id = ? AND is_deleted = 0', id); const keep = new Set();
  const changes = [];
  for (const i of p.intakes || []) {
    const master = i.intake_id ? { id: i.intake_id } : (i.month && i.year ? get('SELECT id FROM intakes WHERE month = ? AND year = ? AND is_deleted = 0', i.month, i.year) : null);
    const o = old.find(z => (i.id && z.id === i.id) || (master && z.intake_id === master.id) || (z.month && z.month === i.month && z.year === i.year));
    const fi = { intake_id: master ? master.id : null, month: i.month, year: i.year, every_year: i.every_year ? 1 : 0, open_date: i.open_date, deadline: i.deadline, deadline_note: i.deadline_note, status: i.status, closed_reason: i.closed_reason, is_deleted: 0 };
    if (o) { if (o.deadline !== fi.deadline || (o.status || 'Open') !== fi.status) changes.push({ ci: o.id, intake_id: fi.intake_id, deadline: fi.deadline, closed: fi.status === 'Closed' }); update('course_intakes', o.id, fi, by); keep.add(o.id); }
    else { const nid = insert('course_intakes', { course_id: id, ...fi }, by); keep.add(nid); }
    if (!master && i.month && i.year) for (const a of U.admins()) notify(a, 'university', `New intake ${i.month}/${i.year} used by a university course is not in the Intakes master`, '#/admin/masters/intakes');
  }
  for (const o of old) if (!keep.has(o.id)) run('UPDATE course_intakes SET is_deleted = 1 WHERE id = ?', o.id);
  // counsellors with affected applications / Apply Now requests (4.5)
  for (const ch of changes) {
    const affected = all(`SELECT a.id, a.student_id, s.primary_counsellor_id FROM applications a JOIN students s ON s.id = a.student_id WHERE a.course_id = ? AND a.is_deleted = 0 AND a.stage IN ('documents_pending','ready_to_apply') ${ch.intake_id ? 'AND a.intake_id = ?' : ''}`, ...[id, ...(ch.intake_id ? [ch.intake_id] : [])]);
    const reqs = all(`SELECT q.*, s.primary_counsellor_id cid, l.assigned_user_id lid FROM application_requests q LEFT JOIN students s ON s.id = q.student_id LEFT JOIN leads l ON l.id = q.lead_id WHERE q.course_id = ? AND q.status IN ('Requested by student','In review','Info needed')`, id);
    const msg = `${ch.closed ? 'Intake closed' : 'Deadline changed'} for ${p.name}${ch.intake_id ? ' ' + masterName(ch.intake_id) : ''}${ch.closed ? '' : ' to ' + fmtDate(ch.deadline)}`;
    for (const c of new Set([...affected.map(a => a.primary_counsellor_id), ...reqs.map(q => q.cid || q.lid)].filter(Boolean))) notify(c, 'university', msg, '#/applications');
  }
  if (p.uni_status === 'Closed') run('UPDATE course_intakes SET status = ? WHERE course_id = ?', 'Closed', id);
  return id;
}
function approveCourse(reqId, admin, edits, opts = {}) {
  const x = get('SELECT * FROM course_change_requests WHERE id = ?', reqId);
  if (!x || x.status !== 'Pending approval') throw U.bad('This request is not waiting for approval');
  const p = merge(C.parseJ(x.payload_json, {}), edits);
  let target;
  tx(() => {
    if (x.entity === 'course') target = applyCourse(x, p, admin ? admin.id : null);
    else if (x.entity === 'campus') target = applyCampus(x, p, admin ? admin.id : null);
    else if (x.entity === 'scholarship') target = applyScholarship(x, p, admin ? admin.id : null);
    const st = edits && Object.keys(edits).length ? 'Approved with edits' : 'Approved';
    run(`UPDATE course_change_requests SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, final_json = ?, auto_approved = ?, course_id = COALESCE(course_id, ?) WHERE id = ?`,
      st, admin ? admin.id : null, now(), opts.note || null, JSON.stringify(p), opts.auto ? 1 : 0, x.entity === 'course' ? target : null, x.id);
  });
  const summary = `${x.change_type}: ${p.name || ''}`;
  e39(x, opts.auto ? 'Approved' : (edits && Object.keys(edits).length ? 'Approved with edits' : 'Approved'), opts.note, summary);
  return target;
}
function rejectRequest(reqId, admin, reason) {
  if (!U.clean(reason)) throw U.fieldErr('reason', 'Reason is required (visible to the university)');
  const x = get('SELECT * FROM course_change_requests WHERE id = ?', reqId);
  if (!x || x.status !== 'Pending approval') throw U.bad('This request is not waiting for approval');
  run(`UPDATE course_change_requests SET status = 'Rejected', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?`, admin.id, now(), U.clean(reason, 500), x.id);
  e39(x, 'Rejected', U.clean(reason, 500), `${x.change_type}: ${C.parseJ(x.payload_json, {}).name || ''}`);
}
function applyCampus(x, p, by) {
  let id = x.course_id;
  if (p.is_main) run('UPDATE campuses SET is_main = 0 WHERE university_id = ?', x.university_id);
  const f = { name: p.name, city: p.city, address: p.address, map_link: p.map_link, is_main: p.is_main ? 1 : 0, status: p.status };
  if (id) update('campuses', id, f, by); else id = insert('campuses', { university_id: x.university_id, ...f }, by);
  if (!get('SELECT 1 x FROM campuses WHERE university_id = ? AND is_main = 1 AND is_deleted = 0', x.university_id)) run('UPDATE campuses SET is_main = 1 WHERE id = ?', id);
  return id;
}
function applyScholarship(x, p, by) {
  let id = x.scholarship_id;
  const f = { name: p.name, description: p.description, benefit_type: p.benefit_type, amount: p.amount, currency: p.currency, percent: p.percent, min_percent: p.min_percent, other_criteria: p.other_criteria,
    applies_json: JSON.stringify(p.applies || {}), deadline: p.deadline, how_apply: p.how_apply, link: p.link, valid_until: p.valid_until, status: 'Live' };
  if (id) update('scholarships', id, f, by); else { const n = get('SELECT COUNT(*) c FROM scholarships').c + 1; id = insert('scholarships', { university_id: x.university_id, code: `LE-SCH-${String(n).padStart(5, '0')}`, ...f }, by); }
  syncScholarshipBadges(x.university_id);
  return id;
}
// "Scholarship available" badge = at least one Live scholarship applies (9.4)
function syncScholarshipBadges(universityId) {
  const today = U.istDate();
  const live = all(`SELECT * FROM scholarships WHERE university_id = ? AND status = 'Live' AND is_deleted = 0 AND (valid_until IS NULL OR valid_until >= ?) AND (deadline IS NULL OR deadline >= ?)`, universityId, today, today);
  for (const c of all('SELECT id, level FROM courses WHERE university_id = ? AND is_deleted = 0', universityId)) {
    const hit = live.find(s => { const a = C.parseJ(s.applies_json, {}); return !a.scope || a.scope === 'all' || (a.scope === 'levels' && (a.levels || []).includes(c.level)) || (a.scope === 'courses' && (a.courses || []).includes(c.id)); });
    run('UPDATE courses SET scholarship = ?, scholarship_text = COALESCE(?, scholarship_text) WHERE id = ?', hit ? 1 : 0, hit ? hit.name : null, c.id);
  }
}
function scholarshipsForCourse(course) {
  const today = U.istDate();
  return all(`SELECT * FROM scholarships WHERE university_id = ? AND status = 'Live' AND is_deleted = 0 AND (valid_until IS NULL OR valid_until >= ?) AND (deadline IS NULL OR deadline >= ?)`, course.university_id, today, today)
    .filter(s => { const a = C.parseJ(s.applies_json, {}); return !a.scope || a.scope === 'all' || (a.scope === 'levels' && (a.levels || []).includes(course.level)) || (a.scope === 'courses' && (a.courses || []).includes(course.id)); })
    .map(s => ({ name: s.name, benefit: s.benefit_type === 'Fixed amount' ? `${s.amount} ${s.currency}` : s.benefit_type === 'Percentage of tuition' ? `${s.percent}% of tuition` : s.benefit_type, deadline: s.deadline,
      eligibility: [s.min_percent ? `Minimum ${s.min_percent}%` : null, s.other_criteria].filter(Boolean).join('. '), how: s.how_apply }));
}

// ---------- profile ----------
function approveProfile(reqId, admin, fields, edits, note) {
  const x = get('SELECT * FROM uni_profile_requests WHERE id = ?', reqId);
  if (!x || x.status !== 'Pending') throw U.bad('This request is not waiting for approval');
  const p = merge(C.parseJ(x.payload_json, {}), edits);
  const pick = (k) => !fields || !fields.length || fields.includes(k);
  const f = {};
  for (const k of ['name', 'short_name', 'city', 'website', 'intl_page', 'about', 'founded_year', 'students_count']) if (pick(k) && p[k] !== undefined) f[k] = p[k];
  if (pick('uni_type') && p.uni_type) { f.uni_type = p.uni_type; f.type = p.uni_type; }
  for (const k of ['languages', 'rankings', 'accreditations', 'social']) if (pick(k) && p[k] !== undefined) f[k + '_json'] = JSON.stringify(p[k]);
  tx(() => {
    if (Object.keys(f).length) update('universities', x.university_id, f, admin.id);
    if (pick('logo') && p.logo_key) {
      const LOGOS = path.join(DATA_DIR, 'storage', 'logos'); fs.mkdirSync(LOGOS, { recursive: true });
      const src = files.filePath(p.logo_key); const key = `${x.university_id}_${Date.now()}.png`;
      require('sharp')(require('../vault').read(src)).resize(256, 256, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toFile(path.join(LOGOS, key)).then(() => run('UPDATE universities SET logo_key = ?, logo_updated_at = ? WHERE id = ?', key, now(), x.university_id)).catch(e => console.error('[logo]', e.message));
    }
    if (pick('cover') && p.cover_key) run('UPDATE universities SET cover_key = ? WHERE id = ?', p.cover_key, x.university_id);
    run(`UPDATE uni_profile_requests SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, final_json = ? WHERE id = ?`, edits && Object.keys(edits).length ? 'Approved with edits' : 'Approved', admin.id, now(), note || null, JSON.stringify({ ...p, approved_fields: fields || 'all' }), x.id);
  });
  e39({ ...x, entity: 'profile' }, edits && Object.keys(edits).length ? 'Approved with edits' : 'Approved', note, 'University profile');
}
function rejectProfile(reqId, admin, reason) {
  if (!U.clean(reason)) throw U.fieldErr('reason', 'Reason is required (visible to the university)');
  const x = get('SELECT * FROM uni_profile_requests WHERE id = ?', reqId); if (!x || x.status !== 'Pending') throw U.bad('This request is not waiting for approval');
  run(`UPDATE uni_profile_requests SET status = 'Rejected', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?`, admin.id, now(), U.clean(reason, 500), x.id);
  e39({ ...x, entity: 'profile' }, 'Rejected', U.clean(reason, 500), 'University profile');
}

module.exports = { approveCourse, rejectRequest, approveProfile, rejectProfile, syncScholarshipBadges, scholarshipsForCourse, applyCourse };
