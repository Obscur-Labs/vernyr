import { Router, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import Message from '../models/Message';
import Conversation from '../models/Conversation';
import User from '../models/User';
import { authenticate, can, may, AuthRequest } from '../middleware/auth';
import { upload, requireCloudinary } from '../middleware/upload';
import { uploadBuffer, mediaFolders } from '../config/cloudinary';
import { getIo } from '../socket/emitter';
import { isUserViewing } from '../socket';
import { notify } from '../utils/notify';
import { attachAccounts, findAccountById, lastSeenOf } from '../services/accounts';
import { ownsStudentRow } from '../services/scope';
import { serverError } from '../utils/httpError';

const router = Router();

/**
 * Membership check, run before anything is written into a thread.
 *
 * `can('chat','create')` says the caller may send messages; it never said
 * *where*. Every write route below took a conversation id from the client and
 * checked only that the row existed, so a signed-in student could post into,
 * and read the replies of, any conversation whose id they could guess.
 *
 * Returns true when the caller may write to it, and answers the request itself
 * otherwise.
 */
async function openThreadFor(
  req: AuthRequest,
  res: Response,
  conversationId: unknown,
): Promise<boolean> {
  if (!mongoose.isValidObjectId(String(conversationId ?? ''))) {
    res.status(400).json({ message: 'A valid conversationId is required' });
    return false;
  }
  const conv = await Conversation.findById(String(conversationId)).select('archived participants');
  if (!conv) { res.status(404).json({ message: 'Conversation not found' }); return false; }
  if (conv.archived) { res.status(403).json({ message: 'This conversation is closed' }); return false; }
  if (!conv.participants.some((p) => p.toString() === req.user!.id)) {
    res.status(403).json({ message: 'Not a participant of this conversation' });
    return false;
  }
  return true;
}

/**
 * Who a caller may open a thread with. Chat is between a student and the staff
 * working their case — a student opening one with another student was never
 * intended, and nothing stopped it.
 */
async function canOpenWith(req: AuthRequest, participantId: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(participantId) || participantId === req.user!.id) return false;
  const other = await findAccountById(participantId);
  if (!other?.isActive) return false;
  // A portal account only ever talks to staff, never to another portal account.
  return !(req.principal!.kind === 'portal' && other.kind === 'portal');
}

/**
 * Chat is between a student and the counsellor working their case. An observer
 * is anyone holding Read on the chat module without Send — the admin seat by
 * default, and any preset configured that way. They see every conversation for
 * oversight and cannot become a participant in one.
 *
 * That used to be a hard-coded list of roles here. It is a switch on the access
 * matrix now, so the rule is visible to whoever is allowed to change it.
 */
export const isChatObserver = (req: AuthRequest) => !may(req, 'chat', 'create');

// Everything under /api/messages needs the chat module at minimum.
router.use(authenticate, can('chat', 'read'), (req: AuthRequest, res: Response, next: NextFunction) => {
  // Belt to the per-route braces below: an observer never writes to chat,
  // whichever verb a future route happens to use.
  if (isChatObserver(req) && req.method !== 'GET') {
    res.status(403).json({
      message: 'Your role can read conversations but not take part in them',
    });
    return;
  }
  next();
});

// ── Conversations ────────────────────────────────────────────────────────────

router.get('/conversations', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // An observer sees every conversation; everyone else sees their own.
    const scope = isChatObserver(req) ? {} : { participants: req.user!.id };
    const conversations = await Conversation.find(scope)
      .populate('studentId', 'personal')
      .sort('-updatedAt')
      .lean();
    await attachAccounts(conversations, ['participants', 'lastMessage.senderId']);

    // Per-conversation unread counts (messages from others I haven't read)
    const uid = new mongoose.Types.ObjectId(req.user!.id);
    const counts = await Message.aggregate([
      { $match: {
        conversationId: { $in: conversations.map(c => c._id) },
        senderId: { $ne: uid },
        readBy: { $ne: uid },
        deletedForEveryone: { $ne: true },
        deletedFor: { $ne: uid },
      } },
      { $group: { _id: '$conversationId', n: { $sum: 1 } } },
    ]);
    const unreadById = new Map(counts.map(c => [c._id.toString(), c.n as number]));

    // "Unread" is meaningless for an observer — they are in no conversation.
    res.json(conversations.map(c => ({
      ...c,
      unread: isChatObserver(req) ? 0 : unreadById.get(c._id.toString()) ?? 0,
    })));
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/conversations', authenticate, can('chat', 'create'), async (req: AuthRequest, res: Response) => {
  try {
    // The caller is always one of the two, whatever the body claimed.
    const listed: unknown[] = Array.isArray(req.body?.participants) ? req.body.participants : [];
    const other = String(listed.find((x) => String(x) !== req.user!.id) ?? '');
    if (!(await canOpenWith(req, other))) {
      res.status(403).json({ message: 'You cannot start a conversation with that account' }); return;
    }
    const conversation = await Conversation.create({
      participants: [req.user!.id, other],
      studentId: req.body?.studentId,
    });
    res.status(201).json(conversation);
  } catch (err) {
    serverError(res, err);
  }
});

