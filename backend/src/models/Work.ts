import mongoose, { Schema, Document, Types } from 'mongoose';

/** The client's working records (legacy shortlists, applications, documents, fees, payments, visa_cases and their history tables). */

const ref = (to: string) => ({ type: Schema.Types.ObjectId, ref: to });
const STD = { is_deleted: { type: Boolean, default: false }, delete_reason: String, created_by: ref('User'), updated_by: ref('User') };
type Std = { is_deleted: boolean; delete_reason?: string; created_by?: Types.ObjectId; updated_by?: Types.ObjectId; createdAt: Date; updatedAt: Date };

// ---------- shortlist (6) ----------
export const SL_STATUS = ['Suggested', 'Shared with student', 'Student agreed', 'Rejected by student', 'Converted to application'];
export interface IShortlist extends Document, Std {
  student_id: Types.ObjectId; country_id?: Types.ObjectId; university_id?: Types.ObjectId; course_id?: Types.ObjectId; course_name_text?: string; level?: string;
  intake_id?: Types.ObjectId; tuition_fee?: number; currency: string; application_fee?: number; app_fee_currency?: string; deadline?: string; course_link?: string;
  duration?: string; language?: string; priority?: string; status: string; remarks?: string; warning_flags: string[]; checked_similar: boolean;
  remark_for_student?: string; student_response?: string; student_response_reason?: string; student_response_at?: Date; show_priority_to_student: boolean; shared_at?: Date; application_id?: Types.ObjectId;
}
export const Shortlist = mongoose.model<IShortlist>('Shortlist', new Schema<IShortlist>({
  student_id: { ...ref('Student'), required: true, index: true }, country_id: ref('Country'), university_id: ref('University'), course_id: ref('Course'),
  course_name_text: String, level: String, intake_id: ref('Intake'), tuition_fee: Number, currency: { type: String, default: 'EUR' }, application_fee: Number,
  app_fee_currency: String, deadline: String, course_link: String, duration: String, language: String, priority: String, status: { type: String, default: 'Suggested' },
  remarks: String, warning_flags: { type: [String], default: [] }, checked_similar: { type: Boolean, default: false }, remark_for_student: String, student_response: String, student_response_reason: String, student_response_at: Date,
  show_priority_to_student: { type: Boolean, default: false }, shared_at: Date, application_id: ref('Application'), ...STD,
}, { timestamps: true }));

// ---------- applications (7): one Application & Visa flow ----------
export interface IApplication extends Document, Std {
  application_code: string; student_id: Types.ObjectId; shortlist_id?: Types.ObjectId; country_id?: Types.ObjectId; university_id?: Types.ObjectId; course_id?: Types.ObjectId;
  course_name_text?: string; level?: string; intake_id?: Types.ObjectId; stage: string; stage_changed_at: Date; applied_date?: string; deadline?: string;
  university_app_id?: string; portal_ref?: string; portal_secret_enc?: string; channel?: string; app_fee?: number; app_fee_currency?: string; app_fee_paid: boolean;
  app_fee_paid_date?: string; app_fee_paid_by?: string; interview_at?: Date; interview_link?: string; offer_type?: string; offer_conditions?: string; offer_deadline?: string;
  deposit_required?: number; deposit_currency?: string; handled_by?: Types.ObjectId; remarks_internal?: string; source_channel: string; show_university_ref_to_student?: boolean;
  application_request_id?: Types.ObjectId; student_offer_response?: string; student_offer_response_at?: Date; student_offer_response_ip?: string;
}
export const Application = mongoose.model<IApplication>('Application', new Schema<IApplication>({
  application_code: { type: String, required: true, unique: true }, student_id: { ...ref('Student'), required: true, index: true }, shortlist_id: ref('Shortlist'),
  country_id: ref('Country'), university_id: ref('University'), course_id: ref('Course'), course_name_text: String, level: String, intake_id: ref('Intake'),
  stage: { type: String, default: 'documents_pending', index: true }, stage_changed_at: { type: Date, default: Date.now }, applied_date: String, deadline: String,
  university_app_id: String, portal_ref: String, portal_secret_enc: String, channel: String, app_fee: Number, app_fee_currency: String, app_fee_paid: { type: Boolean, default: false },
  app_fee_paid_date: String, app_fee_paid_by: String, interview_at: Date, interview_link: String, offer_type: String, offer_conditions: String, offer_deadline: String,
  deposit_required: Number, deposit_currency: String, handled_by: ref('User'), remarks_internal: String, source_channel: { type: String, default: 'counsellor' },
  show_university_ref_to_student: Boolean, application_request_id: Schema.Types.ObjectId, student_offer_response: String, student_offer_response_at: Date, student_offer_response_ip: String, ...STD,
}, { timestamps: true }));

