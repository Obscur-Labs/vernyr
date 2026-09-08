/**
 * A query-string value is a string or an array of them — until someone sends
 * `?studentId[$ne]=`, at which point Express hands the route an object and the
 * filter it lands in stops meaning what it says.
 */
export function scalar(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return scalar(value[0]);
  return undefined;
}

/** The same, restricted to a known set — enum filters take nothing else. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  const s = scalar(value);
  return s && (allowed as readonly string[]).includes(s) ? (s as T) : undefined;
}
