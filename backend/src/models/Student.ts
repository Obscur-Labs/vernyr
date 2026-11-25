import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * The client's Student (legacy `students` + academic_records, work_experience, english_tests, student_preferences,
 * family_sponsor, student_assignment_history). The child tables are embedded: they are always read and saved with the student.
 */

export const STUDENT_STATUSES = ['Active', 'On hold', 'Dropped', 'Enrolled', 'Archived'] as const;

const sub = <T extends object>(def: T) => new Schema(def, { _id: true, timestamps: true });
const ref = (to: string) => ({ type: Schema.Types.ObjectId, ref: to });

export interface Academic { _id?: Types.ObjectId; level: string; qualification_type?: string; course_name?: string; board_university?: string; institution?: string;
  score?: number; score_type?: string; start_year?: number; pass_year?: number; currently_studying?: boolean; duration?: number; backlogs_total?: number;
  backlogs_active?: number; stream?: string; english_marks?: number; sort: number }
export interface Work { _id?: Types.ObjectId; company: string; designation: string; from_month: string; to_month?: string; till_date?: boolean }
export interface EnglishTest { _id?: Types.ObjectId; test_type: string; overall?: number; listening?: number; reading?: number; writing?: number; speaking?: number;
  test_date?: string; planned_date?: string; reference_no?: string; createdAt?: Date }
export interface Aptitude { _id?: Types.ObjectId; test_type: string; other_name?: string; total?: number | null; parts?: Record<string, number>; test_date?: string | null; planned_date?: string | null; reference_no?: string }
export interface Prefs { country_ids: Types.ObjectId[]; course?: string; level?: string; intake_id?: Types.ObjectId; budget_tuition_eur?: number | null; budget_total_eur?: number; budget_range_label?: string;
  languages: { name: string; level?: string }[]; aps_needed?: boolean | null }
export interface Family { father_name?: string; father_occupation?: string; father_phone?: string; mother_name?: string; mother_occupation?: string; mother_phone?: string;
  spouse_name?: string; spouse_occupation?: string; sponsor_type?: string; sponsor_name?: string; sponsor_relation?: string; sponsor_income?: number;
  loan?: boolean; loan_bank?: string; loan_amount?: number; funds_available?: number; funds_currency?: string; parent_consent?: boolean }
export interface Assignment { _id?: Types.ObjectId; role_type: string; from_user_id?: Types.ObjectId; to_user_id?: Types.ObjectId; reason?: string; changed_by?: Types.ObjectId; createdAt?: Date }

export interface IStudent extends Document {
  student_code: string; lead_id?: Types.ObjectId; user_id?: Types.ObjectId;
  first_name: string; middle_name?: string; last_name?: string; no_surname: boolean; gender?: string; dob?: string;
  country_code: string; phone?: string; phone_normalised?: string; whatsapp?: string; email?: string; email_status: string; nationality: string;
  passport_enc?: string; passport_hash?: string; passport_last4?: string; passport_issue?: string; passport_expiry?: string; passport_place?: string;
  address1?: string; address2?: string; city?: string; state?: string; pin?: string; marital_status: string; spouse_travel: boolean; children: number;
  emergency_name?: string; emergency_phone?: string; status: typeof STUDENT_STATUSES[number]; status_reason?: string;
  /** One counsellor from first contact to visa (Nov 2026): the old application / visa slots always equal it. */
  primary_counsellor_id?: Types.ObjectId;
  email_thread_root_id?: string; email_thread_subject?: string; email_refs: string[]; emails_paused: boolean; emails_paused_reason?: string;
  parent_cc_email?: string; source_id?: Types.ObjectId; sub_agent_id?: Types.ObjectId; photo_key?: string; pinned_notes?: string; portal_status?: string; profile_submitted_at?: Date; completion_percent?: number; show_team_to_student?: boolean; last_portal_login_at?: Date;
  academics: Academic[]; work: Work[]; tests: EnglishTest[]; aptitude: Aptitude[]; info_extra?: Record<string, unknown>; prefs: Prefs; family: Family; assignment_history: Assignment[];
  /** What the student gave on the portal sign-up: age group, guardian, consents, codes. */
  signup?: Record<string, unknown>;
  is_deleted: boolean; created_by?: Types.ObjectId; updated_by?: Types.ObjectId; createdAt: Date; updatedAt: Date;
}

