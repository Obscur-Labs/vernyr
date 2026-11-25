import crypto from 'crypto';
import mongoose from 'mongoose';
import AuthCode, { type AuthCodePurpose, type IAuthCode } from '../models/AuthCode';
import { sendMail } from './mailer';

/** 6-digit email codes: 10 minutes, 5 wrong tries, 3 resends, 6 sends per account per hour (client rules). */

const TTL_MS = 10 * 60_000;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

export class CodeError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type App = 'crm' | 'portal' | 'partner';
const brand = (app: App) => (app === 'crm' ? 'La Europa CRM' : 'La Europa');

function text(app: App, purpose: AuthCodePurpose, code: string) {
  return purpose !== 'reset'
    ? { subject: `Your ${brand(app)} verification code`, text: `Your ${brand(app)} verification code is ${code}.\n\nYou need it only for your first login. It is valid for 10 minutes.` }
    : { subject: `Your ${brand(app)} password reset code`, text: `Your password reset code is ${code}.\n\nIt is valid for 10 minutes. If you did not ask for this, ignore this email.` };
}

export const maskEmail = (email: string) => {
  const [user, domain] = email.split('@');
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
};

async function sentLastHour(accountId: unknown) {
  const since = new Date(Date.now() - 3_600_000);
  const rows = await AuthCode.find({ accountId, lastSentAt: { $gt: since } }).select('resends').lean();
  return rows.reduce((n, r) => n + 1 + (r.resends || 0), 0);
}

export async function issueCode(opts: { accountId: mongoose.Types.ObjectId; email: string; purpose: AuthCodePurpose; app: App; remember?: boolean;
  payload?: Record<string, unknown>; mail?: { subject: string; text: (code: string) => string } }) {
  if ((await sentLastHour(opts.accountId)) >= 6) throw new CodeError(429, 'Too many codes. Please try again in an hour.');
  // a new code cancels the older ones for the same purpose
  await AuthCode.updateMany({ accountId: opts.accountId, purpose: opts.purpose, used: false }, { used: true });
  const code = newCode();
  const row = new AuthCode({ accountId: opts.accountId, purpose: opts.purpose, remember: !!opts.remember, codeHash: 'x', expiresAt: new Date(Date.now() + TTL_MS), destination: opts.email, payload: opts.payload });
  row.codeHash = sha(row._id.toString() + code);
  await row.save();
  await sendMail({ to: opts.email, ...(opts.mail ? { subject: opts.mail.subject, text: opts.mail.text(code) } : text(opts.app, opts.purpose, code)) });
  return row._id.toString();
}

/** Checks a code. `keep` leaves it unused, for the reset flow that marks it used atomically later. */
export async function checkCode(otpId: unknown, code: unknown, purpose: AuthCodePurpose, keep = false): Promise<IAuthCode> {
  const expired = purpose === 'reset' ? 'The code has expired. Please request a new one.' : 'The code has expired. Please log in again.';
  if (typeof otpId !== 'string' || !mongoose.isValidObjectId(otpId)) throw new CodeError(400, expired);
  const row = await AuthCode.findOne({ _id: otpId, used: false, purpose });
  if (!row || row.expiresAt < new Date()) throw new CodeError(400, expired);
  if (row.attempts >= 5) throw new CodeError(400, 'Too many wrong codes. Please request a new one.');
  const given = Buffer.from(sha(row._id.toString() + String(code ?? '').trim()));
  const want = Buffer.from(row.codeHash);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    row.attempts += 1; await row.save();
    throw new CodeError(400, `Wrong code. ${Math.max(0, 5 - row.attempts)} attempt(s) left.`);
  }
  if (!keep) { row.used = true; await row.save(); }
  return row;
}

/** Marks a kept code used; false when a parallel request already used it. */
export async function useCode(row: IAuthCode) {
  const r = await AuthCode.updateOne({ _id: row._id, used: false }, { used: true });
  return r.modifiedCount === 1;
}

export async function resendCode(otpId: unknown, email: string, app: App) {
  if (typeof otpId !== 'string' || !mongoose.isValidObjectId(otpId)) throw new CodeError(400, 'Please start again.');
  const row = await AuthCode.findOne({ _id: otpId, used: false });
  if (!row) throw new CodeError(400, 'Please start again.');
  if (Date.now() - row.lastSentAt.getTime() < 30_000) throw new CodeError(400, 'Please wait 30 seconds before requesting a new code.');
  if (row.resends >= 3 || row.attempts >= 5) throw new CodeError(400, 'Too many codes. Please start again.');
  if ((await sentLastHour(row.accountId)) >= 6) throw new CodeError(429, 'Too many codes. Please try again in an hour.');
  const code = newCode();
  row.codeHash = sha(row._id.toString() + code);
  row.resends += 1; row.lastSentAt = new Date(); row.expiresAt = new Date(Date.now() + TTL_MS);
  await row.save();
  await sendMail({ to: email, ...text(app, row.purpose, code) });
}

export const cancelCodes = (accountId: unknown, purpose: AuthCodePurpose) =>
  AuthCode.updateMany({ accountId, purpose, used: false }, { used: true });
