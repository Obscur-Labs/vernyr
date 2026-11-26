import type { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import { authenticate, type AuthRequest } from './auth';
import PortalAccount, { type IPortalAccount } from '../models/PortalAccount';
import University, { type IUniversity } from '../models/University';
import { getSetting } from '../models/Audit';
import { env } from '../config/env';

/** The client's university portal session check (legacy/server/university/auth.js authenticate), on our JWT. */

export interface UniRequest extends AuthRequest { su: IPortalAccount; uni: IUniversity; preview: boolean; previewBy?: string; campuses: string[] }
const stop = (res: Response, status: number, message: string) => { res.status(status).json({ error: message, message }); };
export const ipAllowed = (u: Pick<IUniversity, 'ip_allowlist'>, ip?: string) => {
  const list = String(u.ip_allowlist || '').split(/[\s,]+/).filter(Boolean);
  return !list.length || list.some((x) => String(ip || '').replace('::ffff:', '') === x);
};

export function uniAuth(req: AuthRequest, res: Response, next: NextFunction) {
  authenticate(req, res, async () => {
    try {
      if (req.user?.role !== 'university') { stop(res, 403, 'This is the partner portal'); return; }
      const claims = jwt.decode(req.headers.authorization!.split(' ')[1]) as { pv?: string } | null;
      const preview = !!claims?.pv;
      const su = await PortalAccount.findById(req.user.id);
      if (!su || su.role !== 'university' || (su.status !== 'Active' && !preview)) { stop(res, 401, 'Please log in'); return; }
      const u = su.universityId ? await University.findById(su.universityId) : null;
      if (!u) { stop(res, 401, 'Please log in'); return; }
      if (!preview) {
        if (u.portal_status !== 'Active') { stop(res, 401, 'Your access is paused. Please contact La Europa.'); return; }
        if ((await getSetting('uni_portal_enabled')) === '0') { stop(res, 503, 'The partner portal is temporarily unavailable.'); return; }
        if (!ipAllowed(u, req.ip)) { stop(res, 403, 'Access from this network is not allowed for your institution.'); return; }
      }
      const r = req as UniRequest;
      r.su = su; r.uni = u; r.preview = preview; r.previewBy = claims?.pv; r.campuses = (su.campuses ?? []).map(String);
      if (preview && !['GET', 'HEAD'].includes(req.method)) { stop(res, 403, 'View as university: read only'); return; }
      if (req.headers['x-activity'] !== 'passive' && !preview) await PortalAccount.updateOne({ _id: su._id }, { lastSeenAt: new Date() });
      next();
    } catch (e) { next(e); }
  });
}

export const uniToken = (su: Pick<IPortalAccount, '_id' | 'name'>) => jwt.sign({ id: String(su._id), role: 'university', name: su.name }, env.jwtSecret, { expiresIn: '12h' });
/** La Europa "View as university": a 2-hour read-only token */
export const uniPreviewToken = (suId: unknown, staffId: string) => jwt.sign({ id: String(suId), role: 'university', name: 'preview', pv: staffId }, env.jwtSecret, { expiresIn: '2h' });
