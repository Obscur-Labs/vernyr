import Preset from '../models/Preset';
import User from '../models/User';
import PortalAccount from '../models/PortalAccount';
import { findAccountById, type AccountKind } from './accounts';
import {
  allPermissions,
  sanitizePermissions,
  type Action,
  type PermissionMap,
} from '../config/modules';
import {
  BUILT_IN_PRESETS,
  DEFAULT_PRESET_FOR_ROLE,
  isBuiltIn,
  type PresetDef,
} from '../config/presets';

/** Resolving what one caller may do. */

export interface Principal {
  id: string;
  role: string;
  name: string;
  /** Which collection holds this account — staff, or a portal party. */
  kind: AccountKind;
  isActive: boolean;
  presetKey: string;
  presetName: string;
  fullAccess: boolean;
  permissions: PermissionMap;
  /** True when the account carries its own overrides on top of the preset. */
  hasOverrides: boolean;
}

/* ── Preset resolution ─────────────────────────────────────────────────── */

export async function listPresets(): Promise<PresetDef[]> {
  const stored = await Preset.find().lean();
  const byKey = new Map<string, PresetDef>();

  for (const p of BUILT_IN_PRESETS) byKey.set(p.key, p);
  for (const row of stored) {
    byKey.set(row.key, {
      key: row.key,
      name: row.name,
      description: row.description ?? '',
      fullAccess: !!row.fullAccess,
      permissions: sanitizePermissions(row.permissions),
      isSystem: isBuiltIn(row.key),
      scope: row.scope ?? 'staff',
    });
  }
  return [...byKey.values()].sort((a, b) =>
    a.isSystem === b.isSystem ? a.name.localeCompare(b.name) : a.isSystem ? -1 : 1,
  );
}

export async function getPreset(key: string): Promise<PresetDef | null> {
  return (await listPresets()).find((p) => p.key === key) ?? null;
}

/* ── Merging ───────────────────────────────────────────────────────────── */

/** Overrides win verb by verb, so an override can revoke as well as grant. */
function merge(base: PermissionMap, overrides: PermissionMap): PermissionMap {
  const out: PermissionMap = {};
  for (const [mod, verbs] of Object.entries(base)) out[mod] = { ...verbs };
  for (const [mod, verbs] of Object.entries(overrides)) out[mod] = { ...out[mod], ...verbs };
  return out;
}

/** `fullAccess` is a floor: every module, then the preset's map laid over it. */
export function effectivePermissions(preset: PresetDef, overrides?: PermissionMap): PermissionMap {
  const base = preset.fullAccess
    ? merge(allPermissions(), preset.permissions)
    : preset.permissions;
  return overrides && Object.keys(overrides).length ? merge(base, overrides) : { ...base };
}

export const allows = (permissions: PermissionMap, module: string, action: Action): boolean =>
  permissions[module]?.[action] === true;

/* ── Principal cache ───────────────────────────────────────────────────── */

/** Live record per request so deactivation bites at once; briefly cached. */
const TTL_MS = 10_000;
const cache = new Map<string, { at: number; principal: Principal | null }>();

export function invalidateUser(userId: string) {
  cache.delete(String(userId));
}
export function invalidateAll() {
  cache.clear();
}

export async function loadPrincipal(userId: string): Promise<Principal | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.principal;

  const principal = await resolve(userId);
  cache.set(userId, { at: Date.now(), principal });
  return principal;
}

async function resolve(userId: string): Promise<Principal | null> {
  // Either collection may hold them, and during the split window a portal
  // account may still be sitting in `users`. The lookup covers both.
  const account = await findAccountById(userId);
  if (!account) return null;

  // No `presetKey` is the normal state for every pre-existing account, not an
  // error: their role names the seat they have always had.
  const key = account.presetKey || DEFAULT_PRESET_FOR_ROLE[account.role] || 'counsellor';
  const preset =
    (await getPreset(key)) ??
    (await getPreset(DEFAULT_PRESET_FOR_ROLE[account.role] ?? 'counsellor'));

  if (!preset) return null;

  const overrides = sanitizePermissions(account.permissions);
  return {
    id: account.id,
    role: account.role,
    name: account.name,
    kind: account.kind,
    isActive: account.isActive,
    presetKey: preset.key,
    presetName: preset.name,
    fullAccess: preset.fullAccess,
    permissions: effectivePermissions(preset, overrides),
    hasOverrides: Object.keys(overrides).length > 0,
  };
}

/** How many accounts point at a preset — the check before deleting one. */
export async function countUsersOnPreset(key: string): Promise<number> {
  const roleDefault = Object.entries(DEFAULT_PRESET_FOR_ROLE)
    .filter(([, presetKey]) => presetKey === key)
    .map(([role]) => role);

  const filter = {
    isActive: true,
    $or: [
      { presetKey: key },
      // Accounts that never had a preset written still resolve to their role's
      // default, so deleting that preset would silently move them.
      ...(roleDefault.length
        ? [{ presetKey: { $in: [null, ''] }, role: { $in: roleDefault } }]
        : []),
    ],
  };

  const [staff, portal] = await Promise.all([
    User.countDocuments(filter),
    PortalAccount.countDocuments(filter),
  ]);
  return staff + portal;
}
