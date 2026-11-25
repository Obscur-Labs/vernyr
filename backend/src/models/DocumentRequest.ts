import mongoose, { Schema, Document as MDocument } from 'mongoose';
import type { DocType } from './Document';

export type DocRequestStatus = 'pending' | 'fulfilled' | 'cancelled';

export interface IDocumentRequest extends MDocument {
  studentId: mongoose.Types.ObjectId;
  requestedBy: mongoose.Types.ObjectId;
  type: DocType;
  label?: string;
  note?: string;
  status: DocRequestStatus;
  documentId?: mongoose.Types.ObjectId;
  fulfilledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DocumentRequestSchema = new Schema<IDocumentRequest>({
  studentId:   { type: Schema.Types.ObjectId, ref: 'Student', required: true },
  requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type:        { type: String, enum: ['passport','marksheet_10','marksheet_12','ielts','toefl','gre','gmat','sop','lor','bank_statement','photo','offer_letter','visa_copy','other'], required: true },
  label:       String,
  note:        String,
  status:      { type: String, enum: ['pending','fulfilled','cancelled'], default: 'pending' },
  documentId:  { type: Schema.Types.ObjectId, ref: 'Document' },
  fulfilledAt: Date,
}, { timestamps: true });

DocumentRequestSchema.index({ studentId: 1, status: 1 });

export default mongoose.model<IDocumentRequest>('DocumentRequest', DocumentRequestSchema);
