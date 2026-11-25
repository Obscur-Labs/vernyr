import crypto from 'crypto';
import mongoose from 'mongoose';
import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { env } from '../config/env';
import { can } from '../config/clientPerms';
import { Timeline } from '../models/Timeline';
import User from '../models/User';
import { serverError } from '../utils/httpError';

/** Shared helpers for the modules ported from the client's server (legacy/server/util.js, db.js, rbac.js). */

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}
export const bad = (message: string, extra: Record<string, unknown> = {}) => new HttpError(400, message, extra);
export const fieldErr = (field: string, message: string) => bad(message, { errors: { [field]: message } });
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`);
export const forbidden = () => new HttpError(403, 'You do not have access to this record');

/** Route wrapper: client-style errors `{ error, ...extra }`, anything else a bare 500. */
export const handle = (fn: (req: AuthRequest, res: Response) => Promise<unknown>) => async (req: AuthRequest, res: Response) => {
  try { await fn(req, res); } catch (err) {
    if (err instanceof HttpError) { res.status(err.status).json({ error: err.message, ...err.extra }); return; }
    serverError(res, err);
  }
};

export const need = (req: AuthRequest, module: string, action = 'view') => { if (!can(req.user!.role, module, action)) throw forbidden(); };
export const isAdmin = (req: AuthRequest) => req.user!.role === 'admin';
export const seesAll = (req: AuthRequest) => ['admin', 'manager'].includes(req.user!.role);
export const me = (req: AuthRequest) => new mongoose.Types.ObjectId(req.user!.id);

export const oid = (v: unknown) => (typeof v === 'string' && mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(v) : v instanceof mongoose.Types.ObjectId ? v : null);
export const sid = (v: unknown) => (v ? String(v) : null);
export const clean = (v: unknown, max = 500) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : undefined; };
export const num = (v: unknown) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? undefined : Number(v));
export const normPhone = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : d || undefined; };
export const isEmail = (e: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e ?? ''));
export const fullName = (s: { first_name?: string; middle_name?: string; last_name?: string }) => [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(' ');
export const escRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- IST dates (the client stores UTC and shows IST) ----------
const TZ = 'Asia/Kolkata';
export const istDate = (d: Date = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ });
export const istDayStart = (day: string) => new Date(`${day}T00:00:00+05:30`);
export const addDays = (day: string, n: number) => istDate(new Date(+istDayStart(day) + n * 86_400_000 + 3_600_000));
export const fmtTime = (d: Date | string) => new Date(d).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true });
export const fmtDateTime = (d: Date | string) => new Date(d).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });

export const timeline = (e: { lead_id?: unknown; student_id?: unknown; type: string; description: string; data?: unknown; user_id?: string }) => Timeline.create(e);

/** id -> name for every staff user, loaded once per request. */
export async function userNames() {
  const rows = await User.find().select('name').lean();
  return new Map(rows.map((u) => [String(u._id), u.name]));
}
export const nameIn = (map: Map<string, string>, id: unknown) => (id ? map.get(String(id)) ?? '' : '');

// ---------- passport numbers: AES-256-GCM at rest, HMAC for uniqueness (legacy db.js encrypt / hmac) ----------
// Key derived from JWT_SECRET so no extra secret has to be set on the host. Rotating JWT_SECRET means re-encrypting passports.
const KEY = crypto.createHash('sha256').update('vernyr-data-key:' + env.jwtSecret).digest();
export function encrypt(plain: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const out = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), out].map((b) => b.toString('base64')).join('.');
}
export function decrypt(blob?: string | null) {
  if (!blob) return null;
  try {
    const [iv, tag, data] = blob.split('.').map((x) => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch { return null; }
}
export const hmac = (v: string) => crypto.createHmac('sha256', KEY).update(v).digest('hex');
export const maskPassport = (p?: string | null) => (!p ? '' : p.length <= 4 ? 'XXXX' : p.slice(0, 3) + 'X'.repeat(Math.max(1, p.length - 4)) + p.slice(-1));
export const validPassport = (p: string, nationality?: string) =>
  !nationality || nationality === 'Indian' ? /^[A-Z][0-9]{7}$/.test(p) : /^[A-Z0-9]{6,12}$/.test(p);
