import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Response } from 'express';
import QRCode from 'qrcode';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import PortalAccount, { type IPortalAccount } from '../models/PortalAccount';

/** The client's shareable QR card (legacy/server/qrcard.js): A4 card with logo, title, text, QR, code, footer. PNG is the QR alone (no image library here). */

export type Card = { title: string; text: string; url: string; badge?: string; footer?: string[] };
const LOGO = (() => { try { const m = fs.readFileSync(path.join(__dirname, '..', '..', 'legal', 'vernyr-logo.svg'), 'utf8').match(/base64,([A-Za-z0-9+/=]+)/); return m ? Buffer.from(m[1], 'base64') : null; } catch { return null; } })();
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const wrap = (s: string, n: number) => { const out: string[] = []; let cur = ''; for (const w of String(s || '').split(/\s+/)) { if ((cur + ' ' + w).trim().length > n) { if (cur) out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } if (cur) out.push(cur); return out; };

export async function cardPdf(card: Card) {
  const doc = await PDFDocument.create(); doc.setTitle(card.title); doc.setProducer('La Europa CRM');
  const W = 595.28, H = 841.89, page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const center = (t: string, y: number, size: number, f = font, color = '#0B1020') => page.drawText(t, { x: (W - f.widthOfTextAtSize(t, size)) / 2, y, size, font: f, color: hex(color) });
  let y = H - 70;
  if (LOGO) { try { const img = await doc.embedPng(LOGO); const h = 92, w = img.width * h / img.height; page.drawImage(img, { x: (W - w) / 2, y: y - h, width: w, height: h }); y -= h + 34; } catch { /* logo is not a PNG */ } }
  for (const l of wrap(card.title, 30)) { center(l, y - 30, 30, bold); y -= 38; }
  y -= 6;
  for (const l of wrap(card.text, 62)) { center(l, y - 13, 13, font, '#5B6478'); y -= 19; }
  y -= 22;
  const qs = 330, qx = (W - qs) / 2, qy = y - qs - 18;
  page.drawRectangle({ x: qx - 18, y: qy, width: qs + 36, height: qs + 36, borderColor: hex('#E6E8F0'), borderWidth: 1.2, color: rgb(1, 1, 1) });
  const qr = await QRCode.toBuffer(card.url, { errorCorrectionLevel: 'M', margin: 1, width: 1200, color: { dark: '#0B1020', light: '#FFFFFF' } });
  page.drawImage(await doc.embedPng(qr), { x: qx, y: qy + 18, width: qs, height: qs });
  y = qy - 30;
  if (card.badge) { const size = 20, tw = bold.widthOfTextAtSize(card.badge, size); page.drawRectangle({ x: (W - tw) / 2 - 18, y: y - size - 10, width: tw + 36, height: size + 20, color: hex('#EEEDFD') }); center(card.badge, y - size + 1, size, bold, '#5B56E9'); y -= size + 34; }
  for (const l of card.footer ?? []) { center(l, y - 11, 11, font, '#5B6478'); y -= 16; }
  const foot = 'Euroverse Service LLP, trading as La Europa Education';
  page.drawText(foot, { x: (W - font.widthOfTextAtSize(foot, 9)) / 2, y: 34, size: 9, font, color: hex('#5B6478') });
  return Buffer.from(await doc.save());
}
export async function sendCard(res: Response, card: Card, name: string, format: string) {
  if (format === 'png') {
    res.setHeader('Content-Type', 'image/png'); res.setHeader('Content-Disposition', `attachment; filename="${name}.png"`);
    res.send(await QRCode.toBuffer(card.url, { errorCorrectionLevel: 'M', margin: 2, width: 900, color: { dark: '#0B1020', light: '#FFFFFF' } })); return;
  }
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
  res.send(await cardPdf(card));
}

/** the account's own referral code, made once for accounts that never got one (self sign-up) */
export async function referralCodeOf(su: IPortalAccount, preview = false) {
  if (su.referralCode) return su.referralCode;
  if (preview) return 'PREVIEW';
  for (let i = 0; i < 5; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const r = await PortalAccount.updateOne({ _id: su._id, referralCode: { $exists: false } }, { referralCode: code }).catch(() => null);
    if (r?.modifiedCount) { su.referralCode = code; return code; }
    const now = await PortalAccount.findById(su._id).select('referralCode').lean();
    if (now?.referralCode) { su.referralCode = now.referralCode; return now.referralCode; }
  }
  throw new Error('Could not make a referral code');
}
