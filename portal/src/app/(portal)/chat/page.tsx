'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { MessageSkeleton } from '@/components/Skeleton';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import api from '@/lib/api';
import { fileHref, openStoredFile } from '@/lib/media';
import { io, Socket } from 'socket.io-client';
import type { Message, Student, DocRequestItem, FormAnswer } from '@/types';
import { DocRequestCard, FormRequestCard, FormResponseCard, ReplyQuote, Ticks } from '@/components/chat/MessageCards';
import { ACCEPT, AttachmentTray, DropOverlay, useFileDrop, useStagedFiles } from '@/components/chat/Attachments';
import { ComposerEmojiButton, Icon, MessageGesture, ReactionChips, useMessageActions } from '@/components/chat/MessageActions';

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

/** History arrives with the sender populated; live messages carry a bare id. */
function senderIdOf(msg: Message): string {
  const s = msg.senderId as string | { _id: string };
  return typeof s === 'object' && s ? s._id : s;
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

function FileContent({ msg, isMe, onOpen }: { msg: Message; isMe: boolean; onOpen: () => void }) {
  const ext   = msg.fileName?.split('.').pop()?.toLowerCase() ?? '';
  const isImg = ['jpg','jpeg','png','gif','webp','svg'].includes(ext);
  const href  = fileHref(msg.fileUrl);
  const docId = msg.meta?.documentId;

  return (
    <div className="space-y-1.5">
      {isImg ? (
        <button type="button" onClick={onOpen} className="block" aria-label={`Open ${msg.fileName ?? 'image'}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={href} alt={msg.fileName} className="max-w-[220px] rounded-lg" />
        </button>
      ) : (
        <button type="button" onClick={onOpen} className="flex items-center gap-2 text-left hover:opacity-80 transition-opacity">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isMe ? 'bg-white/20' : 'bg-[#0a84ff]/15'}`}>
            <svg viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 ${isMe ? 'text-white' : 'text-[#0a84ff]'}`}>
              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd"/>
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium truncate max-w-[150px]">{msg.fileName}</p>
            <p className={`text-xs ${isMe ? 'text-white/70' : 'im-sub'}`}>Tap to open</p>
          </div>
        </button>
      )}
      {docId && (
        <Link
          href={`/documents?doc=${docId}`}
          className={`inline-flex min-h-[32px] items-center gap-1 text-xs font-semibold underline-offset-2 hover:underline ${isMe ? 'text-white/90' : 'text-[#0a84ff]'}`}
        >
          Open in Documents
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5"><path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd"/></svg>
        </Link>
      )}
    </div>
  );
}

function HoverActions({
  canReply, onReply, onMore,
}: { canReply: boolean; onReply: () => void; onMore: (e: React.MouseEvent) => void }) {
  const btn = 'flex h-8 w-8 items-center justify-center rounded-full im-sub transition hover:bg-muted hover:text-[#0a84ff]';
  return (
    <div className="hidden shrink-0 items-center self-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 md:flex">
      {canReply && (
        <button type="button" onClick={onReply} title="Reply" aria-label="Reply" className={btn}>
          <Icon name="reply" className="h-4 w-4" />
        </button>
      )}
      <button type="button" onClick={onMore} title="More actions" aria-label="More actions" className={btn}>
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden><path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" /></svg>
      </button>
    </div>
  );
}

export default function ChatPage() {
  const { user, studentId } = useAuthStore();
  const { toast }           = useToast();

  const [rooms, setRooms]               = useState<Room[]>([]);
  const [activeRoom, setActiveRoom]     = useState<Room | null>(null);
  const [view, setView]                 = useState<'list' | 'thread'>('list');
  const [messages, setMessages]         = useState<Message[]>([]);
  const [counsellors, setCounsellors]   = useState<{ _id: string; name: string }[]>([]);
  const [input, setInput]               = useState('');
  const [loading, setLoading]           = useState(true);
  const [msgLoading, setMsgLoading]     = useState(false);
  const [sending, setSending]           = useState(false);
  const [uploading, setUploading]       = useState(false);
  const [isTyping, setIsTyping]         = useState(false);
  const [otherTyping, setOtherTyping]   = useState(false);
  const [onlineIds, setOnlineIds]       = useState<Set<string>>(new Set());
  const [inRoomIds, setInRoomIds]       = useState<Set<string>>(new Set());
  const [replyTo, setReplyTo]           = useState<Message | null>(null);
  const [editing, setEditing]           = useState<Message | null>(null);
  const [reqUploadingId, setReqUploadingId] = useState<string | null>(null);
  const [formBusy, setFormBusy]         = useState(false);

  const socketRef     = useRef<Socket | null>(null);
  const bottomRef     = useRef<HTMLDivElement>(null);
  const typingTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const inputRef      = useRef<HTMLInputElement>(null);
  const activeRoomRef = useRef<string | null>(null);
  const actionsRef    = useRef<ReturnType<typeof useMessageActions> | null>(null);
  const router        = useRouter();

  const myId = user?._id ?? '';

  const rejectFile = useCallback((message: string) => toast(message, 'error'), [toast]);
  const { staged, add: stageFiles, remove: unstageFile, clear: clearStaged } = useStagedFiles(rejectFile);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  const markRead = useCallback((convId: string) => {
    api.post(`/messages/${convId}/read`).catch(() => {});
  }, []);

  /** Join the open thread's room and learn who else has it open. */
  const joinThread = useCallback((convId: string) => {
    socketRef.current?.emit('join_room', convId, (res?: { ok: boolean; viewers: string[] }) => {
      if (res?.ok && activeRoomRef.current === convId) setInRoomIds(new Set(res.viewers));
    });
  }, []);

  /** Pull the thread again — after a reconnect or coming back to the tab, to catch anything missed. */
  const refreshThread = useCallback((convId: string) => {
    api.get<Message[]>(`/messages/${convId}`)
      .then(res => {
        if (activeRoomRef.current !== convId) return;
        setMessages(res.data);
        markRead(convId);
      })
      .catch(() => {});
  }, [markRead]);

  const otherOf = useCallback((room: Room): Participant | undefined =>
    room.participants.find(p => p._id !== myId) ?? room.participants[0], [myId]);

  /* ── Load rooms: history with past counsellors + active one ────────────── */
  const loadRooms = useCallback(async (autoOpen: boolean) => {
    if (!studentId) return;
    try {
      const sRes = await api.get<Student>(`/students/${studentId}`);
      const assigned = sRes.data.counsellors ?? [];
      setCounsellors(assigned);

      let list = (await api.get<Room[]>('/messages/conversations')).data;

      // Make sure a room exists with each counsellor working the case
      const missing = assigned.filter(
        c => !list.some(r => !r.archived && r.participants.some(p => p._id === c._id)),
      );
      if (missing.length) {
        for (const c of missing) await api.post('/messages/conversation', { participantId: c._id });
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

    let connectedBefore = false;
    socket.on('connect', () => {
      socket.emit('get_presence', (online: string[]) => setOnlineIds(new Set(online)));
      const cid = activeRoomRef.current;
      if (cid) {
        joinThread(cid);
        if (connectedBefore) refreshThread(cid);
      }
      connectedBefore = true;
    });

    socket.on('room_presence', ({ roomId, userId, inRoom }: { roomId: string; userId: string; inRoom: boolean }) => {
      if (roomId !== activeRoomRef.current) return;
      setInRoomIds(prev => {
        const next = new Set(prev);
        if (inRoom) next.add(userId); else next.delete(userId);
        return next;
      });
      if (!inRoom) setOtherTyping(false);
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
        ? { ...r, lastMessage: { text: msgPreview(msg), senderId: senderIdOf(msg), createdAt: msg.createdAt }, updatedAt: msg.createdAt }
        : r));
      if (activeRoomRef.current === msg.conversationId) {
        setMessages(prev => prev.some(m => m._id === msg._id) ? prev : [...prev, msg]);
        if (senderIdOf(msg) !== myId) markRead(msg.conversationId);
        scrollToBottom();
      }
    });

    socket.on('message_updated', (msg: Message) => {
      if (activeRoomRef.current === msg.conversationId) {
        setMessages(prev => prev.map(m => m._id === msg._id ? { ...m, ...msg } : m));
        actionsRef.current?.onMessageUpdated(msg);
      }
    });

    socket.on('message_starred', (e: { messageId: string; starred: boolean }) => actionsRef.current?.onStarredEvent(e));

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

    // Roster change — refresh rooms so a new counsellor appears
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
    setInRoomIds(new Set());
    setReplyTo(null);
    setEditing(null);
    clearStaged();
    setMessages([]);
    setMsgLoading(true);

    joinThread(room._id);

    api.get<Message[]>(`/messages/${room._id}`)
      .then(res => { setMessages(res.data); scrollToBottom(); markRead(room._id); })
      .catch(() => toast('Could not load messages', 'error'))
      .finally(() => setMsgLoading(false));
  }, [scrollToBottom, toast, markRead, clearStaged, joinThread]);

  /* ── Leave the room while the tab is hidden, so the other side sees it and gets notified ── */
  useEffect(() => {
    const onVisibility = () => {
      const cid = activeRoomRef.current;
      if (!cid || !socketRef.current) return;
      if (document.visibilityState === 'hidden') {
        socketRef.current.emit('leave_room', cid);
      } else {
        joinThread(cid);
        refreshThread(cid);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [joinThread, refreshThread]);

  function backToList() {
    if (activeRoomRef.current && socketRef.current) {
      socketRef.current.emit('leave_room', activeRoomRef.current);
    }
    setActiveRoom(null);
    activeRoomRef.current = null;
    clearStaged();
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
  function insertEmoji(emoji: string) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? input.length;
    setInput(input.slice(0, start) + emoji + input.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  function startReply(msg: Message) {
    setEditing(null);
    setReplyTo(msg);
    inputRef.current?.focus();
  }

  function startEdit(msg: Message) {
    setReplyTo(null);
    setEditing(msg);
    setInput(msg.text ?? '');
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function cancelEdit() {
    setEditing(null);
    setInput('');
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!activeRoom || activeRoom.archived) return;

    if (editing) {
      const text = input.trim();
      if (!text) return;
      const target = editing;
      setEditing(null);
      setInput('');
      if (text === target.text) return;
      try {
        const { data } = await api.put<Message>(`/messages/message/${target._id}`, { text });
        setMessages(prev => prev.map(m => m._id === target._id ? { ...m, ...data } : m));
      } catch {
        toast('Could not edit message', 'error');
        setEditing(target);
        setInput(text);
      }
      return;
    }

    const replyForFiles = input.trim() ? null : replyTo;
    if (staged.length) {
      if (!(await sendStaged(replyForFiles))) return;
      if (replyForFiles) setReplyTo(null);
    }
    if (!input.trim()) return;
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
        replyTo: reply ? { messageId: reply._id } : undefined,
      });
    } catch {
      toast('Failed to send message', 'error');
      setInput(text);
      setReplyTo(reply);
    } finally {
      setSending(false);
    }
  }

  /* ── Files: stage, preview, send ──────────────────────────────────────── */
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    stageFiles(Array.from(e.target.files ?? []));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  /** Sends staged files in order; a failure keeps it and everything after it staged. */
  async function sendStaged(reply: Message | null = null): Promise<boolean> {
    if (!activeRoom || activeRoom.archived || uploading) return false;
    setUploading(true);
    const token = localStorage.getItem('student_token');
    try {
      for (const item of staged) {
        const form = new FormData();
        form.append('file', item.file);
        form.append('conversationId', activeRoom._id);
        if (studentId) form.append('studentId', studentId);
        if (reply && item === staged[0]) form.append('replyTo', JSON.stringify({ messageId: reply._id }));
        const res = await fetch(`${apiUrl}/messages/send-file`, {
          method:  'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body:    form,
        });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || `Could not send ${item.file.name}`);
        unstageFile(item.id);
      }
      scrollToBottom();
      return true;
    } catch (err) {
      toast((err as Error).message, 'error');
      return false;
    } finally {
      setUploading(false);
    }
  }

  const { dragging, dropHandlers } = useFileDrop(stageFiles, view === 'thread' && !!activeRoom && !activeRoom.archived);

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
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || 'Upload failed');
      toast('Document uploaded!', 'success');
    } catch (err) {
      toast((err as Error).message || 'Upload failed', 'error');
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
  const otherInRoom = other ? inRoomIds.has(other._id) : false;
  const isClosed    = !!activeRoom?.archived;
  const canInteract = view === 'thread' && !!activeRoom && !isClosed;

  const actions = useMessageActions({
    api,
    convId: view === 'thread' ? activeRoom?._id ?? null : null,
    myId,
    messages,
    setMessages,
    toast,
    preview: msgPreview,
    canInteract,
    canStar: true,
    canDelete: true,
    onReply: startReply,
    onEdit: startEdit,
    openFile: m => { openStoredFile(`/messages/message/${m._id}/open`).catch(() => toast('Could not open this file', 'error')); },
    openInDocuments: m => router.push(`/documents?doc=${m.meta?.documentId}`),
  });
  actionsRef.current = actions;
  const sortedRooms = [...rooms].sort((a, b) => {
    if (!!a.archived !== !!b.archived) return a.archived ? 1 : -1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return (
    <AppShell title="Chat">
      <div className="relative flex flex-col h-full max-h-screen im-thread" {...dropHandlers}>
        <DropOverlay show={dragging} />

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
                  const isCurrent = !room.archived && counsellors.some(c => c._id === p?._id);
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
                      : otherInRoom
                        ? <span className="inline-flex items-center gap-1.5 font-medium text-emerald-500"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />in this chat</span>
                      : otherOnline
                        ? <span className="text-emerald-500">online</span>
                        : (counsellors.some(c => c._id === other?._id) ? 'Your Counsellor' : 'Previous Counsellor')}
                </p>
              </div>
              <div className="flex-1" />
              <button
                type="button"
                onClick={actions.openStarred}
                title="Starred messages"
                aria-label="Starred messages"
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl im-sub transition hover:bg-muted hover:text-amber-400"
              >
                <Icon name="star" className="h-5 w-5" />
              </button>
            </div>

            {actions.selectionBar}
            {actions.pinnedBar}

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
                    const isMe     = senderIdOf(msg) === myId;
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
                        <MessageGesture
                          id={msg._id}
                          align={isMe ? 'right' : 'left'}
                          selecting={actions.selecting}
                          selected={actions.selected.has(msg._id)}
                          canReply={canInteract && !msg.deletedForEveryone}
                          onMenu={(x, y, touch) => actions.openMenu(msg, x, y, touch)}
                          onReply={() => startReply(msg)}
                          onToggleSelect={() => actions.toggleSelect(msg._id)}
                        >
                        <div className={`group flex ${isMe ? 'justify-end animate-msg-right' : 'justify-start animate-msg-left'} gap-1 py-1`}>
                          {isMe && !actions.selecting && (
                            <HoverActions
                              canReply={canInteract && !msg.deletedForEveryone}
                              onReply={() => startReply(msg)}
                              onMore={e => actions.openMenu(msg, e.clientX, e.clientY, false)}
                            />
                          )}

                          <div className={`${isCard && !msg.deletedForEveryone ? '' : 'max-w-[82%] sm:max-w-[75%]'} min-w-0 space-y-1`}>
                            {msg.deletedForEveryone ? (
                              <div className="flex items-center gap-2 rounded-[20px] border border-dashed px-4 py-2.5 text-sm italic im-sub" style={{ borderColor: 'var(--im-hairline)' }}>
                                <Icon name="trash" className="h-4 w-4 shrink-0" />
                                {isMe ? 'You deleted this message' : 'This message was deleted'}
                              </div>
                            ) : isCard ? (
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
                              <div className={`msg-bubble px-4 py-2.5 rounded-[20px] text-sm leading-relaxed break-words ${
                                isMe
                                  ? 'im-bubble-me rounded-br-[6px]'
                                  : 'im-bubble-other rounded-bl-[6px]'
                              }`}>
                                {msg.replyTo && (
                                  <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); actions.jump(msg.replyTo!.messageId); }}
                                    className="block w-full text-left"
                                    aria-label={`Go to the message from ${msg.replyTo.senderName}`}
                                  >
                                    <ReplyQuote replyTo={msg.replyTo} isMe={isMe} />
                                  </button>
                                )}
                                {msg.type === 'file'
                                  ? <FileContent msg={msg} isMe={isMe} onOpen={() => { openStoredFile(`/messages/message/${msg._id}/open`).catch(() => toast('Could not open this file', 'error')); }} />
                                  : <span className="whitespace-pre-wrap">{msg.text}</span>}
                              </div>
                            )}
                            {!msg.deletedForEveryone && (
                              <ReactionChips
                                reactions={msg.reactions}
                                myId={myId}
                                align={isMe ? 'right' : 'left'}
                                onToggle={canInteract ? e => actions.react(msg, e) : undefined}
                              />
                            )}
                            <p className={`text-[11px] im-sub px-1 flex items-center gap-1 ${isMe ? 'justify-end' : ''}`}>
                              {msg.pinnedAt && <Icon name="pin" className="h-3 w-3 text-[#0a84ff]" />}
                              {msg.starred && <Icon name="star" className="h-3 w-3 text-amber-400" />}
                              {msg.editedAt && !msg.deletedForEveryone && <span>edited ·</span>}
                              {new Date(msg.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                              {isMe && <Ticks read={read} />}
                            </p>
                          </div>

                          {!isMe && !actions.selecting && (
                            <HoverActions
                              canReply={canInteract && !msg.deletedForEveryone}
                              onReply={() => startReply(msg)}
                              onMore={e => actions.openMenu(msg, e.clientX, e.clientY, false)}
                            />
                          )}
                        </div>
                        </MessageGesture>
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
                  🔒 This conversation is closed — that counsellor is no longer on your case.
                  You can still read the history here.
                </p>
              </div>
            ) : (
              <>
                <AttachmentTray
                  staged={staged}
                  onRemove={unstageFile}
                  onClear={clearStaged}
                  onAddMore={() => fileInputRef.current?.click()}
                  onSend={() => { void sendStaged(replyTo).then(ok => { if (ok && replyTo) setReplyTo(null); }); }}
                  sending={uploading}
                />

                {/* Reply / edit banner */}
                {(replyTo || editing) && (
                  <div className={`flex-shrink-0 px-4 sm:px-6 pt-2 im-chrome ${staged.length ? '' : 'border-t'}`}>
                    <div className="flex items-center gap-2 im-quote border-l-2 border-[#0a84ff] rounded-lg pl-3 pr-1 py-1">
                      <Icon name={editing ? 'edit' : 'reply'} className="h-4 w-4 shrink-0 text-[#0a84ff]" />
                      <button
                        type="button"
                        onClick={() => actions.jump((editing ?? replyTo)!._id)}
                        className="flex-1 min-w-0 py-1 text-left"
                      >
                        <p className="text-xs font-semibold text-[#0a84ff]">
                          {editing ? 'Editing message' : `Replying to ${replyTo!.senderName}`}
                        </p>
                        <p className="text-xs im-sub truncate">{msgPreview((editing ?? replyTo)!)}</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => (editing ? cancelEdit() : setReplyTo(null))}
                        aria-label={editing ? 'Cancel editing' : 'Cancel reply'}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg im-sub hover:opacity-70"
                      >
                        <Icon name="close" className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}

                <form
                  onSubmit={handleSend}
                  className={`flex-shrink-0 px-4 sm:px-6 py-3 im-chrome flex items-center gap-2 ${replyTo || editing || staged.length ? '' : 'border-t'}`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFileChange}
                    accept={ACCEPT}
                    multiple
                  />

                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach files — or drop them on the chat"
                    aria-label="Attach files"
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

                  <ComposerEmojiButton onPick={insertEmoji} />

                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={e => { if (e.key === 'Escape') { if (editing) cancelEdit(); else setReplyTo(null); } }}
                    placeholder={editing ? 'Edit message…' : 'Message your counsellor…'}
                    className="flex-1 im-field rounded-full px-4 py-2.5 text-sm focus:outline-none focus:border-[#0a84ff] transition"
                  />
                  <button
                    type="submit"
                    disabled={(!input.trim() && !staged.length) || sending || uploading}
                    aria-label="Send"
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
      {actions.overlays}
    </AppShell>
  );
}
