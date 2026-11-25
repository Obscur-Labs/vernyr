import mongoose, { Schema, Document, Types } from 'mongoose';

/** The client's student-portal tables (legacy/server/portal/schema.js), in the CRM database. */

const ref = (model: string) => ({ type: Schema.Types.ObjectId, ref: model });
// who did it: staff User or the student's PortalAccount
const STD = { created_by: Schema.Types.ObjectId, created_by_type: { type: String, default: 'staff' }, updated_by: Schema.Types.ObjectId, updated_by_type: String, is_deleted: { type: Boolean, default: false } };
interface Std { created_by?: Types.ObjectId; created_by_type: string; updated_by?: Types.ObjectId; updated_by_type?: string; is_deleted: boolean; createdAt: Date; updatedAt: Date }
const model = <T>(name: string, def: Record<string, unknown>, collection?: string, opts: { std?: boolean } = { std: true }) =>
  mongoose.model<T>(name, new Schema((opts.std ? { ...def, ...STD } : def) as never, { timestamps: true }), collection);

// ---------- Apply Now requests (14.2) ----------
export interface IApplicationRequest extends Document, Std {
  request_code: string; student_id?: Types.ObjectId; lead_id?: Types.ObjectId; student_user_id?: Types.ObjectId; course_id?: Types.ObjectId; intake_id?: Types.ObjectId;
  university_id?: Types.ObjectId; country_id?: Types.ObjectId; level?: string; course_name?: string; deadline?: string; status: string; source_screen?: string;
  message_to_counsellor?: string; missing_documents?: string[]; eligibility_snapshot?: Record<string, unknown>; decline_reason_code?: string; decline_reason_text?: string;
  internal_note?: string; application_id?: Types.ObjectId; reviewed_by?: Types.ObjectId; reviewed_at?: Date; cancelled_at?: Date; cancel_reason?: string; idempotency_key?: string;
}
export const REQUEST_OPEN = ['Requested by student', 'In review', 'Info needed'];
export const ApplicationRequest = model<IApplicationRequest>('ApplicationRequest', {
  request_code: { type: String, unique: true }, student_id: { ...ref('Student'), index: true }, lead_id: { ...ref('Lead'), index: true }, student_user_id: ref('PortalAccount'),
  course_id: ref('Course'), intake_id: ref('Intake'), university_id: ref('University'), country_id: ref('Country'), level: String, course_name: String, deadline: String,
  status: { type: String, default: 'Requested by student', index: true }, source_screen: String, message_to_counsellor: String, missing_documents: [String],
  eligibility_snapshot: Schema.Types.Mixed, decline_reason_code: String, decline_reason_text: String, internal_note: String, application_id: ref('Application'),
  reviewed_by: ref('User'), reviewed_at: Date, cancelled_at: Date, cancel_reason: String, idempotency_key: { type: String, unique: true, sparse: true },
});

// ---------- profile change requests (verified fields edited by the student) ----------
export interface IProfileChangeRequest extends Document, Std {
  student_id: Types.ObjectId; student_user_id?: Types.ObjectId; entity?: string; entity_id?: string; field_key: string; field_label?: string; old_value?: unknown; new_value?: unknown;
  reason?: string; document_id?: Types.ObjectId; status: string; reviewed_by?: Types.ObjectId; reviewed_at?: Date; reject_reason?: string;
}
export const ProfileChangeRequest = model<IProfileChangeRequest>('ProfileChangeRequest', {
  student_id: { ...ref('Student'), required: true, index: true }, student_user_id: ref('PortalAccount'), entity: String, entity_id: String, field_key: { type: String, required: true },
  field_label: String, old_value: Schema.Types.Mixed, new_value: Schema.Types.Mixed, reason: String, document_id: ref('StudentDocument'), status: { type: String, default: 'Pending' },
  reviewed_by: ref('User'), reviewed_at: Date, reject_reason: String,
});

