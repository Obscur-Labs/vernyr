import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import ExcelJS from 'exceljs';
import { Types } from 'mongoose';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { uploadBuffer, destroyAsset } from '../config/cloudinary';
import University from '../models/University';
import Course, { CourseChange, CourseImportBatch, COURSE_LEVELS } from '../models/Course';
import { Country, Intake, MasterItem } from '../models/Master';
import { Shortlist } from '../models/Work';
import { audit } from '../models/Audit';
import { bad, fieldErr, forbidden, notFound, handle, isAdmin, need, oid, clean, num, istDate, addDays, escRx, timeline, userNames, nameIn, fullName } from '../services/crm';
import { loadStudent, academicSummary } from '../services/students';
import { checkFile } from '../services/files';
import { ctxForStudent } from '../services/portalCtx';
import { TESTS, nextUniCode, defaultsOf, cleanDefaults, applyDefaults, normDate, saveCourse, setFollow, setStatus, courseOut, search, filterOptions, logoOf } from '../services/catalogue';
import { shortlistWarnings, workNames } from './work';

/** The course catalogue: universities one at a time (settings + Excel), the course admin, logos, and staff course search
 *  (legacy/server/routes/uni_catalogue.js, routes/course_search.js and the catalogue part of routes/portal_staff.js). */
const router = Router();
router.use(authenticate);
router.use('/admin/catalogue', (req: AuthRequest, _res, next) => next(isAdmin(req) ? undefined : forbidden()));
router.use('/admin/universities', (req: AuthRequest, _res, next) => next(isAdmin(req) ? undefined : forbidden()));

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const yes = (v: unknown) => /^(yes|y|1|true)$/i.test(String(v ?? '').trim());
const names = async () => {
  const [c, i, m] = await Promise.all([Country.find().select('name').lean(), Intake.find().select('name').lean(), MasterItem.find({ type: 'field_of_study' }).select('name').lean()]);
  const all = new Map<string, string>([...c, ...i, ...m].map((x) => [String(x._id), x.name]));
  return (id: unknown) => (id ? all.get(String(id)) ?? '' : '');
};
async function uniOf(id: string) {
  const u = await University.findOne({ is_deleted: false, ...(Types.ObjectId.isValid(id) ? { _id: id } : { uni_code: new RegExp(`^${escRx(id)}$`, 'i') }) });
  if (!u) throw notFound('University');
  return u;
}

