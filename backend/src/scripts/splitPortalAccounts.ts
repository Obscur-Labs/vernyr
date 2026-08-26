import mongoose from 'mongoose';
import { env } from '../config/env';
import User from '../models/User';
import PortalAccount from '../models/PortalAccount';

/**
 * Moves `student` and `university` accounts out of `users` and into
 * `portalaccounts`, keeping each `_id`. Ids are what every existing
 * conversation, message, notification and document points at, so preserving
 * them means nothing else has to be rewritten.
 *
 *   npm run migrate:split-accounts              dry run — reports, changes nothing
 *   npm run migrate:split-accounts -- --apply   performs the move
 *   npm run migrate:split-accounts -- --rollback  moves them back
 *
 * Safe to re-run: accounts already in the target collection are skipped.
 */

const PORTAL_ROLES = ['student', 'university'];

async function main() {
  const apply = process.argv.includes('--apply');
  const rollback = process.argv.includes('--rollback');

  await mongoose.connect(env.mongoUri);
  const db = mongoose.connection.db!;

  if (rollback) return back(db, apply);

  const pending = await db.collection('users').find({ role: { $in: PORTAL_ROLES } }).toArray();
  const existing = new Set(
    (await PortalAccount.find({ _id: { $in: pending.map((p) => p._id) } }).select('_id').lean())
      .map((d) => String(d._id)),
  );
  const todo = pending.filter((p) => !existing.has(String(p._id)));

  console.log(`\n  users with a portal role : ${pending.length}`);
  console.log(`  already moved            : ${pending.length - todo.length}`);
  console.log(`  to move                  : ${todo.length}\n`);

  for (const doc of todo) {
    const scope = doc.role === 'student' ? `student ${doc.studentId ?? '(unlinked)'}` : doc.universityName ?? '(no institution)';
    console.log(`    ${String(doc.role).padEnd(11)} ${String(doc.username ?? doc.email).padEnd(24)} ${scope}`);
  }

  const unlinked = todo.filter((d) => d.role === 'student' && !d.studentId);
  const nameless = todo.filter((d) => d.role === 'university' && !d.universityName);
  if (unlinked.length || nameless.length) {
    console.log('\n  ⚠  These would fail validation in the new collection:');
    unlinked.forEach((d) => console.log(`     ${d.username}: student login with no studentId`));
    nameless.forEach((d) => console.log(`     ${d.username}: university login with no universityName`));
    console.log('     Fix them in /dev or the CRM first, or they will be skipped.\n');
  }

  if (!apply) {
    console.log('  Dry run. Re-run with --apply to perform the move.\n');
    return;
  }

  let moved = 0;
  for (const doc of todo) {
    if (doc.role === 'student' && !doc.studentId) continue;
    if (doc.role === 'university' && !doc.universityName) continue;

    // Insert through the driver, not the model: the password is already
    // hashed and the save hook would hash it a second time.
    await db.collection('portalaccounts').insertOne({
      ...doc,
      presetKey: doc.presetKey ?? doc.role,
      updatedAt: new Date(),
    });
    await db.collection('users').deleteOne({ _id: doc._id });
    moved++;
  }
  console.log(`\n  Moved ${moved}. Ids preserved — existing references still resolve.\n`);
}

async function back(db: mongoose.mongo.Db, apply: boolean) {
  const rows = await db.collection('portalaccounts').find({}).toArray();
  console.log(`\n  portal accounts to move back: ${rows.length}\n`);
  if (!apply) {
    console.log('  Dry run. Re-run with --apply --rollback to perform it.\n');
    return;
  }
  for (const doc of rows) {
    await db.collection('users').insertOne(doc);
    await db.collection('portalaccounts').deleteOne({ _id: doc._id });
  }
  console.log(`  Moved ${rows.length} back into users.\n`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
