/**
 * Mongo reports a unique-index collision as a bare E11000. Surfacing that
 * verbatim is both a 500 for what is really a bad request and a leak of the
 * driver's internals, so translate it into something a form can display.
 */
const FIELD_LABELS: Record<string, string> = {
  username: 'That username is already taken',
  email: 'An account with this email already exists',
};

export function duplicateKeyMessage(err: unknown): string | null {
  const e = err as { code?: number; keyPattern?: Record<string, unknown> };
  if (e?.code !== 11000) return null;
  const field = Object.keys(e.keyPattern ?? {})[0];
  return FIELD_LABELS[field] ?? `${field ?? 'That value'} is already in use`;
}

/** Mongoose validation errors carry the message we wrote in the schema. */
export function validationMessage(err: unknown): string | null {
  const e = err as { name?: string; message?: string; errors?: Record<string, { message?: string }> };
  if (e?.name !== 'ValidationError') return null;
  const first = Object.values(e.errors ?? {})[0]?.message;
  return first ?? e.message ?? 'Validation failed';
}

/** 409 for a collision, 400 for bad input, null when it is a genuine 500. */
export function clientError(err: unknown): { status: number; message: string } | null {
  const dup = duplicateKeyMessage(err);
  if (dup) return { status: 409, message: dup };
  const invalid = validationMessage(err);
  if (invalid) return { status: 400, message: invalid };
  if (err instanceof Error && err.message.startsWith('A username is required')) return { status: 400, message: err.message };
  if (err instanceof Error && err.message.startsWith('Admin accounts sign in')) return { status: 400, message: err.message };
  return null;
}
