import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { IncomingMessage } from 'http';
import mongoose from 'mongoose';
import { ZipArchive } from 'archiver';
import DocumentModel, { DocType, IDocVersion } from '../models/Document';
import DocumentRequest from '../models/DocumentRequest';
import Student from '../models/Student';
import Message from '../models/Message';
import Conversation from '../models/Conversation';
import { authenticate, can, AuthRequest } from '../middleware/auth';
import { upload, requireCloudinary } from '../middleware/upload';
import { uploadBuffer, destroyAsset, mediaFolders } from '../config/cloudinary';
import { getIo } from '../socket/emitter';
import { notify } from '../utils/notify';
import { attachAccounts } from '../services/accounts';

const router = Router();

const READ_ONLY_ROLES = ['university'];
const STUDENT_ROLES   = ['student'];

function isStaff(role?: string) {
  return !!role && !READ_ONLY_ROLES.includes(role) && !STUDENT_ROLES.includes(role);
}

/** Update the matching item inside document_request chat messages when a request changes status */
async function syncRequestChatMessages(requestId: string, status: 'pending' | 'fulfilled' | 'cancelled') {
  const messages = await Message.find({ type: 'document_request', 'meta.items.requestId': requestId });
  const io = getIo();
  for (const msg of messages) {
    const meta = (msg.meta ?? {}) as { items?: Array<{ requestId: string; status: string }> };
    if (!meta.items) continue;
    meta.items = meta.items.map(it => it.requestId === requestId ? { ...it, status } : it);
    msg.meta = meta as Record<string, unknown>;
    msg.markModified('meta');
    await msg.save();
    if (io) io.to(msg.conversationId.toString()).emit('message_updated', msg.toObject());
  }
}

// ── Document requests (counsellor → student) ─────────────────────────────────
// NOTE: these must be registered before the generic '/:id' routes.

/**
 * POST /api/documents/requests
 * Body: { studentId, items: [{ type, label?, note? }], conversationId? }
 * Creates DocumentRequest records, posts a document_request card into the chat
 * (when a conversation exists or is provided) and notifies the student.
 */
router.post('/requests', authenticate, can('documents', 'create'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!isStaff(req.user?.role)) {
    res.status(403).json({ message: 'Only staff can request documents' }); return;
  }
  const { studentId, items, conversationId } = req.body as {
    studentId: string;
    items: Array<{ type: DocType; label?: string; note?: string }>;
    conversationId?: string;
  };
  if (!studentId || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ message: 'studentId and at least one item are required' }); return;
  }

  try {
    const student = await Student.findById(studentId);
    if (!student) { res.status(404).json({ message: 'Student not found' }); return; }

    const requests = await DocumentRequest.insertMany(items.map(it => ({
      studentId,
      requestedBy: req.user!.id,
      type: it.type,
      label: it.label,
      note: it.note,
      status: 'pending',
    })));

    // Locate the chat with the student (explicit id wins, else 1-on-1 lookup).
    // Closed conversations never receive new request cards.
    let convId: string | undefined = conversationId;
    if (convId) {
      const conv = await Conversation.findById(convId).select('archived');
      if (!conv || conv.archived) convId = undefined;
    } else if (student.userId) {
      const conv = await Conversation.findOne({
        participants: { $all: [req.user!.id, student.userId.toString()], $size: 2 },
        archived: { $ne: true },
      });
      if (conv) convId = conv._id.toString();
    }

    let message = null;
    if (convId) {
      message = await Message.create({
        conversationId: convId,
        senderId:   req.user!.id,
        senderName: req.user!.name,
        type: 'document_request',
        text: `Requested ${requests.length} document${requests.length > 1 ? 's' : ''}`,
        meta: {
          items: requests.map(r => ({
            requestId: r._id.toString(),
            type: r.type,
            label: r.label,
            note: r.note,
            status: 'pending',
          })),
        },
        readBy: [req.user!.id],
      });
      await Conversation.findByIdAndUpdate(convId, {
        lastMessage: { text: `📋 ${message.text}`, senderId: req.user!.id, createdAt: new Date() },
        updatedAt: new Date(),
      });
      const io = getIo();
      if (io) io.to(convId).emit('receive_message', message.toObject());
    }

    if (student.userId) {
      notify([student.userId.toString()], {
        type:  'document',
        title: '📋 Documents Requested',
        body:  `${req.user!.name} requested: ${requests.map(r => r.label || r.type.replace(/_/g, ' ')).join(', ')}`,
        link:  '/documents',
      }).catch(() => {});
    }

    res.status(201).json({ requests, message });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/** GET /api/documents/requests?studentId=&status= */
router.get('/requests', authenticate, can('documents', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.studentId) filter.studentId = req.query.studentId;
    if (req.query.status)    filter.status    = req.query.status;
    const requests = await DocumentRequest.find(filter)
      .populate('requestedBy', 'name role')
      .populate('documentId', 'status currentVersion')
      .sort('-createdAt');
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

/** PUT /api/documents/requests/:id/cancel */
router.put('/requests/:id/cancel', authenticate, can('documents', 'update'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!isStaff(req.user?.role)) { res.status(403).json({ message: 'Forbidden' }); return; }
  try {
    const request = await DocumentRequest.findByIdAndUpdate(req.params.id, { status: 'cancelled' }, { new: true });
    if (!request) { res.status(404).json({ message: 'Request not found' }); return; }
    await syncRequestChatMessages(request._id.toString(), 'cancelled');
    res.json(request);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// ── Download all documents as ZIP ────────────────────────────────────────────

/** Open a readable stream over a remote (Cloudinary) asset. */
function fetchRemote(url: string, redirectsLeft = 3): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        fetchRemote(res.headers.location, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (status !== 200) { res.resume(); reject(new Error(`Asset fetch failed (${status})`)); return; }
      resolve(res);
    }).on('error', reject);
  });
}

