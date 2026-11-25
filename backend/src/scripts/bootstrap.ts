/**
 * First start on an empty database: creates the first Admin, nothing else.
 *
 *   npm run bootstrap                       (uses MODE from backend/.env)
 *   MODE=live npm run bootstrap             (the live database)
 *
 * Reads ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD. When ADMIN_PASSWORD is not
 * set a random one is generated and printed once: sign in and change it.
 * Safe to re-run: does nothing when an admin already exists.
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import { env } from '../config/env';
import User from '../models/User';

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) throw new Error('Set ADMIN_EMAIL (the first Admin signs in with this email).');
  const name = (process.env.ADMIN_NAME || 'Super Admin').trim();
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url') + 'A1!';

  await mongoose.connect(env.mongoUri);
  const db = mongoose.connection.db?.databaseName;
  console.log(`Connected (mode: ${env.mode}, database: ${db})`);

  const existing = await User.findOne({ role: 'admin' }).lean();
  if (existing) {
    console.log(`An admin already exists (${existing.email}). Nothing to do.`);
    return;
  }
  await User.create({ name, email, password, role: 'admin' });
  console.log(`Created the first Admin: ${email}`);
  if (generated) console.log(`Password (shown once, change it after signing in): ${password}`);
}

main()
  .catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
