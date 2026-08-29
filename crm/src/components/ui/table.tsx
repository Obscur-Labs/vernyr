'use client';

import { cn } from '@/lib/utils';

/**
 * A data table.
 *
 * Thin on purpose — it owns the row rhythm, the hairlines and the horizontal
 * scroll container, and nothing else. Sorting, selection and paging differ per
 * screen, so they stay with the screen; what was worth sharing is the part
 * every table got subtly wrong on its own.
 */

export function Table({
  columns, minWidth = 720, children, className,
}: {
  /** Header labels. An empty string is an unlabelled action column. */
  columns: string[];
  minWidth?: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('overflow-hidden rounded-2xl border border-line bg-surface', className)}>
      {/* Wide tables scroll inside their own card, never the page. */}
      <div className="overflow-x-auto">
        <table className="w-full" style={{ minWidth }}>
          <thead>
            <tr className="border-b border-line">
              {columns.map((label, i) => (
                <th
                  key={label || `col-${i}`}
                  className={cn(
                    'px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wider text-t2',
                    !label && 'sr-only-header',
                  )}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn('border-b border-line transition-colors last:border-0 hover:bg-muted/50', className)}
      {...props}
    />
  );
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-3 text-[14px] text-t2', className)} {...props} />;
}

/** The row that stands in for a table with nothing in it. */
export function TableEmpty({ columns, children }: { columns: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={columns} className="py-12 text-center text-[15px] text-t3">
        {children}
      </td>
    </tr>
  );
}

/**
 * Loading rows that keep the table's own geometry, so the header does not jump
 * when the data lands. Widths vary per cell to read as text rather than bars.
 */
export function TableSkeleton({ rows, columns }: { rows: number; columns: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-line/50 last:border-0">
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <span
                className="block h-3 rounded bg-muted motion-safe:animate-pulse"
                style={{ width: `${40 + ((r + c) % 4) * 15}%` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** The circle of initials that identifies a person in a row. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[11px] font-bold text-accent',
        className,
      )}
    >
      {initials}
    </span>
  );
}
