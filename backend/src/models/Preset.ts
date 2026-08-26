import mongoose, { Schema, Document } from 'mongoose';
import type { PermissionMap } from '../config/modules';

/** A stored preset — either a custom one, or an edit that shadows a built-in of the same key. */
export interface IPreset extends Document {
  key: string;
  name: string;
  description?: string;
  fullAccess: boolean;
  permissions: PermissionMap;
  scope: 'staff' | 'portal';
  createdAt: Date;
  updatedAt: Date;
}

/** Lowercase, starts alphanumeric, 2–32 chars — the same shape as a username. */
export const PRESET_KEY_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

const PresetSchema = new Schema<IPreset>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [PRESET_KEY_RE, 'Key must be 2–32 characters: lowercase letters, numbers, underscore or hyphen'],
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    fullAccess: { type: Boolean, default: false },
    /** Stored as a free-form object rather than a nested schema. */
    permissions: { type: Schema.Types.Mixed, default: {} },
    scope: { type: String, enum: ['staff', 'portal'], default: 'staff' },
  },
  { timestamps: true },
);

export default mongoose.model<IPreset>('Preset', PresetSchema);
