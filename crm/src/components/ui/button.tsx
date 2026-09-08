'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * The one button.
 *
 * Variants are declared once here rather than as a class string repeated at
 * every call site, which is what stops "the primary button" from drifting into
 * six slightly different primary buttons. Proportions follow the HIG layer in
 * `globals.css`: 44pt tall by default, capsule, weight 600.
 */

export const buttonVariants = cva(
  'hig-press inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap disabled:pointer-events-none disabled:opacity-40 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-white hover:brightness-110',
        secondary: 'bg-accent/12 text-accent-ink hover:bg-accent/20',
        outline: 'border border-line bg-card text-t2 hover:border-accent/50 hover:text-t1',
        ghost: 'text-t2 hover:bg-muted hover:text-t1',
        danger: 'danger-action bg-transparent',
        // Solid destructive — for the confirm button in a delete dialog.
        destructive: 'text-white hover:brightness-110',
      },
      size: {
        // `sm` is drawn at 32pt — the right weight for a control inside a
        // table row — and `.hig-touch` grows its tap target back to 44.
        sm: 'hig-touch min-h-8 px-3.5 hig-footnote',
        md: 'hig-control px-5 hig-subhead',
        lg: 'min-h-12 px-6 hig-callout',
        /** Square, for a lone glyph. 36pt drawn, 44pt to the finger. */
        icon: 'hig-touch h-9 w-9 rounded-xl p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
  VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = 'button', style, ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      // `destructive` has no colour of its own: the danger token is a CSS
      // variable, and Tailwind cannot name it as a background utility.
      style={variant === 'destructive' ? { background: 'var(--color-danger)', ...style } : style}
      {...props}
    />
  );
}

/** The same shape as a link — `next/link` cannot take a `variant` prop. */
export function ButtonLink({
  className, variant, size, href, external, ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> &
  VariantProps<typeof buttonVariants> & { href: string; external?: boolean }) {
  const classes = cn(buttonVariants({ variant, size }), className);

  if (external) {
    return <a href={href} target="_blank" rel="noreferrer" className={classes} {...props} />;
  }
  return <Link href={href} className={classes} {...props} />;
}

/**
 * A toolbar control: one glyph, always labelled.
 *
 * Drawn at 36pt, which is the weight Apple gives a toolbar button on a
 * pointer machine, and padded out to a 44pt tap target by `.hig-touch` — the
 * glyph should not grow just because the finger needs room.
 */
export function IconButton({
  label, className, variant = 'ghost', ...props
}: Omit<ButtonProps, 'size' | 'aria-label'> & { label: string }) {
  return (
    <Button
      variant={variant}
      size="icon"
      aria-label={label}
      title={label}
      className={className}
      {...props}
    />
  );
}
