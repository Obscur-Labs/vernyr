import type { Types } from 'mongoose';
import User, { type IUser } from '../models/User';
import Student from '../models/Student';
import Lead from '../models/Lead';
import { AssignmentRule, AssignmentHistory, UnassignedQueue, Team, Branch } from '../models/Console';
import { istDate } from './crm';
import { notify, notifyAdmins } from './tasks';

/** The assignment rule engine (legacy/server/admin5/assign.js): the first matching active rule by priority wins; inactive, on-leave and
 *  at-capacity users are skipped; no match puts the record in the Unassigned queue. Every assignment is recorded. */

export const APPLIES: Record<string, string> = { lead: 'New lead (any source)', portal: 'Portal sign-up', university: 'University enquiry' };
type U = Pick<IUser, '_id' | 'name' | 'isActive' | 'leave' | 'capacity'>;
export const onLeave = (u: Pick<IUser, 'leave'>) => (u.leave ?? []).some((x) => x?.from && x?.to && x.from <= istDate() && istDate() <= x.to);
export async function activeCount(userId: unknown) {
  return (await Student.countDocuments({ is_deleted: false, primary_counsellor_id: userId, status: { $nin: ['Archived', 'Dropped', 'Enrolled'] } }))
    + (await Lead.countDocuments({ is_deleted: false, assigned_user_id: userId, status: { $nin: ['Converted', 'Not interested'] } }));
}
/** Why a user cannot take new work (null = available). */
export async function unavailable(u: U | null) {
  if (!u || !u.isActive) return 'inactive';
  if (onLeave(u)) return 'on leave';
  if ((u.capacity ?? 0) > 0 && (await activeCount(u._id)) >= u.capacity!) return 'at capacity';
  return null;
}
export const teamMembers = async (teamId: unknown) => {
  const t = await Team.findById(teamId).select('members').lean();
  return User.find({ _id: { $in: t?.members ?? [] } }).sort({ createdAt: 1 }).lean();
};
export type Ctx = { countries?: string[]; source_id?: string; level?: string; branch_id?: string; city?: string; state?: string; languages?: string[] };
function matches(c: Record<string, string[] | undefined>, ctx: Ctx) {
  const any = (list: string[] | undefined, vals: (string | undefined)[]) => !list?.length || vals.some((v) => v && list.includes(v));
  const lower = (list: string[] | undefined, v?: string) => !list?.length || list.map((x) => x.toLowerCase()).includes(String(v ?? '').toLowerCase());
  return any(c.sources, [ctx.source_id]) && any(c.countries, ctx.countries ?? []) && any(c.levels, [ctx.level]) && any(c.branches, [ctx.branch_id])
    && lower(c.cities, ctx.city) && lower(c.states, ctx.state) && any(c.languages, ctx.languages ?? []);
}
/** dry = the "Test rule" button: the round-robin pointer does not move. */
export async function pick(appliesTo: string, ctx: Ctx = {}, dry = false) {
  const trace: string[] = [];
  const rules = await AssignmentRule.find({ status: 'Active', is_deleted: false }).sort({ priority: 1, createdAt: 1 });
  for (const r of rules) {
    if (r.applies_to.length && !r.applies_to.includes(appliesTo)) { trace.push(`${r.name}: does not apply to ${APPLIES[appliesTo]}`); continue; }
    if (!matches(r.conditions as Record<string, string[]>, ctx)) { trace.push(`${r.name}: conditions do not match`); continue; }
    let user: U | null = null;
    if (r.assign_to_type === 'user') {
      const u = await User.findById(r.assign_to_id).lean();
      const why = await unavailable(u);
      if (why) { trace.push(`${r.name}: ${u?.name ?? 'user'} is ${why}`); continue; }
      user = u;
    } else if (r.assign_to_type === 'team_rr' || r.assign_to_type === 'team_least') {
      const avail = [];
      for (const u of await teamMembers(r.assign_to_id)) if (!(await unavailable(u))) avail.push(u);
      if (!avail.length) { trace.push(`${r.name}: nobody in the team is available`); continue; }
      if (r.assign_to_type === 'team_least') {
        const loads = await Promise.all(avail.map(async (u) => ({ u, n: await activeCount(u._id) })));
        user = loads.sort((a, b) => a.n - b.n)[0].u;
      } else {
        const i = avail.findIndex((u) => String(u._id) === String(r.rr_pointer));
        user = avail[(i + 1) % avail.length];
        if (!dry) { r.rr_pointer = user._id as Types.ObjectId; await r.save(); }
      }
    } else if (r.assign_to_type === 'branch_queue') {
      trace.push(`${r.name}: matched; goes to the branch queue`);
      return { user_id: null, rule_id: String(r._id), queue_branch: r.assign_to_id ? String(r.assign_to_id) : null, trace, rule_name: r.name };
    }
    if (!user) continue;
    trace.push(`${r.name}: matched; assigned to ${user.name}`);
    return { user_id: String(user._id), user_name: user.name, rule_id: String(r._id), rule_name: r.name, trace };
  }
  trace.push(rules.length ? 'No rule matched' : 'No assignment rules yet');
  return { user_id: null as string | null, trace };
}
export const record = (record_type: string, record_id: unknown, from_user: unknown, to_user: unknown, by_user: unknown, by_rule_id: unknown, reason?: string) =>
  AssignmentHistory.create({ record_type, record_id, from_user: from_user ?? undefined, to_user: to_user ?? undefined, by_user: by_user ?? undefined, by_rule_id: by_rule_id ?? undefined, reason });
/** No owner found: the record waits in the Unassigned queue and the Admins (and the branch manager) are told. */
export async function queue(record_type: string, record_id: unknown, applies_to: string, branch_id?: string | null, reason?: string) {
  if (await UnassignedQueue.exists({ record_type, record_id, status: 'Open' })) return;
  await UnassignedQueue.create({ record_type, record_id, applies_to, branch_id: branch_id ?? undefined, reason: reason || 'No assignment rule matched', status: 'Open' });
  const title = `New ${record_type} waiting for an owner (${APPLIES[applies_to] ?? applies_to})`;
  await notifyAdmins('assigned', title, '/console/assignment');
  const manager = branch_id ? (await Branch.findById(branch_id).select('manager_id').lean())?.manager_id : null;
  if (manager) await notify(manager, 'assigned', title, '/console/assignment');
}
