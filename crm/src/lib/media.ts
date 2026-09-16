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

/**
 * Open a stored file in a new tab. The server checks access and answers with a
 * five-minute link — PDFs and other raw files cannot be opened by their stored URL.
 * The tab is opened before the request so popup blockers treat it as the click's.
 */
export async function openStoredFile(path: string): Promise<void> {
  const { default: api } = await import('./api');
  const tab = window.open('about:blank', '_blank');
  try {
    const { data } = await api.get<{ url: string }>(path);
    if (tab) tab.location.href = data.url;
    else window.location.href = data.url;
  } catch (err) {
    tab?.close();
    throw err;
  }
}
