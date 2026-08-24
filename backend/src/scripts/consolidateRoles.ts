/**
 * Rewrites accounts still holding a retired role.
 *
 * The role set is now admin · counsellor · student · university. Anything else
 * fails schema validation on its next save and matches none of the guards, so
 * it has to be mapped forward.
 *
 * Idempotent — safe to re-run.
 *
 * Run: npm run migrate:roles
 */

import mongoose from 'mongoose';
import { env } from '../config/env';
import User from '../models/User';

/**
 * Everything that did case work becomes a counsellor. Only the two roles that
 * genuinely carried admin authority are promoted — mapping the finance side up
 * to admin instead would hand out user administration nobody asked for.
 */
const RETIRED: Record<string, 'admin' | 'counsellor'> = {
  super_admin:        'admin',
  counsellor_manager: 'admin',
  finance:            'counsellor',
  accountant:         'counsellor',
  visa_team:          'counsellor',
  doc_verification:   'counsellor',
  university_team:    'counsellor',
  support:            'counsellor',
};

async function main() {
  await mongoose.connect(env.mongoUri);
  console.log('Connected');

  // Read through the driver: Mongoose will not return a role the enum has
  // already dropped.
  const stale = await User.collection.find({ role: { $in: Object.keys(RETIRED) } }).toArray();

  if (stale.length === 0) {
    console.log('No retired roles in use — nothing to do.');
  } else {
    const demoted: string[] = [];
    for (const [from, to] of Object.entries(RETIRED)) {
      const hits = stale.filter((u) => u.role === from);
      if (hits.length === 0) continue;
      for (const u of hits) {
        console.log(`  ${String(u.username ?? u.email).padEnd(28)} ${from} → ${to}`);
        if (from === 'finance' || from === 'accountant') demoted.push(String(u.username ?? u.email));
      }
      await User.collection.updateMany({ role: from }, { $set: { role: to } });
    }
    console.log(`\n${stale.length} account${stale.length === 1 ? '' : 's'} rewritten`);

    if (demoted.length) {
      console.log('\n  ! Finance now lives under admin. These accounts became counsellors and');
      console.log('    lost the Finance tab — promote them by hand if they still need it:');
      demoted.forEach((d) => console.log(`      ${d}`));
    }
  }

  const counts = await User.aggregate([{ $group: { _id: '$role', n: { $sum: 1 } } }]);
  console.log('\nRoles now in use:');
  counts.sort((a, b) => String(a._id).localeCompare(String(b._id)))
    .forEach((c) => console.log(`  ${String(c._id).padEnd(12)} ${c.n}`));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
