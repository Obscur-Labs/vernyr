import mongoose, { Schema, Document, Types } from 'mongoose';

/** Meetings with the counsellor (legacy/server/appointments.js). All times are IST. */

export interface Hours { weekday: number; start: string; end: string; online: boolean; in_person: boolean }
export interface IMeetingPrefs extends Document {
  user_id: Types.ObjectId; slot_min: number; notice_hours: number; days_ahead: number; meeting_link?: string; location?: string; accepting: boolean;
  hours: Hours[]; time_off: { date: string; note?: string }[];
}
export const MeetingPrefs = mongoose.model<IMeetingPrefs>('MeetingPrefs', new Schema<IMeetingPrefs>({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true }, slot_min: { type: Number, default: 30 }, notice_hours: { type: Number, default: 12 },
  days_ahead: { type: Number, default: 21 }, meeting_link: String, location: String, accepting: { type: Boolean, default: true },
  hours: [{ _id: false, weekday: Number, start: String, end: String, online: Boolean, in_person: Boolean }],
  time_off: [{ _id: false, date: String, note: String }],
}, { timestamps: true }), 'meetingprefs');

export interface IAppointment extends Document {
  code: string; student_user_id?: Types.ObjectId; student_id?: Types.ObjectId; lead_id?: Types.ObjectId; counsellor_id: Types.ObjectId; mode: 'online' | 'in_person';
  start_at: Date; end_at: Date; reason: string; status: string; decline_reason?: string; meeting_link?: string; location?: string; counsellor_note?: string;
  decided_by?: Types.ObjectId; decided_at?: Date; cancelled_by_type?: string; cancel_reason?: string; cancelled_at?: Date; createdAt: Date; updatedAt: Date;
}
export const Appointment = mongoose.model<IAppointment>('Appointment', new Schema<IAppointment>({
  code: { type: String, unique: true }, student_user_id: { type: Schema.Types.ObjectId, ref: 'PortalAccount', index: true }, student_id: { type: Schema.Types.ObjectId, ref: 'Student' },
  lead_id: { type: Schema.Types.ObjectId, ref: 'Lead' }, counsellor_id: { type: Schema.Types.ObjectId, ref: 'User', required: true }, mode: { type: String, required: true },
  start_at: { type: Date, required: true }, end_at: { type: Date, required: true }, reason: { type: String, required: true }, status: { type: String, default: 'Requested' },
  decline_reason: String, meeting_link: String, location: String, counsellor_note: String, decided_by: { type: Schema.Types.ObjectId, ref: 'User' }, decided_at: Date,
  cancelled_by_type: String, cancel_reason: String, cancelled_at: Date,
}, { timestamps: true }).index({ counsellor_id: 1, start_at: 1 }));
