import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import path from 'path';

/**
 * Cloudinary is the single storage backend for every user-uploaded file.
 * Nothing is written to the local disk — multer buffers in memory and the
 * buffer is streamed straight through to Cloudinary.
 *
 * Folder layout (root is configurable via CLOUDINARY_FOLDER):
 *
 *   la-europa-docs/
 *     students/<studentId>/documents/     ← passports, marksheets, SOPs …
 *     chat/<conversationId>/files/        ← attachments shared in a chat
 *     chat/<conversationId>/voice/        ← voice notes
 */

export type MediaResourceType = 'image' | 'video' | 'raw';

export interface UploadedFile {
  /** Absolute https URL — stored verbatim in `fileUrl` fields */
  url: string;
  /** Cloudinary public id, needed to delete the asset later */
  publicId: string;
  resourceType: MediaResourceType;
  bytes: number;
}

// Read per call rather than at module load — see the note on `client()` below.
const root = () => (process.env.CLOUDINARY_FOLDER || 'la-europa-docs').replace(/^\/+|\/+$/g, '');

export const mediaFolders = {
  studentDocuments: (studentId: string) => `${root()}/students/${studentId}/documents`,
  chatFiles:        (conversationId: string) => `${root()}/chat/${conversationId}/files`,
  chatVoice:        (conversationId: string) => `${root()}/chat/${conversationId}/voice`,
};

// Configured lazily: `dotenv.config()` runs after this module is imported,
// so reading env at module load would see an empty process.env.
let configured = false;
function client() {
  if (!configured) {
    // CLOUDINARY_URL (cloudinary://key:secret@cloud) is picked up automatically.
    if (!process.env.CLOUDINARY_URL) {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key:    process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });
    }
    cloudinary.config({ secure: true });
    configured = true;
  }
  return cloudinary;
}

export function isCloudinaryConfigured(): boolean {
  const { cloud_name, api_key, api_secret } = client().config();
  return !!(cloud_name && api_key && api_secret);
}

/**
 * Images and audio/video go up as their native types so Cloudinary can
 * transform and stream them. Everything else (PDF, DOCX, ZIP …) is stored as
 * `raw` so it is delivered byte-for-byte, unaffected by the account's PDF
 * delivery restrictions.
 */
export function resourceTypeFor(mimetype: string): MediaResourceType {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('audio/') || mimetype.startsWith('video/')) return 'video';
  return 'raw';
}

/** Stream an in-memory multer file to Cloudinary. */
export function uploadBuffer(file: Express.Multer.File, folder: string): Promise<UploadedFile> {
  const resourceType = resourceTypeFor(file.mimetype);
  const ext  = path.extname(file.originalname).toLowerCase();
  const base = path.basename(file.originalname, ext).replace(/[^\w-]+/g, '_').slice(0, 60) || 'file';
  // `raw` assets keep whatever public id they are given, so the extension has
  // to be part of it for the delivery URL to end in `.pdf`, `.docx`, etc.
  const publicId = `${Date.now()}-${base}${resourceType === 'raw' ? ext : ''}`;

  return new Promise((resolve, reject) => {
    const stream = client().uploader.upload_stream(
      { folder, public_id: publicId, resource_type: resourceType, overwrite: false },
      (err, result) => {
        if (err || !result) { reject(err ?? new Error('Cloudinary upload failed')); return; }
        resolve({
          url:          result.secure_url,
          publicId:     result.public_id,
          resourceType,
          bytes:        result.bytes,
        });
      },
    );
    Readable.from(file.buffer).pipe(stream);
  });
}

/** Best-effort delete — never throws, the DB record stays the source of truth. */
export async function destroyAsset(publicId?: string, resourceType: MediaResourceType = 'raw'): Promise<void> {
  if (!publicId || !isCloudinaryConfigured()) return;
  try {
    await client().uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
  } catch {
    /* ignore — an orphaned asset is preferable to a failed request */
  }
}

export default cloudinary;
