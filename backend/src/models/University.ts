import mongoose, { Schema, Document, Types } from 'mongoose';

/** A university (legacy `universities`): one country, a University ID (DE-001), a logo, and the course settings every course of it follows. */
export interface UniDefaults {
  intakes: { intake_id: string; open_date?: string | null; deadline?: string | null; deadline_note?: string | null }[];
  english: { test_type: string; min_overall?: number | null; min_band?: number | null; moi_accepted?: boolean; min_12th_english_percent?: number | null }[];
  application_fee?: number | null; application_fee_currency?: string; currency?: string | null; language?: string | null;
  academic: { required_level?: string | null; min_percent?: number | null; max_backlogs?: number | null; min_work_months?: number | null; entrance_test?: string | null };
}
export interface IUniversity extends Document {
  name: string; short_name?: string; uni_code?: string; country_id?: Types.ObjectId; city?: string; website?: string; type?: string; active: boolean; approved: boolean;
  logo_url?: string; logo_public_id?: string; logo_updated_at?: Date; logo_source_note?: string; logo_approved_by?: Types.ObjectId; logo_approved_at?: Date; course_defaults?: UniDefaults; is_deleted: boolean; created_by?: Types.ObjectId; createdAt: Date; updatedAt: Date;
}
const UniversitySchema = new Schema<IUniversity>({
  name: { type: String, required: true, trim: true }, short_name: String, uni_code: { type: String, unique: true, sparse: true }, country_id: { type: Schema.Types.ObjectId, ref: 'Country', index: true },
  city: String, website: String, type: String, active: { type: Boolean, default: true }, approved: { type: Boolean, default: true },
  logo_url: String, logo_public_id: String, logo_updated_at: Date, logo_source_note: String, logo_approved_by: { type: Schema.Types.ObjectId, ref: 'User' }, logo_approved_at: Date, course_defaults: Schema.Types.Mixed, is_deleted: { type: Boolean, default: false },
  created_by: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export default mongoose.model<IUniversity>('University', UniversitySchema);
