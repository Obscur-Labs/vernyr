import mongoose, { Schema, Document } from 'mongoose';

export type ActivityAction =
  | 'create' | 'update' | 'delete'
  | 'login' | 'login_failed' | 'register'
  | 'password_reset' | 'impersonate' | 'purge';

/** `app` = a normal authenticated request; `dev` = the unauthenticated /dev console. */
export type ActivitySource = 'app' | 'dev';

export interface IActivityLog extends Document {
  actorId: mongoose.Types.ObjectId | null;
  actorName: string;
  actorRole?: string;
  action: ActivityAction;
  entity: string;
  entityId?: mongoose.Types.ObjectId;
  label: string;
  changes?: string[];
  source: ActivitySource;
  ip?: string;
  createdAt: Date;
}

const ActivityLogSchema = new Schema<IActivityLog>({
  actorId:   { type: Schema.Types.ObjectId, ref: 'User', default: null },
  actorName: { type: String, required: true },
  actorRole: { type: String },
  action:    { type: String, required: true, enum: ['create','update','delete','login','login_failed','register','password_reset','impersonate','purge'] },
  entity:    { type: String, required: true },
  entityId:  { type: Schema.Types.ObjectId },
  label:     { type: String, required: true },
  changes:   { type: [String], default: undefined },
  source:    { type: String, required: true, enum: ['app','dev'], default: 'app' },
  ip:        { type: String },
}, { timestamps: { createdAt: true, updatedAt: false } });

ActivityLogSchema.index({ createdAt: -1 });

export default mongoose.model<IActivityLog>('ActivityLog', ActivityLogSchema);
