import mongoose, { Schema, Document } from 'mongoose';
import {
  accountFields,
  applyAccountBehaviour,
  USERNAME_RE,
  blankToUndefined,
  type AccountBase,
} from './accountFields';

/** `users` — the people who work here. */

export type StaffRole = 'admin' | 'counsellor';
/** Kept as the union of both collections' roles, for code that spans them. */
export type UserRole = 'admin' | 'counsellor' | 'student' | 'university';

export const STAFF_ROLES: StaffRole[] = ['admin', 'counsellor'];

/** The admin signs in with an email address; everyone else uses a username. */
export const EMAIL_LOGIN_ROLES: UserRole[] = ['admin'];
export const usesEmailLogin = (role: UserRole) => EMAIL_LOGIN_ROLES.includes(role);

export { USERNAME_RE, blankToUndefined };

export interface IUser extends AccountBase, Document {
  role: StaffRole;
}

const UserSchema = new Schema<IUser>(
  {
    ...accountFields,
    role: { type: String, enum: STAFF_ROLES, default: 'counsellor' },
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
