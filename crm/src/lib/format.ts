/**
 * Formatting the whole CRM agrees on.
 *
 * There were three `timeAgo` implementations before this — one in the
 * notification bell, one on portal accounts, one in the dev console — and they
 * disagreed on when to give up and print a date.
 */

/**
 * "just now", "12m", "3h", "5d", then a plain date.
 *
 * `suffix` adds "ago", which reads better in a log where the column is a
 * timestamp and worse in a feed where the row is obviously recent.
 */
export function timeAgo(iso: string, { suffix = false }: { suffix?: boolean } = {}): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '—';

  const mins = Math.round(ms / 60000);
  const tail = suffix ? ' ago' : '';

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m${tail}`;
  if (mins < 1440) return `${Math.round(mins / 60)}h${tail}`;
  if (mins < 10080) return `${Math.round(mins / 1440)}d${tail}`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** The full stamp, for a `title` attribute over a relative one. */
export const fullDate = (iso: string) => new Date(iso).toLocaleString();
