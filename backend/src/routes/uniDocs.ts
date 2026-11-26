import { Router, type Request, type Response } from 'express';
import archiver from 'archiver';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import Student from '../models/Student';
import PortalAccount from '../models/PortalAccount';
import University from '../models/University';
import User from '../models/User';
import { getSetting } from '../models/Audit';
import { Application, StudentDocument } from '../models/Work';
import { MasterItem } from '../models/Master';
import { DocAccessLog, UniDocRequest, UniDocShare, UniMessage, UniversityApplication } from '../models/Partner';
import { ipAllowed, type UniRequest } from '../middleware/university';
import { upload } from '../middleware/upload';
import { signedFileUrl, type MediaResourceType } from '../config/cloudinary';
import { HttpError, bad, clean, fieldErr, fmtDateTime, fullName, handle, hmac, oid } from '../services/crm';
import { fmtDate } from '../services/invoicePdf';
import { checkFile } from '../services/files';
import { notify, notifyAdmins } from '../services/tasks';
import * as P from '../services/partner';
import { accessEnded, loadUA, role, scope, unreadFor } from './uni';
import { postMessage, saveUniDoc } from './uniApps';

/** The client's university portal API, part 3 (legacy/server/university/routes.js): document requests, documents, messages, search. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const router = Router();
const h = (fn: (req: UniRequest, res: Response) => Promise<void>) => handle(fn as never);
const typeNames = async () => new Map((await MasterItem.find({ type: 'document_type' }).select('name').lean()).map((t: Any) => [String(t._id), t.name as string]));

// ---------- document requests ----------
export async function closeRequestFlags(ua: Any) {
  if (await UniDocRequest.exists({ uapp_id: ua._id, status: { $in: ['Open', 'Partly fulfilled'] } })) return;
  await UniversityApplication.updateOne({ _id: ua._id }, { flag_docs_requested: false });
  await Application.updateOne({ _id: ua.application_id, uni_flag: 'Documents requested by university' }, { $unset: { uni_flag: 1 } });
  const cur = (await UniversityApplication.findById(ua._id).select('status').lean()) as Any;
  if (cur?.status === 'Documents requested') {
    const prev = ((await UniDocRequest.findOne({ uapp_id: ua._id }).sort({ createdAt: -1 }).select('prev_status').lean()) as Any)?.prev_status;
    const to = ['Acknowledged', 'Under assessment', 'Interview scheduled', 'Waitlisted', 'Conditional offer', 'Unconditional offer'].includes(prev) ? prev : 'Acknowledged';
    await UniversityApplication.updateOne({ _id: ua._id }, { status: to, status_changed_at: new Date(), $inc: { version: 1 } });
  }
}
router.post('/applications/:id/requests/:rid/cancel', h(async (req, res) => {
  role(req, 'admin', 'officer'); const ua = await loadUA(req, req.params.id);
  const q = oid(req.params.rid) ? await UniDocRequest.findOne({ _id: oid(req.params.rid), uapp_id: ua._id, status: { $in: ['Open', 'Partly fulfilled'] } }) : null;
  if (!q) throw P.NotFound();
  if (!clean(req.body?.reason)) throw fieldErr('reason', 'Reason is required');
  q.set({ status: 'Cancelled', cancel_reason: clean(req.body.reason, 300) }); await q.save();
  await closeRequestFlags(ua);
  await P.uaudit(req, 'Update', 'UniDocRequest', q._id, 'Cancelled'); res.json({ ok: true });
}));

// ---------- documents (7) ----------
const verOf = (d: Any | null, vid: unknown) => (d?.versions ?? []).find((x: Any) => String(x._id) === String(vid));
async function docsOf(req: UniRequest, ua: Any) {
  const types = await typeNames();
  const byDoc = new Map<string, Any>();
  for (const s of (await UniDocShare.find({ uapp_id: ua._id }).sort({ shared_at: -1 }).lean()) as Any[]) {
    const d = (await StudentDocument.findById(s.document_id).lean()) as Any; const v = verOf(d, s.version_id);
    if (!d || !v) continue;
    const k = String(d._id); if (!byDoc.has(k)) byDoc.set(k, { document_id: k, name: d.title || types.get(String(d.document_type_id)) || 'Document', source: 'La Europa', versions: [] });
    const e = byDoc.get(k)!;
    e.versions.push({ share_id: String(s._id), version_no: v.version_no, status: s.status === 'Revoked' ? `Removed by La Europa on ${fmtDate(new Date(s.revoked_at).toISOString())}` : s.status === 'Expired' ? 'Access period ended' : 'Shared by La Europa',
      active: !['Revoked', 'Expired'].includes(s.status), shared_at: s.shared_at, updated: e.versions.length > 0 });
  }
  const own: Any[] = [];
  const accounts = new Map<string, string>();
  for (const d of (await StudentDocument.find({ application_id: ua.application_id, is_deleted: false, 'versions.uploaded_by_type': 'university' }).lean()) as Any[]) {
    const vs = (d.versions ?? []).filter((v: Any) => v.uploaded_by_type === 'university').sort((a: Any, b: Any) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime());
    const out: Any = { document_id: String(d._id), name: d.title || types.get(String(d.document_type_id)) || 'Document', source: 'University', versions: [] };
    for (const v of vs) {
      const cur = String(d.current_version_id) === String(v._id);
      const label = v.removed_at ? 'Removed' : v.version_status === 'Rejected' || (d.status === 'Rejected' && cur) ? `Returned by La Europa: ${[d.rejection_reason, d.rejection_text].filter(Boolean).join(': ')}. Please upload a corrected version.`
        : (d.status === 'Verified' && cur) || v.version_status === 'Verified' ? 'Accepted by La Europa' : 'Sent to La Europa (being checked)';
      const by = String(v.uploaded_by);
      if (!accounts.has(by)) accounts.set(by, ((await PortalAccount.findById(v.uploaded_by).select('name').lean()) as Any)?.name || 'University');
      out.versions.push({ version_id: String(v._id), version_no: v.version_no, status: label, uploaded_at: v.uploaded_at, by: accounts.get(by),
        can_remove: !v.removed_at && !d.staff_opened_at && d.status === 'Uploaded' && cur && by === String(req.su._id), active: !v.removed_at });
    }
    own.push(out);
  }
  return { shared: [...byDoc.values()], uploads: own };
}
const canSeeDocs = (req: UniRequest) => req.su.uniRole !== 'viewer' || !!req.uni.viewer_docs;
router.get('/applications/:id/documents', h(async (req, res) => {
  const ua = (await loadUA(req, req.params.id)).toObject() as Any;
  if (!canSeeDocs(req)) { res.json({ hidden: true, shared: [], uploads: [] }); return; }
  if (await accessEnded(ua, req.uni)) { res.json({ access_ended: true, shared: [], uploads: [] }); return; }
  res.json({ ...(await docsOf(req, ua)), zip: !!req.uni.zip_download, upload_types: ['University invoice (tuition)', 'Other university document'] });
}));

// signed file links (5 minutes, bound to the user): opened in a new tab, so they carry no token
const LINK_MS = 5 * 60e3;
const sigOf = (what: string, suId: string, exp: number, d: string) => hmac(`uni-file|${what}|${suId}|${exp}|${d}`);
function signedPath(path: string, what: string, suId: unknown, d: string, extra = '') {
  const exp = Date.now() + LINK_MS;
  return `/api/university/${path}?u=${suId}&exp=${exp}&d=${d}&sig=${sigOf(what, String(suId), exp, d)}${extra}`;
}
router.post('/applications/:id/documents/link', h(async (req, res) => {
  const ua = await loadUA(req, req.params.id); if (!canSeeDocs(req)) throw P.NotFound();
  const disp = req.body?.download ? 'attachment' : 'inline';
  if (req.body?.share_id) {
    const s = oid(req.body.share_id) ? await UniDocShare.findOne({ _id: oid(req.body.share_id), uapp_id: ua._id, status: { $nin: ['Revoked', 'Expired'] } }).lean() : null;
    if (!s) throw P.NotFound();
    res.json({ url: signedPath(`file/s/${s._id}`, 'us:' + s._id, req.su._id, disp) }); return;
  }
  const d = oid(req.body?.version_id) ? ((await StudentDocument.findOne({ application_id: ua.application_id, versions: { $elemMatch: { _id: oid(req.body.version_id), uploaded_by_type: 'university' } } }).lean()) as Any) : null;
  if (!d) throw P.NotFound();
  res.json({ url: signedPath(`file/v/${req.body.version_id}`, 'uv:' + req.body.version_id, req.su._id, disp) });
}));
router.post('/applications/:id/documents/zip', h(async (req, res) => {
  const ua = (await loadUA(req, req.params.id)).toObject() as Any;
  if (!canSeeDocs(req) || !req.uni.zip_download || (await accessEnded(ua, req.uni))) throw P.NotFound();
  if (!(await UniDocShare.exists({ uapp_id: ua._id, status: { $nin: ['Revoked', 'Expired'] } }))) throw bad('No shared documents yet');
  res.json({ url: signedPath(`zip/${ua._id}`, 'uz:' + ua._id, req.su._id, 'attachment') });
}));
// download alert (7.6): more than N documents in an hour
async function downloadGuard(req: UniRequest) {
  const n = await DocAccessLog.countDocuments({ account_id: req.su._id, createdAt: { $gt: new Date(Date.now() - 3600e3) } });
  if (n >= 100) throw new HttpError(429, 'Too many downloads. Please try again later.');
  const limit = Number((await getSetting('uni_download_alert')) || 50);
  if (n === limit) await notifyAdmins('university', `Unusual download activity: ${req.su.name} (${P.uniName(req.uni)}) downloaded ${n} documents in 1 hour`, '/admin/university');
}
async function logAccess(req: UniRequest, ua: Any, share: Any | null, versionId: unknown, action: string) {
  await DocAccessLog.create({ account_id: req.su._id, university_id: req.su.universityId, uapp_id: ua._id, document_id: share?.document_id, version_id: versionId, action, ip: req.ip, user_agent: String(req.headers['user-agent'] || '').slice(0, 300) });
  await P.uaudit(req, action === 'preview' ? 'View' : 'Download', 'Document', share ? share.document_id : versionId, action);
}
const bytesOf = async (v: Any) => {
  const u = signedFileUrl(v.url, v.public_id, v.resource_type as MediaResourceType); if (!u) throw P.NotFound();
  const r = await fetch(u); if (!r.ok) throw new HttpError(502, 'The file could not be read from storage.');
  return Buffer.from(await r.arrayBuffer());
};
// watermark (7.6): stamped on the server, cached for at most 10 minutes
const wmCache = new Map<string, { buf: Buffer; at: number }>();
setInterval(() => { const t = Date.now(); for (const [k, v] of wmCache) if (t - v.at > 600e3) wmCache.delete(k); }, 60000).unref();
async function stamped(req: UniRequest, v: Any, a: Any) {
  const key = `${v._id}:${req.su._id}`;
  const c = wmCache.get(key); if (c) return c.buf;
  const buf = await bytesOf(v);
  let doc: PDFDocument;
  if (/pdf/.test(v.mime_type || '') || /\.pdf$/i.test(v.stored_name || '')) {
    try { doc = await PDFDocument.load(buf, { ignoreEncryption: true }); doc.getPages(); }
    catch { // never send an unstamped original: a stamped notice page instead
      doc = await PDFDocument.create(); const f0 = await doc.embedFont(StandardFonts.Helvetica); const p0 = doc.addPage([595.28, 841.89]);
      p0.drawText('This file could not be watermarked automatically.', { x: 50, y: 760, size: 14, font: f0 });
      p0.drawText('Please message La Europa in the portal to receive it.', { x: 50, y: 738, size: 11, font: f0 });
    }
  } else {
    doc = await PDFDocument.create(); const img = /png/.test(v.mime_type) ? await doc.embedPng(buf) : await doc.embedJpg(buf); const A4: [number, number] = [595.28, 841.89];
    const sc = Math.min((A4[0] - 40) / img.width, (A4[1] - 60) / img.height, 1); const p = doc.addPage(A4);
    p.drawImage(img, { x: (A4[0] - img.width * sc) / 2, y: (A4[1] - img.height * sc) / 2 + 10, width: img.width * sc, height: img.height * sc });
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const line = `Shared by La Europa Education with ${P.shortName(req.uni)} for application ${a.application_code} | ${req.su.email} | ${fmtDateTime(new Date())} IST | Confidential`;
  for (const p of doc.getPages()) {
    const { width, height } = p.getSize();
    p.drawText(`La Europa Education - ${P.shortName(req.uni)} - Confidential`, { x: width * 0.12, y: height * 0.3, size: Math.max(14, width / 26), font, color: rgb(0.6, 0.6, 0.6), opacity: 0.18, rotate: degrees(35) });
    const sz = Math.max(5, Math.min(7, width / 95));
    p.drawRectangle({ x: 0, y: 0, width, height: sz + 8, color: rgb(1, 1, 1), opacity: 0.85 });
    p.drawText(line.slice(0, Math.floor(width / (sz * 0.5))), { x: 6, y: 4, size: sz, font, color: rgb(0.25, 0.25, 0.25) });
  }
  const out = Buffer.from(await doc.save());
  wmCache.set(key, { buf: out, at: Date.now() });
  return out;
}
const extOf = (v: Any) => String(v.stored_name || '').split('.').pop() || 'pdf';
const fileName = (a: Any, d: Any, types: Map<string, string>, v: Any, wm: boolean) => `${a.application_code}_${String(d.title || types.get(String(d.document_type_id)) || 'Document').replace(/[^A-Za-z0-9]+/g, '_')}_v${v.version_no}.${wm ? 'pdf' : extOf(v)}`;

/** the signed-link routes, mounted before uniAuth: the signature stands in for the token */
export const files = Router();
const fh = (fn: (req: UniRequest, res: Response) => Promise<void>) => handle(fn as never);
async function signedReq(req: Request, what: string) {
  const { u, exp, d, sig } = req.query as Record<string, string>;
  if (!u || !exp || !sig || Number(exp) < Date.now() || sig !== sigOf(what, u, Number(exp), String(d))) throw new HttpError(403, 'This link has expired. Please open the file again.');
  const su = oid(u) ? await PortalAccount.findById(oid(u)) : null;
  const uni = su?.universityId ? await University.findById(su.universityId) : null;
  if (!su || su.role !== 'university' || su.status !== 'Active' || !uni || uni.portal_status !== 'Active' || !ipAllowed(uni, req.ip)) throw new HttpError(403, 'This link has expired. Please open the file again.');
  const r = req as UniRequest; r.su = su; r.uni = uni; r.preview = false; r.campuses = (su.campuses ?? []).map(String); r.user = { id: String(su._id), role: 'university' } as never;
  return { r, attach: d === 'attachment' };
}
files.get('/file/s/:sid', fh(async (req0, res) => {
  const { r: req, attach } = await signedReq(req0, 'us:' + req0.params.sid);
  const s = oid(req.params.sid) ? await UniDocShare.findOne({ _id: oid(req.params.sid), status: { $nin: ['Revoked', 'Expired'] } }) : null; if (!s) throw P.NotFound();
  const ua = (await loadUA(req, s.uapp_id)).toObject() as Any; if (!canSeeDocs(req) || (await accessEnded(ua, req.uni))) throw P.NotFound();
  const d = (await StudentDocument.findById(s.document_id).lean()) as Any; const v = verOf(d, s.version_id); if (!v) throw P.NotFound();
  const a = (await Application.findById(ua.application_id).select('application_code').lean()) as Any;
  await downloadGuard(req);
  const action = attach ? 'download' : 'preview';
  await logAccess(req, ua, s, v._id, action);
  s.set({ status: action === 'download' ? 'Downloaded' : s.status === 'Shared' ? 'Viewed' : s.status, viewed_at: s.viewed_at ?? new Date(), ...(action === 'download' ? { downloaded_at: new Date() } : {}) }); await s.save();
  const wm = !!req.uni.watermark;
  const buf = wm ? await stamped(req, v, a) : await bytesOf(v);
  res.setHeader('Content-Type', wm ? 'application/pdf' : v.mime_type || 'application/octet-stream'); res.setHeader('Content-Disposition', `${attach ? 'attachment' : 'inline'}; filename="${fileName(a, d, await typeNames(), v, wm)}"`);
  res.setHeader('Cache-Control', 'private, no-store'); res.end(buf);
}));
files.get('/file/v/:vid', fh(async (req0, res) => {
  const { r: req, attach } = await signedReq(req0, 'uv:' + req0.params.vid);
  const d = oid(req.params.vid) ? ((await StudentDocument.findOne({ versions: { $elemMatch: { _id: oid(req.params.vid), uploaded_by_type: 'university' } } }).lean()) as Any) : null;
  const ua = d ? ((await UniversityApplication.findOne({ application_id: d.application_id }).select('_id').lean()) as Any) : null; if (!ua) throw P.NotFound();
  await loadUA(req, ua._id);
  const v = verOf(d, req.params.vid);
  res.setHeader('Content-Type', v.mime_type || 'application/octet-stream'); res.setHeader('Content-Disposition', `${attach ? 'attachment' : 'inline'}; filename="${String(v.stored_name).replace(/"/g, '')}"`); res.setHeader('Cache-Control', 'private, no-store');
  res.end(await bytesOf(v));
}));
files.get('/zip/:uaId', fh(async (req0, res) => {
  const { r: req } = await signedReq(req0, 'uz:' + req0.params.uaId);
  const ua = (await loadUA(req, req.params.uaId)).toObject() as Any;
  if (!canSeeDocs(req) || !req.uni.zip_download || (await accessEnded(ua, req.uni))) throw P.NotFound();
  const a = (await Application.findById(ua.application_id).lean()) as Any; const st = (await Student.findById(a.student_id).select('first_name middle_name last_name').lean()) as Any;
  const shares = (await UniDocShare.find({ uapp_id: ua._id, status: { $nin: ['Revoked', 'Expired'] } }).lean()) as Any[];
  if (!shares.length) throw bad('No shared documents yet');
  await downloadGuard(req);
  const types = await typeNames(); const wm = !!req.uni.watermark;
  res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', `attachment; filename="${`${a.application_code} ${fullName(st)}`.replace(/[^A-Za-z0-9 -]/g, '')}.zip"`); res.setHeader('Cache-Control', 'private, no-store');
  const z = new (archiver as unknown as { ZipArchive: new (o: object) => archiver.Archiver }).ZipArchive({ zlib: { level: 6 } });
  z.pipe(res);
  for (const s of shares) {
    const d = (await StudentDocument.findById(s.document_id).lean()) as Any; const v = verOf(d, s.version_id); if (!v) continue;
    z.append(wm ? await stamped(req, v, a) : await bytesOf(v), { name: fileName(a, d, types, v, wm) }); await logAccess(req, ua, s, v._id, 'zip');
  }
  await z.finalize();
}));