/** GET /api/documents/download-all/:studentId — staff only, streams a ZIP of current versions */
router.get('/download-all/:studentId', authenticate, can('documents', 'read'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!isStaff(req.user?.role)) { res.status(403).json({ message: 'Forbidden' }); return; }
  try {
    const student = await Student.findById(req.params.studentId);
    if (!student) { res.status(404).json({ message: 'Student not found' }); return; }

    const docs = await DocumentModel.find({ studentId: req.params.studentId });
    const withFiles = docs.filter(d => d.currentVersion?.fileUrl);
    if (withFiles.length === 0) { res.status(404).json({ message: 'No documents to download' }); return; }

    const safeName = (student.personal.name || 'student').replace(/[^\w-]+/g, '_');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_documents.zip"`);

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', () => { if (!res.headersSent) res.status(500).end(); else res.end(); });
    archive.pipe(res);

    const seen = new Set<string>();
    for (const doc of withFiles) {
      const { fileUrl, fileName } = doc.currentVersion;
      const base = doc.label || doc.type;
      let entry = `${base.replace(/[^\w.-]+/g, '_')}__${fileName}`;
      let n = 1;
      while (seen.has(entry)) entry = `${base}_${n++}__${fileName}`;
      seen.add(entry);

      if (/^https?:\/\//i.test(fileUrl)) {
        // A single unreachable asset must not abort the whole archive
        try { archive.append(await fetchRemote(fileUrl), { name: entry }); } catch { continue; }
      } else {
        // Legacy record still pointing at the old local uploads folder
        const diskPath = path.join(process.cwd(), 'uploads', path.basename(fileUrl));
        if (fs.existsSync(diskPath)) archive.file(diskPath, { name: entry });
      }
    }
    await archive.finalize();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ message: 'Server error', error: err });
  }
});

// ── Documents CRUD ───────────────────────────────────────────────────────────

/**
 * Drop the stored assets behind a deleted document. Chat attachments and
 * documents can point at the same upload, so anything a Message still links to
 * is left alone.
 */
async function destroyUnreferencedVersions(versions: IDocVersion[]): Promise<void> {
  const publicIds = [...new Set(versions.map(v => v.publicId).filter((id): id is string => !!id))];
  if (publicIds.length === 0) return;

  const stillLinked = await Message.distinct('filePublicId', { filePublicId: { $in: publicIds } });
  const linked = new Set<string>(stillLinked);

  await Promise.all(
    versions
      .filter(v => v.publicId && !linked.has(v.publicId))
      .map(v => destroyAsset(v.publicId, v.resourceType)),
  );
}