export interface IStageHistory extends Document {
  application_id?: Types.ObjectId; visa_case_id?: Types.ObjectId; attempt_no?: number; from_stage?: string; to_stage: string; reason?: string; notified: boolean;
  show_reason_to_student?: boolean; override_reason?: string; changed_by?: Types.ObjectId; changed_at: Date;
}
export const StageHistory = mongoose.model<IStageHistory>('StageHistory', new Schema<IStageHistory>({
  application_id: { ...ref('Application'), index: true }, visa_case_id: { ...ref('VisaCase'), index: true }, attempt_no: Number, from_stage: String, to_stage: { type: String, required: true },
  reason: String, notified: { type: Boolean, default: true }, show_reason_to_student: Boolean, override_reason: String, changed_by: ref('User'), changed_at: { type: Date, default: Date.now },
}));

// ---------- documents (8) ----------
/** Which document types a student needs, by country and level (legacy checklist_items). */
export interface IChecklistItem extends Document, Std {
  country_id?: Types.ObjectId; level?: string; document_type_id: Types.ObjectId; required: string; sort: number; active: boolean;
  visible_student: boolean; note?: string; stage?: string; applies_existing: boolean;
}
export const ChecklistItem = mongoose.model<IChecklistItem>('ChecklistItem', new Schema<IChecklistItem>({
  country_id: ref('Country'), level: String, document_type_id: { ...ref('MasterItem'), required: true }, required: { type: String, default: 'Yes' }, sort: { type: Number, default: 0 },
  active: { type: Boolean, default: true }, visible_student: { type: Boolean, default: true }, note: String, stage: String, applies_existing: { type: Boolean, default: true }, ...STD,
}, { timestamps: true }));

export interface IDocVersion { _id: Types.ObjectId; version_no: number; url: string; public_id?: string; resource_type?: string; stored_name?: string; original_name?: string;
  mime_type?: string; size_bytes?: number; uploaded_by?: Types.ObjectId; uploaded_by_type: string; note_for_counsellor?: string; uploaded_at: Date; version_status?: string; version_reason?: string }
export interface IStudentDocument extends Document, Std {
  student_id: Types.ObjectId; application_id?: Types.ObjectId; visa_case_id?: Types.ObjectId; document_type_id: Types.ObjectId; title?: string;
  status: string; rejection_reason?: string; rejection_text?: string; expiry_date?: string; versions: IDocVersion[]; current_version_id?: Types.ObjectId;
  verified_by?: Types.ObjectId; verified_at?: Date; remark_internal?: string; requested_due?: string; shared_with_student?: boolean; shared_at?: Date; shared_by?: Types.ObjectId; student_removed_at?: Date; linked_task_id?: Types.ObjectId; linked_change_request_id?: Types.ObjectId; staff_opened_at?: Date; student_seen_at?: Date; reject_count?: number; student_note?: string;
}
export const StudentDocument = mongoose.model<IStudentDocument>('StudentDocument', new Schema<IStudentDocument>({
  student_id: { ...ref('Student'), required: true, index: true }, application_id: ref('Application'), visa_case_id: ref('VisaCase'),
  document_type_id: { ...ref('MasterItem'), required: true }, title: String, status: { type: String, default: 'Pending', index: true }, rejection_reason: String, rejection_text: String,
  expiry_date: String, versions: { type: [new Schema({ version_no: Number, url: String, public_id: String, resource_type: String, stored_name: String, original_name: String,
    mime_type: String, size_bytes: Number, uploaded_by: ref('User'), uploaded_by_type: { type: String, default: 'staff' }, note_for_counsellor: String, uploaded_at: { type: Date, default: Date.now }, version_status: String, version_reason: String })], default: [] },
  current_version_id: Schema.Types.ObjectId, verified_by: ref('User'), verified_at: Date, remark_internal: String, requested_due: String, shared_with_student: Boolean, shared_at: Date, shared_by: ref('User'), student_removed_at: Date, linked_task_id: ref('Task'), linked_change_request_id: Schema.Types.ObjectId, staff_opened_at: Date, student_seen_at: Date, reject_count: { type: Number, default: 0 }, student_note: String, ...STD,
}, { timestamps: true, collection: 'documents' }));

