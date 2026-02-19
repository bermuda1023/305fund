/**
 * Investor data room routes.
 *
 * This is intentionally separate from GP/LP user auth:
 * - Prospects authenticate with a shared password (no user account needed)
 * - Server issues a short-lived JWT with kind='investor_room'
 * - Only fund-level documents are exposed here (parent_type='fund')
 */

import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/database';
import { readStoredFile } from '../lib/storage';

const router = Router();

type InvestorTokenPayload = {
  kind: 'investor_room';
  role: 'investor';
};

function getJwtSecret(): string {
  const configured = process.env.JWT_SECRET;
  if (configured && configured.trim().length > 0) return configured;
  if ((process.env.NODE_ENV || 'development') === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  return 'dev-secret-change-me';
}

function signInvestorToken(): string {
  const payload: InvestorTokenPayload = { kind: 'investor_room', role: 'investor' };
  // jsonwebtoken's TS type uses a narrow template-literal for string durations ("7d", "12h", ...).
  // Treat env as trusted config and cast to the library type.
  const expiresIn = (process.env.INVESTOR_ROOM_TOKEN_TTL || '7d') as jwt.SignOptions['expiresIn'];
  return jwt.sign(payload, getJwtSecret(), { expiresIn });
}

function requireInvestorRoom(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    const token = header.slice(7);
    const decoded = jwt.verify(token, getJwtSecret()) as any;
    if (!decoded || decoded.kind !== 'investor_room' || decoded.role !== 'investor') {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// POST /api/investor/login - Shared-password access
router.post('/login', (req: Request, res: Response) => {
  const configuredPassword = String(process.env.INVESTOR_ROOM_PASSWORD || '').trim();
  if (!configuredPassword) {
    res.status(500).json({ error: 'Investor room not configured (missing INVESTOR_ROOM_PASSWORD)' });
    return;
  }
  const password = String(req.body?.password || '');
  if (password !== configuredPassword) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }
  res.json({ token: signInvestorToken() });
});

// GET /api/investor/me - Token validation
router.get('/me', requireInvestorRoom, (req: Request, res: Response) => {
  res.json({ role: 'investor', kind: 'investor_room' });
});

// GET /api/investor/documents - Fund documents for prospects
router.get('/documents', requireInvestorRoom, (req: Request, res: Response) => {
  const db = getDb();
  const docs = db.prepare(`
    SELECT id, parent_id, parent_type, name, category, file_path, file_type, uploaded_at, requires_signature, signed_at, uploaded_by
    FROM documents
    WHERE parent_type = 'fund'
    ORDER BY uploaded_at DESC
  `).all();
  res.json(docs);
});

// GET /api/investor/documents/:id/download - Download fund doc
router.get('/documents/:id/download', requireInvestorRoom, async (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'Invalid document id' });
    return;
  }
  const doc = db.prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as any;
  if (!doc || doc.parent_type !== 'fund') {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  try {
    const file = await readStoredFile(String(doc.file_path));
    res.setHeader('Content-Type', file.contentType || doc.file_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${String(doc.name || 'document').replace(/"/g, '')}"`);
    file.body.pipe(res);
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

export default router;

