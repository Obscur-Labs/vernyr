import mongoose, { Schema, Document } from 'mongoose';

/** A 6-digit code sent by email: first login, or forgot password. Only its hash is stored. */

export type AuthCodePurpose = 'login' | 'reset' | 'verify_email' | 'contact_change' | 'consent_sign' | 'consent_sign_guardian';

export interface IAuthCode extends Document {
  accountId: mongoose.Types.ObjectId;
  purpose: AuthCodePurpose;
  codeHash: string;
  remember: boolean;
  attempts: number;
  resends: number;
  used: boolean;
  lastSentAt: Date;
  expiresAt: Date;
  /** Where the code went, and what it confirms (contact change, document hash). */
  destination?: string;
  payload?: Record<string, unknown>;
  createdAt: Date;
}

const AuthCodeSchema = new Schema<IAuthCode>({
  accountId: { type: Schema.Types.ObjectId, required: true, index: true },
  purpose: { type: String, enum: ['login', 'reset', 'verify_email', 'contact_change', 'consent_sign', 'consent_sign_guardian'], required: true },
  codeHash: { type: String, required: true },
  remember: { type: Boolean, default: false },
  attempts: { type: Number, default: 0 },
  resends: { type: Number, default: 0 },
  used: { type: Boolean, default: false },
  lastSentAt: { type: Date, default: Date.now },
  // kept a day after expiry for the hourly send limit, then MongoDB deletes it
  expiresAt: { type: Date, required: true },
  destination: String,
  payload: Schema.Types.Mixed,
}, { timestamps: true });

AuthCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86_400 });

export default mongoose.model<IAuthCode>('AuthCode', AuthCodeSchema);