const StudentSchema = new Schema<IStudent>({
  student_code: { type: String, required: true, unique: true },
  lead_id: ref('Lead'), user_id: ref('PortalAccount'),
  first_name: { type: String, required: true, trim: true }, middle_name: String, last_name: String, no_surname: { type: Boolean, default: false },
  gender: String, dob: String, country_code: { type: String, default: '+91' }, phone: String, phone_normalised: { type: String, index: true },
  whatsapp: String, email: { type: String, lowercase: true, trim: true, index: true }, email_status: { type: String, default: 'OK' },
  nationality: { type: String, default: 'Indian' },
  passport_enc: String, passport_hash: { type: String, index: true }, passport_last4: String, passport_issue: String, passport_expiry: String, passport_place: String,
  address1: String, address2: String, city: String, state: String, pin: String, marital_status: { type: String, default: 'Single' },
  spouse_travel: { type: Boolean, default: false }, children: { type: Number, default: 0 }, emergency_name: String, emergency_phone: String,
  status: { type: String, enum: STUDENT_STATUSES, default: 'Active', index: true }, status_reason: String,
  primary_counsellor_id: { ...ref('User'), index: true },
  email_thread_root_id: String, email_thread_subject: String, email_refs: { type: [String], default: [] },
  emails_paused: { type: Boolean, default: false }, emails_paused_reason: String, parent_cc_email: String,
  source_id: ref('MasterItem'), sub_agent_id: ref('MasterItem'), photo_key: String, pinned_notes: String, portal_status: String, profile_submitted_at: Date, completion_percent: Number, show_team_to_student: Boolean, last_portal_login_at: Date,
  academics: { type: [sub({ level: { type: String, required: true }, qualification_type: String, course_name: String, board_university: String, institution: String,
    score: Number, score_type: String, start_year: Number, pass_year: Number, currently_studying: Boolean, duration: Number, backlogs_total: Number,
    backlogs_active: Number, stream: String, english_marks: Number, sort: { type: Number, default: 0 } })], default: [] },
  work: { type: [sub({ company: String, designation: String, from_month: String, to_month: String, till_date: Boolean })], default: [] },
  tests: { type: [sub({ test_type: String, overall: Number, listening: Number, reading: Number, writing: Number, speaking: Number,
    test_date: String, planned_date: String, reference_no: String })], default: [] },
  aptitude: { type: [sub({ test_type: String, other_name: String, total: Number, parts: Schema.Types.Mixed, test_date: String, planned_date: String, reference_no: String })], default: [] },
  info_extra: { type: Schema.Types.Mixed },
  prefs: {
    country_ids: { type: [{ type: Schema.Types.ObjectId, ref: 'Country' }], default: [] }, course: String, level: String, intake_id: ref('Intake'),
    budget_tuition_eur: Number, budget_total_eur: Number, budget_range_label: String, languages: { type: [{ name: String, level: String, _id: false }], default: [] }, aps_needed: { type: Boolean, default: null },
  },
  family: {
    father_name: String, father_occupation: String, father_phone: String, mother_name: String, mother_occupation: String, mother_phone: String,
    spouse_name: String, spouse_occupation: String, sponsor_type: String, sponsor_name: String, sponsor_relation: String, sponsor_income: Number,
    loan: Boolean, loan_bank: String, loan_amount: Number, funds_available: Number, funds_currency: String, parent_consent: Boolean,
  },
  assignment_history: { type: [sub({ role_type: String, from_user_id: ref('User'), to_user_id: ref('User'), reason: String, changed_by: ref('User') })], default: [] },
  signup: { type: Schema.Types.Mixed },
  is_deleted: { type: Boolean, default: false }, created_by: ref('User'), updated_by: ref('User'),
}, { timestamps: true });

export default mongoose.model<IStudent>('Student', StudentSchema);

/** Internal comments on a student (legacy `comments`): never emailed. */
export interface IComment extends Document {
  student_id: Types.ObjectId; body: string; mentions: Types.ObjectId[]; attachments: { name: string; size: number; url: string; public_id?: string; resource_type?: string }[];
  is_pinned: boolean; edited_at?: Date; is_deleted: boolean; created_by: Types.ObjectId; createdAt: Date;
}
const CommentSchema = new Schema<IComment>({
  student_id: { ...ref('Student'), required: true, index: true }, body: { type: String, required: true },
  mentions: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  attachments: { type: [{ name: String, size: Number, url: String, public_id: String, resource_type: String, _id: false }], default: [] },
  is_pinned: { type: Boolean, default: false }, edited_at: Date, is_deleted: { type: Boolean, default: false }, created_by: ref('User'),
}, { timestamps: true });
export const Comment = mongoose.model<IComment>('Comment', CommentSchema);
