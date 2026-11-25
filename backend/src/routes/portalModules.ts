import { Router, type Response } from 'express';
import QRCode from 'qrcode';
import type { PortalRequest } from '../middleware/portal';
import { upload } from '../middleware/upload';
import User from '../models/User';
import Course from '../models/Course';
import University from '../models/University';
import { nextCode } from '../models/Timeline';
import { Appointment } from '../models/Appointment';
import { Promotion, PromotionClaim, PromotionSeen, Voucher, WalletTxn, WalletItem, OfferCompany, type IPromotion } from '../models/Rewards';
import { ServiceInvoice } from '../models/Invoice';
import { PaymentSubmission } from '../models/Portal';
import { HttpError, bad, fieldErr, notFound, handle, oid, clean, istDate } from '../services/crm';
import { notify, notifyAdmins } from '../services/tasks';
import { displayName, portalAudit, studentTimeline, notifyStaff } from '../services/portalCtx';
import * as INFO from '../services/infoForm';
import * as P from '../services/profile';
import * as R from '../services/rewards';
import { record } from '../services/consent';
import { invoicePdf, receiptPdf, type InvoiceRow } from '../services/invoicePdf';
import { MODES, when, prefsOf, freeSlots, ics, out as apptOut, timelineFor } from './appointments';
import { H as INV, bank, upiLink, gstLabel, kindOf, sendPdf, paymentOf } from './invoices';
import { hit, leadIds, studentUpload, writable } from './portal';
import { env } from '../config/env';

/** Student portal side of the client's modules: information form, meetings, promotions, wallet, GST invoices. */
const router = Router();
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const h = (fn: (req: PortalRequest, res: Response) => Promise<unknown>) => handle((req, res) => fn(req as PortalRequest, res));
const isMinor = (req: PortalRequest) => !!((req.su.flags as Any)?.guardian ?? (req.c.lead as Any)?.signup?.guardian);

// ---------- the one Student information form ----------
router.get('/info-form', h(async (req, res) => res.json(await INFO.out(req.c, 'student'))));
router.put('/info-form/:section', h(async (req, res) => res.json(await INFO.save(req.c, req.params.section, req.body ?? {}, { type: 'student', name: 'student', req }))));
router.post('/info-form/submit', h(async (req, res) => res.json(await P.submit(req, req.c))));

