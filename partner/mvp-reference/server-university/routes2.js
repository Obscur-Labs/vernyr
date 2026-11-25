'use strict';
const VAULT = require('../vault'); // files are stored AES-256-GCM encrypted
// University portal API part 2: profile, campuses, contacts, courses + approvals, bulk upload, intakes, scholarships, announcements,
// reports, commission & invoices (finance only), users (University Admin), my account, audit view.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const express = require('express');
const ExcelJS = require('exceljs');
const { all, get, run, insert, update, uuid, now, getSetting, tx, DATA_DIR } = require('../db');
const U = require('../util');
const { bad, ah, clean, num, masterName, fullName, fmtDate, fmtDateTime, notify, isEmail } = U;
const files = require('../files');
const C = require('./common');
const UE = require('./uemail');
const UA = require('./auth');
const CAT = require('../portal/catalogue');

const r = express.Router();
// true only for an https URL whose host resolves to PUBLIC addresses (blocks localhost, private LAN, link-local / cloud metadata)
async function publicHttps(u) {
  let url; try { url = new URL(String(u || '')); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const net = require('net'); let addrs;
  try { addrs = net.isIP(url.hostname.replace(/^\[|\]$/g, '')) ? [{ address: url.hostname.replace(/^\[|\]$/g, '') }] : await require('dns').promises.lookup(url.hostname, { all: true }); } catch { return false; }
  const priv = (a) => /^(127\.|10\.|0\.|169\.254\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a) || /^(::1?$|f[cd]|fe80:|::ffff:(127|10|192\.168|169\.254)\.)/i.test(a);
  return addrs.length > 0 && !addrs.some(x => priv(x.address));
}
const role = (req, ...roles) => { if (!roles.includes(req.uu.role)) throw new U.HttpError(403, 'Your role does not allow this action.'); };
const finance = (req) => { if (!(req.uu.finance || req.uu.role === 'admin')) throw C.NotFound(); };
const canProposeCourses = (req) => req.uu.role === 'admin' || (req.uu.role === 'officer' && req.uni.officers_propose);
const LEVELS = ['Bachelor', 'Master', 'MBA', 'PhD', 'Diploma', 'Foundation', 'Language course'];
const LANGS = ['English', 'French', 'German', 'Italian', 'Spanish', 'Dutch', 'Chinese', 'Other'];
const TESTS = { 'IELTS Academic': [0, 9, 0.5], 'TOEFL iBT': [0, 120, 1], 'PTE Academic': [10, 90, 1], Duolingo: [10, 160, 5], Other: [0, 1000, 0.01] };
const admins = () => U.admins();
const notifyAdmins = (title, link) => { for (const a of admins()) notify(a, 'university', title, link); };

// ---------- profile (3) ----------
const PROFILE_FIELDS = ['name', 'short_name', 'city', 'uni_type', 'website', 'intl_page', 'about', 'founded_year', 'students_count', 'languages', 'rankings', 'accreditations', 'social'];
function liveProfile(u) {
  return { name: u.name, short_name: u.short_name, city: u.city, uni_type: u.uni_type || u.type, website: u.website, intl_page: u.intl_page, about: u.about, founded_year: u.founded_year, students_count: u.students_count,
    languages: C.parseJ(u.languages_json, []), rankings: C.parseJ(u.rankings_json, []), accreditations: C.parseJ(u.accreditations_json, []), social: C.parseJ(u.social_json, []), logo: CAT.logoUrl(u), country: masterName(u.country_id) };
}
function profileErrors(p) {
  const e = {};
  if (!clean(p.name)) e.name = 'University name is required'; else if (p.name.length > 200) e.name = 'Max 200 characters';
  if (p.short_name && p.short_name.length > 30) e.short_name = 'Max 30 characters';
  if (!clean(p.city)) e.city = 'Main city is required';
  if (!['Public', 'Private'].includes(p.uni_type)) e.uni_type = 'Choose Public or Private';
  if (!/^https:\/\//i.test(p.website || '')) e.website = 'Website must start with https://';
  if (p.intl_page && !/^https:\/\//i.test(p.intl_page)) e.intl_page = 'Link must start with https://';
  const about = String(p.about || '').replace(/<[^>]*>/g, '');
  if (about.length < 100 || about.length > 3000) e.about = 'About must be 100 to 3000 characters';
  if (p.founded_year && !(Number(p.founded_year) >= 1000 && Number(p.founded_year) <= new Date().getFullYear())) e.founded_year = 'Enter a valid year';
  for (const x of p.rankings || []) if (x.link && !/^https:\/\//i.test(x.link)) e.rankings = 'Ranking links must start with https://';
  return e;
}
const safeAbout = (h) => String(h || '').replace(/<(?!\/?(b|strong|i|em|ul|ol|li|br|p|a)(\s|>|\/))[^>]*>/gi, '').replace(/\son\w+="[^"]*"/gi, '').replace(/<a\s+[^>]*href="(?!https:\/\/)[^"]*"[^>]*>/gi, '<a>').replace(/<a\s+href="(https:\/\/[^"]+)"[^>]*>/gi, '<a href="$1" target="_blank" rel="noopener">');
r.get('/profile', ah(async (req, res) => {
  const u = req.uni;
  const pend = get(`SELECT * FROM uni_profile_requests WHERE university_id = ? AND status = 'Pending' ORDER BY created_at DESC LIMIT 1`, u.id);
  const last = get(`SELECT status, review_note, reviewed_at FROM uni_profile_requests WHERE university_id = ? AND status IN ('Approved','Approved with edits','Rejected') ORDER BY reviewed_at DESC LIMIT 1`, u.id);
  res.json({ live: liveProfile(u), pending: pend ? { id: pend.id, payload: C.parseJ(pend.payload_json, {}), created_at: pend.created_at } : null, last_decision: last || null,
    campuses: all('SELECT * FROM campuses WHERE university_id = ? AND is_deleted = 0 ORDER BY is_main DESC, name', u.id),
    contacts: all('SELECT * FROM uni_contacts WHERE university_id = ? AND is_deleted = 0 ORDER BY department, is_primary DESC', u.id),
    can_edit: req.uu.role === 'admin' && !req.preview, can_edit_contacts: req.uu.role === 'admin' || (req.uu.role === 'officer' && getSetting('uni_officers_edit_contacts') === '1') });
}));
r.post('/profile/request', files.upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), ah(async (req, res) => {
  const fl = req.files || {}; const cleanup = () => { for (const k of Object.keys(fl)) fl[k].forEach(files.cleanup); };
  try {
    role(req, 'admin');
    const p = C.parseJ(req.body.payload, {});
    for (const k of ['rankings', 'accreditations', 'social', 'languages']) if (!Array.isArray(p[k])) p[k] = [];
    const errors = profileErrors(p); if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
    p.about = safeAbout(p.about);
    const keep = Object.fromEntries(PROFILE_FIELDS.map(k => [k, p[k] ?? null]));
    for (const [k, list] of Object.entries(fl)) {
      const f = list[0]; const { ext } = files.checkFile(f, ['png', 'jpg', 'jpeg'], k === 'logo' ? 2 : 3);
      if (k === 'logo') { const meta = await require('sharp')(f.path).metadata(); if (meta.width < 200 || meta.height < 200) throw U.fieldErr('logo', 'Logo must be at least 200 x 200 pixels'); }
      const key = `unireq_${k}_${uuid()}.${ext}`; VAULT.moveIn(f.path, files.filePath(key)); keep[k + '_key'] = key;
    }
    const pend = get(`SELECT * FROM uni_profile_requests WHERE university_id = ? AND status = 'Pending'`, req.uu.university_id);
    if (pend) { const old = C.parseJ(pend.payload_json, {}); update('uni_profile_requests', pend.id, { payload_json: JSON.stringify({ ...old, ...keep, logo_key: keep.logo_key || old.logo_key, cover_key: keep.cover_key || old.cover_key }), requested_by: req.uu.id }); }
    else insert('uni_profile_requests', { university_id: req.uu.university_id, payload_json: JSON.stringify(keep), old_json: JSON.stringify(liveProfile(req.uni)), status: 'Pending', requested_by: req.uu.id, created_by_type: 'university' });
    notifyAdmins(`${C.uniName(req.uni)} submitted profile changes for approval`, '#/admin/uni-approvals');
    C.uaudit(req, 'Create', 'UniversityProfileChangeRequest', req.uu.university_id, 'Profile change submitted');
    res.json({ ok: true, message: 'Changes sent to La Europa for approval. Students keep seeing the current profile until then.' });
  } catch (e) { cleanup(); throw e; }
}));
r.post('/profile/request/withdraw', ah(async (req, res) => { role(req, 'admin'); run(`UPDATE uni_profile_requests SET status = 'Withdrawn', updated_at = ? WHERE university_id = ? AND status = 'Pending'`, now(), req.uu.university_id); C.uaudit(req, 'Update', 'UniversityProfileChangeRequest', null, 'Withdrawn'); res.json({ ok: true }); }));
// campuses: changes go through approval like the profile (3.5); stored as entity 'campus' change requests
r.post('/campuses', ah(async (req, res) => {
  role(req, 'admin');
  const b = req.body; const e = {};
  if (!clean(b.name)) e.name = 'Campus name is required'; if (!clean(b.city)) e.city = 'City is required';
  if (b.map_link && !/^https:\/\//i.test(b.map_link)) e.map_link = 'Link must start with https://';
  if (Object.keys(e).length) throw bad('Please fix the highlighted fields', { errors: e });
  const payload = { name: clean(b.name, 150), city: clean(b.city, 100), address: clean(b.address, 300), map_link: clean(b.map_link, 300), is_main: !!b.is_main, status: b.status === 'Inactive' ? 'Inactive' : 'Active' };
  const cur = b.id ? get('SELECT * FROM campuses WHERE id = ? AND university_id = ?', b.id, req.uu.university_id) : null; if (b.id && !cur) throw C.NotFound();
  insert('course_change_requests', { university_id: req.uu.university_id, entity: 'campus', course_id: cur ? cur.id : null, change_type: cur ? 'Edit campus' : 'New campus', payload_json: JSON.stringify(payload), old_json: cur ? JSON.stringify(cur) : null,
    status: 'Pending approval', requested_by: req.uu.id, created_by_type: 'university' });
  notifyAdmins(`${C.uniName(req.uni)} submitted a campus change`, '#/admin/uni-approvals');
  C.uaudit(req, 'Create', 'CampusChangeRequest', cur ? cur.id : null, payload.name); res.json({ ok: true, message: 'Sent to La Europa for approval.' });
}));
// contacts go live directly, La Europa is notified (3.4)
r.post('/contacts', ah(async (req, res) => {
  if (!(req.uu.role === 'admin' || (req.uu.role === 'officer' && getSetting('uni_officers_edit_contacts') === '1'))) throw new U.HttpError(403, 'Your role does not allow this action.');
  const b = req.body; const e = {};
  const DEPTS = ['Admissions', 'International Office', 'Finance / Accounts', 'Scholarships', 'Accommodation', 'Visa / Immigration support', 'Marketing', 'Other'];
  if (!DEPTS.includes(b.department)) e.department = 'Choose a department'; if (!clean(b.name)) e.name = 'Name is required'; if (!isEmail(b.email)) e.email = 'Valid email is required';
  if (Object.keys(e).length) throw bad('Please fix the highlighted fields', { errors: e });
  const f = { department: b.department, name: clean(b.name, 100), designation: clean(b.designation, 100), email: String(b.email).trim().toLowerCase(), phone: clean(b.phone, 30), is_primary: b.is_primary ? 1 : 0,
    uni_user_id: b.uni_user_id && get('SELECT 1 x FROM uni_users WHERE id = ? AND university_id = ?', b.uni_user_id, req.uu.university_id) ? b.uni_user_id : null, updated_by_type: 'university' };
  let id = b.id;
  if (id) { const c = get('SELECT * FROM uni_contacts WHERE id = ? AND university_id = ?', id, req.uu.university_id); if (!c) throw C.NotFound(); if (b.delete) run('UPDATE uni_contacts SET is_deleted = 1, deleted_at = ? WHERE id = ?', now(), id); else update('uni_contacts', id, f); }
  else id = insert('uni_contacts', { university_id: req.uu.university_id, ...f, created_by_type: 'university' });
  if (f.is_primary && !b.delete) run('UPDATE uni_contacts SET is_primary = 0 WHERE university_id = ? AND department = ? AND id != ?', req.uu.university_id, f.department, id);
  for (const x of new Set([req.uni.partner_manager_id, ...admins()].filter(Boolean))) notify(x, 'university', `${C.uniName(req.uni)} updated a ${f.department} contact`, '#/admin/university');
  C.uaudit(req, b.delete ? 'Delete' : b.id ? 'Update' : 'Create', 'UniversityContact', id, f.name); res.json({ ok: true });
}));

// ---------- courses (4) ----------
function courseOut(c) {
  const pend = get(`SELECT id, change_type, created_at, status FROM course_change_requests WHERE course_id = ? AND entity = 'course' AND status IN ('Draft','Pending approval') AND is_deleted = 0 ORDER BY created_at DESC LIMIT 1`, c.id);
  const lastOk = get(`SELECT reviewed_at FROM course_change_requests WHERE course_id = ? AND status IN ('Approved','Approved with edits') ORDER BY reviewed_at DESC LIMIT 1`, c.id);
  const intakes = all('SELECT ci.*, i.name iname FROM course_intakes ci LEFT JOIN intakes i ON i.id = ci.intake_id WHERE ci.course_id = ? AND ci.is_deleted = 0 ORDER BY ci.deadline', c.id)
    .map(i => ({ id: i.id, label: i.iname || `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(i.month || 1) - 1]} ${i.every_year ? '(every year)' : i.year || ''}`, intake_id: i.intake_id, month: i.month, year: i.year,
      every_year: !!i.every_year, open_date: i.open_date, deadline: i.deadline, deadline_note: i.deadline_note, status: i.status || 'Open', closed_reason: i.closed_reason, open: (i.status || 'Open') === 'Open' && (!i.deadline || i.deadline >= U.istDate()) }));
  return { id: c.id, code: c.course_code, name: c.name, level: c.level, field: masterName(c.field_of_study_id), field_of_study_id: c.field_of_study_id, campus_id: c.campus_id, campus: c.campus_id ? (get('SELECT name FROM campuses WHERE id = ?', c.campus_id) || {}).name : null,
    intakes, tuition_fee: c.tuition_fee, currency: c.currency, fee_note: c.fee_note, application_fee: c.application_fee, application_fee_currency: c.application_fee_currency, course_link: c.course_link,
    duration_months: c.duration_months, language: c.language, university_course_code: c.university_course_code, description: c.description, uni_status: c.uni_status || 'Active', seats_for_le: c.seats_for_le, note_for_le: c.note_for_le,
    catalogue_status: pend ? 'Pending approval' : ({ Published: 'Live', Hidden: 'Closed', Archived: 'Archived' }[c.status] || 'Draft'), pending: pend || null, last_approved_on: lastOk ? lastOk.reviewed_at : null,
    english: all('SELECT test_type, min_overall, min_band, moi_accepted, min_12th_english_percent FROM course_english_requirements WHERE course_id = ? AND is_deleted = 0', c.id),
    academic: get('SELECT required_level, min_percent, min_work_months, entrance_test, note FROM course_academic_requirements WHERE course_id = ? AND is_deleted = 0', c.id) || null,
    scholarship: !!c.scholarship, changed_by: c.change_source || null };
}
r.get('/courses', ah(async (req, res) => {
  const q = req.query; const where = ['university_id = ?', 'is_deleted = 0']; const p = [req.uu.university_id];
  if (q.level) { where.push('level = ?'); p.push(q.level); } if (q.campus) { where.push('campus_id = ?'); p.push(q.campus); } if (q.field) { where.push('field_of_study_id = ?'); p.push(q.field); }
  if (q.q) { where.push('(lower(name) LIKE ? OR course_code LIKE ? OR lower(COALESCE(university_course_code,\'\')) LIKE ?)'); const t = `%${String(q.q).toLowerCase()}%`; p.push(t, `%${String(q.q).toUpperCase()}%`, t); }
  if (q.uni_status) { where.push(`COALESCE(uni_status,'Active') = ?`); p.push(q.uni_status); }
  let rows = all(`SELECT * FROM courses WHERE ${where.join(' AND ')} ORDER BY name`, ...p).map(courseOut);
  if (q.catalogue_status) rows = rows.filter(x => x.catalogue_status === q.catalogue_status);
  if (q.pending === '1') rows = rows.filter(x => x.pending);
  const reqs = all(`SELECT id, course_id, entity, change_type, status, review_note, created_at, reviewed_at, urgent FROM course_change_requests WHERE university_id = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 100`, req.uu.university_id)
    .map(x => ({ ...x, course: x.course_id ? (get('SELECT name FROM courses WHERE id = ?', x.course_id) || {}).name : null }));
  const pendNew = all(`SELECT id, payload_json, status, created_at FROM course_change_requests WHERE university_id = ? AND course_id IS NULL AND entity = 'course' AND status IN ('Draft','Pending approval') AND is_deleted = 0`, req.uu.university_id)
    .map(x => ({ id: x.id, name: C.parseJ(x.payload_json, {}).name, status: x.status, created_at: x.created_at }));
  res.json({ rows, requests: reqs, new_pending: pendNew, can_propose: canProposeCourses(req) && !req.preview,
    options: { levels: LEVELS, languages: LANGS, tests: Object.keys(TESTS), fields: all(`SELECT id, name FROM master_items WHERE type = 'field_of_study' AND active = 1 AND is_deleted = 0 ORDER BY sort, name`),
      campuses: all(`SELECT id, name, city, status FROM campuses WHERE university_id = ? AND is_deleted = 0`, req.uu.university_id), currencies: all(`SELECT name FROM master_items WHERE type = 'currency' AND is_deleted = 0 ORDER BY sort`).map(x => x.name),
      intakes: all('SELECT id, name, month, year FROM intakes WHERE active = 1 AND is_deleted = 0 ORDER BY year, month') } });
}));
r.get('/courses/:id', ah(async (req, res) => { const c = get('SELECT * FROM courses WHERE id = ? AND is_deleted = 0', req.params.id); if (!c || c.university_id !== req.uu.university_id) throw C.NotFound(); res.json(courseOut(c)); }));
// validation V1 - V8
function validateCourse(uniId, b, courseId) {
  const e = {}; const warn = [];
  if (!clean(b.name)) e.name = 'Course name is required'; else if (b.name.length > 200) e.name = 'Max 200 characters';
  if (!LEVELS.includes(b.level)) e.level = 'Choose the level';
  if (b.name && b.level && get(`SELECT 1 x FROM courses WHERE university_id = ? AND lower(trim(name)) = lower(trim(?)) AND level = ? AND is_deleted = 0 AND id != ?`, uniId, b.name, b.level, courseId || '-')) {
    const ex = get(`SELECT course_code FROM courses WHERE university_id = ? AND lower(trim(name)) = lower(trim(?)) AND level = ? AND is_deleted = 0`, uniId, b.name, b.level); e.name = `This course already exists: ${ex.course_code}`; }
  if (!/^https:\/\//i.test(b.course_link || '')) e.course_link = 'Please enter a full secure link starting with https://';
  if (num(b.tuition_fee) === null || num(b.tuition_fee) < 0) e.tuition_fee = 'Tuition fee (per year) is required, 0 or more';
  if (!b.currency) e.currency = 'Currency is required';
  if (num(b.application_fee) === null || num(b.application_fee) < 0) e.application_fee = 'Application fee is required (0 = free)';
  if (b.fee_note && b.fee_note.length > 200) e.fee_note = 'Max 200 characters';
  Object.assign(e, C.feeWordCheck({ fee_note: b.fee_note, tuition_fee: b.tuition_fee_label }));
  if (!['12th', 'Diploma', 'Bachelor', 'Master'].includes(b.required_level)) e.required_level = 'Choose the previous level';
  if (!/^\d+(\.\d+)?$/.test(String(b.min_percent ?? '').trim()) || Number(b.min_percent) < 0 || Number(b.min_percent) > 100) e.min_percent = 'Please enter a percentage between 0 and 100.';
  const eng = (Array.isArray(b.english) ? b.english : []).filter(x => x && x.test_type);
  const moi = b.moi_accepted === true || b.moi_accepted === 'Yes' || b.moi_accepted === 'true';
  if (!eng.length && !moi) e.english = 'Add at least one English test or tick MOI accepted';
  for (const x of eng) { const rg = TESTS[x.test_type]; if (!rg) { e.english = `Unknown test ${x.test_type}`; continue; }
    if (num(x.min_overall) === null || num(x.min_overall) < rg[0] || num(x.min_overall) > rg[1]) e.english = `${x.test_type} score must be between ${rg[0]} and ${rg[1]}`;
    if (x.min_band !== null && x.min_band !== undefined && x.min_band !== '' && (num(x.min_band) < rg[0] || num(x.min_band) > rg[1])) e.english = `${x.test_type} band must be between ${rg[0]} and ${rg[1]}`; }
  if (!b.field_of_study_id || !get(`SELECT 1 x FROM master_items WHERE id = ? AND type = 'field_of_study'`, b.field_of_study_id)) e.field_of_study_id = 'Choose the field of study';
  if (!b.campus_id || !get(`SELECT 1 x FROM campuses WHERE id = ? AND university_id = ? AND status = 'Active' AND is_deleted = 0`, b.campus_id, uniId)) e.campus_id = 'Choose an active campus';
  if (!(num(b.duration_months) >= 1 && num(b.duration_months) <= 96)) e.duration_months = 'Duration must be 1 to 96 months';
  if (!LANGS.includes(b.language)) e.language = 'Choose the language';
  const ints = (Array.isArray(b.intakes) ? b.intakes : []).filter(i => i && (i.month || i.intake_id));
  if (!ints.length) e.intakes = 'Add at least one intake';
  for (const i of ints) { if (!i.deadline) e.intakes = 'Every intake needs an application deadline'; else if (i.open_date && i.open_date > i.deadline) e.intakes = 'Deadline must be after the open date';
    if (i.status === 'Closed' && !i.closed_reason) e.intakes = 'Give the closed reason for closed intakes'; }
  if (b.description && b.description.length > 1500) e.description = 'Max 1500 characters';
  if (b.description && C.feeWordNear(b.description)) warn.push('Fee wording: please show the amount only.');
  if (!['Active', 'Closed'].includes(b.uni_status || 'Active')) e.uni_status = 'Choose Active or Closed';
  return { errors: e, warnings: warn, english: eng, moi, intakes: ints };
}
function payloadOf(b, v) {
  return { name: clean(b.name, 200), level: b.level, field_of_study_id: b.field_of_study_id, campus_id: b.campus_id, duration_months: num(b.duration_months), language: b.language, course_link: clean(b.course_link, 500),
    tuition_fee: num(b.tuition_fee), currency: b.currency, fee_note: clean(b.fee_note, 200), application_fee: num(b.application_fee), application_fee_currency: b.application_fee_currency || b.currency,
    required_level: b.required_level, min_percent: Number(b.min_percent), academic_note: clean(b.academic_note, 300), moi_accepted: v.moi, min_12th_english_percent: num(b.min_12th_english_percent),
    english: v.english.map(x => ({ test_type: x.test_type, min_overall: num(x.min_overall), min_band: x.min_band === '' ? null : num(x.min_band) })),
    intakes: v.intakes.map(i => ({ id: i.id || null, intake_id: i.intake_id || null, month: num(i.month), year: num(i.year), every_year: !!i.every_year, open_date: i.open_date || null, deadline: i.deadline, deadline_note: clean(i.deadline_note, 200), status: i.status === 'Closed' ? 'Closed' : 'Open', closed_reason: i.status === 'Closed' ? clean(i.closed_reason, 60) : null })),
    university_course_code: clean(b.university_course_code, 50), description: clean(b.description, 1500), entrance_test: b.entrance_test || null, min_work_months: num(b.min_work_months),
    seats_for_le: num(b.seats_for_le), uni_status: b.uni_status === 'Closed' ? 'Closed' : 'Active', note_for_le: clean(b.note_for_le, 1000) };
}
// urgent = close course / close intake / deadline moved earlier (4.5)
function urgency(c, p) {
  if (!c) return null;
  if (p.uni_status === 'Closed' && (c.uni_status || 'Active') !== 'Closed') return 'Course closed';
  const old = all('SELECT * FROM course_intakes WHERE course_id = ? AND is_deleted = 0', c.id);
  for (const i of p.intakes) { const o = old.find(x => (i.id && x.id === i.id) || (x.intake_id && x.intake_id === i.intake_id) || (x.month === i.month && x.year === i.year)); if (!o) continue;
    if (i.status === 'Closed' && (o.status || 'Open') !== 'Closed') return 'Intake closed'; if (o.deadline && i.deadline && i.deadline < o.deadline) return `Deadline moved earlier (${fmtDate(o.deadline)} to ${fmtDate(i.deadline)})`; }
  return null;
}
function submitCourseChange(req, c, p, warnings, batchId, draft) {
  const type = !c ? 'New course' : p.uni_status === 'Closed' && (c.uni_status || 'Active') !== 'Closed' ? 'Close course' : p.uni_status === 'Active' && c.uni_status === 'Closed' ? 'Re-open course' : 'Edit course';
  const urgent = urgency(c, p);
  // auto-approve minor changes (4.8): only description / fee note / course link changed
  const minor = c && getSetting('uni_auto_approve_minor') === '1' && !draft && (() => { const cur = courseOut(c); const diff = ['description', 'fee_note', 'course_link'];
    const same = (k) => JSON.stringify(cur[k] ?? null) === JSON.stringify(p[k] ?? null); return Object.keys(p).filter(k => !['english', 'intakes', 'required_level', 'min_percent', 'academic_note', 'moi_accepted', 'min_12th_english_percent', 'entrance_test', 'min_work_months'].includes(k)).every(k => diff.includes(k) || same(k)); })();
  const pend = c ? get(`SELECT * FROM course_change_requests WHERE course_id = ? AND entity = 'course' AND status IN ('Draft','Pending approval') AND is_deleted = 0`, c.id) : null;
  const status = draft ? 'Draft' : 'Pending approval';
  let id;
  if (pend) { update('course_change_requests', pend.id, { payload_json: JSON.stringify(p), change_type: type, urgent: urgent ? 1 : 0, urgent_reason: urgent, warnings_json: JSON.stringify(warnings), status, requested_by: req.uu.id, batch_id: batchId || pend.batch_id }); id = pend.id; }
  else id = insert('course_change_requests', { university_id: req.uu.university_id, course_id: c ? c.id : null, entity: 'course', change_type: type, payload_json: JSON.stringify(p), old_json: c ? JSON.stringify(courseOut(c)) : null,
    status, urgent: urgent ? 1 : 0, urgent_reason: urgent, batch_id: batchId || null, requested_by: req.uu.id, warnings_json: JSON.stringify(warnings), created_by_type: 'university' });
  if (minor) { require('./approvals').approveCourse(id, null, null, { auto: true }); return { id, auto: true }; }
  if (!draft) {
    if (urgent) { for (const a of admins()) notify(a, 'university', `URGENT: ${C.uniName(req.uni)} - ${urgent}: ${p.name}`, '#/admin/uni-approvals');
      UE.staffEmail('E48', admins(), { university_id: req.uu.university_id, ctx: { change_summary: `${type}: ${p.name}`, urgent_reason: urgent } }); }
    else if (!batchId) notifyAdmins(`${C.uniName(req.uni)} submitted a course change: ${p.name}`, '#/admin/uni-approvals');
  }
  return { id, urgent };
}
r.post('/courses', ah(async (req, res) => {
  if (!canProposeCourses(req)) throw new U.HttpError(403, 'Your role does not allow course changes.');
  const b = req.body; const c = b.id ? get('SELECT * FROM courses WHERE id = ? AND is_deleted = 0', b.id) : null;
  if (b.id && (!c || c.university_id !== req.uu.university_id)) throw C.NotFound();
  const v = validateCourse(req.uu.university_id, b, c && c.id);
  if (Object.keys(v.errors).length) throw bad('Please fix the highlighted fields', { errors: v.errors, warnings: v.warnings });
  const p = payloadOf(b, v);
  const out = submitCourseChange(req, c, p, v.warnings, null, b.draft === true);
  // link check (warning only)
  let linkWarning = null;
  // SSRF guard: only public https addresses are checked (never localhost / private / cloud-metadata networks), no redirects followed
  try { if (!(await publicHttps(p.course_link))) throw new Error('not public');
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000); const rr = await fetch(p.course_link, { method: 'HEAD', redirect: 'manual', signal: ctl.signal }); clearTimeout(t); if (rr.status >= 400) linkWarning = 'We could not open this link. Please check.'; } catch { linkWarning = 'We could not open this link. Please check.'; }
  C.uaudit(req, 'Create', 'CourseChangeRequest', out.id, `${c ? 'Edit' : 'New'} course ${p.name}${b.draft ? ' (draft)' : ''}`);
  res.json({ ok: true, ...out, warnings: v.warnings.concat(linkWarning ? [linkWarning] : []), message: out.auto ? 'Minor change published (auto-approved).' : b.draft ? 'Saved as draft.' : 'Sent to La Europa for approval. Students keep seeing the current version until then.' });
}));
r.post('/courses/requests/:id/withdraw', ah(async (req, res) => {
  const x = get(`SELECT * FROM course_change_requests WHERE id = ? AND university_id = ? AND status IN ('Draft','Pending approval')`, req.params.id, req.uu.university_id); if (!x) throw C.NotFound();
  if (!canProposeCourses(req) && req.uu.role !== 'admin') throw new U.HttpError(403, 'Your role does not allow this action.');
  run(`UPDATE course_change_requests SET status = 'Withdrawn', updated_at = ? WHERE id = ?`, now(), x.id); C.uaudit(req, 'Update', 'CourseChangeRequest', x.id, 'Withdrawn'); res.json({ ok: true });
}));
r.get('/courses/requests/:id', ah(async (req, res) => {
  const x = get('SELECT * FROM course_change_requests WHERE id = ? AND university_id = ?', req.params.id, req.uu.university_id); if (!x) throw C.NotFound();
  res.json({ ...x, payload: C.parseJ(x.payload_json, {}), old: C.parseJ(x.old_json, null), final: C.parseJ(x.final_json, null) });
}));
// V8: delete only when no active La Europa applications; otherwise close
r.post('/courses/:id/delete', ah(async (req, res) => {
  role(req, 'admin'); const c = get('SELECT * FROM courses WHERE id = ? AND is_deleted = 0', req.params.id); if (!c || c.university_id !== req.uu.university_id) throw C.NotFound();
  if (get(`SELECT 1 x FROM applications WHERE course_id = ? AND is_deleted = 0 AND stage NOT IN ('rejected','withdrawn','offer_declined','enrolment_confirmed')`, c.id)) throw bad('This course has active applications. You can close it instead.');
  insert('course_change_requests', { university_id: req.uu.university_id, course_id: c.id, entity: 'course', change_type: 'Archive request', payload_json: JSON.stringify({ archive: true, name: c.name }), status: 'Pending approval', requested_by: req.uu.id, created_by_type: 'university' });
  notifyAdmins(`${C.uniName(req.uni)} asked to archive the course ${c.name}`, '#/admin/uni-approvals'); res.json({ ok: true, message: 'Archive request sent to La Europa.' });
}));
// bulk deadline / close intake for many courses (9.2)
r.post('/intakes/bulk', ah(async (req, res) => {
  if (!canProposeCourses(req)) throw new U.HttpError(403, 'Your role does not allow course changes.');
  const ids = (req.body.course_ids || []).slice(0, 300); const act = req.body.action;
  if (!['deadline', 'close'].includes(act)) throw bad('Choose an action');
  if (act === 'deadline' && !req.body.deadline) throw U.fieldErr('deadline', 'Choose the new deadline');
  if (act === 'close' && !req.body.closed_reason) throw U.fieldErr('closed_reason', 'Choose the closed reason');
  const batchId = uuid(); let n = 0;
  insert('uni_import_batches', { id: batchId, university_id: req.uu.university_id, file_name: `Bulk ${act === 'close' ? 'close intake' : 'set deadline'}`, status: 'Submitted', created_by: req.uu.id, created_at: now() });
  for (const id of ids) {
    const c = get('SELECT * FROM courses WHERE id = ? AND university_id = ? AND is_deleted = 0', id, req.uu.university_id); if (!c) continue;
    const cur = courseOut(c);
    const p = payloadOf({ ...cur, required_level: cur.academic && cur.academic.required_level, min_percent: cur.academic ? cur.academic.min_percent : 0, academic_note: cur.academic && cur.academic.note,
      english: cur.english, intakes: cur.intakes.map(i => (!req.body.intake_key || `${i.month}-${i.year}` === req.body.intake_key || i.intake_id === req.body.intake_key) ? { ...i, ...(act === 'deadline' ? { deadline: req.body.deadline } : { status: 'Closed', closed_reason: req.body.closed_reason }) } : i) },
    { moi: cur.english.some(x => x.moi_accepted), english: cur.english.filter(x => x.test_type), intakes: cur.intakes.map(i => (!req.body.intake_key || `${i.month}-${i.year}` === req.body.intake_key || i.intake_id === req.body.intake_key) ? { ...i, ...(act === 'deadline' ? { deadline: req.body.deadline } : { status: 'Closed', closed_reason: req.body.closed_reason }) } : i) });
    submitCourseChange(req, c, p, [], batchId); n++;
  }
  run('UPDATE uni_import_batches SET counts_json = ? WHERE id = ?', JSON.stringify({ Update: n }), batchId);
  notifyAdmins(`${C.uniName(req.uni)} submitted ${n} intake change(s) in one batch`, '#/admin/uni-approvals');
  C.uaudit(req, 'Create', 'CourseChangeBatch', batchId, `Bulk ${act} (${n})`); res.json({ ok: true, count: n });
}));

// ---------- bulk upload (4.7) ----------
const COURSE_COLS = ['university_course_code', 'course_name', 'level', 'field_of_study', 'campus', 'course_link', 'tuition_fee_per_year', 'tuition_currency', 'fee_note', 'application_fee', 'application_fee_currency',
  'previous_level_required', 'academic_min_percentage', 'moi_accepted', 'duration_months', 'language_of_instruction', 'university_status', 'description'];
async function templateWorkbook(uniId, withData) {
  const wb = new ExcelJS.Workbook(); wb.creator = 'La Europa Partner Portal';
  const head = (ws) => { const h = ws.getRow(1); h.font = { bold: true, color: { argb: 'FFFFFFFF' } }; h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1E3A' } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
  const wc = wb.addWorksheet('Courses'); wc.columns = COURSE_COLS.map(k => ({ header: k, key: k, width: Math.max(14, k.length + 2) })); head(wc);
  const wi = wb.addWorksheet('Intakes'); wi.columns = ['course_key', 'intake_month', 'intake_year', 'open_date', 'deadline', 'status'].map(k => ({ header: k, key: k, width: 16 })); head(wi);
  const we = wb.addWorksheet('English'); we.columns = ['course_key', 'test_type', 'min_overall', 'min_band'].map(k => ({ header: k, key: k, width: 16 })); head(we);
  const camps = all('SELECT name FROM campuses WHERE university_id = ? AND is_deleted = 0 AND status = \'Active\'', uniId).map(x => x.name);
  if (withData) {
    for (const c of all('SELECT * FROM courses WHERE university_id = ? AND is_deleted = 0 ORDER BY name', uniId).map(courseOut)) {
      const key = c.university_course_code || c.name;
      wc.addRow({ university_course_code: c.university_course_code, course_name: c.name, level: c.level, field_of_study: c.field, campus: c.campus, course_link: c.course_link, tuition_fee_per_year: c.tuition_fee, tuition_currency: c.currency,
        fee_note: c.fee_note, application_fee: c.application_fee, application_fee_currency: c.application_fee_currency, previous_level_required: c.academic && c.academic.required_level, academic_min_percentage: c.academic && c.academic.min_percent,
        moi_accepted: c.english.some(x => x.moi_accepted) ? 'Yes' : 'No', duration_months: c.duration_months, language_of_instruction: c.language, university_status: c.uni_status, description: c.description });
      for (const i of c.intakes) wi.addRow({ course_key: key, intake_month: i.month, intake_year: i.year, open_date: i.open_date ? fmtDate(i.open_date) : '', deadline: i.deadline ? fmtDate(i.deadline) : '', status: i.status });
      for (const e of c.english.filter(x => x.test_type)) we.addRow({ course_key: key, test_type: e.test_type, min_overall: e.min_overall, min_band: e.min_band });
    }
  }
  const hp = wb.addWorksheet('Help'); hp.columns = [{ width: 30 }, { width: 100 }];
  [['Sheet Courses', 'One row per course. Matching key for updates: university_course_code if filled, otherwise course_name + level.'], ['Sheet Intakes', 'course_key = university_course_code (or course_name). Dates DD/MM/YYYY. status Open / Closed.'],
    ['Sheet English', 'course_key, test_type, min_overall, min_band. Not needed if moi_accepted = Yes and no test is required.'], ['level', LEVELS.join(', ')], ['field_of_study', all(`SELECT name FROM master_items WHERE type = 'field_of_study' AND is_deleted = 0 ORDER BY name`).map(x => x.name).join(', ')],
    ['campus', camps.join(', ') || 'Add campuses in Profile first'], ['previous_level_required', '12th, Diploma, Bachelor, Master'], ['academic_min_percentage', 'Number 0 to 100 (percentage only, no CGPA)'], ['moi_accepted', 'Yes / No'],
    ['language_of_instruction', LANGS.join(', ')], ['university_status', 'Active, Closed'], ['test_type', Object.keys(TESTS).join(', ')], ['Fees', 'Amount only. Words like non-EU, international or foreign are not allowed.'], ['Limits', `Max ${getSetting('uni_bulk_max_rows') || 1000} course rows, 5 MB per file.`]]
    .forEach(x => hp.addRow(x)); hp.getColumn(1).font = { bold: true }; hp.state = 'visible';
  return wb;
}
r.get('/courses-template.xlsx', ah(async (req, res) => {
  const wb = await templateWorkbook(req.uu.university_id, req.query.data === '1');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${req.query.data === '1' ? 'my-courses' : 'course-upload-template'}.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));
const dmy = (v) => { if (!v) return null; if (v instanceof Date) return v.toISOString().slice(0, 10); const s = String(v).trim(); let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; m = s.match(/^\d{4}-\d{2}-\d{2}/); return m ? m[0] : 'INVALID'; };
async function readBulk(file) {
  const ext = file.originalname.split('.').pop().toLowerCase();
  if (ext === 'csv') { // CSV = Courses sheet only (intakes / english columns not available)
    const text = fs.readFileSync(file.path, 'utf8').replace(/^﻿/, ''); const lines = text.split(/\r?\n/).filter(Boolean);
    const split = (l) => { const out = []; let cell = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; } else if (ch === '"') q = true; else if (ch === ',') { out.push(cell); cell = ''; } else cell += ch; } out.push(cell); return out; };
    const head = split(lines[0]).map(h => h.trim()); return { courses: lines.slice(1).map(l => Object.fromEntries(split(l).map((v, i) => [head[i], v]))), intakes: [], english: [] };
  }
  if (ext !== 'xlsx') throw bad('Upload an .xlsx or .csv file');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file.path);
  const sheet = (n) => { const ws = wb.getWorksheet(n); if (!ws) return []; const rows = []; let head = null;
    ws.eachRow({ includeEmpty: false }, (row, i) => { const vals = []; for (let c = 1; c <= ws.columnCount; c++) { let v = row.getCell(c).value; if (v && typeof v === 'object' && !(v instanceof Date)) v = v.text || v.result || v.hyperlink || ''; vals.push(v === null || v === undefined ? '' : v); }
      if (!head) head = vals.map(h => String(h).trim()); else rows.push({ ...Object.fromEntries(head.map((h, k) => [h, vals[k]])), __row: i }); }); return rows; };
  return { courses: sheet('Courses'), intakes: sheet('Intakes'), english: sheet('English') };
}
function classifyBulk(uniId, data) {
  const out = []; const camps = all('SELECT * FROM campuses WHERE university_id = ? AND is_deleted = 0', uniId);
  const max = Number(getSetting('uni_bulk_max_rows') || 1000);
  if (data.courses.length > max) throw bad(`Maximum ${max} course rows per file`);
  const seen = new Set();
  for (const row of data.courses) {
    const g = (k) => String(row[k] ?? '').trim();
    const rowNo = row.__row || '?';
    if (!g('course_name') && !g('university_course_code')) continue;
    const key = g('university_course_code') || g('course_name');
    const field = get(`SELECT id FROM master_items WHERE type = 'field_of_study' AND lower(name) = lower(?) AND is_deleted = 0`, g('field_of_study'));
    const camp = camps.find(c => c.name.toLowerCase() === g('campus').toLowerCase());
    const intakes = data.intakes.filter(i => String(i.course_key).trim() === key).map(i => ({ month: num(i.intake_month), year: num(i.intake_year), open_date: dmy(i.open_date), deadline: dmy(i.deadline), status: /^closed$/i.test(String(i.status).trim()) ? 'Closed' : 'Open', closed_reason: /^closed$/i.test(String(i.status).trim()) ? 'Other' : null }));
    const english = data.english.filter(x => String(x.course_key).trim() === key).map(x => ({ test_type: String(x.test_type).trim(), min_overall: x.min_overall, min_band: x.min_band === '' ? null : x.min_band }));
    const lvl = LEVELS.find(l => l.toLowerCase() === g('level').toLowerCase()) || g('level');
    const b = { name: g('course_name'), level: lvl, field_of_study_id: field && field.id, campus_id: camp && camp.id, course_link: g('course_link'), tuition_fee: g('tuition_fee_per_year'), currency: g('tuition_currency').toUpperCase(),
      fee_note: g('fee_note'), application_fee: g('application_fee'), application_fee_currency: g('application_fee_currency').toUpperCase(), required_level: g('previous_level_required'), min_percent: g('academic_min_percentage'),
      moi_accepted: /^yes$/i.test(g('moi_accepted')), duration_months: g('duration_months'), language: LANGS.find(l => l.toLowerCase() === g('language_of_instruction').toLowerCase()) || g('language_of_instruction'),
      uni_status: /^closed$/i.test(g('university_status')) ? 'Closed' : 'Active', description: g('description'), university_course_code: g('university_course_code'), english, intakes };
    const existing = b.university_course_code ? get('SELECT * FROM courses WHERE university_id = ? AND university_course_code = ? AND is_deleted = 0', uniId, b.university_course_code)
      : get('SELECT * FROM courses WHERE university_id = ? AND lower(trim(name)) = lower(trim(?)) AND level = ? AND is_deleted = 0', uniId, b.name, b.level);
    const v = validateCourse(uniId, b, existing && existing.id);
    if (!field) v.errors.field_of_study_id = `Field of study "${g('field_of_study')}" not found`;
    if (!camp) v.errors.campus_id = `Campus "${g('campus')}" not found`;
    if (intakes.some(i => i.deadline === 'INVALID' || i.open_date === 'INVALID')) v.errors.intakes = 'Dates must be DD/MM/YYYY';
    const dupKey = `${b.name}|${b.level}`.toLowerCase(); if (seen.has(dupKey)) v.errors.name = 'Duplicate row in this file'; seen.add(dupKey);
    const errs = Object.entries(v.errors);
    if (errs.length) { out.push({ row: rowNo, course: b.name, status: 'Error', reason: errs.map(([k, m]) => `${k}: ${m}`).join('; '), cell: `Courses!row ${rowNo}` }); continue; }
    const p = payloadOf(b, v);
    let status = existing ? 'Update' : 'New';
    if (existing) { const cur = courseOut(existing); const same = ['name', 'level', 'tuition_fee', 'currency', 'application_fee', 'course_link', 'duration_months', 'language', 'description', 'fee_note', 'uni_status'].every(k => String(cur[k] ?? '') === String(p[k] ?? ''))
      && String((cur.academic || {}).min_percent ?? '') === String(p.min_percent) && JSON.stringify(cur.intakes.map(i => [i.month, i.year, i.deadline, i.status])) === JSON.stringify(p.intakes.map(i => [i.month, i.year, i.deadline, i.status])); if (same) status = 'No change'; }
    out.push({ row: rowNo, course: b.name, status, warnings: v.warnings, payload: p, course_id: existing ? existing.id : null });
  }
  return out;
}
r.post('/courses/bulk/:mode(preview|submit)', files.upload.single('file'), ah(async (req, res) => {
  try {
    if (!canProposeCourses(req)) throw new U.HttpError(403, 'Your role does not allow course changes.');
    if (!req.file) throw bad('Choose the file'); if (req.file.size > 5 * 1024 * 1024) throw bad('The file is larger than 5 MB');
    if (req.params.mode === 'submit') UA.hit('ubulk:' + req.uu.university_id, 5, 3600e3);
    const rows = classifyBulk(req.uu.university_id, await readBulk(req.file));
    const counts = rows.reduce((m, x) => { m[x.status] = (m[x.status] || 0) + 1; return m; }, {});
    let batchId = null;
    if (req.params.mode === 'submit') {
      batchId = uuid();
      insert('uni_import_batches', { id: batchId, university_id: req.uu.university_id, file_name: req.file.originalname, counts_json: JSON.stringify(counts), errors_json: JSON.stringify(rows.filter(x => x.status === 'Error')), status: 'Submitted', created_by: req.uu.id, created_at: now() });
      tx(() => { for (const x of rows.filter(y => ['New', 'Update'].includes(y.status))) submitCourseChange(req, x.course_id ? get('SELECT * FROM courses WHERE id = ?', x.course_id) : null, x.payload, x.warnings || [], batchId); });
      notifyAdmins(`${C.uniName(req.uni)} submitted a bulk course upload (${(counts.New || 0) + (counts.Update || 0)} changes)`, '#/admin/uni-approvals');
      C.uaudit(req, 'Create', 'CourseImportBatch', batchId, `${req.file.originalname} ${JSON.stringify(counts)}`);
    }
    res.json({ counts, rows: rows.map(({ payload, ...x }) => x), batch_id: batchId });
  } finally { files.cleanup(req.file); }
}));
r.post('/courses/bulk/errors.xlsx', ah(async (req, res) => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Errors'); ws.columns = [{ header: 'Row', key: 'row', width: 8 }, { header: 'Course', key: 'course', width: 36 }, { header: 'Cell', key: 'cell', width: 16 }, { header: 'Reason', key: 'reason', width: 90 }];
  for (const e of (req.body.rows || []).filter(x => x.status === 'Error').slice(0, 2000)) ws.addRow(e);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', 'attachment; filename="upload-errors.xlsx"'); await wb.xlsx.write(res); res.end();
}));

// ---------- intakes calendar + scholarships (9) ----------
r.get('/intakes', ah(async (req, res) => {
  const rows = all(`SELECT ci.*, c.name course, c.level, c.id cid FROM course_intakes ci JOIN courses c ON c.id = ci.course_id WHERE c.university_id = ? AND c.is_deleted = 0 AND ci.is_deleted = 0 ORDER BY ci.deadline`, req.uu.university_id)
    .map(i => ({ course_id: i.cid, course: i.course, level: i.level, intake: i.intake_id ? masterName(i.intake_id) : `${i.month}/${i.year || 'every year'}`, intake_key: i.intake_id || `${i.month}-${i.year}`, open_date: i.open_date, deadline: i.deadline,
      status: (i.status || 'Open') === 'Closed' || (i.deadline && i.deadline < U.istDate()) ? 'Closed' : 'Open', pending: !!get(`SELECT 1 x FROM course_change_requests WHERE course_id = ? AND status = 'Pending approval'`, i.cid) }));
  res.json({ rows, can_propose: canProposeCourses(req) && !req.preview });
}));
const SCH_BENEFIT = ['Fixed amount', 'Percentage of tuition', 'Full tuition waiver', 'Variable / case by case'];
const SCH_HOW = ['Automatic with admission', 'Separate scholarship form (La Europa submits)', 'Essay / interview', 'Other'];
r.get('/scholarships', ah(async (req, res) => {
  const live = all('SELECT * FROM scholarships WHERE university_id = ? AND is_deleted = 0 ORDER BY created_at DESC', req.uu.university_id).map(s => ({ ...s, applies: C.parseJ(s.applies_json, {}) }));
  const reqs = all(`SELECT id, scholarship_id, change_type, status, review_note, payload_json, created_at FROM course_change_requests WHERE university_id = ? AND entity = 'scholarship' AND is_deleted = 0 ORDER BY created_at DESC LIMIT 50`, req.uu.university_id)
    .map(x => ({ ...x, name: C.parseJ(x.payload_json, {}).name, payload_json: undefined }));
  res.json({ rows: live, requests: reqs, benefit_types: SCH_BENEFIT, how_apply: SCH_HOW, can_propose: canProposeCourses(req) && !req.preview,
    courses: all('SELECT id, name, level FROM courses WHERE university_id = ? AND is_deleted = 0 ORDER BY name', req.uu.university_id) });
}));
r.post('/scholarships', ah(async (req, res) => {
  if (!canProposeCourses(req)) throw new U.HttpError(403, 'Your role does not allow this action.');
  const b = req.body; const e = {};
  const cur = b.id ? get('SELECT * FROM scholarships WHERE id = ? AND university_id = ?', b.id, req.uu.university_id) : null; if (b.id && !cur) throw C.NotFound();
  if (!clean(b.name)) e.name = 'Scholarship name is required'; if (!clean(b.description)) e.description = 'Description is required';
  if (!SCH_BENEFIT.includes(b.benefit_type)) e.benefit_type = 'Choose the benefit type';
  if (b.benefit_type === 'Fixed amount' && !(num(b.amount) > 0 && b.currency)) e.amount = 'Amount and currency are required';
  if (b.benefit_type === 'Percentage of tuition' && !(num(b.percent) >= 1 && num(b.percent) <= 100)) e.percent = '1 to 100';
  if (b.min_percent !== undefined && b.min_percent !== '' && b.min_percent !== null && !(num(b.min_percent) >= 0 && num(b.min_percent) <= 100)) e.min_percent = 'Please enter a percentage between 0 and 100.';
  if (!SCH_HOW.includes(b.how_apply)) e.how_apply = 'Choose how the student applies';
  if (b.link && !/^https:\/\//i.test(b.link)) e.link = 'Link must start with https://';
  Object.assign(e, C.feeWordCheck({ description: b.description, other_criteria: b.other_criteria }));
  if (Object.keys(e).length) throw bad('Please fix the highlighted fields', { errors: e });
  const applies = { scope: ['all', 'levels', 'courses'].includes(b.scope) ? b.scope : 'all', levels: (b.levels || []).filter(l => LEVELS.includes(l)), courses: (b.courses || []).filter(id => get('SELECT 1 x FROM courses WHERE id = ? AND university_id = ?', id, req.uu.university_id)), intakes: b.intakes || [] };
  const payload = { name: clean(b.name, 150), description: clean(b.description, 2000), benefit_type: b.benefit_type, amount: num(b.amount), currency: b.currency || null, percent: num(b.percent), min_percent: num(b.min_percent),
    other_criteria: clean(b.other_criteria, 1000), applies, deadline: b.deadline || null, how_apply: b.how_apply, link: clean(b.link, 300), valid_until: b.valid_until || null };
  const id = insert('course_change_requests', { university_id: req.uu.university_id, entity: 'scholarship', scholarship_id: cur ? cur.id : null, change_type: cur ? 'Edit scholarship' : 'New scholarship', payload_json: JSON.stringify(payload),
    old_json: cur ? JSON.stringify(cur) : null, status: 'Pending approval', requested_by: req.uu.id, created_by_type: 'university' });
  notifyAdmins(`${C.uniName(req.uni)} submitted a scholarship: ${payload.name}`, '#/admin/uni-approvals');
  C.uaudit(req, 'Create', 'ScholarshipChangeRequest', id, payload.name); res.json({ ok: true, message: 'Sent to La Europa for approval.' });
}));

// ---------- announcements (8.5) ----------
const ANN_TYPES = ['Deadline change', 'Scholarship', 'Event / webinar', 'Course news', 'Fee change', 'Admission rule change', 'Other'];
r.get('/announcements', ah(async (req, res) => res.json({ rows: all('SELECT * FROM uni_announcements WHERE university_id = ? ORDER BY created_at DESC LIMIT 100', req.uu.university_id).map(a => ({ ...a, related: C.parseJ(a.related_json, []), attachments: C.parseJ(a.attachments_json, []).map(x => ({ id: x.id, name: x.name })) })),
  notices: all(`SELECT * FROM uni_notices WHERE university_id IS NULL OR university_id = ? ORDER BY created_at DESC LIMIT 30`, req.uu.university_id), types: ANN_TYPES,
  courses: all('SELECT id, name FROM courses WHERE university_id = ? AND is_deleted = 0 ORDER BY name', req.uu.university_id), can_post: req.uu.role !== 'viewer' && !req.preview })));
r.post('/announcements', files.upload.array('files', 5), ah(async (req, res) => {
  try {
    role(req, 'admin', 'officer');
    const b = req.body; const e = {};
    if (!ANN_TYPES.includes(b.type)) e.type = 'Choose the type'; if (!clean(b.title)) e.title = 'Title is required'; else if (b.title.length > 150) e.title = 'Max 150 characters';
    if (!clean(b.body)) e.body = 'Message is required'; else if (b.body.length > 5000) e.body = 'Max 5000 characters';
    if (b.type === 'Fee change' || /fee/i.test(b.body || '')) Object.assign(e, Object.fromEntries(Object.entries(C.feeWordCheck({ body: C.feeWordNear(b.body) ? b.body : '' })).map(([k, v]) => [k, v])));
    if (Object.keys(e).length) throw bad('Please fix the highlighted fields', { errors: e });
    require('./routes').checkAttachments(req.files || []);
    const att = (req.files || []).map(f => { const ext = path.extname(f.originalname).slice(1).toLowerCase(); const key = `uann_${uuid()}.${ext}`; VAULT.moveIn(f.path, files.filePath(key)); return { id: uuid(), key, name: f.originalname, mime: f.mimetype }; });
    const id = insert('uni_announcements', { id: uuid(), university_id: req.uu.university_id, type: b.type, title: clean(b.title, 150), body: clean(b.body, 5000), related_json: JSON.stringify(C.parseJ(b.related, [])), important: b.important === 'true' || b.important === true ? 1 : 0,
      valid_until: b.valid_until || null, attachments_json: JSON.stringify(att), status: 'Posted', created_by: req.uu.id, created_at: now() });
    const to = [...new Set([req.uni.partner_manager_id, ...admins()].filter(Boolean))];
    for (const x of to) notify(x, 'university', `Announcement from ${C.uniName(req.uni)}: ${clean(b.title, 150)}`, '#/admin/uni-announcements');
    UE.staffEmail('E46', to, { university_id: req.uu.university_id, ctx: { announcement_title: clean(b.title, 150), announcement_type: b.type, announcement_excerpt: clean(b.body, 300) } });
    C.uaudit(req, 'Create', 'UniversityAnnouncement', id, clean(b.title, 150)); res.json({ ok: true });
  } catch (e) { (req.files || []).forEach(files.cleanup); throw e; }
}));
r.get('/announcements/:id/attachment/:aid', ah(async (req, res) => {
  const a = get('SELECT * FROM uni_announcements WHERE id = ? AND university_id = ?', req.params.id, req.uu.university_id); if (!a) throw C.NotFound();
  const x = C.parseJ(a.attachments_json, []).find(y => y.id === req.params.aid); if (!x) throw C.NotFound();
  res.setHeader('Content-Type', x.mime || 'application/octet-stream'); res.setHeader('Content-Disposition', `attachment; filename="${String(x.name).replace(/"/g, '')}"`); VAULT.pipe(files.filePath(x.key), res);
}));

// ---------- reports (11) ----------
function reportData(req, type, q) {
  const [w, p] = (() => { const ww = ['ua.university_id = ?', 'ua.is_deleted = 0']; const pp = [req.uu.university_id]; if (req.campuses.length) { ww.push(`ua.campus_id IN (${req.campuses.map(() => '?').join(',')})`); pp.push(...req.campuses); }
    if (q.intake) { ww.push('a.intake_id = ?'); pp.push(q.intake); } if (q.course) { ww.push('a.course_id = ?'); pp.push(q.course); } if (q.level) { ww.push('a.level = ?'); pp.push(q.level); } if (q.campus) { ww.push('ua.campus_id = ?'); pp.push(q.campus); } return [ww.join(' AND '), pp]; })();
  const apps = all(`SELECT ua.*, a.intake_id, a.course_id, a.course_name_text, a.level, a.student_id, a.application_code FROM university_applications ua JOIN applications a ON a.id = ua.application_id WHERE ${w}`, ...p);
  const small = getSetting('uni_small_numbers') !== '0';
  const sm = (n) => small && n > 0 && n < 5 ? 'fewer than 5' : n;
  const courseN = (x) => x.course_name_text || masterName(x.course_id);
  const OFFERS = ['Conditional offer', 'Unconditional offer', 'Offer accepted', 'Deposit received', 'Enrolled'];
  const offered = (x) => OFFERS.includes(x.status) || !!get(`SELECT 1 x FROM uni_actions WHERE uapp_id = ? AND type IN ('conditional_offer','unconditional_offer')`, x.id);
  const group = (keyFn) => { const g = {}; for (const x of apps) { const k = keyFn(x) || '-'; (g[k] = g[k] || []).push(x); } return g; };
  if (type === 'by_intake') { const g = group(x => masterName(x.intake_id)); const cols = C.STATUSES; return { columns: ['Intake', ...cols, 'Total'], rows: Object.entries(g).map(([k, list]) => [k, ...cols.map(s => list.filter(x => x.status === s).length), list.length]) }; }
  if (type === 'funnel') { const steps = [['Received', () => true], ['Reviewed', (x) => x.status !== 'New'], ['Offer', offered], ['Offer accepted', (x) => ['Offer accepted', 'Deposit received', 'Enrolled'].includes(x.status)], ['Deposit received', (x) => ['Deposit received', 'Enrolled'].includes(x.status)], ['Enrolled', (x) => x.status === 'Enrolled']];
    const base = apps.filter(x => x.status !== 'Withdrawn'); const tot = base.length || 1; return { columns: ['Step', 'Count', '% of received'], rows: steps.map(([l, f]) => { const n = base.filter(f).length; return [l, n, Math.round(n / tot * 1000) / 10 + '%']; }) }; }
  if (type === 'states') { const g = group(x => (get('SELECT state FROM students WHERE id = ?', x.student_id) || {}).state || 'Not given'); return { columns: ['Country / state', 'Applications', 'Offers', 'Enrolled'],
    rows: Object.entries(g).map(([k, list]) => [`India: ${k}`, sm(list.length), sm(list.filter(offered).length), sm(list.filter(x => x.status === 'Enrolled').length)]) }; }
  if (type === 'offer_enrolment') { const g = group(x => `${masterName(x.intake_id)} | ${courseN(x)}`); return { columns: ['Intake | course', 'Offers issued', 'Offers accepted', 'Enrolled', 'Acceptance rate', 'Offer-to-enrolment rate'],
    rows: Object.entries(g).map(([k, list]) => { const o = list.filter(offered).length; const acc = list.filter(x => ['Offer accepted', 'Deposit received', 'Enrolled'].includes(x.status)).length; const en = list.filter(x => x.status === 'Enrolled').length;
      return [k, o, acc, en, o ? Math.round(acc / o * 100) + '%' : '-', o ? Math.round(en / o * 100) + '%' : '-']; }) }; }
  if (type === 'decision_time') { const g = group(x => `${masterName(x.intake_id)} | ${courseN(x)}`); const med = (a) => { if (!a.length) return '-'; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10; };
    return { columns: ['Intake | course', 'Decided', 'Average days to first decision', 'Median days', 'Average La Europa response to document requests (days)'],
      rows: Object.entries(g).map(([k, list]) => { const d = list.filter(x => x.first_decision_at).map(x => (new Date(x.first_decision_at) - new Date(x.submitted_at)) / 864e5);
        const rq = list.flatMap(x => all('SELECT created_at, answered_at FROM uni_doc_requests WHERE uapp_id = ? AND answered_at IS NOT NULL', x.id)).map(y => (new Date(y.answered_at) - new Date(y.created_at)) / 864e5);
        return [k, d.length, d.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length * 10) / 10 : '-', med(d), rq.length ? Math.round(rq.reduce((a, b) => a + b, 0) / rq.length * 10) / 10 : '-']; }) }; }
  if (type === 'reject_reasons') { const g = {}; for (const x of apps.filter(y => y.status === 'Rejected')) g[x.reject_reason || 'Not given'] = (g[x.reject_reason || 'Not given'] || 0) + 1; return { columns: ['Reason', 'Count'], rows: Object.entries(g).sort((a, b) => b[1] - a[1]) }; }
  if (type === 'courses') { const g = group(courseN); return { columns: ['Course', 'Applications', 'Offers', 'Enrolled'], rows: Object.entries(g).map(([k, list]) => [k, list.length, list.filter(offered).length, list.filter(x => x.status === 'Enrolled').length]).sort((a, b) => b[1] - a[1]) }; }
  if (type === 'list') {
    const hist = (x, t) => { const r0 = get('SELECT created_at FROM uni_actions WHERE uapp_id = ? AND to_status = ? ORDER BY created_at LIMIT 1', x.id, t); return r0 ? fmtDate(r0.created_at) : ''; };
    const withContact = q.contact === '1' && req.uu.role === 'admin' && req.uni.share_contact;
    return { columns: ['Application ID', 'Student name', 'Course', 'Intake', 'Status', 'Submitted', 'Acknowledged', 'Offer', 'Offer accepted', 'Deposit', 'Enrolled', 'Rejected', 'State', ...(withContact ? ['Phone', 'Email'] : [])],
      rows: apps.map(x => { const s = get('SELECT * FROM students WHERE id = ?', x.student_id); return [x.application_code, fullName(s), courseN(x), masterName(x.intake_id), x.status, fmtDate(x.submitted_at), hist(x, 'Acknowledged'),
        hist(x, 'Conditional offer') || hist(x, 'Unconditional offer'), hist(x, 'Offer accepted'), hist(x, 'Deposit received'), hist(x, 'Enrolled'), hist(x, 'Rejected'), s.state || '', ...(withContact ? [`${s.country_code || ''} ${s.phone || ''}`.trim(), s.email] : [])]; }), contact: withContact };
  }
  throw C.NotFound();
}
const REPORTS = [['by_intake', 'Applications by intake'], ['funnel', 'Conversion funnel'], ['states', 'Students by country / state'], ['offer_enrolment', 'Offer-to-enrolment rate'], ['decision_time', 'Decision time'], ['reject_reasons', 'Rejection reasons'], ['courses', 'Course performance'], ['list', 'Application list']];
r.get('/reports', ah(async (req, res) => res.json({ reports: REPORTS, can_export: req.uu.role !== 'viewer' || !!req.uni.viewer_exports, contact_option: req.uu.role === 'admin' && !!req.uni.share_contact })));
r.get('/reports/:type', ah(async (req, res) => {
  const d = reportData(req, req.params.type, req.query);
  const fmt = req.query.format;
  if (!fmt) return res.json(d);
  if (req.uu.role === 'viewer' && !req.uni.viewer_exports) throw new U.HttpError(403, 'Exports are not available for your role.');
  const title = (REPORTS.find(x => x[0] === req.params.type) || [0, 'Report'])[1];
  const filt = ['intake', 'course', 'level', 'campus'].filter(k => req.query[k]).map(k => `${k}: ${k === 'intake' ? masterName(req.query[k]) : k === 'course' ? (get('SELECT name FROM courses WHERE id = ?', req.query[k]) || {}).name : req.query[k]}`).join(', ') || 'none';
  C.uaudit(req, 'Export', 'UniversityReport', null, `${title} (${fmt})${d.contact ? ' with contact details' : ''}`);
  if (fmt === 'xlsx') {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(title.slice(0, 30));
    ws.addRow([`${C.uniName(req.uni)}: ${title}`]).font = { bold: true, size: 14 }; ws.addRow([`Filters: ${filt}`]); ws.addRow([`Generated on ${fmtDateTime(new Date())} IST by La Europa partner portal`]); ws.addRow([]);
    const h = ws.addRow(d.columns); h.font = { bold: true }; for (const row of d.rows) ws.addRow(row); ws.columns.forEach(c => { c.width = 18; });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}.xlsx"`); await wb.xlsx.write(res); return res.end();
  }
  const buf = await require('./pdf').tablePdf({ title: `${C.uniName(req.uni)}: ${title}`, sub: `Filters: ${filt} | Generated on ${fmtDateTime(new Date())} IST`, columns: d.columns, rows: d.rows, logoKey: req.uni.logo_key });
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}.pdf"`); res.end(buf);
}));