router.post('/applications/:id/documents/upload', upload.single('file'), h(async (req, res) => {
  role(req, 'admin', 'officer'); const ua = (await loadUA(req, req.params.id)).toObject() as Any;
  if (ua.status === 'Withdrawn') throw bad('This application was withdrawn by La Europa.');
  const type = ['University invoice (tuition)', 'Other university document'].includes(req.body?.document_type) ? req.body.document_type : null;
  if (!type) throw fieldErr('document_type', 'Choose the document type');
  if (type === 'Other university document' && !clean(req.body.title)) throw fieldErr('title', 'Title is required');
  if (!req.file) throw fieldErr('file', 'Choose a file');
  if (type === 'University invoice (tuition)' && !/\.pdf$/i.test(req.file.originalname)) throw bad('Please upload a PDF file');
  const { doc } = await saveUniDoc(req, ua, req.file, type, { title: type === 'Other university document' ? clean(req.body.title, 150) : null, note: clean(req.body.note, 500) ?? undefined });
  await P.uaudit(req, 'Upload', 'Document', doc._id, type); res.json({ ok: true });
}));
router.delete('/applications/:id/documents/version/:vid', h(async (req, res) => {
  const ua = await loadUA(req, req.params.id);
  const d = oid(req.params.vid) ? await StudentDocument.findOne({ application_id: ua.application_id, versions: { $elemMatch: { _id: oid(req.params.vid), uploaded_by_type: 'university', uploaded_by: req.su._id } } }) : null;
  if (!d) throw P.NotFound();
  const v = d.versions.find((x) => String(x._id) === req.params.vid)!;
  if (v.removed_at || d.staff_opened_at || d.status !== 'Uploaded' || String(d.current_version_id) !== String(v._id)) throw bad('This file is already being checked by La Europa and cannot be removed.');
  v.removed_at = new Date();
  const prev = [...d.versions].filter((x) => String(x._id) !== String(v._id) && !x.removed_at).sort((a, b) => b.version_no - a.version_no)[0];
  d.current_version_id = prev?._id; if (!prev) d.status = 'Pending';
  await d.save();
  await P.uaudit(req, 'Delete', 'DocumentVersion', v._id, 'University removed own upload'); res.json({ ok: true });
}));