// ---------- meetings with the counsellor ----------
router.get('/appointments', h(async (req, res) => {
  const cid = req.c.counsellorId;
  const rows = await Promise.all((await Appointment.find({ student_user_id: req.su._id }).sort({ start_at: -1 }).limit(100)).map((a) => apptOut(a)));
  const u = cid ? await User.findById(cid).select('name staff_code').lean() : null;
  const p = cid ? await prefsOf(cid) : null;
  const modes = p ? (Object.keys(MODES) as (keyof typeof MODES)[]).filter((m) => (p.hours ?? []).some((x: Any) => (m === 'online' ? x.online : x.in_person))) : [];
  res.json({ counsellor: u ? { name: u.name, counsellor_id: (u as Any).staff_code ?? null } : null, modes, accepting: !!p?.accepting, slot_min: p?.slot_min ?? null, rows,
    can_book: !!(cid && p?.accepting && modes.length && !req.c.readOnly) });
}));
router.get('/appointments/slots', h(async (req, res) => {
  const cid = req.c.counsellorId;
  if (!cid) throw bad('A counsellor is not assigned to you yet.');
  const mode = req.query.mode === 'in_person' ? 'in_person' : 'online';
  res.json({ mode, days: await freeSlots(cid, mode), slot_min: (await prefsOf(cid)).slot_min });
}));
router.post('/appointments', h(async (req, res) => {
  const c = req.c, b = req.body ?? {}, cid = c.counsellorId;
  writable(c);
  if (!cid) throw bad('A counsellor is not assigned to you yet.');
  if (!(b.mode in MODES)) throw fieldErr('mode', 'Choose online or in person');
  const reason = clean(b.reason, 500) ?? '';
  if (reason.length < 10) throw fieldErr('reason', 'Please write why you want to meet (at least 10 characters).');
  const slot = (await freeSlots(cid, b.mode)).flatMap((d: Any) => d.slots).find((s: Any) => new Date(s.start_at).toISOString() === new Date(b.start_at).toISOString());
  if (!slot) throw bad('This time is no longer free. Please choose another one.', { code: 'slot_taken' });
  if ((await Appointment.countDocuments({ student_user_id: req.su._id, status: { $in: ['Requested', 'Confirmed'] }, end_at: { $gt: new Date() } })) >= 2) throw bad('You already have 2 meetings requested or booked. Please wait for them or cancel one first.');
  const p = await prefsOf(cid);
  const start = new Date(slot.start_at);
  const a = await Appointment.create({ code: await nextCode('MT'), student_user_id: req.su._id, student_id: c.student?._id, lead_id: c.lead?._id, counsellor_id: cid, mode: b.mode,
    start_at: start, end_at: new Date(+start + p.slot_min * 60e3), reason, status: 'Requested' });
  const label = MODES[a.mode as keyof typeof MODES];
  await notify(cid, 'appointment', `Meeting request from ${displayName(c)}: ${label}, ${when(a.start_at)}. Reason: ${reason.slice(0, 120)}`, '/appointments');
  await timelineFor(a, `Student asked for a meeting (${label}, ${when(a.start_at)}): ${reason}`);
  await portalAudit(req, 'Create', 'Appointment', a._id, `${a.code} ${a.mode} ${a.start_at.toISOString()}`);
  res.json({ ok: true, appointment: await apptOut(a), message: 'Request sent. Your counsellor will confirm it.' });
}));
router.post('/appointments/:id/cancel', h(async (req, res) => {
  const a = await Appointment.findOne({ _id: oid(req.params.id), student_user_id: req.su._id });
  if (!a) throw notFound('Not found');
  if (!['Requested', 'Confirmed'].includes(a.status) || a.start_at < new Date()) throw bad('This meeting cannot be cancelled any more.');
  const why = clean(req.body?.reason, 300);
  a.set({ status: 'Cancelled', cancelled_by_type: 'student', cancel_reason: why, cancelled_at: new Date() }); await a.save();
  await notify(a.counsellor_id, 'appointment', `Meeting ${a.code} on ${when(a.start_at)} was cancelled by the student${why ? ': ' + why.slice(0, 120) : ''}`, '/appointments');
  await timelineFor(a, `Student cancelled meeting ${a.code} (${when(a.start_at)})`);
  res.json({ ok: true });
}));
router.get('/appointments/:file', h(async (req, res) => {
  if (!req.params.file.endsWith('.ics')) throw notFound('Not found');
  const a = await Appointment.findOne({ _id: oid(req.params.file.replace(/\.ics$/, '')), student_user_id: req.su._id, status: 'Confirmed' });
  if (!a) throw notFound('Not found');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="meeting-${a.code}.ics"`);
  res.send(ics(a, (await User.findById(a.counsellor_id).select('name').lean())?.name ?? ''));
}));

// ---------- promotions and vouchers ----------
const shareLink = (code: string | undefined, p?: IPromotion | null) => `${env.portalUrl}/signup?ref=${code ?? ''}${p ? '&promo=' + encodeURIComponent(p.code) : ''}`;
// DPDP s.9(3): no targeted offers to children
const visible = (p: IPromotion, req: PortalRequest) => R.live(p) && !isMinor(req) && (p.audience === 'all' || (p.audience === 'students' ? !!req.su.studentId : !req.su.studentId));
async function offerCountries(p: IPromotion) {
  const ids = p.scope_type === 'country' ? p.scope_ids : p.scope_type === 'university' ? [...new Set((await University.find({ _id: { $in: p.scope_ids } }).select('country_id').lean()).map((u) => String(u.country_id)).filter(Boolean))] : [];
  const { Country } = await import('../models/Master');
  return (await Country.find({ _id: { $in: ids } }).select('name').lean()).map((c) => ({ id: String(c._id), name: c.name }));
}
async function outPortal(p: IPromotion, req: PortalRequest) {
  const mine = p.kind === 'offer' ? null : (await R.progress(p)).find((x) => x.student_user_id === String(req.su._id));
  const on = R.live(p);
  return { id: String(p._id), code: on && !['offer', 'partner'].includes(p.kind) ? p.code : null, title: p.title, counts_at: p.counts_at || 'enrolment', countries: await offerCountries(p),
    partner_link: on && p.kind === 'partner' ? p.partner_link ?? null : null, partner_code: on && p.kind === 'partner' ? p.partner_code ?? null : null, message: p.message ?? null, kind: p.kind,
    reward: p.reward ?? null, terms: p.terms ?? null, has_image: !!p.image_url, image_url: p.image_url ?? null, starts_on: p.starts_on ?? null, ends_on: p.ends_on ?? null, live: on,
    period: p.starts_on || p.ends_on ? `${R.d8(p.starts_on) || 'now'} to ${R.d8(p.ends_on) || 'open'}` : '', scope: await R.scopeLabel(p), scope_type: p.scope_type, min_referrals: p.min_referrals || 1,
    provider: p.provider_name ?? null, provider_note: p.kind === 'offer' ? null : R.PROVIDER_NOTE(p), seen: !!(await PromotionSeen.exists({ promotion_id: p._id, student_user_id: req.su._id })),
    share_link: on ? shareLink(req.su.referralCode, p) : null,
    my_progress: mine ? { counted: mine.counted, needed: mine.needed, eligible: mine.eligible, voucher: mine.reward, claims: mine.claims.map((c) => ({ university: c.university, friend: c.friend, state: c.state, counts: c.counts, closed: c.closed, applied: c.applied, visa: c.visa, enrolled: c.enrolled })) } : null };
}
// running offers, plus ended ones where I used the code or got a voucher
router.get('/promotions', h(async (req, res) => {
  await R.expire();
  const mine = new Set([...(await PromotionClaim.distinct('promotion_id', { $or: [{ student_user_id: req.su._id }, { referrer_student_user_id: req.su._id }] })), ...(await Voucher.distinct('promotion_id', { student_user_id: req.su._id }))].map(String));
  const rows = [];
  for (const p of await Promotion.find({ status: { $ne: 'Draft' } }).sort({ published_at: -1 })) if (visible(p, req) || mine.has(String(p._id))) rows.push(await outPortal(p, req));
  res.json({ referral_code: req.su.referralCode ?? null, rows });
}));
router.get('/vouchers/:file', h(async (req, res) => {
  const v = await Voucher.findOne({ _id: oid(req.params.file.replace(/\.pdf$/, '')), student_user_id: req.su._id });
  if (!v) throw notFound('Not found');
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="La-Europa-voucher-${v.voucher_code}.pdf"`);
  res.send(await R.voucherFile(v));
}));
router.post('/promotions/:id/click', h(async (req, res) => { if (!req.preview) await Promotion.updateOne({ _id: oid(req.params.id), kind: 'partner', status: 'Published' }, { $inc: { partner_clicks: 1 } }); res.json({ ok: true }); }));
router.post('/promotions/:id/seen', h(async (req, res) => {
  if (!req.preview) await PromotionSeen.updateOne({ promotion_id: oid(req.params.id), student_user_id: req.su._id }, { $setOnInsert: { seen_at: new Date() } }, { upsert: true });
  res.json({ ok: true });
}));
// a code at the last step of Apply Now: show the offer and its terms to accept
router.get('/promotions/check', h(async (req, res) => {
  const course = await Course.findById(oid(req.query.course_id)).select('university_id').lean();
  if (!course) throw bad('Choose a course first.');
  const uni = await University.findById(course.university_id).select('country_id').lean();
  const { promotion: p } = await R.checkCode(req.query.code, { suId: String(req.su._id), leadIds: leadIds(req.c), university_id: course.university_id, country_id: uni?.country_id });
  res.json({ verified: true, code: p.code, title: p.title, reward: p.reward, terms: p.terms, period: `${R.d8(p.starts_on)} to ${R.d8(p.ends_on)}`, kind: p.kind, provider: p.provider_name, provider_note: R.PROVIDER_NOTE(p) });
}));

