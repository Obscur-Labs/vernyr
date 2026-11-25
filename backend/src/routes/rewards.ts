import { Router } from 'express';
import { authenticate, type AuthRequest } from '../middleware/auth';
import { upload } from '../middleware/upload';
import { uploadBuffer, destroyAsset } from '../config/cloudinary';
import { Promotion, Voucher, OfferCompany, WalletItem, WalletTxn, WalletRedemption, type IPromotion } from '../models/Rewards';
import { Referral, ConsentRecord } from '../models/Portal';
import PortalAccount from '../models/PortalAccount';
import University from '../models/University';
import { Country } from '../models/Master';
import { audit, setSetting } from '../models/Audit';
import { bad, notFound, forbidden, handle, isAdmin, oid, clean, isEmail, addDays } from '../services/crm';
import { checkFile } from '../services/files';
import { studentNotify } from '../services/email';
import { KINDS, COUNTS, AUDIENCE, SCOPES, PROVIDER_NOTE, walletNote, genCode, genVoucher, today, d8, inr, scopeLabel, live, expire, progress, stats, personOf, referralStatus,
  walletCfg, balance, creditReferrals, itemOut, redemptionOut, voucherFile } from '../services/rewards';
import { voucherPdf, SAMPLE } from '../services/voucherPdf';

/** Admin side of promotions, referral rewards, vouchers, partner companies and the wallet (legacy/server/promotions.js, wallet.js). */
const router = Router();
router.use(authenticate);
router.use(/^\/admin\/(promotions|vouchers|referrals|offer-companies|wallet)/, (req: AuthRequest, _res, next) => next(isAdmin(req) ? undefined : forbidden()));

const outAdmin = async (p: IPromotion) => ({ ...p.toObject(), id: String(p._id), _id: undefined, __v: undefined, created_at: p.createdAt, updated_at: p.updatedAt,
  kind_label: KINDS[p.kind] ?? p.kind, audience_label: AUDIENCE[p.audience], scope_label: await scopeLabel(p), has_image: !!p.image_url, live: live(p), stats: await stats(p) });

