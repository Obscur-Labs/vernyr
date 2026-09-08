import type { Response } from 'express';

/**
 * A caught error never goes to the client. Mongoose validation errors carry the
 * whole document, driver errors carry the connection string, and every one of
 * them carries a stack trace pointing at the source tree.
 */
export function serverError(res: Response, err: unknown, message = 'Server error'): void {
  console.error(`[${new Date().toISOString()}] ${message}:`, err);
  if (!res.headersSent) res.status(500).json({ message });
}
