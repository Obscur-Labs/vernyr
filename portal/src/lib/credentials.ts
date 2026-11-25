/** Mirrors backend/src/models/User.ts — every staff member signs in with a username. */
export const EMAIL_LOGIN_ROLES: string[] = []; // every staff member signs in with a username

export const usesEmailLogin = (role: string) => EMAIL_LOGIN_ROLES.includes(role);

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** What this account actually types into the sign-in field. */
export const loginHandle = (user: { username?: string; email?: string }) =>
  user.username ?? user.email ?? '—';
