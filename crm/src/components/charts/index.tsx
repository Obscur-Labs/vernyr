'use client';

import { useMemo, useState } from 'react';
import {
  Area, AreaChart as ReAreaChart, Bar, BarChart as ReBarChart, CartesianGrid, Cell,
  Line, LineChart as ReLineChart, Pie, PieChart as RePieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardHeader, EmptyState, Skeleton } from '@/components/ui/card';
import { ChartIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

/**
 * The CRM's charts.
 *
 * Recharts does the geometry, responsiveness and hit-testing; this module is
 * the house style on top of it — the palette, the tooltip, the axis formatting
 * and the six shapes the app actually uses. Every one takes the same
 * `{ value, count }` rows the reports API answers with, so a chart can be
 * pointed at a new endpoint without reshaping the data first.
 */

export interface Slice {
  /** The label. Named `value` because that is the key the API returns. */
  value: string;
  count: number;
  /** Overrides the palette — used where a status already has a colour. */
  color?: string;
}

export interface Series {
  name: string;
  points: number[];
  color?: string;
}

const PALETTE = Array.from({ length: 12 }, (_, i) => `var(--chart-${i + 1})`);
export const chartColor = (i: number) => PALETTE[i % PALETTE.length];

const nf = new Intl.NumberFormat('en-US');
export const fmtNumber = (n: number) => nf.format(Math.round(n));

export const fmtCompact = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
    : Math.abs(n) >= 1_000 ? `${(n / 1_000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
      : String(Math.round(n));

/** `visa_approved` → `Visa approved`. Every enum in this app is snake_case. */
export const humanize = (s: string) =>
  s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** `2026-03` → `Mar`, and January carries its year so a 12-month axis reads. */
export function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) return key;
  const name = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'short' });
  return month === 1 ? `${name} '${String(year).slice(2)}` : name;
}

/* ── Frame ───────────────────────────────────────────────────────────────── */

export function ChartCard({
  title, subtitle, action, children, className,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader title={title} subtitle={subtitle} action={action} />
      {children}
    </Card>
  );
}

export const ChartEmpty = ({ label = 'Nothing to chart yet' }: { label?: string }) => (
  <EmptyState icon={<ChartIcon className="h-6 w-6" />} title={label} className="py-12" />
);

export const ChartSkeleton = ({ height = 200 }: { height?: number }) =>
  <Skeleton style={{ height }} />;

/* ── Tooltip ─────────────────────────────────────────────────────────────── */

interface TooltipEntry { name?: string; value?: number; color?: string; payload?: { fill?: string } }

/**
 * One tooltip for every chart. Recharts' default is a white box with inline
 * styles — it ignores the theme entirely and is unreadable on the dark ground.
 */
