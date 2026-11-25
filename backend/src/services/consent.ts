import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Request } from 'express';
import { ConsentDocument, SignedDocument } from '../models/Privacy';
import { ConsentRecord } from '../models/Portal';
import { getSetting, setSetting } from '../models/Audit';

/** Versioned legal documents and the append-only consent log (legacy/server/portal/consent.js). */

export const TYPES: Record<string, string> = { master: 'Student Agreement & Consent (all-in-one)', terms: 'Terms of Use', privacy: 'Privacy Policy', advisory: 'Student Advisory & Consent',
  cookies: 'Cookie and Storage Notice', uni_terms: 'Partner Portal Terms of Use (universities)', uni_dpa: 'Data Processing Terms (universities)',
  share_consent: 'Consent to share my application with a university', student_consent: 'Student Declaration & Consent',
  constitution: 'Student Terms & Conditions (Student Constitution, Rule Book with Schedules 1 to 8)', web_privacy: 'Privacy Policy', web_refund: 'Refund & Cancellation Policy', web_cookies: 'Cookie & Storage Notice' };
// La Europa (Nov 2026): the student signs ONE document on the first login, the Student Declaration & Consent, signed under the Student Constitution
export const REQUIRED = ['student_consent'];
export const INCLUDED = ['constitution'];
// La Europa's own texts, kept as markdown in backend/legal/; the file name carries the version
const MD_DOCS: Record<string, string> = { student_consent: 'student-consent-declaration-v1.0.md', constitution: 'student-constitution-v3.0.md', web_privacy: 'privacy-policy-v1.0.md',
  web_refund: 'refund-cancellation-policy-v1.0.md', web_cookies: 'cookie-storage-notice-v1.0.md' };
const LEGAL_DIR = path.join(__dirname, '..', '..', 'legal');
export const DUE_DAYS: Record<string, number> = { access: 30, portability: 30, correction: 30, erasure: 30, restriction: 30, objection: 30, withdraw_consent: 7, nomination: 30, grievance: 30,
  opt_out_sale: 15, limit_sensitive: 15, other: 30 };
export const REQ_LABEL: Record<string, string> = { access: 'Access my data', portability: 'Get a portable copy of my data', correction: 'Correct my data', erasure: 'Delete my data',
  restriction: 'Restrict processing', objection: 'Object to processing', withdraw_consent: 'Withdraw consent', nomination: 'Nominate a person (India DPDP)', grievance: 'Grievance / complaint',
  opt_out_sale: 'Do not sell or share my personal information (US)', limit_sensitive: 'Limit use of my sensitive personal information (US)', other: 'Other privacy question' };

export const hash = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
export async function fill(text: string) {
  const v = async (k: string, d: string) => String((await getSetting(k)) || d);
  const map: Record<string, string> = {
    company_legal_name: await v('legal_name', 'Euroverse Service LLP (trading as La Europa Education)'), company_address: await v('company_address', '[address to be added by La Europa]'),
    privacy_email: await v('privacy_email', '[privacy email to be added]'), grievance_officer_name: await v('grievance_officer_name', '[Grievance Officer name]'),
    grievance_officer_email: await v('grievance_officer_email', '[email]'), grievance_officer_phone: await v('grievance_officer_phone', '[phone]'),
    dpo_contact: await v('dpo_contact', 'not appointed'), retention_years: await v('retention_years', '7') };
  return text.replace(/\{(\w+)\}/g, (m, k) => map[k] ?? m);
}

/** A markdown file whose exact text is not published yet becomes the current version; older versions stay for the records. */
let seeded: Promise<void> | null = null;
export function seedDocs() {
  seeded ??= (async () => {
    for (const [type, file] of Object.entries(MD_DOCS)) {
      const p = path.join(LEGAL_DIR, file);
      if (!fs.existsSync(p)) continue;
      const ver = file.match(/-v(\d+(?:\.\d+)*)\.md$/)?.[1] ?? '1.0';
      const body = fs.readFileSync(p, 'utf8').replace(/\r/g, '').trim() + '\n';
      const h = hash(body);
      if (await ConsentDocument.exists({ doc_type: type, body_hash: h })) continue;
      // same version number with a corrected text: stored as a revision
      const n = await ConsentDocument.countDocuments({ doc_type: type, $or: [{ version: ver }, { version: new RegExp(`^${ver.replace('.', '\\.')} \\(rev\\. `) }] });
      const version = n ? `${ver} (rev. ${n + 1})` : ver;
      await ConsentDocument.updateMany({ doc_type: type }, { is_current: false });
      await ConsentDocument.create({ doc_type: type, version, title: TYPES[type], body, body_hash: h, is_current: true, change_note: n ? `Revised text of version ${ver} from La Europa's document` : `Version ${ver} from La Europa's document` });
    }
  })().catch((e) => { seeded = null; throw e; });
  return seeded;
}
export async function current(type: string) { await seedDocs(); return ConsentDocument.findOne({ doc_type: type, is_current: true }).lean(); }

