/** The small, safe markdown of La Europa's legal texts (legacy/server/legal/md.js): # to #### headings, paragraphs, **bold**, "- " lists, pipe tables, "☐" consent boxes. */

export type Block = { k: 'h'; level: number; text: string } | { k: 'p'; text: string } | { k: 'li'; level: number; text: string } | { k: 'table'; rows: string[][] } | { k: 'check'; key: string | null; text: string; optional: boolean };
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const plain = (s: unknown) => String(s ?? '').replace(/\*\*/g, '');
const slug = (s: string) => plain(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';

export function parse(md: string): Block[] {
  const out: Block[] = [];
  for (const raw of String(md || '').replace(/\r/g, '').split(/\n{2,}/)) {
    const b = raw.trim();
    if (!b) continue;
    let m: RegExpMatchArray | null;
    if ((m = b.match(/^(#{1,4}) ([\s\S]+)$/))) out.push({ k: 'h', level: m[1].length, text: m[2].replace(/\s+/g, ' ').trim() });
    else if (/^\|/.test(b)) out.push({ k: 'table', rows: b.split('\n').filter((l) => !/^\|\s*(---\s*\|\s*)+$/.test(l.trim())).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())) });
    else if (/^\s*- /.test(b)) for (const l of b.split('\n')) {
      const mm = l.match(/^(\s*)- (.*)$/);
      const last = out[out.length - 1];
      if (mm) out.push({ k: 'li', level: Math.floor(mm[1].length / 2), text: mm[2] }); else if (last && 'text' in last) last.text += ' ' + l.trim();
    }
    else if (b.startsWith('☐')) { const box = b.slice(1).trim(); out.push({ k: 'check', key: (plain(box).match(/^([A-Z])\./) ?? [])[1] ?? null, text: box, optional: /\(optional\)/i.test(box) }); }
    else out.push({ k: 'p', text: b });
  }
  return out;
}
const inline = (s: string) => esc(s).replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

/** HTML plus a table of contents (chapters at levels 2-3; short documents list their level-4 sections). */
export function toHtml(md: string, opt: { idPrefix?: string; checkboxes?: boolean } = {}) {
  const ids = new Set<string>();
  const toc: { id: string; level: number; text: string }[] = [];
  let html = '', inList = 0;
  const closeList = () => { while (inList > 0) { html += '</ul>'; inList--; } };
  for (const b of parse(md)) {
    if (b.k !== 'li') closeList();
    if (b.k === 'h') {
      let id = (opt.idPrefix ?? '') + slug(b.text), n = 2;
      while (ids.has(id)) id = (opt.idPrefix ?? '') + slug(b.text) + '-' + n++;
      ids.add(id);
      const lv = Math.min(4, Math.max(2, b.level));
      toc.push({ id, level: lv, text: plain(b.text) });
      html += `<h${lv} id="${id}">${esc(plain(b.text))}</h${lv}>`;
    } else if (b.k === 'p') html += `<p>${inline(b.text)}</p>`;
    else if (b.k === 'li') { while (inList < b.level + 1) { html += '<ul>'; inList++; } while (inList > b.level + 1) { html += '</ul>'; inList--; } html += `<li>${inline(b.text)}</li>`; }
    else if (b.k === 'table') html += `<div class="md-table"><table>${b.rows.map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('')}</table></div>`;
    else html += opt.checkboxes && b.key
      ? `<label class="md-check"><input type="checkbox" data-consent="${b.key}"${b.optional ? '' : ' data-required="1"'}> <span>${inline(b.text)}</span></label>`
      : `<p class="md-box"><span class="md-sq">&#9744;</span> ${inline(b.text)}</p>`;
  }
  closeList();
  const top = toc.filter((x) => x.level <= 3);
  return { html, toc: top.length >= 4 ? top : toc.filter((x) => x.level >= 3).map((x) => ({ ...x, level: 2 })) };
}
