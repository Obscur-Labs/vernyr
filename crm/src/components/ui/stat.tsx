'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { Sparkline } from '@/components/charts';
import { Skeleton } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * A headline number.
 *
 * There used to be two of these — a tinted `StatCard` on the dashboard and a
 * plain `Metric` on the report pages — which drifted apart on padding, type
 * scale and how they said "good". One component with an `accent` for the tinted
 * treatment and a `tone` for the judgement covers both.
 */

const statVariants = cva('rounded-2xl border p-5', {
  variants: {
    accent: {
      none: 'border-line bg-surface',
      indigo: 'border-indigo-500/20 bg-indigo-500/10 text-indigo-400',
      emerald: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400',
      amber: 'border-amber-500/20 bg-amber-500/10 text-amber-400',
      violet: 'border-violet-500/20 bg-violet-500/10 text-violet-400',
      blue: 'border-blue-500/20 bg-blue-500/10 text-blue-400',
      red: 'border-red-500/20 bg-red-500/10 text-red-400',
    },
  },
  defaultVariants: { accent: 'none' },
});

/** What the number says about the business, not what colour the card is. */
const TONE_CLASS = {
  neutral: 'text-t1',
  good: 'text-emerald-400',
  warn: 'text-amber-400',
  bad: 'text-red-400',
} as const;

export interface StatProps extends VariantProps<typeof statVariants> {
  label: string;
  value: React.ReactNode;
  /** A line under the number — context, not a second metric. */
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: keyof typeof TONE_CLASS;
  /** Change over the same period, as a percentage. */
  trend?: { value: number; label: string };
  /** The last N periods, drawn beside the number. */
  spark?: number[];
  className?: string;
}

export function Stat({
  label, value, hint, icon, accent, tone = 'neutral', trend, spark, className,
}: StatProps) {
  const tinted = accent && accent !== 'none';

  return (
    <div className={cn(statVariants({ accent }), className)}>
      {(icon || trend) && (
        <div className="mb-3 flex items-center justify-between">
          <span className="[&>svg]:h-[22px] [&>svg]:w-[22px]">{icon}</span>
          {trend && (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium',
                trend.value >= 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400',
              )}
            >
              {trend.value >= 0 ? '+' : ''}{trend.value}% {trend.label}
            </span>
          )}
        </div>
      )}

      {/* Untinted stats put the label first — that is the report-page reading
          order, where the label is the question and the number is the answer. */}
      {!tinted && (
        <p className="text-[11px] font-semibold uppercase tracking-wider text-t3">{label}</p>
      )}

      <div className={cn('flex items-end justify-between gap-2', !tinted && 'mt-2')}>
        <p className={cn('text-[30px] font-bold leading-none tracking-tight', TONE_CLASS[tone])}>
          {value}
        </p>
        {spark && spark.length > 1 && (
          <span className="mb-1 shrink-0 opacity-80">
            <Sparkline points={spark} color="currentColor" />
          </span>
        )}
      </div>

      {tinted && (
        <p className="mt-1 text-xs font-medium uppercase tracking-wider text-t2">{label}</p>
      )}
      {hint && <p className="mt-1.5 text-[12px] text-t3">{hint}</p>}
    </div>
  );
}

export function StatSkeleton() {
  return (
    <div className="rounded-2xl border border-line bg-card p-5">
      <Skeleton className="mb-3 h-8 w-8 rounded-lg" />
      <Skeleton className="mb-2 h-9 w-20 rounded" />
      <Skeleton className="h-3 w-24 rounded" />
    </div>
  );
}
