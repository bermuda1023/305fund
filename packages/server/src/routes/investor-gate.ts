/**
 * Public investor gate: exchange NDA proof + signer-specific access code for an access token.
 *
 * This is designed for a separately-hosted static site (investors.html) which
 * uses the returned JWT as a Bearer token to fetch truly-hidden content from
 * this API (instead of embedding it in the HTML source).
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/database';

const router = Router();

function logGateAttempt(input: { signatureId?: number; ip: string; userAgent: string; success: boolean; reason: string }) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO investor_gate_attempts (signature_id, ip, user_agent, success, reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      input.signatureId || null,
      input.ip || null,
      input.userAgent || null,
      input.success ? 1 : 0,
      input.reason || null
    );
  } catch {
    // do not block unlock on logging failures
  }
}

function getJwtSecret(): string {
  const configured = process.env.JWT_SECRET;
  if (configured && configured.trim().length > 0) return configured;
  if ((process.env.NODE_ENV || 'development') === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  return 'dev-secret-change-me';
}

function getInvestorGateSecrets(): { hash: string; plain: string } {
  const hash = String(process.env.INVESTOR_GATE_PASSWORD_HASH || '').trim();
  const plain = String(process.env.INVESTOR_GATE_PASSWORD || '').trim();
  if (!hash && !plain) {
    if ((process.env.NODE_ENV || 'development') !== 'production') {
      // Dev convenience: allow a shared password without env setup.
      return { hash: '', plain: '' };
    }
    throw new Error('INVESTOR_GATE_PASSWORD_HASH or INVESTOR_GATE_PASSWORD must be configured');
  }
  return { hash, plain };
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
    const ip = String(req.ip || '');
    const userAgent = String(req.get('user-agent') || '');
    const db = getDb();
    const sigRow = db.prepare(
      `SELECT investor_gate_password_hash, investor_gate_password_expires_at
       FROM document_signatures
       WHERE id = ?
       LIMIT 1`
    ).get(signatureId) as
      | {
          investor_gate_password_hash?: string | null;
          investor_gate_password_expires_at?: string | null;
        }
      | undefined;
    if (!sigRow) return res.status(400).json({ error: 'Invalid ndaProofToken' });

    const perSignerHash = String(sigRow.investor_gate_password_hash || '').trim();
    const expiresAtRaw = String(sigRow.investor_gate_password_expires_at || '').trim();
    if (expiresAtRaw) {
      const expiresAtMs = new Date(expiresAtRaw).getTime();
      if (Number.isFinite(expiresAtMs) && expiresAtMs < Date.now()) {
        logGateAttempt({ signatureId, ip, userAgent, success: false, reason: 'code_expired' });
        return res.status(401).json({ error: 'This access code has expired' });
      }
    }

    const { hash, plain } = getInvestorGateSecrets();
    // Backward compatibility for signatures created before per-signer access codes.
    const ok = perSignerHash
      ? bcrypt.compareSync(password, perSignerHash)
      : hash
        ? bcrypt.compareSync(password, hash)
        : plain
          ? password === plain
          : password === 'admin';
    if (!ok) {
      logGateAttempt({ signatureId, ip, userAgent, success: false, reason: 'invalid_password' });
      return res.status(401).json({ error: 'Invalid password' });
    }

    const investorAccessToken = jwt.sign(
      {
        typ: 'investor_access',
        signatureId,
        ...(documentId != null ? { documentId } : {}),
      },
      getJwtSecret(),
      { expiresIn: '2h' }
    );

    logGateAttempt({ signatureId, ip, userAgent, success: true, reason: 'unlock_success' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      investorAccessToken,
      investorTargetUrl: getInvestorTargetUrl(),
    });
  } catch (err: any) {
    logGateAttempt({
      ip: String(req.ip || ''),
      userAgent: String(req.get('user-agent') || ''),
      success: false,
      reason: String(err?.message || 'unlock_failed'),
    });
    res.status(400).json({ error: err?.message || 'Unlock failed' });
  }
});

export default router;

