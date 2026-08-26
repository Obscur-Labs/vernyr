'use client';

import { groupModules, labelFor } from '@/lib/access';
import type { Action, ModuleDef, PermissionMap } from '@/types';

/** The module × action grid, shared by the Roles screen and a member's own Advanced settings. */

interface Props {
  modules: ModuleDef[];
  value: PermissionMap;
  onChange: (next: PermissionMap) => void;
  disabled?: boolean;
  /** The preset to diff against, when editing one person's overrides. */
  baseline?: PermissionMap;
  baselineLabel?: string;
}

export function PermissionMatrix({
  modules, value, onChange, disabled, baseline, baselineLabel = 'the preset',
}: Props) {
  const held = (mod: string, action: Action) => value[mod]?.[action] === true;
  const differs = (mod: string, action: Action) =>
    !!baseline && (baseline[mod]?.[action] === true) !== held(mod, action);

  const setVerb = (mod: string, action: Action, on: boolean) =>
    onChange({ ...value, [mod]: { ...value[mod], [action]: on } });

  const setModule = (mod: ModuleDef, on: boolean) =>
    onChange({
      ...value,
      [mod.key]: Object.fromEntries(mod.actions.map((a) => [a, on])),
    });

  return (
    <div className="space-y-6">
      {groupModules(modules).map(({ group, modules: rows }) => (
        <section key={group}>
          <h3 className="mb-2 px-1 text-[13px] font-semibold text-t2">{group}</h3>

          <div className="hig-group divide-y divide-line">
            {rows.map((mod) => {
              const all = mod.actions.every((a) => held(mod.key, a));
              const some = mod.actions.some((a) => held(mod.key, a));

              return (
                <div key={mod.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 sm:max-w-[46%]">
                    <div className="flex items-center gap-2">
                      <span className="text-[15px] font-semibold text-t1">{mod.label}</span>
                      {some && !all && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-t2">
                          Partial
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[13px] leading-snug text-t2">{mod.description}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                    {mod.actions.map((action) => (
                      <VerbToggle
                        key={action}
                        label={labelFor(mod, action)}
                        on={held(mod.key, action)}
                        changed={differs(mod.key, action)}
                        disabled={disabled}
                        onToggle={() => setVerb(mod.key, action, !held(mod.key, action))}
                      />
                    ))}

                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setModule(mod, !all)}
                      className="hig-press ml-1 rounded-full px-2.5 py-1.5 text-[12px] font-medium text-t3 hover:bg-muted hover:text-t2 disabled:opacity-40"
                    >
                      {all ? 'None' : 'All'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {baseline && (
        <p className="px-1 text-[12px] text-t3">
          A dot marks a verb that differs from {baselineLabel}.
        </p>
      )}
    </div>
  );
}

function VerbToggle({
  label, on, changed, disabled, onToggle,
}: {
  label: string;
  on: boolean;
  changed?: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`hig-press relative flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium disabled:opacity-40 ${
        on
          ? 'border-accent/40 bg-accent/15 text-accent'
          : 'border-line bg-card text-t3 hover:text-t2'
      }`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-accent' : 'bg-t3/40'}`}
      />
      {label}
      {changed && (
        <span
          aria-hidden
          title="Differs from the preset"
          className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-surface"
        />
      )}
    </button>
  );
}
