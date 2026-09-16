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
async function mayJoin(userId: string, roomId: string): Promise<{ ok: boolean; participants: string[] }> {
  const denied = { ok: false, participants: [] };
  if (roomId === `user:${userId}`) return { ok: true, participants: [] };
  if (roomId.startsWith('user:')) return denied;
  if (!mongoose.isValidObjectId(roomId)) return denied;

  const principal = await loadPrincipal(userId);
  if (!principal?.isActive || !allows(principal.permissions, 'chat', 'read')) return denied;

  const conv = await Conversation.findById(roomId).select('participants').lean();
  if (!conv) return denied;
  const participants = conv.participants.map(String);
  if (participants.includes(userId)) return { ok: true, participants };

  // The observer seat: reads every thread, takes part in none.
  return { ok: !allows(principal.permissions, 'chat', 'create'), participants };
}

/** Participants with at least one socket inside the conversation room. Observers never count. */
function viewersOf(roomId: string, participants: string[]): string[] {
  return participants.filter((p) => isUserViewing(p, roomId));
}

/** Emit to the conversation room and to every participant's personal room, once per socket. */
export async function emitToThread(conversationId: string, event: string, payload: unknown): Promise<void> {
  const io = getIo();
  if (!io) return;
  const conv = await Conversation.findById(conversationId).select('participants').lean();
  const rooms = [String(conversationId), ...(conv?.participants ?? []).map((p) => `user:${p}`)];
  io.to(rooms).emit(event, payload);
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

    // `room_presence` tells a thread who has it open right now. Only participants
    // are announced — an observer reading along stays invisible.
    socket.on('join_room', async (roomId: string, ack?: (res: { ok: boolean; viewers: string[] }) => void) => {
      if (typeof roomId !== 'string') return;
      const { ok, participants } = await mayJoin(userId, roomId);
      if (!ok) {
        socket.emit('join_denied', { roomId });
        if (typeof ack === 'function') ack({ ok: false, viewers: [] });
        return;
      }
      const wasViewing = isUserViewing(userId, roomId);
      socket.join(roomId);
      if (participants.includes(userId)) {
        socket.data.threads = { ...(socket.data.threads ?? {}), [roomId]: participants };
        if (!wasViewing) socket.to(roomId).emit('room_presence', { roomId, userId, inRoom: true });
      }
      if (typeof ack === 'function') ack({ ok: true, viewers: viewersOf(roomId, participants) });
    });

    const leaveThread = (roomId: string) => {
      const threads = (socket.data.threads ?? {}) as Record<string, string[]>;
      if (!threads[roomId]) return;
      delete threads[roomId];
      if (!isUserViewing(userId, roomId)) io.to(roomId).emit('room_presence', { roomId, userId, inRoom: false });
    };

    socket.on('leave_room', (roomId: string) => {
      if (typeof roomId !== 'string' || roomId === `user:${userId}`) return;
      socket.leave(roomId);
      leaveThread(roomId);
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
      for (const roomId of Object.keys(socket.data.threads ?? {})) leaveThread(roomId);

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
