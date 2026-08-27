import { COURSE_LEVELS, type CourseLevel, type IMoney, type IExamRequirement } from '../models/Course';
import { excelSerialToDate } from '../utils/xlsx';

/**
 * The catalogue's normaliser.
 *
 * The source workbooks are hand-kept, one per country, and no two spell their
 * headers the same way — "Tuition fees", "Tution fess", "Fees:", "Per Academic
 * Year". Everything that turns that into a record lives here rather than in the
 * import script, so a future upload route or a partner feed reuses it whole.
 */

export const slugify = (s: string): string =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/* ── Header mapping ──────────────────────────────────────────────────────── */

export type Field =
  | 'name' | 'level' | 'link' | 'duration' | 'applicationFee' | 'intakes'
  | 'deadline' | 'exams' | 'tuition' | 'location' | 'gpa' | 'notes' | 'discipline';

/** Matched against the header lowercased with every non-letter removed. */
const HEADER_ALIASES: [Field, string[]][] = [
  ['name',           ['courses', 'course', 'coursename', 'programme', 'program', 'programmes', 'subject']],
  ['level',          ['type', 'degree', 'level', 'coursetype', 'degreelevel', 'programtype']],
  ['link',           ['link', 'url', 'website', 'courselink', 'weblink']],
  ['duration',       ['duration', 'courseduration', 'length']],
  ['applicationFee', ['applicationfees', 'applicationfee', 'appfee', 'applicationcharges']],
  ['intakes',        ['intake', 'intakes', 'intakemonth', 'session', 'semester']],
  ['deadline',       ['registrationdeadline', 'applicationdeadline', 'deadline', 'lastdate', 'closingdate']],
  ['exams',          ['examrequirement', 'examrequirements', 'englishrequirement', 'requirement', 'requirements', 'entryrequirement']],
  ['tuition',        ['tuitionfee', 'tuitionfees', 'tutionfess', 'tutionfees', 'tuitionfess', 'fees', 'fee', 'tuition', 'peracademicyear', 'perinstallment', 'annualfee']],
  ['location',       ['location', 'city', 'campus', 'place']],
  ['gpa',            ['gpa', 'grade', 'grades', 'cgpa', 'academicrequirement']],
  ['notes',          ['note', 'notes', 'remark', 'remarks', 'comment', 'comments']],
  ['discipline',     ['discipline', 'faculty', 'department', 'field', 'stream', 'category']],
];

const squash = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');

/** The canonical field a header names, or null to keep it as an extra. */
export function fieldFor(header: string): Field | null {
  const key = squash(header);
  if (!key) return null;
  for (const [field, aliases] of HEADER_ALIASES) {
    if (aliases.includes(key)) return field;
  }
  // "Tuition fee (per year)" and friends — fall back to a contains match.
  for (const [field, aliases] of HEADER_ALIASES) {
    if (aliases.some((a) => a.length > 4 && key.includes(a))) return field;
  }
  return null;
}

/** A row is a header row when enough of its cells name known fields. */
export function looksLikeHeader(row: string[]): boolean {
  const filled = row.filter((c) => c && c.trim());
  if (filled.length < 3) return false;
  const known = filled.filter((c) => fieldFor(c)).length;
  return known >= 3 && known / filled.length >= 0.5;
}

/* ── Level ───────────────────────────────────────────────────────────────── */

const LEVEL_PATTERNS: [CourseLevel, RegExp][] = [
  ['mba',        /\bmba\b|master of business admin/i],
  ['phd',        /\bph\.?d\b|doctor|doctoral/i],
  ['masters',    /\bmaster|\bm\.?sc\b|\bm\.?a\b|\bm\.?eng\b|postgrad|\bpg\b|\bllm\b/i],
  ['bachelors',  /\bbachelor|\bb\.?sc\b|\bb\.?a\b|\bb\.?eng\b|undergrad|\bug\b|\bllb\b/i],
  ['foundation', /foundation|pre-?master|pathway|preparatory/i],
  ['diploma',    /diploma|certificate|\bhnd\b/i],
];