async function fields(b0: Record<string, any>, cur?: IPromotion | null) { // eslint-disable-line @typescript-eslint/no-explicit-any
  // once published, the kind, scope, start date, friends needed and counting rule stay as they were
  const b = cur && cur.status !== 'Draft' ? { ...b0, kind: cur.kind, scope_type: cur.scope_type, scope_ids: cur.scope_ids, starts_on: cur.starts_on, min_referrals: cur.min_referrals, counts_at: cur.counts_at, ends_on: b0.ends_on || cur.ends_on } : b0;
  const errors: Record<string, string> = {};
  const f: Record<string, unknown> = {};
  f.title = clean(b.title, 120); if (!f.title) errors.title = 'Title is required';
  f.message = clean(b.message, 2000);
  f.kind = b.kind in KINDS ? b.kind : 'offer';
  f.reward = clean(b.reward, 200);
  f.audience = b.audience in AUDIENCE ? b.audience : 'all';
  f.scope_type = b.scope_type in SCOPES ? b.scope_type : 'all';
  const sids = [...new Set(([] as unknown[]).concat(b.scope_ids ?? []).flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean))];
  f.scope_ids = f.scope_type === 'all' ? [] : sids;
  if (f.scope_type !== 'all' && !sids.length) errors.scope_ids = f.scope_type === 'country' ? 'Choose at least one country' : 'Choose at least one university';
  f.starts_on = /^\d{4}-\d{2}-\d{2}$/.test(b.starts_on ?? '') ? b.starts_on : undefined;
  f.ends_on = /^\d{4}-\d{2}-\d{2}$/.test(b.ends_on ?? '') ? b.ends_on : undefined;
  f.terms = clean(b.terms, 5000);
  f.min_referrals = f.kind === 'referral' ? Math.min(50, Math.max(1, Number(b.min_referrals) || 1)) : 1;
  Object.assign(f, { provider_name: clean(b.provider_name, 120), provider_contact: clean(b.provider_contact, 100), provider_phone: clean(b.provider_phone, 20),
    provider_email: clean(b.provider_email, 120), provider_address: clean(b.provider_address, 300), voucher_valid_days: Math.min(730, Math.max(1, Number(b.voucher_valid_days) || 90)) });
  // a partner company listed in the CRM: its details are copied in
  const co = oid(b.provider_company_id) ? await OfferCompany.findOne({ _id: oid(b.provider_company_id), is_deleted: false }).lean() : null;
  f.provider_company_id = co?._id;
  if (co) Object.assign(f, { provider_name: co.name, provider_contact: co.contact_person, provider_phone: co.phone, provider_email: co.email, provider_address: co.address });
  f.counts_at = b.counts_at in COUNTS ? b.counts_at : 'enrolment';
  f.partner_link = undefined; f.partner_code = undefined;
  if (f.kind === 'partner') {
    const link = clean(b.partner_link, 500); f.partner_code = clean(b.partner_code, 60);
    if (link) { try { const u = new URL(link); if (u.protocol !== 'https:') throw new Error(); f.partner_link = u.href; } catch { errors.partner_link = 'The link must start with https://'; } }
    if (!link && !f.partner_code) errors.partner_link = "Add the partner's link or the code they gave you";
  }
  if (f.kind !== 'offer') {
    if (!f.reward) errors.reward = 'Write the reward (e.g. Free flight ticket / INR 10,000 Amazon voucher / Free Kerala trip)';
    if (!f.starts_on || !f.ends_on) errors.ends_on = 'An offer with a code needs a start and an end date';
    if (f.kind !== 'partner' && (!f.terms || String(f.terms).length < 20)) errors.terms = 'Write the terms and conditions of the offer';
    if (!f.provider_name) errors.provider_name = 'Write the company that gives this offer (the voucher is redeemed with them)';
    if (!f.provider_contact) errors.provider_contact = "Write the provider's contact person";
    if (!f.provider_phone || String(f.provider_phone).replace(/\D/g, '').length < 10) errors.provider_phone = "Write the contact person's mobile number";
    if (!f.provider_email || !isEmail(f.provider_email)) errors.provider_email = "Write the contact person's email";
  }
  if (f.starts_on && f.ends_on && String(f.starts_on) > String(f.ends_on)) errors.ends_on = 'The end date is before the start date';
  if (Object.keys(errors).length) throw bad(Object.values(errors)[0], { errors });
  return f;
}
async function saveImage(file: Express.Multer.File) {
  checkFile(file, ['png', 'jpg', 'jpeg'], 3);
  const a = await uploadBuffer(file, 'promotions');
  return { image_url: a.url, image_public_id: a.publicId };
}