router.get('/', authenticate, can('documents', 'read'), async (req: AuthRequest, res: Response) => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.studentId) filter.studentId = req.query.studentId;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.type) filter.type = req.query.type;
    const docs = await DocumentModel.find(filter)
      .populate('studentId', 'personal')
      .populate('reviewedBy', 'name email')
      .sort('-createdAt')
      .lean();
    res.json(await attachAccounts(docs, ['currentVersion.uploadedBy']));
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.post('/', authenticate, can('documents', 'create'), async (req: AuthRequest, res: Response) => {
  if (req.user?.role === 'university') {
    res.status(403).json({ message: 'University users have read-only document access' }); return;
  }
  try {
    const doc = await DocumentModel.create(req.body);
    res.status(201).json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// POST /api/documents/upload — multipart file upload (student portal + CRM)
// Optional field `requestId` fulfils a pending DocumentRequest.
router.post('/upload', authenticate, can('documents', 'create'), requireCloudinary, async (req: AuthRequest, res: Response, next) => {
  if (req.user?.role === 'university') {
    res.status(403).json({ message: 'University users have read-only document access' }); return;
  }
  next();
}, upload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.file) { res.status(400).json({ message: 'No file uploaded' }); return; }
  const { studentId, type, label, requestId, conversationId } = req.body;
  if (!studentId || !type) { res.status(400).json({ message: 'studentId and type are required' }); return; }
  if (!mongoose.Types.ObjectId.isValid(studentId)) {
    res.status(400).json({ message: 'Invalid studentId' }); return;
  }

  const fileName = req.file.originalname;
  const now      = new Date();

  let asset;
  try {
    asset = await uploadBuffer(req.file, mediaFolders.studentDocuments(studentId));
  } catch (err) {
    res.status(502).json({ message: 'Upload to storage failed', error: err }); return;
  }

  const fileUrl = asset.url;
  const version: IDocVersion = {
    fileUrl,
    fileName,
    publicId:     asset.publicId,
    resourceType: asset.resourceType,
    uploadedAt:   now,
    uploadedBy:   new mongoose.Types.ObjectId(req.user!.id),
  };

  try {
    // Check if a document of this type already exists for the student
    let doc = await DocumentModel.findOne({ studentId, type });
    if (doc) {
      doc.versions.push(version);
      doc.currentVersion = version;
      doc.status = 'uploaded';
      if (label) doc.label = label;
      await doc.save();
    } else {
      doc = await DocumentModel.create({
        studentId: new mongoose.Types.ObjectId(studentId as string),
        type, label: label || undefined,
        status: 'uploaded',
        currentVersion: version,
        versions: [version],
      });
    }

    // Fulfil a pending request if one was referenced
    let fulfilledRequest = null;
    if (requestId) {
      fulfilledRequest = await DocumentRequest.findByIdAndUpdate(
        requestId,
        { status: 'fulfilled', documentId: doc._id, fulfilledAt: now },
        { new: true },
      );
      if (fulfilledRequest) {
        await syncRequestChatMessages(fulfilledRequest._id.toString(), 'fulfilled');
        notify([fulfilledRequest.requestedBy.toString()], {
          type:  'document',
          title: '✅ Requested Document Uploaded',
          body:  `${req.user!.name} uploaded ${fulfilledRequest.label || fulfilledRequest.type.replace(/_/g, ' ')}`,
          link:  '/documents',
        }).catch(() => {});
      }
    } else if (req.user!.role === 'student') {
      // Free-will upload from the portal → tell the assigned counsellor
      const student = await Student.findById(studentId);
      if (student?.assignedCounsellor) {
        notify([student.assignedCounsellor.toString()], {
          type:  'document',
          title: '📤 New Document Uploaded',
          body:  `${req.user!.name} uploaded ${label || fileName}`,
          link:  '/documents',
        }).catch(() => {});
      }
    }

    // Optionally drop the file into the chat so both sides see it inline
    const uploadConv = conversationId
      ? await Conversation.findById(conversationId).select('archived')
      : null;
    if (uploadConv && !uploadConv.archived) {
      const chatMsg = await Message.create({
        conversationId,
        senderId:   req.user!.id,
        senderName: req.user!.name,
        type: 'file',
        fileUrl,
        fileName,
        filePublicId:     asset.publicId,
        fileResourceType: asset.resourceType,
        readBy: [req.user!.id],
      });
      await Conversation.findByIdAndUpdate(conversationId, {
        lastMessage: { text: `📎 ${fileName}`, senderId: req.user!.id, createdAt: now },
        updatedAt: now,
      });
      const io = getIo();
      if (io) io.to(conversationId).emit('receive_message', chatMsg.toObject());
    }

    res.status(fulfilledRequest ? 200 : 201).json({ document: doc, request: fulfilledRequest });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.get('/:id', authenticate, can('documents', 'read'), async (req, res: Response) => {
  try {
    const doc = await DocumentModel.findById(req.params.id)
      .populate('reviewedBy', 'name email')
      .lean();
    if (!doc) { res.status(404).json({ message: 'Document not found' }); return; }
    res.json((await attachAccounts([doc], ['currentVersion.uploadedBy']))[0]);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.put('/:id', authenticate, can('documents', 'update'), async (req: AuthRequest, res: Response) => {
  if (req.user?.role === 'university') {
    res.status(403).json({ message: 'University users have read-only document access' }); return;
  }
  try {
    const doc = await DocumentModel.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) { res.status(404).json({ message: 'Document not found' }); return; }
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

// PUT /api/documents/:id/status — review workflow
router.put('/:id/status', authenticate, can('documents', 'update'), async (req: AuthRequest, res: Response) => {
  try {
    const { status, rejectionReason, notes } = req.body;
    const updateData: Record<string, unknown> = {
      status,
      reviewedBy: req.user!.id,
    };
    if (rejectionReason) updateData.rejectionReason = rejectionReason;
    if (notes) updateData.notes = notes;

    const doc = await DocumentModel.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate('reviewedBy', 'name email');

    if (!doc) { res.status(404).json({ message: 'Document not found' }); return; }
    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

router.delete('/:id', authenticate, can('documents', 'delete'), async (req: AuthRequest, res: Response) => {
  if (req.user?.role === 'university') {
    res.status(403).json({ message: 'University users have read-only document access' }); return;
  }
  try {
    const doc = await DocumentModel.findByIdAndDelete(req.params.id);
    if (doc) await destroyUnreferencedVersions(doc.versions);
    res.json({ message: 'Document deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err });
  }
});

export default router;
