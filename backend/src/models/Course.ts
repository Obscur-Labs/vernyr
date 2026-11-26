import mongoose, { Schema, Document, Types } from 'mongoose';

/** A course (legacy `courses` + course_intakes, course_english_requirements, course_academic_requirements). Shown to students only when Published.
 *  own_* = the course keeps its own value instead of following the university settings. */
export const COURSE_LEVELS = ['Bachelor', 'Master', 'MBA', 'PhD', 'Diploma', 'Foundation', 'Language course'];
export interface CourseIntake { _id?: Types.ObjectId; intake_id?: Types.ObjectId | null; month?: number | null; year?: number | null; every_year?: boolean; open_date?: string | null; deadline?: string | null; deadline_note?: string | null; status?: string | null; closed_reason?: string | null }
export interface CourseEnglish { test_type: string; min_overall?: number | null; min_band?: number | null; moi_accepted?: boolean; min_12th_english_percent?: number | null }
export interface CourseAcademic { required_level?: string | null; min_percent?: number | null; max_backlogs?: number | null; accepted_fields?: string[]; min_work_months?: number | null; entrance_test?: string | null; note?: string | null }
export interface ICourse extends Document {
  university_id: Types.ObjectId; course_uid?: string; course_code?: string; name: string; level?: string; field_of_study_id?: Types.ObjectId; field?: string; city?: string;
  duration?: string; duration_months?: number; language?: string; tuition_fee?: number | null; tuition_fee_non_eu?: number | null; currency: string; fee_note?: string;
  application_fee?: number | null; application_fee_currency?: string; course_link?: string; description?: string; scholarship: boolean; scholarship_text?: string;
  status: 'Draft' | 'Published' | 'Hidden' | 'Archived'; last_verified_on?: string; internal_note?: string; external_id?: string; min_english?: number | null;
  own_intakes: boolean; own_english: boolean; own_app_fee: boolean; own_academic: boolean; not_in_last_import: boolean; link_domain_warning?: boolean; link_warning_reason?: string | null; active: boolean; approved: boolean; is_deleted: boolean;
  intakes: CourseIntake[]; english: CourseEnglish[];
  campus_id?: Types.ObjectId; uni_status?: string; seats_for_le?: number | null; note_for_le?: string; university_course_code?: string; change_source?: string; academic?: CourseAcademic | null; created_by?: Types.ObjectId; updated_by?: Types.ObjectId; createdAt: Date; updatedAt: Date;
}
const CourseSchema = new Schema<ICourse>({
  university_id: { type: Schema.Types.ObjectId, ref: 'University', required: true, index: true }, course_uid: { type: String, unique: true, sparse: true }, course_code: String,
  name: { type: String, required: true, trim: true }, level: { type: String, index: true }, field_of_study_id: { type: Schema.Types.ObjectId, ref: 'MasterItem' }, field: String, city: String,
  duration: String, duration_months: Number, language: String, tuition_fee: Number, tuition_fee_non_eu: Number, currency: { type: String, default: 'EUR' }, fee_note: String,
  application_fee: Number, application_fee_currency: String, course_link: String, description: String, scholarship: { type: Boolean, default: false }, scholarship_text: String,
  status: { type: String, default: 'Draft', index: true }, last_verified_on: String, internal_note: String, external_id: String, min_english: Number,
  own_intakes: { type: Boolean, default: false }, own_english: { type: Boolean, default: false }, own_app_fee: { type: Boolean, default: false }, own_academic: { type: Boolean, default: false },
  not_in_last_import: { type: Boolean, default: false }, link_domain_warning: { type: Boolean, default: false }, link_warning_reason: String, active: { type: Boolean, default: true }, approved: { type: Boolean, default: true }, is_deleted: { type: Boolean, default: false },
  intakes: [{ intake_id: { type: Schema.Types.ObjectId, ref: 'Intake' }, month: Number, year: Number, every_year: Boolean, open_date: String, deadline: String, deadline_note: String, status: String, closed_reason: String }],
  // partner portal: what the university itself says about the course
  campus_id: { type: Schema.Types.ObjectId, ref: "Campus" }, uni_status: String, seats_for_le: Number, note_for_le: String, university_course_code: String, change_source: String,
  english: [{ _id: false, test_type: String, min_overall: Number, min_band: Number, moi_accepted: Boolean, min_12th_english_percent: Number }],
  academic: { type: new Schema({ required_level: String, min_percent: Number, max_backlogs: Number, accepted_fields: [String], min_work_months: Number, entrance_test: String, note: String }, { _id: false }), default: null },
  created_by: { type: Schema.Types.ObjectId, ref: 'User' }, updated_by: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
CourseSchema.index({ university_id: 1, name: 1, level: 1 });

export default mongoose.model<ICourse>('Course', CourseSchema);

/** One changed field of a course, per save or import. */
export const CourseChange = mongoose.model('CourseChange', new Schema({
  course_id: { type: Schema.Types.ObjectId, ref: 'Course', index: true }, batch_id: Schema.Types.ObjectId, field: String, old_value: String, new_value: String,
  changed_by: { type: Schema.Types.ObjectId, ref: 'User' }, changed_at: { type: Date, default: Date.now },
}));
/** One Excel upload of one university. */
export const CourseImportBatch = mongoose.model('CourseImportBatch', new Schema({
  file_name: String, run_by: { type: Schema.Types.ObjectId, ref: 'User' }, run_at: { type: Date, default: Date.now }, counts: Schema.Types.Mixed, errors: Schema.Types.Mixed, mode: String,
}, { suppressReservedKeysWarning: true }));
