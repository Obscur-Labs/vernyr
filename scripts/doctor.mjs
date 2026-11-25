// npm run doctor            checks every env file, locally, no network
// npm run doctor -- --connect  also connects to both databases and Cloudinary
//
// Run it before every deploy. A red line is something that would break or leak in production.
import { readEnv, SERVICES, dbName, hostOf, ROOT } from './envfiles.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';

const problems = [];
const warnings = [];
const ok = [];
const bad = (m) => problems.push(m);
const warn = (m) => warnings.push(m);
const good = (m) => ok.push(m);

// ---- Node
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) bad(`Node ${process.versions.node}: needs 20 or newer (Render uses .node-version).`);
else good(`Node ${process.versions.node}`);

// ---- Files and required keys
const be = readEnv('backend/.env');
const crm = readEnv('crm/.env');
const st = readEnv('portal/.env');
const pt = readEnv('partner/.env');
for (const [file, env] of [['backend/.env', be], ['crm/.env', crm], ['portal/.env', st], ['partner/.env', pt]]) {
  if (!env) bad(`${file} is missing. Copy ${file}.example and fill it in.`);
}
for (const svc of Object.values(SERVICES)) {
  if (!svc.file) continue;
  const env = readEnv(svc.file);
  if (!env) continue;
  const missing = svc.keys.filter((k) => !env[k]);
  if (missing.length) bad(`${svc.file}: empty ${missing.join(', ')} (needed by ${svc.title}).`);
}
if (be) {
  for (const k of ['LOCAL_MONGODB_URI', 'LOCAL_CLIENT_CRM_URL', 'LOCAL_CLIENT_STUDENT_URL', 'LOCAL_CLIENT_PARTNER_URL']) if (!be[k]) bad(`backend/.env: ${k} is empty (local development).`);

  // ---- Databases: local and live must never be the same one
  const ldb = dbName(be.LOCAL_MONGODB_URI), vdb = dbName(be.LIVE_MONGODB_URI);
  if (be.LIVE_MONGODB_URI) {
    if (!vdb || vdb === 'test') bad('LIVE_MONGODB_URI names no database (MongoDB then uses "test"). Add /vernyr before the "?".');
    else good(`Live database: ${hostOf(be.LIVE_MONGODB_URI)}/${vdb}`);
  }
  if (be.LOCAL_MONGODB_URI) {
    if (!ldb || ldb === 'test') bad('LOCAL_MONGODB_URI names no database. Add /vernyr before the "?".');
    else good(`Local database: ${hostOf(be.LOCAL_MONGODB_URI)}/${ldb}`);
  }
  if (be.LIVE_MONGODB_URI && be.LOCAL_MONGODB_URI && hostOf(be.LIVE_MONGODB_URI) === hostOf(be.LOCAL_MONGODB_URI) && ldb === vdb)
    warn('Local and live use the same database (vernyr): local testing changes live data, and `npm run seed` is blocked.');

  // ---- Secrets
  const jwt = be.JWT_SECRET || '';
  if (jwt.length < 32 || /your_|secret|changeme/i.test(jwt)) bad('JWT_SECRET is short or a placeholder. Use 48+ random bytes (npm run doctor prints one below).');
  else good('JWT_SECRET looks strong');
  if (be.ENABLE_DEV_ROUTES === 'true') warn('ENABLE_DEV_ROUTES=true in backend/.env: fine locally, it is never copied to Render by deploy:env.');

  // ---- Email: login codes, password resets and student sign-up need real sending on live
  if (be.MAIL_PROVIDER !== 'smtp') warn('MAIL_PROVIDER is not smtp: no email leaves the server (codes only appear in the logs). Students cannot verify a sign-up on live until SMTP_* is set.');
  else if (!be.SMTP_HOST || !be.SMTP_USER || !be.SMTP_PASS || !be.MAIL_FROM) bad('MAIL_PROVIDER=smtp but SMTP_HOST, SMTP_USER, SMTP_PASS or MAIL_FROM is empty.');
  else good(`Email: SMTP via ${be.SMTP_HOST}`);

  // ---- URLs
  for (const k of ['LIVE_CLIENT_CRM_URL', 'LIVE_CLIENT_STUDENT_URL', 'LIVE_CLIENT_PARTNER_URL']) if (be[k] && !/^https:\/\//.test(be[k])) bad(`${k} must start with https://`);
}
// ---- The frontends and the backend must agree on the live addresses
const strip = (u) => (u || '').replace(/\/+$/, '');
if (crm && st && crm.NEXT_PUBLIC_LIVE_API_ORIGIN && st.NEXT_PUBLIC_LIVE_API_ORIGIN && strip(crm.NEXT_PUBLIC_LIVE_API_ORIGIN) !== strip(st.NEXT_PUBLIC_LIVE_API_ORIGIN))
  bad('crm/.env and portal/.env have different NEXT_PUBLIC_LIVE_API_ORIGIN.');
if (crm && be && crm.NEXT_PUBLIC_LIVE_STUDENT_URL && be.LIVE_CLIENT_STUDENT_URL && strip(crm.NEXT_PUBLIC_LIVE_STUDENT_URL) !== strip(be.LIVE_CLIENT_STUDENT_URL))
  bad('crm NEXT_PUBLIC_LIVE_STUDENT_URL differs from backend LIVE_CLIENT_STUDENT_URL (CORS would block the portal).');
for (const [f, e] of [['crm/.env', crm], ['portal/.env', st], ['partner/.env', pt]]) {
  if (e && e.NEXT_PUBLIC_LIVE_API_ORIGIN && !/^https:\/\//.test(e.NEXT_PUBLIC_LIVE_API_ORIGIN)) bad(`${f}: NEXT_PUBLIC_LIVE_API_ORIGIN must start with https://`);
  if (e && e.NEXT_PUBLIC_MODE === 'live') warn(`${f}: NEXT_PUBLIC_MODE=live locally, so local dev talks to the LIVE API.`);
}

// ---- Optional network checks
if (process.argv.includes('--connect') && be) {
  const require = createRequire(path.join(ROOT, 'backend', 'package.json'));
  const mongoose = require('mongoose');
  for (const k of ['LOCAL_MONGODB_URI', 'LIVE_MONGODB_URI']) {
    if (!be[k]) continue;
    try {
      const c = await mongoose.createConnection(be[k], { serverSelectionTimeoutMS: 15000 }).asPromise();
      await c.db.admin().ping();
      const n = (await c.db.listCollections().toArray()).length;
      good(`${k}: connected to ${c.db.databaseName} (${n} collections)`);
      await c.close();
    } catch (e) { bad(`${k}: cannot connect (${e.message.split('\n')[0]}). Check Atlas Network Access allows 0.0.0.0/0 for Render.`); }
  }
  try {
    const cloudinary = require('cloudinary').v2;
    cloudinary.config({ cloud_name: be.CLOUDINARY_CLOUD_NAME, api_key: be.CLOUDINARY_API_KEY, api_secret: be.CLOUDINARY_API_SECRET });
    await cloudinary.api.ping();
    good('Cloudinary: credentials accepted');
  } catch (e) { bad(`Cloudinary: ${e.message || e.error?.message || 'ping failed'}`); }
}

// ---- Report
const c = { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', x: '\x1b[0m' };
for (const m of ok) console.log(`${c.g}  ok${c.x}    ${m}`);
for (const m of warnings) console.log(`${c.y}  note${c.x}  ${m}`);
for (const m of problems) console.log(`${c.r}  FIX${c.x}   ${m}`);
if (problems.some((p) => p.startsWith('JWT_SECRET'))) {
  const crypto = await import('node:crypto');
  console.log(`\n  A fresh JWT_SECRET you can use: ${crypto.randomBytes(48).toString('hex')}`);
}
console.log(problems.length ? `\n${problems.length} thing(s) to fix before deploying.` : '\nAll good. Next: npm run deploy:env');
process.exitCode = problems.length ? 1 : 0;
