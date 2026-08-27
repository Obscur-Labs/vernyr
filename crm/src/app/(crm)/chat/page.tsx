'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import api from '@/lib/api';
import { fileHref } from '@/lib/media';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/context/ToastContext';
import type { Conversation, ConversationParticipant, Message, Student, DocType, FormField } from '@/types';
import { DocRequestCard, FormRequestCard, FormResponseCard, ReplyQuote, Ticks } from '@/components/chat/MessageCards';
import { RequestDocsModal, RequestFormModal } from '@/components/chat/RequestModals';
import {
  ChatIcon, ClipboardIcon, DocumentTextIcon, EyeIcon, InboxIcon, LockIcon,
  PaperclipIcon, PlusIcon,
} from '@/components/icons';

import { apiOrigin, apiUrl } from '@/lib/config';

/* ─── helpers ─────────────────────────────────────────────────────────────── */
function getOther(conv: Conversation, myId: string) {
  return conv.participants.find(p => p._id !== myId) ?? conv.participants[0];
}

/**
 * A conversation is a room around one student's case: the student on one side,
 * the counsellor working it on the other. Naming it after "the other
 * participant" only reads correctly for the two people in it — an admin
 * observing sees whichever of them happens to sort first. So the room is
 * described by who is *in* it, not by who the viewer is not.
 */
interface Room {
  /** The case this room is about. */
  title: string;
  student?: ConversationParticipant;
  /** Staff side — the counsellor, or whoever else holds the case. */
  staff?: ConversationParticipant;
  /** Everyone, student first, for avatars and the participant line. */
  members: ConversationParticipant[];
}

function getRoom(conv: Conversation, myId: string): Room {
  const student = conv.participants.find(p => p.role === 'student');
  const staff   = conv.participants.find(p => p.role === 'counsellor')
    ?? conv.participants.find(p => p._id !== student?._id);

  // The Student record's name wins over the login's: the account may be named
  // after whoever opened it, the record is named after the applicant.
  const title = conv.studentId?.personal?.name
    ?? student?.name
    ?? getOther(conv, myId)?.name
    ?? 'Conversation';

  const members = [student, staff].filter(Boolean) as ConversationParticipant[];
  const rest = conv.participants.filter(p => !members.some(m => m._id === p._id));

  return { title, student, staff, members: [...members, ...rest] };
}

/** "Priya Nair & Sam Okafor" — who is in the room, in one line. */
const roomMembers = (room: Room) => room.members.map(m => m.name).join('  ·  ');

function getInitials(name: string) {
  return (name ?? '?').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yest = new Date(today); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function shortPreview(text?: string) {
  if (!text) return '';
  return text.length > 45 ? text.slice(0, 42) + '…' : text;
}

/** One-line preview of any message (for reply quotes) */
function msgPreview(msg: Message): string {
  if (msg.type === 'file')             return msg.fileName ?? 'File';
  if (msg.type === 'document_request') return 'Documents requested';
  if (msg.type === 'form_request')     return msg.meta?.title ?? 'Details requested';
  if (msg.type === 'form_response')    return 'Details submitted';
  return msg.text ?? '';
}

function senderIdOf(msg: Message): string {
  return typeof msg.senderId === 'object' ? (msg.senderId as { _id: string })._id : msg.senderId;
}

/* ─── FileMessage bubble content ──────────────────────────────────────────── */
function FileContent({ msg, isMe }: { msg: Message; isMe: boolean }) {
  const ext    = msg.fileName?.split('.').pop()?.toLowerCase() ?? '';
  const isImg  = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
  const href   = fileHref(msg.fileUrl);

  if (isImg) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={href} alt={msg.fileName} className="max-w-[200px] rounded-lg" />
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isMe ? 'bg-white/20' : 'bg-accent/15'}`}>
        <svg viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 ${isMe ? 'text-white' : 'text-accent'}`}>
          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd"/>
        </svg>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium truncate max-w-[150px]">{msg.fileName}</p>
        <p className={`text-xs ${isMe ? 'text-white/70' : 'text-t3'}`}>Click to open</p>
      </div>
    </a>
  );
}

