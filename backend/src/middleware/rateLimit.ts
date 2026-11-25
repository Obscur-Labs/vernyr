import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/**
 * Nothing in front of the API counted attempts, so a password could be guessed
 * at whatever rate the network allowed.
 *
 * Keyed on IP plus the credential being tried, so one attacker hammering a
 * single account cannot also lock every other user out from that address.
 */

const credentialKey = (req: { ip?: string; body?: Record<string, unknown> }) => {
  const b = req.body ?? {};
  const who = b.identifier ?? b.username ?? b.email ?? '';
  return `${ipKeyGenerator(req.ip ?? '')}:${String(who).toLowerCase().slice(0, 64)}`;
};

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: credentialKey,
  skipSuccessfulRequests: true,
  message: { message: 'Too many attempts. Try again in a few minutes.' },
});

/** Self-registration is open to the internet — cap how fast accounts appear. */
export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many sign-up attempts. Try again later.' },
});

/** The username checker answers whether an account exists; it must not be free. */
export const lookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Slow down.' },
});

/** A backstop for everything else. Generous — the chat polls, the lists refresh. */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many requests.' },
});
