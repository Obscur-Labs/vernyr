import mongoose, { Schema, Document } from 'mongoose';

export const COURSE_LEVELS = [
  'foundation', 'diploma', 'bachelors', 'masters', 'mba', 'phd', 'other',
] as const;
export type CourseLevel = (typeof COURSE_LEVELS)[number];

/** A money figure that keeps the sheet's own wording alongside the number. */
export interface IMoney {
  /** Verbatim from the source — "6,000 EUR/year", "EUR 100". */
  text?: string;
  amount?: number;
  currency?: string;
  /** What the amount buys. Tuition is quoted per year as often as per term. */
  per?: 'year' | 'semester' | 'term' | 'month' | 'total' | 'unknown';
}

export interface IExamRequirement {
  /** IELTS, TOEFL, PTE, Duolingo, GRE, GMAT… */
  name: string;
  minScore?: number;
  note?: string;
}

export interface ICourse extends Document {
  university: mongoose.Types.ObjectId;
  /** Denormalised so a filtered list needs no join. */
  universityName: string;
  country: string;

  name: string;
  level: CourseLevel;
  discipline?: string;
  link?: string;

  duration?: { text?: string; months?: number };
  applicationFee?: IMoney;
  tuition?: IMoney;

  intakes: string[];
  deadline?: { text?: string; date?: Date };
  exams: IExamRequirement[];
  examText?: string;
  gpa?: string;
  location?: string;
  notes?: string;
  tags: string[];

  /**
   * Anything the source had that this schema does not name. Keeping it means a
   * new column in next year's workbook is preserved rather than dropped, and
   * shows up in the UI as an extra detail row without a migration.
   */
  extras?: Map<string, string>;

  source?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const MoneySchema = new Schema<IMoney>({
  text:     String,
  amount:   Number,
  currency: String,
  per: { type: String, enum: ['year', 'semester', 'term', 'month', 'total', 'unknown'], default: 'unknown' },
}, { _id: false });

const CourseSchema = new Schema<ICourse>({
  university:     { type: Schema.Types.ObjectId, ref: 'University', required: true, index: true },
  universityName: { type: String, required: true },
  country:        { type: String, required: true, index: true },

  name:       { type: String, required: true, trim: true },
  level:      { type: String, enum: COURSE_LEVELS, default: 'other', index: true },
  discipline: { type: String, trim: true, index: true },
  link:       String,

  duration: { text: String, months: Number },
  applicationFee: MoneySchema,
  tuition:        MoneySchema,

  intakes:  { type: [String], default: [], index: true },
  deadline: { text: String, date: Date },
  exams:    { type: [new Schema({ name: String, minScore: Number, note: String }, { _id: false })], default: [] },
  examText: String,
  gpa:      String,
  location: String,
  notes:    String,
  tags:     { type: [String], default: [], index: true },

  extras: { type: Map, of: String },

  source:   String,
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

// The importer upserts on this — re-running it updates rather than duplicates.
CourseSchema.index({ university: 1, name: 1, level: 1 }, { unique: true });
CourseSchema.index({ name: 'text', universityName: 'text', discipline: 'text', tags: 'text' });
// The catalogue's default sort, and the shape of nearly every filtered query.
CourseSchema.index({ country: 1, level: 1, 'tuition.amount': 1 });

export default mongoose.model<ICourse>('Course', CourseSchema);
