/**
 * Security regression suite.
 *
 * Every check here stands for a hole that was open in this codebase, or one the
 * ported client API must never open: a student reading another student's
 * records, posting into someone else's thread, a token of one kind used on the
 * other app, `/auth/me` handing back its own bcrypt hash. They fail loudly if
 * any of those come back.
 *
 * Needs a local mongod. It seeds and then DROPS the database it points at, so
 * it refuses to run against anything but its own scratch database.
 *
 *   npm run test:security
 */
process.env.MODE = 'local';
const SCRATCH_DB = 'vernyr_sec_smoke';
process.env.LOCAL_MONGODB_URI = `mongodb://127.0.0.1:27017/${SCRATCH_DB}`;
process.env.JWT_SECRET = 'smoke-test-secret';
process.env.LOCAL_CLIENT_CRM_URL = 'http://localhost:3000';
process.env.LOCAL_CLIENT_STUDENT_URL = 'http://localhost:3001';
process.env.PORT = '5099';
process.env.MAIL_PROVIDER = 'sandbox';
delete process.env.ENABLE_DEV_ROUTES;

const path = require('path');
const ROOT = path.resolve(__dirname, '..').split(path.sep).join('/');

// env.ts calls dotenv.config(), which reads ./.env relative to the working
// directory. Run from a directory that has none, so the suite tests the code
// rather than whatever the developer's own backend/.env happens to say.
process.chdir(require('os').tmpdir());
require('ts-node').register({ transpileOnly: true, project: ROOT + '/tsconfig.json' });
require(ROOT + '/src/index.ts');

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const m = (p) => require(ROOT + '/src/models/' + p);
const Student = m('Student').default;
const PortalAccount = m('PortalAccount').default;
const User = m('User').default;
const Conversation = m('Conversation').default;
const { MasterItem } = m('Master');
const { Application, StudentDocument, Payment, Shortlist } = m('Work');
const { ChatMessage, OfferCondition } = m('Portal');
const { SignedDocument } = m('Privacy');
const { signPack } = require(ROOT + '/src/services/consent');
const { previewToken } = require(ROOT + '/src/middleware/portal');

const BASE = 'http://127.0.0.1:5099';
const api = (p, opts = {}, token) => fetch(BASE + p, {
  ...opts,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) },
});
const json = async (r) => { try { return await r.json(); } catch { return null; } };
const refused = (s) => s === 403 || s === 404;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
async function login(identifier, password, app) {
  const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password, app }) });
  const j = await json(r);
  return { status: r.status, token: j && j.token, body: j || {} };
}

