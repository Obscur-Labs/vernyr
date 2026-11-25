import mongoose, { Schema, Document } from 'mongoose';

export type LeadStatus = 'new' | 'contacted' | 'counselling' | 'interested' | 'application_started' | 'closed_won' | 'closed_lost';
export type LeadSource = 'website' | 'referral' | 'social_media' | 'walk_in' | 'phone' | 'email' | 'other';

export interface ILead extends Document {
  name: string;
  email: string;
  phone: string;
  source: LeadSource;
  status: LeadStatus;
  assignedTo?: mongoose.Types.ObjectId;
  intendedCountry?: string;
  intendedCourse?: string;
  intakeYear?: number;
  intakeSemester?: string;
  notes?: string;
  budget?: number;
  score?: string;
  convertedStudentId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const LeadSchema = new Schema<ILead>({
  name:             { type: String, required: true, trim: true },
  email:            { type: String, required: true, trim: true, lowercase: true },
  phone:            { type: String, required: true },
  source:           { type: String, enum: ['website','referral','social_media','walk_in','phone','email','other'], default: 'website' },
  status:           { type: String, enum: ['new','contacted','counselling','interested','application_started','closed_won','closed_lost'], default: 'new' },
  assignedTo:       { type: Schema.Types.ObjectId, ref: 'User' },
  intendedCountry:  { type: String },
  intendedCourse:   { type: String },
  intakeYear:       { type: Number },
  intakeSemester:   { type: String },
  notes:               { type: String },
  budget:              { type: Number },
  score:               { type: String },
  convertedStudentId:  { type: Schema.Types.ObjectId, ref: 'Student' },
}, { timestamps: true });

export default mongoose.model<ILead>('Lead', LeadSchema);