export async function publish(type: string, body: string, changeNote: string | undefined, userId: string) {
  if (!TYPES[type]) throw new Error('Unknown document');
  const cur = await current(type);
  const next = cur ? `${Math.floor(parseFloat(cur.version) || 1) + 1}.0` : '1.0';
  await ConsentDocument.create({ doc_type: type, version: next, title: TYPES[type], body, body_hash: hash(body), is_current: false, published_by: userId, change_note: changeNote });
  await ConsentDocument.updateMany({ doc_type: type, version: { $ne: next } }, { is_current: false });
  await ConsentDocument.updateOne({ doc_type: type, version: next }, { is_current: true });
  if (type === 'terms' || type === 'privacy') await setSetting(`${type}_version`, next, userId);
  return next;
}

/** The Student Declaration & Consent is signed together with the Student Constitution: one fingerprint over both exact versions. */
export async function signPack() {
  const [c, k] = await Promise.all([current('student_consent'), current('constitution')]);
  return c && k ? { consent: c, constitution: k, hash: hash(c.body_hash + '|' + k.body_hash) } : null;
}
/** What this student still has to accept (current versions). */
export async function missing(suId: unknown) {
  const out: string[] = [];
  for (const type of REQUIRED) {
    if (type === 'student_consent') { const p = await signPack(); if (p && !(await SignedDocument.exists({ student_user_id: suId, content_hash: p.hash }))) out.push(type); continue; }
    const d = await current(type);
    if (d && !(await ConsentRecord.exists({ student_user_id: suId, consent_type: type, value: 'yes', document_hash: d.body_hash }))) out.push(type);
  }
  return out;
}

/** Append one consent record with its full context (version, fingerprint, how, IP, device). */
export async function record(req: Request | null, o: { suId?: unknown; leadId?: unknown; type: string; value: boolean; method?: string; scrolled?: boolean; timeSpent?: number;
  extra?: Record<string, unknown>; universityId?: unknown; applicationId?: unknown }) {
  const d = TYPES[o.type] ? await current(o.type) : null;
  const ctx = ((req?.body as { client?: Record<string, unknown> } | undefined)?.client) ?? {};
  const r = await ConsentRecord.create({ student_user_id: o.suId, lead_id: o.leadId, consent_type: o.type, document_version: d?.version, document_id: d?._id, document_hash: d?.body_hash,
    value: o.value ? 'yes' : 'no', method: o.method, scrolled_to_end: o.scrolled ?? null, time_spent_sec: o.timeSpent === undefined ? null : Math.max(0, Math.round(Number(o.timeSpent) || 0)),
    timezone: String(ctx.timezone ?? '').slice(0, 60) || undefined, locale: String(ctx.locale ?? '').slice(0, 20) || undefined, ip: req?.ip,
    user_agent: req ? String(req.headers['user-agent'] ?? '').slice(0, 300) : undefined, extra: o.extra, university_id: o.universityId, application_id: o.applicationId });
  return String(r._id);
}
/** Has this login ever signed the Student Declaration & Consent (any version)? */
export const hasSigned = async (suId: unknown) => !!(await SignedDocument.exists({ student_user_id: suId }));
/** The part of the Declaration that is read and signed: everything before the blank signature block and audit trail (the Portal fills those). */
export const signText = (body: string) => String(body).split(/\n\s*_{20,}\s*\n/)[0].split(/\n(?=#{1,4} (?:\d+\.\s*)?(?:Signature|Audit trail)\b)/i)[0].trim() + '\n';
/** A document as the portal shows it: HTML from the legal markdown, the Declaration with its optional boxes and the Constitution beside it. */
export async function publicDoc(type: string) {
  const { toHtml } = await import('./legalMd');
  if (type === 'student_consent') {
    const p = await signPack();
    if (!p) return null;
    const cons = toHtml(await fill(signText(p.consent.body).replace(/I, _{5,},/, 'I, **[your full name, typed below]**,')), { checkboxes: true });
    const con = toHtml(await fill(p.constitution.body), { idPrefix: 'c-' });
    return { id: String(p.consent._id), type, title: p.consent.title, version: p.consent.version, hash: p.hash, published_at: p.consent.published_at, html: cons.html, text: await fill(p.consent.body),
      constitution: { id: String(p.constitution._id), title: p.constitution.title, version: p.constitution.version, hash: p.constitution.body_hash, html: con.html, toc: con.toc } };
  }
  const d = await current(type);
  if (!d) return null;
  const hh = MD_DOCS[type] ? toHtml(await fill(d.body)) : null;
  return { id: String(d._id), type, title: d.title, version: d.version, hash: d.body_hash, published_at: d.published_at, html: hh?.html ?? null, toc: hh?.toc ?? null, text: await fill(d.body) };
}
