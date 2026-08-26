import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { setIo, getIo } from './emitter';
import User from '../models/User';
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

export function setupSocket(io: Server) {
  // Register io so routes can emit events without circular imports
  setIo(io);

  io.on('connection', (socket: Socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Auto-join user's personal notification room so we can push notifications in real-time
    let userId: string | null = null;
    const token = socket.handshake.auth?.token as string | undefined;
    if (token) {
      try {
        const decoded = jwt.verify(token, env.jwtSecret) as { id: string };
        userId = decoded.id;
        socket.data.userId = userId;
        socket.join(`user:${userId}`);

        // Presence: track and broadcast
        const sockets = onlineUsers.get(userId) ?? new Set<string>();
        const wasOffline = sockets.size === 0;
        sockets.add(socket.id);
        onlineUsers.set(userId, sockets);
        if (wasOffline) io.emit('presence', { userId, online: true });
      } catch { /* invalid / expired token — no personal room */ }
    }

    // Client asks who's online (e.g. when opening the chat page)
    socket.on('get_presence', (ack?: (online: string[]) => void) => {
      const online = [...onlineUsers.keys()];
      if (typeof ack === 'function') ack(online);
      else socket.emit('presence_list', online);
    });

    socket.on('join_room', (roomId: string) => {
      socket.join(roomId);
    });

    socket.on('leave_room', (roomId: string) => {
      socket.leave(roomId);
    });

    // Legacy socket-based send (emits to other room members)
    socket.on('send_message', (data: { conversationId: string; message: unknown }) => {
      socket.to(data.conversationId).emit('receive_message', data.message);
    });

    socket.on('typing', (data: { roomId?: string; conversationId?: string; userId?: string; isTyping: boolean }) => {
      const roomId = data.roomId ?? data.conversationId;
      if (roomId) socket.to(roomId).emit('typing', { ...data, userId: data.userId ?? socket.id });
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
      if (userId) {
        const sockets = onlineUsers.get(userId);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            onlineUsers.delete(userId);
            const lastSeenAt = new Date();
            io.emit('presence', { userId, online: false, lastSeenAt: lastSeenAt.toISOString() });
            touchLastSeen(userId, lastSeenAt).catch(() => {});
          }
        }
      }
    });
  });
}
