import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import path from 'path';
import { env } from './env';

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

const root = () => env.cloudinary.folder.replace(/^\/+|\/+$/g, '');

export const mediaFolders = {
  studentDocuments: (studentId: string) => `${root()}/students/${studentId}/documents`,
  chatFiles:        (conversationId: string) => `${root()}/chat/${conversationId}/files`,
  chatVoice:        (conversationId: string) => `${root()}/chat/${conversationId}/voice`,
};

let configured = false;
function client() {
  if (!configured) {
    const { url, cloudName, apiKey, apiSecret } = env.cloudinary;
    const parsed = url ? new URL(url) : null;
    cloudinary.config({
      cloud_name: parsed?.hostname || cloudName,
      api_key:    parsed ? decodeURIComponent(parsed.username) : apiKey,
      api_secret: parsed ? decodeURIComponent(parsed.password) : apiSecret,
      secure: true,
    });
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

export class StorageRefusedError extends Error {}

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
        if (err || !result) {
          if (err?.http_code === 401 || err?.http_code === 403) {
            reject(new StorageRefusedError(`Cloudinary refused the upload (${err.http_code}) — the API key needs a role with asset create permission`));
            return;
          }
          reject(err ?? new Error('Cloudinary upload failed')); return;
        }
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

/**
 * A short-lived link that opens a stored file. Delivery URLs for raw files (PDF,
 * DOCX …) are refused on this account ("deny or ACL failure"), so files are
 * handed out through the signed Admin API download endpoint instead. Returns
 * null for anything that is not a Cloudinary asset.
 */
export function signedFileUrl(fileUrl?: string, publicId?: string, resourceType?: MediaResourceType): string | null {
  if (!fileUrl || !isCloudinaryConfigured()) return null;
  const parsed = fileUrl.match(/res\.cloudinary\.com\/[^/]+\/(image|video|raw)\/upload\/(?:s--[^/]+--\/)?(?:v\d+\/)?(.+)$/);
  if (!parsed && !publicId) return null;

  const type = resourceType ?? (parsed?.[1] as MediaResourceType);
  let id = publicId ?? decodeURIComponent(parsed![2]);
  let format = '';
  if (type !== 'raw' && !publicId) {
    const dot = id.lastIndexOf('.');
    if (dot > id.lastIndexOf('/')) { format = id.slice(dot + 1); id = id.slice(0, dot); }
  }
  if (type !== 'raw' && !format) format = path.extname(fileUrl.split('?')[0]).slice(1);

  return client().utils.private_download_url(id, format, {
    resource_type: type,
    type: 'upload',
    expires_at: Math.floor(Date.now() / 1000) + 300,
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
