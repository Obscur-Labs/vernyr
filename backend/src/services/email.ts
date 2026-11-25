import type { AuthRequest } from '../middleware/auth';

/**
 * The client's trigger emails (E01 to E49): S.fire(req, code, target, ctx, what) in legacy/server/services.js.
 * Every place that sends one already calls fire(); the queue, templates, threading and the hard CC arrive with the
 * email engine port (PORTING.md), which replaces this body. Until then nothing is sent and the call returns null.
 */
export async function fire(
  _req: AuthRequest, _code: string, _target: { student_id?: unknown; lead_id?: unknown },
  _ctx: Record<string, unknown>, _what: string,
): Promise<{ id: string; status: string } | null> {
  return null;
}

/** A simple HTML list for email placeholders (legacy email.ul). */
export const ul = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '');
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
