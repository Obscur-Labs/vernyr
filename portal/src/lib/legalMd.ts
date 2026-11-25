// The client's tiny, safe markdown for La Europa's legal texts (from legacy/server/legal/md.js).
// Headings, paragraphs, **bold**, "- " lists, pipe tables, "☐" boxes. Everything is HTML-escaped first.
import fs from 'node:fs';
import path from 'node:path';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const plain = (s: string) => s.replace(/\*\*/g, '');
const slug = (s: string) => plain(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
const inline = (s: string) => esc(s).replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

type Block =
  | { k: 'h'; level: number; text: string } | { k: 'p'; text: string } | { k: 'li'; level: number; text: string }
  | { k: 'table'; rows: string[][] } | { k: 'check'; text: string };

function parse(md: string): Block[] {
  const out: Block[] = [];
  for (const raw of md.replace(/\r/g, '').split(/\n{2,}/)) {
    const b = raw.trim(); if (!b) continue;
    let m: RegExpMatchArray | null;
    if ((m = b.match(/^(#{1,4}) ([\s\S]+)$/))) out.push({ k: 'h', level: m[1].length, text: m[2].replace(/\s+/g, ' ').trim() });
    else if (/^\|/.test(b)) {
      const rows = b.split('\n').filter((l) => !/^\|\s*(---\s*\|\s*)+$/.test(l.trim()))
        .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      out.push({ k: 'table', rows });
    } else if (/^\s*- /.test(b)) {
      for (const l of b.split('\n')) {
        const mm = l.match(/^(\s*)- (.*)$/);
        if (mm) out.push({ k: 'li', level: Math.floor(mm[1].length / 2), text: mm[2] });
        else { const last = out[out.length - 1]; if (last && 'text' in last) last.text += ' ' + l.trim(); }
      }
    } else if (b.startsWith('☐')) out.push({ k: 'check', text: b.slice(1).trim() });
    else out.push({ k: 'p', text: b });
  }
  return out;
}

export function toHtml(md: string) {
  const ids = new Set<string>(); const toc: { id: string; level: number; text: string }[] = [];
  let html = ''; let inList = 0;
  const closeList = () => { while (inList > 0) { html += '</ul>'; inList--; } };
  for (const b of parse(md)) {
    if (b.k !== 'li') closeList();
    if (b.k === 'h') {
      let id = slug(b.text); let n = 2; while (ids.has(id)) id = slug(b.text) + '-' + n++; ids.add(id);
      const lv = Math.min(4, Math.max(2, b.level));
      toc.push({ id, level: lv, text: plain(b.text) });
      html += `<h${lv} id="${id}">${esc(plain(b.text))}</h${lv}>`;
    } else if (b.k === 'p') html += `<p>${inline(b.text)}</p>`;
    else if (b.k === 'li') {
      while (inList < b.level + 1) { html += '<ul>'; inList++; }
      while (inList > b.level + 1) { html += '</ul>'; inList--; }
      html += `<li>${inline(b.text)}</li>`;
    } else if (b.k === 'table') html += `<div class="md-table"><table>${b.rows.map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('')}</table></div>`;
    else html += `<p class="md-box"><span class="md-sq">&#9744;</span> ${inline(b.text)}</p>`;
  }
  closeList();
  const top = toc.filter((x) => x.level <= 3);
  return { html, toc: top.length >= 4 ? top : toc.filter((x) => x.level >= 3).map((x) => ({ ...x, level: 2 })) };
}

export const LEGAL_PAGES = [
  { slug: 'student-constitution', file: 'student-constitution-v3.0.md', title: 'Student Constitution (Terms & Conditions)' },
  { slug: 'privacy-policy', file: 'privacy-policy-v1.0.md', title: 'Privacy Policy' },
  { slug: 'refund-policy', file: 'refund-cancellation-policy-v1.0.md', title: 'Refund & Cancellation Policy' },
  { slug: 'cookie-notice', file: 'cookie-storage-notice-v1.0.md', title: 'Cookie & Storage Notice' },
  { slug: 'student-consent', file: 'student-consent-declaration-v1.0.md', title: 'Student Declaration & Consent' },
] as const;

export function readLegal(file: string) {
  return fs.readFileSync(path.join(process.cwd(), 'src', 'legal', file), 'utf8');
}
