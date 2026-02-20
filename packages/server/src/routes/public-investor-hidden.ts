/**
 * Public hidden investor content.
 *
 * The static investors.html page fetches this after it obtains an
 * investorAccessToken from /api/public/investor-gate/unlock.
 */

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getInvestorHiddenPayload } from '../lib/investor-hidden-content';

const router = Router();

function getJwtSecret(): string {
  const configured = process.env.JWT_SECRET;
  if (configured && configured.trim().length > 0) return configured;
  if ((process.env.NODE_ENV || 'development') === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  return 'dev-secret-change-me';
}

function requireInvestorAccessToken(req: Request): { signatureId: number; documentId?: number } {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) {
    throw new Error('Missing Authorization header');
  }
  const token = header.slice(7).trim();
  if (!token) throw new Error('Missing token');

  const decoded = jwt.verify(token, getJwtSecret()) as any;
  if (!decoded || decoded.typ !== 'investor_access') throw new Error('Invalid token');
  const signatureId = Number(decoded.signatureId);
  if (!Number.isFinite(signatureId) || signatureId <= 0) throw new Error('Invalid token');
  const documentId = decoded.documentId != null ? Number(decoded.documentId) : undefined;
  return { signatureId, documentId };
}

// GET /api/public/investor-hidden
router.get('/', (req: Request, res: Response) => {
  try {
    // We don't currently use these claims for authorization beyond “valid token”.
    // They exist to support future auditing/rules.
    requireInvestorAccessToken(req);
    res.setHeader('Cache-Control', 'no-store');
    res.json(getInvestorHiddenPayload());
  } catch (err: any) {
    res.status(401).json({ error: err?.message || 'Unauthorized' });
  }
});

export default router;

