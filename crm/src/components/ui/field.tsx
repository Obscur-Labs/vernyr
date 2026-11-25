'use client';

import { useId } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { SearchIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

/**
 * Form controls.
 *
 * One `control` recipe behind the input, the select and the textarea, so a
 * field's height, radius and focus ring cannot drift between them. `Field`
 * wires the label, the hint and the error to the control by id — the part that
 * gets skipped when every page writes its own `<label>`.
 *
 * Sizes follow the HIG layer: the default control is 44pt tall, which is the
 * minimum target Apple specifies, and its type is a step on the iOS scale
 * rather than a number that happened to look right. `sm` is the deliberate
 * exception — a dense table filter on a pointer machine, never a primary form.
 */

const control = cva(
  'hig-field-radius w-full border bg-card text-t1 placeholder:text-t3 focus:outline-none disabled:opacity-50',
  {
    variants: {
      size: {
        sm: 'hig-control-sm px-3 py-1.5 hig-footnote',
        md: 'hig-control px-3.5 py-2.5 hig-subhead',
      },
      invalid: {
        true: 'border-[var(--color-danger)] focus:border-[var(--color-danger)]',
        false: 'border-line focus:border-accent',
      },
    },
    defaultVariants: { size: 'md', invalid: false },
  },
);

type ControlVariants = VariantProps<typeof control>;

export const Input = ({ className, size, invalid, ...props }:
Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & ControlVariants) => (
  <input className={cn(control({ size, invalid }), className)} {...props} />
);

// A textarea is sized by its rows, so the 44pt floor would fight a 2-row box.
export const Textarea = ({ className, size, invalid, rows = 3, ...props }:
React.TextareaHTMLAttributes<HTMLTextAreaElement> & ControlVariants) => (
  <textarea
    rows={rows}
    className={cn(control({ size, invalid }), 'min-h-0 py-2.5', className)}
    {...props}
  />
);

// The DOM's own `size` is a number — of characters on an input, of visible rows
// on a select — so it is omitted from both: intersecting it with this scale
// would leave `never`, and every `size="sm"` would be a type error.
export const Select = ({ className, size, invalid, ...props }:
Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> & ControlVariants) => (
  <select className={cn(control({ size, invalid }), 'pr-8', className)} {...props} />
);

export function Field({
  label, hint, error, required, children, className,
}: {
  label: string;
  hint?: React.ReactNode;
  /** Replaces the hint while set, and marks the control invalid. */
  error?: string | null;
  required?: boolean;
  /** Given the generated id, so the label actually points at the control. */
  children: React.ReactNode | ((id: string) => React.ReactNode);
  className?: string;
}) {
  const id = useId();
  const describedBy = `${id}-desc`;
  const described = !!(error || hint);

  return (
    <div className={cn('block', className)}>
      <label htmlFor={id} className="hig-label mb-1.5 block text-t3">
        {label}
        {/* The asterisk alone is a colour-only signal to a screen reader. */}
        {required && (
          <span className="ml-1 text-[var(--color-danger)]">
            *<span className="sr-only"> (required)</span>
          </span>
        )}
      </label>
      {typeof children === 'function' ? children(id) : children}
      {described && (
        <p
          id={describedBy}
          role={error ? 'alert' : undefined}
          className={cn(
            'hig-caption mt-1.5',
            error ? 'text-[var(--color-danger)]' : 'leading-relaxed text-t3',
          )}
        >
          {error || hint}
        </p>
      )}
    </div>
  );
}

/** An input with the magnifier inside it — every list page has one. */
export function SearchInput({
  value, onValueChange, placeholder = 'Search…', className, label = 'Search',
}: {
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  label?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-t3" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="pl-10"
      />
    </div>
  );
}

/**
 * A row of mutually exclusive choices — the iOS segmented control. Used for
 * report ranges, list filters and anything else with three or four options,
 * where a select would hide the alternatives behind a click.
 *
 * The track is 44pt so the whole control clears the touch minimum; the
 * segments inside it are the 36pt Apple draws, with `.hig-touch` growing each
 * one's target back out to the full height of the track.
 */
export function Segmented<T extends string | number>({
  value, onChange, options, label, className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'hig-control inline-flex items-center rounded-full border border-line bg-card p-1',
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            'hig-press hig-touch hig-touch-tight flex h-9 items-center rounded-full px-4 hig-footnote font-semibold',
            value === option.value ? 'bg-accent text-white' : 'text-t2 hover:text-t1',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A checkbox that takes the accent colour, with its label as the hit area.
 *
 * The whole row is the target — a 14pt box on its own is a quarter of the
 * area Apple asks for, and the label is the part people actually aim at.
 */
export function Checkbox({
  checked, onChange, children, className,
}: {
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'hig-control flex cursor-pointer items-center gap-2.5 rounded-xl px-3 hig-footnote transition-colors',
        checked ? 'bg-accent/10 text-accent-ink' : 'text-t2 hover:bg-muted',
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 shrink-0 cursor-pointer rounded border-line bg-transparent accent-[var(--color-accent)]"
      />
      {children}
    </label>
  );
}