/* ─── Room avatars ────────────────────────────────────────────────────────── */
/** Two overlapping discs — the visual shorthand for "a room, not a person". */
function RoomAvatars({ room, online, size = 40 }: { room: Room; online?: boolean; size?: number }) {
  const [first, second] = room.members;
  const small = Math.round(size * 0.66);

  return (
    <div className="relative flex-shrink-0" style={{ width: size + small * 0.45, height: size }}>
      <div
        className="absolute left-0 top-0 rounded-full bg-accent/20 text-accent font-bold flex items-center justify-center"
        style={{ width: size, height: size, fontSize: size * 0.32 }}
      >
        {first ? getInitials(first.name) : '?'}
      </div>
      {second && (
        <div
          className="absolute rounded-full bg-muted text-t2 font-bold flex items-center justify-center ring-2 ring-surface"
          style={{
            width: small, height: small, fontSize: small * 0.36,
            left: size * 0.62, top: size - small,
          }}
          title={second.name}
        >
          {getInitials(second.name)}
        </div>
      )}
      {online && (
        <span
          className="absolute rounded-full bg-emerald-500 ring-2 ring-surface"
          style={{ width: 10, height: 10, left: size * 0.72, top: -1 }}
        />
      )}
    </div>
  );
}

/* ─── Skeletons ───────────────────────────────────────────────────────────── */
function ConvSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5 border-b border-line">
          <div className="w-10 h-10 rounded-full bg-muted animate-pulse flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-muted animate-pulse rounded w-2/5" />
            <div className="h-2.5 bg-muted animate-pulse rounded w-3/5" />
          </div>
        </div>
      ))}
    </>
  );
}

function MsgSkeleton() {
  return (
    <div className="space-y-4 px-5 py-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={`flex gap-2 ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
          {i % 2 === 0 && <div className="w-7 h-7 rounded-full bg-muted animate-pulse flex-shrink-0 self-end" />}
          <div className={`h-10 bg-muted animate-pulse rounded-2xl ${i % 2 === 0 ? 'w-52 rounded-bl-md' : 'w-44 rounded-br-md'}`} />
        </div>
      ))}
    </div>
  );
}

