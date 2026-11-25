import mongoose, { Schema, Document } from 'mongoose';
import {
  accountFields,
  applyAccountBehaviour,
  USERNAME_RE,
  blankToUndefined,
  type AccountBase,
} from './accountFields';

/** `users` — the people who work here. */

export type StaffRole = 'admin' | 'counsellor' | 'manager';
/** Kept as the union of both collections' roles, for code that spans them. */
export type UserRole = 'admin' | 'counsellor' | 'manager' | 'student' | 'university';

export const STAFF_ROLES: StaffRole[] = ['admin', 'counsellor', 'manager'];

/** Every staff member, Admins included, signs in with a username. */
export const EMAIL_LOGIN_ROLES: UserRole[] = []; // every staff member signs in with a username (La Europa decision)
export const usesEmailLogin = (role: UserRole) => EMAIL_LOGIN_ROLES.includes(role);

export { USERNAME_RE, blankToUndefined };

export interface IUser extends AccountBase, Document {
  role: StaffRole;
  /** Counsellor ID LE-CS-0001 / staff ID LE-ST-0001: never changes. */
  staff_code?: string;
  designation?: string;
  reports_to?: mongoose.Types.ObjectId;
  /** Admin console (legacy admin5): Super Admin, flags, branch / team, routing data for the assignment engine. */
  is_super_admin?: boolean; finance?: boolean; signing_authority?: boolean; discount_approver?: boolean;
  branch_id?: mongoose.Types.ObjectId; team_id?: mongoose.Types.ObjectId; countries?: string[]; languages?: string[]; capacity?: number; leave?: { from: string; to: string; note?: string }[];
}

const UserSchema = new Schema<IUser>(
  {
    ...accountFields,
    role: { type: String, enum: STAFF_ROLES, default: 'counsellor' },
    staff_code: { type: String, unique: true, sparse: true },
    designation: String,
    reports_to: { type: Schema.Types.ObjectId, ref: 'User' },
    is_super_admin: { type: Boolean, default: false }, finance: { type: Boolean, default: false }, signing_authority: { type: Boolean, default: false }, discount_approver: { type: Boolean, default: false },
    branch_id: { type: Schema.Types.ObjectId, ref: 'Branch' }, team_id: { type: Schema.Types.ObjectId, ref: 'Team' }, countries: { type: [String], default: undefined }, languages: { type: [String], default: undefined },
    capacity: { type: Number, default: 0 }, leave: { type: [{ _id: false, from: String, to: String, note: String }], default: undefined },
  },
  { timestamps: true },
);

UserSchema.pre('validate', function (next) {
  if (usesEmailLogin(this.role)) {
    if (!this.email) return next(new Error('Admin accounts sign in with an email address'));
  } else if (!this.username) {
    return next(new Error('A username is required for this role'));
  }
  next();
});

applyAccountBehaviour(UserSchema);

export default mongoose.model<IUser>('User', UserSchema);
