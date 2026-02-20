/**
 * Public investor gate: exchange NDA proof + shared password for an access token.
 *
 * This is designed for a separately-hosted static site (investors.html) which
 * uses the returned JWT as a Bearer token to fetch truly-hidden content from
 * this API (instead of embedding it in the HTML source).
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = Router();

function getJwtSecret(): string {
  const configured = process.env.JWT_SECRET;
  if (configured && configured.trim().length > 0) return configured;
  if ((process.env.NODE_ENV || 'development') === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  return 'dev-secret-change-me';
}

function getInvestorGateHash(): string {
  const hash = String(process.env.INVESTOR_GATE_PASSWORD_HASH || '').trim();
  if (!hash) {
    if ((process.env.NODE_ENV || 'development') !== 'production') {
      // Dev convenience: allow a shared password without env setup.
      // In production, we require a bcrypt hash in env.
      return '';
    }
    throw new Error('INVESTOR_GATE_PASSWORD_HASH is not configured');
  }
  return hash;
}

function getInvestorTargetUrl(): string {
  return String(process.env.INVESTOR_TARGET_URL || 'https://305opportunityfund.com/investor-site/investors.html#opportunity').trim();
}

function verifyNdaProofToken(ndaProofToken: string): { signatureId: number; documentId?: number } {
  const decoded = jwt.verify(ndaProofToken, getJwtSecret()) as any;
  if (!decoded || decoded.typ !== 'nda_proof') throw new Error('Invalid ndaProofToken');
  const signatureId = Number(decoded.signatureId);
  if (!Number.isFinite(signatureId) || signatureId <= 0) throw new Error('Invalid ndaProofToken');
  const documentId = decoded.documentId != null ? Number(decoded.documentId) : undefined;
  return { signatureId, documentId };
}

const unlockLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 25,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again shortly.' },
});

// POST /api/public/investor-gate/unlock
// Body: { password, ndaProofToken }
router.post('/unlock', unlockLimiter, (req: Request, res: Response) => {
  const password = String(req.body?.password || '');
  const ndaProofToken = String(req.body?.ndaProofToken || '');
  if (!password) return res.status(400).json({ error: 'password is required' });
  if (!ndaProofToken) return res.status(400).json({ error: 'ndaProofToken is required' });

  try {
    const { signatureId, documentId } = verifyNdaProofToken(ndaProofToken);
    const hash = getInvestorGateHash();
    const ok = hash ? bcrypt.compareSync(password, hash) : password === 'admin';
    if (!ok) return res.status(401).json({ error: 'Invalid password' });

    const investorAccessToken = jwt.sign(
      {
        typ: 'investor_access',
        signatureId,
        ...(documentId != null ? { documentId } : {}),
      },
      getJwtSecret(),
      { expiresIn: '2h' }
    );

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      investorAccessToken,
      investorTargetUrl: getInvestorTargetUrl(),
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Unlock failed' });
  }
});

export default router;

