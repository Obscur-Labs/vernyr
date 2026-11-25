import mongoose, { Schema, Document } from 'mongoose';

/** The client's Lead (legacy `leads` table, Section 4): an inquiry that is not yet a registered student. */

export const LEAD_STATUSES = ['New', 'Contacted', 'Follow-up', 'Interested', 'Not interested', 'Converted'] as const;
export type LeadStatus = typeof LEAD_STATUSES[number];
/** Allowed status moves (legacy util.js LEAD_FLOW). Converted only via Convert to Student. */
export const LEAD_FLOW: Record<LeadStatus, LeadStatus[]> = {
  New: ['Contacted', 'Not interested'],
  Contacted: ['Follow-up', 'Interested', 'Not interested'],
  'Follow-up': ['Contacted', 'Follow-up', 'Interested', 'Not interested'],
  Interested: ['Converted', 'Follow-up', 'Not interested'],
  'Not interested': ['Follow-up', 'Contacted'],
  Converted: [],
};
export const LEVELS = ['Bachelor', 'Master', 'MBA', 'PhD', 'Diploma', 'Foundation', 'Language course'];

export interface ILead extends Document {
  lead_code: string; first_name: string; last_name?: string; country_code: string; phone: string; phone_normalised?: string;
  is_whatsapp: boolean; alt_phone?: string; email?: string; city?: string; state?: string;
  source_id: mongoose.Types.ObjectId; sub_agent_id?: mongoose.Types.ObjectId; referred_by?: string; source_details?: string;
  interested_countries: mongoose.Types.ObjectId[]; course_interest?: string; level?: string; intake_id?: mongoose.Types.ObjectId; highest_qualification?: string;
  status: LeadStatus; not_interested_reason?: string; next_followup_at?: Date; notes_internal?: string;
  assigned_user_id?: mongoose.Types.ObjectId; created_by?: mongoose.Types.ObjectId; updated_by?: mongoose.Types.ObjectId;
  converted_student_id?: mongoose.Types.ObjectId; merged_into?: mongoose.Types.ObjectId; is_deleted: boolean;
  createdAt: Date; updatedAt: Date;
}

const ref = (to: string) => ({ type: Schema.Types.ObjectId, ref: to });
const LeadSchema = new Schema<ILead>({
  lead_code: { type: String, required: true, unique: true },
  first_name: { type: String, required: true, trim: true },
  last_name: { type: String, trim: true },
  country_code: { type: String, default: '+91' },
  phone: { type: String, required: true },
  phone_normalised: { type: String, index: true },
  is_whatsapp: { type: Boolean, default: true },
  alt_phone: String, email: { type: String, lowercase: true, trim: true, index: true }, city: String, state: String,
  source_id: ref('MasterItem'), sub_agent_id: ref('MasterItem'), referred_by: String, source_details: String,
  interested_countries: { type: [{ type: Schema.Types.ObjectId, ref: 'Country' }], default: [] },
  course_interest: String, level: String, intake_id: ref('Intake'), highest_qualification: String,
  status: { type: String, enum: LEAD_STATUSES, default: 'New', index: true },
  not_interested_reason: String, next_followup_at: { type: Date, index: true }, notes_internal: String,
  assigned_user_id: { ...ref('User'), index: true }, created_by: ref('User'), updated_by: ref('User'),
  converted_student_id: ref('Student'), merged_into: ref('Lead'),
  is_deleted: { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.model<ILead>('Lead', LeadSchema);

/** Call / notes log on a lead (legacy `lead_activities`). */
export interface ILeadActivity extends Document {
  lead_id: mongoose.Types.ObjectId; type: string; outcome?: string; notes: string; next_followup_at?: Date;
  logged_by: mongoose.Types.ObjectId; is_deleted: boolean; createdAt: Date;
}
const LeadActivitySchema = new Schema<ILeadActivity>({
  lead_id: { ...ref('Lead'), required: true, index: true },
  type: { type: String, required: true }, outcome: String, notes: { type: String, required: true }, next_followup_at: Date,
  logged_by: ref('User'), is_deleted: { type: Boolean, default: false },
}, { timestamps: true });
export const LeadActivity = mongoose.model<ILeadActivity>('LeadActivity', LeadActivitySchema);
