/**
 * Gives every pre-username account a username and swaps the old non-sparse
 * unique index on `email` for the sparse pair the model now declares.
 *
 * Run: npm run migrate:usernames
 */

import mongoose from 'mongoose';
import { env } from '../config/env';
import User, { USERNAME_RE, usesEmailLogin } from '../models/User';

/** `Sarah Thompson` → `sarah.thompson`; falls back to the email local part. */
function seedFrom(user: { email?: string; name: string }) {
  const base = (user.name || user.email?.split('@')[0] || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^[^a-z0-9]+|[.\-_]+$/g, '')
    .slice(0, 32);
  return base.length >= 3 ? base : `user.${base}`.slice(0, 32);
}

async function main() {
  await mongoose.connect(env.mongoUri);
  console.log('Connected');

  // The model now declares email as sparse-unique; the old index was not.
  await User.collection.dropIndexes().catch(() => {});
  await User.syncIndexes();
  console.log('Indexes synced');

  const taken = new Set(
    (await User.find({ username: { $ne: null } }).select('username').lean())
      .map((u) => u.username as string)
  );

  const pending = await User.find({ $or: [{ username: null }, { username: { $exists: false } }] })
    .select('name email role')
    .lean();

  let filled = 0;
  for (const user of pending) {
    let candidate = seedFrom(user as { email?: string; name: string });
    for (let n = 2; taken.has(candidate); n++) candidate = `${seedFrom(user as { email?: string; name: string }).slice(0, 29)}${n}`;
    taken.add(candidate);
    await User.updateOne({ _id: user._id }, { $set: { username: candidate } });
    filled++;
    console.log(`  ${user.email ?? '(no email)'} → ${candidate}${usesEmailLogin(user.role) ? '  [admin — still signs in by email]' : ''}`);
    if (!USERNAME_RE.test(candidate)) console.warn(`  ! ${candidate} does not match the username pattern`);
  }

  console.log(`\n${filled} username${filled === 1 ? '' : 's'} assigned, ${taken.size - filled} already set`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
