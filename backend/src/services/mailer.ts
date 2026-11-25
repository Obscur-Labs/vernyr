import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { env } from '../config/env';

/** One way to send an email. Sandbox mode writes a real .eml file and never contacts anyone. */

const OUTBOX = path.join(process.cwd(), 'outbox');

const transport = env.mail.provider === 'smtp'
  ? nodemailer.createTransport({
      host: env.mail.host,
      port: env.mail.port,
      secure: env.mail.secure,
      auth: env.mail.user ? { user: env.mail.user, pass: env.mail.pass } : undefined,
    })
  : nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });

export interface Mail { to: string; subject: string; text: string; html?: string }

export async function sendMail(mail: Mail): Promise<void> {
  const to = env.mail.redirectTo || mail.to;
  const info = await transport.sendMail({ from: env.mail.from, to, subject: mail.subject, text: mail.text, html: mail.html });
  if (env.mail.provider === 'smtp') return;
  fs.mkdirSync(OUTBOX, { recursive: true });
  const file = path.join(OUTBOX, `${new Date().toISOString().replace(/[:.]/g, '-')}.eml`);
  fs.writeFileSync(file, (info as { message: Buffer }).message);
  // local development: the code is on the console, so nobody needs a mailbox to sign in
  console.log(`[mail:sandbox] to ${to}: ${mail.subject}${env.mode === 'local' ? `\n${mail.text}` : ''}`);
}

export const mailReady = () => env.mail.provider === 'smtp' && !!env.mail.host;
