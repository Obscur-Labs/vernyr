import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { Types } from 'mongoose';
import { StudentDocument, type IStudentDocument } from '../models/Work';
import Student from '../models/Student';
import { MasterItem } from '../models/Master';
import { uploadBuffer, signedFileUrl, destroyAsset, type MediaResourceType } from '../config/cloudinary';
import { bad } from './crm';

/** The client's file rules (legacy/server/files.js) on Cloudinary: PDF / JPG / PNG only, real file signature, size limit, versions. */

const TYPES: Record<string, { mime: string; sig: (b: Buffer) => boolean }> = {
  pdf: { mime: 'application/pdf', sig: (b) => b.subarray(0, 4).toString() === '%PDF' },
  jpg: { mime: 'image/jpeg', sig: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { mime: 'image/jpeg', sig: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  png: { mime: 'image/png', sig: (b) => b.subarray(0, 4).toString('hex') === '89504e47' },
};
export const ALLOWED = Object.keys(TYPES);

export function checkFile(f: Express.Multer.File, allowed: string[] = ALLOWED, maxMb = 10) {
  const ext = path.extname(f.originalname).slice(1).toLowerCase();
  const ok = (allowed.length ? allowed : ALLOWED).filter((x) => TYPES[x]);
  if (!ok.includes(ext)) throw bad(`"${f.originalname}": only PDF, JPG and PNG files are accepted`);
  if (f.size > maxMb * 1024 * 1024) throw bad(`File is larger than ${maxMb} MB`);
  if (!TYPES[ext].sig(f.buffer)) throw bad(`The file "${f.originalname}" is not a real ${ext.toUpperCase()} file`);
  if (ext === 'pdf' && /\/Encrypt\s/.test(f.buffer.toString('latin1'))) throw bad(`"${f.originalname}" is password protected. Please upload an unlocked PDF.`);
  return { ext: ext === 'jpeg' ? 'jpg' : ext, mime: TYPES[ext].mime };
}

/** Several PDFs / images into one PDF, pages in the order given (legacy files.mergeToPdf). */
export async function mergeToPdf(files: Express.Multer.File[]) {
  const out = await PDFDocument.create();
  for (const f of files) {
    const ext = path.extname(f.originalname).slice(1).toLowerCase();
    if (ext === 'pdf') {
      const src = await PDFDocument.load(f.buffer);
      for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
    } else {
      const img = ext === 'png' ? await out.embedPng(f.buffer) : await out.embedJpg(f.buffer);
      const page = out.addPage([595.28, 841.89]); // A4
      const scale = Math.min(555 / img.width, 800 / img.height, 1);
      page.drawImage(img, { x: (595.28 - img.width * scale) / 2, y: (841.89 - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
    }
  }
  return Buffer.from(await out.save({ useObjectStreams: true }));
}

const safeName = (s: string) => String(s || '').replace(/[&]/g, 'and').replace(/[^A-Za-z0-9 _().-]/g, '').replace(/\s+/g, '_').slice(0, 60);

/** One document row per type per student (Others: per title, linked rows: per application). */
export async function docFor(studentId: Types.ObjectId, typeId: Types.ObjectId, o: { title?: string; application_id?: Types.ObjectId | null; visa_case_id?: Types.ObjectId | null } = {}, userId?: string) {
  const t = await MasterItem.findById(typeId).select('name').lean();
  const f: Record<string, unknown> = { student_id: studentId, document_type_id: typeId, is_deleted: false };
  if (t?.name === 'Others') f.title = o.title ?? '';
  else if (o.application_id) f.application_id = o.application_id;
  let d = await StudentDocument.findOne(f).sort({ createdAt: 1 });
  if (!d) d = await StudentDocument.create({ student_id: studentId, document_type_id: typeId, title: o.title, application_id: o.application_id ?? undefined, visa_case_id: o.visa_case_id ?? undefined, status: 'Pending', created_by: userId });
  return d;
}

/** Store a file as the next version. Staff uploads are Verified at once; student / university uploads wait for a counsellor. */
export async function addVersion(doc: IStudentDocument, file: { buffer: Buffer; originalname: string; mimetype: string; size: number }, ext: string, userId: string, byType = 'staff', note?: string) {
  const [s, dt] = await Promise.all([Student.findById(doc.student_id).select('student_code').lean(), MasterItem.findById(doc.document_type_id).select('name').lean()]);
  const cur = doc.versions.find((x) => String(x._id) === String(doc.current_version_id));
  if (cur && !['Rejected', 'Verified'].includes(cur.version_status ?? '')) cur.version_status = 'Replaced';
  const v = (doc.versions.reduce((n, x) => Math.max(n, x.version_no), 0) || 0) + 1;
  const label = doc.title && dt?.name === 'Others' ? doc.title : dt?.name ?? 'Document';
  const stored = `${s?.student_code ?? 'student'}_${safeName(label)}_v${v}.${ext}`;
  const asset = await uploadBuffer({ ...file, originalname: stored } as Express.Multer.File, `students/${doc.student_id}/documents`);
  const auto = byType === 'staff';
  const id = new Types.ObjectId();
  doc.versions.push({ _id: id, version_no: v, url: asset.url, public_id: asset.publicId, resource_type: asset.resourceType, stored_name: stored, original_name: file.originalname,
    mime_type: file.mimetype, size_bytes: file.size, uploaded_by: new Types.ObjectId(userId), uploaded_by_type: byType, note_for_counsellor: note, uploaded_at: new Date(),
    version_status: auto ? 'Verified' : 'Uploaded' });
  doc.set({ current_version_id: id, status: auto ? 'Verified' : 'Uploaded', rejection_reason: undefined, rejection_text: undefined,
    verified_by: auto ? userId : undefined, verified_at: auto ? new Date() : undefined, updated_by: userId });
  await doc.save();
  return { id: String(id), version_no: v, stored_name: stored };
}

/** Save an uploaded file under a document type found by name (offer letter, fee receipt, visa files...). */
export async function saveAs(studentId: Types.ObjectId, typeName: string, file: Express.Multer.File, userId: string, o: { application_id?: Types.ObjectId; visa_case_id?: Types.ObjectId; title?: string | null; share?: boolean } = {}) {
  const t = await MasterItem.findOneAndUpdate({ type: 'document_type', name: typeName }, { $setOnInsert: { type: 'document_type', name: typeName, sort: 950 } }, { upsert: true, new: true });
  const { ext } = checkFile(file, ALLOWED, 25);
  const d = await docFor(studentId, t._id as Types.ObjectId, { title: o.title ?? undefined, application_id: o.application_id, visa_case_id: o.visa_case_id }, userId);
  if (o.visa_case_id) d.visa_case_id = o.visa_case_id;
  if (o.share !== undefined) d.shared_with_student = o.share;
  await addVersion(d, file, ext, userId);
  return { document_id: String(d._id), document: d };
}

/** A rejected document keeps only verified files: every other version's file is deleted (legacy deleteUnverifiedFiles). */
export async function deleteUnverifiedFiles(doc: IStudentDocument) {
  const keep = [...doc.versions].reverse().find((v) => v.url && v.version_status === 'Verified');
  for (const v of doc.versions) {
    if (v === keep || !v.public_id) continue;
    await destroyAsset(v.public_id, (v.resource_type as MediaResourceType) ?? 'raw');
    v.url = ''; v.public_id = undefined;
  }
  doc.current_version_id = keep?._id;
  await doc.save();
  return { restored_verified: !!keep };
}

/** Five-minute signed link to open a stored file. */
export const fileUrl = (v?: { url?: string; public_id?: string; resource_type?: string } | null) =>
  v?.url ? signedFileUrl(v.url, v.public_id, v.resource_type as MediaResourceType) : null;