/** Find or create a 1-on-1 conversation between the caller and a participant */
router.post('/conversation', authenticate, can('chat', 'create'), async (req: AuthRequest, res: Response) => {
  const participantId = String(req.body?.participantId ?? '');
  const myId = req.user!.id;
  try {
    if (!(await canOpenWith(req, participantId))) {
      res.status(403).json({ message: 'You cannot start a conversation with that account' }); return;
    }
    let conv = await Conversation.findOne({
      participants: { $all: [myId, participantId], $size: 2 },
    });
    if (!conv) {
      conv = await Conversation.create({ participants: [myId, participantId], updatedAt: new Date() });
    }
    res.json(conv);
  } catch (err) {
    serverError(res, err);
  }
});

// ── Text / structured messages ────────────────────────────────────────────────

/** Human-readable preview for the conversation list */
function previewFor(type: string | undefined, text?: string, meta?: Record<string, unknown>): string {
  switch (type) {
    case 'form_request':  return (meta?.title as string) || 'Details requested';
    case 'form_response': return 'Details submitted';
    case 'document_request': return text || 'Documents requested';
    case 'file': return text || 'File';
    default: return text || '';
  }
}

router.post('/send', authenticate, can('chat', 'create'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { conversationId, text, type = 'text', meta, replyTo } = req.body;
  try {
    if (!(await openThreadFor(req, res, conversationId))) return;

    const message = await Message.create({
      conversationId,
      senderId:   req.user!.id,
      senderName: req.user!.name,
      type,
      text,
      meta,
      replyTo,
      readBy: [req.user!.id],
    });

    const preview = previewFor(type, text, meta);
    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: { text: preview, senderId: req.user!.id, createdAt: new Date(), readBy: [req.user!.id] },
      updatedAt: new Date(),
    });

    const io = getIo();
    if (io) io.to(conversationId).emit('receive_message', message.toObject());

    // Notify the other participants — but not anyone actively viewing this chat
    const conv = await Conversation.findById(conversationId);
    if (conv) {
      const others = conv.participants
        .map(p => p.toString())
        .filter(p => p !== req.user!.id && !isUserViewing(p, conversationId));
      const notifBody = preview.length > 120 ? preview.slice(0, 117) + '…' : preview;
      const isStudent = req.user!.role === 'student';
      if (others.length) notify(others, {
        type:  'message',
        title: `💬 ${req.user!.name}`,
        body:  notifBody,
        // staff land on the exact conversation; students only have their own chat
        link:  isStudent ? `/chat?with=${req.user!.id}` : '/chat',
      }).catch(() => {});
    }

    res.status(201).json(message);
  } catch (err) {
    serverError(res, err);
  }
});

// ── File upload in chat ───────────────────────────────────────────────────────
/**
 * POST /api/messages/send-file   (multipart/form-data)
 * Fields: file, conversationId, studentId? (required when student uploads so we
 *         also create a Document record for their profile)
 */