// ---------- commission and invoices (10.7, finance only) ----------
r.get('/finance', ah(async (req, res) => {
  finance(req);
  const inv = all(`SELECT * FROM commission_invoices WHERE university_id = ? AND status != 'Draft' AND is_deleted = 0 ORDER BY invoice_date DESC`, req.uu.university_id).map(i => ({ id: i.id, invoice_no: i.invoice_no, kind: i.kind, invoice_date: i.invoice_date, due_date: i.due_date,
    total: i.total, currency: i.currency, paid: i.paid, balance: Math.round(((i.total || 0) - (i.paid || 0)) * 100) / 100, status: i.status, query_open: !!i.query_open,
    lines: all('SELECT c.id, c.amount, c.currency, a.application_code, a.student_id, a.course_name_text, a.course_id, a.intake_id FROM commissions c LEFT JOIN applications a ON a.id = c.application_id WHERE c.invoice_id = ?', i.id)
      .map(l => ({ id: l.id, amount: l.amount, currency: l.currency, application_code: l.application_code, student_name: l.student_id ? fullName(get('SELECT first_name, middle_name, last_name FROM students WHERE id = ?', l.student_id)) : 'Volume bonus', course: l.course_name_text || masterName(l.course_id), intake: masterName(l.intake_id) })),
    payments: all('SELECT id, amount, currency, payment_date, reference, status, reject_reason, created_at FROM commission_payments WHERE invoice_id = ? ORDER BY created_at DESC', i.id) }));
  const rules = all(`SELECT * FROM commission_rules WHERE university_id = ? AND status = 'Active' AND show_to_uni = 1 AND is_deleted = 0`, req.uu.university_id).map(x => ({ name: x.name,
    basis: { gross: 'Percentage of first-year tuition (gross)', net: 'Percentage of first-year tuition after scholarship', fixed: 'Fixed amount per enrolled student' }[x.basis], rate: x.basis === 'fixed' ? null : x.rate,
    fixed: x.basis === 'fixed' ? `${x.fixed_amount} ${x.fixed_currency}` : null, due: { enrolled: 'On enrolment', deposit: 'On deposit received', days: `Enrolment date + ${x.due_days} days` }[x.due_event] }));
  const expected = req.uni.show_expected_commission ? all(`SELECT status, currency, COUNT(*) n, SUM(amount) total FROM commissions WHERE university_id = ? AND status IN ('Due','Expected') AND is_deleted = 0 GROUP BY status, currency`, req.uu.university_id) : null;
  const ag = activeAgreementFor(req);
  res.json({ invoices: inv, rules, expected, agreement: ag });
}));
function activeAgreementFor(req) {
  if (req.uu.role !== 'admin') return null;
  return all(`SELECT id, agreement_code, title, start_date, end_date, signed_by_le, signed_by_uni, signed_on, status, file_key FROM partner_agreements WHERE university_id = ? AND show_to_uni = 1 AND is_deleted = 0 AND status != 'Draft' ORDER BY start_date DESC`, req.uu.university_id)
    .map(a => ({ ...a, has_pdf: !!a.file_key, file_key: undefined, party: 'Euroverse Service LLP, trading as La Europa Education' }));
}
r.get('/finance/invoices/:id/pdf', ah(async (req, res) => {
  finance(req); const i = get(`SELECT * FROM commission_invoices WHERE id = ? AND university_id = ? AND status != 'Draft'`, req.params.id, req.uu.university_id); if (!i || !i.pdf_key) throw C.NotFound();
  C.uaudit(req, 'Download', 'CommissionInvoice', i.id, i.invoice_no);
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${i.invoice_no}.pdf"`); VAULT.pipe(files.filePath(i.pdf_key), res);
}));
r.get('/agreements/:id/pdf', ah(async (req, res) => {
  role(req, 'admin'); const a = get(`SELECT * FROM partner_agreements WHERE id = ? AND university_id = ? AND show_to_uni = 1 AND is_deleted = 0`, req.params.id, req.uu.university_id); if (!a || !a.file_key) throw C.NotFound();
  C.uaudit(req, 'View', 'PartnerAgreement', a.id, a.agreement_code);
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${a.agreement_code}.pdf"`); res.setHeader('Cache-Control', 'private, no-store'); VAULT.pipe(files.filePath(a.file_key), res);
}));
r.post('/finance/invoices/:id/payments', files.upload.single('proof'), ah(async (req, res) => {
  try {
    finance(req); const i = get(`SELECT * FROM commission_invoices WHERE id = ? AND university_id = ? AND status IN ('Invoiced','Partially paid','Overdue') AND kind = 'invoice'`, req.params.id, req.uu.university_id); if (!i) throw C.NotFound();
    const b = req.body; const e = {}; const amt = num(b.amount);
    if (!(amt > 0)) e.amount = 'Amount must be more than 0';
    if (!b.payment_date || b.payment_date > U.istDate()) e.payment_date = 'Payment date is required and cannot be in the future';
    if (!clean(b.reference)) e.reference = 'Bank reference is required';
    if (!req.file) e.proof = 'Upload the proof (PDF / JPG / PNG)';
    if (Object.keys(e).length) throw bad('Please fix the highlighted fields', { errors: e });
    const { ext } = files.checkFile(req.file, files.ALLOWED, 10);
    const key = `upay_${uuid()}.${ext}`; VAULT.moveIn(req.file.path, files.filePath(key));
    const dup = get('SELECT 1 x FROM commission_payments WHERE university_id = ? AND reference = ? AND status != \'Rejected\'', req.uu.university_id, clean(b.reference, 100));
    const id = insert('commission_payments', { id: uuid(), invoice_id: i.id, university_id: i.university_id, amount: amt, currency: i.currency, payment_date: b.payment_date, reference: clean(b.reference, 100), proof_key: key, proof_name: req.file.originalname,
      note: clean(b.note, 500), status: 'Submitted', submitted_by: req.uu.id, source: 'university', created_at: now() });
    for (const a of admins()) notify(a, 'commission', `Payment proof submitted by ${C.uniName(req.uni)} for invoice ${i.invoice_no}: ${amt} ${i.currency}${dup ? ' (duplicate reference!)' : ''}`, '#/admin/commission');
    C.uaudit(req, 'Create', 'CommissionPayment', id, i.invoice_no);
    res.json({ ok: true, warning: amt > (i.total - i.paid) ? 'The amount is more than the balance.' : dup ? 'A payment with the same reference was already submitted.' : null });
  } catch (e) { files.cleanup(req.file); throw e; }
}));
r.get('/finance/invoices/:id/queries', ah(async (req, res) => {
  finance(req); const i = get('SELECT * FROM commission_invoices WHERE id = ? AND university_id = ?', req.params.id, req.uu.university_id); if (!i) throw C.NotFound();
  res.json(all('SELECT * FROM invoice_queries WHERE invoice_id = ? ORDER BY created_at DESC', i.id).map(q => ({ ...q, messages: all('SELECT * FROM invoice_query_messages WHERE query_id = ? ORDER BY sent_at', q.id).map(m => ({ ...m, mine: m.sender_type === 'university',
    sender: m.sender_type === 'university' ? (get('SELECT name FROM uni_users WHERE id = ?', m.sender_id) || {}).name : 'La Europa Education' })) })));
}));
r.post('/finance/invoices/:id/queries', ah(async (req, res) => {
  finance(req); const i = get(`SELECT * FROM commission_invoices WHERE id = ? AND university_id = ? AND status != 'Draft'`, req.params.id, req.uu.university_id); if (!i) throw C.NotFound();
  const body = clean(req.body.body, 2000); if (!body) throw U.fieldErr('body', 'Write your question');
  let q = req.body.query_id ? get(`SELECT * FROM invoice_queries WHERE id = ? AND invoice_id = ? AND status = 'Open'`, req.body.query_id, i.id) : null;
  if (!q) { const qid = insert('invoice_queries', { id: uuid(), invoice_id: i.id, university_id: i.university_id, commission_id: req.body.commission_id || null, status: 'Open', created_by: req.uu.id, created_at: now() }); q = { id: qid }; }
  insert('invoice_query_messages', { id: uuid(), query_id: q.id, sender_type: 'university', sender_id: req.uu.id, body, sent_at: now() });
  run('UPDATE commission_invoices SET query_open = 1 WHERE id = ?', i.id);
  for (const a of admins()) notify(a, 'commission', `Invoice query from ${C.uniName(req.uni)} on ${i.invoice_no}`, '#/admin/commission');
  C.uaudit(req, 'Create', 'InvoiceQuery', q.id, i.invoice_no); res.json({ ok: true });
}));