/** Reads the level out of an explicit column, the course name, or a banner. */
export function detectLevel(...sources: (string | undefined)[]): CourseLevel {
  for (const raw of sources) {
    if (!raw) continue;
    const s = raw.trim();
    if (!s) continue;
    const exact = COURSE_LEVELS.find((l) => l === squash(s));
    if (exact) return exact;
    for (const [level, re] of LEVEL_PATTERNS) if (re.test(s)) return level;
  }
  return 'other';
}

/**
 * A lone cell in an otherwise empty row that names a degree level — the
 * workbooks use these as section banners above a block of courses.
 */
export function bannerLevel(row: string[]): CourseLevel | null {
  const filled = row.filter((c) => c && c.trim());
  if (filled.length !== 1) return null;
  const text = filled[0].trim();
  if (text.length > 40 || /https?:/i.test(text)) return null;
  const level = detectLevel(text);
  return level === 'other' ? null : level;
}

/* ── Money ───────────────────────────────────────────────────────────────── */

const CURRENCY_SIGNS: Record<string, string> = {
  '€': 'EUR', '$': 'USD', '£': 'GBP', '₹': 'INR', '¥': 'CNY',
};
const CURRENCY_CODES = ['EUR', 'USD', 'GBP', 'CHF', 'CNY', 'RMB', 'INR', 'SEK', 'DKK', 'NOK', 'PLN', 'CZK', 'HUF', 'RON'];

export function parseMoney(raw: string | undefined, fallbackCurrency?: string): IMoney | undefined {
  const text = (raw ?? '').trim();
  if (!text) return undefined;
  if (/^(n\/?a|none|nil|free|no fee|not found|-)$/i.test(text)) {
    return { text, amount: 0, currency: fallbackCurrency, per: 'unknown' };
  }

  const upper = text.toUpperCase();
  let currency = CURRENCY_CODES.find((c) => upper.includes(c));
  if (currency === 'RMB') currency = 'CNY';
  if (!currency) {
    const sign = Object.keys(CURRENCY_SIGNS).find((s) => text.includes(s));
    if (sign) currency = CURRENCY_SIGNS[sign];
  }
  currency ??= fallbackCurrency;

  // First number with thousands separators; "6,000" and "3000.0" both land.
  const num = /(\d[\d,\s]*(?:\.\d+)?)/.exec(text)?.[1];
  const amount = num ? Number(num.replace(/[,\s]/g, '')) : undefined;

  let per: IMoney['per'] = 'unknown';
  if (/per\s*sem|\/\s*sem|semester/i.test(text)) per = 'semester';
  else if (/per\s*term|\/\s*term|\bterm\b/i.test(text)) per = 'term';
  else if (/per\s*month|\/\s*month|month/i.test(text)) per = 'month';
  else if (/year|annual|\/\s*yr|p\.?a\.?\b/i.test(text)) per = 'year';
  else if (/total|whole|entire|full course/i.test(text)) per = 'total';

  return { text, amount: Number.isFinite(amount) ? amount : undefined, currency, per };
}

/* ── Duration ────────────────────────────────────────────────────────────── */

export function parseDuration(raw: string | undefined): { text?: string; months?: number } | undefined {
  const text = (raw ?? '').trim();
  if (!text) return undefined;

  const years = /(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\b/i.exec(text);
  if (years) return { text, months: Math.round(Number(years[1]) * 12) };

  const semesters = /(\d+)\s*semester/i.exec(text);
  if (semesters) return { text, months: Number(semesters[1]) * 6 };

  const months = /(\d+)\s*month/i.exec(text);
  if (months) return { text, months: Number(months[1]) };

  // A bare number in a duration column means years.
  const bare = /^(\d+(?:\.\d+)?)$/.exec(text);
  if (bare && Number(bare[1]) <= 10) return { text, months: Math.round(Number(bare[1]) * 12) };

  return { text };
}

/* ── Intakes ─────────────────────────────────────────────────────────────── */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** "September & February", "Mid - September", "Fall/Spring" → canonical months. */
export function parseIntakes(raw: string | undefined): string[] {
  const text = (raw ?? '').trim();
  if (!text) return [];
  const found = new Set<string>();

  for (const month of MONTHS) {
    if (new RegExp(`\\b${month.slice(0, 3)}`, 'i').test(text)) found.add(month);
  }
  if (/\b(fall|autumn)\b/i.test(text)) found.add('September');
  if (/\bspring\b/i.test(text)) found.add('February');
  if (/\bsummer\b/i.test(text)) found.add('June');
  if (/\bwinter\b/i.test(text)) found.add('October');

  // Nothing recognisable but something was written — keep it verbatim so the
  // filter list stays honest about what the source said.
  if (!found.size && text.length <= 40) found.add(text);
  return [...found];
}

/* ── Deadline ────────────────────────────────────────────────────────────── */

export function parseDeadline(raw: string | undefined): { text?: string; date?: Date } | undefined {
  const text = (raw ?? '').trim();
  if (!text) return undefined;

  // Excel hands dates over as day serials; the sheets are full of them.
  if (/^\d{4,5}(\.0+)?$/.test(text)) {
    const date = excelSerialToDate(Number(text));
    if (date) return { text: date.toISOString().slice(0, 10), date };
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime()) && /\d{4}/.test(text)) return { text, date: parsed };
  return { text };
}

