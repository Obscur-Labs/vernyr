import crypto from 'crypto';
import { Types } from 'mongoose';
import { Promotion, PromotionClaim, PromotionSeen, Voucher, WalletTxn, WalletItem, OfferCompany, WalletRedemption, type IPromotion, type IPromotionClaim, type IVoucher, type IWalletRedemption } from '../models/Rewards';
import { ApplicationRequest, Referral } from '../models/Portal';
import { Application, VisaCase } from '../models/Work';
import PortalAccount from '../models/PortalAccount';
import Student from '../models/Student';
import Lead from '../models/Lead';
import University from '../models/University';
import { Country } from '../models/Master';
import { getSetting } from '../models/Audit';
import { bad, istDate } from './crm';
import { stageList } from './masters';
import { studentNotify } from './email';
import { voucherPdf, type VoucherData } from './voucherPdf';

/** Promotions, referral rewards, vouchers and the wallet (legacy/server/promotions.js, wallet.js). */

export const KINDS = { offer: 'Announcement (information only)', application: "Offer on the student's own application (e.g. free flight)", referral: 'Refer friends (reward)',
  partner: "Partner offer (the company's own link or code, e.g. insurance, blocked account)" };
export const COUNTS = { visa: 'When the visa is approved', enrolment: 'When the visa is approved and the student is enrolled at the university' };
export const AUDIENCE = { all: 'All students and leads', students: 'Registered students only', leads: 'Leads only (not yet registered)' };
export const SCOPES = { all: 'All universities and countries', country: 'Some countries', university: 'Some universities' };
const CLOSED = ['rejected', 'withdrawn', 'offer_declined'];
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const rnd = (n: number) => Array.from(crypto.randomBytes(n), (b) => ALPHA[b % ALPHA.length]).join('');
export async function genCode() { for (;;) { const c = 'PR-' + rnd(6); if (!(await Promotion.exists({ code: c }))) return c; } }
export async function genVoucher() { for (;;) { const c = `LEV-${rnd(4)}-${rnd(4)}`; if (!(await Voucher.exists({ voucher_code: c }))) return c; } }
export const today = () => istDate();
export const d8 = (ymd?: string | null) => (ymd ? new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }) : '');
export const inr = (n: unknown) => 'INR ' + Number(n || 0).toLocaleString('en-IN');

export const PROVIDER_NOTE = (p: Pick<IPromotion, 'kind' | 'provider_name'>) => p.kind === 'partner'
  ? `This offer is given directly by ${p.provider_name || 'a partner company'}. La Europa Education only shares it with you. You deal directly with ${p.provider_name || 'the company'}: its product or service, terms and conditions, prices, quality and delivery are its responsibility, and La Europa Education is not responsible for them. The offer is valid only during the offer period.`
  : `This offer is provided by ${p.provider_name || 'a partner company'}. La Europa Education only issues the voucher. The product or service, its terms and conditions, quality and delivery are the responsibility of ${p.provider_name || 'the provider'}. La Europa Education is not responsible for the product or service, or for anything after the voucher is redeemed. The voucher is valid only until the date printed on it, can be used once, and cannot be exchanged for cash or transferred.`;
export const walletNote = (name: string) => `This voucher is given by ${name}. La Europa Education only issues the voucher from your wallet. The product or service, its terms and conditions, quality and delivery are the responsibility of ${name}. La Europa Education is not responsible for the product or service, or for anything after the voucher is redeemed. The voucher is valid only until the date printed on it, can be used once, and cannot be exchanged for cash or transferred.`;

