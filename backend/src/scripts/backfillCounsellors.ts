/**
 * Copies the old single `assignedCounsellor` into the `counsellors` roster.
 * The old field is left in place, so the migration is undoable by ignoring
 * the new one.
 *
 * Run: npm run migrate:counsellors            (dry run)
 *      npm run migrate:counsellors -- --apply
 */

import mongoose from 'mongoose';
import { env } from '../config/env';
import Student from '../models/Student';

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(env.mongoUri);
  console.log(`Connected — ${apply ? 'APPLYING' : 'dry run'}`);

  const docs = await Student.collection
    .find({ counsellors: { $in: [null, []] } })
    .project({ personal: 1, assignedCounsellor: 1 })
    .toArray();

  let filled = 0;
  for (const doc of docs) {
    const legacy = doc.assignedCounsellor as mongoose.Types.ObjectId | null | undefined;
    const name = (doc.personal as { name?: string } | undefined)?.name ?? '(unnamed)';
    if (!legacy) { console.log(`  – ${name}: no counsellor to copy`); continue; }
    console.log(`  → ${name}: counsellors = [${legacy}]`);
    if (apply) {
      await Student.collection.updateOne({ _id: doc._id }, { $set: { counsellors: [legacy] } });
    }
    filled++;
  }

  await Student.createIndexes(); // never syncIndexes here — it drops what the schema does not declare
  console.log(`\n${filled} of ${docs.length} record(s) ${apply ? 'updated' : 'would be updated'}`);
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
