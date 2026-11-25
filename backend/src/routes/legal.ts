import { Router } from 'express';
import { handle, notFound } from '../services/crm';
import { publicDoc, current } from '../services/consent';
import { documentPdf } from '../services/legalPdf';
import { verify } from '../services/signing';

/** Public legal routes (legacy/server/portal/auth.js /legal and legal/verify): the current website documents, their PDF, and the check of a signed Document ID. */
const router = Router();
const PUBLIC = ['constitution', 'web_privacy', 'web_refund', 'web_cookies', 'student_consent'];

router.get('/verify', handle(async (req, res) => res.json(await verify(req.query.id, req.query.hash))));
router.get('/:type.pdf', handle(async (req, res) => {
  if (!PUBLIC.includes(req.params.type)) throw notFound('Document');
  const d = await current(req.params.type);
  if (!d) throw notFound('Document');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="La-Europa-${req.params.type}-v${d.version}.pdf"`);
  res.send(await documentPdf(d));
}));
router.get('/:type', handle(async (req, res) => {
  if (!PUBLIC.includes(req.params.type)) throw notFound('Document');
  const d = await publicDoc(req.params.type);
  if (!d) throw notFound('Document');
  res.json(d);
}));

export default router;