const nameOf = async (model: 'uni' | 'country', id: string) => {
  if (!Types.ObjectId.isValid(id)) return '';
  return ((model === 'uni' ? await University.findById(id).select('name').lean() : await Country.findById(id).select('name').lean()) as { name?: string } | null)?.name ?? '';
};
export const scopeLabel = async (p: IPromotion) => p.scope_type === 'all' ? 'All universities' : (await Promise.all(p.scope_ids.map((i) => nameOf(p.scope_type === 'country' ? 'country' : 'uni', i)))).join(', ');
export const inScope = (p: IPromotion, uniId?: unknown, countryId?: unknown) =>
  p.scope_type === 'country' ? p.scope_ids.includes(String(countryId)) : p.scope_type === 'university' ? p.scope_ids.includes(String(uniId)) : true;
export const inPeriod = (p: IPromotion) => (!p.starts_on || p.starts_on <= today()) && (!p.ends_on || p.ends_on >= today());
export const live = (p: IPromotion) => p.status === 'Published' && inPeriod(p);
/** A promotion ends by itself after its last day. */
export const expire = () => Promotion.updateMany({ status: 'Published', ends_on: { $lt: today() } }, { status: 'Ended', ended_at: new Date() });

// the student of a portal account (a lead becomes a student later: follow it)
async function studentOfSu(suId: unknown) {
  const su = await PortalAccount.findById(suId).select('studentId leadId').lean();
  if (su?.studentId) return su.studentId;
  if (!su?.leadId) return null;
  const l = await Lead.findById(su.leadId).select('converted_student_id').lean();
  return l?.converted_student_id ?? (await Student.findOne({ lead_id: su.leadId, is_deleted: false }).select('_id').lean())?._id ?? null;
}
export async function personOf(suId: unknown) {
  const su = await PortalAccount.findById(suId).select('leadId name').lean();
  const sid = await studentOfSu(suId);
  const s = sid ? await Student.findById(sid).select('first_name last_name student_code').lean() : null;
  const l = !s && su?.leadId ? await Lead.findById(su.leadId).select('first_name last_name lead_code').lean() : null;
  if (s) return { name: [s.first_name, s.last_name].filter(Boolean).join(' '), code: s.student_code, link: `/students/${s._id}` };
  if (l) return { name: [l.first_name, l.last_name].filter(Boolean).join(' '), code: l.lead_code, link: `/leads/${l._id}` };
  return { name: su?.name ?? '', code: '', link: '' };
}

/** How far a referred friend got (for the referral list). */
export async function referralStatus(x: { lead_id?: unknown; status: string }) {
  if (!x.lead_id) return x.status === 'Already known' ? 'Already known' : 'Received';
  const l = await Lead.findById(x.lead_id).select('status converted_student_id').lean();
  if (!l) return 'Received';
  const sid = l.converted_student_id ?? (await Student.findOne({ lead_id: x.lead_id, is_deleted: false }).select('_id').lean())?._id;
  if (sid) {
    const s = await Student.findById(sid).select('status').lean();
    const enrolled = s?.status === 'Enrolled' || (await Application.exists({ student_id: sid, stage: 'enrolment_confirmed', is_deleted: false }));
    return enrolled ? 'Enrolled' : 'Registered';
  }
  return l.status === 'New' ? 'Received' : l.status === 'Converted' ? 'Registered' : 'Contacted';
}

