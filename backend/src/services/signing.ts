import crypto from 'crypto';
import type { Types } from 'mongoose';
import { rgb } from 'pdf-lib';
import Student from '../models/Student';
import Lead from '../models/Lead';
import PortalAccount, { type IPortalAccount } from '../models/PortalAccount';
import { SignedDocument, type ISignedDocument } from '../models/Privacy';
import { nextCode } from '../models/Timeline';
import { env } from '../config/env';
import { uploadBuffer, signedFileUrl } from '../config/cloudinary';
import { HttpError, bad, fieldErr, clean, fmtDateTime, hmac, isEmail } from './crm';
import { issueCode, checkCode } from './authCodes';
import * as CONSENT from './consent';
import * as PDF from './legalPdf';

/** Signing the Student Declaration & Consent under the Student Constitution (legacy/server/legal/sign.js).
 *  Signature = typed full name + a one-time code sent only by email (and to the parent / guardian for a student under 18).
 *  One PDF is made at signing and locked: its SHA-256 and an HMAC seal over the signed facts live in the append-only SignedDocument. */

const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const KEYS = ['D', 'E'] as const;
const LABEL: Record<string, string> = { D: 'News and offers (optional)', E: 'Success stories / publicity (optional)' };
const SIGNED_CONSENTS = 'Data processing (11.1), sharing with institutions and for the visa (11.2), transfer outside India (11.3): given by signing';
export const MIN_READ_SEC = 30;
const verifyUrl = () => `${env.portalUrl}/legal/verify`;
const ist = (d?: Date | string | null) => (d ? `${fmtDateTime(d)} IST` : '-');
const maskEmail = (e?: string | null) => { if (!e) return '-'; const [u, d] = e.split('@'); return `${u.slice(0, 2)}${'*'.repeat(Math.max(1, u.length - 2))}@${d}`; };
type Guardian = { name: string; relation: string; adult_declared: boolean; email?: string; otp_sent_at?: Date; otp_verified_at?: Date };
type Rec = { doc_code: string; student_user_id: string; consent_version: string; constitution_version: string; content_hash: string; typed_name: string; consents: Record<string, boolean>;
  otp_destination: string; otp_sent_at: Date; otp_verified_at: Date; guardian: Guardian | null; ip: string | null; user_agent: string | null; timezone: string | null; locale: string | null;
  reading_sec_client: number; reading_sec_server: number; constitution_opened: boolean; signed_at: Date };
const sealOf = (r: Rec & { pdf_sha256: string }) => hmac(['v1', r.doc_code, r.student_user_id, r.content_hash, r.typed_name, JSON.stringify(r.consents), r.otp_destination, new Date(r.otp_verified_at).toISOString(),
  r.guardian ? JSON.stringify(r.guardian) : '', r.ip ?? '', r.pdf_sha256, new Date(r.signed_at).toISOString()].join('|'));
function device(ua?: string | null) {
  const s = String(ua ?? '');
  return `${/Mobile|Android|iPhone/i.test(s) ? 'Phone' : 'Computer'}${/Edg\//.test(s) ? ', Edge' : /Chrome\//.test(s) ? ', Chrome' : /Firefox\//.test(s) ? ', Firefox' : /Safari\//.test(s) ? ', Safari' : ''}${/Windows/.test(s) ? ', Windows' : /Android/.test(s) ? ', Android' : /iPhone|iPad|Mac OS/.test(s) ? ', Apple' : ''}`;
}
async function who(su: IPortalAccount) {
  const st = su.studentId ? await Student.findById(su.studentId).select('first_name middle_name last_name student_code').lean() : null;
  const ld = !st && su.leadId ? await Lead.findById(su.leadId).select('first_name last_name lead_code').lean() : null;
  return { name: st ? [st.first_name, st.middle_name, st.last_name].filter(Boolean).join(' ') : ld ? [ld.first_name, ld.last_name].filter(Boolean).join(' ') : su.email ?? '', code: st?.student_code ?? ld?.lead_code ?? '-' };
}
const mailFor = (title: string, version: string, forGuardian: boolean) => ({
  subject: forGuardian ? "Code to sign your child's La Europa Student Declaration & Consent" : 'Your code to sign the La Europa Student Declaration & Consent',
  text: (code: string) => `Your one-time code to sign the ${title} (version ${version}) electronically is ${code}.\n\nIt is valid for 10 minutes. Entering this code together with the typed full name is your electronic signature${forGuardian ? ' as the parent or guardian' : ''}.\nIf you did not ask for this code, ignore this email and tell La Europa.`,
});