/* ─── Main chat inner component ───────────────────────────────────────────── */
function ChatInner() {
  const { user } = useAuthStore();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const withUserId   = searchParams.get('with');

  const [conversations,  setConversations]  = useState<Conversation[]>([]);
  const [activeConv,     setActiveConv]     = useState<Conversation | null>(null);
  const [messages,       setMessages]       = useState<Message[]>([]);
  const [input,          setInput]          = useState('');
  const [loading,        setLoading]        = useState(true);
  const [msgLoading,     setMsgLoading]     = useState(false);
  const [sending,        setSending]        = useState(false);
  const [uploading,      setUploading]      = useState(false);
  const [otherTyping,    setOtherTyping]    = useState(false);
  const [isTyping,       setIsTyping]       = useState(false);
  const [search,         setSearch]         = useState('');
  const [mobileView,     setMobileView]     = useState<'list' | 'messages'>('list');
  const [onlineIds,      setOnlineIds]      = useState<Set<string>>(new Set());
  const [replyTo,        setReplyTo]        = useState<Message | null>(null);
  const [plusOpen,       setPlusOpen]       = useState(false);
  const [docsModal,      setDocsModal]      = useState(false);
  const [formModal,      setFormModal]      = useState(false);
  const [modalBusy,      setModalBusy]      = useState(false);
  const [studentRec,     setStudentRec]     = useState<Student | null>(null);
  const [zipBusy,        setZipBusy]        = useState(false);

  const socketRef      = useRef<Socket | null>(null);
  const bottomRef      = useRef<HTMLDivElement>(null);
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const inputRef       = useRef<HTMLInputElement>(null);
  const typingTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeConvRef  = useRef<string | null>(null);

  const myId = user?._id ?? '';
  // The admin observes every conversation but cannot take part in one.
  const readOnly = !!user && user.role === 'admin';

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
  }, []);

  const markRead = useCallback((convId: string) => {
    if (readOnly) return;   // observers never mark anything read
    api.post(`/messages/${convId}/read`).catch(() => {});
  }, [readOnly]);

  /* ── Load conversations on mount ───────────────────────────────────────── */
  useEffect(() => {
    api.get<Conversation[]>('/messages/conversations')
      .then(res => {
        setConversations(res.data);
        if (withUserId) {
          const existing = res.data.find(c =>
            c.participants.some(p => p._id === withUserId)
          );
          if (existing) {
            openConversation(existing);
          } else {
            api.post<Conversation>('/messages/conversation', { participantId: withUserId })
              .then(() => api.get<Conversation[]>('/messages/conversations'))
              .then(res2 => {
                setConversations(res2.data);
                const found = res2.data.find(c =>
                  c.participants.some(p => p._id === withUserId)
                );
                if (found) openConversation(found);
              })
              .catch(() => toast('Could not open conversation', 'error'));
          }
        }
      })
      .catch(() => toast('Could not load conversations', 'error'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withUserId]);

  /* ── Socket connection ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!user) return;
    const token  = localStorage.getItem('crm_token');
    const socket = io(apiOrigin, { auth: { token } });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('get_presence', (online: string[]) => setOnlineIds(new Set(online)));
      if (activeConvRef.current) socket.emit('join_room', activeConvRef.current);
    });

    socket.on('presence', ({ userId, online }: { userId: string; online: boolean }) => {
      setOnlineIds(prev => {
        const next = new Set(prev);
        if (online) next.add(userId); else next.delete(userId);
        return next;
      });
    });

    socket.on('receive_message', (msg: Message) => {
      const cid = msg.conversationId;

      setConversations(prev => {
        const idx = prev.findIndex(c => c._id === cid);
        if (idx === -1) return prev;
        const updated: Conversation = {
          ...prev[idx],
          lastMessage: {
            text:      msgPreview(msg),
            senderId:  senderIdOf(msg),
            createdAt: msg.createdAt,
          },
          updatedAt: msg.createdAt,
        };
        return [updated, ...prev.filter((_, i) => i !== idx)];
      });

      if (activeConvRef.current === cid) {
        setMessages(prev => prev.some(m => m._id === msg._id) ? prev : [...prev, msg]);
        // I'm looking at this conversation, so anything arriving is read
        if (senderIdOf(msg) !== myId) markRead(cid);
        scrollToBottom();
      }
    });

    socket.on('message_updated', (msg: Message) => {
      if (activeConvRef.current === msg.conversationId) {
        setMessages(prev => prev.map(m => m._id === msg._id ? { ...m, ...msg } : m));
      }
    });

    socket.on('messages_read', ({ conversationId, userId }: { conversationId: string; userId: string }) => {
      if (activeConvRef.current === conversationId && userId !== myId) {
        setMessages(prev => prev.map(m =>
          m.readBy?.includes(userId) ? m : { ...m, readBy: [...(m.readBy ?? []), userId] }
        ));
      }
    });

    socket.on('typing', ({ userId, isTyping: t }: { userId: string; isTyping: boolean }) => {
      if (userId !== myId) setOtherTyping(t);
    });

    // Counsellor reassignment: refresh the list and pick up archived flags
    socket.on('conversations_changed', () => {
      api.get<Conversation[]>('/messages/conversations').then(res => {
        setConversations(res.data);
        const cur = res.data.find(c => c._id === activeConvRef.current);
        if (cur) setActiveConv(prev => (prev ? { ...prev, archived: cur.archived } : prev));
      }).catch(() => {});
    });

    socket.on('conversation_archived', ({ conversationId }: { conversationId: string }) => {
      setConversations(prev => prev.map(c => c._id === conversationId ? { ...c, archived: true } : c));
      if (activeConvRef.current === conversationId) {
        setActiveConv(prev => (prev ? { ...prev, archived: true } : prev));
      }
    });

    return () => { socket.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /* ── Open a conversation ───────────────────────────────────────────────── */
  const openConversation = useCallback((conv: Conversation) => {
    if (activeConvRef.current && socketRef.current) {
      socketRef.current.emit('leave_room', activeConvRef.current);
    }
    setActiveConv(conv);
    activeConvRef.current = conv._id;
    setOtherTyping(false);
    setReplyTo(null);
    setPlusOpen(false);
    setMessages([]);
    setMsgLoading(true);
    setMobileView('messages');

    if (socketRef.current) socketRef.current.emit('join_room', conv._id);

    api.get<Message[]>(`/messages/${conv._id}`)
      .then(res => { setMessages(res.data); scrollToBottom(); markRead(conv._id); })
      .catch(() => toast('Could not load messages', 'error'))
      .finally(() => setMsgLoading(false));
  }, [scrollToBottom, toast, markRead]);

  /* ── Resolve Student record for the open conversation ──────────────────── */
  useEffect(() => {
    setStudentRec(null);
    if (!activeConv) return;
    const other = getOther(activeConv, myId);
    if (!other || other.role !== 'student') return;
    api.get<Student>(`/students/by-user/${other._id}`)
      .then(res => setStudentRec(res.data))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConv?._id]);

  /* ── Typing helpers ────────────────────────────────────────────────────── */
  function emitTyping(active: boolean) {
    if (!activeConvRef.current || !socketRef.current) return;
    socketRef.current.emit('typing', { roomId: activeConvRef.current, userId: myId, isTyping: active });
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInput(e.target.value);
    if (!isTyping) { setIsTyping(true); emitTyping(true); }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => { setIsTyping(false); emitTyping(false); }, 1500);
  }

  /* ── Send text (optionally as a reply) ─────────────────────────────────── */
  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !activeConv) return;
    const text = input.trim();
    const reply = replyTo;
    setInput('');
    setReplyTo(null);
    setSending(true);
    emitTyping(false);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    try {
      await api.post('/messages/send', {
        conversationId: activeConv._id,
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
    if (!file || !activeConv) return;
    setUploading(true);
    try {
      const form  = new FormData();
      form.append('file', file);
      form.append('conversationId', activeConv._id);
      const token = localStorage.getItem('crm_token');
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

  /* ── Request documents ─────────────────────────────────────────────────── */
  async function handleRequestDocs(items: Array<{ type: DocType; label: string; note?: string }>) {
    if (!activeConv || !studentRec) return;
    setModalBusy(true);
    try {
      await api.post('/documents/requests', {
        studentId: studentRec._id,
        items,
        conversationId: activeConv._id,
      });
      setDocsModal(false);
      toast('Document request sent', 'success');
    } catch {
      toast('Failed to send request', 'error');
    } finally {
      setModalBusy(false);
    }
  }

  /* ── Request details (form) ────────────────────────────────────────────── */
  async function handleRequestForm(title: string, fields: FormField[]) {
    if (!activeConv) return;
    setModalBusy(true);
    try {
      await api.post('/messages/send', {
        conversationId: activeConv._id,
        type: 'form_request',
        text: title,
        meta: { title, fields },
      });
      setFormModal(false);
      toast('Form sent', 'success');
    } catch {
      toast('Failed to send form', 'error');
    } finally {
      setModalBusy(false);
    }
  }

  /* ── Cancel a document request item ────────────────────────────────────── */
  async function handleCancelRequest(requestId: string) {
    try {
      await api.put(`/documents/requests/${requestId}/cancel`);
      toast('Request cancelled', 'success');
    } catch {
      toast('Failed to cancel request', 'error');
    }
  }

  /* ── Download all documents as ZIP ─────────────────────────────────────── */
  async function handleDownloadZip() {
    if (!studentRec) return;
    setZipBusy(true);
    try {
      const token = localStorage.getItem('crm_token');
      const res = await fetch(`${apiUrl}/documents/download-all/${studentRec._id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 404) { toast('No documents uploaded yet', 'info'); return; }
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${studentRec.personal.name.replace(/\s+/g, '_')}_documents.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast('Failed to download documents', 'error');
    } finally {
      setZipBusy(false);
    }
  }

  /* ── Derived ───────────────────────────────────────────────────────────── */
  const filtered = conversations.filter(conv => {
    if (!search.trim()) return true;
    const room = getRoom(conv, myId);
    const haystack = [room.title, ...room.members.map(m => m.name)].join(' ').toLowerCase();
    return haystack.includes(search.toLowerCase());
  });

  const activeRoom       = activeConv ? getRoom(activeConv, myId) : null;
  const otherParticipant = activeConv ? getOther(activeConv, myId) : null;
  const otherOnline      = otherParticipant ? onlineIds.has(otherParticipant._id) : false;
  const isClosed         = !!activeConv?.archived;

  /* ─────────────────────────────────────────────────────────────────────── */
  return (
    <div className="flex h-full overflow-hidden">

      {/* ══ Conversation sidebar ═════════════════════════════════════════════ */}
      <div className={`
        ${mobileView === 'messages' ? 'hidden' : 'flex'} lg:flex
        flex-col w-full lg:w-72 xl:w-80 border-r border-line flex-shrink-0 bg-surface
      `}>
        <div className="px-4 pt-5 pb-3 border-b border-line space-y-3">
          <h1 className="text-lg font-bold text-t1">Chat</h1>
          <div className="relative">
            <svg viewBox="0 0 20 20" fill="currentColor" className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-t3 pointer-events-none">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search students…"
              className="w-full bg-muted border border-line rounded-xl pl-8 pr-3 py-2 text-sm text-t1 placeholder:text-t3 focus:outline-none focus:border-accent transition"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <ConvSkeleton />
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-16 px-6">
              <InboxIcon className="w-7 h-7 text-t3/70 mb-3" />
              <p className="text-sm font-medium text-t2">No conversations yet</p>
              <p className="text-xs text-t3 mt-1 leading-relaxed">
                Open a student's profile and click&nbsp;<strong>Chat</strong> to start a conversation.
              </p>
            </div>
          ) : (
            filtered.map(conv => {
              const room     = getRoom(conv, myId);
              const other    = getOther(conv, myId);
              const isActive = activeConv?._id === conv._id;
              const lastText = conv.lastMessage?.text;
              const lastTime = conv.lastMessage?.createdAt
                ? fmtTime(conv.lastMessage.createdAt)
                : '';
              const online = other ? onlineIds.has(other._id) : false;

              return (
                <button
                  key={conv._id}
                  onClick={() => openConversation(conv)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors border-b border-line last:border-0 ${
                    isActive
                      ? 'bg-accent/10 border-l-[3px] border-l-accent'
                      : 'hover:bg-muted'
                  }`}
                >
                  <RoomAvatars room={room} online={online} size={40} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p className={`text-sm font-semibold truncate ${isActive ? 'text-accent' : 'text-t1'}`}>
                        {room.title}
                      </p>
                      {conv.archived ? (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-t3 bg-muted border border-line rounded-full px-2 py-0.5 flex-shrink-0">Closed</span>
                      ) : lastTime && (
                        <span className="text-[11px] text-t3 flex-shrink-0">{lastTime}</span>
                      )}
                    </div>
                    {/* Who is in the room — the line that makes it a room and
                        not just a thread with whoever is not me. */}
                    <p className="text-[11px] text-t3 truncate mt-0.5">
                      {room.staff ? `with ${room.staff.name}` : 'no counsellor assigned'}
                    </p>
                    <p className="text-xs text-t3 truncate mt-0.5">
                      {shortPreview(lastText) || 'No messages yet'}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ══ Message pane ═════════════════════════════════════════════════════ */}
      <div className={`
        ${mobileView === 'list' ? 'hidden' : 'flex'} lg:flex
        flex-col flex-1 min-w-0 im-thread
      `}>
        {!activeConv ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="w-16 h-16 rounded-2xl bg-accent/15 flex items-center justify-center mb-4">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-accent">
                <path fillRule="evenodd" d="M4.848 2.771A49.144 49.144 0 0112 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 01-3.476.383.39.39 0 00-.297.17l-2.755 4.133a.75.75 0 01-1.248 0l-2.755-4.133a.39.39 0 00-.297-.17 48.9 48.9 0 01-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.68 3.348-3.97z" clipRule="evenodd"/>
              </svg>
            </div>
            <p className="text-t1 font-semibold text-base">Select a conversation</p>
            <p className="text-t3 text-sm mt-1.5 max-w-xs leading-relaxed">
              Choose a student from the list, or open their profile and click <strong className="text-t2">Chat</strong> to start.
            </p>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b im-chrome flex-shrink-0">
              <button
                onClick={() => setMobileView('list')}
                className="lg:hidden p-1.5 rounded-lg text-t2 hover:bg-muted -ml-1 flex-shrink-0"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd"/>
                </svg>
              </button>
              {activeRoom && <RoomAvatars room={activeRoom} online={otherOnline} size={38} />}

              <div className="flex-1 min-w-0">
                <p className="font-semibold text-t1 text-sm leading-tight truncate">
                  {activeRoom?.title ?? 'Conversation'}
                </p>
                {/* Both names, always — the room is the pair, and an observer
                    needs to see whose case they are reading. */}
                <p className="text-[11px] im-sub truncate mt-0.5">
                  {activeRoom ? roomMembers(activeRoom) : ''}
                </p>
                <p className="text-xs text-t3">
                  {isClosed
                    ? <span className="im-sub">room closed</span>
                    : otherTyping
                      ? <span className="text-accent">typing…</span>
                      : otherOnline
                        ? <span className="text-emerald-500">online</span>
                        : <span className="im-sub">offline</span>}
                </p>
              </div>

              {/* Role chips — who is who, without reading the names twice. */}
              {activeRoom && (
                <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                  {activeRoom.student && (
                    <span className="chip chip-student" title={activeRoom.student.name}>Student</span>
                  )}
                  {activeRoom.staff && (
                    <span className="chip chip-counsellor" title={activeRoom.staff.name}>Counsellor</span>
                  )}
                </div>
              )}
              {/* Download-all-documents ZIP */}
              {studentRec && (
                <button
                  onClick={handleDownloadZip}
                  disabled={zipBusy}
                  title="Download all documents as ZIP"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-line text-t2 hover:text-accent hover:border-accent/40 text-xs font-semibold transition disabled:opacity-40 flex-shrink-0"
                >
                  {zipBusy ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd"/>
                    </svg>
                  )}
                  <span className="hidden sm:inline">All docs (.zip)</span>
                </button>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto scroll-smooth overscroll-contain px-4 sm:px-5 py-4 space-y-1 min-h-0">
              {msgLoading ? (
                <MsgSkeleton />
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-16">
                  <ChatIcon className="w-8 h-8 im-sub mb-3" />
                  <p className="text-t2 font-medium">No messages yet</p>
                  <p className="text-t3 text-sm mt-1">Send the first message!</p>
                </div>
              ) : (
                <>
                  {messages.map((msg, idx) => {
                    const sid    = senderIdOf(msg);
                    const isMe   = sid === myId;
                    const showDate = idx === 0 ||
                      new Date(msg.createdAt).toDateString() !== new Date(messages[idx - 1].createdAt).toDateString();
                    const read = !!(otherParticipant && msg.readBy?.includes(otherParticipant._id));
                    const isCard = msg.type === 'document_request' || msg.type === 'form_request' || msg.type === 'form_response';

                    if (msg.type === 'system') {
                      return (
                        <div key={msg._id} className="flex justify-center my-3">
                          <span className="text-[11px] font-semibold im-sub px-3 py-1">{msg.text}</span>
                        </div>
                      );
                    }

                    return (
                      <div key={msg._id}>
                        {showDate && (
                          <div className="flex justify-center my-3">
                            <span className="text-[11px] font-semibold im-sub px-3 py-1 animate-chip-in">
                              {fmtDate(msg.createdAt)}
                            </span>
                          </div>
                        )}
                        <div className={`group flex ${isMe ? 'justify-end animate-msg-right' : 'justify-start animate-msg-left'} gap-2 py-1`}>
                          {/* Reply button (left of my bubbles) */}
                          {isMe && !readOnly && (
                            <button
                              onClick={() => { setReplyTo(msg); inputRef.current?.focus(); }}
                              title="Reply"
                              className="self-center opacity-0 group-hover:opacity-100 transition text-t3 hover:text-accent p-1"
                            >
                              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/>
                              </svg>
                            </button>
                          )}

                          <div className={`${isCard ? '' : 'max-w-[70%]'} space-y-0.5`}>
                            {isCard ? (
                              <>
                                {msg.type === 'document_request' && (
                                  <DocRequestCard msg={msg} isMe={isMe} onCancelItem={isMe ? handleCancelRequest : undefined} />
                                )}
                                {msg.type === 'form_request'  && <FormRequestCard  msg={msg} isMe={isMe} />}
                                {msg.type === 'form_response' && <FormResponseCard msg={msg} isMe={isMe} />}
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
                              {fmtTime(msg.createdAt)}
                              {isMe && <Ticks read={read} onAccent={false} />}
                            </p>
                          </div>

                          {/* Reply button (right of their bubbles) */}
                          {!isMe && !readOnly && (
                            <button
                              onClick={() => { setReplyTo(msg); inputRef.current?.focus(); }}
                              title="Reply"
                              className="self-center opacity-0 group-hover:opacity-100 transition text-t3 hover:text-accent p-1"
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

                  {otherTyping && (
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

            {/* Composer — replaced by a notice when the conversation is closed, or when an admin is observing */}
            {isClosed || readOnly ? (
              readOnly && !isClosed ? (
              <div className="flex-shrink-0 px-4 sm:px-5 py-4 im-chrome border-t">
                <p className="flex items-center justify-center gap-2 text-sm im-sub text-center leading-relaxed">
                  <EyeIcon className="w-4 h-4 shrink-0" />
                  Read-only — you are viewing this conversation as an admin.
                  Replying is left to the counsellor working the case.
                </p>
              </div>
              ) : (
              <div className="flex-shrink-0 px-4 sm:px-5 py-4 im-chrome border-t">
                <p className="flex items-center justify-center gap-2 text-sm im-sub text-center leading-relaxed">
                  <LockIcon className="w-4 h-4 shrink-0" />
                  This conversation is closed — the student was reassigned to another counsellor.
                  The history stays available.
                </p>
              </div>
              )
            ) : (
            <>
            {/* Reply banner */}
            {replyTo && (
              <div className="flex-shrink-0 px-4 sm:px-5 pt-2 im-chrome border-t">
                <div className="flex items-center gap-2 im-quote border-l-2 border-[#0a84ff] rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#0a84ff]">Replying to {replyTo.senderName}</p>
                    <p className="text-xs im-sub truncate">{msgPreview(replyTo)}</p>
                  </div>
                  <button onClick={() => setReplyTo(null)} className="im-sub hover:opacity-70 text-lg leading-none px-1">×</button>
                </div>
              </div>
            )}

            {/* Input bar */}
            <form
              onSubmit={handleSend}
              className={`flex-shrink-0 px-4 sm:px-5 py-3 im-chrome flex items-center gap-2 relative ${replyTo ? '' : 'border-t'}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileChange}
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
              />

              {/* Plus (attach / request) menu */}
              <div className="relative flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setPlusOpen(v => !v)}
                  title="Attach or request"
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition ${
                    plusOpen ? 'bg-accent text-white rotate-45' : 'text-t3 hover:text-t1 hover:bg-muted'
                  }`}
                >
                  <PlusIcon className="w-5 h-5" />
                </button>
                {plusOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setPlusOpen(false)} />
                    <div className="overlay-panel animate-popover-in absolute bottom-12 left-0 z-40 w-56 origin-bottom-left overflow-hidden rounded-2xl">
                      <button
                        type="button"
                        onClick={() => { setPlusOpen(false); fileInputRef.current?.click(); }}
                        disabled={uploading}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-t1 hover:bg-muted transition text-left"
                      >
                        <PaperclipIcon className="w-[18px] h-[18px] text-t3 shrink-0" />
                        <span><span className="font-semibold block">Send file</span><span className="text-xs text-t3">Image, PDF, DOC…</span></span>
                      </button>
                      {studentRec && (
                        <button
                          type="button"
                          onClick={() => { setPlusOpen(false); setDocsModal(true); }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-t1 hover:bg-muted transition text-left border-t border-line"
                        >
                          <ClipboardIcon className="w-[18px] h-[18px] text-t3 shrink-0" />
                          <span><span className="font-semibold block">Request documents</span><span className="text-xs text-t3">Student uploads to their profile</span></span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { setPlusOpen(false); setFormModal(true); }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-t1 hover:bg-muted transition text-left border-t border-line"
                      >
                        <DocumentTextIcon className="w-[18px] h-[18px] text-t3 shrink-0" />
                        <span><span className="font-semibold block">Request details</span><span className="text-xs text-t3">In-chat form the student fills</span></span>
                      </button>
                    </div>
                  </>
                )}
              </div>

              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={handleInputChange}
                placeholder="Message…"
                className="flex-1 im-field rounded-full px-4 py-2.5 text-sm focus:outline-none focus:border-[#0a84ff] transition"
              />
              <button
                type="submit"
                disabled={!input.trim() || sending}
                className="w-10 h-10 rounded-full im-send flex items-center justify-center disabled:opacity-40 transition active:scale-95 flex-shrink-0"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 -rotate-45">
                  <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/>
                </svg>
              </button>
            </form>
            </>
            )}
          </>
        )}
      </div>

      {/* ══ Modals ═══════════════════════════════════════════════════════════ */}
      {docsModal && (
        <RequestDocsModal onClose={() => setDocsModal(false)} onSubmit={handleRequestDocs} busy={modalBusy} />
      )}
      {formModal && (
        <RequestFormModal onClose={() => setFormModal(false)} onSubmit={handleRequestForm} busy={modalBusy} />
      )}
    </div>
  );
}

/* ─── Page wrapper (Suspense for useSearchParams) ──────────────────────────── */
export default function ChatPage() {
  return (
    <div className="h-full overflow-hidden">
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-full">
            <p className="text-t3 text-sm">Loading…</p>
          </div>
        }
      >
        <ChatInner />
      </Suspense>
    </div>
  );
}