// ---------- wallet ----------
router.get('/wallet', h(async (req, res) => {
  await R.creditReferrals();
  const c = await R.walletCfg(), b = await R.balance(req.su._id);
  const companies = new Set((await OfferCompany.find({ active: true, is_deleted: false }).select('_id').lean()).map((x) => String(x._id)));
  const KIND: Record<string, string> = { referral: 'Referral reward', hold: 'Held for a voucher request', release: 'Voucher request cancelled', adjust: 'Adjustment by La Europa' };
  const store = [];
  for (const i of await WalletItem.find({ active: true, is_deleted: false }).sort({ value: 1 }).lean()) if (companies.has(String(i.company_id))) { const o = await R.itemOut(i as never) as Any; store.push({ ...o, note: R.walletNote(o.company) }); }
  res.json({ balance: b, min_redeem: c.min_redeem, referral_default: c.referral_default, can_convert: b >= c.min_redeem,
    rows: (await WalletTxn.find({ student_user_id: req.su._id }).sort({ createdAt: -1 }).limit(200).lean()).map((x) => ({ id: String(x._id), kind: x.kind, amount: x.amount, reason: x.reason ?? null, created_at: x.createdAt, label: KIND[x.kind] ?? x.kind })),
    store, requests: await Promise.all((await R.WalletRedemption.find({ student_user_id: req.su._id }).sort({ createdAt: -1 })).map(R.redemptionOut)) });
}));
router.post('/wallet/redeem', h(async (req, res) => {
  writable(req.c);
  hit('wallet:' + req.su._id, 10, 60e3);
  if (!req.body?.accept_terms) throw fieldErr('accept_terms', 'Please accept the terms of the voucher');
  const i = await WalletItem.findOne({ _id: oid(req.body?.item_id), active: true, is_deleted: false }).lean();
  if (!i || !(await OfferCompany.exists({ _id: i.company_id, active: true, is_deleted: false }))) throw notFound('Not found');
  const c = await R.walletCfg(), b = await R.balance(req.su._id);
  if (b < c.min_redeem) throw bad(`You can turn your wallet into a voucher once it has ${R.inr(c.min_redeem)}. Now: ${R.inr(b)}.`);
  if (b < i.value) throw bad(`This voucher needs ${R.inr(i.value)}. Your wallet has ${R.inr(b)}.`);
  const r = await R.WalletRedemption.create({ student_user_id: req.su._id, item_id: i._id, amount: i.value, status: 'Requested' });
  await WalletTxn.create({ student_user_id: req.su._id, kind: 'hold', amount: -i.value, reason: `Voucher request: ${i.title}`, ref_type: 'redemption', ref_id: r._id });
  // a parallel request could have spent the same balance: undo this one if so
  if ((await R.balance(req.su._id)) < 0) {
    await WalletTxn.create({ student_user_id: req.su._id, kind: 'release', amount: i.value, reason: 'Voucher request cancelled (balance)', ref_type: 'redemption', ref_id: r._id });
    r.status = 'Cancelled'; r.decided_at = new Date(); await r.save();
    throw bad('Your wallet balance changed. Please try again.');
  }
  await record(req, { suId: req.su._id, leadId: req.su.leadId, type: 'voucher_terms', value: true, method: 'wallet_convert', extra: { item: i.title, value: i.value, terms: i.terms } });
  await notifyAdmins('wallet', `Voucher request from the wallet: ${i.title} (${R.inr(i.value)})`, '/promotions?tab=wallet');
  res.json({ ok: true, id: String(r._id), balance: await R.balance(req.su._id) });
}));
router.post('/wallet/requests/:id/cancel', h(async (req, res) => {
  const r = await R.WalletRedemption.findOneAndUpdate({ _id: oid(req.params.id), student_user_id: req.su._id, status: 'Requested' }, { status: 'Cancelled', decided_at: new Date() });
  if (!r) throw bad('This request can no longer be cancelled.');
  await WalletTxn.create({ student_user_id: req.su._id, kind: 'release', amount: r.amount, reason: 'Voucher request cancelled', ref_type: 'redemption', ref_id: r._id });
  res.json({ ok: true, balance: await R.balance(req.su._id) });
}));