// ---------- consent: append-only ----------
export interface IConsentRecord extends Document {
  student_user_id?: Types.ObjectId; lead_id?: Types.ObjectId; consent_type: string; document_version?: string; value: string; ip?: string; user_agent?: string; createdAt: Date;
}
const ConsentSchema = new Schema<IConsentRecord>({
  student_user_id: { ...ref('PortalAccount'), index: true }, lead_id: ref('Lead'), consent_type: { type: String, required: true }, document_version: String,
  value: { type: String, required: true }, ip: String, user_agent: String,
}, { timestamps: { createdAt: true, updatedAt: false } });
const appendOnly = () => { throw new Error('consent records are append-only'); };
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne'] as const) ConsentSchema.pre(op, appendOnly);
ConsentSchema.pre('save', function (next) { if (!this.isNew) return next(new Error('consent records are append-only')); next(); });
export const ConsentRecord = mongoose.model<IConsentRecord>('ConsentRecord', ConsentSchema);

// ---------- saved courses ----------
export interface ISavedCourse extends Document { student_user_id: Types.ObjectId; student_id?: Types.ObjectId; course_id: Types.ObjectId; saved_at: Date; removed_at?: Date }
export const SavedCourse = model<ISavedCourse>('SavedCourse', {
  student_user_id: { ...ref('PortalAccount'), required: true, index: true }, student_id: ref('Student'), course_id: { ...ref('Course'), required: true },
  saved_at: { type: Date, default: Date.now }, removed_at: Date,
}, undefined, { std: false });

// ---------- offer conditions and fee instructions (on an application) ----------
export interface IOfferCondition extends Document, Std { application_id: Types.ObjectId; text: string; status: string; proof_document_id?: Types.ObjectId }
export const OfferCondition = model<IOfferCondition>('OfferCondition', {
  application_id: { ...ref('Application'), required: true, index: true }, text: { type: String, required: true }, status: { type: String, default: 'Open' }, proof_document_id: ref('StudentDocument'),
});
export interface IFeeInstruction extends Document, Std {
  application_id: Types.ObjectId; amount?: number; currency?: string; due_date?: string; pay_to?: string; instructions_html?: string; document_id?: Types.ObjectId;
  is_published: boolean; published_at?: Date; published_by?: Types.ObjectId;
}
export const FeeInstruction = model<IFeeInstruction>('FeeInstruction', {
  application_id: { ...ref('Application'), required: true, index: true }, amount: Number, currency: String, due_date: String, pay_to: String, instructions_html: String,
  document_id: ref('StudentDocument'), is_published: { type: Boolean, default: false }, published_at: Date, published_by: ref('User'),
});

// ---------- payments the student says they made (staff records or rejects) ----------
export interface IPaymentSubmission extends Document, Std {
  student_id: Types.ObjectId; application_id?: Types.ObjectId; payment_for?: string; amount?: number; currency?: string; payment_date?: string; mode?: string; reference_no?: string;
  document_id?: Types.ObjectId; note?: string; status: string; payment_id?: Types.ObjectId; reviewed_by?: Types.ObjectId; reviewed_at?: Date; reject_reason?: string;
}
export const PaymentSubmission = model<IPaymentSubmission>('PaymentSubmission', {
  student_id: { ...ref('Student'), required: true, index: true }, application_id: ref('Application'), payment_for: String, amount: Number, currency: String, payment_date: String,
  mode: String, reference_no: String, document_id: ref('StudentDocument'), note: String, status: { type: String, default: 'Submitted' }, payment_id: ref('Payment'),
  reviewed_by: ref('User'), reviewed_at: Date, reject_reason: String,
});

