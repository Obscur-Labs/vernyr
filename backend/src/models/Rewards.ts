import mongoose, { Schema, Document, Types } from 'mongoose';

/** The client's promotions, referral rewards, vouchers and the student wallet (legacy/server/promotions.js, wallet.js). */

const ref = (model: string) => ({ type: Schema.Types.ObjectId, ref: model });

export interface IPromotion extends Document {
  code: string; title: string; message?: string; image_url?: string; image_public_id?: string; kind: 'offer' | 'application' | 'referral' | 'partner'; reward?: string;
  audience: 'all' | 'students' | 'leads'; scope_type: 'all' | 'country' | 'university'; scope_ids: string[]; starts_on?: string; ends_on?: string; status: 'Draft' | 'Published' | 'Ended';
  min_referrals: number; terms?: string; provider_company_id?: Types.ObjectId; provider_name?: string; provider_contact?: string; provider_phone?: string; provider_email?: string;
  provider_address?: string; voucher_valid_days: number; counts_at: 'visa' | 'enrolment'; partner_link?: string; partner_code?: string; partner_clicks: number;
  notified_count: number; published_at?: Date; ended_at?: Date; created_by?: Types.ObjectId; createdAt: Date; updatedAt: Date;
}
export const Promotion = mongoose.model<IPromotion>('Promotion', new Schema<IPromotion>({
  code: { type: String, required: true, unique: true }, title: { type: String, required: true }, message: String, image_url: String, image_public_id: String,
  kind: { type: String, default: 'offer' }, reward: String, audience: { type: String, default: 'all' }, scope_type: { type: String, default: 'all' }, scope_ids: { type: [String], default: [] },
  starts_on: String, ends_on: String, status: { type: String, default: 'Draft' }, min_referrals: { type: Number, default: 1 }, terms: String, provider_company_id: ref('OfferCompany'),
  provider_name: String, provider_contact: String, provider_phone: String, provider_email: String, provider_address: String, voucher_valid_days: { type: Number, default: 90 },
  counts_at: { type: String, default: 'enrolment' }, partner_link: String, partner_code: String, partner_clicks: { type: Number, default: 0 },
  notified_count: { type: Number, default: 0 }, published_at: Date, ended_at: Date, created_by: ref('User'),
}, { timestamps: true }));

export const PromotionSeen = mongoose.model('PromotionSeen', new Schema({
  promotion_id: { ...ref('Promotion'), required: true }, student_user_id: { ...ref('PortalAccount'), required: true }, seen_at: { type: Date, default: Date.now },
}).index({ promotion_id: 1, student_user_id: 1 }, { unique: true }));

export interface IPromotionClaim extends Document {
  promotion_id: Types.ObjectId; code: string; kind: string; student_user_id: Types.ObjectId; student_id?: Types.ObjectId; lead_id?: Types.ObjectId; application_request_id?: Types.ObjectId;
  application_id?: Types.ObjectId; university_id?: Types.ObjectId; country_id?: Types.ObjectId; referrer_student_user_id?: Types.ObjectId; consent_record_id?: Types.ObjectId; entered_at: Date;
}
export const PromotionClaim = mongoose.model<IPromotionClaim>('PromotionClaim', new Schema<IPromotionClaim>({
  promotion_id: { ...ref('Promotion'), required: true, index: true }, code: String, kind: String, student_user_id: ref('PortalAccount'), student_id: ref('Student'), lead_id: ref('Lead'),
  application_request_id: ref('ApplicationRequest'), application_id: ref('Application'), university_id: ref('University'), country_id: ref('Country'),
  referrer_student_user_id: ref('PortalAccount'), consent_record_id: ref('ConsentRecord'), entered_at: { type: Date, default: Date.now },
}));

