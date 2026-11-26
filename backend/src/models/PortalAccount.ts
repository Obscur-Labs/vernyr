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
  /** Portal sign-up creates a lead; the login moves to the student on conversion. */
  leadId?: mongoose.Types.ObjectId;
  /** Pending verification | Active | Locked | Deactivated */
  status: string;
  countryCode?: string; phoneNormalised?: string; isWhatsapp?: boolean; signupMethod?: string; mobileVerifiedAt?: Date;
  inviteTokenHash?: string; inviteExpiresAt?: Date; inviteSentCount?: number; inviteDay?: string;
  profileSubmittedAt?: Date; completionPercent?: number; language?: string; referralCode?: string; lockReason?: string;
  flags?: Record<string, unknown>; pendingEmail?: string; pendingPhone?: string;
  /** university logins (legacy uni_users) */
  universityId?: mongoose.Types.ObjectId; uniRole?: 'admin' | 'officer' | 'viewer'; finance?: boolean; campuses?: mongoose.Types.ObjectId[]; department?: string; alerts?: string[] | null;
  designation?: string; isMainContact?: boolean; pwHistory?: string[]; lastLoginAt?: Date;
}

const PortalAccountSchema = new Schema<IPortalAccount>(
  {
    ...accountFields,
    role: { type: String, enum: PORTAL_ROLES, required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student' },
    universityName: { type: String, trim: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
    status: { type: String, default: 'Active' },
    countryCode: { type: String, default: '+91' }, phoneNormalised: { type: String, index: true }, isWhatsapp: { type: Boolean, default: true }, signupMethod: String, mobileVerifiedAt: Date,
    inviteTokenHash: { type: String, index: true }, inviteExpiresAt: Date, inviteSentCount: { type: Number, default: 0 }, inviteDay: String,
    profileSubmittedAt: Date, completionPercent: { type: Number, default: 0 }, language: { type: String, default: 'en' }, referralCode: { type: String, unique: true, sparse: true }, lockReason: String,
    flags: Schema.Types.Mixed, pendingEmail: String, pendingPhone: String,
    universityId: { type: Schema.Types.ObjectId, ref: 'University', index: true }, uniRole: { type: String, enum: ['admin', 'officer', 'viewer'] }, finance: Boolean,
    campuses: [{ type: Schema.Types.ObjectId, ref: 'Campus' }], department: String, alerts: { type: [String], default: undefined }, designation: String, isMainContact: Boolean, pwHistory: [String], lastLoginAt: Date,
  },
  { timestamps: true },
);

/** A login handle (students: email or username; universities: username), plus the field that scopes the kind. */
PortalAccountSchema.pre('validate', function (next) {
  if (!this.username && !(this.role === 'student' && this.email)) {
    return next(new Error('A username is required for a portal account'));
  }
  if (this.role === 'student' && !this.studentId && !this.leadId) {
    return next(new Error('A student login must be linked to a lead or a student record'));
  }
  if (this.role === 'university' && !this.universityId && !this.universityName) {
    return next(new Error('A university login needs the institution name'));
  }
  next();
});

applyAccountBehaviour(PortalAccountSchema);

export default mongoose.model<IPortalAccount>('PortalAccount', PortalAccountSchema);
