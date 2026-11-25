import mongoose, { Schema, Document } from 'mongoose';

export type AppStatus = 'drafting' | 'submitted' | 'offer_received' | 'conditional_offer' | 'accepted' | 'rejected' | 'withdrawn' | 'deferred';

export interface IApplication extends Document {
  studentId: mongoose.Types.ObjectId;
  university: string;
  country: string;
  course: string;
  level: 'undergraduate' | 'postgraduate' | 'phd' | 'diploma';
  intake: string;
  status: AppStatus;
  appliedDate?: Date;
  offerDate?: Date;
  deadline?: Date;
  tuitionFee?: number;
  currency?: string;
  notes?: string;
  portalUsername?: string;
  portalPassword?: string;
  applicationId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ApplicationSchema = new Schema<IApplication>({
  studentId:       { type: Schema.Types.ObjectId, ref: 'Student', required: true },
  university:      { type: String, required: true },
  country:         { type: String, required: true },
  course:          { type: String, required: true },
  level:           { type: String, enum: ['undergraduate','postgraduate','phd','diploma'], default: 'postgraduate' },
  intake:          { type: String, required: true },
  status:          { type: String, enum: ['drafting','submitted','offer_received','conditional_offer','accepted','rejected','withdrawn','deferred'], default: 'drafting' },
  appliedDate:     Date,
  offerDate:       Date,
  deadline:        Date,
  tuitionFee:      Number,
  currency:        { type: String, default: 'GBP' },
  notes:           String,
  portalUsername:  String,
  portalPassword:  String,
  applicationId:   String,
}, { timestamps: true });

export default mongoose.model<IApplication>('Application', ApplicationSchema);
