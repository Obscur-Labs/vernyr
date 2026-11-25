import { env } from '../config/env';

// The client's one email design (legacy/server/emailtheme.js): white card on a soft ground, Vernyr logo + "La Europa Education",
// ink headings, indigo pill button, muted footer. Email-safe: tables, inline styles, PNG logo.
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const C = { ink: '#0B1020', muted: '#5B6478', line: '#E6E8F0', soft: '#F5F6FB', indigo: '#5B56E9', violet: '#8B5CF6', sky: '#3B82F6', white: '#FFFFFF' };
const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const HFONT = "'Outfit', 'Inter', 'Segoe UI', Helvetica, Arial, sans-serif";

function recolor(html: string) {
  return String(html || '')
    .replace(/#0f3d75|#1d5aa6|#0b3a75|#1d4f91/gi, C.indigo).replace(/#0f1e3a|#1e293b|#111827/gi, C.ink).replace(/#c9a227|#fbbf24|#f5b301/gi, C.violet)
    .replace(/#f1f5f9|#f8fafc|#f4f6fb|#f4f6fa/gi, C.soft).replace(/#e2e8f0|#cbd5e1/gi, C.line).replace(/#64748b|#475569/gi, C.muted)
    .replace(/(background:\s*#5B56E9;[^"]*?border-radius:\s*)\d+px/gi, '$1999px');
}
export const button = (url: string, label: string) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0"><tr><td style="border-radius:999px;background:${C.indigo};background-image:linear-gradient(135deg,${C.violet},${C.indigo} 50%,${C.sky})">
  <a href="${esc(url)}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:14px;font-weight:600;color:${C.white};text-decoration:none;border-radius:999px">${esc(label)} &rarr;</a></td></tr></table>`;

export function page(o: { title?: string; greeting?: string; body: string; cta?: { url: string; label?: string } | null; signature?: string; footer?: string; tag?: string; preheader?: string }) {
  const logo = `${env.crmUrl}/brand/vernyr-icon-192.png`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(o.title || 'La Europa Education')}</title></head>
<body style="margin:0;padding:0;background:${C.soft};-webkit-text-size-adjust:100%">
${o.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.soft}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.white};border:1px solid ${C.line};border-radius:20px;overflow:hidden">
<tr><td style="height:4px;line-height:4px;font-size:0;background:${C.indigo};background-image:linear-gradient(90deg,${C.violet},${C.indigo} 50%,${C.sky})">&nbsp;</td></tr>
<tr><td style="padding:20px 28px 8px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
  <td style="vertical-align:middle;padding-right:10px"><img src="${esc(logo)}" width="36" height="36" alt="Vernyr" style="display:block;border:0;width:36px;height:36px"></td>
  <td style="vertical-align:middle;font-family:${HFONT};font-size:18px;font-weight:700;color:${C.ink};letter-spacing:-0.2px">La Europa Education${o.tag ? ` <span style="font-family:${FONT};font-size:12px;font-weight:500;color:${C.muted}">&middot; ${esc(o.tag)}</span>` : ''}</td></tr></table></td></tr>
<tr><td style="padding:12px 28px 28px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.ink}">
  ${o.title ? `<h1 style="margin:0 0 16px;font-family:${HFONT};font-size:22px;line-height:1.3;font-weight:700;color:${C.ink};letter-spacing:-0.3px">${esc(o.title)}</h1>` : ''}
  ${o.greeting ? `<p style="margin:0 0 12px">${o.greeting}</p>` : ''}
  ${recolor(o.body)}
  ${o.cta?.url ? button(o.cta.url, o.cta.label || 'Open') : ''}
  ${o.signature ? `<div style="margin-top:20px;padding-top:16px;border-top:1px solid ${C.line}">${o.signature}</div>` : ''}
</td></tr>
${o.footer ? `<tr><td style="padding:16px 28px;background:${C.soft};font-family:${FONT};font-size:11.5px;line-height:1.6;color:${C.muted}">${esc(o.footer)}</td></tr>` : ''}
</table>
<p style="margin:14px 0 0;font-family:${FONT};font-size:11px;color:${C.muted}">Euroverse Service LLP, trading as La Europa Education</p>
</td></tr></table></body></html>`;
}
