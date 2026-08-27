'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * The surface every panel in the CRM sits on.
 *
 * `Card` is the box; `CardHeader` gives it the title/subtitle/action row that
 * nearly every panel repeats. Composing them means a chart panel, a form panel
 * and a table panel share one set of paddings and radii.
 */

const cardVariants = cva('rounded-2xl border', {
  variants: {
    tone: {
      surface: 'border-line bg-surface',
      /** One step further forward — a card inside a card. */
      inset: 'border-line bg-card',
      /** For an empty slot waiting to be filled. */
      dashed: 'border-dashed border-line bg-transparent',
    },
    padding: {
      none: 'p-0',
      sm: 'p-4',
      md: 'p-5',
      lg: 'p-6',
    },
  },
  defaultVariants: { tone: 'surface', padding: 'md' },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

export function Card({ className, tone, padding, ...props }: CardProps) {
  return <div className={cn(cardVariants({ tone, padding }), className)} {...props} />;
}

export function CardHeader({
  title, subtitle, action, className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-aligned control — a link, a filter, a button. */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-5 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-t1">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[12px] text-t3">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

/** Title, subtitle and actions at the top of a page. */
export function PageHeader({
  title, subtitle, actions, className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-t1">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-t2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </header>
  );
}

/**
 * Nothing to show. Every list in the app reaches this state, and each one used
 * to draw its own — so they disagreed on spacing, tone and whether to offer a
 * way out of it.
 */
export function EmptyState({
  icon, title, description, action, className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card tone="dashed" padding="none" className={cn('py-16 text-center', className)}>
      {icon && <div className="mx-auto mb-3 flex justify-center text-t3/60">{icon}</div>}
      <p className="text-[15px] font-semibold text-t1">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-t3">{description}</p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </Card>
  );
}

/** A pulsing placeholder shaped like the thing that is loading. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn('animate-pulse rounded-xl bg-muted', className)} style={style} />;
}

/** `n` skeletons in a column — the shape of a list that has not arrived. */
export function SkeletonList({ rows = 6, height = 64 }: { rows?: number; height?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} style={{ height }} />
      ))}
    </div>
  );
}
