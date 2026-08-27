import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { env } from '../config/env';
import University from '../models/University';
import Course from '../models/Course';
import { readWorkbook, type Sheet } from '../utils/xlsx';
import {
  bannerLevel, fieldFor, looksLikeHeader, rowToCourse, slugify,
  type CourseDraft, type Field,
} from '../services/catalogue';

/**
 * Imports the course catalogue from a folder of workbooks.
 *
 *   npm run import:courses -- --dir "C:/path/to/courses data"          (dry run)
 *   npm run import:courses -- --dir "..." --apply
 *
 * One workbook per country, one sheet per university, one row per course. The
 * shape is consistent; the spelling is not, which is what `services/catalogue`
 * absorbs. Re-running is safe: everything upserts on a natural key.
 */

/* ── Country from a file name ────────────────────────────────────────────── */

/** The workbooks are named for the adjective as often as the country. */
const COUNTRY_ALIASES: Record<string, string> = {
  estonian: 'Estonia',
  chinese: 'China',
  swiss: 'Switzerland',
  irish: 'Ireland',
  ireland: 'Ireland',
  portuguese: 'Portugal',
  spanish: 'Spain',
  greek: 'Greece',
  danish: 'Denmark',
  belgian: 'Belgium',
  croatian: 'Croatia',
  hungarian: 'Hungary',
  romanian: 'Romania',
  slovakian: 'Slovakia',
  slovak: 'Slovakia',
  austrian: 'Austria',
  czech: 'Czech Republic',
  'czech republic': 'Czech Republic',
};

const NOISE = /\b(universit(y|ies)|list|new|final|updated|data|sheet|courses?)\b/gi;

export function countryFromFileName(file: string): string {
  const base = path.basename(file, path.extname(file));
  const cleaned = base
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[._\-]+/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const key = cleaned.toLowerCase();
  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key];

  const firstWord = key.split(' ')[0];
  if (COUNTRY_ALIASES[firstWord]) return COUNTRY_ALIASES[firstWord];

  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase()) || 'Unknown';
}

/* ── Directory sheets ────────────────────────────────────────────────────── */

/** A "University list of X" sheet: name in one column, official site in the next. */
function isDirectorySheet(sheet: Sheet): boolean {
  if (!/list|universit/i.test(sheet.name)) return false;
  return !sheet.rows.some(looksLikeHeader);
}

interface Directory { name: string; website?: string }

function readDirectory(sheet: Sheet): Directory[] {
  const out: Directory[] = [];
  for (const row of sheet.rows) {
    const name = row[0]?.trim();
    if (!name || name.length < 4 || /^https?:/i.test(name)) continue;
    if (/^university list|^official website|^name$/i.test(name)) continue;
    const website = row.slice(1).find((c) => /^https?:/i.test(c?.trim() ?? ''))?.trim();
    out.push({ name, website });
  }
  return out;
}

/**
 * Excel truncates a sheet name at 31 characters, so "Estonian University of Life
 * Sci" is the same institution as the directory's full entry. Match on prefix.
 */
function resolveUniversity(sheetName: string, directory: Directory[]): Directory {
  const trimmed = sheetName.trim();
  const key = slugify(trimmed);
  const exact = directory.find((d) => slugify(d.name) === key);
  if (exact) return exact;
  const prefixed = directory.find((d) => slugify(d.name).startsWith(key) && key.length >= 12);
  return prefixed ?? { name: trimmed };
}

const GENERIC_SHEET = /^(sheet|tabelle|hoja|feuil)\s*\d*$/i;

/* ── One sheet → courses ─────────────────────────────────────────────────── */

/** A name alone is a stray note; a real row carries at least one other fact. */
function isSubstantial(draft: CourseDraft): boolean {
  return !!(draft.link || draft.duration?.text || draft.tuition?.text ||
    draft.applicationFee?.text || draft.intakes.length || draft.deadline?.text ||
    draft.examText || draft.discipline);
}

export interface SheetResult {
  universityName: string;
  website?: string;
  courses: CourseDraft[];
  skipped: number;
}

export function parseSheet(sheet: Sheet, directory: Directory[], country: string): SheetResult | null {
  const headerIndex = sheet.rows.findIndex(looksLikeHeader);
  if (headerIndex < 0) return null;

  const headerText = sheet.rows[headerIndex].map((c) => (c ?? '').trim());
  const headers: (Field | null)[] = headerText.map((c) => (c ? fieldFor(c) : null));
  // A second column mapping to the same field (two fee columns, say) would
  // shadow the first via indexOf — leave it unmapped so it lands in extras.
  const seen = new Set<Field>();
  headers.forEach((f, i) => {
    if (!f) return;
    if (seen.has(f)) headers[i] = null;
    else seen.add(f);
  });

  let resolved: Directory;
  if (GENERIC_SHEET.test(sheet.name)) {
    // Ireland and Luxembourg keep the institution in a title row above the
    // table instead of in the tab name.
    const title = sheet.rows.slice(0, headerIndex)
      .map((r) => r.filter((c) => c?.trim()))
      .filter((cells) => cells.length === 1)
      .map((cells) => cells[0].trim())
      // A lone "Bachelor's" above the table is a level banner, not a name.
      .filter((t) => t.length > 3 && slugify(t) !== slugify(country) && !bannerLevel([t]))
      .pop();
    resolved = title ? resolveUniversity(title, directory) : { name: `${country} (unassigned)` };
  } else {
    resolved = resolveUniversity(sheet.name, directory);
  }

  const courses: CourseDraft[] = [];
  let skipped = 0;
  let level: ReturnType<typeof bannerLevel> = null;

  for (const row of sheet.rows.slice(headerIndex + 1)) {
    if (!row.some((c) => c?.trim())) continue;
    const banner = bannerLevel(row);
    if (banner) { level = banner; continue; }

    const draft = rowToCourse(row, headers, headerText, level);
    if (!draft) { skipped++; continue; }
    if (!isSubstantial(draft)) { skipped++; continue; }
    courses.push(draft);
  }

  return { universityName: resolved.name, website: resolved.website, courses, skipped };
}