/** Step 1: the code, by email only. */
export async function sendCode(su: IPortalAccount, whoFor: 'student' | 'guardian', guardian: { email?: string } | null, guardianEmail?: string) {
  const pack = await CONSENT.signPack();
  if (!pack) throw bad('The document is not available. Please try again later.');
  if (whoFor === 'guardian') {
    if (!guardian) throw bad('A parent / guardian signature is needed only for students under 18.');
    const em = String(guardianEmail || guardian.email || '').trim().toLowerCase();
    if (!isEmail(em)) throw fieldErr('guardian_email', "Please enter the parent / guardian's email address.");
    if (su.email && em === su.email.toLowerCase()) throw fieldErr('guardian_email', "The parent / guardian must use their own email address, not the student's.");
    return { otp_id: await issueCode({ accountId: su._id as Types.ObjectId, email: em, purpose: 'consent_sign_guardian', app: 'portal', payload: { hash: pack.hash }, mail: mailFor(pack.consent.title, pack.consent.version, true) }), masked: maskEmail(em) };
  }
  if (!su.email) throw bad('Please add your email address in Account first: the signing code is sent by email.');
  return { otp_id: await issueCode({ accountId: su._id as Types.ObjectId, email: su.email, purpose: 'consent_sign', app: 'portal', payload: { hash: pack.hash }, mail: mailFor(pack.consent.title, pack.consent.version, false) }), masked: maskEmail(su.email) };
}

