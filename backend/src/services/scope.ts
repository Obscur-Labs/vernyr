import mongoose from 'mongoose';
import type { AuthRequest } from '../middleware/auth';
import { portalScope } from './accounts';

/**
 * Row scoping for the portal seats.
 *
 * A module grant answers *whether*; this answers *whose*. The student preset
 * holds read on documents, applications, visas and finance so the portal has
 * something to show — without this, the id in the query string was the only
 * thing deciding whose passport scan came back.
 */

export const isPortalStudent = (req: AuthRequest) => req.user?.role === 'student';

/** The student record a portal login is bound to; null when it has none. */
export async function ownStudentId(req: AuthRequest): Promise<string | null> {
  const { studentId } = await portalScope(req.user!.id);
  return studentId ?? null;
}

/**
 * Pins a list filter to the caller's own record. False means the caller is
 * scoped to nothing and the route should answer with an empty list.
 */
export async function scopeToOwnStudent(
  req: AuthRequest,
  filter: Record<string, unknown>,
  field = 'studentId',
): Promise<boolean> {
  if (!isPortalStudent(req)) return true;
  const own = await ownStudentId(req);
  if (!own) return false;
  filter[field] = new mongoose.Types.ObjectId(own);
  return true;
}

/** Single-row guard: does this `studentId` belong to the caller? */
export async function ownsStudentRow(req: AuthRequest, studentId: unknown): Promise<boolean> {
  if (!isPortalStudent(req)) return true;
  const own = await ownStudentId(req);
  return !!own && String(studentId) === own;
}