async function main() {
  // This suite deletes collections. Never let it point anywhere but its own scratch database.
  if (mongoose.connection.name !== SCRATCH_DB) {
    console.error(`Refusing to run against "${mongoose.connection.name}" - expected "${SCRATCH_DB}"`);
    process.exit(1);
  }
  await mongoose.connection.dropDatabase();

  // ── Seed two unrelated students plus a counsellor ──────────────────────────
  const verified = new Date();
  const [alice, bob] = await Student.create([
    { student_code: 'LE-SMOKE-0001', first_name: 'Alice', last_name: 'A', email: 'alice@example.com' },
    { student_code: 'LE-SMOKE-0002', first_name: 'Bob', last_name: 'B', email: 'bob@example.com' },
  ]);
  const counsellor = await User.create({ name: 'Cara', username: 'cara.c', email: 'cara@example.com', password: 'Secret#12345', role: 'counsellor', emailVerifiedAt: verified });
  const aliceLogin = await PortalAccount.create({ name: 'Alice A', username: 'alice.s', email: 'alice@example.com', password: 'Secret#12345', role: 'student', studentId: alice._id, status: 'Active', isActive: true, emailVerifiedAt: verified });
  const bobLogin = await PortalAccount.create({ name: 'Bob B', username: 'bob.s', email: 'bob@example.com', password: 'Secret#12345', role: 'student', studentId: bob._id, status: 'Active', isActive: true, emailVerifiedAt: verified });

  // Alice has signed the Declaration (so her writes pass the consent gate); Bob has not.
  const pack = await signPack();
  await SignedDocument.create({ doc_code: 'SD-SMOKE-1', doc_type: 'student_consent', student_user_id: aliceLogin._id, student_id: alice._id, content_hash: pack.hash, typed_name: 'Alice A' });

  // Bob's private records: nothing here should ever reach Alice.
  const passport = await MasterItem.create({ type: 'document_type', name: 'Passport', active: true });
  const bobDoc = await StudentDocument.create({ student_id: bob._id, document_type_id: passport._id, status: 'Uploaded', shared_with_student: true,
    versions: [{ version_no: 1, url: 'https://example.com/bob-passport.pdf', stored_name: 'bob.pdf', uploaded_by_type: 'student' }] });
  bobDoc.current_version_id = bobDoc.versions[0]._id; await bobDoc.save();
  const bobApp = await Application.create({ application_code: 'A-SMOKE-1', student_id: bob._id, stage: 'conditional_offer', source_channel: 'portal' });
  const bobPay = await Payment.create({ student_id: bob._id, payment_for: 'La Europa service fee', amount: 5000, currency: 'INR', payment_date: '2026-01-01', mode: 'UPI' });
  const bobSl = await Shortlist.create({ student_id: bob._id, status: 'Shared with student', currency: 'EUR' });
  const bobCond = await OfferCondition.create({ application_id: bobApp._id, text: 'Send transcript' });
  const bobMsg = await ChatMessage.create({ student_id: bob._id, sender_type: 'student', sender_user_id: bobLogin._id, body: 'private' });
  const bobThread = await Conversation.create({ participants: [bobLogin._id, counsellor._id], studentId: bob._id });

  // ── Sign-in and the hash ───────────────────────────────────────────────────
  const a = await login('alice.s', 'Secret#12345', 'portal');
  check('student can sign in', a.status === 200 && !!a.token, 'status ' + a.status);
  check('login response carries no password hash', !('password' in (a.body.user || {})));
  const meBody = await json(await api('/api/auth/me', {}, a.token));
  check('GET /auth/me does not leak the bcrypt hash', meBody && !('password' in meBody) && !('password' in (meBody.user || {})));
  const injLogin = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: { $ne: null }, password: { $ne: null }, app: 'portal' }) });
  check('operator injection in the login body does not sign in', injLogin.status !== 200, 'status ' + injLogin.status);
  const wrongApp = await login('alice.s', 'Secret#12345', 'crm');
  check('a student login is refused by the CRM', wrongApp.status !== 200, 'status ' + wrongApp.status);

  // ── Cross-student reads through the portal ─────────────────────────────────
  const pDocs = await json(await api('/api/portal/documents', {}, a.token));
  const docIds = JSON.stringify(pDocs || {});
  check("portal documents exclude another student's documents", !!pDocs && !docIds.includes(String(bobDoc._id)));
  const pVer = await api(`/api/portal/documents/${bobDoc._id}/versions`, {}, a.token);
  check("portal refuses another student's document versions", refused(pVer.status), 'status ' + pVer.status);
  const pApp = await api('/api/portal/applications/' + bobApp._id, {}, a.token);
  check("portal refuses another student's application", refused(pApp.status), 'status ' + pApp.status);
  const pPays = await json(await api('/api/portal/payments', {}, a.token));
  check("portal payments exclude another student's payments", !!pPays && !JSON.stringify(pPays).includes('5000'));
  const pChat = await json(await api('/api/portal/chat/messages', {}, a.token));
  check("portal chat does not show another student's messages", !!pChat && !JSON.stringify(pChat).includes('private'));

  // ── Cross-student writes through the portal ────────────────────────────────
  const editMsg = await api('/api/portal/chat/messages/' + bobMsg._id, { method: 'PATCH', body: JSON.stringify({ body: 'injected' }) }, a.token);
  check("portal refuses editing another student's chat message", refused(editMsg.status), 'status ' + editMsg.status);
  const acceptSl = await api(`/api/portal/shortlist/${bobSl._id}/accept`, { method: 'POST', body: '{}' }, a.token);
  check("portal refuses accepting another student's shortlist option", refused(acceptSl.status), 'status ' + acceptSl.status);
  const offer = await api(`/api/portal/applications/${bobApp._id}/accept-offer`, { method: 'POST', body: JSON.stringify({ confirm: true }) }, a.token);
  check("portal refuses accepting another student's offer", refused(offer.status), 'status ' + offer.status);
  const proof = await api(`/api/portal/offer-conditions/${bobCond._id}/proof`, { method: 'POST', body: '{}' }, a.token);
  check("portal refuses a proof on another student's offer condition", refused(proof.status), 'status ' + proof.status);

  // ── Gates: consent, preview, token kinds ───────────────────────────────────
  const b = await login('bob.s', 'Secret#12345', 'portal');
  const gate = await api('/api/portal/callback', { method: 'POST', body: '{}' }, b.token);
  check('a write before signing the Declaration is refused (428)', gate.status === 428, 'status ' + gate.status);
  const pv = previewToken(aliceLogin._id, String(counsellor._id));
  const pvWrite = await api('/api/portal/callback', { method: 'POST', body: '{}' }, pv);
  check('a staff preview token cannot write', pvWrite.status === 403, 'status ' + pvWrite.status);
  const c = await login('cara.c', 'Secret#12345', 'crm');
  check('counsellor can sign in', c.status === 200 && !!c.token, 'status ' + c.status);
  const staffOnPortal = await api('/api/portal/me', {}, c.token);
  check('a staff token is refused by the portal API', staffOnPortal.status === 403, 'status ' + staffOnPortal.status);
  const forged = jwt.sign({ id: String(counsellor._id), role: 'student', name: 'x' }, 'smoke-test-secret');
  const forgedRole = await api('/api/portal/me', {}, forged);
  check('a token claiming the student role for a staff id is refused', forgedRole.status === 403 || forgedRole.status === 401, 'status ' + forgedRole.status);

  // ── Student token on staff routes ──────────────────────────────────────────
  const sStudent = await api('/api/students/' + bob._id, {}, a.token);
  check("a student token cannot read another student's CRM record", refused(sStudent.status), 'status ' + sStudent.status);
  const sOwn = await api('/api/students/' + alice._id, { method: 'PUT', body: JSON.stringify({ status: 'Enrolled' }) }, a.token);
  check('a student token cannot write its own CRM record', refused(sOwn.status), 'status ' + sOwn.status);
  const sDocs = await api(`/api/students/${bob._id}/documents`, {}, a.token);
  check("a student token cannot list another student's CRM documents", refused(sDocs.status), 'status ' + sDocs.status);
  const sLeads = await api('/api/leads', {}, a.token);
  check('a student token cannot list leads', refused(sLeads.status), 'status ' + sLeads.status);
  const sNewLead = await api('/api/leads', { method: 'POST', body: JSON.stringify({ first_name: 'Eve', phone: '9999999999', status: 'New' }) }, a.token);
  check('a student token cannot create a lead', refused(sNewLead.status), 'status ' + sNewLead.status);
  const sMeta = await api('/api/meta', {}, a.token);
  check('a student token cannot read the staff list in /meta', refused(sMeta.status), 'status ' + sMeta.status);
  const sCouns = await api('/api/counsellors', {}, a.token);
  check('a student token cannot list counsellors', refused(sCouns.status), 'status ' + sCouns.status);
  const sTasks = await api('/api/tasks', {}, a.token);
  check('a student token cannot list staff tasks', refused(sTasks.status), 'status ' + sTasks.status);

  // ── Staff chat threads (the dump's messages module) ────────────────────────
  const intoThread = await api('/api/messages/send', { method: 'POST', body: JSON.stringify({ conversationId: String(bobThread._id), text: 'injected' }) }, a.token);
  check('POST /messages/send refuses a thread the caller is not in', refused(intoThread.status), 'status ' + intoThread.status);
  const readThread = await api('/api/messages/' + bobThread._id, {}, a.token);
  check('GET /messages/:conversationId refuses a foreign thread', refused(readThread.status), 'status ' + readThread.status);
  const s2s = await api('/api/messages/conversation', { method: 'POST', body: JSON.stringify({ participantId: String(bobLogin._id) }) }, a.token);
  check('a student cannot open a chat with another student', refused(s2s.status), 'status ' + s2s.status);

  // ── Privilege escalation on the members surface ────────────────────────────
  const mintAdmin = await api('/api/users', { method: 'POST', body: JSON.stringify({ name: 'Mallory', username: 'mallory', email: 'm@example.com', password: 'Secret#12345', role: 'admin' }) }, c.token);
  check('a counsellor cannot mint an admin', mintAdmin.status === 403 || mintAdmin.status === 400, 'status ' + mintAdmin.status);
  const squat = await api('/api/users/' + counsellor._id, { method: 'PUT', body: JSON.stringify({ name: 'Cara', username: 'alice.s' }) }, c.token);
  check("staff cannot take a portal account's username", squat.status === 409 || squat.status === 403, 'status ' + squat.status);
  const superMe = await api(`/api/console/users/${counsellor._id}/super`, { method: 'POST', body: JSON.stringify({ on: true }) }, c.token);
  check('a counsellor cannot make anyone Super Admin', refused(superMe.status), 'status ' + superMe.status);

  // ── Public surfaces ────────────────────────────────────────────────────────
  const inv = await json(await api('/api/portal/auth/invite/not-a-token'));
  check('an unknown invite token is not valid', inv && inv.valid === false);
  const ver = await json(await api('/api/legal/verify?id=SD-SMOKE-1'));
  check('the public document check shows initials, not the name', ver && ver.valid === true && !JSON.stringify(ver).includes('Alice'), JSON.stringify(ver || {}).slice(0, 80));
  // ── University partner portal ──────────────────────────────────────────────
  const uStudent = await api('/api/university/me', {}, a.token);
  check('a student token is refused by the university portal', uStudent.status === 403, 'status ' + uStudent.status);
  const uStaff = await api('/api/university/applications', {}, c.token);
  check('a staff token is refused by the university portal', uStaff.status === 403, 'status ' + uStaff.status);
  const uFile = await api(`/api/university/file/s/${bobDoc._id}?u=${bobDoc._id}&exp=${Date.now() + 60000}&d=inline&sig=forged`);
  check('a forged university file link is refused', uFile.status === 403, 'status ' + uFile.status);
  const uQueue = await api('/api/university-updates', {}, a.token);
  check('a student token cannot read the university updates queue', refused(uQueue.status), 'status ' + uQueue.status);
  const uAcc = await api('/api/admin/uni-accounts', {}, c.token);
  check('a counsellor cannot open university accounts', uAcc.status === 403, 'status ' + uAcc.status);
  const dev = await api('/api/dev/users', {}, a.token);
  check('dev console is not mounted without ENABLE_DEV_ROUTES', dev.status === 404, 'status ' + dev.status);

  // ── Signed out by an admin ─────────────────────────────────────────────────
  await PortalAccount.updateOne({ _id: aliceLogin._id }, { sessionsEndedAt: new Date(Date.now() + 5000) });
  require(ROOT + '/src/services/access').invalidateUser(String(aliceLogin._id));
  const ended = await api('/api/auth/me', {}, a.token);
  check('a token issued before "sign out" is refused', ended.status === 401, 'status ' + ended.status);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await mongoose.connection.dropDatabase();
  process.exit(failed.length ? 1 : 0);
}

setTimeout(() => { main().catch((e) => { console.error('SUITE ERROR', e); process.exit(1); }); }, 5000);