// ---------- users (2.7, University Admin only) ----------
r.get('/users', ah(async (req, res) => {
  role(req, 'admin');
  res.json({ rows: all('SELECT * FROM uni_users WHERE university_id = ? AND is_deleted = 0 ORDER BY status, name', req.uu.university_id).map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, role_label: C.ROLE_LABEL[u.role], finance: !!(u.finance || u.role === 'admin'),
    campuses: C.parseJ(u.campuses_json, []), department: u.department, phone: u.phone, alerts: C.parseJ(u.alerts_json, null), status: u.status, last_login_at: u.last_login_at, main: !!u.is_main_contact, twofa: !!u.twofa_ready })),
  max: req.uni.max_users, officers_propose: !!req.uni.officers_propose, campuses: all('SELECT id, name FROM campuses WHERE university_id = ? AND is_deleted = 0', req.uu.university_id),
  activity: all(`SELECT action, entity_type, entity_label, ip, created_at, user_id FROM audit_log WHERE university_id = ? AND actor_type = 'university' ORDER BY id DESC LIMIT 200`, req.uu.university_id).map(x => ({ ...x, user: (get('SELECT name FROM uni_users WHERE id = ?', x.user_id) || {}).name })) });
}));
const ALERTS = ['applications', 'messages', 'deadlines', 'finance'];
function userFields(req, b, existing) {
  const e = {};
  if (!clean(b.name)) e.name = 'Full name is required';
  if (!existing && !isEmail(b.email)) e.email = 'Valid email is required';
  if (!existing && get('SELECT 1 x FROM uni_users WHERE lower(email) = lower(?)', String(b.email || '').trim())) e.email = 'This email already has an account';
  if (!existing && get('SELECT 1 x FROM users WHERE lower(email) = lower(?)', String(b.email || '').trim())) e.email = 'This email belongs to La Europa staff and cannot be used here';
  if (!['admin', 'officer', 'viewer'].includes(b.role)) e.role = 'Choose a role';
  if (Object.keys(e).length) throw bad('Please fix the highlighted fields', { errors: e });
  const camps = (b.campuses || []).filter(id => get('SELECT 1 x FROM campuses WHERE id = ? AND university_id = ?', id, req.uu.university_id));
  return { name: clean(b.name, 100), role: b.role, finance: b.role === 'admin' || b.finance ? 1 : 0, campuses_json: JSON.stringify(camps), department: clean(b.department, 40), phone: clean(b.phone, 30),
    alerts_json: JSON.stringify((b.alerts || ALERTS).filter(x => ALERTS.includes(x))) };
}
const mailWarn = (em) => /@(gmail|yahoo|hotmail|outlook|live|icloud|aol|proton(mail)?|rediffmail)\./i.test(em) ? 'This looks like a personal / free email address. University work emails are recommended.' : /^(info|admissions|admission|office|contact|international)@/i.test(em) ? 'Shared mailboxes should not be used for personal logins.' : null;
r.post('/users', ah(async (req, res) => {
  role(req, 'admin');
  const n = get(`SELECT COUNT(*) c FROM uni_users WHERE university_id = ? AND status IN ('Invited','Active') AND is_deleted = 0`, req.uu.university_id).c;
  if (n >= (req.uni.max_users || 10)) throw bad('Your user limit is reached. Please contact La Europa.');
  const f = userFields(req, req.body, null);
  const id = insert('uni_users', { id: uuid(), university_id: req.uu.university_id, email: String(req.body.email).trim().toLowerCase(), ...f, status: 'Invited', created_by: req.uu.id, created_by_type: 'university' });
  await UA.issueInvite(id);
  for (const a of admins()) notify(a, 'university', `${C.uniName(req.uni)} added a portal user: ${f.name} (${C.ROLE_LABEL[f.role]})`, '#/admin/university');
  C.uaudit(req, 'Create', 'UniversityUser', id, `${f.name} ${f.role}`);
  res.json({ ok: true, warning: mailWarn(req.body.email) });
}));
r.put('/users/:id', ah(async (req, res) => {
  role(req, 'admin');
  const u = get('SELECT * FROM uni_users WHERE id = ? AND university_id = ? AND is_deleted = 0', req.params.id, req.uu.university_id); if (!u) throw C.NotFound();
  const f = userFields(req, { ...u, campuses: C.parseJ(u.campuses_json, []), ...req.body, email: u.email }, u);
  const admins0 = get(`SELECT COUNT(*) c FROM uni_users WHERE university_id = ? AND role = 'admin' AND status = 'Active' AND is_deleted = 0 AND id != ?`, u.university_id, u.id).c;
  if (u.role === 'admin' && f.role !== 'admin' && !admins0) throw bad('At least one active University Admin must always exist.');
  update('uni_users', u.id, { ...f, updated_by_type: 'university' }, req.uu.id);
  if (u.role !== f.role) for (const a of admins()) notify(a, 'university', `${C.uniName(req.uni)} changed the role of ${u.name} to ${C.ROLE_LABEL[f.role]}`, '#/admin/university');
  C.uaudit(req, 'Update', 'UniversityUser', u.id, u.name, { role: u.role, finance: u.finance }, { role: f.role, finance: f.finance }); res.json({ ok: true });
}));
r.post('/users/:id/:action(deactivate|activate|reset2fa|logout|resend)', ah(async (req, res) => {
  role(req, 'admin');
  const u = get('SELECT * FROM uni_users WHERE id = ? AND university_id = ? AND is_deleted = 0', req.params.id, req.uu.university_id); if (!u) throw C.NotFound();
  const a = req.params.action;
  if (a === 'deactivate') {
    if (u.role === 'admin' && !get(`SELECT 1 x FROM uni_users WHERE university_id = ? AND role = 'admin' AND status = 'Active' AND is_deleted = 0 AND id != ?`, u.university_id, u.id)) throw bad('The last active University Admin cannot be deactivated.');
    run(`UPDATE uni_users SET status = 'Inactive' WHERE id = ?`, u.id); run('UPDATE uni_sessions SET revoked = 1 WHERE uni_user_id = ?', u.id);
    for (const ad of admins()) notify(ad, 'university', `${C.uniName(req.uni)} deactivated the portal user ${u.name}`, '#/admin/university');
  }
  if (a === 'activate') { const n = get(`SELECT COUNT(*) c FROM uni_users WHERE university_id = ? AND status IN ('Invited','Active') AND is_deleted = 0`, u.university_id).c; if (n >= (req.uni.max_users || 10)) throw bad('Your user limit is reached. Please contact La Europa.'); run(`UPDATE uni_users SET status = CASE WHEN password_hash IS NULL THEN 'Invited' ELSE 'Active' END WHERE id = ?`, u.id); }
  if (a === 'reset2fa') { run('UPDATE uni_users SET twofa_ready = 0, totp_secret_enc = NULL, backup_codes_json = NULL WHERE id = ?', u.id); run('UPDATE uni_sessions SET revoked = 1 WHERE uni_user_id = ?', u.id); run('DELETE FROM uni_trusted_devices WHERE uni_user_id = ?', u.id); }
  if (a === 'logout') run('UPDATE uni_sessions SET revoked = 1 WHERE uni_user_id = ?', u.id);
  if (a === 'resend') { if (u.status !== 'Invited') throw bad('This user has already activated the account'); await UA.issueInvite(u.id); }
  C.uaudit(req, 'Update', 'UniversityUser', u.id, `${a}: ${u.name}`); res.json({ ok: true });
}));
r.put('/settings/officers-propose', ah(async (req, res) => { role(req, 'admin'); run('UPDATE universities SET officers_propose = ? WHERE id = ?', req.body.on ? 1 : 0, req.uu.university_id); C.uaudit(req, 'Update', 'University', req.uu.university_id, `Officers can propose course changes: ${req.body.on ? 'On' : 'Off'}`); res.json({ ok: true }); }));