// ---------- messages (8) ----------
export async function msgOut(m: Any, viewerId: string) {
  const sender = m.sender_type === 'university' ? ((await PortalAccount.findById(m.sender_account_id).select('name').lean()) as Any)?.name : ((await User.findById(m.sender_user_id).select('name').lean()) as Any)?.name;
  return { id: String(m._id), mine: m.sender_type === 'university', side: m.sender_type === 'university' ? 'University' : 'La Europa Education', sender: sender ?? null, body: m.deleted_at ? null : m.body ?? null, deleted: !!m.deleted_at, edited: !!m.edited_at,
    sent_at: m.sent_at, seen: m.sender_type === 'university' ? m.seen_by_le_at ?? null : m.seen_by_uni_at ?? null, context: m.context_type ? { type: m.context_type, id: m.context_id } : null,
    attachments: m.deleted_at ? [] : (m.attachments ?? []).map((x: Any) => ({ id: String(x._id), original_name: x.original_name, mime_type: x.mime_type, size_bytes: x.size_bytes })),
    can_edit: m.sender_type === 'university' && String(m.sender_account_id) === viewerId && !m.deleted_at && Date.now() - new Date(m.sent_at).getTime() < 15 * 60000 };
}
export const MSG_TYPES = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xlsx', 'csv'];
export function checkAttachments(list: Express.Multer.File[]) {
  if (list.length > 5) throw bad('Maximum 5 attachments');
  const sigs: Record<string, (b: Buffer) => boolean> = { doc: (b) => b.subarray(0, 4).toString('hex') === 'd0cf11e0', docx: (b) => b[0] === 0x50 && b[1] === 0x4b, xlsx: (b) => b[0] === 0x50 && b[1] === 0x4b, csv: (b) => !b.includes(0) };
  for (const f of list) {
    const ext = String(f.originalname.split('.').pop()).toLowerCase();
    if (!MSG_TYPES.includes(ext)) throw bad(`"${f.originalname}": allowed files are PDF, JPG, PNG, DOC, DOCX, XLSX, CSV`);
    if (f.size > 10 * 1024 * 1024) throw bad(`"${f.originalname}" is larger than 10 MB`);
    if (sigs[ext]) { if (!sigs[ext](f.buffer.subarray(0, 8))) throw bad(`"${f.originalname}" is not a real ${ext.toUpperCase()} file`); }
    else checkFile(f, [ext], 10);
  }
}
const clip = (s: unknown) => String(s ?? '').replace(/<[^>]*>/g, '').trim().slice(0, 5000);
const recent = new Map<string, number[]>();
function msgRate(id: string) { const t = Date.now(); const l = (recent.get(id) ?? []).filter((x) => t - x < 60000); if (l.length >= 30) throw new HttpError(429, 'Too many messages. Please wait a minute.'); l.push(t); recent.set(id, l); }
router.get('/messages', h(async (req, res) => {
  const threads: Any[] = [];
  for (const uaId of await UniMessage.distinct('uapp_id', { university_id: req.su.universityId, uapp_id: { $ne: null } })) {
    const ua = (await UniversityApplication.findOne({ _id: uaId, ...scope(req) }).lean()) as Any; if (!ua) continue;
    const last = (await UniMessage.findOne({ uapp_id: ua._id, deleted_at: null }).sort({ sent_at: -1 }).lean()) as Any;
    const v = await P.appView(ua);
    threads.push({ uapp_id: String(ua._id), application_code: v.application_code, student_name: v.student_name, course: v.course, intake: v.intake, unread: await unreadFor(ua._id), last_at: last?.sent_at ?? null,
      last_text: last ? String(last.body || 'Attachment').slice(0, 90) : '', waiting: last?.sender_type === 'university' });
  }
  const g = (await UniMessage.findOne({ university_id: req.su.universityId, uapp_id: null, deleted_at: null }).sort({ sent_at: -1 }).lean()) as Any;
  threads.unshift({ uapp_id: 'general', application_code: 'General', student_name: 'Partner topics with La Europa', unread: await UniMessage.countDocuments({ university_id: req.su.universityId, uapp_id: null, sender_type: 'staff', seen_by_uni_at: null }),
    last_at: g?.sent_at ?? null, last_text: g ? String(g.body || 'Attachment').slice(0, 90) : '', waiting: g?.sender_type === 'university' });
  let rows = threads; if (req.query.unread === '1') rows = rows.filter((t) => t.unread); if (req.query.waiting === '1') rows = rows.filter((t) => t.waiting);
  res.json({ rows: rows.sort((a, b) => (a.uapp_id === 'general' ? -1 : b.uapp_id === 'general' ? 1 : 0) || String(b.last_at ? new Date(b.last_at).toISOString() : '').localeCompare(String(a.last_at ? new Date(a.last_at).toISOString() : ''))) });
}));
const threadOf = async (req: UniRequest, id: string) => (id === 'general' ? null : ((await loadUA(req, id)).toObject() as Any));
const where = (req: UniRequest, ua: Any | null): Any => (ua ? { uapp_id: ua._id } : { uapp_id: null, university_id: req.su.universityId });
router.get('/messages/:id', h(async (req, res) => {
  const ua = await threadOf(req, req.params.id);
  if (ua && (await accessEnded(ua, req.uni))) { res.json({ rows: [], access_ended: true }); return; }
  const rows = (await UniMessage.find(where(req, ua)).sort({ sent_at: 1 }).lean()) as Any[];
  if (!req.preview) await UniMessage.updateMany({ ...where(req, ua), sender_type: 'staff', seen_by_uni_at: null }, { seen_by_uni_at: new Date() });
  const out = []; for (const m of rows) out.push(await msgOut(m, String(req.su._id)));
  res.json({ rows: out, can_post: req.su.uniRole !== 'viewer' && !req.preview && !(ua && ua.status === 'Withdrawn') });
}));
router.post('/messages/:id', upload.array('files', 5), h(async (req, res) => {
  role(req, 'admin', 'officer'); msgRate(String(req.su._id));
  const ua = await threadOf(req, req.params.id);
  if (ua && (ua.status === 'Withdrawn' || (await accessEnded(ua, req.uni)))) throw bad('This thread is closed.');
  const body = clip(req.body?.body);
  const list = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!body && !list.length) throw bad('Write a message or attach a file');
  checkAttachments(list);
  const id = await postMessage(req, ua, body || '', req.body?.context_type, req.body?.context_id, list);
  await P.uaudit(req, 'Create', 'UniversityMessage', id, ua ? 'Application thread' : 'General thread');
  res.json({ id });
}));
router.put('/messages/m/:mid', h(async (req, res) => {
  const m = oid(req.params.mid) ? await UniMessage.findOne({ _id: oid(req.params.mid), university_id: req.su.universityId, sender_type: 'university', sender_account_id: req.su._id }) : null;
  if (!m) throw P.NotFound();
  if (Date.now() - new Date(m.sent_at).getTime() > 15 * 60000) throw bad('Messages can be edited or deleted only within 15 minutes.');
  if (req.body?.delete) m.set({ deleted_at: new Date(), original_body: m.original_body ?? m.body });
  else { const b = clip(req.body?.body); if (!b) throw bad('Message cannot be empty'); m.set({ original_body: m.original_body ?? m.body, body: b, edited_at: new Date() }); }
  await m.save();
  await P.uaudit(req, req.body?.delete ? 'Delete' : 'Update', 'UniversityMessage', m._id); res.json({ ok: true });
}));
router.get('/messages/attachment/:aid', h(async (req, res) => {
  const m = oid(req.params.aid) ? ((await UniMessage.findOne({ 'attachments._id': oid(req.params.aid), university_id: req.su.universityId }).lean()) as Any) : null;
  if (!m) throw P.NotFound(); if (m.uapp_id) await loadUA(req, m.uapp_id);
  const at = m.attachments.find((x: Any) => String(x._id) === req.params.aid);
  const url = at?.file?.url ? signedFileUrl(at.file.url, at.file.public_id, at.file.resource_type) : null; if (!url) throw P.NotFound();
  res.json({ url, name: at.original_name });
}));

// ---------- global search inside own applications only (5.1) ----------
router.get('/search', h(async (req, res) => {
  const t = String(req.query.q || '').trim().toLowerCase(); if (t.length < 2) { res.json([]); return; }
  const out: Any[] = [];
  for (const x of (await UniversityApplication.find(scope(req)).lean()) as Any[]) {
    const v = await P.appView(x);
    if (String(v.application_code).toLowerCase().includes(t) || String(v.student_name).toLowerCase().includes(t) || String(v.university_ref || '').toLowerCase().includes(t)) out.push(v);
    if (out.length >= 10) break;
  }
  res.json(out);
}));

export default router;
void notify;
