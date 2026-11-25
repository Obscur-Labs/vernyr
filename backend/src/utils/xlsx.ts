import fs from 'fs';
import zlib from 'zlib';

/**
 * A read-only .xlsx reader with no dependencies.
 *
 * The catalogue arrives as one workbook per country, so the alternative was a
 * spreadsheet library in the runtime dependencies for a job that runs from a
 * script. A zip directory walk plus `inflateRaw` is the whole of it.
 */

interface ZipEntry { name: string; data: Buffer }

const EOCD = 0x06054b50;
const CEN = 0x02014b50;

function readZip(file: string): Map<string, Buffer> {
  const buf = fs.readFileSync(file);
  const out = new Map<string, Buffer>();

  // The end-of-central-directory record sits within 64K of the tail.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`${file} is not a zip archive`);

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CEN) break;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // The local header repeats the name and carries its own extra field, whose
    // length rarely matches the central one — so read it rather than reuse it.
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressedSize);

    out.set(name, method === 0 ? raw : zlib.inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
};

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m]);
}

/** Every <t> inside one element, concatenated — rich text is split across runs. */
function textOf(fragment: string): string {
  const parts = [...fragment.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1]));
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** `BC` → 54. */
function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel's day serial → ISO date. Day 60 is its imaginary 1900-02-29. */
export function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 200000) return null;
  const days = serial > 59 ? serial - 1 : serial;
  return new Date(Date.UTC(1899, 11, 31) + days * 86400000);
}

export interface Sheet { name: string; rows: string[][] }

export function readWorkbook(file: string): Sheet[] {
  const zip = readZip(file);
  const read = (name: string) => zip.get(name)?.toString('utf8') ?? '';

  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  const rels: Record<string, string> = {};
  for (const m of read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    rels[m[1]] = m[2];
  }

  const sheets: Sheet[] = [];
  for (const m of read('xl/workbook.xml').matchAll(/<sheet[^>]*?name="([^"]*)"[^>]*?r:id="([^"]+)"[^>]*\/?>/g)) {
    const name = decode(m[1]).trim();
    let target = (rels[m[2]] ?? '').replace(/^\//, '');
    if (!target) continue;
    if (!target.startsWith('xl/')) target = 'xl/' + target;
    const xml = read(target);
    if (!xml) continue;

    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
        const i = colIndex(c[1]);
        const body = c[3];
        const type = /t="([^"]+)"/.exec(c[2])?.[1];
        let value = '';
        if (type === 's') {
          const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
          value = v !== undefined ? shared[Number(v)] ?? '' : '';
        } else if (type === 'inlineStr') {
          value = textOf(body);
        } else {
          value = decode(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '').trim();
        }
        while (cells.length < i) cells.push('');
        cells[i] = value;
      }
      rows.push(cells);
    }
    sheets.push({ name, rows });
  }
  return sheets;
}
