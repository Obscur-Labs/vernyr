import mongoose, { Schema, Document } from 'mongoose';

/** The client's timeline (legacy `timeline`): one line per thing that happened to a lead or student. */
export interface ITimeline extends Document {
  lead_id?: mongoose.Types.ObjectId; student_id?: mongoose.Types.ObjectId;
  type: string; description: string; data?: unknown; user_id?: mongoose.Types.ObjectId; createdAt: Date;
}
const TimelineSchema = new Schema<ITimeline>({
  lead_id: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
  student_id: { type: Schema.Types.ObjectId, ref: 'Student', index: true },
  type: { type: String, required: true },
  description: { type: String, required: true },
  data: Schema.Types.Mixed,
  user_id: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: { createdAt: true, updatedAt: false } });
export const Timeline = mongoose.model<ITimeline>('Timeline', TimelineSchema);

/** `LE-L-2026-00001`: one counter per kind and year (IST), like the client's nextCode(). */
const CounterSchema = new Schema({ _id: String, value: { type: Number, default: 0 } });
const Counter = mongoose.model<{ _id: string; value: number }>('Counter', CounterSchema);
export async function nextCode(kind: string) {
  const year = new Date().toLocaleString('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' });
  const c = await Counter.findByIdAndUpdate(`${kind}-${year}`, { $inc: { value: 1 } }, { upsert: true, new: true });
  return `LE-${kind}-${year}-${String(c!.value).padStart(5, '0')}`;
}

/** Counsellor ID LE-CS-0001 / staff ID LE-ST-0001 (legacy ids.nextStaffCode): one series each, never reused. */
export async function nextStaffCode(counsellor: boolean) {
  const key = counsellor ? 'CS' : 'ST';
  const c = await Counter.findByIdAndUpdate(`staff-${key}`, { $inc: { value: 1 } }, { upsert: true, new: true });
  return `LE-${key}-${String(c!.value).padStart(4, '0')}`;
}
