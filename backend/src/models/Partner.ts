import mongoose, { Schema, Document, Types } from 'mongoose';

/** The client's university partner portal tables (legacy/server/university/schema.js), in the CRM database. */

/* eslint-disable @typescript-eslint/no-explicit-any */
const ref = (model: string) => ({ type: Schema.Types.ObjectId, ref: model });
const oidOf = { type: Schema.Types.ObjectId };
const STD = { created_by: oidOf, created_by_type: { type: String, default: 'staff' }, updated_by: oidOf, updated_by_type: String,
  is_deleted: { type: Boolean, default: false }, deleted_at: Date, deleted_by: oidOf, delete_reason: String };
type Doc = Document & Record<string, any> & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
const model = (name: string, def: Record<string, unknown>, std = true) =>
  mongoose.model<Doc>(name, new Schema((std ? { ...def, ...STD } : def) as never, { timestamps: true }));
const uni = { ...ref('University'), required: true, index: true };
const uapp = { ...ref('UniversityApplication'), required: true, index: true };

// ---------- accounts (logins live in portalaccounts, role "university") ----------
export const UniConsent = model('UniConsent', { account_id: { ...ref('PortalAccount'), required: true }, university_id: ref('University'), doc_type: { type: String, required: true }, version: String, doc_hash: String, ip: String, user_agent: String }, false);
export const UniNotification = model('UniNotification', { account_id: { ...ref('PortalAccount'), required: true, index: true }, title: { type: String, required: true }, link: String, is_read: { type: Boolean, default: false } }, false);
export const UniLoginAttempt = model('UniLoginAttempt', { ident: { type: String, index: true }, success: Boolean, ip: { type: String, index: true } }, false);
export const UniCode = model('UniCode', { account_id: ref('PortalAccount'), purpose: { type: String, required: true }, code_hash: { type: String, required: true, index: true }, attempts: { type: Number, default: 0 },
  expires_at: Date, used: { type: Boolean, default: false }, last_sent_at: Date, payload: Schema.Types.Mixed }, false);

// ---------- institution ----------
export const PartnerAgreement = model('PartnerAgreement', { agreement_code: { type: String, unique: true, sparse: true }, university_id: uni, title: { type: String, required: true }, start_date: { type: String, required: true },
  end_date: String, auto_renew: Boolean, notice_days: Number, signed_by_le: String, signed_by_uni: String, signed_on: String, territory: [String], scope_text: String, commission_terms: String,
  payment_terms_days: Number, invoice_currency: String, file: Schema.Types.Mixed, file_versions: [Schema.Types.Mixed], show_to_uni: { type: Boolean, default: true }, status: { type: String, default: 'Draft' },
  terminate_reason: String, internal_note: String, reminders: [String] });
export const Campus = model('Campus', { university_id: uni, name: { type: String, required: true }, city: { type: String, required: true }, address: String, map_link: String, is_main: Boolean, status: { type: String, default: 'Active' } });
export const UniContact = model('UniContact', { university_id: uni, department: { type: String, required: true }, name: { type: String, required: true }, designation: String, email: { type: String, required: true }, phone: String,
  is_primary: Boolean, account_id: ref('PortalAccount') });
export const UniProfileRequest = model('UniProfileRequest', { university_id: uni, payload: { type: Schema.Types.Mixed, required: true }, old: Schema.Types.Mixed, status: { type: String, default: 'Pending' },
  requested_by: ref('PortalAccount'), review_note: String, reviewed_by: ref('User'), reviewed_at: Date, final: Schema.Types.Mixed });
export const CourseChangeRequest = model('CourseChangeRequest', { university_id: uni, course_id: ref('Course'), scholarship_id: ref('Scholarship'), entity: { type: String, default: 'course' }, change_type: { type: String, required: true },
  payload: { type: Schema.Types.Mixed, required: true }, old: Schema.Types.Mixed, status: { type: String, default: 'Pending approval', index: true }, urgent: Boolean, urgent_reason: String, batch_id: ref('UniImportBatch'),
  requested_by: ref('PortalAccount'), reviewed_by: ref('User'), reviewed_at: Date, review_note: String, auto_approved: Boolean, warnings: [String], final: Schema.Types.Mixed });
