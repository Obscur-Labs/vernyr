import mongoose, { Schema, Document, Types } from 'mongoose';

/** A university (legacy `universities`): one country, a University ID (DE-001), a logo, and the course settings every course of it follows. */
export interface UniDefaults {
  intakes: { intake_id: string; open_date?: string | null; deadline?: string | null; deadline_note?: string | null }[];
  english: { test_type: string; min_overall?: number | null; min_band?: number | null; moi_accepted?: boolean; min_12th_english_percent?: number | null }[];
  application_fee?: number | null; application_fee_currency?: string; currency?: string | null; language?: string | null;
  academic: { required_level?: string | null; min_percent?: number | null; max_backlogs?: number | null; min_work_months?: number | null; entrance_test?: string | null };
}
/** partner portal settings on a university (legacy/server/university/schema.js) */
export interface UniPartner {
  portal_status?: string; account_code?: string; display_name?: string; partner_manager_id?: Types.ObjectId; notify_mode?: string; share_contact?: boolean; share_passport?: boolean; share_visa?: boolean;
  viewer_docs?: boolean; officers_propose?: boolean; max_users?: number; doc_access_rule?: string; doc_access_months?: number; uni_internal_note?: string; partner_thread_root_id?: string; partner_refs?: string[];
  about?: string; uni_type?: string; intl_page?: string; founded_year?: number; students_count?: number; languages?: string[]; rankings?: unknown[]; accreditations?: string[]; social?: Record<string, string>;
  cover?: unknown; watermark?: boolean; zip_download?: boolean; enrol_from_accepted?: boolean; ip_allowlist?: string; show_expected_commission?: boolean; viewer_exports?: boolean; suspend_reason?: string;
  legal_name?: string; billing_address?: string; vat_id?: string; timezone?: string; override_reason?: string; transfer_blocked?: boolean;
}
export interface IUniversity extends Document, UniPartner {
  name: string; short_name?: string; uni_code?: string; country_id?: Types.ObjectId; city?: string; website?: string; type?: string; active: boolean; approved: boolean;
  logo_url?: string; logo_public_id?: string; logo_updated_at?: Date; logo_source_note?: string; logo_approved_by?: Types.ObjectId; logo_approved_at?: Date; course_defaults?: UniDefaults; is_deleted: boolean; created_by?: Types.ObjectId; createdAt: Date; updatedAt: Date;
}
const UniversitySchema = new Schema<IUniversity>({
  name: { type: String, required: true, trim: true }, short_name: String, uni_code: { type: String, unique: true, sparse: true }, country_id: { type: Schema.Types.ObjectId, ref: 'Country', index: true },
  city: String, website: String, type: String, active: { type: Boolean, default: true }, approved: { type: Boolean, default: true },
  logo_url: String, logo_public_id: String, logo_updated_at: Date, logo_source_note: String, logo_approved_by: { type: Schema.Types.ObjectId, ref: 'User' }, logo_approved_at: Date, course_defaults: Schema.Types.Mixed, is_deleted: { type: Boolean, default: false },
  created_by: { type: Schema.Types.ObjectId, ref: 'User' },
  // partner portal (legacy/server/university/schema.js addColumns)
  portal_status: String, account_code: String, display_name: String, partner_manager_id: { type: Schema.Types.ObjectId, ref: 'User' }, notify_mode: { type: String, default: 'review' },
  share_contact: Boolean, share_passport: Boolean, share_visa: Boolean, viewer_docs: Boolean, officers_propose: { type: Boolean, default: true }, max_users: { type: Number, default: 10 },
  doc_access_rule: { type: String, default: 'enrolment' }, doc_access_months: Number, uni_internal_note: String, partner_thread_root_id: String, partner_refs: [String], about: String, uni_type: String,
  intl_page: String, founded_year: Number, students_count: Number, languages: [String], rankings: [Schema.Types.Mixed], accreditations: [String], social: Schema.Types.Mixed, cover: Schema.Types.Mixed,
  watermark: { type: Boolean, default: true }, zip_download: { type: Boolean, default: true }, enrol_from_accepted: Boolean, ip_allowlist: String, show_expected_commission: Boolean,
  viewer_exports: { type: Boolean, default: true }, suspend_reason: String, legal_name: String, billing_address: String, vat_id: String, timezone: String, override_reason: String, transfer_blocked: Boolean,
}, { timestamps: true });

export default mongoose.model<IUniversity>('University', UniversitySchema);