// ---------- promotions ----------
router.get('/admin/promotions', handle(async (_req, res) => {
  await expire();
  const rows = await Promotion.find().sort({ createdAt: -1 });
  res.json({ rows: await Promise.all(rows.map(outAdmin)), kinds: KINDS, audiences: AUDIENCE, scopes: SCOPES, counts: COUNTS,
    companies: (await OfferCompany.find({ is_deleted: false, active: true }).sort({ name: 1 }).lean()).map((c) => ({ id: String(c._id), name: c.name, contact_person: c.contact_person, phone: c.phone, email: c.email, address: c.address })),
    countries: (await Country.find().sort({ name: 1 }).select('name').lean()).map((c) => ({ id: String(c._id), name: c.name })),
    universities: (await University.find().sort({ name: 1 }).select('name').lean()).map((u) => ({ id: String(u._id), name: u.name })) });
}));
router.post('/admin/promotions', upload.single('image'), handle(async (req, res) => {
  const f = await fields(req.body ?? {});
  const p = await Promotion.create({ code: await genCode(), ...f, ...(req.file ? await saveImage(req.file) : {}), status: 'Draft', created_by: req.user!.id });
  await audit(req, 'Create', 'Promotion', p._id, `${p.code} ${p.title}`);
  res.json({ id: String(p._id), code: p.code });
}));
router.put('/admin/promotions/:id', upload.single('image'), handle(async (req, res) => {
  const p = await Promotion.findById(oid(req.params.id));
  if (!p) throw notFound('Promotion');
  const f = await fields(req.body ?? {}, p);
  // once published, the code, kind, scope and period are fixed: students used them as they were (the end date may only move later)
  if (p.status !== 'Draft') { for (const k of ['kind', 'scope_type', 'scope_ids', 'starts_on', 'min_referrals', 'counts_at']) delete f[k]; if (f.ends_on && p.ends_on && String(f.ends_on) < p.ends_on) delete f.ends_on; }
  if (req.file || req.body?.remove_image === '1') { await destroyAsset(p.image_public_id, 'image').catch(() => {}); p.set({ image_url: undefined, image_public_id: undefined }); }
  p.set({ ...f, ...(req.file ? await saveImage(req.file) : {}) });
  await p.save();
  await audit(req, 'Update', 'Promotion', p._id, p.code);
  res.json({ ok: true });
}));
router.post('/admin/promotions/:id/publish', handle(async (req, res) => {
  await expire();
  const p = await Promotion.findById(oid(req.params.id));
  if (!p) throw notFound('Promotion');
  if (p.status === 'Ended' || (p.ends_on && p.ends_on < today())) throw bad('This promotion has ended.');
  const who = await PortalAccount.find({ role: 'student', isActive: true, status: 'Active', ...(p.audience === 'students' ? { studentId: { $ne: null } } : p.audience === 'leads' ? { studentId: null } : {}) }).select('_id flags').lean();
  let n = 0;
  // in-app only, never email, and only to students who said yes to "News and offers"; never to a child (DPDP s.9(3))
  for (const su of who) {
    const c = await ConsentRecord.findOne({ student_user_id: su._id, consent_type: 'marketing' }).sort({ createdAt: -1 }).lean();
    if (c?.value !== 'yes' || (su.flags as { is_minor?: boolean } | undefined)?.is_minor) continue;
    await studentNotify(su._id, `${p.kind === 'referral' ? 'Refer a friend: ' : ''}${p.title}`, `/offers/${p._id}`);
    n++;
  }
  p.set({ status: 'Published', published_at: p.published_at ?? new Date(), notified_count: (p.notified_count || 0) + n }); await p.save();
  await audit(req, 'Update', 'Promotion', p._id, `${p.code} published, in-app notice to ${n} student(s)`);
  res.json({ ok: true, notified: n, audience: who.length });
}));
router.post('/admin/promotions/:id/end', handle(async (req, res) => {
  await Promotion.updateOne({ _id: oid(req.params.id) }, { status: 'Ended', ended_at: new Date() });
  res.json({ ok: true });
}));
router.get('/admin/promotions/:id/image', handle(async (req, res) => {
  const p = await Promotion.findById(oid(req.params.id)).select('image_url').lean();
  if (!p?.image_url) throw notFound();
  res.json({ url: p.image_url });
}));
router.get('/admin/promotions/:id/claims', handle(async (req, res) => {
  const p = await Promotion.findById(oid(req.params.id));
  if (!p) throw notFound('Promotion');
  res.json({ promotion: await outAdmin(p), rows: await progress(p) });
}));
router.post('/admin/promotions/:id/reward', handle(async (req, res) => {
  const p = await Promotion.findById(oid(req.params.id));
  if (!p) throw notFound('Promotion');
  const row = (await progress(p)).find((x) => x.student_user_id === String(req.body?.student_user_id));
  if (!row) throw notFound('Claim');
  const when = p.counts_at === 'visa' ? 'the visa is approved' : 'the visa is approved and the student is enrolled at the university';
  if (!row.eligible) throw bad(p.kind === 'referral' ? `Not yet: ${row.counted} of ${row.needed} referred friend(s) count (${when}).` : `Not yet: the reward is given after ${when}.`);
  if (row.reward) throw bad('The voucher was already issued.');
  if (!p.provider_name || !p.provider_phone || !p.provider_email) throw bad("Add the provider's details to this promotion first (company, contact person, mobile, email): they are printed on the voucher.");
  const from = today();
  const vu = String(req.body?.valid_until ?? '');
  const until = /^\d{4}-\d{2}-\d{2}$/.test(vu) && vu >= from ? vu : addDays(from, p.voucher_valid_days || 90);
  const v = await Voucher.create({ source: 'promotion', promotion_id: p._id, student_user_id: row.student_user_id, claim_ids: row.claims.filter((c) => c.counts).map((c) => c.id),
    note: clean(req.body?.note, 300), given_by: req.user!.id, voucher_code: await genVoucher(), valid_from: from, valid_until: until, status: 'Issued',
    snapshot: { student: row.person.name, student_code: row.person.code, title: p.title, reward: p.reward, promo_code: p.code,
      provider: { name: p.provider_name, contact: p.provider_contact, phone: p.provider_phone, email: p.provider_email, address: p.provider_address }, terms: p.terms, note: PROVIDER_NOTE(p) } });
  await studentNotify(row.student_user_id, `Congratulations! Your voucher for "${p.title}" is ready: ${v.voucher_code}, valid until ${d8(until)}`, `/offers/${p._id}`);
  await audit(req, 'Create', 'Voucher', v._id, `${v.voucher_code} (${p.code}) for ${row.person.name}, valid until ${until}`);
  res.json({ ok: true, voucher_code: v.voucher_code, valid_until: until, id: String(v._id) });
}));

