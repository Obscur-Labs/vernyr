'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Checkbox, Input } from '@/components/ui/field';
import { CloseIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { Course, Facet, Money } from '@/types';

/** The catalogue's own parts — formatting and the facet filter. */

export { LevelBadge as LevelChip } from '@/components/ui/badge';

const PER_SUFFIX: Record<string, string> = {
  year: '/yr', semester: '/sem', term: '/term', month: '/mo', total: ' total', unknown: '',
};

/**
 * The source's own wording wins when we could not parse a number out of it —
 * "Courses are not found easily" is more honest than a blank cell.
 */
export function formatMoney(money?: Money): string {
  if (!money) return '—';
  if (money.amount == null) return money.text || '—';
  const value = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(money.amount);
  const currency = money.currency ? `${money.currency} ` : '';
  return `${currency}${value}${PER_SUFFIX[money.per ?? 'unknown'] ?? ''}`;
}

export function formatDuration(duration?: Course['duration']): string {
  if (!duration) return '—';
  if (duration.months == null) return duration.text || '—';
  if (duration.months % 12 === 0) {
    const years = duration.months / 12;
    return `${years} year${years === 1 ? '' : 's'}`;
  }
  return `${duration.months} months`;
}

export const examSummary = (course: Course): string =>
  course.exams?.length
    ? course.exams
      .map((e) => (e.minScore != null ? `${e.name} ${e.minScore}` : e.note ?? e.name))
      .join(' · ')
    : course.examText || '—';

/* ── Filter groups ───────────────────────────────────────────────────────── */

/**
 * A facet list. Collapses past `visible` entries so a 16-country list does not
 * push everything below it off the screen.
 */
export function FilterGroup({
  title, options, selected, onToggle, labels, visible = 6, searchable,
}: {
  title: string;
  options: Facet[];
  selected: string[];
  onToggle: (value: string) => void;
  labels?: Record<string, string>;
  visible?: number;
  searchable?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');

  const label = (value: string) => labels?.[value] ?? value;
  const matched = query.trim()
    ? options.filter((o) => label(o.value).toLowerCase().includes(query.trim().toLowerCase()))
    : options;
  // A selected option is always drawn, even when it falls past the fold.
  const shown = expanded || query.trim()
    ? matched
    : matched.filter((o, i) => i < visible || selected.includes(o.value));

  if (!options.length) return null;

  return (
    <section className="border-b border-line py-4 first:pt-0 last:border-0">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-t3">{title}</h3>
        {selected.length > 0 && <Badge tone="accent">{selected.length}</Badge>}
      </div>

      {searchable && options.length > 8 && (
        <Input
          size="sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Filter ${title.toLowerCase()}…`}
          aria-label={`Filter ${title}`}
          className="mb-2"
        />
      )}

      <ul className="space-y-0.5">
        {shown.map((option) => (
          <li key={option.value}>
            <Checkbox checked={selected.includes(option.value)} onChange={() => onToggle(option.value)}>
              <span className="min-w-0 flex-1 truncate" title={label(option.value)}>
                {label(option.value)}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-t3">{option.count}</span>
            </Checkbox>
          </li>
        ))}
      </ul>

      {!query.trim() && matched.length > visible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 px-2 text-[12px] font-medium text-accent hover:underline"
        >
          {expanded ? 'Show less' : `Show all ${matched.length}`}
        </button>
      )}
    </section>
  );
}

/** A removable summary of one active filter. */
export function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 py-1 pl-2.5 pr-1.5 text-[12px] font-medium text-accent">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="flex h-4 w-4 items-center justify-center rounded-full hover:bg-accent/20"
      >
        <CloseIcon className="h-3 w-3" />
      </button>
    </span>
  );
}

/** One labelled fact in a detail panel. */
export function DetailRow({
  label, children, className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('hig-row items-start', className)}>
      <span className="w-36 shrink-0 pt-px text-[13px] text-t3">{label}</span>
      <span className="min-w-0 flex-1 text-[14px] text-t1">{children}</span>
    </div>
  );
}
