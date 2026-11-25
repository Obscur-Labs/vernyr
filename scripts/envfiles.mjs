// Shared by doctor.mjs and deploy-env.mjs: where each app's env lives and what it needs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env reader: KEY=value lines, # comments, optional quotes. */
export function readEnv(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return null;
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/**
 * What each deployed service needs, in live mode.
 * `from` is the key in the local .env file; `as` is the name on the host (defaults to the same).
 */
export const SERVICES = {
  render: {
    title: 'Render: studycrm-api (backend)',
    file: 'backend/.env',
    fixed: { NODE_ENV: 'production', MODE: 'live' },
    keys: ['LIVE_MONGODB_URI', 'LIVE_CLIENT_CRM_URL', 'LIVE_CLIENT_STUDENT_URL', 'LIVE_CLIENT_PARTNER_URL', 'JWT_SECRET', 'JWT_EXPIRES_IN',
      'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'CLOUDINARY_FOLDER'],
    // copied when set: real email (login codes, password resets, student sign-up)
    optional: ['MAIL_PROVIDER', 'MAIL_FROM', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'MAIL_REDIRECT_TO'],
    secret: true,
  },
  crm: {
    title: 'Vercel: admin portal (root directory crm)',
    file: 'crm/.env',
    fixed: { NEXT_PUBLIC_MODE: 'live' },
    keys: ['NEXT_PUBLIC_LIVE_API_ORIGIN', 'NEXT_PUBLIC_LIVE_STUDENT_URL'],
  },
  portal: {
    title: 'Vercel: student portal (root directory portal)',
    file: 'portal/.env',
    fixed: { NEXT_PUBLIC_MODE: 'live' },
    keys: ['NEXT_PUBLIC_LIVE_API_ORIGIN'],
  },
  partner: {
    title: 'Vercel: university partner portal (root directory partner)',
    file: 'partner/.env',
    fixed: { NEXT_PUBLIC_MODE: 'live' },
    keys: ['NEXT_PUBLIC_LIVE_API_ORIGIN'],
  },
  website: {
    title: 'Vercel: public website (root directory website)',
    file: null,
    fixed: {},
    keys: [],
  },
};

export function dbName(uri) {
  try { return new URL(uri).pathname.replace(/^\//, ''); } catch { return null; }
}
export function hostOf(uri) {
  try { return new URL(uri).host; } catch { return null; }
}
