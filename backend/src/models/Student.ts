import mongoose, { Schema, Document } from 'mongoose';

export type StudentStage = 'inquiry' | 'counselling' | 'university_selection' | 'application_submitted' | 'offer_letter' | 'fee_payment' | 'cas_i20' | 'visa_filing' | 'visa_approved' | 'departure';

export interface IStudent extends Document {
  userId?: mongoose.Types.ObjectId;
  assignedCounsellor?: mongoose.Types.ObjectId;
  stage: StudentStage;
  personal: {
    name: string;
    email?: string;
    phone: string;
    dob?: string;
    gender?: string;
    nationality?: string;
    address?: string;
  };
  education: {
    highestLevel?: string;
    board10?: string; percentage10?: number;
    board12?: string; percentage12?: number;
    graduationCollege?: string; graduationScore?: number;
  };
  scores: {
    ielts?: number; toefl?: number; gre?: number; gmat?: number; sat?: number;
  };
  passport: {
    number?: string; expiry?: string; issued?: string;
  };
  preferences: {
    countries: string[];
    universities: string[];
    courses: string[];
    intake?: string;
  };
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const StudentSchema = new Schema<IStudent>({
  userId:            { type: Schema.Types.ObjectId, ref: 'User' },
  assignedCounsellor:{ type: Schema.Types.ObjectId, ref: 'User' },
  stage:             { type: String, enum: ['inquiry','counselling','university_selection','application_submitted','offer_letter','fee_payment','cas_i20','visa_filing','visa_approved','departure'], default: 'inquiry' },
  personal: {
    name:        { type: String, required: true },
    email:       { type: String, lowercase: true },
    phone:       { type: String, required: true },
    dob:         String, gender: String, nationality: String, address: String,
  },
  education: {
    highestLevel: String, board10: String, percentage10: Number,
    board12: String, percentage12: Number,
    graduationCollege: String, graduationScore: Number,
  },
  scores: { ielts: Number, toefl: Number, gre: Number, gmat: Number, sat: Number },
  passport: { number: String, expiry: String, issued: String },
  preferences: {
    countries:    { type: [String], default: [] },
    universities: { type: [String], default: [] },
    courses:      { type: [String], default: [] },
    intake:       String,
  },
  notes: String,
}, { timestamps: true });

export default mongoose.model<IStudent>('Student', StudentSchema);
