import type { Action, ModuleDef, PermissionMap } from '@/types';

/** The client half of the access system. */

export const allows = (permissions: PermissionMap | undefined, module: string, action: Action): boolean =>
  permissions?.[module]?.[action] === true;

/** True when the caller holds any verb at all on a module. */
export const touches = (permissions: PermissionMap | undefined, module: string): boolean =>
  Object.values(permissions?.[module] ?? {}).some(Boolean);

/** Overrides win verb by verb, so an override can revoke as well as grant. */
export function mergePermissions(base: PermissionMap, overrides: PermissionMap): PermissionMap {
  const out: PermissionMap = {};
  for (const [mod, verbs] of Object.entries(base)) out[mod] = { ...verbs };
  for (const [mod, verbs] of Object.entries(overrides)) out[mod] = { ...out[mod], ...verbs };
  return out;
}

/** Only the verbs that actually differ from the preset — what gets saved. */
export function diffFromPreset(preset: PermissionMap, edited: PermissionMap, modules: ModuleDef[]): PermissionMap {
  const out: PermissionMap = {};
  for (const mod of modules) {
    for (const action of mod.actions) {
      const base = preset[mod.key]?.[action] === true;
      const next = edited[mod.key]?.[action] === true;
      if (base !== next) out[mod.key] = { ...out[mod.key], [action]: next };
    }
  }
  return out;
}

export const ACTION_LABEL: Record<Action, string> = {
  create: 'Create',
  read: 'View',
  update: 'Edit',
  delete: 'Delete',
};

/** The module's own wording where the plain verb would mislead. */
export const labelFor = (mod: ModuleDef, action: Action): string =>
  mod.actionLabels?.[action] ?? ACTION_LABEL[action];

export const GROUP_ORDER: ModuleDef['group'][] = [
  'Pipeline',
  'Casework',
  'Catalogue',
  'Money',
  'Communication',
  'Administration',
];

export function groupModules(modules: ModuleDef[]): { group: ModuleDef['group']; modules: ModuleDef[] }[] {
  return GROUP_ORDER.map((group) => ({ group, modules: modules.filter((m) => m.group === group) }))
    .filter((g) => g.modules.length > 0);
}

/** "Full access", "9 of 12 modules", "View only" — the one-line summary. */
export function summarize(permissions: PermissionMap, modules: ModuleDef[]): string {
  const held = modules.filter((m) => m.actions.some((a) => allows(permissions, m.key, a)));
  if (held.length === 0) return 'No access';
  if (held.length === modules.length && modules.every((m) => m.actions.every((a) => allows(permissions, m.key, a)))) {
    return 'Full access';
  }
  const writes = held.some((m) => (['create', 'update', 'delete'] as Action[]).some((a) => allows(permissions, m.key, a)));
  return `${held.length} of ${modules.length} modules${writes ? '' : ' · view only'}`;
}

/** What a preset actually grants. */
export function expandPreset(
  preset: { fullAccess: boolean; permissions: PermissionMap },
  modules: ModuleDef[],
): PermissionMap {
  if (!preset.fullAccess) {
    return Object.fromEntries(modules.map((m) => [m.key, { ...preset.permissions[m.key] }]));
  }
  const all: PermissionMap = Object.fromEntries(
    modules.map((m) => [m.key, Object.fromEntries(m.actions.map((a) => [a, true]))]),
  );
  return mergePermissions(all, preset.permissions);
}

/** The modules a permission map touches at all — the at-a-glance chip list. */
export const heldModules = (permissions: PermissionMap, modules: ModuleDef[]): ModuleDef[] =>
  modules.filter((m) => m.actions.some((a) => allows(permissions, m.key, a)));