// ---------- fees (9) ----------
export interface IFeeSummary extends Document, Std {
  student_id: Types.ObjectId; application_id?: Types.ObjectId; fee_kind: string; total_amount?: number; currency?: string; deposit_required?: number; deposit_deadline?: string;
  scholarship?: number; package_id?: Types.ObjectId; discount?: number; discount_approved: boolean; next_instalment_due?: string;
}
export const FeeSummary = mongoose.model<IFeeSummary>('FeeSummary', new Schema<IFeeSummary>({
  student_id: { ...ref('Student'), required: true, index: true }, application_id: ref('Application'), fee_kind: { type: String, required: true }, total_amount: Number, currency: String,
  deposit_required: Number, deposit_deadline: String, scholarship: Number, package_id: ref('MasterItem'), discount: Number, discount_approved: { type: Boolean, default: true },
  next_instalment_due: String, ...STD,
}, { timestamps: true }));
export interface IPayment extends Document, Std {
  student_id: Types.ObjectId; application_id?: Types.ObjectId; payment_for: string; amount: number; currency: string; payment_date: string; mode: string;
  paid_by?: string; reference_no?: string; receipt_document_id?: Types.ObjectId; instalment_no?: number; remarks?: string; payment_submission_id?: Types.ObjectId; invoice_id?: Types.ObjectId; receipt_no?: string; is_refund?: boolean; refund_reason?: string; refund_status?: string; approved_by?: Types.ObjectId; approved_at?: Date;
}
export const Payment = mongoose.model<IPayment>('Payment', new Schema<IPayment>({
  student_id: { ...ref('Student'), required: true, index: true }, application_id: ref('Application'), payment_for: { type: String, required: true }, amount: { type: Number, required: true },
  currency: { type: String, required: true }, payment_date: { type: String, required: true }, mode: { type: String, required: true }, paid_by: String, reference_no: String,
  receipt_document_id: ref('StudentDocument'), instalment_no: Number, remarks: String, payment_submission_id: Schema.Types.ObjectId, invoice_id: Schema.Types.ObjectId, receipt_no: String, is_refund: { type: Boolean, default: false }, refund_reason: String, refund_status: String, approved_by: ref('User'), approved_at: Date, ...STD,
}, { timestamps: true }));

// ---------- visa (10) ----------
export interface IVisaCase extends Document, Std {
  visa_code: string; student_id: Types.ObjectId; application_id?: Types.ObjectId; country_id?: Types.ObjectId; visa_type?: string; stage: string; attempt_no: number; is_open: boolean;
  appointment_at?: Date; centre?: string; vfs_reference?: string; submission_date?: string; funds_type?: string; blocked_provider?: string; blocked_account_status?: string;
  funds_amount?: number; funds_currency?: string; insurance_status?: string; accommodation_status?: string; aps_status?: string; aps_reference?: string; aps_date?: string;
  decision?: string; decision_date?: string; valid_from?: string; valid_to?: string; rejection_reason?: string; travel_date?: string; remarks?: string; show_rejection_reason_to_student?: boolean; attempts: Record<string, unknown>[];
}
export const VisaCase = mongoose.model<IVisaCase>('VisaCase', new Schema<IVisaCase>({
  visa_code: { type: String, required: true, unique: true }, student_id: { ...ref('Student'), required: true, index: true }, application_id: { ...ref('Application'), index: true },
  country_id: ref('Country'), visa_type: String, stage: { type: String, default: 'docs_preparation', index: true }, attempt_no: { type: Number, default: 1 }, is_open: { type: Boolean, default: true },
  appointment_at: Date, centre: String, vfs_reference: String, submission_date: String, funds_type: String, blocked_provider: String, blocked_account_status: String,
  funds_amount: Number, funds_currency: String, insurance_status: String, accommodation_status: String, aps_status: String, aps_reference: String, aps_date: String,
  decision: String, decision_date: String, valid_from: String, valid_to: String, rejection_reason: String, travel_date: String, remarks: String, show_rejection_reason_to_student: Boolean,
  attempts: { type: Schema.Types.Mixed, default: () => [] }, ...STD,
}, { timestamps: true, collection: 'visacases' }));