// ---------- vouchers ----------
const pdfOut = (res: import('express').Response, buf: Buffer, name: string, inline = false) => {
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name}"`); res.send(buf);
};
router.get('/admin/vouchers/sample.pdf', handle(async (_req, res) => { pdfOut(res, await voucherPdf(SAMPLE), 'La-Europa-voucher-sample.pdf', true); }));
router.get('/admin/vouchers/:id.pdf', handle(async (req, res) => {
  const v = await Voucher.findById(oid(req.params.id));
  if (!v) throw notFound('Voucher');
  pdfOut(res, await voucherFile(v), `La-Europa-voucher-${v.voucher_code}.pdf`);
}));
router.post('/admin/vouchers/:id/redeemed', handle(async (req, res) => {
  const v = await Voucher.findById(oid(req.params.id));
  if (!v) throw notFound('Voucher');
  const st = v.status === 'Issued' && v.valid_until < today() ? 'Expired' : v.status;
  if (st !== 'Issued') throw bad(`This voucher is ${st.toLowerCase()}.`);
  v.set({ status: 'Redeemed', redeemed_at: new Date(), redeemed_note: clean(req.body?.note, 300) }); await v.save();
  await audit(req, 'Update', 'Voucher', v._id, `${v.voucher_code} redeemed`);
  res.json({ ok: true });
}));

// ---------- referrals: who referred whom, how far the friend got ----------
router.get('/admin/referrals', handle(async (req, res) => {
  const code = req.query.promo ? String(req.query.promo).toUpperCase() : null;
  const rows = await Referral.find({ is_deleted: false, ...(code ? { promo_code: code } : {}) }).sort({ createdAt: -1 }).limit(500).lean();
  res.json({ rows: await Promise.all(rows.map(async (x) => {
    const by = await personOf(x.referrer_student_user_id);
    const su = await PortalAccount.findById(x.referrer_student_user_id).select('referralCode').lean();
    return { id: String(x._id), friend: x.friend_name, friend_lead_id: x.lead_id ?? null, created_at: x.createdAt, promo_code: x.promo_code ?? null, status: await referralStatus(x),
      referrer: by.name, referrer_code: by.code, referrer_link: by.link, referral_code: su?.referralCode ?? null };
  })) });
}));

