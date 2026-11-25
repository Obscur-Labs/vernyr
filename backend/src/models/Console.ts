import mongoose, { Schema, Document, Types } from 'mongoose';

/** The Admin console tables (legacy/server/admin5/schema.js). */

const ref = (model: string) => ({ type: Schema.Types.ObjectId, ref: model });
const STD = { created_by: ref('User'), is_deleted: { type: Boolean, default: false } };

export interface IBranch extends Document { name: string; address?: string; phone?: string; email?: string; manager_id?: Types.ObjectId; office_hours?: string; status: string; is_deleted: boolean }
export const Branch = mongoose.model<IBranch>('Branch', new Schema<IBranch>({
  name: { type: String, required: true, unique: true }, address: String, phone: String, email: String, manager_id: ref('User'), office_hours: String, status: { type: String, default: 'Active' }, ...STD,
}, { timestamps: true }));

export interface ITeam extends Document { branch_id?: Types.ObjectId; name: string; lead_id?: Types.ObjectId; countries: string[]; members: Types.ObjectId[]; status: string; is_deleted: boolean }
export const Team = mongoose.model<ITeam>('Team', new Schema<ITeam>({
  branch_id: ref('Branch'), name: { type: String, required: true }, lead_id: ref('User'), countries: { type: [String], default: [] }, members: [ref('User')], status: { type: String, default: 'Active' }, ...STD,
}, { timestamps: true }));

/** Assignment engine: rules in priority order; round robin keeps its pointer on the rule. */
export interface IAssignmentRule extends Document {
  name: string; priority: number; applies_to: string[]; conditions: Record<string, unknown>; assign_to_type: 'user' | 'team_rr' | 'team_least' | 'branch_queue';
  assign_to_id?: Types.ObjectId; rr_pointer?: Types.ObjectId; status: string; is_deleted: boolean;
}
export const AssignmentRule = mongoose.model<IAssignmentRule>('AssignmentRule', new Schema<IAssignmentRule>({
  name: { type: String, required: true }, priority: { type: Number, default: 10 }, applies_to: { type: [String], default: [] }, conditions: { type: Schema.Types.Mixed, default: {} },
  assign_to_type: { type: String, required: true }, assign_to_id: Schema.Types.ObjectId, rr_pointer: ref('User'), status: { type: String, default: 'Active' }, ...STD,
}, { timestamps: true }));
export const AssignmentHistory = mongoose.model('AssignmentHistory', new Schema({
  record_type: { type: String, required: true }, record_id: { type: Schema.Types.ObjectId, required: true }, from_user: ref('User'), to_user: ref('User'), by_user: ref('User'),
  by_rule_id: ref('AssignmentRule'), reason: String, at: { type: Date, default: Date.now },
}).index({ record_type: 1, record_id: 1 }));
export interface IUnassigned extends Document { record_type: string; record_id: Types.ObjectId; applies_to?: string; branch_id?: Types.ObjectId; reason?: string; status: string; done_at?: Date; done_by?: Types.ObjectId; createdAt: Date }
export const UnassignedQueue = mongoose.model<IUnassigned>('UnassignedQueue', new Schema<IUnassigned>({
  record_type: { type: String, required: true }, record_id: { type: Schema.Types.ObjectId, required: true }, applies_to: String, branch_id: ref('Branch'), reason: String,
  status: { type: String, default: 'Open' }, done_at: Date, done_by: ref('User'),
}, { timestamps: true }), 'unassignedqueue');

export interface IDuplicateCase extends Document {
  match_type: string; record_kind: 'student' | 'lead'; record_ids: Types.ObjectId[]; key_hash: string; source?: string; status: string; survivor_id?: Types.ObjectId;
  decided_by?: Types.ObjectId; decided_at?: Date; note?: string; createdAt: Date;
}
export const DuplicateCase = mongoose.model<IDuplicateCase>('DuplicateCase', new Schema<IDuplicateCase>({
  match_type: { type: String, required: true }, record_kind: { type: String, required: true }, record_ids: [Schema.Types.ObjectId], key_hash: { type: String, unique: true }, source: String,
  status: { type: String, default: 'Open' }, survivor_id: Schema.Types.ObjectId, decided_by: ref('User'), decided_at: Date, note: String,
}, { timestamps: true }));

export interface IDiscountRequest extends Document {
  fee_summary_id: Types.ObjectId; student_id: Types.ObjectId; amount?: number; reason?: string; requested_by?: Types.ObjectId; status: string; decided_by?: Types.ObjectId; decided_at?: Date; note?: string; createdAt: Date;
}
export const DiscountRequest = mongoose.model<IDiscountRequest>('DiscountRequest', new Schema<IDiscountRequest>({
  fee_summary_id: { ...ref('FeeSummary'), required: true }, student_id: { ...ref('Student'), required: true }, amount: Number, reason: String, requested_by: ref('User'),
  status: { type: String, default: 'Pending' }, decided_by: ref('User'), decided_at: Date, note: String,
}, { timestamps: true }));
export const ApprovalNote = mongoose.model('ApprovalNote', new Schema({ item_key: { type: String, required: true, index: true }, kind: String, text: String, by_user: ref('User'), at: { type: Date, default: Date.now } }));

export interface IAnnouncement extends Document {
  title: string; body: string; audience: Record<string, unknown>; channels: string[]; publish_at?: Date; expire_at?: Date; priority: string; status: string; sent_counts?: Record<string, number>;
  published_at?: Date; created_by?: Types.ObjectId; is_deleted: boolean; createdAt: Date;
}
export const Announcement = mongoose.model<IAnnouncement>('Announcement', new Schema<IAnnouncement>({
  title: { type: String, required: true }, body: { type: String, required: true }, audience: { type: Schema.Types.Mixed, required: true }, channels: { type: [String], default: ['in_app'] },
  publish_at: Date, expire_at: Date, priority: { type: String, default: 'Normal' }, status: { type: String, default: 'Scheduled' }, sent_counts: Schema.Types.Mixed, published_at: Date, ...STD,
}, { timestamps: true }));
export const AnnouncementRead = mongoose.model('AnnouncementRead', new Schema({
  announcement_id: { ...ref('Announcement'), required: true }, reader_type: { type: String, required: true }, reader_id: { type: Schema.Types.ObjectId, required: true }, at: { type: Date, default: Date.now },
}).index({ announcement_id: 1, reader_type: 1, reader_id: 1 }, { unique: true }));

export interface IScheduledReport extends Document { report_type: string; filters?: Record<string, unknown>; frequency: 'daily' | 'weekly' | 'monthly'; recipients: string[]; last_sent_at?: Date; status: string; created_by?: Types.ObjectId; is_deleted: boolean }
export const ScheduledReport = mongoose.model<IScheduledReport>('ScheduledReport', new Schema<IScheduledReport>({
  report_type: { type: String, required: true }, filters: Schema.Types.Mixed, frequency: { type: String, required: true }, recipients: { type: [String], default: [] }, last_sent_at: Date,
  status: { type: String, default: 'Active' }, ...STD,
}, { timestamps: true }));
export const RestoreTest = mongoose.model('RestoreTest', new Schema({ tested_on: String, result: String, note: String, by_user: ref('User') }, { timestamps: true }));
