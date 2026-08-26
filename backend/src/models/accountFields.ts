import { Schema, type SchemaDefinition } from 'mongoose';
import bcrypt from 'bcryptjs';

/** Everything an account needs in order to sign in, shared by the two collections that hold one. */

/** Letters, digits, dot, underscore, hyphen — 3–32 chars, must start alphanumeric. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** A blank credential must be stored as nothing at all. */
export const blankToUndefined = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

export interface AccountBase {
  name: string;
  username?: string;
  email?: string;
  password: string;
  avatar?: string;
  phone?: string;
  /** The access preset this account sits in. See `services/access.ts`. */
  presetKey?: string;
  /** Per-person grants and revocations layered on the preset. Absent = none. */
  permissions?: Record<string, Partial<Record<'create' | 'read' | 'update' | 'delete', boolean>>>;
  isActive: boolean;
  lastSeenAt?: Date;
  createdAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

export const accountFields: SchemaDefinition = {
  name: { type: String, required: true, trim: true },
  username: {
    type: String, unique: true, sparse: true, lowercase: true, trim: true,
    set: blankToUndefined,
    match: [USERNAME_RE, 'Username must be 3–32 characters: letters, numbers, dot, underscore or hyphen'],
  },
  email: {
    type: String, unique: true, sparse: true, lowercase: true, trim: true,
    set: blankToUndefined,
  },
  password: { type: String, required: true, minlength: 6 },
  avatar: { type: String },
  phone: { type: String },
  // No default on either of these.
  presetKey: { type: String, lowercase: true, trim: true, set: blankToUndefined },
  permissions: { type: Schema.Types.Mixed },
  isActive: { type: Boolean, default: true },
  lastSeenAt: { type: Date },
};

/** Hashing, comparison and password-stripping, applied identically to both collections. */
export function applyAccountBehaviour(schema: Schema) {
  schema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    (this as unknown as { password: string }).password =
      await bcrypt.hash((this as unknown as { password: string }).password, 12);
    next();
  });

  schema.methods.comparePassword = function (candidate: string) {
    return bcrypt.compare(candidate, (this as unknown as { password: string }).password);
  };

  schema.set('toJSON', {
    transform: (_doc, ret) => {
      delete (ret as unknown as Record<string, unknown>).password;
      return ret;
    },
  });
}