export const UniImportBatch = model('UniImportBatch', { university_id: uni, file_name: String, counts: Schema.Types.Mixed, errors: [Schema.Types.Mixed], status: { type: String, default: 'Submitted' }, created_by: ref('PortalAccount') }, false);
export const Scholarship = model('Scholarship', { code: String, university_id: uni, name: { type: String, required: true }, description: String, benefit_type: String, amount: Number, currency: String, percent: Number,
  min_percent: Number, other_criteria: String, applies: Schema.Types.Mixed, deadline: String, how_apply: String, link: String, status: { type: String, default: 'Draft' }, valid_until: String });

// ---------- applications shared with a university ----------
export const UniversityApplication = model('UniversityApplication', { application_id: { ...ref('Application'), required: true, unique: true }, university_id: uni, campus_id: ref('Campus'),
  status: { type: String, default: 'New', index: true }, review_status: String, status_changed_at: Date, submitted_at: Date, submitted_by: ref('User'), cover_note: String, consent_id: oidOf, shared_fields: [String],
  university_ref: String, expected_decision: String, version: { type: Number, default: 1 }, flag_docs_requested: Boolean, flag_waitlisted: Boolean, first_decision_at: Date, reject_reason: String, enrol_date: String,
  student_uni_id: String, programme_start: String, final_tuition: Number, final_currency: String, scholarship_amount: Number, deposit_amount: Number, deposit_currency: String, deposit_date: String,
  withdrawn_at: Date, withdraw_reason_uni: String, email_thread_root_id: String, email_refs: [String], last_e33_at: Date });
export const UniAction = model('UniAction', { uapp_id: uapp, university_id: uni, application_id: ref('Application'), type: { type: String, required: true }, data: Schema.Types.Mixed, from_status: String, to_status: String,
  by_account_id: ref('PortalAccount'), by_staff_id: ref('User'), processing: { type: String, default: 'Pending review', index: true }, held_note: String, processed_by: ref('User'), processed_at: Date,
  forced_review: Boolean, reminded_at: Date }, false);
export const UniDocRequest = model('UniDocRequest', { uapp_id: uapp, university_id: uni, message: String, needed_by: String, pause: { type: Boolean, default: true }, status: { type: String, default: 'Open' }, prev_status: String,
  cancel_reason: String, created_by: ref('PortalAccount'), answered_at: Date, opened_by_uni_at: Date, items: [{ document_type_id: ref('MasterItem'), title: String, note: String, status: { type: String, default: 'Open' }, reply: String, share_id: oidOf }] }, false);
export const UniDocShare = model('UniDocShare', { uapp_id: uapp, university_id: uni, document_id: { ...ref('StudentDocument'), required: true }, version_id: { ...oidOf, required: true }, shared_by: ref('User'), shared_at: Date,
  status: { type: String, default: 'Shared' }, revoked_reason: String, revoked_at: Date, viewed_at: Date, downloaded_at: Date, access_expires_at: Date }, false);
/** append-only: every view and download of a shared document */
export const DocAccessLog = model('DocAccessLog', { account_id: ref('PortalAccount'), university_id: ref('University'), uapp_id: ref('UniversityApplication'), document_id: oidOf, version_id: oidOf, action: String, ip: String, user_agent: String }, false);
export const UniMessage = model('UniMessage', { uapp_id: { ...ref('UniversityApplication'), index: true }, university_id: uni, sender_type: { type: String, required: true }, sender_account_id: ref('PortalAccount'), sender_user_id: ref('User'),
  body: String, original_body: String, context_type: String, context_id: String, edited_at: Date, deleted_at: Date, sent_at: Date, seen_by_uni_at: Date, seen_by_le_at: Date, contact_warning: Boolean,
  attachments: [{ file: Schema.Types.Mixed, original_name: String, mime_type: String, size_bytes: Number, saved_document_id: oidOf }] }, false);