// ---------- partner companies ----------
function companyFields(b: Record<string, unknown>) {
  const f = { name: clean(b.name, 120), contact_person: clean(b.contact_person, 100), phone: clean(b.phone, 20), email: clean(b.email, 120), address: clean(b.address, 300),
    website: clean(b.website, 200), notes: clean(b.notes, 1000), active: !(b.active === false || b.active === '0') };
  const e: Record<string, string> = {};
  if (!f.name) e.name = 'Company name is required';
  if (!f.contact_person) e.contact_person = 'Contact person is required';
  if (!f.phone || f.phone.replace(/\D/g, '').length < 10) e.phone = 'Mobile number is required';
  if (!f.email || !isEmail(f.email)) e.email = 'A valid email is required';
  if (Object.keys(e).length) throw bad(Object.values(e)[0], { errors: e });
  return f;
}
router.get('/admin/offer-companies', handle(async (_req, res) => {
  const rows = await OfferCompany.find({ is_deleted: false }).sort({ active: -1, name: 1 }).lean();
  res.json(await Promise.all(rows.map(async (c) => ({ id: String(c._id), name: c.name, contact_person: c.contact_person, phone: c.phone, email: c.email, address: c.address, website: c.website,
    notes: c.notes, active: c.active, items: await WalletItem.countDocuments({ company_id: c._id, is_deleted: false }), promotions: await Promotion.countDocuments({ provider_company_id: c._id }) }))));
}));
router.post('/admin/offer-companies', handle(async (req, res) => {
  const c = await OfferCompany.create({ ...companyFields(req.body ?? {}), created_by: req.user!.id });
  await audit(req, 'Create', 'OfferCompany', c._id, c.name);
  res.json({ id: String(c._id) });
}));
router.put('/admin/offer-companies/:id', handle(async (req, res) => {
  const c = await OfferCompany.findOne({ _id: oid(req.params.id), is_deleted: false });
  if (!c) throw notFound('Company');
  c.set(companyFields(req.body ?? {})); await c.save();
  await audit(req, 'Update', 'OfferCompany', c._id, c.name);
  res.json({ ok: true });
}));
router.delete('/admin/offer-companies/:id', handle(async (req, res) => {
  await OfferCompany.updateOne({ _id: oid(req.params.id) }, { is_deleted: true, active: false });
  await WalletItem.updateMany({ company_id: oid(req.params.id) }, { active: false });
  res.json({ ok: true });
}));

