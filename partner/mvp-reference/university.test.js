'use strict';
// Phase 3 (University Portal) checks: University doc 17 acceptance checklist.
// Isolation between universities (404), whitelisted data only, 2FA, approvals, decision flow to the CRM, commission confidentiality.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'le-uni-test-'));
process.env.DATA_DIR = TMP; process.env.MAIL_PROVIDER = 'sandbox'; process.env.ADMIN_PASSWORD = 'Admin@12345'; process.env.ENV_FILE = path.join(TMP, 'none.env');

let server, base;
const H = { 'X-Requested-With': 'LaEuropaCRM' };
function client() {
  let cookie = null;
  const call = async (p, opts = {}) => {
    const h = { ...H }; if (cookie) h.Cookie = cookie; let b = opts.body;
    if (opts.json !== undefined) { h['Content-Type'] = 'application/json'; b = JSON.stringify(opts.json); }
    const r = await fetch(base + p, { method: opts.method || (b ? 'POST' : 'GET'), headers: h, body: b });
    const sc = r.headers.get('set-cookie'); if (sc && /le_usid|le_sid|le_psid/.test(sc)) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : null, headers: r.headers, raw: ct.includes('json') ? null : Buffer.from(await r.arrayBuffer()) };
  };
  return call;
}
const lastCode = () => { const out = path.join(TMP, 'outbox'); const f = fs.readdirSync(out).filter(x => x.endsWith('.eml')).map(x => path.join(out, x)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]; return fs.readFileSync(f, 'utf8').match(/portal code is (\d{6})/)[1]; };
const sessions = {}; // one login per user: 2FA code emails are rate limited (6 per hour)
async function uniLogin(email, pw = 'Demo@123456!') {
  if (sessions[email]) return sessions[email];
  const c = client(); sessions[email] = c;
  const r = await c('/api/university/auth/login', { json: { email, password: pw } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  if (r.body.need_2fa) { // first login only: email code
    const v = await c('/api/university/auth/2fa/verify', { json: { code: lastCode(), code_id: r.body.code_id } });
    assert.strictEqual(v.status, 200, JSON.stringify(v.body));
  } else assert.ok(r.body.user, 'password only after the first login');
  return c;
}
let B_ID; // second university

before(async () => {
  const seed = require('../server/seed'); seed.demo(); seed.portalDemo(); seed.uniDemo();
  const app = require('../server/server');
  await new Promise(res => { server = app.listen(0, res); }); base = 'http://127.0.0.1:' + server.address().port;
  // University B: active account with one user, no applications from La Europa
  const { get, run, insert, uuid } = require('../server/db');
  const bcrypt = require('bcryptjs');
  const ub = get(`SELECT * FROM universities WHERE name = 'Demo University Dublin'`); B_ID = ub.id;
  run(`UPDATE universities SET portal_status = 'Active', display_name = 'Dublin Demo' WHERE id = ?`, ub.id);
  insert('uni_users', { id: uuid(), university_id: ub.id, name: 'Dublin Admin', email: 'admin.b@example.edu', role: 'admin', finance: 1, status: 'Active', password_hash: bcrypt.hashSync('Demo@123456!', 4), twofa_method: 'email', twofa_ready: 1 });
});
after(() => server && server.close());

test('no public sign-up, no 2FA (email code on the first login only), forgot by email code, staff and student logins cannot open the partner portal', async () => {
  const p = await client()('/api/university/auth/login', { json: { email: 'giulia.demo@example.edu', password: 'Demo@123456!' } });
  assert.ok(p.body.user && !p.body.need_2fa, 'verified user: password only');
  const c = client();
  const r = await c('/api/university/auth/login', { json: { email: 'admin.b@example.edu', password: 'Demo@123456!' } });
  assert.ok(r.body.need_2fa && r.body.first_login, 'first login asks for the email code');
  assert.strictEqual((await c('/api/university/applications')).status, 401, 'no API before the first-login code');
  assert.strictEqual((await c('/api/university/auth/2fa/verify', { json: { code: lastCode(), code_id: r.body.code_id } })).status, 200);
  sessions['admin.b@example.edu'] = c;
  assert.ok((await client()('/api/university/auth/login', { json: { email: 'admin.b@example.edu', password: 'Demo@123456!' } })).body.user, 'second login: password only');
  const f = await client()('/api/university/auth/forgot', { json: { email: 'giulia.demo@example.edu' } });
  assert.ok(f.body.code_id); assert.ok((await client()('/api/university/auth/forgot', { json: { email: 'nobody@example.edu' } })).body.code_id, 'same answer for unknown emails');
  const NEW = 'New@123456!x';
  const ok = await client()('/api/university/auth/reset', { json: { code_id: f.body.code_id, code: lastCode(), password: NEW, confirm: NEW } });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.ok((await client()('/api/university/auth/login', { json: { email: 'giulia.demo@example.edu', password: NEW } })).body.user);
  require('../server/db').run(`UPDATE uni_users SET password_hash = ?, pw_history_json = NULL WHERE email = 'giulia.demo@example.edu'`, require('bcryptjs').hashSync('Demo@123456!', 4));
  const staff = client(); await staff('/api/auth/login', { json: { login: 'neha', password: 'Demo@1234' } });
  assert.strictEqual((await staff('/api/university/applications')).status, 401, 'staff cookie does not open the university API');
  assert.strictEqual((await client()('/api/university/auth/login', { json: { email: 'neha@laeuropa.example', password: 'Demo@1234' } })).status, 401);
  assert.ok([401, 404].includes((await client()('/api/university/auth/signup', { json: {} })).status), 'no sign-up endpoint');
  const u = await uniLogin('giulia.demo@example.edu');
  assert.strictEqual((await u('/api/students')).status, 401, 'university cookie does not open the CRM');
});

test('University A cannot see University B data and vice versa (404); B sees no applications', async () => {
  const a = await uniLogin('giulia.demo@example.edu');
  const b = await uniLogin('admin.b@example.edu');
  const apps = (await a('/api/university/applications')).body.rows;
  assert.ok(apps.length >= 1);
  const id = apps[0].id;
  assert.strictEqual((await b('/api/university/applications')).body.total, 0, 'B only sees applications La Europa submitted to B');
  assert.strictEqual((await b(`/api/university/applications/${id}`)).status, 404);
  assert.strictEqual((await b(`/api/university/applications/${id}/actions/acknowledge`, { json: {} })).status, 404);
  assert.strictEqual((await b(`/api/university/messages/${id}`)).status, 404);
  assert.strictEqual((await b(`/api/university/applications/${id}/documents`)).status, 404);
  const { get } = require('../server/db');
  const courseA = get(`SELECT c.id FROM courses c JOIN universities u ON u.id = c.university_id WHERE u.name = 'Demo University of Milan' LIMIT 1`).id;
  assert.strictEqual((await b(`/api/university/courses/${courseA}`)).status, 404);
  const s = (await b('/api/university/search?q=Riya')).body; assert.strictEqual(s.length, 0, 'search only inside own applications');
});

test('only whitelisted fields reach the university (1.9 / 1.10)', async () => {
  const a = await uniLogin('giulia.demo@example.edu');
  const id = (await a('/api/university/applications')).body.rows[0].id;
  const d = (await a(`/api/university/applications/${id}`)).body;
  const blob = JSON.stringify([d, (await a('/api/university/dashboard')).body, (await a('/api/university/reports/list')).body]);
  for (const bad of ['remarks_internal', 'budget', 'sponsor', 'marital', 'spouse', 'sub_agent', 'source_id', 'referred', '9876511111', 'riya.demo@example.com', 'A1234567', 'Demo Technical University Munich', 'Uni-Assist', 'emergency', 'father'])
    assert.ok(!blob.includes(bad), 'leaked ' + bad);
  assert.match(d.identity.passport, /^A12X+7$/, 'passport masked by default');
  assert.strictEqual(d.contact, null, 'no contact details unless Admin shares them');
  assert.ok(!/Country:|Course:/.test(d.summary_line), 'no other preferred countries / courses in the summary');
});

test('decision flow: offer in review mode, counsellor applies, CRM stage + student email; acceptance, deposit, enrolment, commission', async () => {
  const a = await uniLogin('giulia.demo@example.edu');
  const crm = client(); await crm('/api/auth/login', { json: { login: 'neha', password: 'Demo@1234' } });
  const { get, all } = require('../server/db');
  const ua = (await a('/api/university/applications')).body.rows[0];
  // conditional offer with PDF
  const fd = new FormData(); fd.append('file', new Blob([Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')], { type: 'application/pdf' }), 'offer.pdf');
  fd.append('conditions', JSON.stringify([{ text: 'Final marksheet', type: 'Document' }])); fd.append('tuition', '3900'); fd.append('currency', 'EUR'); fd.append('version', String(ua.version));
  const nonEu = new FormData(); nonEu.append('letter_to_follow', 'true'); nonEu.append('letter_date', '2099-01-01'); nonEu.append('conditions', JSON.stringify([{ text: 'x' }])); nonEu.append('tuition', '1'); nonEu.append('currency', 'EUR'); nonEu.append('note', 'non-EU fee applies');
  assert.strictEqual((await a(`/api/university/applications/${ua.id}/actions/conditional_offer`, { body: nonEu })).status, 400, 'fee word filter');
  const r = await a(`/api/university/applications/${ua.id}/actions/conditional_offer`, { body: fd });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const stale = await a(`/api/university/applications/${ua.id}/actions/acknowledge`, { json: { version: ua.version } });
  assert.ok([400, 409].includes(stale.status), 'old version / wrong status rejected');
  const app = get('SELECT * FROM applications WHERE id = (SELECT application_id FROM university_applications WHERE id = ?)', ua.id);
  assert.strictEqual(app.stage, 'applied', 'review mode: CRM stage not changed yet');
  const q = (await crm('/api/university-updates')).body.rows.find(x => x.application_code === app.application_code);
  assert.ok(q, 'in the counsellor queue');
  const before0 = all(`SELECT id FROM email_logs WHERE student_id = ? AND trigger_code IN ('E07','MULTI')`, app.student_id).length;
  assert.strictEqual((await crm(`/api/university-updates/${q.id}/apply`, { json: { notify: true } })).status, 200);
  assert.strictEqual(get('SELECT stage FROM applications WHERE id = ?', app.id).stage, 'conditional_offer');
  const em = all(`SELECT * FROM email_logs WHERE student_id = ? ORDER BY queued_at DESC`, app.student_id)[0];
  assert.ok(all(`SELECT id FROM email_logs WHERE student_id = ? AND trigger_code IN ('E07','MULTI')`, app.student_id).length > before0, 'student email queued');
  assert.strictEqual(em.cc_addr, 'laeuropaapplication@gmail.com');
  assert.ok(get(`SELECT 1 x FROM application_stage_history WHERE application_id = ? AND source = 'university'`, app.id), 'history with source university');
  // university emails always CC
  for (const e of all(`SELECT cc_addr FROM email_logs WHERE recipient_type IN ('university','staff')`)) assert.strictEqual(e.cc_addr, 'laeuropaapplication@gmail.com');
  // La Europa confirms acceptance, university marks deposit + enrolled
  assert.strictEqual((await crm(`/api/applications/${app.id}/university/confirm-acceptance`, { json: {} })).status, 200);
  const dep = new FormData(); dep.append('amount', '500'); dep.append('currency', 'EUR'); dep.append('date', new Date().toISOString().slice(0, 10));
  assert.strictEqual((await a(`/api/university/applications/${ua.id}/actions/deposit`, { body: dep })).status, 200);
  const en = new FormData(); en.append('enrol_date', new Date().toISOString().slice(0, 10)); en.append('programme_start', '2027-09-15'); en.append('final_tuition', '3900'); en.append('currency', 'EUR'); en.append('student_uni_id', 'M12345');
  const er = await a(`/api/university/applications/${ua.id}/actions/enrolled`, { body: en });
  assert.strictEqual(er.status, 200, JSON.stringify(er.body));
  await new Promise(x => setTimeout(x, 200));
  const com = get('SELECT * FROM commissions WHERE uapp_id = ?', ua.id);
  assert.ok(com, 'commission created on enrolment');
  assert.strictEqual(com.amount, 390, '10% demo rule of 3900');
  assert.strictEqual(com.status, 'Due');
});

test('commission is confidential: counsellors and university users without finance access get nothing', async () => {
  const crm = client(); await crm('/api/auth/login', { json: { login: 'neha', password: 'Demo@1234' } });
  assert.strictEqual((await crm('/api/admin/commission')).status, 403);
  assert.strictEqual((await crm('/api/admin/commission/rules')).status, 403);
  const officer = await uniLogin('marco.demo@example.edu');
  assert.strictEqual((await officer('/api/university/finance')).status, 404);
  assert.strictEqual((await officer('/api/university/users')).status, 403);
  const admin = client(); await admin('/api/auth/login', { json: { login: 'demo.admin', password: 'Demo@1234' } });
  const due = (await admin('/api/admin/commission?status=Due')).body.rows;
  assert.ok(due.length);
  const inv = await admin('/api/admin/commission/invoices', { json: { commission_ids: [due[0].id] } });
  assert.strictEqual(inv.status, 200);
  assert.strictEqual((await admin(`/api/admin/commission/invoices/${inv.body.id}/issue`, { json: {} })).status, 200);
  const fin = (await (await uniLogin('giulia.demo@example.edu'))('/api/university/finance')).body;
  assert.ok(fin.invoices.some(i => /^LE-INV-/.test(i.invoice_no)), 'issued invoice visible to the university finance user');
  const pdf = await admin(`/api/admin/commission/invoices/${inv.body.id}/pdf`); assert.strictEqual(pdf.raw.slice(0, 4).toString(), '%PDF');
});

test('course changes go live only after La Europa approval; fee wording blocked', async () => {
  const a = await uniLogin('giulia.demo@example.edu');
  const { get } = require('../server/db');
  const c = get(`SELECT c.* FROM courses c JOIN universities u ON u.id = c.university_id WHERE u.name = 'Demo University of Milan' AND c.name = 'MSc Management'`);
  const cur = (await a('/api/university/courses/' + c.id)).body;
  const field = get(`SELECT id FROM master_items WHERE type = 'field_of_study' LIMIT 1`).id;
  const body = { id: c.id, name: 'MSc Management and Innovation', level: 'Master', course_link: 'https://example.edu/msc', tuition_fee: 4100, currency: 'EUR', application_fee: 0, application_fee_currency: 'EUR', required_level: 'Bachelor', min_percent: 60,
    english: [{ test_type: 'IELTS Academic', min_overall: 6.5 }], field_of_study_id: field, campus_id: cur.campus_id, duration_months: 24, language: 'English', uni_status: 'Active', intakes: [{ month: 9, year: 2027, deadline: '2027-05-31', status: 'Open' }] };
  assert.strictEqual((await a('/api/university/courses', { json: { ...body, fee_note: 'International students pay more' } })).status, 400, 'V1 fee words blocked');
  assert.strictEqual((await a('/api/university/courses', { json: { ...body, min_percent: '7.5 CGPA' } })).status, 400, 'V3 percentage only');
  const r = await a('/api/university/courses', { json: body });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(get('SELECT name FROM courses WHERE id = ?', c.id).name, 'MSc Management', 'not live before approval');
  const admin = client(); await admin('/api/auth/login', { json: { login: 'demo.admin', password: 'Demo@1234' } });
  assert.strictEqual((await admin(`/api/admin/uni-approvals/course/${r.body.id}/approve`, { json: {} })).status, 200);
  const live = get('SELECT * FROM courses WHERE id = ?', c.id);
  assert.strictEqual(live.name, 'MSc Management and Innovation'); assert.strictEqual(live.tuition_fee, 4100); assert.strictEqual(live.status, 'Published');
  assert.strictEqual(live.tuition_fee_non_eu, null);
});

test('watermarked downloads are logged; messages never reach the student', async () => {
  const a = await uniLogin('giulia.demo@example.edu');
  const { get, all } = require('../server/db');
  const ua = (await a('/api/university/applications')).body.rows[0];
  // share a verified document from La Europa
  const crm = client(); await crm('/api/auth/login', { json: { login: 'neha', password: 'Demo@1234' } });
  const appRow = get('SELECT * FROM university_applications WHERE id = ?', ua.id);
  const files = require('../server/files');
  const s = get('SELECT student_id FROM applications WHERE id = ?', appRow.application_id);
  const tid = files.typeId('Passport'); const doc = files.docFor(s.student_id, tid, {}, null);
  const { PDFDocument } = require('pdf-lib'); const pd = await PDFDocument.create(); pd.addPage([300, 400]);
  const tmp = path.join(TMP, 'pp.pdf'); fs.writeFileSync(tmp, Buffer.from(await pd.save()));
  const v = files.addVersion(doc, tmp, 'passport.pdf', 'application/pdf', 'pdf', null);
  require('../server/db').run(`UPDATE documents SET status = 'Verified' WHERE id = ?`, doc.id);
  const sh = await crm(`/api/applications/${appRow.application_id}/university/share`, { json: { version_ids: [v.id] } });
  assert.strictEqual(sh.status, 200, JSON.stringify(sh.body));
  const docs = (await a(`/api/university/applications/${ua.id}/documents`)).body;
  const share = docs.shared[0].versions[0];
  const link = (await a(`/api/university/applications/${ua.id}/documents/link`, { json: { share_id: share.share_id, download: true } })).body.url;
  const f = await a(link);
  assert.strictEqual(f.status, 200); assert.strictEqual(f.raw.slice(0, 4).toString(), '%PDF');
  assert.ok(f.raw.length > 400, 'stamped copy, not the original');
  assert.ok(get(`SELECT 1 x FROM doc_access_log WHERE uapp_id = ? AND action = 'download'`, ua.id), 'download logged');
  const b = await uniLogin('admin.b@example.edu');
  assert.notStrictEqual((await b(link)).status, 200, 'signed link bound to the user');
  // message
  const m = new FormData(); m.append('body', 'Please send course descriptions');
  assert.strictEqual((await a(`/api/university/messages/${ua.id}`, { body: m })).status, 200);
  assert.ok(!all('SELECT body FROM chat_messages').some(x => /course descriptions/.test(x.body || '')), 'not in student chat');
});