router.post('/send-file', authenticate, can('chat', 'create'), requireCloudinary, upload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.file) { res.status(400).json({ message: 'No file uploaded' }); return; }

  const { conversationId, studentId, voice, duration, replyTo } = req.body as Record<string, string>;
  if (!conversationId) { res.status(400).json({ message: 'conversationId is required' }); return; }

  if (!(await openThreadFor(req, res, conversationId))) return;

  const fileName = req.file.originalname;
  const isVoice  = voice === 'true';

  let asset;
  try {
    asset = await uploadBuffer(
      req.file,
      isVoice ? mediaFolders.chatVoice(conversationId) : mediaFolders.chatFiles(conversationId),
    );
  } catch (err) {
    console.error('Cloudinary upload failed:', err);
    res.status(502).json({ message: 'Upload to storage failed' }); return;
  }
  const fileUrl = asset.url;

  let parsedReply: { messageId: string; senderName: string; preview: string } | undefined;
  if (replyTo) { try { parsedReply = JSON.parse(replyTo); } catch { /* ignore malformed reply payloads */ } }

  try {
    // Create chat message
    const message = await Message.create({
      conversationId,
      senderId:   req.user!.id,
      senderName: req.user!.name,
      type:       'file',
      fileUrl,
      fileName,
      filePublicId:     asset.publicId,
      fileResourceType: asset.resourceType,
      meta: isVoice ? { voice: true, duration: duration ? Number(duration) : undefined } : undefined,
      replyTo: parsedReply,
      readBy: [req.user!.id],
    });

    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: { text: isVoice ? '🎤 Voice message' : `📎 ${fileName}`, senderId: req.user!.id, createdAt: new Date() },
      updatedAt: new Date(),
    });

    // If a studentId was provided (student uploading their own doc), also create a Document record
    // The Document record a chat upload also creates must land on the sender's
    // own student record, never on one named in the form field.
    if (studentId && !isVoice && await ownsStudentRow(req, studentId)) {
      const DocumentModel = (await import('../models/Document')).default;
      const now     = new Date();
      const version = {
        fileUrl,
        fileName,
        publicId:     asset.publicId,
        resourceType: asset.resourceType,
        uploadedAt:   now,
        uploadedBy:   new mongoose.Types.ObjectId(req.user!.id),
      };
      const existing = await DocumentModel.findOne({ studentId, type: 'other', label: fileName });
      if (existing) {
        existing.versions.push(version);
        existing.currentVersion = version;
        existing.status = 'uploaded';
        await existing.save();
      } else {
        await DocumentModel.create({
          studentId:      new mongoose.Types.ObjectId(studentId),
          type:           'other',
          label:          fileName,
          status:         'uploaded',
          currentVersion: version,
          versions:       [version],
        });
      }
    }

    // Emit real-time to other participants
    const io = getIo();
    if (io) io.to(conversationId).emit('receive_message', message.toObject());

    // Notify the other participants — but not anyone actively viewing this chat
    const conv = await Conversation.findById(conversationId);
    if (conv) {
      const others = conv.participants
        .map(p => p.toString())
        .filter(p => p !== req.user!.id && !isUserViewing(p, conversationId));

      const isStudent = req.user!.role === 'student';
      if (others.length) await notify(others, {
        type:  'document',
        title: isVoice
          ? `🎤 Voice message from ${req.user!.name}`
          : isStudent ? '📎 File Shared by Student' : '📎 File from Counsellor',
        body:  isVoice
          ? 'Tap to listen in chat'
          : isStudent
            ? `${req.user!.name} shared a file in chat: ${fileName}`
            : `Your counsellor shared a file: ${fileName}`,
        link:  isStudent ? `/chat?with=${req.user!.id}` : '/chat',
      });
    }

    res.status(201).json(message);
  } catch (err) {
    serverError(res, err);
  }
});

// ── Form responses (student answers a counsellor's in-chat form) ─────────────
/**
 * POST /api/messages/form-response
 * Body: { conversationId, formMessageId, answers: [{ id, label, value }] }
 */
router.post('/form-response', authenticate, can('chat', 'create'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { conversationId, formMessageId, answers } = req.body as {
    conversationId: string;
    formMessageId: string;
    answers: Array<{ id: string; label: string; value: string }>;
  };
  if (!conversationId || !formMessageId || !Array.isArray(answers)) {
    res.status(400).json({ message: 'conversationId, formMessageId and answers are required' }); return;
  }
  try {
    if (!(await openThreadFor(req, res, conversationId))) return;

    const formMsg = await Message.findById(formMessageId);
    // The form has to belong to the thread it is being answered in.
    if (!formMsg || formMsg.type !== 'form_request' || formMsg.conversationId.toString() !== String(conversationId)) {
      res.status(404).json({ message: 'Form request not found' }); return;
    }
    const formMeta = (formMsg.meta ?? {}) as { title?: string; answered?: boolean };
    if (formMeta.answered) { res.status(409).json({ message: 'Form already answered' }); return; }

    const response = await Message.create({
      conversationId,
      senderId:   req.user!.id,
      senderName: req.user!.name,
      type: 'form_response',
      meta: { formMessageId, title: formMeta.title, answers },
      readBy: [req.user!.id],
    });

    formMsg.meta = { ...formMeta, answered: true, responseId: response._id.toString() };
    formMsg.markModified('meta');
    await formMsg.save();

    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: { text: '📝 Details submitted', senderId: req.user!.id, createdAt: new Date() },
      updatedAt: new Date(),
    });

    const io = getIo();
    if (io) {
      io.to(conversationId).emit('receive_message', response.toObject());
      io.to(conversationId).emit('message_updated', formMsg.toObject());
    }

    const conv = await Conversation.findById(conversationId);
    if (conv) {
      const others = conv.participants.map(p => p.toString())
        .filter(p => p !== req.user!.id && !isUserViewing(p, conversationId));
      if (others.length) notify(others, {
        type:  'message',
        title: `📝 ${req.user!.name} submitted details`,
        body:  formMeta.title || 'Form response received',
        link:  `/chat?with=${req.user!.id}`,
      }).catch(() => {});
    }

    res.status(201).json(response);
  } catch (err) {
    serverError(res, err);
  }
});

