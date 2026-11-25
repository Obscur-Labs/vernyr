import Notification from '../models/Notification';
import { getIo } from '../socket/emitter';

/**
 * Create DB notifications and push them in real-time via socket to each user's
 * personal room `user:<userId>`.  Fire-and-forget — errors are swallowed so
 * a notification failure never breaks the main request.
 */
export async function notify(
  userIds: string[],
  payload: { type: string; title: string; body: string; link?: string },
): Promise<void> {
  const io     = getIo();
  const unique = [...new Set(userIds.filter(Boolean))];
  for (const userId of unique) {
    try {
      const n = await Notification.create({ userId, ...payload });
      if (io) io.to(`user:${userId}`).emit('notification', n.toObject());
    } catch {
      /* best-effort — don't let notification errors surface */
    }
  }
}
