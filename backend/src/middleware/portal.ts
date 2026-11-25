import type { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { authenticate, type AuthRequest } from './auth';
import PortalAccount, { type IPortalAccount } from '../models/PortalAccount';
import { getSetting } from '../models/Audit';
import { loadCtx, type Ctx } from '../services/portalCtx';
import { missing } from '../services/consent';

/** A request from the student portal: the student comes from the token, never from the URL or body (legacy/server/portal/auth.js authenticate). */
export interface PortalRequest extends AuthRequest { su: IPortalAccount; c: Ctx; preview: boolean; previewBy?: string }

const stop = (res: Response, status: number, message: string) => { res.status(status).json({ error: message, message }); };

export function portalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  authenticate(req, res, async () => {
    try {
      if (req.user?.role !== 'student') { stop(res, 403, 'This is the student portal'); return; }
      const su = await PortalAccount.findById(req.user.id);
      if (!su || ['Deactivated', 'Pending verification'].includes(su.status)) { stop(res, 401, 'Please log in'); return; }
      // "View as student": a short token minted by staff, strictly read only
      const claims = jwt.decode(req.headers.authorization!.split(' ')[1]) as { pv?: string } | null;
      const preview = !!claims?.pv;
      if (su.status === 'Locked' && !preview) { stop(res, 401, su.lockReason ? `Your account is locked: ${su.lockReason}` : 'Your account is locked. Please contact La Europa.'); return; }
      if ((await getSetting('portal_enabled')) === '0' && !preview) { stop(res, 503, 'The student portal is temporarily unavailable.'); return; }
      const r = req as PortalRequest;
      r.su = su; r.preview = preview; r.previewBy = claims?.pv; r.c = await loadCtx(su);
      if (preview && !['GET', 'HEAD'].includes(req.method)) { stop(res, 403, 'Preview mode: read only'); return; }
      // the Student Declaration & Consent must be signed first: only reading, consent, privacy and ping stay open
      if (!preview && !['GET', 'HEAD'].includes(req.method) && !/^\/(consent|privacy|ping)/.test(req.path) && (await missing(su._id)).length) {
        res.status(428).json({ error: 'Please read and sign the Student Declaration & Consent first.', message: 'Please read and sign the Student Declaration & Consent first.' }); return;
      }
      if (req.headers['x-activity'] !== 'passive') await PortalAccount.updateOne({ _id: su._id }, { lastSeenAt: new Date() });
      next();
    } catch (e) { next(e); }
  });
}

/** Staff "view as student": a 2-hour read-only portal token. */
export const previewToken = (suId: unknown, staffId: string) => jwt.sign({ id: String(suId), role: 'student', name: 'preview', pv: staffId }, env.jwtSecret, { expiresIn: '2h' });