// ---------- logos: public, cache-friendly (logos are not personal data); a coloured placeholder with initials when none ----------
const COLORS = ['#1d4ed8', '#0f766e', '#7c3aed', '#b45309', '#be123c', '#0369a1', '#15803d', '#9333ea', '#c2410c', '#334155'];
export async function logoRoute(req: Request, res: Response) {
  const u = Types.ObjectId.isValid(req.params.id) ? await University.findById(req.params.id).select('name logo_url').lean() : null;
  if (!u) { res.status(404).end(); return; }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  if (u.logo_url) { res.redirect(302, u.logo_url); return; }
  const w = u.name.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter((x) => x.length > 2 && !/^(of|the|and|for|degli|di|de|der|des)$/i.test(x));
  const ini = (w.length >= 2 ? w[0][0] + w[1][0] : (w[0] || u.name).slice(0, 2)).toUpperCase().replace(/[<&>]/g, '');
  const col = COLORS[parseInt(crypto.createHash('md5').update(u.name).digest('hex').slice(0, 6), 16) % COLORS.length];
  res.setHeader('Content-Type', 'image/svg+xml'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="20" fill="${col}"/><path d="M48 18 20 31v5h56v-5z" fill="#fff" opacity=".25"/><text x="48" y="62" font-family="Segoe UI,Arial,sans-serif" font-size="32" font-weight="700" text-anchor="middle" fill="#fff">${ini}</text></svg>`);
}
async function saveLogo(uniId: unknown, file: Express.Multer.File) {
  checkFile(file, ['png', 'jpg', 'jpeg'], 2);
  const u = await University.findById(uniId);
  if (!u) throw notFound('University');
  const a = await uploadBuffer(file, 'logos');
  if (u.logo_public_id) await destroyAsset(u.logo_public_id, 'image').catch(() => {});
  u.set({ logo_url: a.url, logo_public_id: a.publicId, logo_updated_at: new Date() }); await u.save();
  return u;
}
const norm = (s: string) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\.(png|jpe?g)$/i, '')
  .replace(/\b(the|of|university|universita|universitat|universite|universidad|di|de|der|des|degli|studi)\b/g, ' ').replace(/[^a-z0-9]+/g, '');
function matchUniversity(fileName: string, unis: { _id: unknown; name: string; short_name?: string }[]) {
  const base = fileName.replace(/\.[^.]+$/, '');
  const exact = unis.find((u) => String(u._id) === base || u.name.toLowerCase() === base.toLowerCase() || u.short_name?.toLowerCase() === base.toLowerCase());
  if (exact) return exact;
  const n = norm(base);
  if (!n) return null;
  const hits = unis.filter((u) => norm(u.name) === n || (u.short_name && norm(u.short_name) === n));
  if (hits.length === 1) return hits[0];
  const partial = unis.filter((u) => norm(u.name).includes(n) || n.includes(norm(u.name)));
  return partial.length === 1 ? partial[0] : null;
}
router.get('/admin/universities', handle(async (_req, res) => {
  const N = await names();
  const rows = await University.find({ is_deleted: false }).sort({ name: 1 }).lean();
  res.json(await Promise.all(rows.map(async (u) => ({ id: String(u._id), name: u.name, short_name: u.short_name ?? null, country: N(u.country_id), city: u.city ?? null, has_logo: !!u.logo_url,
    logo: logoOf(u), courses: await Course.countDocuments({ university_id: u._id, is_deleted: false }) }))));
}));
router.post('/admin/universities/:id/logo', upload.single('logo'), handle(async (req, res) => {
  if (!req.file) throw bad('Choose a logo (PNG or JPG)');
  const u = await saveLogo(oid(req.params.id), req.file);
  await audit(req, 'Update', 'University', u._id, 'Logo uploaded');
  res.json({ ok: true, logo: logoOf(u) });
}));
router.delete('/admin/universities/:id/logo', handle(async (req, res) => {
  const u = await University.findById(oid(req.params.id));
  if (!u) throw notFound();
  if (u.logo_public_id) await destroyAsset(u.logo_public_id, 'image').catch(() => {});
  u.set({ logo_url: undefined, logo_public_id: undefined, logo_updated_at: new Date() }); await u.save();
  await audit(req, 'Update', 'University', u._id, 'Logo removed');
  res.json({ ok: true });
}));
// many images at once: the file name is the university name (or its short name / ID); preview first, then save
router.post('/admin/universities/logos/:mode(preview|commit)', upload.array('logos', 100), handle(async (req, res) => {
  const list = (req.files as Express.Multer.File[]) ?? [];
  if (!list.length) throw bad('Choose the logo images');
  const unis = await University.find({ is_deleted: false }).select('name short_name logo_url').lean();
  const out: Any[] = [];
  const used = new Set<string>();
  for (const f of list) {
    const file = f.originalname.split(/[\\/]/).pop()!;
    try { checkFile(f, ['png', 'jpg', 'jpeg'], 2); } catch (e) { out.push({ file, status: 'Error', reason: (e as Error).message }); continue; }
    const u = matchUniversity(file, unis);
    if (!u) { out.push({ file, status: 'Error', reason: 'No university with this name. Rename the file to the exact university name.' }); continue; }
    if (used.has(String(u._id))) { out.push({ file, status: 'Error', reason: `Another file in this upload is also for ${u.name}` }); continue; }
    used.add(String(u._id));
    out.push({ file, status: (u as { logo_url?: string }).logo_url ? 'Replace' : 'New', university: u.name, university_id: String(u._id) });
    if (req.params.mode === 'commit') await saveLogo(u._id, f);
  }
  if (req.params.mode === 'commit') await audit(req, 'Update', 'University', null, `Bulk logos: ${out.filter((x) => x.status !== 'Error').length} saved`);
  res.json({ rows: out, counts: out.reduce((m, x) => { m[x.status] = (m[x.status] || 0) + 1; return m; }, {} as Record<string, number>) });
}));

// ---------- universities, one at a time ----------
router.get('/admin/catalogue/universities', handle(async (_req, res) => {
  const N = await names();
  const rows = await University.find({ is_deleted: false }).sort({ uni_code: 1 }).lean();
  res.json(await Promise.all(rows.map(async (u) => {
    const d = defaultsOf(u);
    const cnt = (f: Any = {}) => Course.countDocuments({ university_id: u._id, is_deleted: false, ...f });
    return { id: String(u._id), uni_code: u.uni_code, name: u.name, city: u.city ?? null, country: N(u.country_id), courses: await cnt(), published: await cnt({ status: 'Published' }), drafts: await cnt({ status: 'Draft' }),
      own_values: await cnt({ $or: [{ own_intakes: true }, { own_english: true }, { own_app_fee: true }, { own_academic: true }] }),
      settings: { intakes: d.intakes.length, english: d.english.map((e) => `${e.test_type}${e.min_overall ? ' ' + e.min_overall : ''}`).join(', '), next_deadline: d.intakes.map((i) => i.deadline).filter(Boolean).sort()[0] ?? null } };
  })));
}));
router.post('/admin/catalogue/universities', handle(async (req, res) => {
  const b = req.body ?? {};
  const errors: Record<string, string> = {};
  const name = clean(b.name, 150);
  if (!name) errors.name = 'Name is required';
  if (!oid(b.country_id) || !(await Country.exists({ _id: oid(b.country_id) }))) errors.country_id = 'Country is required';
  if (name && (await University.exists({ name: new RegExp(`^${escRx(name)}$`, 'i'), is_deleted: false }))) errors.name = 'This university already exists';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  const u = await University.create({ name, country_id: oid(b.country_id), city: clean(b.city, 80), website: clean(b.website, 300), uni_code: await nextUniCode(oid(b.country_id)), created_by: req.user!.id });
  await audit(req, 'Create', 'University', u._id, `${u.uni_code} ${u.name}`);
  res.json({ id: String(u._id), uni_code: u.uni_code });
}));
router.get('/admin/catalogue/universities/:id/settings', handle(async (req, res) => {
  const u = await uniOf(req.params.id);
  const N = await names();
  res.json({ university: { id: String(u._id), uni_code: u.uni_code, name: u.name, country: N(u.country_id), city: u.city }, settings: defaultsOf(u),
    courses: (await Course.find({ university_id: u._id, is_deleted: false }).sort({ course_uid: 1 }).select('course_uid name level status own_intakes own_english own_app_fee own_academic').lean())
      .map((c) => ({ ...c, id: String(c._id), _id: undefined })) });
}));
router.put('/admin/catalogue/universities/:id/settings', handle(async (req, res) => {
  const u = await uniOf(req.params.id);
  u.set({ course_defaults: await cleanDefaults(req.body ?? {}) }); await u.save();
  const n = await applyDefaults(u._id);
  await audit(req, 'Update', 'University', u._id, `${u.uni_code} course settings (applied to ${n} course(s))`);
  res.json({ ok: true, applied_to: n });
}));
router.post('/admin/catalogue/universities/:id/publish', handle(async (req, res) => {
  const u = await uniOf(req.params.id);
  const ids = await Course.distinct('_id', { university_id: u._id, is_deleted: false, status: 'Draft' });
  const out = await setStatus(ids, 'Published', req.user!.id);
  await audit(req, 'Update', 'University', u._id, `${u.uni_code}: published ${out.changed} draft course(s), ${out.skipped.length} not complete`);
  res.json(out);
}));
router.post('/admin/catalogue/status', handle(async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).slice(0, 2000);
  const st = req.body?.status;
  if (!ids.length) throw bad('Choose the courses first');
  if (!['Published', 'Draft', 'Hidden'].includes(st)) throw bad('Status must be Published, Draft or Hidden');
  const out = await setStatus(ids, st, req.user!.id);
  await audit(req, 'Update', 'Course', null, `Status ${st}: ${out.changed} course(s), ${out.skipped.length} not complete`);
  res.json(out);
}));

// ---------- Excel for ONE university: download, change, upload again (a file can never change another university) ----------
const COURSE_COLS: [string, string, number, string?][] = [['Course ID', 'course_id', 15, 'Existing course: keep its Course ID. New course: leave empty (made on upload).'], ['Course name', 'name', 40, 'Required'],
  ['Level', 'level', 14, COURSE_LEVELS.join(', ')], ['Field of study', 'field', 24, 'Exact name from Admin > Masters > Fields of study'], ['Duration months', 'duration_months', 10, 'Number, e.g. 24'],
  ['Language', 'language', 12, 'Empty = university setting'], ['Tuition fee', 'tuition_fee', 12, 'Per year, number only. 0 allowed'], ['Currency', 'currency', 9, 'Empty = university setting'],
  ['Tuition fee non EU', 'tuition_fee_non_eu', 12, 'Only if different'], ['Fee note', 'fee_note', 20], ['Official link', 'course_link', 38, 'https:// only'], ['Description', 'description', 40, 'Max 1500 characters'],
  ['Scholarship text', 'scholarship_text', 26], ['Status', 'status', 11, 'Draft / Published / Hidden. Empty = keep (new courses: Draft)'], ['Last verified on', 'last_verified_on', 12, 'YYYY-MM-DD'],
  ['Own deadline (only if different)', 'own_deadline', 16, 'Fill ONLY if this course has another deadline than the university. YYYY-MM-DD'],
  ['Own IELTS overall (only if different)', 'own_ielts_overall', 14, 'Fill ONLY if this course needs another IELTS than the university'], ['Own IELTS band (only if different)', 'own_ielts_band', 14, 'Fill ONLY if different']];
router.get('/admin/catalogue/universities/:id/excel', handle(async (req, res) => {
  const u = await uniOf(req.params.id);
  const d = defaultsOf(u);
  const N = await names();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'La Europa CRM';
  const us = wb.addWorksheet('University');
  us.columns = [{ width: 34 }, { width: 26 }, { width: 26 }, { width: 26 }, { width: 22 }];
  us.addRow([`${u.uni_code} · ${u.name}`]).font = { bold: true, size: 15 };
  us.addRow(['This file is ONLY for this university. Settings below apply to every course of the university, unless a course has its own value.']).font = { italic: true, color: { argb: 'FF5B6478' } };
  us.addRow([]);
  const section = (text: string) => { us.addRow([text]).font = { bold: true, color: { argb: 'FF5B56E9' }, size: 12 }; };
  section('UNIVERSITY');
  for (const [k, v, n] of [['University ID', u.uni_code, 'do not change'], ['University', u.name, 'do not change'], ['Country', N(u.country_id), 'do not change'], ['Application fee', d.application_fee ?? '', 'number, 0 = free'],
    ['Application fee currency', d.application_fee_currency || 'EUR', ''], ['Tuition currency (default)', d.currency || '', 'used when a course has no currency'], ['Language (default)', d.language || '', 'used when a course has no language'],
    ['Required previous level', d.academic.required_level || '', '12th / Bachelor / Master'], ['Minimum percent', d.academic.min_percent ?? '', 'e.g. 60'], ['Maximum backlogs', d.academic.max_backlogs ?? '', ''],
    ['Work experience (months)', d.academic.min_work_months ?? '', ''], ['Entrance test', d.academic.entrance_test || '', 'none / GMAT / GRE / SAT']] as [string, unknown, string][]) {
    const row = us.addRow([k, v, n]); row.getCell(1).font = { bold: true }; row.getCell(3).font = { italic: true, color: { argb: 'FF5B6478' } };
  }
  us.addRow([]);
  section('INTAKES (application opens / deadline)');
  us.addRow(['Intake', 'Application opens', 'Application deadline', 'Deadline note']).font = { bold: true };
  for (const i of d.intakes.length ? d.intakes : [{} as Any]) us.addRow([i.intake_id ? N(i.intake_id) : '', i.open_date || '', i.deadline || '', i.deadline_note || '']);
  for (let k = 0; k < 4; k++) us.addRow(['', '', '', '']);
  us.addRow([]);
  section('ENGLISH TESTS');
  us.addRow(['Test', 'Min overall', 'Min band', 'MOI accepted', '12th English waiver %']).font = { bold: true };
  for (const e of d.english.length ? d.english : TESTS.map((x) => ({ test_type: x }) as Any)) us.addRow([e.test_type, e.min_overall ?? '', e.min_band ?? '', e.moi_accepted ? 'Yes' : e.moi_accepted === false ? 'No' : '', e.min_12th_english_percent ?? '']);
  const cs = wb.addWorksheet('Courses', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
  cs.columns = COURSE_COLS.map(([header, key, width]) => ({ header, key, width }));
  const hr = cs.getRow(1); hr.font = { bold: true, color: { argb: 'FFFFFFFF' } }; hr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B56E9' } }; hr.height = 32; hr.alignment = { vertical: 'middle', wrapText: true };
  COURSE_COLS.forEach(([, , , note], i) => { if (note) cs.getCell(1, i + 1).note = note; });
  for (const c of await Course.find({ university_id: u._id, is_deleted: false }).sort({ course_uid: 1 }).lean()) {
    const ownI = c.own_intakes ? (c.intakes ?? []).map((i) => i.deadline).filter(Boolean).sort()[0] : '';
    const ownE = c.own_english ? (c.english ?? []).find((e) => e.test_type === 'IELTS') : null;
    cs.addRow({ course_id: c.course_uid, name: c.name, level: c.level, field: c.field ?? N(c.field_of_study_id), duration_months: c.duration_months, language: c.language, tuition_fee: c.tuition_fee, currency: c.currency,
      tuition_fee_non_eu: c.tuition_fee_non_eu, fee_note: c.fee_note, course_link: c.course_link, description: c.description, scholarship_text: c.scholarship_text, status: c.status, last_verified_on: c.last_verified_on,
      own_deadline: ownI ?? '', own_ielts_overall: ownE?.min_overall ?? '', own_ielts_band: ownE?.min_band ?? '' });
  }
  for (let i = 2; i <= Math.max(300, cs.rowCount + 200); i++) {
    cs.getCell(`C${i}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${COURSE_LEVELS.join(',')}"`] };
    cs.getCell(`N${i}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Draft,Published,Hidden"'] };
  }
  const h = wb.addWorksheet('How to fill');
  h.columns = [{ width: 120 }];
  const fields = (await MasterItem.find({ type: 'field_of_study' }).sort({ sort: 1, name: 1 }).select('name').lean()).map((x) => x.name).join(', ');
  const intakes = (await Intake.find({ active: true }).sort({ year: 1, month: 1 }).select('name').lean()).map((x) => x.name).join(', ');
  [`How to fill this file (${u.uni_code} ${u.name})`, '', '1. This file is for ONE university only. Upload it in Add / upload courses > this university > Upload Excel. A file of another university is refused.',
    '2. Sheet "University": the settings that are the same for all courses (intakes with application opening date and deadline, English tests, application fee, minimum academic requirement). Change them here once: every course follows.',
    '3. Sheet "Courses": one row per course. Course ID filled = update that course. Course ID empty = new course (the ID is made on upload). Same course name + level is matched too.',
    '4. Intakes, deadlines and English tests are NOT repeated per course. Use the "Own ... (only if different)" columns only for a course that really differs from the university.',
    '5. Empty cells keep what is there. Nothing is deleted. Upload shows a preview with errors first; only then you confirm.',
    '6. Intake names must match Admin > Masters > Intakes, e.g. "Sep 2027". Dates: YYYY-MM-DD.', '', 'Fields of study: ' + fields, 'Intakes: ' + intakes]
    .forEach((x, i) => { const row = h.addRow([x]); row.alignment = { wrapText: true }; if (i === 0) row.font = { bold: true, size: 14 }; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${u.uni_code}-courses.xlsx"`);
  await wb.xlsx.write(res); res.end();
}));
const cellVal = (c: ExcelJS.Cell) => {
  let v: unknown = c.value;
  if (v && typeof v === 'object') { const o = v as Any; v = v instanceof Date ? v.toISOString().slice(0, 10) : o.text || o.result || o.hyperlink || (o.richText ? o.richText.map((x: Any) => x.text).join('') : ''); }
  return v === null || v === undefined ? '' : String(v).trim();
};
function readUniversitySheet(ws: ExcelJS.Worksheet) {
  const out = { kv: {} as Record<string, string>, intakes: [] as Any[], english: [] as Any[] };
  let mode = 'kv';
  ws.eachRow({ includeEmpty: false }, (row) => {
    const [a, b, c, d, e] = [1, 2, 3, 4, 5].map((i) => cellVal(row.getCell(i)));
    if (/^INTAKES/i.test(a)) { mode = 'intakes'; return; }
    if (/^ENGLISH TESTS/i.test(a)) { mode = 'english'; return; }
    if (/^UNIVERSITY$/i.test(a)) { mode = 'kv'; return; }
    if (mode === 'intakes') { if (!/^intake$/i.test(a) && a) out.intakes.push({ name: a, open_date: b, deadline: c, deadline_note: d }); }
    else if (mode === 'english') { if (!/^test$/i.test(a) && a && (b || c || d || e)) out.english.push({ test_type: a, min_overall: b, min_band: c, moi: d, w12: e }); }
    else if (a) out.kv[a.toLowerCase()] = b;
  });
  return out;
}
async function analyse(u: InstanceType<typeof University>, wb: ExcelJS.Workbook) {
  const errors: string[] = [];
  const rows: Any[] = [];
  const us = wb.getWorksheet('University'), cs = wb.getWorksheet('Courses');
  if (!cs) throw bad('This is not a university course file: the "Courses" sheet is missing. Download the Excel of this university first.');
  let settings = null;
  if (us) {
    const s = readUniversitySheet(us);
    const fileUni = (s.kv['university id'] || '').toUpperCase();
    if (fileUni && fileUni !== String(u.uni_code).toUpperCase()) throw bad(`This file is for ${fileUni}, not for ${u.uni_code} (${u.name}). Upload it on the right university.`);
    const intakes = [];
    for (const i of s.intakes) {
      const it = await Intake.findOne({ name: new RegExp(`^${escRx(String(i.name).trim())}$`, 'i') }).lean();
      if (!it) errors.push(`University sheet: intake "${i.name}" not found (Admin > Masters > Intakes)`); else intakes.push({ intake_id: String(it._id), open_date: i.open_date, deadline: i.deadline, deadline_note: i.deadline_note });
    }
    const english = s.english.map((e) => ({ test_type: TESTS.find((x) => x.toLowerCase() === String(e.test_type).toLowerCase()) ?? null, min_overall: e.min_overall, min_band: e.min_band, moi_accepted: yes(e.moi), min_12th_english_percent: e.w12 }))
      .filter((e) => { if (!e.test_type) errors.push('University sheet: English test must be IELTS, TOEFL, PTE or Duolingo'); return e.test_type; });
    try {
      settings = await cleanDefaults({ intakes, english, application_fee: s.kv['application fee'], application_fee_currency: s.kv['application fee currency'], currency: s.kv['tuition currency (default)'],
        language: s.kv['language (default)'], academic: { required_level: s.kv['required previous level'], min_percent: s.kv['minimum percent'], max_backlogs: s.kv['maximum backlogs'],
          min_work_months: s.kv['work experience (months)'], entrance_test: s.kv['entrance test'] } });
    } catch (e) { errors.push('University sheet: ' + (Object.values(((e as { extra?: { errors?: Record<string, string> } }).extra?.errors) ?? {}).join('; ') || (e as Error).message)); }
  }
  const hdr = (cs.getRow(1).values as unknown[]).slice(1).map((x) => String(x ?? '').trim().toLowerCase());
  const idx = Object.fromEntries(COURSE_COLS.map(([h, k]) => [k, hdr.indexOf(h.toLowerCase())]));
  if (idx.name < 0) throw bad('The Courses sheet needs the "Course name" column');
  const seen = new Set<string>();
  const fields = await MasterItem.find({ type: 'field_of_study' }).select('name').lean();
  const lines: { n: number; v: (k: string) => string }[] = [];
  cs.eachRow({ includeEmpty: false }, (row, n) => { if (n > 1) lines.push({ n, v: (k) => (idx[k] >= 0 ? cellVal(row.getCell(idx[k] + 1)) : '') }); });
  for (const { n, v } of lines) {
    const name = v('name'), cid = v('course_id').toUpperCase();
    if (!name && !cid) continue;
    const e: string[] = [];
    let existing = cid ? await Course.findOne({ course_uid: cid, is_deleted: false }) : null;
    if (cid && !existing) e.push(`Course ID ${cid} not found (leave it empty for a new course)`);
    else if (existing && String(existing.university_id) !== String(u._id)) e.push(`Course ID ${cid} belongs to another university: not allowed in this file`);
    const lv = COURSE_LEVELS.find((l) => l.toLowerCase() === v('level').toLowerCase());
    if (!existing && !lv) e.push(`Level "${v('level')}" not valid`);
    if (!existing && !name) e.push('Course name missing');
    if (!existing && !cid && name && lv) existing = await Course.findOne({ university_id: u._id, name: new RegExp(`^\\s*${escRx(name)}\\s*$`, 'i'), level: lv, is_deleted: false });
    const field = v('field') ? fields.find((f) => f.name.toLowerCase() === v('field').toLowerCase()) : null;
    if (v('field') && !field) e.push(`Field of study "${v('field')}" not found`);
    if (!existing && !field) e.push('Field of study missing');
    const link = v('course_link');
    if (link && !/^https:\/\//i.test(link)) e.push('Official link must start with https://');
    if (!existing && !link) e.push('Official link missing');
    if (!existing && num(v('duration_months')) === undefined) e.push('Duration (months) missing');
    if (!existing && num(v('tuition_fee').replace(/[^\d.]/g, '')) === undefined) e.push('Tuition fee missing');
    const od = normDate(v('own_deadline')); if (od === 'INVALID') e.push('Own deadline is not a date (YYYY-MM-DD)');
    const lvd = normDate(v('last_verified_on')); if (lvd === 'INVALID') e.push('Last verified on is not a date');
    const st = v('status'); if (st && !['Draft', 'Published', 'Hidden'].includes(st)) e.push('Status must be Draft, Published or Hidden');
    const key = (existing ? String(existing._id) : `${name}|${lv}`).toLowerCase();
    if (seen.has(key)) e.push('Same course twice in this file');
    seen.add(key);
    rows.push({ row: n, status: e.length ? 'Error' : existing ? 'Update' : 'New', reason: e.join('; '), course: name || existing?.name, course_id: existing?.course_uid ?? null, existing, field, level: lv, link, od, lvd, st,
      v: Object.fromEntries(COURSE_COLS.map(([, k]) => [k, v(k)])) });
  }
  return { settings, rows, errors };
}
router.post('/admin/catalogue/universities/:id/import/:mode(preview|commit)', upload.single('file'), handle(async (req, res) => {
  const u = await uniOf(req.params.id);
  if (!req.file) throw bad('Choose the Excel file');
  if (!/\.xlsx$/i.test(req.file.originalname)) throw bad('Upload the .xlsx file of this university');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(req.file.buffer as unknown as ArrayBuffer);
  const a = await analyse(u, wb);
  const commit = req.params.mode === 'commit';
  const publish = yes(req.body?.publish); // empty Status = Published for new and Draft courses
  if (commit && a.errors.length) throw bad('Fix the University sheet first: ' + a.errors.join('; '));
  const counts = a.rows.reduce((m, y) => { m[y.status] = (m[y.status] || 0) + 1; return m; }, {} as Record<string, number>);
  let applied = 0;
  if (commit) {
    const batchId = new Types.ObjectId();
    if (a.settings) { u.set({ course_defaults: a.settings }); await u.save(); }
    const d = a.settings ?? defaultsOf(u);
    for (const x of a.rows.filter((y) => y.status !== 'Error')) {
      const c = x.existing, v = x.v;
      const b = { university_id: u._id, name: v.name || c.name, level: x.level || c.level, field_of_study_id: x.field?._id ?? c?.field_of_study_id, duration_months: v.duration_months || c?.duration_months,
        language: v.language || c?.language || d.language || 'English', tuition_fee: v.tuition_fee !== '' ? String(v.tuition_fee).replace(/[^\d.]/g, '') : c?.tuition_fee,
        currency: v.currency || c?.currency || d.currency || 'EUR', tuition_fee_non_eu: v.tuition_fee_non_eu !== '' ? v.tuition_fee_non_eu : c?.tuition_fee_non_eu ?? null, fee_note: v.fee_note || c?.fee_note,
        course_link: x.link || c?.course_link, description: v.description || c?.description, scholarship: !!(v.scholarship_text || c?.scholarship_text), scholarship_text: v.scholarship_text || c?.scholarship_text,
        last_verified_on: x.lvd || c?.last_verified_on || istDate(), status: x.st || (publish && (!c || c.status === 'Draft') ? 'Published' : c ? c.status : 'Draft') };
      const id = await saveCourse(c?._id ?? null, b, req.user!.id, batchId);
      // "only if different": this course keeps its own deadline / IELTS
      if (x.od || v.own_ielts_overall !== '' || v.own_ielts_band !== '') {
        const course = (await Course.findById(id))!;
        if (x.od) {
          const its = await Intake.find({ _id: { $in: d.intakes.map((i) => i.intake_id) } }).lean();
          course.own_intakes = true;
          course.set('intakes', (d.intakes.length ? d.intakes : [{} as Any]).map((i) => { const it = its.find((y) => String(y._id) === i.intake_id); return { intake_id: i.intake_id || null, month: it?.month ?? null, year: it?.year ?? null, open_date: i.open_date || null, deadline: x.od, deadline_note: 'Course deadline' }; }));
        }
        if (v.own_ielts_overall !== '' || v.own_ielts_band !== '') {
          course.own_english = true;
          course.min_english = num(v.own_ielts_overall) ?? null;
          course.set('english', [{ test_type: 'IELTS', min_overall: num(v.own_ielts_overall) ?? null, min_band: num(v.own_ielts_band) ?? null, moi_accepted: !!d.english.find((y) => y.test_type === 'IELTS')?.moi_accepted, min_12th_english_percent: null },
            ...d.english.filter((e) => e.test_type !== 'IELTS')]);
        }
        await course.save();
      }
    }
    applied = await applyDefaults(u._id);
    await CourseImportBatch.create({ _id: batchId, file_name: `${u.uni_code}: ${req.file.originalname}`, run_by: req.user!.id, counts, errors: a.rows.filter((y) => y.status === 'Error').map((y) => ({ row: y.row, status: 'Error', reason: y.reason, course: y.course })), mode: 'university' });
    await audit(req, 'Create', 'CourseImportBatch', batchId, `${u.uni_code} ${req.file.originalname}`, null, counts);
  }
  res.json({ university: { uni_code: u.uni_code, name: u.name }, settings: a.settings, settings_errors: a.errors, counts, applied_to: applied,
    rows: a.rows.map((y) => ({ row: y.row, status: y.status, reason: y.reason, course: y.course, course_id: y.course_id })) });
}));

// ---------- the course admin (S38) ----------
router.get('/admin/catalogue', handle(async (req, res) => {
  const q = req.query as Record<string, string>;
  const N = await names();
  const unis = await University.find({ is_deleted: false, ...(oid(q.country) ? { country_id: oid(q.country) } : {}) }).select('name uni_code country_id').lean();
  const f: Any = { is_deleted: false, university_id: { $in: unis.map((u) => u._id) } };
  if (q.status) f.status = q.status;
  if (q.q) { const rx = new RegExp(escRx(q.q), 'i'); f.$or = [{ name: rx }, { university_id: { $in: unis.filter((u) => rx.test(u.name)).map((u) => u._id) } }]; }
  const stale = addDays(istDate(), -183);
  if (q.stale === '1') f.$and = [{ $or: [{ last_verified_on: null }, { last_verified_on: { $lt: stale } }] }];
  const rows = await Course.find(f).limit(1000).lean();
  const byId = new Map(unis.map((u) => [String(u._id), u]));
  rows.sort((a, b) => String(byId.get(String(a.university_id))?.name).localeCompare(String(byId.get(String(b.university_id))?.name)) || a.name.localeCompare(b.name));
  res.json({ rows: rows.map((c) => { const u = byId.get(String(c.university_id)); return { id: String(c._id), code: c.course_uid || c.course_code, university_code: u?.uni_code ?? null, name: c.name, level: c.level,
    university: u?.name, country: N(u?.country_id), status: c.status || 'Draft', tuition_fee: c.tuition_fee, currency: c.currency, field: c.field ?? N(c.field_of_study_id), last_verified_on: c.last_verified_on,
    stale: !c.last_verified_on || c.last_verified_on < stale, not_in_last_import: !!c.not_in_last_import, intakes: (c.intakes ?? []).length }; }), total: rows.length });
}));
router.get('/admin/catalogue/:id', handle(async (req, res) => {
  const c = await Course.findById(oid(req.params.id)).lean();
  if (!c) throw notFound();
  const names0 = await userNames();
  res.json({ ...c, id: String(c._id), _id: undefined, history: (await CourseChange.find({ course_id: c._id }).sort({ changed_at: -1 }).limit(50).lean()).map((h) => ({ ...h, id: String(h._id), by: nameIn(names0, h.changed_by) })) });
}));
router.post('/admin/catalogue', handle(async (req, res) => {
  const id = await saveCourse(null, req.body ?? {}, req.user!.id);
  await setFollow(id, req.body ?? {});
  await audit(req, 'Create', 'Course', id, req.body?.name);
  res.json({ id: String(id) });
}));
router.put('/admin/catalogue/:id', handle(async (req, res) => {
  if (!(await Course.exists({ _id: oid(req.params.id) }))) throw notFound();
  await saveCourse(oid(req.params.id), req.body ?? {}, req.user!.id);
  await setFollow(oid(req.params.id), req.body ?? {});
  await audit(req, 'Update', 'Course', req.params.id, req.body?.name);
  res.json({ ok: true });
}));
router.get('/admin/catalogue-batches', handle(async (_req, res) => {
  const names0 = await userNames();
  res.json((await CourseImportBatch.find().sort({ run_at: -1 }).limit(50).lean()).map((b: Any) => ({ ...b, id: String(b._id), errors: (b.errors ?? []).length, by: nameIn(names0, b.run_by) })));
}));
router.get('/admin/catalogue-batches/:id/errors.xlsx', handle(async (req, res) => {
  const b = (await CourseImportBatch.findById(oid(req.params.id)).lean()) as Any;
  if (!b) throw notFound();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Errors');
  ws.columns = [{ header: 'Row', key: 'row' }, { header: 'Course', key: 'course', width: 30 }, { header: 'Reason', key: 'reason', width: 60 }];
  for (const e of b.errors ?? []) ws.addRow(e);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', 'attachment; filename="import-errors.xlsx"');
  await wb.xlsx.write(res); res.end();
}));

// ---------- staff course search (eligibility for one student when a student is chosen) ----------
router.get('/course-search/filters', handle(async (req, res) => {
  const out: Any = { ...(await filterOptions()), intakes: (await Intake.find({ active: true }).sort({ year: 1, month: 1 }).select('name').lean()).map((x) => ({ id: String(x._id), name: x.name })) };
  if (req.query.student_id) {
    const s = await loadStudent(req, String(req.query.student_id));
    out.student = { id: String(s._id), name: fullName(s), code: s.student_code, profile_line: (await academicSummary(s)).line,
      defaults: { country: s.prefs?.country_ids?.[0] ? String(s.prefs.country_ids[0]) : '', intake_id: s.prefs?.intake_id ? String(s.prefs.intake_id) : '' } };
  }
  res.json(out);
}));
router.get('/course-search', handle(async (req, res) => {
  const q = { ...req.query } as Any;
  const s = q.student_id ? await loadStudent(req, String(q.student_id)) : null;
  const c = s ? await ctxForStudent(s) : null;
  const result: Any = await search(c, q);
  const shortlisted = s ? new Set((await Shortlist.distinct('course_id', { student_id: s._id, is_deleted: false })).map(String)) : null;
  for (const row of result.rows) { if (shortlisted) row.in_shortlist = shortlisted.has(row.id); delete row.saved; if (!c) { delete row.eligibility; delete row.suggested; } }
  if (c) {
    const all0 = await search(c, { ...q, eligible: '', page: 1000 });
    result.counts = all0.rows.reduce((m: Record<string, number>, x: Any) => { m[x.eligibility.overall] = (m[x.eligibility.overall] || 0) + 1; return m; }, {});
    result.counts.all = all0.total;
  }
  res.json(result);
}));
router.get('/course-search/:id', handle(async (req, res) => {
  const row = await Course.findOne({ _id: oid(req.params.id), is_deleted: false });
  if (!row) throw notFound('Course');
  const s = req.query.student_id ? await loadStudent(req, String(req.query.student_id)) : null;
  const out = await courseOut(row, s ? await ctxForStudent(s) : null, { detail: true });
  out.status = row.status; delete out.saved;
  if (s) out.in_shortlist = !!(await Shortlist.exists({ student_id: s._id, course_id: row._id, is_deleted: false }));
  res.json(out);
}));
// a catalogue course into the student's shortlist as a Suggestion (the counsellor then shares it as usual)
router.post('/students/:id/shortlist/from-catalogue/:cid', handle(async (req, res) => {
  need(req, 'shortlist', 'add');
  const s = await loadStudent(req, req.params.id);
  const c = await Course.findOne({ _id: oid(req.params.cid), is_deleted: false });
  if (!c) throw notFound('Course');
  if (await Shortlist.exists({ student_id: s._id, course_id: c._id, is_deleted: false })) throw bad("This course is already in the student's shortlist");
  const uni = (await University.findById(c.university_id).lean())!;
  const intake = oid(req.body?.intake_id) ?? s.prefs?.intake_id;
  if (!intake) throw fieldErr('intake_id', 'Choose the intake');
  const ci = (c.intakes ?? []).find((i) => String(i.intake_id) === String(intake));
  const b = { country_id: uni.country_id, university_id: uni._id, course_id: c._id, level: c.level || 'Master', intake_id: intake, tuition_fee: c.tuition_fee, currency: c.currency,
    application_fee: c.application_fee, deadline: ci?.deadline ?? null, course_link: c.course_link, language: c.language, duration: c.duration };
  const N = await workNames();
  const warn = await shortlistWarnings(s, b, N);
  const sl = await Shortlist.create({ student_id: s._id, ...b, status: 'Suggested', remarks: clean(req.body?.note, 500), warning_flags: (warn ?? []).map((x: Any) => x.code), created_by: req.user!.id });
  await timeline({ student_id: s._id, type: 'profile', description: `Shortlist option added from course search: ${uni.name} - ${c.name} (${N.name(intake)})`, user_id: req.user!.id });
  await audit(req, 'Create', 'Shortlist', sl._id, s.student_code);
  res.json({ id: String(sl._id), warnings: warn });
}));

export default router;
