import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export type UserRole = 'admin' | 'counsellor' | 'student' | 'university';

/** The admin signs in with an email address; every other role signs in with a username. */
export const EMAIL_LOGIN_ROLES: UserRole[] = ['admin'];
export const usesEmailLogin = (role: UserRole) => EMAIL_LOGIN_ROLES.includes(role);

/** Letters, digits, dot, underscore, hyphen — 3–32 chars, must start alphanumeric. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export interface IUser extends Document {
  name: string;
  username?: string;
  email?: string;
  password: string;
  role: UserRole;
  avatar?: string;
  phone?: string;
  studentId?: import('mongoose').Types.ObjectId;
  universityName?: string;   // set for role === 'university' — scopes their access
  isActive: boolean;
  lastSeenAt?: Date;         // updated when the user's last socket disconnects
  createdAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>({
  name:     { type: String, required: true, trim: true },
  username: { type: String, unique: true, sparse: true, lowercase: true, trim: true, match: [USERNAME_RE, 'Username must be 3–32 characters: letters, numbers, dot, underscore or hyphen'] },
  email:    { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  role:           { type: String, enum: ['admin','counsellor','student','university'], default: 'counsellor' },
  avatar:         { type: String },
  phone:          { type: String },
  studentId:      { type: Schema.Types.ObjectId, ref: 'Student' },
  universityName: { type: String },   // required when role === 'university'
  isActive:   { type: Boolean, default: true },
  lastSeenAt: { type: Date },
}, { timestamps: true });

UserSchema.pre('validate', function (next) {
  if (usesEmailLogin(this.role)) {
    if (!this.email) return next(new Error('Admin accounts sign in with an email address'));
  } else if (!this.username) {
    return next(new Error('A username is required for this role'));
  }
  next();
});

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

UserSchema.methods.comparePassword = function (candidate: string) {
  return bcrypt.compare(candidate, this.password);
};

UserSchema.set('toJSON', { transform: (_doc, ret) => { delete (ret as unknown as Record<string, unknown>).password; return ret; } });

export default mongoose.model<IUser>('User', UserSchema);
