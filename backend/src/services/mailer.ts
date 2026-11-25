import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { env } from '../config/env';

/** One way to send an email (legacy/server/mailer.js). Sandbox mode writes a real .eml file and never contacts anyone. */

const OUTBOX = path.join(process.cwd(), 'outbox');

const transport = env.mail.provider === 'smtp'
  ? nodemailer.createTransport({
      host: env.mail.host, port: env.mail.port, secure: env.mail.secure,
      auth: env.mail.user ? { user: env.mail.user, pass: env.mail.pass } : undefined,
    })
  : nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });

export interface Mail {
  to: string; subject: string; text: string; html?: string; from?: string; cc?: string[]; replyTo?: string;
  messageId?: string; inReplyTo?: string; references?: string; attachments?: { filename: string; content: Buffer }[];
}
/** A permanent failure (bad address, mailbox gone): the address is marked Bounced and not retried. */
export class HardBounce extends Error { hard = true; }

export async function send(mail: Mail): Promise<{ status: 'Sent' | 'Delivered' }> {
  // staging safety: every email goes to one address; the CC is dropped so nobody else is emailed
  const to = env.mail.redirectTo || mail.to;
  const cc = env.mail.redirectTo ? undefined : mail.cc;
  try {
    const info = await transport.sendMail({ ...mail, from: mail.from ?? env.mail.from, to, cc });
    if (env.mail.provider !== 'smtp') {
      fs.mkdirSync(OUTBOX, { recursive: true });
      fs.writeFileSync(path.join(OUTBOX, `${new Date().toISOString().replace(/[:.]/g, '-')}.eml`), (info as unknown as { message: Buffer }).message);
      // local development: the email is on the console, so nobody needs a mailbox to test
      console.log(`[mail:sandbox] to ${to}${cc?.length ? ` cc ${cc.join(', ')}` : ''}: ${mail.subject}${env.mode === 'local' ? `\n${mail.text.slice(0, 600)}` : ''}`);
    }
    return { status: 'Sent' };
  } catch (e) {
    const code = Number((e as { responseCode?: number }).responseCode);
    if (code >= 550 && code < 560) throw new HardBounce((e as Error).message);
    throw e;
  }
}

/** Plain text email (security codes, staff notices). */
export const sendMail = (m: { to: string; subject: string; text: string; html?: string }) => send(m);

export const mailReady = () => env.mail.provider === 'smtp' && !!env.mail.host;