export const UniAnnouncement = model('UniAnnouncement', { university_id: uni, type: { type: String, required: true }, title: { type: String, required: true }, body: { type: String, required: true }, related: Schema.Types.Mixed,
  important: Boolean, valid_until: String, attachments: [Schema.Types.Mixed], status: { type: String, default: 'Posted' }, published_at: Date, published_by: ref('User'), published_scope: String,
  handled_by: ref('User'), handled_at: Date, created_by: ref('PortalAccount') }, false);
export const UniNotice = model('UniNotice', { university_id: ref('University'), title: { type: String, required: true }, body: String, active_until: String, created_by: ref('User') }, false);
export const OfferLetter = model('OfferLetter', { uapp_id: uapp, application_id: ref('Application'), type: String, document_id: ref('StudentDocument'), version_id: oidOf, issue_date: String, conditions_text: String }, false);
export const ShareConsentRequest = model('ShareConsentRequest', { student_id: { ...ref('Student'), required: true, index: true }, university_id: uni, application_id: ref('Application'), status: { type: String, default: 'Requested' },
  requested_by: ref('User'), requested_at: Date, answered_at: Date, method: String, document_id: oidOf, reason: String }, false);

// ---------- commission ----------
export const CommissionRule = model('CommissionRule', { rule_code: String, university_id: uni, agreement_id: ref('PartnerAgreement'), name: { type: String, required: true }, scope: { type: String, default: 'all' }, scope_ids: [String],
  intakes: [String], valid_from: String, valid_to: String, basis: { type: String, required: true }, rate: Number, fixed_amount: Number, fixed_currency: String, due_event: { type: String, default: 'enrolled' }, due_days: Number,
  slabs: [Schema.Types.Mixed], min_amount: Number, max_amount: Number, cap_currency: String, show_to_uni: { type: Boolean, default: true }, status: { type: String, default: 'Active' }, internal_note: String });
export const Commission = model('Commission', { commission_code: String, university_id: uni, uapp_id: uapp, application_id: ref('Application'), rule_id: ref('CommissionRule'), basis_amount: Number, basis_currency: String,
  rate: Number, fixed_amount: Number, amount: Number, currency: String, fx_rate: Number, fx_date: String, invoice_amount: Number, invoice_currency: String, status: { type: String, default: 'Expected', index: true },
  due_date: String, invoice_id: ref('CommissionInvoice'), cancel_reason: String, recalculated: Boolean, internal_note: String });
export const CommissionInvoice = model('CommissionInvoice', { invoice_no: { type: String, unique: true, sparse: true }, kind: { type: String, default: 'invoice' }, credit_for: ref('CommissionInvoice'), university_id: uni,
  agreement_id: ref('PartnerAgreement'), invoice_date: String, due_date: String, currency: String, subtotal: Number, tax: Schema.Types.Mixed, total: Number, paid: { type: Number, default: 0 }, bill_to: Schema.Types.Mixed,
  notes: String, status: { type: String, default: 'Draft' }, pdf: Schema.Types.Mixed, query_open: Boolean, reminders_paused: Boolean, last_reminder_at: Date, cancel_reason: String, email_thread_root_id: String,
  email_refs: [String], issued_at: Date, issued_by: ref('User') });
export const CommissionPayment = model('CommissionPayment', { invoice_id: { ...ref('CommissionInvoice'), required: true, index: true }, university_id: uni, amount: { type: Number, required: true }, currency: String, payment_date: String,
  reference: String, proof: Schema.Types.Mixed, proof_name: String, note: String, status: { type: String, default: 'Submitted' }, confirmed_amount: Number, reject_reason: String, submitted_by: ref('PortalAccount'),
  reviewed_by: ref('User'), reviewed_at: Date, source: { type: String, default: 'university' } }, false);
export const InvoiceQuery = model('InvoiceQuery', { invoice_id: { ...ref('CommissionInvoice'), required: true }, university_id: uni, commission_id: ref('Commission'), status: { type: String, default: 'Open' }, created_by: ref('PortalAccount'),
  closed_at: Date, closed_by: ref('User'), messages: [{ sender_type: String, sender_id: oidOf, body: String, sent_at: Date }] }, false);
