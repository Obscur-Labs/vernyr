import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { Action } from '../config/modules';
import { allows, loadPrincipal, type Principal } from '../services/access';

export interface AuthRequest extends Request {
  user?: { id: string; role: string; name: string };
  /** The caller's resolved seat — preset, overrides and all. Set by `authenticate`. */
  principal?: Principal;
}

/** Verifies the token, then loads the caller's live record. */
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    res.status(401).json({ message: 'No token provided' });
    return;
  }

  let decoded: { id: string; role: string; name: string };
  try {
    decoded = jwt.verify(token, env.jwtSecret) as typeof decoded;
  } catch {
    res.status(401).json({ message: 'Invalid token' });
    return;
  }

  try {
    const principal = await loadPrincipal(decoded.id);
    if (!principal) {
      res.status(401).json({ message: 'Account no longer exists' });
      return;
    }
    if (!principal.isActive) {
      res.status(403).json({ message: 'This account has been deactivated' });
      return;
    }

    // `role` comes from the record rather than the token, so a role change
    // takes effect without the holder having to sign in again.
    req.user = { id: principal.id, role: principal.role, name: principal.name };
    req.principal = principal;
    next();
  } catch (err) {
    res.status(500).json({ message: 'Could not verify access', error: err });
  }
}

/** Role gate. */
export function authorize(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ message: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

/** Does this caller hold `action` on `module`? For inline branching. */
export const may = (req: AuthRequest, module: string, action: Action): boolean =>
  !!req.principal && allows(req.principal.permissions, module, action);

/** Route gate: `router.post('/', authenticate, can('leads', 'create'), handler)`. */
export function can(module: string, action: Action) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.principal) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }
    if (!allows(req.principal.permissions, module, action)) {
      res.status(403).json({
        message: `Your role does not allow this`,
        detail: { module, action, preset: req.principal.presetName },
      });
      return;
    }
    next();
  };
}