// ── Read receipts ─────────────────────────────────────────────────────────────
/** POST /api/messages/:conversationId/read — mark everything in the conversation read */
router.post('/:conversationId/read', authenticate, can('chat', 'update'), async (req: AuthRequest, res: Response) => {
  try {
    if (!(await isParticipant(req.params.conversationId, req.user!.id))) {
      res.status(403).json({ message: 'Not a participant of this conversation' }); return;
    }
    await Message.updateMany(
      { conversationId: req.params.conversationId, readBy: { $ne: req.user!.id } },
      { $addToSet: { readBy: req.user!.id } },
    );
    const io = getIo();
    if (io) io.to(req.params.conversationId).emit('messages_read', {
      conversationId: req.params.conversationId,
      userId: req.user!.id,
    });
    res.json({ ok: true });
  } catch (err) {
    serverError(res, err);
  }
});

// ── Message actions ───────────────────────────────────────────────────────────

/** Authorization guard: is `userId` a participant of the conversation? */
async function isParticipant(conversationId: mongoose.Types.ObjectId | string, userId: string): Promise<boolean> {
  const conv = await Conversation.findById(conversationId).select('participants');
  return !!conv && conv.participants.some(p => p.toString() === userId);
}

/** Read guard: participants, plus observers who may read any conversation. */
async function canRead(req: AuthRequest, conversationId: mongoose.Types.ObjectId | string): Promise<boolean> {
  return isChatObserver(req) || isParticipant(conversationId, req.user!.id);
}

/** Strip content from "deleted for everyone" tombstones before sending to clients */
/** Accepts a document or a lean object — callers use both. */
function sanitize(msg: unknown): Record<string, unknown> {
  const src = msg as { toObject?: () => unknown };
  const obj = (typeof src.toObject === 'function' ? src.toObject() : msg) as Record<string, unknown>;
  if (obj.deletedForEveryone) {
    obj.text = '';
    delete obj.fileUrl; delete obj.fileName;
    delete obj.filePublicId; delete obj.fileResourceType;
    delete obj.meta; delete obj.replyTo; obj.reactions = [];
  }
  return obj;
}

/** GET /api/messages/last-seen/:userId — presence detail for chat headers */
router.get('/last-seen/:userId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // Presence is only visible for someone the caller shares a thread with.
    const shared = isChatObserver(req) || await Conversation.exists({
      participants: { $all: [req.user!.id, req.params.userId] },
    });
    if (!shared) { res.status(403).json({ message: 'Access denied' }); return; }
    const { isUserOnline } = await import('../socket');
    res.json({
      online: isUserOnline(req.params.userId),
      lastSeenAt: await lastSeenOf(req.params.userId),
    });
  } catch (err) {
    serverError(res, err);
  }
});

/** GET /api/messages/search/:conversationId?q= — text search within a conversation */
router.get('/search/:conversationId', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const q = (req.query.q as string | undefined)?.trim();
  if (!q) { res.json([]); return; }
  try {
    if (!(await canRead(req, req.params.conversationId))) {
      res.status(403).json({ message: 'Not a participant of this conversation' }); return;
    }
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = await Message.find({
      conversationId: req.params.conversationId,
      text: { $regex: escaped, $options: 'i' },
      deletedForEveryone: { $ne: true },
      deletedFor: { $ne: req.user!.id },
    }).sort('-createdAt').limit(50);
    res.json(matches);
  } catch (err) {
    serverError(res, err);
  }
});

/** PUT /api/messages/message/:id — edit own text message */
router.put('/message/:id', authenticate, can('chat', 'update'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { text } = req.body as { text?: string };
  if (!text?.trim()) { res.status(400).json({ message: 'text is required' }); return; }
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg) { res.status(404).json({ message: 'Message not found' }); return; }
    if (msg.senderId.toString() !== req.user!.id) { res.status(403).json({ message: 'You can only edit your own messages' }); return; }
    if (msg.type !== 'text' || msg.deletedForEveryone) { res.status(400).json({ message: 'This message cannot be edited' }); return; }

    msg.text = text.trim();
    msg.editedAt = new Date();
    await msg.save();

    const io = getIo();
    if (io) io.to(msg.conversationId.toString()).emit('message_updated', sanitize(msg));
    res.json(sanitize(msg));
  } catch (err) {
    serverError(res, err);
  }
});

