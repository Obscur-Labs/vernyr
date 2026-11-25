import mongoose, { Schema, Document, Types } from 'mongoose';

/** The client's Task (legacy `tasks`, Section 11). System tasks carry a `system_key` so they are updated, never duplicated. */
export const TASK_TYPES = ['Internal task', 'Student action', 'Follow-up call', 'Document collection', 'Application submission', 'Visa appointment', 'Other'];
export const TASK_PRIORITIES = ['High', 'Medium', 'Low'];
export const TASK_STATUSES = ['Open', 'In progress', 'Done', 'Cancelled'];

export interface ITask extends Document {
  title: string; description?: string; type: string; student_id?: Types.ObjectId; lead_id?: Types.ObjectId; application_id?: Types.ObjectId; visa_case_id?: Types.ObjectId;
  assigned_to: Types.ObjectId; assigned_by?: Types.ObjectId; due_at: Date; priority: string; status: string; reminder: string; repeat_rule: string;
  completed_at?: Date; completed_by?: Types.ObjectId; is_system: boolean; system_key?: string; reminders_sent: string[];
  is_deleted: boolean; created_by?: Types.ObjectId; updated_by?: Types.ObjectId; createdAt: Date; updatedAt: Date;
}
const ref = (to: string) => ({ type: Schema.Types.ObjectId, ref: to });
const TaskSchema = new Schema<ITask>({
  title: { type: String, required: true }, description: String, type: { type: String, required: true },
  student_id: { ...ref('Student'), index: true }, lead_id: { ...ref('Lead'), index: true }, application_id: ref('Application'), visa_case_id: ref('VisaCase'),
  assigned_to: { ...ref('User'), required: true }, assigned_by: ref('User'), due_at: { type: Date, required: true },
  priority: { type: String, default: 'Medium' }, status: { type: String, default: 'Open' }, reminder: { type: String, default: 'None' }, repeat_rule: { type: String, default: 'None' },
  completed_at: Date, completed_by: ref('User'), is_system: { type: Boolean, default: false }, system_key: { type: String, index: true },
  reminders_sent: { type: [String], default: [] },
  is_deleted: { type: Boolean, default: false }, created_by: ref('User'), updated_by: ref('User'),
}, { timestamps: true });
TaskSchema.index({ assigned_to: 1, status: 1, is_deleted: 1, due_at: 1 });

export default mongoose.model<ITask>('Task', TaskSchema);