// ---------- GST invoices of La Europa ----------
const studentOf = (req: PortalRequest) => { if (!req.c.student) throw new HttpError(403, 'Invoices appear after your registration with La Europa'); return req.c.student; };
router.get('/invoices', h(async (req, res) => {
  const s = studentOf(req);
  const b = await bank();
  const rows = [];
  for (const inv of await ServiceInvoice.find({ student_id: s._id, is_deleted: false, status: { $ne: 'Cancelled' } }).sort({ createdAt: -1 })) {
    const sub = await PaymentSubmission.findOne({ invoice_id: inv._id, is_deleted: false }).sort({ createdAt: -1 }).select('status utr reject_reason createdAt').lean();
    const link = inv.status === 'Paid' ? null : await upiLink(inv as unknown as InvoiceRow);
    const k = kindOf(inv) as Any;
    rows.push({ id: String(inv._id), invoice_no: inv.invoice_no, description: inv.description, invoice_date: inv.invoice_date, due_date: inv.due_date, taxable: inv.taxable, cgst: inv.cgst, sgst: inv.sgst,
      igst: inv.igst, round_off: inv.round_off, total: inv.total, gst_label: gstLabel(inv), kind: inv.kind || 'service', doc_label: k.doc, gst: k.gst, note: k.note ?? null, status: inv.status,
      receipt_no: inv.receipt_no ?? null, student_code: inv.student_code, overdue: inv.status === 'Unpaid' && inv.due_date < istDate(),
      last_proof: sub ? { status: sub.status, utr: sub.utr, reject_reason: sub.reject_reason, created_at: sub.createdAt } : null, upi_link: link, upi_qr: link ? await QRCode.toDataURL(link, { margin: 1, width: 220 }) : null });
  }
  res.json({ rows, bank: b ? { account_name: b.account_name, bank_name: b.bank_name, account_no: b.account_no, ifsc: b.ifsc, account_type: b.account_type || null,
    branch: [b.branch, b.city, b.state, b.pin].filter(Boolean).join(', ') || null, upi_id: b.upi_id || null } : null });
}));
const myInv = async (req: PortalRequest) => {
  const s = studentOf(req);
  const inv = await ServiceInvoice.findOne({ _id: oid(req.params.id), student_id: s._id, is_deleted: false });
  if (!inv) throw notFound('Invoice');
  return { s, inv };
};
router.get('/invoices/:id/invoice.pdf', h(async (req, res) => { const { inv } = await myInv(req); sendPdf(res, await invoicePdf(inv as unknown as InvoiceRow, INV), inv.invoice_no); }));
router.get('/invoices/:id/receipt.pdf', h(async (req, res) => {
  const { inv } = await myInv(req);
  if (!inv.payment_id) throw bad('The receipt is made after La Europa confirms your payment.');
  sendPdf(res, await receiptPdf(inv as unknown as InvoiceRow, await paymentOf(inv), INV), inv.receipt_no ?? inv.invoice_no);
}));
// the payment proof goes under its invoice: the UTR is required, the invoice number is the reference
router.post('/invoices/:id/proof', upload.single('receipt'), h(async (req, res) => {
  writable(req.c);
  const { s, inv } = await myInv(req);
  const b = req.body ?? {};
  if (inv.status === 'Paid') throw bad('This invoice is already paid.');
  if (inv.status === 'Cancelled') throw bad('This invoice was cancelled.');
  if (inv.status === 'Proof submitted') throw bad('A payment proof for this invoice is already waiting for confirmation.');
  const errors: Record<string, string> = {};
  const utr = clean(b.utr, 60);
  if (!utr || utr.length < 6) errors.utr = 'Enter the UTR / transaction number from your bank or UPI app';
  if (!b.payment_date) errors.payment_date = 'Required'; else if (b.payment_date > istDate()) errors.payment_date = 'Cannot be in the future';
  if (!b.mode) errors.mode = 'Required';
  if (!req.file) errors.receipt = 'Upload the payment screenshot or bank receipt';
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields', { errors });
  if (await PaymentSubmission.exists({ utr, is_deleted: false, status: { $ne: 'Rejected' } })) throw fieldErr('utr', 'This UTR / transaction number was already submitted.');
  const up = await studentUpload(req, s, { typeName: 'Payment receipt', title: `Payment proof ${inv.invoice_no}`, allowVerified: true });
  const x = await PaymentSubmission.create({ student_id: s._id, payment_for: (kindOf(inv) as Any).payment_for, application_id: inv.application_id, amount: inv.total, currency: 'INR', payment_date: b.payment_date,
    mode: clean(b.mode, 40), reference_no: `${inv.invoice_no} / UTR ${utr}`, utr, invoice_id: inv._id, document_id: oid(up.document_id), note: clean(b.note, 500), status: 'Submitted' });
  inv.status = 'Proof submitted'; await inv.save();
  await studentTimeline(s._id, null, 'payment', `Student submitted a payment proof for invoice ${inv.invoice_no} (UTR ${utr})`);
  await notifyStaff(req.c, 'payment_proof', `Payment proof for invoice ${inv.invoice_no} from ${displayName(req.c)} (INR ${inv.total.toLocaleString('en-IN')})`, `/students/${s._id}/fees`);
  await portalAudit(req, 'Create', 'PaymentSubmission', x._id, `${inv.invoice_no} UTR ${utr}`);
  res.json({ id: String(x._id), message: 'Payment proof submitted. Your counsellor will confirm it and your receipt will appear here.' });
}));

export default router;
