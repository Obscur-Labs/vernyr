/**
 * Unsets `username`/`email` fields that hold an empty string.
 *
 * `sparse` skips missing and null values but not `''`, so one account saved
 * with a blank credential occupies the unique index and blocks every later
 * account that leaves the same field empty. The model now normalises blanks to
 * undefined on write; this repairs rows written before that.
 *
 * Run: npm run migrate:blank-credentials
 */

import mongoose from 'mongoose';
import { env } from '../config/env';
import User from '../models/User';

async function main() {
  await mongoose.connect(env.mongoUri);
  console.log('Connected to', mongoose.connection.name);

  for (const field of ['username', 'email'] as const) {
    const stale = await User.collection.find({ [field]: '' }).toArray();
    if (stale.length === 0) {
      console.log(`  ${field}: nothing to clear`);
      continue;
    }
    for (const u of stale) console.log(`  ${field}: clearing on ${u.name}`);
    const { modifiedCount } = await User.collection.updateMany({ [field]: '' }, { $unset: { [field]: '' } });
    console.log(`  ${field}: ${modifiedCount} cleared`);
  }

  await User.syncIndexes();
  console.log('Indexes synced');
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