/** Step 2: check everything, verify the code(s) last, make and lock the PDF, keep the record. */
export async function sign(req: { ip?: string; headers: Record<string, unknown> }, su: IPortalAccount, isMinor: boolean, b: Record<string, any>, serverReadSec: number) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const pack = await CONSENT.signPack();
  if (!pack || b.document_hash !== pack.hash) throw bad('A newer version of the document was published. Please read it again.', { code: 'stale' });
  if (await SignedDocument.exists({ student_user_id: su._id, content_hash: pack.hash })) throw bad('You have already signed this version.', { code: 'stale' });
  const consents = Object.fromEntries(KEYS.map((k) => [k, !!b.consents?.[k]]));
  if (!b.scrolled_to_end) throw bad('Please read the document to the end before signing.');
  if (serverReadSec < MIN_READ_SEC) throw bad('Please take a moment to read the document before signing.');
  const typed = clean(b.typed_name, 100) ?? '';
  if (typed.replace(/[^\p{L}]/gu, '').length < 3 || !/\s/.test(typed.trim())) throw fieldErr('typed_name', 'Please type your full name (first and last name).');
  let guardian: Guardian | null = null;
  if (isMinor) {
    const g = b.guardian ?? {};
    const gName = clean(g.name, 100) ?? '', rel = clean(g.relation, 40) ?? '';
    if (gName.length < 3) throw fieldErr('guardian_name', "Please type the parent / guardian's full name.");
    if (!rel) throw fieldErr('guardian_relation', 'Please say how the guardian is related to the student.');
    // DPDP Rule 10: the person consenting for a child must be an identifiable adult
    if (!g.adult) throw fieldErr('guardian_adult', 'The parent / guardian must confirm that they are 18 years of age or older.');
    guardian = { name: gName, relation: rel, adult_declared: true };
  }
  const o = await checkCode(b.otp_id, b.code, 'consent_sign');
  if (String(o.accountId) !== String(su._id) || String(o.destination ?? '').toLowerCase() !== String(su.email ?? '').toLowerCase() || (o.payload as { hash?: string } | undefined)?.hash !== pack.hash)
    throw bad('This code is not valid for this document. Please ask for a new code.');
  const verifiedAt = new Date();
  if (guardian) {
    const og = await checkCode(b.guardian?.otp_id, b.guardian?.code, 'consent_sign_guardian');
    if (String(og.accountId) !== String(su._id) || (og.payload as { hash?: string } | undefined)?.hash !== pack.hash) throw bad("The guardian's code is not valid for this document. Please ask for a new code.");
    Object.assign(guardian, { email: og.destination, otp_sent_at: og.lastSentAt ?? og.createdAt, otp_verified_at: new Date() });
  }
  const ctx = (b.client ?? {}) as Record<string, unknown>;
  const rec: Rec = { doc_code: await nextCode('SD'), student_user_id: String(su._id), consent_version: pack.consent.version, constitution_version: pack.constitution.version, content_hash: pack.hash,
    typed_name: typed, consents, otp_destination: o.destination!, otp_sent_at: o.lastSentAt ?? o.createdAt, otp_verified_at: verifiedAt, guardian, ip: req.ip ?? null,
    user_agent: String(req.headers['user-agent'] ?? '').slice(0, 300) || null, timezone: String(ctx.timezone ?? '').slice(0, 60) || null, locale: String(ctx.locale ?? '').slice(0, 20) || null,
    reading_sec_client: Math.max(0, Math.round(Number(b.time_spent_sec) || 0)), reading_sec_server: serverReadSec, constitution_opened: !!b.constitution_opened, signed_at: verifiedAt };
  const pdf = await buildPdf(rec, pack, su);
  const up = await uploadBuffer({ buffer: pdf.bytes, originalname: `${rec.doc_code}.pdf`, mimetype: 'application/pdf', size: pdf.bytes.length } as Express.Multer.File, `signed/${su._id}`);
  const pdf_sha256 = sha(pdf.bytes);
  const doc = await SignedDocument.create({ doc_code: rec.doc_code, doc_type: 'student_consent', student_user_id: su._id, student_id: su.studentId, lead_id: su.leadId, content_hash: rec.content_hash,
    typed_name: typed, file_key: up.publicId, pdf_sha256, signed_at: rec.signed_at,
    data: { ...rec, consent_doc_id: pack.consent._id, constitution_doc_id: pack.constitution._id, url: up.url, resource_type: up.resourceType, pdf_bytes: pdf.bytes.length, pdf_pages: pdf.pages, seal: sealOf({ ...rec, pdf_sha256 }) } });
  const set: Record<string, unknown> = {};
  if (guardian) set.flags = { ...((su.flags ?? {}) as object), guardian: { name: guardian.name, relation: guardian.relation, email: guardian.email } };
  if (!su.emailVerifiedAt) set.emailVerifiedAt = new Date();
  if (Object.keys(set).length) await PortalAccount.updateOne({ _id: su._id }, set);
  return { record: doc, pdf: pdf.bytes, consents, pack };
}