/** DELETE /api/messages/message/:id?scope=me|everyone */
router.delete('/message/:id', authenticate, can('chat', 'delete'), async (req: AuthRequest, res: Response): Promise<void> => {
  const scope = req.query.scope === 'everyone' ? 'everyone' : 'me';
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg) { res.status(404).json({ message: 'Message not found' }); return; }

    if (scope === 'everyone') {
      if (msg.senderId.toString() !== req.user!.id) {
        res.status(403).json({ message: 'You can only delete your own messages for everyone' }); return;
      }
      msg.deletedForEveryone = true;
      await msg.save();
      const io = getIo();
      if (io) io.to(msg.conversationId.toString()).emit('message_updated', sanitize(msg));
    } else {
      await Message.findByIdAndUpdate(msg._id, { $addToSet: { deletedFor: req.user!.id } });
    }
    res.json({ ok: true, scope });
  } catch (err) {
    serverError(res, err);
  }
});

/** POST /api/messages/message/:id/react — toggle an emoji reaction */
router.post('/message/:id/react', authenticate, can('chat', 'update'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { emoji } = req.body as { emoji?: string };
  if (!emoji || emoji.length > 8) { res.status(400).json({ message: 'emoji is required' }); return; }
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg || msg.deletedForEveryone) { res.status(404).json({ message: 'Message not found' }); return; }
    if (!(await isParticipant(msg.conversationId, req.user!.id))) {
      res.status(403).json({ message: 'Not a participant of this conversation' }); return;
    }

    const mine = msg.reactions.find(r => r.userId.toString() === req.user!.id);
    let next = msg.reactions.filter(r => r.userId.toString() !== req.user!.id);
    if (!(mine && mine.emoji === emoji)) {
      next = [...next, { userId: new mongoose.Types.ObjectId(req.user!.id), emoji } as (typeof msg.reactions)[number]];
    }
    msg.set('reactions', next);
    await msg.save();

    const io = getIo();
    if (io) io.to(msg.conversationId.toString()).emit('message_updated', sanitize(msg));
    res.json(sanitize(msg));
  } catch (err) {
    serverError(res, err);
  }
});

// ── GET messages in a conversation (paginated) ────────────────────────────────
// ?limit=50&before=<ISO date> — returns ascending; page back with `before`.

router.get('/:conversationId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (!(await canRead(req, req.params.conversationId))) {
      res.status(403).json({ message: 'Not a participant of this conversation' }); return;
    }
    const limit  = Math.min(Number(req.query.limit) || 200, 200);
    const before = req.query.before ? new Date(req.query.before as string) : null;

    const filter: Record<string, unknown> = {
      conversationId: req.params.conversationId,
      deletedFor: { $ne: req.user!.id },
    };
    if (before && !isNaN(before.getTime())) filter.createdAt = { $lt: before };

    const page = await Message.find(filter)
      .sort('-createdAt')
      .limit(limit)
      .lean();
    await attachAccounts(page, ['senderId']);

    res.json(page.reverse().map(m => sanitize(m)));
  } catch (err) {
    serverError(res, err);
  }
});

/** Generic send — used by CRM counsellor chat */
router.post('/:conversationId', authenticate, can('chat', 'create'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!(await openThreadFor(req, res, req.params.conversationId))) return;

    // Spreading the body let a caller set readBy, reactions, senderName and
    // deletedForEveryone. Only the fields a message is actually composed of.
    const { text, type, meta, replyTo, fileUrl, fileName } = req.body ?? {};
    const message = await Message.create({
      conversationId: req.params.conversationId,
      senderId:       req.user!.id,
      senderName:     req.user!.name,
      type, text, meta, replyTo, fileUrl, fileName,
      readBy: [req.user!.id],
    });

    await Conversation.findByIdAndUpdate(req.params.conversationId, {
      lastMessage: {
        text:      req.body.text || req.body.fileName || 'File',
        senderId:  req.user!.id,
        createdAt: new Date(),
      },
      updatedAt: new Date(),
    });

    const [populated] = await attachAccounts([message.toObject() as unknown as Record<string, unknown>], ['senderId']);

    const io = getIo();
    if (io) io.to(req.params.conversationId).emit('receive_message', populated);

    res.status(201).json(populated);
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