/* ── Exams ───────────────────────────────────────────────────────────────── */

const EXAM_NAMES = ['IELTS', 'TOEFL', 'PTE', 'Duolingo', 'GRE', 'GMAT', 'SAT', 'CAE', 'TestDaF'];

export function parseExams(raw: string | undefined): IExamRequirement[] {
  const text = (raw ?? '').trim();
  if (!text) return [];
  const out: IExamRequirement[] = [];

  for (const name of EXAM_NAMES) {
    const m = new RegExp(`${name}\\s*[:\\-]?\\s*(\\d+(?:\\.\\d+)?)?`, 'i').exec(text);
    if (!m) continue;
    out.push({
      name: name === 'Duolingo' || name === 'TestDaF' ? name : name.toUpperCase(),
      minScore: m[1] ? Number(m[1]) : undefined,
    });
  }
  if (!out.length && text.length <= 120) out.push({ name: 'Other', note: text });
  return out;
}

/* ── Row → course ────────────────────────────────────────────────────────── */

export interface CourseDraft {
  name: string;
  level: CourseLevel;
  discipline?: string;
  link?: string;
  duration?: { text?: string; months?: number };
  applicationFee?: IMoney;
  tuition?: IMoney;
  intakes: string[];
  deadline?: { text?: string; date?: Date };
  exams: IExamRequirement[];
  examText?: string;
  gpa?: string;
  location?: string;
  notes?: string;
  tags: string[];
  extras: Record<string, string>;
}

/** A row is worth keeping when it has a course name that is not a URL. */
export function rowToCourse(
  row: string[],
  headers: (Field | null)[],
  headerText: string[],
  bannerLevelHint: CourseLevel | null,
  fallbackCurrency?: string,
): CourseDraft | null {
  const at = (field: Field): string | undefined => {
    const i = headers.indexOf(field);
    return i >= 0 ? row[i]?.trim() || undefined : undefined;
  };

  const name = at('name');
  if (!name || name.length < 2 || /^https?:/i.test(name)) return null;
  if (looksLikeHeader(row)) return null;

  const extras: Record<string, string> = {};
  row.forEach((cell, i) => {
    const value = cell?.trim();
    if (!value || headers[i]) return;
    const key = (headerText[i] || `Column ${i + 1}`).trim();
    if (key && value !== key) extras[key] = value;
  });

  // Several workbooks carry two fee columns ("Per Academic Year" and "Per
  // Installment"); both map to tuition, so the second lands in extras above.
  const examText = at('exams');

  return {
    name,
    level: detectLevel(at('level'), name, bannerLevelHint ?? undefined),
    discipline: at('discipline'),
    link: at('link'),
    duration: parseDuration(at('duration')),
    applicationFee: parseMoney(at('applicationFee'), fallbackCurrency),
    tuition: parseMoney(at('tuition'), fallbackCurrency),
    intakes: parseIntakes(at('intakes')),
    deadline: parseDeadline(at('deadline')),
    exams: parseExams(examText),
    examText,
    gpa: at('gpa'),
    location: at('location'),
    notes: at('notes'),
    tags: [],
    extras,
  };
}