// ---------- my account (UP18) ----------
r.get('/account', ah(async (req, res) => res.json({ me: UA.meOut(req.uu), sessions: all(`SELECT id, created_at, last_seen_at, ip, user_agent FROM uni_sessions WHERE uni_user_id = ? AND revoked = 0 AND twofa_done = 1 AND preview_by IS NULL AND expires_at > ? ORDER BY last_seen_at DESC`, req.uu.id, now())
  .map(s => ({ ...s, current: s.id === req.usession.id })), backup_left: C.parseJ(req.uu.backup_codes_json, []).length, alerts: ALERTS, consents: all('SELECT doc_type, version, created_at FROM uni_consents WHERE uni_user_id = ? ORDER BY created_at DESC', req.uu.id) })));
r.put('/account', ah(async (req, res) => {
  const b = req.body; const f = {};
  if (b.name !== undefined) { if (!clean(b.name)) throw U.fieldErr('name', 'Name is required'); f.name = clean(b.name, 100); }
  if (b.phone !== undefined) f.phone = clean(b.phone, 30); if (b.designation !== undefined) f.designation = clean(b.designation, 100);
  if (Array.isArray(b.alerts)) { let al = b.alerts.filter(x => ALERTS.includes(x)); if (req.uu.is_main_contact) { al = [...new Set([...al, 'applications', ...(req.uu.finance || req.uu.role === 'admin' ? ['finance'] : [])])]; } f.alerts_json = JSON.stringify(al); }
  update('uni_users', req.uu.id, { ...f, updated_by_type: 'university' }); C.uaudit(req, 'Update', 'UniversityUser', req.uu.id, 'My account'); res.json({ ok: true });
}));
r.put('/account/password', ah(async (req, res) => {
  UA.hit('upwchange:' + req.uu.id, 5, 15 * 60000); // no guessing the current password from an open session
  if (!(await require('../auth').same(String(req.body.current || ''), req.uu.password_hash))) throw bad('Current password is wrong', { errors: { current: 'Wrong password' } });
  UA.pwRule(req.body.password, [req.uu.email, req.uu.name]); if (req.body.password !== req.body.confirm) throw bad('Passwords do not match', { errors: { confirm: 'Does not match' } });
  await UA.notReused(req.uu, req.body.password); await UA.setPassword(req.uu, req.body.password);
  run('UPDATE uni_sessions SET revoked = 1 WHERE uni_user_id = ? AND id != ?', req.uu.id, req.usession.id);
  require('../email').sendSecurity({ to: req.uu.email, subject: 'Your La Europa partner portal password was changed', text: `Your partner portal password was changed on ${fmtDateTime(new Date())} IST.\nIf this was not you, contact La Europa immediately.` });
  C.uaudit(req, 'Update', 'UniversityUser', req.uu.id, 'Password changed'); res.json({ ok: true });
}));
r.post('/account/logout-others', ah(async (req, res) => { run('UPDATE uni_sessions SET revoked = 1 WHERE uni_user_id = ? AND id != ?', req.uu.id, req.usession.id); C.uaudit(req, 'Logout', 'UniversityUser', req.uu.id, 'Logged out other devices'); res.json({ ok: true }); }));
r.post('/account/backup-codes', ah(async (req, res) => {
  if (!(await require('../auth').same(String(req.body.password || ''), req.uu.password_hash))) throw bad('Please enter your password to confirm', { errors: { password: 'Wrong password' } });
  const codes = Array.from({ length: 10 }, () => require('crypto').randomBytes(5).toString('hex').toUpperCase().replace(/(.{5})/, '$1-'));
  run('UPDATE uni_users SET backup_codes_json = ? WHERE id = ?', JSON.stringify(codes.map(c => UA.sha(c))), req.uu.id);
  C.uaudit(req, 'Update', 'UniversityUser', req.uu.id, 'New backup codes'); res.json({ backup_codes: codes });
}));

module.exports = r;
module.exports.courseOut = courseOut;
module.exports.validateCourse = validateCourse;
module.exports.payloadOf = payloadOf;
module.exports.templateWorkbook = templateWorkbook;
module.exports.LEVELS = LEVELS;
