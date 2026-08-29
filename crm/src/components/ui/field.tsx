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
 */

const control = cva(
  'w-full rounded-xl border bg-card text-t1 placeholder:text-t3 focus:outline-none disabled:opacity-50',
  {
    variants: {
      size: {
        sm: 'px-2.5 py-1.5 text-[13px]',
        md: 'px-3 py-2.5 text-[14px]',
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

export const Textarea = ({ className, size, invalid, rows = 3, ...props }:
React.TextareaHTMLAttributes<HTMLTextAreaElement> & ControlVariants) => (
  <textarea rows={rows} className={cn(control({ size, invalid }), className)} {...props} />
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
  return (
    <div className={cn('block', className)}>
      <label htmlFor={id} className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-t3">
        {label}
        {required && <span className="ml-1 text-[var(--color-danger)]">*</span>}
      </label>
      {typeof children === 'function' ? children(id) : children}
      {error
        ? <p className="mt-1 text-[11.5px] text-[var(--color-danger)]">{error}</p>
        : hint && <p className="mt-1 text-[11.5px] leading-relaxed text-t3">{hint}</p>}
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
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-t3" />
      <Input
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="pl-9"
      />
    </div>
  );
}

/**
 * A row of mutually exclusive choices — the iOS segmented control. Used for
 * report ranges, list filters and anything else with three or four options,
 * where a select would hide the alternatives behind a click.
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
    <div role="group" aria-label={label} className={cn('flex rounded-full border border-line bg-card p-0.5', className)}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            'hig-press rounded-full px-3 py-1.5 text-[12px] font-semibold',
            value === option.value ? 'bg-accent text-white' : 'text-t2 hover:text-t1',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A checkbox that takes the accent colour, with its label as the hit area. */
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
        'flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition-colors',
        checked ? 'bg-accent/10 text-accent' : 'text-t2 hover:bg-muted',
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-line bg-transparent accent-[var(--color-accent)]"
      />
      {children}
    </label>
  );
}
