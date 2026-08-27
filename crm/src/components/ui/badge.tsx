'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { COURSE_LEVEL_LABELS, type CourseLevel, type UserRole } from '@/types';

/**
 * Pills.
 *
 * The tone names are semantic rather than colours, so a status keeps its
 * meaning if the palette moves. Role and level get their own components
 * because those two vocabularies are fixed and appear on half the screens.
 */

export const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-t2',
        accent: 'bg-accent/15 text-accent',
        success: 'bg-emerald-500/15 text-emerald-400',
        warning: 'bg-amber-500/15 text-amber-400',
        danger: 'bg-red-500/15 text-red-400',
        info: 'bg-blue-500/15 text-blue-400',
        violet: 'bg-violet-500/15 text-violet-400',
        outline: 'border border-line text-t3',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/* ── Fixed vocabularies ──────────────────────────────────────────────────── */

const ROLE_CLASS: Record<UserRole, string> = {
  admin: 'chip-admin',
  counsellor: 'chip-counsellor',
  student: 'chip-student',
  university: 'chip-university',
};

const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Admin',
  counsellor: 'Counsellor',
  student: 'Student',
  university: 'University',
};

export function RoleBadge({ role, className }: { role: UserRole; className?: string }) {
  return <span className={cn('chip', ROLE_CLASS[role], className)}>{ROLE_LABEL[role]}</span>;
}

const LEVEL_TONE: Record<CourseLevel, BadgeProps['tone']> = {
  foundation: 'info',
  diploma: 'info',
  bachelors: 'accent',
  masters: 'success',
  mba: 'warning',
  phd: 'violet',
  other: 'neutral',
};

export function LevelBadge({ level, className }: { level: CourseLevel; className?: string }) {
  return (
    <Badge tone={LEVEL_TONE[level] ?? 'neutral'} className={className}>
      {COURSE_LEVEL_LABELS[level] ?? level}
    </Badge>
  );
}
