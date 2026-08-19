'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { AppShell } from '@/components/AppShell';
import { MessageSkeleton } from '@/components/Skeleton';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import api from '@/lib/api';
import { fileHref } from '@/lib/media';
import { io, Socket } from 'socket.io-client';
import type { Message, Student, DocRequestItem, FormAnswer } from '@/types';
import { DocRequestCard, FormRequestCard, FormResponseCard, ReplyQuote, Ticks } from '@/components/chat/MessageCards';

import { apiOrigin, apiUrl } from '@/lib/config';

interface Participant { _id: string; name: string; email?: string; role?: string; avatar?: string; }

interface Room {
  _id: string;
  participants: Participant[];
  archived?: boolean;
  updatedAt: string;
  lastMessage?: { text: string; senderId: string; createdAt: string };
}

/** One-line preview of any message (for reply quotes) */
function msgPreview(msg: Message): string {
  if (msg.type === 'file')             return `📎 ${msg.fileName ?? 'File'}`;
  if (msg.type === 'document_request') return '📋 Documents requested';
  if (msg.type === 'form_request')     return `📝 ${msg.meta?.title ?? 'Details requested'}`;
  if (msg.type === 'form_response')    return '📝 Details submitted';
  return msg.text ?? '';
}

function initials(name?: string) {
  return (name ?? '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

function fmtListTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function FileContent({ msg, isMe }: { msg: Message; isMe: boolean }) {
  const ext  = msg.fileName?.split('.').pop()?.toLowerCase() ?? '';
  const isImg = ['jpg','jpeg','png','gif','webp','svg'].includes(ext);
  const href  = fileHref(msg.fileUrl);

  if (isImg) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={href} alt={msg.fileName} className="max-w-[220px] rounded-lg" />
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isMe ? 'bg-white/20' : 'bg-[#0a84ff]/15'}`}>
        <svg viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 ${isMe ? 'text-white' : 'text-[#0a84ff]'}`}>
          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd"/>
        </svg>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium truncate max-w-[150px]">{msg.fileName}</p>
        <p className={`text-xs ${isMe ? 'text-white/70' : 'im-sub'}`}>Tap to open</p>
      </div>
    </a>
  );
}

