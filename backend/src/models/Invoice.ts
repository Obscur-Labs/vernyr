import mongoose, { Schema, Document, Types } from 'mongoose';

/** Student GST invoices and no-GST payment requests (legacy/server/svcinvoice.js). */
export interface IServiceInvoice extends Document {
  invoice_no: string; fy: string; kind: 'service' | 'uni_app_fee'; service_code?: string; application_id?: Types.ObjectId; student_id: Types.ObjectId; student_code: string;
  description: string; sac?: string; entered_amount: number; amount_includes_gst: boolean; taxable: number; gst_rate: number; cgst: number; sgst: number; igst: number;
  round_off: number; total: number; supply_type: 'intra' | 'inter' | 'none'; place_of_supply?: string; pos_code?: string; bill_name?: string; bill_address?: string;
  bill_gstin?: string; invoice_date: string; due_date: string; status: 'Unpaid' | 'Proof submitted' | 'Paid' | 'Cancelled'; payment_id?: Types.ObjectId; receipt_no?: string;
  paid_at?: Date; cancel_reason?: string; is_deleted: boolean; created_by?: Types.ObjectId; updated_by?: Types.ObjectId; createdAt: Date; updatedAt: Date;
}
export const ServiceInvoice = mongoose.model<IServiceInvoice>('ServiceInvoice', new Schema<IServiceInvoice>({
  invoice_no: { type: String, required: true, unique: true }, fy: String, kind: { type: String, default: 'service' }, service_code: String, application_id: { type: Schema.Types.ObjectId, ref: 'Application' },
  student_id: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true }, student_code: String, description: String, sac: String, entered_amount: Number,
  amount_includes_gst: { type: Boolean, default: false }, taxable: Number, gst_rate: Number, cgst: { type: Number, default: 0 }, sgst: { type: Number, default: 0 }, igst: { type: Number, default: 0 },
  round_off: { type: Number, default: 0 }, total: Number, supply_type: String, place_of_supply: String, pos_code: String, bill_name: String, bill_address: String, bill_gstin: String,
  invoice_date: String, due_date: String, status: { type: String, default: 'Unpaid' }, payment_id: { type: Schema.Types.ObjectId, ref: 'Payment' }, receipt_no: String, paid_at: Date,
  cancel_reason: String, is_deleted: { type: Boolean, default: false }, created_by: { type: Schema.Types.ObjectId, ref: 'User' }, updated_by: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true }));
