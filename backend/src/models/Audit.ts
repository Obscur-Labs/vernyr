import mongoose, { Schema, Document, Types } from 'mongoose';
import type { AuthRequest } from '../middleware/auth';

/** The client's append-only audit log (legacy `audit_log`) and key / value settings (legacy `settings`). */

export interface IAuditLog extends Document {
  user_id?: Types.ObjectId; action: string; entity_type?: string; entity_id?: string; entity_label?: string;
  old_value?: unknown; new_value?: unknown; ip?: string; user_agent?: string; actor_type?: string; university_id?: Types.ObjectId; createdAt: Date;
}
const AuditSchema = new Schema<IAuditLog>({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', index: true }, action: { type: String, required: true, index: true },
  entity_type: String, entity_id: String, entity_label: String, old_value: Schema.Types.Mixed, new_value: Schema.Types.Mixed, ip: String, user_agent: String, actor_type: { type: String, default: 'staff' }, university_id: { type: Schema.Types.ObjectId, ref: 'University', index: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
// append-only: no update or delete through the model
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  AuditSchema.pre(op, function () { throw new Error('The audit log is append-only'); });
}
export const AuditLog = mongoose.model<IAuditLog>('AuditLog', AuditSchema);

/** audit(req, action, entityType, entityId, label, old, new): never throws. */
export async function audit(req: AuthRequest, action: string, entityType?: string, entityId?: unknown, label?: string, oldValue?: unknown, newValue?: unknown) {
  try {
    await AuditLog.create({ user_id: req.user?.id, action, entity_type: entityType, entity_id: entityId ? String(entityId) : undefined, entity_label: label,
      old_value: oldValue, new_value: newValue, ip: req.ip, user_agent: String(req.headers['user-agent'] ?? '').slice(0, 200) });
  } catch { /* an audit failure never breaks the request */ }
}

export interface ISetting extends Document { key: string; value: string; updated_by?: Types.ObjectId }
export const Setting = mongoose.model<ISetting>('Setting', new Schema<ISetting>({
  key: { type: String, required: true, unique: true }, value: String, updated_by: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true }));

/** The client's defaults (legacy db.js DEFAULT_SETTINGS, the ones the CRM reads). */
export const DEFAULT_SETTINGS: Record<string, string> = {
  session_timeout_min: '30', portal_idle_min: '60', batching_window_min: '2', max_file_mb: '10', otp_enabled: '0', otp_admin_only: '1',
  drive_sync_enabled: '0', parent_cc_enabled: '0', attach_offer_letter: '1', show_passport_last4: '0', auto_assign_rule: 'none', folder_trigger: 'enrolment_confirmed',
  sending_address: 'counselling@laeuropa.com', discount_limit_inr: '5000', display_name_format: '{counsellor_name} | La Europa Education', email_footer: '', aps_link: '',
  auto_assign_country_map: '{}', e21_not_interested: '0',
};
export async function allSettings() {
  const rows = await Setting.find().lean();
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}
export async function getSetting(key: string) { return (await Setting.findOne({ key }).lean())?.value ?? DEFAULT_SETTINGS[key] ?? null; }
export async function setSetting(key: string, value: string, userId?: string) {
  await Setting.updateOne({ key }, { value, updated_by: userId }, { upsert: true });
}
