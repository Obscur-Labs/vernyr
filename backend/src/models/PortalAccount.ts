import mongoose, { Schema, Document } from 'mongoose';
import { accountFields, applyAccountBehaviour, type AccountBase } from './accountFields';

/** `portalaccounts` — logins for the people we serve, rather than the people who work here. */

export type PortalRole = 'student' | 'university';
export const PORTAL_ROLES: PortalRole[] = ['student', 'university'];

export interface IPortalAccount extends AccountBase, Document {
  role: PortalRole;
  /** Required for `student` — the record this login is bound to. */
  studentId?: mongoose.Types.ObjectId;
  /** Required for `university` — must match application records exactly. */
  universityName?: string;
}

const PortalAccountSchema = new Schema<IPortalAccount>(
  {
    ...accountFields,
    role: { type: String, enum: PORTAL_ROLES, required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student' },
    universityName: { type: String, trim: true },
  },
  { timestamps: true },
);

/** Username always; plus the field that scopes the kind. */
PortalAccountSchema.pre('validate', function (next) {
  if (!this.username) return next(new Error('A username is required for a portal account'));
  if (this.role === 'student' && !this.studentId) {
    return next(new Error('A student login must be linked to a student record'));
  }
  if (this.role === 'university' && !this.universityName) {
    return next(new Error('A university login needs the institution name'));
  }
  next();
});

applyAccountBehaviour(PortalAccountSchema);

export default mongoose.model<IPortalAccount>('PortalAccount', PortalAccountSchema);