function ChartTooltip({
  active, payload, label, valueFormat = fmtNumber, labelFormat,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  valueFormat?: (n: number) => string;
  labelFormat?: (s: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const heading = label != null ? (labelFormat ? labelFormat(String(label)) : String(label)) : null;

  return (
    <div className="overlay-panel rounded-xl px-3 py-2 text-[12px] shadow-xl">
      {heading && <p className="mb-1 font-semibold text-t1">{heading}</p>}
      <ul className="space-y-0.5">
        {payload.map((entry, i) => (
          <li key={i} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ background: entry.color ?? entry.payload?.fill }}
            />
            {entry.name && <span className="text-t2">{humanize(String(entry.name))}</span>}
            <span className="ml-auto pl-3 font-semibold tabular-nums text-t1">
              {valueFormat(Number(entry.value ?? 0))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const CURSOR = { fill: 'var(--color-muted)', fillOpacity: 0.45 };

/* ── Legend ──────────────────────────────────────────────────────────────── */

export function Legend({
  slices, total, active, onHover, columns = 1,
}: {
  slices: Slice[];
  total: number;
  active?: number | null;
  onHover?: (i: number | null) => void;
  columns?: 1 | 2;
}) {
  return (
    <ul className={cn('grid gap-x-4 gap-y-1.5', columns === 2 && 'sm:grid-cols-2')}>
      {slices.map((s, i) => (
        <li
          key={s.value}
          onMouseEnter={() => onHover?.(i)}
          onMouseLeave={() => onHover?.(null)}
          className="chart-hit flex items-center gap-2.5 text-[13px]"
          style={{ opacity: active != null && active !== i ? 0.4 : 1 }}
        >
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
            style={{ background: s.color ?? chartColor(i) }}
          />
          <span className="min-w-0 flex-1 truncate text-t2">{humanize(s.value)}</span>
          <span className="shrink-0 font-semibold tabular-nums text-t1">{fmtNumber(s.count)}</span>
          {total > 0 && (
            <span className="w-10 shrink-0 text-right tabular-nums text-t3">
              {Math.round((s.count / total) * 100)}%
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ── Donut ───────────────────────────────────────────────────────────────── */

/**
 * A donut rather than a pie: the hole carries the total, and comparing arc
 * lengths on a ring is easier than comparing wedge areas.
 */
export function DonutChart({
  slices, size = 200, thickness = 26, centerLabel, centerValue, legend = true, legendColumns = 1,
}: {
  slices: Slice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string | number;
  legend?: boolean;
  legendColumns?: 1 | 2;
}) {
  const [active, setActive] = useState<number | null>(null);
  const shown = useMemo(() => slices.filter((s) => s.count > 0), [slices]);
  const total = shown.reduce((n, s) => n + s.count, 0);

  if (!total) return <ChartEmpty />;

  const outer = size / 2;
  const inner = outer - thickness;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <RePieChart width={size} height={size}>
          <Pie
            data={shown}
            dataKey="count"
            nameKey="value"
            cx="50%"
            cy="50%"
            innerRadius={inner}
            outerRadius={outer}
            paddingAngle={shown.length > 1 ? 1.5 : 0}
            startAngle={90}
            endAngle={-270}
            stroke="none"
            onMouseEnter={(_, i) => setActive(i)}
            onMouseLeave={() => setActive(null)}
            isAnimationActive
            animationDuration={700}
          >
            {shown.map((s, i) => (
              <Cell
                key={s.value}
                fill={s.color ?? chartColor(i)}
                fillOpacity={active != null && active !== i ? 0.3 : 1}
                style={{ transition: 'fill-opacity 180ms ease' }}
              />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </RePieChart>

        {/* The hole. Hovering a slice swaps the total for that slice. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[26px] font-bold leading-none tracking-tight text-t1">
            {active != null && shown[active] ? fmtCompact(shown[active].count) : centerValue ?? fmtCompact(total)}
          </span>
          <span className="mt-1 max-w-[70%] truncate text-center text-[11px] font-medium uppercase tracking-wider text-t3">
            {active != null && shown[active] ? humanize(shown[active].value) : centerLabel ?? 'Total'}
          </span>
        </div>
      </div>

      {legend && (
        <div className="min-w-0 flex-1">
          <Legend slices={shown} total={total} active={active} onHover={setActive} columns={legendColumns} />
        </div>
      )}
    </div>
  );
}

/* ── Vertical bars ───────────────────────────────────────────────────────── */

export function BarChart({
  slices, height = 240, monochrome = false, valueFormat = fmtCompact,
}: {
  slices: Slice[];
  height?: number;
  /** One accent for every bar — right when the categories are one dimension. */
  monochrome?: boolean;
  valueFormat?: (n: number) => string;
}) {
  if (!slices.length) return <ChartEmpty />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReBarChart data={slices} margin={{ top: 8, right: 4, bottom: 4, left: -18 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="value"
          tickLine={false}
          axisLine={false}
          interval={0}
          height={44}
          tickFormatter={humanize}
          angle={slices.length > 6 ? -30 : 0}
          textAnchor={slices.length > 6 ? 'end' : 'middle'}
        />
        <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={valueFormat} />
        <Tooltip cursor={CURSOR} content={<ChartTooltip valueFormat={fmtNumber} labelFormat={humanize} />} />
        <Bar dataKey="count" name="count" radius={[6, 6, 0, 0]} animationDuration={650} maxBarSize={54}>
          {slices.map((s, i) => (
            <Cell key={s.value} fill={s.color ?? (monochrome ? 'var(--color-accent)' : chartColor(i))} />
          ))}
        </Bar>
      </ReBarChart>
    </ResponsiveContainer>
  );
}

/* ── Horizontal bars ─────────────────────────────────────────────────────── */

/**
 * For long category names — country and university lists, mostly. Kept as DOM
 * rather than SVG: the labels are the point, and HTML truncates and wraps them
 * far better than an SVG tick can.
 */
export function HBarChart({
  slices, labelWidth = 'w-40', monochrome = false, max: maxOverride,
}: {
  slices: Slice[];
  labelWidth?: string;
  monochrome?: boolean;
  max?: number;
}) {
  if (!slices.length) return <ChartEmpty />;
  const max = maxOverride ?? Math.max(...slices.map((s) => s.count), 1);

  return (
    <ul className="space-y-2">
      {slices.map((s, i) => (
        <li key={s.value} className="flex items-center gap-3">
          <span className={cn(labelWidth, 'shrink-0 truncate text-right text-[12px] text-t2')} title={humanize(s.value)}>
            {humanize(s.value)}
          </span>
          <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="chart-bar-x h-full rounded-full"
              style={{
                width: `${Math.max((s.count / max) * 100, s.count > 0 ? 1.5 : 0)}%`,
                background: s.color ?? (monochrome ? 'var(--color-accent)' : chartColor(i)),
                animationDelay: `${i * 35}ms`,
              }}
            />
          </div>
          <span className="w-12 shrink-0 text-right text-[12px] font-semibold tabular-nums text-t1">
            {fmtCompact(s.count)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ── Line / area ─────────────────────────────────────────────────────────── */

/** Recharts wants rows, not parallel arrays. */
function toRows(labels: string[], series: Series[]) {
  return labels.map((label, i) => {
    const row: Record<string, string | number> = { label };
    for (const s of series) row[s.name] = s.points[i] ?? 0;
    return row;
  });
}

export function LineChart({
  labels, series, area = true, height = 260, valueFormat = fmtCompact, formatLabel = monthLabel,
}: {
  labels: string[];
  series: Series[];
  area?: boolean;
  height?: number;
  valueFormat?: (n: number) => string;
  formatLabel?: (s: string) => string;
}) {
  if (!labels.length || !series.length) return <ChartEmpty />;

  const rows = toRows(labels, series);
  const gradientId = 'chart-fill';
  const Chart = area ? ReAreaChart : ReLineChart;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <Chart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.name} id={`${gradientId}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color ?? chartColor(i)} stopOpacity={0.3} />
              <stop offset="100%" stopColor={s.color ?? chartColor(i)} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>

        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickFormatter={formatLabel}
          minTickGap={16}
        />
        <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={valueFormat} />
        <Tooltip
          cursor={{ stroke: 'var(--color-accent)', strokeDasharray: '3 3', strokeOpacity: 0.7 }}
          content={<ChartTooltip valueFormat={valueFormat} labelFormat={formatLabel} />}
        />

        {series.map((s, i) => {
          const color = s.color ?? chartColor(i);
          return area ? (
            <Area
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={color}
              strokeWidth={2.25}
              fill={`url(#${gradientId}-${i})`}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: color, fill: 'var(--color-surface)' }}
              animationDuration={800}
            />
          ) : (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={color}
              strokeWidth={2.25}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: color, fill: 'var(--color-surface)' }}
              animationDuration={800}
            />
          );
        })}
      </Chart>
    </ResponsiveContainer>
  );
}

/* ── Stacked bar ─────────────────────────────────────────────────────────── */

/** One row that shows composition — a funnel stage, a fee split. */
export function StackedBar({ slices, height = 12 }: { slices: Slice[]; height?: number }) {
  const total = slices.reduce((n, s) => n + s.count, 0);
  if (!total) return <div className="rounded-full bg-muted" style={{ height }} />;

  return (
    <div className="flex overflow-hidden rounded-full bg-muted" style={{ height }}>
      {slices.map((s, i) => (
        s.count > 0 && (
          <div
            key={s.value}
            className="chart-bar-x h-full"
            style={{
              width: `${(s.count / total) * 100}%`,
              background: s.color ?? chartColor(i),
              animationDelay: `${i * 50}ms`,
            }}
            title={`${humanize(s.value)}: ${fmtNumber(s.count)}`}
          />
        )
      ))}
    </div>
  );
}

/* ── Sparkline ───────────────────────────────────────────────────────────── */

/** A trend with no axes — small enough to sit inside a stat tile. */
export function Sparkline({ points, color, width = 96, height = 28 }: {
  points: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;
  const stroke = color ?? 'var(--color-accent)';
  const rows = points.map((v, i) => ({ i, v }));

  return (
    <div style={{ width, height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <ReAreaChart data={rows} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.32} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={stroke}
            strokeWidth={1.75}
            fill="url(#spark-fill)"
            dot={false}
            isAnimationActive={false}
          />
        </ReAreaChart>
      </ResponsiveContainer>
    </div>
  );
}
