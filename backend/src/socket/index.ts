import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { setIo, getIo } from './emitter';
import Conversation from '../models/Conversation';
import { loadPrincipal, allows } from '../services/access';
import { touchLastSeen } from '../services/accounts';

/** userId → live socket ids (a user can have several tabs open) */
const onlineUsers = new Map<string, Set<string>>();

export function isUserOnline(userId: string): boolean {
  return (onlineUsers.get(userId)?.size ?? 0) > 0;
}

/** True when any of the user's sockets has joined the given room (e.g. an open conversation). */
export function isUserViewing(userId: string, roomId: string): boolean {
  const io = getIo();
  if (!io) return false;
  const socketIds = onlineUsers.get(userId);
  if (!socketIds) return false;
  const room = io.sockets.adapter.rooms.get(roomId);
  if (!room) return false;
  for (const sid of socketIds) if (room.has(sid)) return true;
  return false;
}

/**
 * Rooms are the transport for every message and notification the server pushes,
 * so joining one is an authorization decision, not a subscription. `user:<id>`
 * is the holder's alone; anything else is a conversation id and needs the same
 * answer `GET /api/messages/:conversationId` gives — a participant, or an
 * observer holding chat read without send.
 */
async function mayJoin(userId: string, roomId: string): Promise<boolean> {
  if (roomId === `user:${userId}`) return true;
  if (roomId.startsWith('user:')) return false;
  if (!mongoose.isValidObjectId(roomId)) return false;

  const principal = await loadPrincipal(userId);
  if (!principal?.isActive || !allows(principal.permissions, 'chat', 'read')) return false;

  const conv = await Conversation.findById(roomId).select('participants').lean();
  if (!conv) return false;
  if (conv.participants.some((p) => String(p) === userId)) return true;

  // The observer seat: reads every thread, takes part in none.
  return !allows(principal.permissions, 'chat', 'create');
}

export function setupSocket(io: Server) {
  // Register io so routes can emit events without circular imports
  setIo(io);

  // A socket with no valid token used to connect anyway and simply miss its
  // personal room — which left every other room reachable by anyone.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('Authentication required'));
    try {
      const { id } = jwt.verify(token, env.jwtSecret) as { id: string };
      const principal = await loadPrincipal(id);
      if (!principal?.isActive) return next(new Error('Account is not active'));
      socket.data.userId = principal.id;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);

    // Presence: track and broadcast
    const sockets = onlineUsers.get(userId) ?? new Set<string>();
    const wasOffline = sockets.size === 0;
    sockets.add(socket.id);
    onlineUsers.set(userId, sockets);
    if (wasOffline) io.emit('presence', { userId, online: true });

    // Client asks who's online (e.g. when opening the chat page)
    socket.on('get_presence', (ack?: (online: string[]) => void) => {
      const online = [...onlineUsers.keys()];
      if (typeof ack === 'function') ack(online);
      else socket.emit('presence_list', online);
    });

    socket.on('join_room', async (roomId: string) => {
      if (typeof roomId !== 'string') return;
      if (await mayJoin(userId, roomId)) socket.join(roomId);
      else socket.emit('join_denied', { roomId });
    });

    socket.on('leave_room', (roomId: string) => {
      if (typeof roomId === 'string' && roomId !== `user:${userId}`) socket.leave(roomId);
    });

    // The legacy `send_message` relay is gone: it broadcast whatever the client
    // handed it, under no sender identity the server had checked. Messages go
    // through POST /api/messages, which persists them and emits the stored row.

    socket.on('typing', (data: { roomId?: string; conversationId?: string; isTyping: boolean }) => {
      const roomId = data?.roomId ?? data?.conversationId;
      // Only rooms this socket already joined, and always under its own id.
      if (roomId && socket.rooms.has(roomId)) {
        socket.to(roomId).emit('typing', { roomId, isTyping: !!data.isTyping, userId });
      }
    });

    socket.on('disconnect', () => {
      const live = onlineUsers.get(userId);
      if (!live) return;
      live.delete(socket.id);
      if (live.size === 0) {
        onlineUsers.delete(userId);
        const lastSeenAt = new Date();
        io.emit('presence', { userId, online: false, lastSeenAt: lastSeenAt.toISOString() });
        touchLastSeen(userId, lastSeenAt).catch(() => {});
      }
    });
  });
}
