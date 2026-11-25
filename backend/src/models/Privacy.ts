import mongoose, { Schema, Document, Types } from 'mongoose';

/** Legal documents, privacy rights requests, breaches, processors and privacy notices (legacy/server/portal/consent.js, dpdp.js). */

const ref = (model: string) => ({ type: Schema.Types.ObjectId, ref: model });
const locked = (what: string) => () => { throw new Error(`${what} cannot be changed`); };

/** A published legal document. Never edited: a change is a new version. */
export interface IConsentDocument extends Document {
  doc_type: string; version: string; title: string; body: string; body_hash: string; is_current: boolean; published_at: Date; published_by?: Types.ObjectId; change_note?: string;
}
const ConsentDocumentSchema = new Schema<IConsentDocument>({
  doc_type: { type: String, required: true }, version: { type: String, required: true }, title: String, body: { type: String, required: true }, body_hash: { type: String, required: true },
  is_current: { type: Boolean, default: false }, published_at: { type: Date, default: Date.now }, published_by: ref('User'), change_note: String,
}).index({ doc_type: 1, version: 1 }, { unique: true });
// the text of a published version is fixed; only is_current moves
ConsentDocumentSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function (next) {
  const u = (this.getUpdate() ?? {}) as Record<string, Record<string, unknown> | unknown>;
  const set = { ...(u as Record<string, unknown>), ...((u.$set as Record<string, unknown>) ?? {}) };
  if (['body', 'body_hash', 'version'].some((k) => k in set)) return next(new Error('published documents cannot be edited: publish a new version'));
  next();
});
export const ConsentDocument = mongoose.model<IConsentDocument>('ConsentDocument', ConsentDocumentSchema);

/** The student's signed Student Declaration & Consent (the PDF is made by the portal). Locked once written. */
export interface ISignedDocument extends Document {
  doc_code: string; doc_type: string; student_user_id: Types.ObjectId; student_id?: Types.ObjectId; lead_id?: Types.ObjectId; content_hash: string; typed_name: string;
  file_key?: string; pdf_sha256?: string; signed_at: Date; data?: Record<string, unknown>;
}
const SignedSchema = new Schema<ISignedDocument>({
  doc_code: { type: String, required: true, unique: true }, doc_type: { type: String, required: true }, student_user_id: { ...ref('PortalAccount'), required: true, index: true },
  student_id: ref('Student'), lead_id: ref('Lead'), content_hash: { type: String, required: true }, typed_name: { type: String, required: true }, file_key: String, pdf_sha256: String,
  signed_at: { type: Date, default: Date.now }, data: Schema.Types.Mixed,
});
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne'] as const) SignedSchema.pre(op, locked('signed documents'));
SignedSchema.pre('save', function (next) { if (!this.isNew) return next(new Error('signed documents are locked and cannot be changed')); next(); });
export const SignedDocument = mongoose.model<ISignedDocument>('SignedDocument', SignedSchema);

export interface IPrivacyRequest extends Document {
  request_code: string; student_user_id?: Types.ObjectId; student_id?: Types.ObjectId; lead_id?: Types.ObjectId; type: string; details?: string; jurisdiction?: string;
  status: string; due_at?: Date; response?: string; handled_by?: Types.ObjectId; handled_at?: Date; createdAt: Date; updatedAt: Date;
}
export const PrivacyRequest = mongoose.model<IPrivacyRequest>('PrivacyRequest', new Schema<IPrivacyRequest>({
  request_code: String, student_user_id: ref('PortalAccount'), student_id: ref('Student'), lead_id: ref('Lead'), type: { type: String, required: true }, details: String, jurisdiction: String,
  status: { type: String, default: 'Open' }, due_at: Date, response: String, handled_by: ref('User'), handled_at: Date,
}, { timestamps: true }));

export interface IBreach extends Document {
  detected_at: Date; description: string; data_affected?: string; people_affected?: number | null; risk: string; actions?: string; reported_authority_at?: Date | null;
  notified_people_at?: Date | null; board_initial_at?: Date | null; board_report_at?: Date | null; status: string; created_by?: Types.ObjectId; createdAt: Date; updatedAt: Date;
}
export const Breach = mongoose.model<IBreach>('Breach', new Schema<IBreach>({
  detected_at: { type: Date, default: Date.now }, description: { type: String, required: true }, data_affected: String, people_affected: Number, risk: { type: String, default: 'Medium' },
  actions: String, reported_authority_at: Date, notified_people_at: Date, board_initial_at: Date, board_report_at: Date, status: { type: String, default: 'Open' }, created_by: ref('User'),
}, { timestamps: true }), 'breaches');

/** DPDP s.8(2): the register of Data Processors and their contract (DPA) status. */
export interface IProcessor extends Document {
  name: string; service?: string; data_categories?: string; location?: string; dpa_signed_on?: string; breach_notice_hours: number; sub_processors?: string; contact?: string; notes?: string;
  active: boolean; created_by?: Types.ObjectId;
}
export const Processor = mongoose.model<IProcessor>('Processor', new Schema<IProcessor>({
  name: { type: String, required: true }, service: String, data_categories: String, location: String, dpa_signed_on: String, breach_notice_hours: { type: Number, default: 24 },
  sub_processors: String, contact: String, notes: String, active: { type: Boolean, default: true }, created_by: ref('User'),
}, { timestamps: true }));

/** DPDP s.5(2): the privacy notice each person was sent, per notice version. */
export const PrivacyNotice = mongoose.model('PrivacyNotice', new Schema({
  person_type: { type: String, required: true }, person_id: { type: Schema.Types.ObjectId, required: true }, email: String, notice_version: String, reason: String, sent_at: { type: Date, default: Date.now },
}).index({ person_type: 1, person_id: 1, notice_version: 1 }));