/** One claim: does it count? (visa approved, and, unless the offer counts at the visa, physically enrolled at the university.) */
export async function claimState(c: IPromotionClaim, p?: IPromotion | null) {
  const atVisa = p?.counts_at === 'visa';
  const rq = c.application_request_id ? await ApplicationRequest.findById(c.application_request_id).select('status application_id').lean() : null;
  const appId = c.application_id ?? rq?.application_id;
  if (!appId) return rq && ['Declined', 'Cancelled by student', 'Expired'].includes(rq.status) ? { key: 'no', label: 'Not eligible: the request was not taken forward' } : { key: 'wait', label: 'Code entered: application not started yet' };
  const a = await Application.findById(appId).select('stage student_id').lean();
  if (!a) return { key: 'wait', label: 'Code entered' };
  if (CLOSED.includes(a.stage)) return { key: 'no', label: 'Not eligible: application closed' };
  const visa = !!(await VisaCase.exists({ stage: 'approved', is_deleted: false, $or: [{ application_id: a._id }, { application_id: null, student_id: a.student_id, country_id: c.country_id }] }));
  const enrolled = a.stage === 'enrolment_confirmed';
  const f = { application_id: String(a._id), applied: true, visa, enrolled };
  if (visa && enrolled) return { key: 'ok', label: 'Counts: visa approved and enrolled at the university', ...f };
  if (visa && atVisa) return { key: 'ok', label: 'Counts: visa approved', ...f };
  if (visa) return { key: 'wait', label: 'Visa approved: waiting for physical enrolment', ...f };
  if (enrolled) return { key: 'wait', label: 'Enrolment recorded: waiting for the visa approval record', ...f };
  const stage = (await stageList('app_stage')).find((s) => s.code === a.stage)?.name ?? a.stage;
  return { key: 'wait', label: `Application in progress (${stage})`, ...f };
}
const voucherStatus = (v: IVoucher) => (v.status === 'Issued' && v.valid_until && v.valid_until < today() ? 'Expired' : v.status);
export const voucherOut = (v?: IVoucher | null) => v ? { id: String(v._id), voucher_code: v.voucher_code, given_at: v.given_at, valid_from: v.valid_from, valid_until: v.valid_until,
  status: voucherStatus(v), redeemed_at: v.redeemed_at ?? null, note: v.note ?? null } : null;

/** Claims of a promotion grouped by who gets the reward (the student, or the referrer). */
export async function progress(p: IPromotion) {
  const claims = await PromotionClaim.find({ promotion_id: p._id }).sort({ entered_at: 1 });
  const by = new Map<string, { c: IPromotionClaim; state: Awaited<ReturnType<typeof claimState>> }[]>();
  for (const c of claims) {
    const who = String(p.kind === 'referral' ? c.referrer_student_user_id : c.student_user_id);
    if (!by.has(who)) by.set(who, []);
    by.get(who)!.push({ c, state: await claimState(c, p) });
  }
  const need = p.kind === 'referral' ? Math.max(1, p.min_referrals || 1) : 1;
  return Promise.all([...by.entries()].map(async ([suId, list]) => {
    const ok = list.filter((x) => x.state.key === 'ok').length;
    const rw = await Voucher.findOne({ promotion_id: p._id, student_user_id: suId, source: 'promotion' });
    return {
      student_user_id: suId, person: await personOf(suId), counted: ok, needed: need, eligible: ok >= need, reward: voucherOut(rw),
      claims: await Promise.all(list.map(async ({ c, state }) => ({ id: String(c._id), entered_at: c.entered_at, university: c.university_id ? await nameOf('uni', String(c.university_id)) : '',
        friend: p.kind === 'referral' ? (await personOf(c.student_user_id)).name : null, state: state.label, counts: state.key === 'ok', closed: state.key === 'no',
        applied: 'applied' in state && !!state.applied, visa: 'visa' in state && !!state.visa, enrolled: 'enrolled' in state && !!state.enrolled }))),
    };
  }));
}
export async function stats(p: IPromotion) {
  const pr = await progress(p);
  return { notified: p.notified_count || 0, seen: await PromotionSeen.countDocuments({ promotion_id: p._id }), codes_used: await PromotionClaim.countDocuments({ promotion_id: p._id }),
    counted: pr.reduce((n, x) => n + x.counted, 0), eligible: pr.filter((x) => x.eligible).length, rewards: pr.filter((x) => x.reward).length,
    signups: await Lead.countDocuments({ promo_code: p.code, is_deleted: false }) };
}