type Pack = NonNullable<Awaited<ReturnType<typeof CONSENT.signPack>>>;
export async function buildPdf(rec: Rec, pack: Pack, su: IPortalAccount) {
  const p = await who(su);
  const g = rec.guardian;
  const tcName = 'Student Terms & Conditions (Student Constitution)';
  const w = await PDF.create({ title: `Student Declaration & Consent - signed - ${rec.doc_code}`, subject: `Signed by ${rec.typed_name} on ${ist(rec.signed_at)}`, band: `Signed document ${rec.doc_code}`,
    watermark: 'SIGNED AND LOCKED', keywords: [rec.doc_code, rec.content_hash], date: rec.signed_at, bottom: 124 });
  await PDF.sigFont(w);
  PDF.box(w, [['Document ID', { bold: rec.doc_code }], ['Status', 'Signed electronically and locked. This file was made once at signing and cannot be changed. Any change breaks its fingerprint.'],
    ['Student', `${p.name} (Student ID ${p.code})`], ['Signed on', `${ist(rec.signed_at)} / ${rec.signed_at.toISOString()} (UTC)`], ['Versions signed', `${pack.consent.title} v${rec.consent_version}; ${tcName} v${rec.constitution_version}`],
    ['Check this document', `${verifyUrl()}?id=${rec.doc_code}`]], { title: 'Signed record' });
  PDF.markdown(w, (await CONSENT.fill(CONSENT.signText(pack.consent.body))).replace(/I, _{5,},/, `I, **${rec.typed_name.replace(/\*/g, '')}**,`), { checks: rec.consents });
  PDF.heading(w, 'Signature', 3);
  {
    const H = 100, cw = g ? (PDF.PW - 2 * PDF.M - 15) / 2 : 260;
    w.need(H + 14);
    const y = w.y - H;
    PDF.signatureCard(w.page, w, { x: PDF.M, y, width: cw, height: H }, { label: 'STUDENT  ·  e-Signed by', name: rec.typed_name, nameSize: 28,
      lines: [ist(rec.signed_at), `Typed full name + email OTP (${maskEmail(rec.otp_destination)})`, `IP ${rec.ip ?? '-'}  ·  ${device(rec.user_agent)}`] });
    if (g) PDF.signatureCard(w.page, w, { x: PDF.M + cw + 15, y, width: cw, height: H }, { label: 'PARENT / GUARDIAN  ·  e-Signed by', name: g.name, nameSize: 28,
      lines: [ist(g.otp_verified_at), `${g.relation}  ·  typed name + email OTP (${maskEmail(g.email)})`, `IP ${rec.ip ?? '-'}  ·  own email, separate code`] });
    w.y = y - 14;
  }
  PDF.box(w, [['Document ID', rec.doc_code], ['Student ID', p.code], ['Versions accepted', `Student Declaration & Consent v${rec.consent_version}; ${tcName} v${rec.constitution_version}`],
    ['Document fingerprint (SHA-256)', rec.content_hash], ['Declaration text SHA-256', pack.consent.body_hash], ['Terms text SHA-256', pack.constitution.body_hash],
    ['Typed name', rec.typed_name], ['Consents (sections 11.1 to 11.3)', SIGNED_CONSENTS], ['Separate optional choices', KEYS.map((k) => `${LABEL[k]}: ${rec.consents[k] ? 'Yes' : 'No'}`).join(' · ')],
    ['OTP sent to', `${maskEmail(rec.otp_destination)} at ${ist(rec.otp_sent_at)}`], ['OTP verified at', `${ist(rec.otp_verified_at)} / ${rec.otp_verified_at.toISOString()} (UTC)`],
    ['IP address', rec.ip ?? '-'], ['Device and browser', `${device(rec.user_agent)}. ${String(rec.user_agent ?? '').slice(0, 140)}`], ['Time zone / language', `${rec.timezone ?? '-'} / ${rec.locale ?? '-'}`],
    ['Reading time', `${rec.reading_sec_server} s measured by the server (${rec.reading_sec_client} s on the device); Terms & Conditions opened: ${rec.constitution_opened ? 'yes' : 'no'}`],
    ['Parent / guardian OTP (if under 18)', g ? `sent to ${maskEmail(g.email)} at ${ist(g.otp_sent_at)}, verified at ${ist(g.otp_verified_at)}` : 'Not applicable (student is 18 or over)'],
    ['Document integrity (SHA-256)', `When this PDF was made, its SHA-256 fingerprint was saved in La Europa's sealed record, which cannot be changed. Anyone can check a copy at ${verifyUrl()}: a file changed even by one character gives a different fingerprint.`]],
  { kw: 170, title: 'Audit Trail (completed automatically by the Portal)' });
  PDF.rich(w, 'This record is created electronically and is valid without a physical signature (Information Technology Act 2000, section 10A). A copy is emailed to the student and can be downloaded at any time by the student and La Europa Education from the Portal.', { size: 8.4, color: rgb(0.35, 0.39, 0.47) });
  w.newPage();
  PDF.box(w, [['Annex', `The full ${tcName}, version ${rec.constitution_version}, exactly as shown to the student and signed with document ${rec.doc_code}.`], ['Terms text SHA-256', pack.constitution.body_hash]], { kw: 150 });
  PDF.markdown(w, await CONSENT.fill(pack.constitution.body));
  // the signature stamp on every page: the whole document was signed
  const all = w.doc.getPages();
  all.forEach((pg, i) => PDF.signatureCard(pg, w, { x: PDF.PW - PDF.M - 250, y: 48, width: 250, height: 66 }, {
    label: g ? 'e-Signed by the student and parent / guardian' : 'e-Signed by', name: g ? `${rec.typed_name} & ${g.name}` : rec.typed_name, nameSize: 20,
    lines: [`${ist(rec.signed_at)}  ·  Email OTP verified`, `IP ${rec.ip ?? '-'}  ·  ${rec.doc_code}  ·  Page ${i + 1} of ${all.length}`] }));
  const doc = PDF.finishDoc(w, `${rec.doc_code} | Signed and locked | Fingerprint ${rec.content_hash.slice(0, 20)}... | Verify: ${verifyUrl()}`);
  return { bytes: Buffer.from(await doc.save({ useObjectStreams: true })), pages: doc.getPageCount() };
}

