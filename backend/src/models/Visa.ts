import mongoose, { Schema, Document } from 'mongoose';

export type VisaStage = 'not_started' | 'documents_complete' | 'visa_filed' | 'biometrics' | 'interview' | 'decision' | 'approved' | 'rejected' | 'reapplied';

export interface IVisa extends Document {
  studentId: mongoose.Types.ObjectId;
  country: string;
  visaType: string;
  stage: VisaStage;
  filedDate?: Date;
  biometricsDate?: Date;
  interviewDate?: Date;
  decisionDate?: Date;
  approvalDate?: Date;
  expiryDate?: Date;
  refusalReason?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const VisaSchema = new Schema<IVisa>({
  studentId:      { type: Schema.Types.ObjectId, ref: 'Student', required: true },
  country:        { type: String, required: true },
  visaType:       { type: String, default: 'Student Visa' },
  stage:          { type: String, enum: ['not_started','documents_complete','visa_filed','biometrics','interview','decision','approved','rejected','reapplied'], default: 'not_started' },
  filedDate:      Date,
  biometricsDate: Date,
  interviewDate:  Date,
  decisionDate:   Date,
  approvalDate:   Date,
  expiryDate:     Date,
  refusalReason:  String,
  notes:          String,
}, { timestamps: true });

export default mongoose.model<IVisa>('Visa', VisaSchema);