// ---------- wallet: voucher store, settings, balances, requests ----------
async function itemFields(b: Record<string, unknown>) {
  const f = { company_id: oid(b.company_id), title: clean(b.title, 120), description: clean(b.description, 500), value: Math.round(Number(b.value) || 0),
    valid_days: Math.min(730, Math.max(1, Number(b.valid_days) || 90)), terms: clean(b.terms, 3000), active: !(b.active === false || b.active === '0') };
  const e: Record<string, string> = {};
  if (!f.company_id || !(await OfferCompany.exists({ _id: f.company_id, is_deleted: false }))) e.company_id = 'Choose the company';
  if (!f.title) e.title = 'Title is required';
  if (!(f.value > 0)) e.value = 'Value (INR) is required';
  if (Object.keys(e).length) throw bad(Object.values(e)[0], { errors: e });
  return f;
}
router.get('/admin/wallet/items', handle(async (_req, res) => {
  res.json(await Promise.all((await WalletItem.find({ is_deleted: false }).sort({ active: -1, value: 1 }).lean()).map(itemOut)));
}));
router.post('/admin/wallet/items', handle(async (req, res) => {
  const i = await WalletItem.create({ ...(await itemFields(req.body ?? {})), created_by: req.user!.id });
  await audit(req, 'Create', 'WalletItem', i._id, `${i.title} ${inr(i.value)}`);
  res.json({ id: String(i._id) });
}));
router.put('/admin/wallet/items/:id', handle(async (req, res) => {
  const i = await WalletItem.findOne({ _id: oid(req.params.id), is_deleted: false });
  if (!i) throw notFound('Voucher');
  i.set(await itemFields(req.body ?? {})); await i.save();
  res.json({ ok: true });
}));
router.delete('/admin/wallet/items/:id', handle(async (req, res) => {
  await WalletItem.updateOne({ _id: oid(req.params.id) }, { is_deleted: true, active: false });
  res.json({ ok: true });
}));
router.get('/admin/wallet/settings', handle(async (_req, res) => {
  const c = await walletCfg();
  const name = async (r: { type: string; id: string }) => (oid(r.id) ? ((r.type === 'country' ? await Country.findById(r.id).select('name').lean() : await University.findById(r.id).select('name').lean()) as { name?: string } | null)?.name ?? '' : '');
  res.json({ ...c, rules: await Promise.all(c.rules.map(async (r) => ({ ...r, name: await name(r) }))),
    countries: (await Country.find().sort({ name: 1 }).select('name').lean()).map((x) => ({ id: String(x._id), name: x.name })),
    universities: (await University.find().sort({ name: 1 }).select('name').lean()).map((x) => ({ id: String(x._id), name: x.name })) });
}));
router.put('/admin/wallet/settings', handle(async (req, res) => {
  const b = req.body ?? {};
  const def = Math.round(Number(b.referral_default)), min = Math.round(Number(b.min_redeem));
  if (!(def >= 0) || !(min >= 1)) throw bad('Write the amounts in rupees');
  const rules = ([] as Record<string, unknown>[]).concat(b.rules ?? []).filter((r) => ['country', 'university'].includes(String(r.type)) && r.id && Number(r.amount) >= 0)
    .map((r) => ({ type: r.type, id: String(r.id), amount: Math.round(Number(r.amount)) }));
  await setSetting('wallet_referral_default', String(def), req.user!.id);
  await setSetting('wallet_min_redeem', String(min), req.user!.id);
  await setSetting('wallet_rules', JSON.stringify(rules), req.user!.id);
  await audit(req, 'Update', 'Settings', 'wallet', `Referral ${inr(def)}, convert from ${inr(min)}, ${rules.length} rule(s)`);
  res.json({ ok: true });
}));
router.get('/admin/wallet/students', handle(async (_req, res) => {
  await creditReferrals();
  const rows = await WalletTxn.aggregate([{ $group: { _id: '$student_user_id', balance: { $sum: '$amount' }, earned: { $sum: { $cond: [{ $eq: ['$kind', 'referral'] }, '$amount', 0] } }, last: { $max: '$createdAt' } } }, { $sort: { balance: -1 } }]);
  res.json(await Promise.all(rows.map(async (x) => ({ student_user_id: String(x._id), balance: x.balance, earned: x.earned, last: x.last, person: await personOf(x._id) }))));
}));
router.get('/admin/wallet/students/:suId', handle(async (req, res) => {
  const su = oid(req.params.suId);
  if (!su) throw notFound('Student');
  const rows = await WalletTxn.find({ student_user_id: su }).sort({ createdAt: -1 }).lean();
  res.json({ person: await personOf(su), balance: await balance(su), rows: rows.map((x) => ({ id: String(x._id), kind: x.kind, amount: x.amount, reason: x.reason, created_at: x.createdAt })) });
}));
// a manual correction with a reason; the wallet never goes below zero
router.post('/admin/wallet/students/:suId/adjust', handle(async (req, res) => {
  const su = oid(req.params.suId);
  const amt = Math.round(Number(req.body?.amount) || 0), reason = clean(req.body?.reason, 200);
  if (!amt) throw bad('Write the amount (minus to deduct)');
  if (!reason) throw bad('Write the reason');
  if (!su || !(await PortalAccount.exists({ _id: su }))) throw notFound('Student');
  if ((await balance(su)) + amt < 0) throw bad('The wallet cannot go below zero.');
  await WalletTxn.create({ student_user_id: su, kind: 'adjust', amount: amt, reason, ref_type: 'manual', created_by: req.user!.id });
  await studentNotify(su, `${amt > 0 ? inr(amt) + ' added to' : inr(-amt) + ' deducted from'} your wallet: ${reason}`, '/wallet');
  await audit(req, 'Update', 'Wallet', su, `${amt > 0 ? '+' : ''}${amt}: ${reason}`);
  res.json({ ok: true, balance: await balance(su) });
}));
router.get('/admin/wallet/requests', handle(async (req, res) => {
  const st = String(req.query.status || 'Requested');
  const rows = await WalletRedemption.find(st === 'all' ? {} : { status: st }).sort({ createdAt: -1 }).limit(500);
  res.json(await Promise.all(rows.map(async (r) => ({ ...(await redemptionOut(r)), student_user_id: String(r.student_user_id), person: await personOf(r.student_user_id), balance: await balance(r.student_user_id) }))));
}));
router.post('/admin/wallet/requests/:id/approve', handle(async (req, res) => {
  const r = await WalletRedemption.findById(oid(req.params.id));
  if (!r) throw notFound('Request');
  if (r.status !== 'Requested') throw bad(`This request is already ${r.status.toLowerCase()}.`);
  const i = await WalletItem.findById(r.item_id).lean();
  const c = i ? await OfferCompany.findById(i.company_id).lean() : null;
  if (!i || !c) throw notFound('Voucher');
  const p = await personOf(r.student_user_id);
  const from = today(), until = addDays(from, i.valid_days || 90);
  const v = await Voucher.create({ source: 'wallet', redemption_id: r._id, student_user_id: r.student_user_id, note: `Wallet ${inr(r.amount)}`, given_by: req.user!.id,
    voucher_code: await genVoucher(), valid_from: from, valid_until: until, status: 'Issued',
    snapshot: { student: p.name, student_code: p.code, title: `${i.title} (from your La Europa wallet)`, reward: i.title, promo_code: 'Wallet',
      provider: { name: c.name, contact: c.contact_person, phone: c.phone, email: c.email, address: c.address }, terms: i.terms ?? '', note: walletNote(c.name) } });
  r.set({ status: 'Approved', voucher_id: v._id, decided_by: req.user!.id, decided_at: new Date() }); await r.save();
  await studentNotify(r.student_user_id, `Your voucher is ready: ${i.title}, code ${v.voucher_code}, valid until ${d8(until)}. Download it from My wallet.`, '/wallet');
  await audit(req, 'Create', 'Voucher', v._id, `${v.voucher_code} wallet ${inr(r.amount)} for ${p.name}`);
  res.json({ ok: true, voucher_code: v.voucher_code, voucher_id: String(v._id) });
}));
router.post('/admin/wallet/requests/:id/decline', handle(async (req, res) => {
  const reason = clean(req.body?.reason, 300);
  if (!reason) throw bad('Write the reason');
  const r = await WalletRedemption.findById(oid(req.params.id));
  if (!r) throw notFound('Request');
  if (r.status !== 'Requested') throw bad(`This request is already ${r.status.toLowerCase()}.`);
  r.set({ status: 'Declined', reason, decided_by: req.user!.id, decided_at: new Date() }); await r.save();
  await WalletTxn.create({ student_user_id: r.student_user_id, kind: 'release', amount: r.amount, reason: `Voucher request declined: ${reason}`, ref_type: 'redemption', ref_id: r._id, created_by: req.user!.id });
  await studentNotify(r.student_user_id, `Your voucher request was not approved (${reason}). ${inr(r.amount)} is back in your wallet.`, '/wallet');
  res.json({ ok: true });
}));

export default router;