/** A voucher: from a promotion (promotion_id) or from the wallet (redemption_id). Its own code, valid for a time, redeemed with the provider. */
export interface IVoucher extends Document {
  source: 'promotion' | 'wallet'; promotion_id?: Types.ObjectId; redemption_id?: Types.ObjectId; student_user_id: Types.ObjectId; claim_ids: Types.ObjectId[]; note?: string;
  given_by?: Types.ObjectId; given_at: Date; voucher_code: string; valid_from: string; valid_until: string; status: string; redeemed_at?: Date; redeemed_note?: string; snapshot: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
export const Voucher = mongoose.model<IVoucher>('Voucher', new Schema<IVoucher>({
  source: { type: String, default: 'promotion' }, promotion_id: ref('Promotion'), redemption_id: ref('WalletRedemption'), student_user_id: { ...ref('PortalAccount'), required: true, index: true },
  claim_ids: [Schema.Types.ObjectId], note: String, given_by: ref('User'), given_at: { type: Date, default: Date.now }, voucher_code: { type: String, required: true, unique: true },
  valid_from: String, valid_until: String, status: { type: String, default: 'Issued' }, redeemed_at: Date, redeemed_note: String, snapshot: Schema.Types.Mixed,
}).index({ promotion_id: 1, student_user_id: 1 }, { unique: true, partialFilterExpression: { source: 'promotion' } }));

export interface IOfferCompany extends Document {
  name: string; contact_person?: string; phone?: string; email?: string; address?: string; website?: string; notes?: string; active: boolean; is_deleted: boolean; created_by?: Types.ObjectId;
}
export const OfferCompany = mongoose.model<IOfferCompany>('OfferCompany', new Schema<IOfferCompany>({
  name: { type: String, required: true }, contact_person: String, phone: String, email: String, address: String, website: String, notes: String,
  active: { type: Boolean, default: true }, is_deleted: { type: Boolean, default: false }, created_by: ref('User'),
}, { timestamps: true }));

export interface IWalletItem extends Document {
  company_id: Types.ObjectId; title: string; description?: string; value: number; valid_days: number; terms?: string; active: boolean; is_deleted: boolean; created_by?: Types.ObjectId;
}
export const WalletItem = mongoose.model<IWalletItem>('WalletItem', new Schema<IWalletItem>({
  company_id: { ...ref('OfferCompany'), required: true }, title: { type: String, required: true }, description: String, value: { type: Number, required: true },
  valid_days: { type: Number, default: 90 }, terms: String, active: { type: Boolean, default: true }, is_deleted: { type: Boolean, default: false }, created_by: ref('User'),
}, { timestamps: true }));

/** The wallet is a ledger: its balance is the sum of its entries. A referral is credited once (unique ref). */
export interface IWalletTxn extends Document {
  student_user_id: Types.ObjectId; kind: 'referral' | 'hold' | 'release' | 'adjust'; amount: number; reason?: string; ref_type?: string; ref_id?: Types.ObjectId; created_by?: Types.ObjectId; createdAt: Date;
}
export const WalletTxn = mongoose.model<IWalletTxn>('WalletTxn', new Schema<IWalletTxn>({
  student_user_id: { ...ref('PortalAccount'), required: true, index: true }, kind: { type: String, required: true }, amount: { type: Number, required: true }, reason: String,
  ref_type: String, ref_id: Schema.Types.ObjectId, created_by: ref('User'),
}, { timestamps: { createdAt: true, updatedAt: false } }).index({ ref_type: 1, ref_id: 1, kind: 1 }, { unique: true, partialFilterExpression: { ref_type: 'referral' } }));

export interface IWalletRedemption extends Document {
  student_user_id: Types.ObjectId; item_id: Types.ObjectId; amount: number; status: string; voucher_id?: Types.ObjectId; decided_by?: Types.ObjectId; decided_at?: Date; reason?: string; createdAt: Date;
}
export const WalletRedemption = mongoose.model<IWalletRedemption>('WalletRedemption', new Schema<IWalletRedemption>({
  student_user_id: { ...ref('PortalAccount'), required: true, index: true }, item_id: { ...ref('WalletItem'), required: true }, amount: { type: Number, required: true },
  status: { type: String, default: 'Requested' }, voucher_id: ref('Voucher'), decided_by: ref('User'), decided_at: Date, reason: String,
}, { timestamps: true }));