export default function ChatPage() {
  const { user, studentId } = useAuthStore();
  const { toast }           = useToast();

  const [rooms, setRooms]               = useState<Room[]>([]);
  const [activeRoom, setActiveRoom]     = useState<Room | null>(null);
  const [view, setView]                 = useState<'list' | 'thread'>('list');
  const [messages, setMessages]         = useState<Message[]>([]);
  const [counsellor, setCounsellor]     = useState<{ _id: string; name: string } | null>(null);
  const [input, setInput]               = useState('');
  const [loading, setLoading]           = useState(true);
  const [msgLoading, setMsgLoading]     = useState(false);
  const [sending, setSending]           = useState(false);
  const [uploading, setUploading]       = useState(false);
  const [isTyping, setIsTyping]         = useState(false);
  const [otherTyping, setOtherTyping]   = useState(false);
  const [onlineIds, setOnlineIds]       = useState<Set<string>>(new Set());
  const [replyTo, setReplyTo]           = useState<Message | null>(null);
  const [reqUploadingId, setReqUploadingId] = useState<string | null>(null);
  const [formBusy, setFormBusy]         = useState(false);

  const socketRef     = useRef<Socket | null>(null);
  const bottomRef     = useRef<HTMLDivElement>(null);
  const typingTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const inputRef      = useRef<HTMLInputElement>(null);
  const activeRoomRef = useRef<string | null>(null);

  const myId = user?._id ?? '';

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  const markRead = useCallback((convId: string) => {
    api.post(`/messages/${convId}/read`).catch(() => {});
  }, []);

  const otherOf = useCallback((room: Room): Participant | undefined =>
    room.participants.find(p => p._id !== myId) ?? room.participants[0], [myId]);

  /* ── Load rooms: history with past counsellors + active one ────────────── */
  const loadRooms = useCallback(async (autoOpen: boolean) => {
    if (!studentId) return;
    try {
      const sRes = await api.get<Student>(`/students/${studentId}`);
      const c = sRes.data.assignedCounsellor ?? null;
      setCounsellor(c);

      let list = (await api.get<Room[]>('/messages/conversations')).data;

      // Make sure the room with the current counsellor exists
      if (c && !list.some(r => !r.archived && r.participants.some(p => p._id === c._id))) {
        await api.post('/messages/conversation', { participantId: c._id });
        list = (await api.get<Room[]>('/messages/conversations')).data;
      }

      setRooms(list);
      // Keep the open thread's archived flag in sync
      if (activeRoomRef.current) {
        const cur = list.find(r => r._id === activeRoomRef.current);
        if (cur) setActiveRoom(prev => (prev ? { ...prev, archived: cur.archived } : prev));
      }
      if (autoOpen && list.length === 1) openRoom(list[0]);
    } catch {
      toast('Could not load chat', 'error');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, toast]);

  useEffect(() => { loadRooms(true); }, [loadRooms]);

  /* ── Socket (one connection; join/leave rooms on switch) ───────────────── */
  useEffect(() => {
    if (!user) return;
    const socket = io(apiOrigin, { auth: { token: localStorage.getItem('student_token') } });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('get_presence', (online: string[]) => setOnlineIds(new Set(online)));
      if (activeRoomRef.current) socket.emit('join_room', activeRoomRef.current);
    });

    socket.on('presence', ({ userId, online }: { userId: string; online: boolean }) => {
      setOnlineIds(prev => {
        const next = new Set(prev);
        if (online) next.add(userId); else next.delete(userId);
        return next;
      });
    });

    socket.on('receive_message', (msg: Message) => {
      setRooms(prev => prev.map(r => r._id === msg.conversationId
        ? { ...r, lastMessage: { text: msgPreview(msg), senderId: msg.senderId, createdAt: msg.createdAt }, updatedAt: msg.createdAt }
        : r));
      if (activeRoomRef.current === msg.conversationId) {
        setMessages(prev => prev.some(m => m._id === msg._id) ? prev : [...prev, msg]);
        if (msg.senderId !== myId) markRead(msg.conversationId);
        scrollToBottom();
      }
    });

    socket.on('message_updated', (msg: Message) => {
      if (activeRoomRef.current === msg.conversationId) {
        setMessages(prev => prev.map(m => m._id === msg._id ? { ...m, ...msg } : m));
      }
    });

    socket.on('messages_read', ({ conversationId, userId }: { conversationId: string; userId: string }) => {
      if (activeRoomRef.current === conversationId && userId !== myId) {
        setMessages(prev => prev.map(m =>
          m.readBy?.includes(userId) ? m : { ...m, readBy: [...(m.readBy ?? []), userId] }
        ));
      }
    });

    socket.on('typing', ({ userId, isTyping: t }: { userId: string; isTyping: boolean }) => {
      if (userId !== myId) setOtherTyping(t);
    });

    // Counsellor reassignment — refresh rooms so the new counsellor appears
    socket.on('conversations_changed', () => { loadRooms(false); });

    socket.on('conversation_archived', ({ conversationId }: { conversationId: string }) => {
      setRooms(prev => prev.map(r => r._id === conversationId ? { ...r, archived: true } : r));
      if (activeRoomRef.current === conversationId) {
        setActiveRoom(prev => (prev ? { ...prev, archived: true } : prev));
      }
    });

    return () => { socket.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /* ── Open / leave rooms ─────────────────────────────────────────────────── */
  const openRoom = useCallback((room: Room) => {
    if (activeRoomRef.current && socketRef.current) {
      socketRef.current.emit('leave_room', activeRoomRef.current);
    }
    setActiveRoom(room);
    activeRoomRef.current = room._id;
    setView('thread');
    setOtherTyping(false);
    setReplyTo(null);
    setMessages([]);
    setMsgLoading(true);

    if (socketRef.current) socketRef.current.emit('join_room', room._id);

    api.get<Message[]>(`/messages/${room._id}`)
      .then(res => { setMessages(res.data); scrollToBottom(); markRead(room._id); })
      .catch(() => toast('Could not load messages', 'error'))
      .finally(() => setMsgLoading(false));
  }, [scrollToBottom, toast, markRead]);

  function backToList() {
    if (activeRoomRef.current && socketRef.current) {
      socketRef.current.emit('leave_room', activeRoomRef.current);
    }
    setActiveRoom(null);
    activeRoomRef.current = null;
    setView('list');
  }

  /* ── Typing ────────────────────────────────────────────────────────────── */
  function emitTyping(active: boolean) {
    if (!activeRoomRef.current || !socketRef.current) return;
    socketRef.current.emit('typing', { roomId: activeRoomRef.current, userId: myId, isTyping: active });
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInput(e.target.value);
    if (!isTyping) { setIsTyping(true); emitTyping(true); }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => { setIsTyping(false); emitTyping(false); }, 1500);
  }

  /* ── Send text ─────────────────────────────────────────────────────────── */
  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !activeRoom || activeRoom.archived) return;
    const text = input.trim();
    const reply = replyTo;
    setInput('');
    setReplyTo(null);
    setSending(true);
    emitTyping(false);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    try {
      await api.post('/messages/send', {
        conversationId: activeRoom._id,
        text,
        replyTo: reply ? { messageId: reply._id, senderName: reply.senderName, preview: msgPreview(reply) } : undefined,
      });
    } catch {
      toast('Failed to send message', 'error');
      setInput(text);
      setReplyTo(reply);
    } finally {
      setSending(false);
    }
  }

  /* ── Send file ─────────────────────────────────────────────────────────── */
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeRoom || activeRoom.archived) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('conversationId', activeRoom._id);
      if (studentId) form.append('studentId', studentId);

      const token = localStorage.getItem('student_token');
      const res   = await fetch(`${apiUrl}/messages/send-file`, {
        method:  'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body:    form,
      });
      if (!res.ok) throw new Error('Upload failed');
      toast('File sent!', 'success');
    } catch {
      toast('Failed to send file', 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  /* ── Upload for a counsellor's document request ────────────────────────── */
  async function handleRequestUpload(item: DocRequestItem, file: File) {
    if (!studentId || !activeRoom) return;
    setReqUploadingId(item.requestId);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('studentId', studentId);
      form.append('type', item.type);
      if (item.label) form.append('label', item.label);
      form.append('requestId', item.requestId);
      form.append('conversationId', activeRoom._id);

      const token = localStorage.getItem('student_token');
      const res   = await fetch(`${apiUrl}/documents/upload`, {
        method:  'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body:    form,
      });
      if (!res.ok) throw new Error('Upload failed');
      toast('Document uploaded!', 'success');
    } catch {
      toast('Upload failed', 'error');
    } finally {
      setReqUploadingId(null);
    }
  }

  /* ── Submit an in-chat form ────────────────────────────────────────────── */
  async function handleFormSubmit(formMessageId: string, answers: FormAnswer[]) {
    if (!activeRoom || activeRoom.archived) return;
    setFormBusy(true);
    try {
      await api.post('/messages/form-response', {
        conversationId: activeRoom._id,
        formMessageId,
        answers,
      });
      toast('Answers sent!', 'success');
    } catch {
      toast('Failed to send answers', 'error');
    } finally {
      setFormBusy(false);
    }
  }

  /* ── Derived ───────────────────────────────────────────────────────────── */
  const other       = activeRoom ? otherOf(activeRoom) : undefined;
  const otherOnline = other ? onlineIds.has(other._id) : false;
  const isClosed    = !!activeRoom?.archived;
  const sortedRooms = [...rooms].sort((a, b) => {
    if (!!a.archived !== !!b.archived) return a.archived ? 1 : -1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return (
    <AppShell title="Chat">
      <div className="flex flex-col h-full max-h-screen im-thread">

        {/* ══ Rooms list ══════════════════════════════════════════════════ */}
        {view === 'list' && (
          <>
            <div className="px-4 sm:px-6 py-3.5 border-b im-chrome flex-shrink-0">
              <p className="font-semibold text-t1 text-sm">Chats</p>
              <p className="text-xs im-sub">Your counsellor conversations</p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-4"><MessageSkeleton /></div>
              ) : sortedRooms.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-16 px-6">
                  <div className="text-4xl mb-3">💬</div>
                  <p className="text-t2 font-medium">No counsellor assigned yet</p>
                  <p className="im-sub text-sm mt-1">Once a counsellor is assigned to you, you can chat here.</p>
                </div>
              ) : (
                sortedRooms.map(room => {
                  const p      = otherOf(room);
                  const online = p ? onlineIds.has(p._id) : false;
                  const isCurrent = !room.archived && counsellor && p?._id === counsellor._id;
                  return (
                    <button
                      key={room._id}
                      onClick={() => openRoom(room)}
                      className={`w-full flex items-center gap-3 px-4 sm:px-6 py-3.5 text-left border-b transition hover:opacity-90 ${room.archived ? 'opacity-70' : ''}`}
                      style={{ borderColor: 'var(--im-hairline)' }}
                    >
                      <div className="relative flex-shrink-0">
                        <div className="w-11 h-11 rounded-full bg-[#0a84ff]/15 text-[#0a84ff] text-sm font-bold flex items-center justify-center">
                          {initials(p?.name)}
                        </div>
                        {online && !room.archived && (
                          <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white dark:border-black" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-t1 truncate">
                            {p?.name ?? 'Unknown'}
                            {isCurrent && <span className="ml-1.5 text-[10px] font-bold text-[#0a84ff] uppercase tracking-wider">· Current</span>}
                          </p>
                          {room.archived ? (
                            <span className="text-[10px] font-semibold uppercase tracking-wider im-sub border rounded-full px-2 py-0.5 flex-shrink-0" style={{ borderColor: 'var(--im-hairline)' }}>Closed</span>
                          ) : (
                            <span className="text-[11px] im-sub flex-shrink-0">{fmtListTime(room.lastMessage?.createdAt ?? room.updatedAt)}</span>
                          )}
                        </div>
                        <p className="text-xs im-sub truncate mt-0.5">
                          {room.lastMessage?.text || 'No messages yet'}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* ══ Thread ══════════════════════════════════════════════════════ */}
        {view === 'thread' && activeRoom && (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 px-4 sm:px-6 py-3.5 border-b im-chrome flex-shrink-0">
              <button
                onClick={backToList}
                className="p-1.5 rounded-lg im-sub hover:opacity-70 -ml-1 flex-shrink-0"
                title="All chats"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd"/>
                </svg>
              </button>
              <div className="relative flex-shrink-0">
                <div className="w-9 h-9 rounded-full bg-[#0a84ff]/15 text-[#0a84ff] text-sm font-bold flex items-center justify-center">
                  {initials(other?.name)}
                </div>
                {otherOnline && !isClosed && (
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-black" />
                )}
              </div>
              <div>
                <p className="font-semibold text-t1 text-sm">{other?.name ?? 'Chat'}</p>
                <p className="text-xs im-sub">
                  {isClosed
                    ? 'conversation closed'
                    : otherTyping
                      ? <span className="text-[#0a84ff]">typing…</span>
                      : otherOnline
                        ? <span className="text-emerald-500">online</span>
                        : (counsellor && other?._id === counsellor._id ? 'Your Counsellor' : 'Previous Counsellor')}
                </p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto scroll-smooth overscroll-contain px-4 sm:px-6 py-4 space-y-1 min-h-0">
              {msgLoading ? (
                <MessageSkeleton />
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-16">
                  <div className="text-4xl mb-3">👋</div>
                  <p className="text-t2 font-medium">Start a conversation</p>
                  <p className="im-sub text-sm mt-1">Say hello to your counsellor!</p>
                </div>
              ) : (
                <>
                  {messages.map((msg, idx) => {
                    const isMe     = msg.senderId === myId;
                    const showDate = idx === 0 || new Date(msg.createdAt).toDateString() !== new Date(messages[idx - 1].createdAt).toDateString();
                    const read     = !!(other && msg.readBy?.includes(other._id));
                    const isCard   = msg.type === 'document_request' || msg.type === 'form_request' || msg.type === 'form_response';

                    if (msg.type === 'system') {
                      return (
                        <div key={msg._id} className="flex justify-center my-3">
                          <span className="text-[11px] font-semibold im-sub px-3 py-1 text-center">{msg.text}</span>
                        </div>
                      );
                    }

                    return (
                      <div key={msg._id}>
                        {showDate && (
                          <div className="flex justify-center my-3">
                            <span className="text-[11px] font-semibold im-sub px-3 py-1 animate-chip-in">
                              {new Date(msg.createdAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                        )}
                        <div className={`group flex ${isMe ? 'justify-end animate-msg-right' : 'justify-start animate-msg-left'} gap-2 py-1`}>
                          {isMe && !isClosed && (
                            <button
                              onClick={() => { setReplyTo(msg); inputRef.current?.focus(); }}
                              title="Reply"
                              className="self-center opacity-0 group-hover:opacity-100 transition im-sub hover:text-[#0a84ff] p-1"
                            >
                              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/>
                              </svg>
                            </button>
                          )}

                          <div className={`${isCard ? '' : 'max-w-[75%]'} space-y-0.5`}>
                            {isCard ? (
                              <>
                                {msg.type === 'document_request' && (
                                  <DocRequestCard msg={msg} onUpload={handleRequestUpload} uploadingId={reqUploadingId} />
                                )}
                                {msg.type === 'form_request' && (
                                  <FormRequestCard
                                    msg={msg}
                                    canAnswer={!isMe && !isClosed}
                                    onSubmit={handleFormSubmit}
                                    busy={formBusy}
                                  />
                                )}
                                {msg.type === 'form_response' && <FormResponseCard msg={msg} />}
                              </>
                            ) : (
                              <div className={`msg-bubble px-4 py-2.5 rounded-[20px] text-sm leading-relaxed ${
                                isMe
                                  ? 'im-bubble-me rounded-br-[6px]'
                                  : 'im-bubble-other rounded-bl-[6px]'
                              }`}>
                                {msg.replyTo && <ReplyQuote replyTo={msg.replyTo} isMe={isMe} />}
                                {msg.type === 'file' ? <FileContent msg={msg} isMe={isMe} /> : msg.text}
                              </div>
                            )}
                            <p className={`text-[11px] im-sub px-1 flex items-center gap-1 ${isMe ? 'justify-end' : ''}`}>
                              {new Date(msg.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                              {isMe && <Ticks read={read} />}
                            </p>
                          </div>

                          {!isMe && !isClosed && (
                            <button
                              onClick={() => { setReplyTo(msg); inputRef.current?.focus(); }}
                              title="Reply"
                              className="self-center opacity-0 group-hover:opacity-100 transition im-sub hover:text-[#0a84ff] p-1"
                            >
                              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/>
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Typing indicator */}
                  {otherTyping && !isClosed && (
                    <div className="flex items-center gap-2 py-1 animate-msg-left">
                      <div className="flex items-center gap-1 px-4 py-3 rounded-[20px] rounded-bl-[6px] im-bubble-other">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#8e8e93] typing-dot" />
                        <span className="w-1.5 h-1.5 rounded-full bg-[#8e8e93] typing-dot" />
                        <span className="w-1.5 h-1.5 rounded-full bg-[#8e8e93] typing-dot" />
                      </div>
                    </div>
                  )}

                  <div ref={bottomRef} />
                </>
              )}
            </div>

            {/* Composer — or a closed notice */}
            {isClosed ? (
              <div className="flex-shrink-0 px-4 sm:px-6 py-4 im-chrome border-t">
                <p className="text-sm im-sub text-center leading-relaxed">
                  🔒 This conversation is closed — you have a new counsellor now.
                  You can still read the history here.
                </p>
              </div>
            ) : (
              <>
                {/* Reply banner */}
                {replyTo && (
                  <div className="flex-shrink-0 px-4 sm:px-6 pt-2 im-chrome border-t">
                    <div className="flex items-center gap-2 im-quote border-l-2 border-[#0a84ff] rounded-lg px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#0a84ff]">Replying to {replyTo.senderName}</p>
                        <p className="text-xs im-sub truncate">{msgPreview(replyTo)}</p>
                      </div>
                      <button onClick={() => setReplyTo(null)} className="im-sub hover:opacity-70 text-lg leading-none px-1">×</button>
                    </div>
                  </div>
                )}

                <form
                  onSubmit={handleSend}
                  className={`flex-shrink-0 px-4 sm:px-6 py-3 im-chrome flex items-center gap-2 ${replyTo ? '' : 'border-t'}`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFileChange}
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                  />

                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    title="Send a file or document"
                    className="w-10 h-10 rounded-xl im-sub hover:opacity-70 flex items-center justify-center disabled:opacity-40 transition flex-shrink-0"
                  >
                    {uploading ? (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                        <path fillRule="evenodd" d="M8 4a3 3 0 00-3 3v4a5 5 0 0010 0V7a1 1 0 112 0v4a7 7 0 11-14 0V7a5 5 0 0110 0v4a3 3 0 11-6 0V7a1 1 0 012 0v4a1 1 0 102 0V7a3 3 0 00-3-3z" clipRule="evenodd"/>
                      </svg>
                    )}
                  </button>

                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={handleInputChange}
                    placeholder="Message your counsellor…"
                    className="flex-1 im-field rounded-full px-4 py-2.5 text-sm focus:outline-none focus:border-[#0a84ff] transition"
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || sending}
                    className="w-10 h-10 rounded-full im-send flex items-center justify-center disabled:opacity-40 transition active:scale-95 flex-shrink-0"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4.5 h-4.5 -rotate-45">
                      <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/>
                    </svg>
                  </button>
                </form>
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
