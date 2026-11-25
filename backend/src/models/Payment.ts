import mongoose, { Schema, Document } from 'mongoose';

export type PaymentType = 'application_fee' | 'university_fee' | 'visa_fee' | 'service_fee' | 'courier_fee' | 'other';
export type PaymentStatus = 'pending' | 'paid' | 'overdue' | 'refunded' | 'waived';

export interface IPayment extends Document {
  studentId: mongoose.Types.ObjectId;
  type: PaymentType;
  description: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  dueDate?: Date;
  paidDate?: Date;
  receiptUrl?: string;
  invoiceNumber?: string;
  notes?: string;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<IPayment>({
  studentId:     { type: Schema.Types.ObjectId, ref: 'Student', required: true },
  type:          { type: String, enum: ['application_fee','university_fee','visa_fee','service_fee','courier_fee','other'], required: true },
  description:   { type: String, required: true },
  amount:        { type: Number, required: true },
  currency:      { type: String, default: 'INR' },
  status:        { type: String, enum: ['pending','paid','overdue','refunded','waived'], default: 'pending' },
  dueDate:       Date,
  paidDate:      Date,
  receiptUrl:    String,
  invoiceNumber: String,
  notes:         String,
  createdBy:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

export default mongoose.model<IPayment>('Payment', PaymentSchema);
