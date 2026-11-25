/**
 * Security regression suite.
 *
 * Every check here stands for a hole that was open in this codebase: a student
 * reading another student's documents, posting into someone else's chat
 * thread, `/auth/me` handing back its own bcrypt hash. They fail loudly if any
 * of those come back.
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
const Student = require(ROOT + '/src/models/Student').default;
const PortalAccount = require(ROOT + '/src/models/PortalAccount').default;
const User = require(ROOT + '/src/models/User').default;
const DocumentModel = require(ROOT + '/src/models/Document').default;
const Payment = require(ROOT + '/src/models/Payment').default;
const Visa = require(ROOT + '/src/models/Visa').default;
const Application = require(ROOT + '/src/models/Application').default;
const Conversation = require(ROOT + '/src/models/Conversation').default;

const BASE = 'http://127.0.0.1:5099';
const api = (path, opts = {}, token) => fetch(BASE + path, {
  ...opts,
  headers: {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: 'Bearer ' + token } : {}),
    ...(opts.headers || {}),
  },
});

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function login(identifier, password) {
  const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password }) });
  const j = await r.json();
  return { status: r.status, token: j.token, body: j };
}

async function main() {
  // ── Seed two unrelated students plus a counsellor ──────────────────────────
  // This suite deletes collections. Never let it point anywhere but its own
  // scratch database.
  if (mongoose.connection.name !== SCRATCH_DB) {
    console.error(`Refusing to run against "${mongoose.connection.name}" - expected "${SCRATCH_DB}"`);
    process.exit(1);
  }
  for (const M of [Student, PortalAccount, User, DocumentModel, Payment, Visa, Application, Conversation]) {
    await M.deleteMany({});
  }

  const [alice, bob] = await Student.create([
    { personal: { name: 'Alice', email: 'alice@example.com', phone: '1' }, stage: 'inquiry' },
    { personal: { name: 'Bob', email: 'bob@example.com', phone: '2' }, stage: 'inquiry' },
  ]);
  const counsellor = await User.create({
    name: 'Cara', username: 'cara.c', password: 'secret123', role: 'counsellor',
  });
  const aliceLogin = await PortalAccount.create({
    name: 'Alice', username: 'alice.s', password: 'secret123',
    role: 'student', studentId: alice._id, presetKey: 'student',
  });
  const bobLogin = await PortalAccount.create({
    name: 'Bob', username: 'bob.s', password: 'secret123',
    role: 'student', studentId: bob._id, presetKey: 'student',
  });
  await Student.updateOne({ _id: alice._id }, { userId: aliceLogin._id });
  await Student.updateOne({ _id: bob._id }, { userId: bobLogin._id });

  // Bob's private records — nothing here should ever reach Alice.
  const bobDoc = await DocumentModel.create({
    studentId: bob._id, type: 'passport', label: 'Bob passport', status: 'uploaded',
    currentVersion: { fileUrl: 'https://example.com/bob-passport.pdf', fileName: 'p.pdf', uploadedAt: new Date(), uploadedBy: bobLogin._id },
    versions: [{ fileUrl: 'https://example.com/bob-passport.pdf', fileName: 'p.pdf', uploadedAt: new Date(), uploadedBy: bobLogin._id }],
  });
  const bobPay = await Payment.create({ studentId: bob._id, amount: 5000, type: 'university_fee',
    description: 'Bob tuition', status: 'pending', createdBy: counsellor._id });
  const bobVisa = await Visa.create({ studentId: bob._id, country: 'UK', stage: 'visa_filed' });
  const bobApp = await Application.create({ studentId: bob._id, university: 'Oxford', course: 'CS',
    country: 'UK', intake: 'Fall 2026', status: 'submitted' });
  const bobThread = await Conversation.create({ participants: [bobLogin._id, counsellor._id], studentId: bob._id });

  const a = await login('alice.s', 'secret123');
  check('student can sign in', a.status === 200 && !!a.token);
  check('login response carries no password hash', !('password' in (a.body.user || {})));

  const me = await api('/api/auth/me', {}, a.token);
  const meBody = await me.json();
  check('GET /auth/me does not leak the bcrypt hash', !('password' in meBody),
    'password' in meBody ? 'HASH PRESENT: ' + String(meBody.password).slice(0, 20) : '');

  // ── Cross-student reads ────────────────────────────────────────────────────
  const docs = await (await api('/api/documents', {}, a.token)).json();
  check("documents list excludes another student's documents",
    Array.isArray(docs) && !docs.some(d => String(d._id) === String(bobDoc._id)),
    `returned ${Array.isArray(docs) ? docs.length : '?'} rows`);

  const oneDoc = await api('/api/documents/' + bobDoc._id, {}, a.token);
  check("GET /documents/:id refuses another student's document", oneDoc.status === 403, 'status ' + oneDoc.status);

  const pays = await (await api('/api/payments', {}, a.token)).json();
  check("finance list excludes another student's payments",
    Array.isArray(pays) && !pays.some(p => String(p._id) === String(bobPay._id)));
  const onePay = await api('/api/payments/' + bobPay._id, {}, a.token);
  check("GET /payments/:id refuses another student's payment", onePay.status === 403, 'status ' + onePay.status);

  const visas = await (await api('/api/visas', {}, a.token)).json();
  check("visa list excludes another student's record",
    Array.isArray(visas) && !visas.some(v => String(v._id) === String(bobVisa._id)));
  const oneVisa = await api('/api/visas/' + bobVisa._id, {}, a.token);
  check("GET /visas/:id refuses another student's record", oneVisa.status === 403, 'status ' + oneVisa.status);

  const apps = await (await api('/api/applications', {}, a.token)).json();
  check("applications list excludes another student's applications",
    Array.isArray(apps) && !apps.some(x => String(x._id) === String(bobApp._id)));
  const oneApp = await api('/api/applications/' + bobApp._id, {}, a.token);
  check("GET /applications/:id refuses another student's application", oneApp.status === 403, 'status ' + oneApp.status);

  const otherStudent = await api('/api/students/' + bob._id, {}, a.token);
  check("GET /students/:id refuses another student's record", otherStudent.status === 403, 'status ' + otherStudent.status);

  // ── Cross-student writes ───────────────────────────────────────────────────
  const intoThread = await api('/api/messages/send', {
    method: 'POST',
    body: JSON.stringify({ conversationId: String(bobThread._id), text: 'injected' }),
  }, a.token);
  check("POST /messages/send refuses a thread the caller is not in", intoThread.status === 403, 'status ' + intoThread.status);

  const genericSend = await api('/api/messages/' + bobThread._id, {
    method: 'POST', body: JSON.stringify({ text: 'injected' }),
  }, a.token);
  check("POST /messages/:conversationId refuses a foreign thread", genericSend.status === 403, 'status ' + genericSend.status);

  const readThread = await api('/api/messages/' + bobThread._id, {}, a.token);
  check("GET /messages/:conversationId refuses a foreign thread", readThread.status === 403, 'status ' + readThread.status);

  const studentToStudent = await api('/api/messages/conversation', {
    method: 'POST', body: JSON.stringify({ participantId: String(bobLogin._id) }),
  }, a.token);
  check('a student cannot open a chat with another student', studentToStudent.status === 403, 'status ' + studentToStudent.status);

  const escalate = await api('/api/students/' + alice._id, {
    method: 'PATCH', body: JSON.stringify({ stage: 'visa_approved', counsellors: [String(counsellor._id)] }),
  }, a.token);
  const after = await Student.findById(alice._id).lean();
  check('a student cannot move their own pipeline stage',
    escalate.status === 200 && after.stage === 'inquiry', 'stage is ' + after.stage);

  const rebind = await api('/api/students/' + alice._id, {
    method: 'PATCH', body: JSON.stringify({ personal: { name: 'Alice' }, userId: String(bobLogin._id) }),
  }, a.token);
  const rebound = await Student.findById(alice._id).lean();
  check('a student cannot repoint userId at another login',
    String(rebound.userId) === String(aliceLogin._id), 'userId is ' + rebound.userId);

  // ── Privilege escalation on the members surface ────────────────────────────
  const c = await login('cara.c', 'secret123');
  check('counsellor can sign in', c.status === 200 && !!c.token);

  const mintAdmin = await api('/api/users', {
    method: 'POST',
    body: JSON.stringify({ name: 'Mallory', email: 'm@example.com', password: 'secret123', role: 'admin' }),
  }, c.token);
  check('counsellor with members.create cannot mint an admin',
    mintAdmin.status === 403 || mintAdmin.status === 400, 'status ' + mintAdmin.status);

  const squat = await api('/api/users/' + counsellor._id, {
    method: 'PUT', body: JSON.stringify({ name: 'Cara', username: 'alice.s' }),
  }, c.token);
  check("staff cannot take a portal account's username", squat.status === 409, 'status ' + squat.status);

  // ── NoSQL operator injection through the query string ──────────────────────
  const injected = await api('/api/documents?studentId[$ne]=000000000000000000000000', {}, a.token);
  const injectedRows = await injected.json();
  check('query-string operator injection does not widen a list',
    Array.isArray(injectedRows) && !injectedRows.some(d => String(d._id) === String(bobDoc._id)),
    `returned ${Array.isArray(injectedRows) ? injectedRows.length : '?'} rows`);

  // ── Dev console stays off without the env flag ─────────────────────────────
  const dev = await api('/api/dev/users', {}, a.token);
  check('dev console is not mounted without ENABLE_DEV_ROUTES', dev.status === 404, 'status ' + dev.status);

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await mongoose.connection.dropDatabase();
  process.exit(failed.length ? 1 : 0);
}

setTimeout(() => { main().catch(e => { console.error('SUITE ERROR', e); process.exit(1); }); }, 5000);
