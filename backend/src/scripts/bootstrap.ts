/**
 * First start on an empty database: creates the first Admin, nothing else.
 *
 *   npm run bootstrap                                  asks for the email (local database)
 *   npm run bootstrap -- --live                        the live database
 *   npm run bootstrap -- --live --email you@x.com --name "Your Name" --password "..."
 *
 * Without --password a random one is generated and printed once: sign in and change it.
 * Safe to re-run: does nothing when an admin already exists.
 */
import crypto from 'crypto';
import readline from 'readline/promises';
import mongoose from 'mongoose';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
}

async function main() {
  if (process.argv.includes('--live')) process.env.MODE = 'live';
  // loaded after MODE is set: env.ts picks LOCAL_ or LIVE_ values when it is first imported
  const { env } = await import('../config/env');
  const { default: User } = await import('../models/User');

  let email = (arg('email') || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) email = (await ask(`First Admin email (${env.mode} database): `)).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`"${email}" is not an email address.`);
  const name = (arg('name') || process.env.ADMIN_NAME || 'Super Admin').trim();
  const given = arg('password') || process.env.ADMIN_PASSWORD;
  const password = given || crypto.randomBytes(9).toString('base64url') + 'A1!';

  await mongoose.connect(env.mongoUri);
  console.log(`Connected (mode: ${env.mode}, database: ${mongoose.connection.db?.databaseName})`);

  const existing = await User.findOne({ role: 'admin' }).lean();
  if (existing) {
    console.log(`An admin already exists (${existing.email}). Nothing to do.`);
    return;
  }
  await User.create({ name, email, password, role: 'admin' });
  console.log(`Created the first Admin: ${email}`);
  if (!given) console.log(`Password (shown once, change it after signing in): ${password}`);
}

main()
  .catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