/** The stored file, after checking it is unchanged and the record was not altered. */
export async function readLocked(row: ISignedDocument) {
  const d = (row.data ?? {}) as Rec & { url?: string; resource_type?: string; seal?: string };
  const url = d.url ? signedFileUrl(d.url, row.file_key, (d.resource_type ?? 'raw') as never) : null;
  const r = url ? await fetch(url).catch(() => null) : null;
  if (!r?.ok) throw new HttpError(410, 'The signed file is missing from storage. Please contact La Europa (the record itself is kept).');
  const bytes = Buffer.from(await r.arrayBuffer());
  if (sha(bytes) !== row.pdf_sha256) throw new HttpError(409, 'Integrity check failed: the stored signed file does not match its fingerprint. La Europa has been told.');
  if (d.seal && sealOf({ ...d, pdf_sha256: row.pdf_sha256! }) !== d.seal) throw new HttpError(409, 'Integrity check failed: the signed record was changed after signing. La Europa has been told.');
  return bytes;
}

/** Public check of a Document ID: no personal data beyond initials. */
export async function verify(code: unknown, fileHash?: unknown) {
  const r = await SignedDocument.findOne({ doc_code: String(code ?? '').trim().toUpperCase().slice(0, 40) }).lean();
  if (!r) return { valid: false };
  const d = (r.data ?? {}) as Rec & { seal?: string };
  let intact: boolean | null = null;
  try { await readLocked(r as unknown as ISignedDocument); intact = true; } catch { intact = false; }
  return { valid: true, doc_code: r.doc_code, signed_at: r.signed_at, signed_ist: ist(r.signed_at), initials: r.typed_name.split(/\s+/).filter(Boolean).map((x) => x[0].toUpperCase() + '.').join(' '),
    versions: `Student Declaration & Consent v${d.consent_version}; Student Constitution v${d.constitution_version}`, content_hash: r.content_hash, pdf_sha256: r.pdf_sha256,
    stored_file_intact: intact, guardian: !!d.guardian, record_sealed: d.seal ? sealOf({ ...d, pdf_sha256: r.pdf_sha256! }) === d.seal : null,
    file_matches: fileHash ? String(fileHash).trim().toLowerCase() === r.pdf_sha256 : undefined };
}
