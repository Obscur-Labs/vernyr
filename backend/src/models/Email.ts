import mongoose, { Schema, Document, Types } from 'mongoose';

/** The client's email engine tables: email_templates (+ versions) and email_logs (legacy/server/db.js). */

export interface IEmailTemplate extends Document {
  trigger_code: string; channel: string; name: string; update_title: string; body_html: string; body_text?: string; is_active: boolean; version: number;
  audience?: string; is_locked?: boolean; always_to_student?: boolean; language?: string; updated_by?: Types.ObjectId; createdAt: Date; updatedAt: Date;
}
export const EmailTemplate = mongoose.model<IEmailTemplate>('EmailTemplate', new Schema<IEmailTemplate>({
  trigger_code: { type: String, required: true }, channel: { type: String, default: 'email' }, name: String, update_title: { type: String, required: true },
  body_html: { type: String, required: true }, body_text: String, is_active: { type: Boolean, default: true }, version: { type: Number, default: 1 }, audience: String, is_locked: { type: Boolean, default: false }, always_to_student: { type: Boolean, default: false }, language: { type: String, default: 'en' },
  updated_by: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true }).index({ trigger_code: 1, channel: 1 }, { unique: true }));

export interface IEmailTemplateVersion extends Document {
  template_id: Types.ObjectId; version: number; update_title: string; body_html: string; is_active: boolean; saved_by?: Types.ObjectId; saved_at: Date;
}
export const EmailTemplateVersion = mongoose.model<IEmailTemplateVersion>('EmailTemplateVersion', new Schema<IEmailTemplateVersion>({
  template_id: { type: Schema.Types.ObjectId, ref: 'EmailTemplate', index: true }, version: Number, update_title: String, body_html: String, is_active: Boolean,
  saved_by: { type: Schema.Types.ObjectId, ref: 'User' }, saved_at: { type: Date, default: Date.now },
}));

export interface EmailPart { code: string; ctx: Record<string, unknown>; message: string | null; at: Date }
export interface IEmailLog extends Document {
  student_id?: Types.ObjectId; lead_id?: Types.ObjectId; trigger_code: string; channel: string; email_type?: string; recipient_type?: string; update_title?: string; parts: EmailPart[];
  to_addr?: string; cc_addr?: string; reply_to?: string; from_addr?: string; subject?: string; body_html?: string; body_text?: string; message_id?: string;
  in_reply_to?: string; references_hdr?: string; triggered_by?: Types.ObjectId; status: string; attempts: number; error?: string;
  queued_at: Date; scheduled_at?: Date; next_attempt_at?: Date; sent_at?: Date; delivered_at?: Date; resend_of?: Types.ObjectId;
}
export const EmailLog = mongoose.model<IEmailLog>('EmailLog', new Schema<IEmailLog>({
  student_id: { type: Schema.Types.ObjectId, ref: 'Student', index: true }, lead_id: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
  trigger_code: String, channel: { type: String, default: 'email' }, email_type: String, recipient_type: String, update_title: String, parts: { type: Schema.Types.Mixed, default: () => [] },
  to_addr: String, cc_addr: String, reply_to: String, from_addr: String, subject: String, body_html: String, body_text: String, message_id: { type: String, index: true },
  in_reply_to: String, references_hdr: String, triggered_by: { type: Schema.Types.ObjectId, ref: 'User' }, status: { type: String, default: 'Queued' },
  attempts: { type: Number, default: 0 }, error: String, queued_at: { type: Date, default: Date.now }, scheduled_at: Date, next_attempt_at: Date, sent_at: Date,
  delivered_at: Date, resend_of: { type: Schema.Types.ObjectId, ref: 'EmailLog' },
}).index({ status: 1, next_attempt_at: 1 }), 'emaillogs');
