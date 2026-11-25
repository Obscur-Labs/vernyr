import { Request } from 'express';
import mongoose from 'mongoose';
import ActivityLog, { ActivityAction, ActivitySource } from '../models/ActivityLog';
import { AuthRequest } from '../middleware/auth';

type Entry = {
  action: ActivityAction;
  entity: string;
  label: string;
  entityId?: mongoose.Types.ObjectId | string | null;
  changes?: string[];
  actorName?: string;
  actorRole?: string;
  /** Set explicitly on sign-in, where `req.user` is not populated yet. */
  actorId?: string | null;
};

/** Trims proxy prefixes so loopback reads as `127.0.0.1`, not `::ffff:127.0.0.1`. */
const clientIp = (req: Request) => (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');

/**
 * Fire-and-forget: an audit entry must never fail the request that produced it,
 * so this returns void and swallows its own errors.
 */
function write(req: Request, source: ActivitySource, entry: Entry, actorId: string | null) {
  ActivityLog.create({
    actorId,
    actorName: entry.actorName ?? 'Unknown',
    actorRole: entry.actorRole,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? undefined,
    label: entry.label,
    changes: entry.changes?.length ? entry.changes : undefined,
    source,
    ip: clientIp(req),
  }).catch((err) => console.error('activity log failed:', err?.message ?? err));
}

/** Records an action taken by a signed-in user. */
export function logActivity(req: AuthRequest, entry: Entry): void {
  write(req, 'app', {
    ...entry,
    actorName: entry.actorName ?? req.user?.name ?? 'Unknown',
    actorRole: entry.actorRole ?? req.user?.role,
  }, entry.actorId ?? req.user?.id ?? null);
}

/** Records an action taken through the unauthenticated /dev console. */
export function logDevActivity(req: Request, entry: Entry): void {
  write(req, 'dev', { ...entry, actorName: entry.actorName ?? 'Dev console' }, entry.actorId ?? null);
}

/** Field-level diff for update entries — reports what actually changed. */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, fields: string[]): string[] {
  return fields.filter((f) => {
    const a = before[f];
    const b = after[f];
    if (a === undefined && b === undefined) return false;
    return String(a ?? '') !== String(b ?? '');
  });
}