/* ── Whole workbook ──────────────────────────────────────────────────────── */

export interface FileResult {
  file: string;
  country: string;
  universities: SheetResult[];
  directoryOnly: Directory[];
}

export function parseWorkbook(file: string): FileResult {
  const country = countryFromFileName(file);
  const sheets = readWorkbook(file);

  const directory = sheets.filter(isDirectorySheet).flatMap(readDirectory);
  const universities: SheetResult[] = [];

  for (const sheet of sheets) {
    if (isDirectorySheet(sheet)) continue;
    const result = parseSheet(sheet, directory, country);
    if (result && result.courses.length) universities.push(result);
  }

  // Institutions the directory names but that have no course sheet yet — still
  // worth having as universities so an application can point at one.
  const covered = new Set(universities.map((u) => slugify(u.universityName)));
  const directoryOnly = directory.filter((d) => !covered.has(slugify(d.name)));

  return { file: path.basename(file), country, universities, directoryOnly };
}

/* ── Writing ─────────────────────────────────────────────────────────────── */

async function persist(result: FileResult, source: string) {
  let universityCount = 0;
  let courseCount = 0;

  const upsertUniversity = async (name: string, website?: string) => {
    const slug = slugify(name);
    if (!slug) return null;
    const doc = await University.findOneAndUpdate(
      { country: result.country, slug },
      {
        $set: { name, country: result.country, slug, source },
        // Never clobber a website that was filled in by hand with a blank.
        ...(website ? { $setOnInsert: {} } : {}),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    if (website && !doc.website) { doc.website = website; await doc.save(); }
    universityCount++;
    return doc;
  };

  for (const entry of result.universities) {
    const university = await upsertUniversity(entry.universityName, entry.website);
    if (!university) continue;

    for (const draft of entry.courses) {
      await Course.findOneAndUpdate(
        { university: university._id, name: draft.name, level: draft.level },
        {
          $set: {
            ...draft,
            extras: draft.extras,
            university: university._id,
            universityName: university.name,
            country: result.country,
            source,
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      );
      courseCount++;
    }

    university.courseCount = await Course.countDocuments({ university: university._id });
    await university.save();
  }

  for (const entry of result.directoryOnly) {
    await upsertUniversity(entry.name, entry.website);
  }

  return { universityCount, courseCount };
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dirFlag = args.indexOf('--dir');
  const dir = dirFlag >= 0 ? args[dirFlag + 1] : path.join(process.cwd(), 'data', 'courses');

  if (!fs.existsSync(dir)) {
    console.error(`No such folder: ${dir}\nPass one with --dir "C:/path/to/courses data"`);
    process.exit(1);
  }

  const files = fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'))
    .map((f) => path.join(dir, f));

  console.log(`${files.length} workbook(s) in ${dir}`);
  console.log(apply ? 'Mode: APPLY — writing to the database\n' : 'Mode: dry run — pass --apply to write\n');

  const results = files.map(parseWorkbook);

  let totalUniversities = 0;
  let totalCourses = 0;
  for (const r of results) {
    const courses = r.universities.reduce((n, u) => n + u.courses.length, 0);
    totalUniversities += r.universities.length + r.directoryOnly.length;
    totalCourses += courses;
    console.log(
      `${r.country.padEnd(16)} ${String(r.universities.length).padStart(3)} sheets, ` +
      `${String(r.directoryOnly.length).padStart(3)} listed-only, ${String(courses).padStart(4)} courses  (${r.file})`,
    );
    for (const u of r.universities) {
      if (!u.courses.length) continue;
      console.log(`    · ${u.universityName.padEnd(46).slice(0, 46)} ${String(u.courses.length).padStart(4)} courses` +
        (u.skipped ? `  (${u.skipped} rows skipped)` : ''));
    }
  }
  console.log(`\nTotal: ${totalUniversities} universities, ${totalCourses} courses`);

  if (!apply) return;

  await mongoose.connect(env.mongoUri);
  console.log('\nConnected. Writing…');
  let wroteUniversities = 0;
  let wroteCourses = 0;
  for (const r of results) {
    const counts = await persist(r, r.file);
    wroteUniversities += counts.universityCount;
    wroteCourses += counts.courseCount;
    console.log(`  ${r.country}: ${counts.universityCount} universities, ${counts.courseCount} courses`);
  }
  console.log(`\nDone. ${wroteUniversities} universities, ${wroteCourses} courses upserted.`);
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
