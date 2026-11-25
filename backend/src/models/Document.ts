import mongoose, { Schema, Document as MDocument } from 'mongoose';

export type DocType = 'passport' | 'marksheet_10' | 'marksheet_12' | 'ielts' | 'toefl' | 'gre' | 'gmat' | 'sop' | 'lor' | 'bank_statement' | 'photo' | 'offer_letter' | 'visa_copy' | 'other';
export type DocStatus = 'uploaded' | 'under_review' | 'approved' | 'rejected';

export interface IDocVersion {
  /** Absolute Cloudinary URL (legacy records may hold a relative `/uploads/…` path) */
  fileUrl: string;
  fileName: string;
  /** Cloudinary public id — absent on records created before the Cloudinary migration */
  publicId?: string;
  resourceType?: 'image' | 'video' | 'raw';
  uploadedAt: Date;
  uploadedBy: mongoose.Types.ObjectId;
}

export interface IDocument extends MDocument {
  studentId: mongoose.Types.ObjectId;
  type: DocType;
  label?: string;
  status: DocStatus;
  currentVersion: IDocVersion;
  versions: IDocVersion[];
  reviewedBy?: mongoose.Types.ObjectId;
  rejectionReason?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DocVersionSchema = new Schema<IDocVersion>({
  fileUrl:      { type: String, required: true },
  fileName:     { type: String, required: true },
  publicId:     { type: String },
  resourceType: { type: String, enum: ['image', 'video', 'raw'] },
  uploadedAt:   { type: Date, default: Date.now },
  uploadedBy:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { _id: false });

const DocumentSchema = new Schema<IDocument>({
  studentId:       { type: Schema.Types.ObjectId, ref: 'Student', required: true },
  type:            { type: String, enum: ['passport','marksheet_10','marksheet_12','ielts','toefl','gre','gmat','sop','lor','bank_statement','photo','offer_letter','visa_copy','other'], required: true },
  label:           String,
  status:          { type: String, enum: ['uploaded','under_review','approved','rejected'], default: 'uploaded' },
  currentVersion:  { type: DocVersionSchema, required: true },
  versions:        { type: [DocVersionSchema], default: [] },
  reviewedBy:      { type: Schema.Types.ObjectId, ref: 'User' },
  rejectionReason: String,
  notes:           String,
}, { timestamps: true });

export default mongoose.model<IDocument>('Document', DocumentSchema);