// ---------- the code at Apply Now (portal) ----------
/** ctx: the student's portal account, their lead / student lead id, and the request's university and country. Throws the reason a code does not count. */
export async function checkCode(code: unknown, ctx: { suId: string; leadIds: unknown[]; university_id?: unknown; country_id?: unknown }) {
  await expire();
  const p = await Promotion.findOne({ code: String(code ?? '').trim().toUpperCase().slice(0, 20) });
  const no = (m: string) => bad(m, { code: 'promo_invalid', errors: { promo_code: m } });
  if (!p || p.status === 'Draft') throw no('This promotion code is not valid.');
  if (p.kind === 'offer') throw no('This code is for information only and cannot be used on an application.');
  if (p.kind === 'partner') throw no(`This is a partner offer: use it directly with ${p.provider_name || 'the partner company'} (see Offers).`);
  if (p.starts_on && p.starts_on > today()) throw no(`This offer starts on ${d8(p.starts_on)}. The code counts only during the offer period.`);
  if (p.status === 'Ended' || (p.ends_on && p.ends_on < today())) throw no(`This offer ended on ${d8(p.ends_on)}. The code counts only during the offer period.`);
  if (!inScope(p, ctx.university_id, ctx.country_id)) throw no(`This offer is only for: ${await scopeLabel(p)}.`);
  let referrer: Types.ObjectId | null = null;
  if (p.kind === 'referral') {
    const r = ctx.leadIds.length ? await Referral.findOne({ lead_id: { $in: ctx.leadIds }, is_deleted: false }).sort({ createdAt: 1 }).lean() : null;
    if (!r?.referrer_student_user_id || String(r.referrer_student_user_id) === ctx.suId) throw no('This offer is for friends referred by a La Europa student (they sign up with the referral link or code).');
    referrer = r.referrer_student_user_id;
  } else {
    for (const c of await PromotionClaim.find({ promotion_id: p._id, student_user_id: ctx.suId })) if ((await claimState(c)).key !== 'no') throw no('You have already used this code on another application.');
  }
  return { promotion: p, referrer };
}

// ---------- wallet ----------
export async function walletCfg() {
  let rules: { type: 'country' | 'university'; id: string; amount: number }[] = [];
  try { rules = JSON.parse(String((await getSetting('wallet_rules')) ?? '[]')); } catch { /* no rules */ }
  return { referral_default: Number((await getSetting('wallet_referral_default')) || 500), min_redeem: Number((await getSetting('wallet_min_redeem')) || 20000), rules };
}
export async function balance(suId: unknown) {
  const [r] = await WalletTxn.aggregate([{ $match: { student_user_id: new Types.ObjectId(String(suId)) } }, { $group: { _id: null, b: { $sum: '$amount' } } }]);
  return r?.b ?? 0;
}
const walletNotify = (suId: unknown, title: string) => studentNotify(suId, title, '/wallet');
/** Credit the referrer once for every referred friend who has enrolled at the university. */
export async function creditReferrals() {
  const c = await walletCfg();
  const done = new Set((await WalletTxn.distinct('ref_id', { ref_type: 'referral', kind: 'referral' })).map(String));
  let n = 0;
  for (const r of await Referral.find({ is_deleted: false, lead_id: { $ne: null }, referrer_student_user_id: { $ne: null } }).lean()) {
    if (done.has(String(r._id))) continue;
    const l = await Lead.findById(r.lead_id).select('converted_student_id').lean();
    const sid = l?.converted_student_id ?? (await Student.findOne({ lead_id: r.lead_id, is_deleted: false }).select('_id').lean())?._id;
    if (!sid || String(sid) === String(r.referrer_student_id)) continue;
    const a = await Application.findOne({ student_id: sid, stage: 'enrolment_confirmed', is_deleted: false }).sort({ updatedAt: 1 }).lean();
    if (!a) continue;
    const amt = Number(c.rules.find((x) => x.type === 'university' && x.id === String(a.university_id))?.amount ?? c.rules.find((x) => x.type === 'country' && x.id === String(a.country_id))?.amount ?? c.referral_default);
    if (!(amt > 0)) continue;
    const s = await Student.findById(sid).select('first_name last_name').lean();
    const friend = [s?.first_name, s?.last_name].filter(Boolean).join(' ');
    const uni = a.university_id ? await nameOf('uni', String(a.university_id)) : 'the university';
    try { await WalletTxn.create({ student_user_id: r.referrer_student_user_id, kind: 'referral', amount: amt, reason: `Referral: ${friend} enrolled at ${uni}`, ref_type: 'referral', ref_id: r._id }); }
    catch { continue; } // credited by a parallel run
    await walletNotify(r.referrer_student_user_id, `${inr(amt)} added to your wallet: your friend ${friend} has enrolled at ${uni}. Thank you!`);
    n++;
  }
  return n;
}
export async function itemOut(i: { _id: unknown; company_id: unknown; title: string; description?: string; value: number; valid_days: number; terms?: string; active: boolean }) {
  const c = await OfferCompany.findById(i.company_id).lean();
  return { id: String(i._id), title: i.title, description: i.description ?? null, value: i.value, valid_days: i.valid_days, terms: i.terms ?? null, active: !!i.active,
    company_id: String(i.company_id), company: c?.name ?? '', company_active: !!(c?.active && !c.is_deleted) };
}
export async function redemptionOut(r: IWalletRedemption) {
  const i = await WalletItem.findById(r.item_id).lean();
  const v = r.voucher_id ? await Voucher.findById(r.voucher_id) : null;
  return { id: String(r._id), item: i?.title ?? '', company: i ? (await OfferCompany.findById(i.company_id).select('name').lean())?.name ?? '' : '', amount: r.amount, status: r.status,
    reason: r.reason ?? null, created_at: r.createdAt, decided_at: r.decided_at ?? null, voucher: v ? { id: String(v._id), voucher_code: v.voucher_code, valid_until: v.valid_until, status: voucherStatus(v) } : null };
}
export { WalletRedemption };