// ---------- portal chat: one thread per student (or lead before conversion) ----------
export interface ChatAttachment { _id: Types.ObjectId; file_key: string; public_id?: string; resource_type?: string; original_name?: string; mime_type?: string; size_bytes?: number; duration_seconds?: number; saved_document_id?: Types.ObjectId }
export interface IChatMessage extends Document {
  student_id?: Types.ObjectId; lead_id?: Types.ObjectId; sender_type: 'staff' | 'student' | 'system'; sender_user_id?: Types.ObjectId; body?: string; context_type?: string; context_id?: string;
  channel: string; sent_at: Date; delivered_at?: Date; read_at?: Date; edited_at?: Date; deleted_at?: Date; original_body?: string; reported_at?: Date; attachments: ChatAttachment[];
}
export const ChatMessage = mongoose.model<IChatMessage>('ChatMessage', new Schema<IChatMessage>({
  student_id: ref('Student'), lead_id: ref('Lead'), sender_type: { type: String, required: true }, sender_user_id: Schema.Types.ObjectId, body: String, context_type: String, context_id: String,
  channel: { type: String, default: 'portal' }, sent_at: { type: Date, default: Date.now }, delivered_at: Date, read_at: Date, edited_at: Date, deleted_at: Date, original_body: String, reported_at: Date,
  attachments: [new Schema({ file_key: { type: String, required: true }, public_id: String, resource_type: String, original_name: String, mime_type: String, size_bytes: Number, duration_seconds: Number, saved_document_id: ref('StudentDocument') })],
}).index({ student_id: 1, sent_at: 1 }).index({ lead_id: 1, sent_at: 1 }), 'portalchatmessages');

// ---------- notification preferences, deletion and export requests, referrals, profile drafts ----------
export interface INotificationPreference extends Document { student_user_id: Types.ObjectId; group_key: string; channel: string; enabled: boolean }
export const NotificationPreference = mongoose.model<INotificationPreference>('NotificationPreference', new Schema<INotificationPreference>({
  student_user_id: { ...ref('PortalAccount'), required: true }, group_key: { type: String, required: true }, channel: { type: String, required: true }, enabled: Boolean,
}, { timestamps: true }).index({ student_user_id: 1, group_key: 1, channel: 1 }, { unique: true }));

export interface IAccountDeletionRequest extends Document, Std {
  student_user_id: Types.ObjectId; reason?: string; status: string; reviewed_by?: Types.ObjectId; reviewed_at?: Date; admin_reason?: string; completed_at?: Date;
}
export const AccountDeletionRequest = model<IAccountDeletionRequest>('AccountDeletionRequest', {
  student_user_id: { ...ref('PortalAccount'), required: true, index: true }, reason: String, status: { type: String, default: 'Requested' }, reviewed_by: ref('User'), reviewed_at: Date,
  admin_reason: String, completed_at: Date,
});

export interface IDataExportRequest extends Document { student_user_id: Types.ObjectId; status: string; file_key?: string; ready_at?: Date; expires_at?: Date; downloaded_at?: Date; createdAt: Date }
export const DataExportRequest = model<IDataExportRequest>('DataExportRequest', {
  student_user_id: { ...ref('PortalAccount'), required: true, index: true }, status: { type: String, default: 'Queued' }, file_key: String, ready_at: Date, expires_at: Date, downloaded_at: Date,
}, undefined, { std: false });

export interface IReferral extends Document, Std {
  referrer_student_user_id?: Types.ObjectId; referrer_student_id?: Types.ObjectId; friend_name?: string; friend_phone?: string; friend_email?: string; interest?: string;
  lead_id?: Types.ObjectId; status: string; reward_status?: string; consent_record_id?: Types.ObjectId;
}
export const Referral = model<IReferral>('Referral', {
  referrer_student_user_id: ref('PortalAccount'), referrer_student_id: ref('Student'), friend_name: String, friend_phone: String, friend_email: String, interest: String,
  lead_id: ref('Lead'), status: { type: String, default: 'Received' }, reward_status: String, consent_record_id: ref('ConsentRecord'),
});

export interface IProfileDraft extends Document { student_user_id: Types.ObjectId; section: string; data: Record<string, unknown>; copied_to_student_at?: Date; updatedAt: Date }
export const ProfileDraft = mongoose.model<IProfileDraft>('ProfileDraft', new Schema<IProfileDraft>({
  student_user_id: { ...ref('PortalAccount'), required: true }, section: { type: String, required: true }, data: Schema.Types.Mixed, copied_to_student_at: Date,
}, { timestamps: true }).index({ student_user_id: 1, section: 1 }, { unique: true }));
