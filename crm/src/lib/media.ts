import { apiOrigin } from './config';

/**
 * Uploads live on Cloudinary and are stored as absolute https URLs. Records
 * created before that migration still hold a relative `/uploads/…` path served
 * by the backend, so those get the API origin prepended.
 */
export function fileHref(fileUrl?: string): string {
  if (!fileUrl) return '';
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  return `${apiOrigin}${fileUrl}`;
}
