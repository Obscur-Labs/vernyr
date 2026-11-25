import mongoose, { Schema, Document } from 'mongoose';

/** A course catalogue is country → university → course. This is the middle. */
export interface IUniversity extends Document {
  name: string;
  slug: string;
  country: string;
  countryCode?: string;
  city?: string;
  website?: string;
  type: 'public' | 'private' | 'unknown';
  logoUrl?: string;
  notes?: string;
  /** Where the row came from — a workbook name, or 'manual'. */
  source?: string;
  isActive: boolean;
  courseCount: number;
  createdAt: string;
  updatedAt: string;
}

const UniversitySchema = new Schema<IUniversity>({
  name:      { type: String, required: true, trim: true },
  slug:      { type: String, required: true, index: true },
  country:   { type: String, required: true, trim: true, index: true },
  countryCode: { type: String, uppercase: true, trim: true },
  city:      { type: String, trim: true },
  website:   { type: String, trim: true },
  type:      { type: String, enum: ['public', 'private', 'unknown'], default: 'unknown' },
  logoUrl:   String,
  notes:     String,
  source:    String,
  isActive:    { type: Boolean, default: true },
  courseCount: { type: Number, default: 0 },
}, { timestamps: true });

// One university per name per country — the importer upserts on this.
UniversitySchema.index({ country: 1, slug: 1 }, { unique: true });
UniversitySchema.index({ name: 'text', country: 'text', city: 'text' });

export default mongoose.model<IUniversity>('University', UniversitySchema);