export async function voucherFile(v: IVoucher) {
  const s = (v.snapshot ?? {}) as Partial<VoucherData>;
  return voucherPdf({ ...(s as VoucherData), voucher_code: v.voucher_code, issued_on: d8(istDate(v.given_at)), valid_from: d8(v.valid_from), valid_until: d8(v.valid_until), status: voucherStatus(v) });
}

/** Apply Now with a promotion code: the terms are recorded as a consent, the claim is kept with the request. */
export async function claim(req: import('express').Request, code: unknown, row: { _id: unknown; request_code: string; student_id?: unknown; lead_id?: unknown; university_id?: unknown; country_id?: unknown }, su: { _id: unknown; leadId?: unknown }, leadIds: unknown[]) {
  const { record } = await import('./consent');
  const r = await checkCode(code, { suId: String(su._id), leadIds, university_id: row.university_id, country_id: row.country_id });
  const p = r.promotion;
  const consentId = await record(req, { suId: su._id, leadId: su.leadId, type: 'promotion_terms', value: true, method: 'apply_now_code',
    extra: { code: p.code, title: p.title, request_code: row.request_code, terms: p.terms, period: `${p.starts_on} to ${p.ends_on}` } });
  await PromotionClaim.create({ promotion_id: p._id, code: p.code, kind: p.kind, student_user_id: su._id, student_id: row.student_id, lead_id: row.lead_id, application_request_id: row._id,
    university_id: row.university_id, country_id: row.country_id, referrer_student_user_id: r.referrer ?? undefined, consent_record_id: consentId });
  await ApplicationRequest.updateOne({ _id: row._id }, { promo_code: p.code });
  return p;
}
/** The promotion code a referred friend's referral carries, offered on Apply Now. */
export async function suggestedCode(leadIds: unknown[]) {
  if (!leadIds.length) return null;
  const r = await Referral.findOne({ lead_id: { $in: leadIds }, promo_code: { $nin: [null, ''] } }).sort({ createdAt: 1 }).lean();
  const p = r ? await Promotion.findOne({ code: r.promo_code }).lean() : null;
  return p && live(p as unknown as IPromotion) && p.kind !== 'offer' ? p.code : null;
}
