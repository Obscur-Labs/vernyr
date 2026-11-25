import mongoose, { Schema, Document } from 'mongoose';

/** The client's lookup lists: lead sources, stages, document types... (`master_items`), plus countries and intakes. */

export interface IMasterItem extends Document {
  type: string; code?: string; name: string; active: boolean; sort: number; data?: Record<string, unknown>;
}
const MasterItemSchema = new Schema<IMasterItem>({
  type: { type: String, required: true, index: true },
  code: String,
  name: { type: String, required: true, trim: true },
  active: { type: Boolean, default: true },
  sort: { type: Number, default: 0 },
  data: { type: Schema.Types.Mixed },
}, { timestamps: true });
MasterItemSchema.index({ type: 1, name: 1 }, { unique: true });
export const MasterItem = mongoose.model<IMasterItem>('MasterItem', MasterItemSchema);

export interface ICountry extends Document {
  name: string; code?: string; currency: string; aps_required: boolean; dependant_visa: string; dependant_notes?: string;
  channels: string[]; active: boolean; sort: number;
}
const CountrySchema = new Schema<ICountry>({
  name: { type: String, required: true, unique: true, trim: true },
  code: String,
  currency: { type: String, default: 'EUR' },
  aps_required: { type: Boolean, default: false },
  dependant_visa: { type: String, default: 'Depends' },
  dependant_notes: String,
  channels: { type: [String], default: [] },
  active: { type: Boolean, default: true },
  sort: { type: Number, default: 0 },
}, { timestamps: true });
export const Country = mongoose.model<ICountry>('Country', CountrySchema);

export interface IIntake extends Document { name: string; month: number; year: number; active: boolean }
const IntakeSchema = new Schema<IIntake>({
  name: { type: String, required: true, unique: true },
  month: Number,
  year: Number,
  active: { type: Boolean, default: true },
}, { timestamps: true });
export const Intake = mongoose.model<IIntake>('Intake', IntakeSchema);
