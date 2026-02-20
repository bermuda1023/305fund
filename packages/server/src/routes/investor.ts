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
import { sendTransactionalEmail } from '../lib/email';

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

type InvestorFullAccessPayload = {
  kind: 'investor_full_access';
  submissionId?: string;
  email?: string;
};

function getInvestorFullAccessSecret(): string {
  // Separate secret from the main app auth token, since this is a public-facing flow.
  const configured = process.env.INVESTOR_FULL_ACCESS_SECRET;
  if (configured && configured.trim().length > 0) return configured;
  if ((process.env.NODE_ENV || 'development') === 'production') {
    throw new Error('INVESTOR_FULL_ACCESS_SECRET is required in production');
  }
  return 'dev-investor-full-access-secret-change-me';
}

function signInvestorFullAccessToken(args: { submissionId?: string; email?: string }): string {
  const payload: InvestorFullAccessPayload = {
    kind: 'investor_full_access',
    submissionId: args.submissionId,
    email: args.email,
  };
  return jwt.sign(payload, getInvestorFullAccessSecret(), { expiresIn: '30d' });
}

function verifyInvestorFullAccessToken(token: string): InvestorFullAccessPayload {
  const decoded = jwt.verify(token, getInvestorFullAccessSecret()) as any;
  if (!decoded || decoded.kind !== 'investor_full_access') throw new Error('Invalid token');
  return decoded as InvestorFullAccessPayload;
}

function firstClientUrl(): string {
  const raw = String(process.env.CLIENT_URL || '').trim();
  const first = raw.split(',').map((s) => s.trim()).filter(Boolean)[0];
  return first || 'http://localhost:5173';
}

function looksLikeEmail(v: unknown): v is string {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function findFirstEmail(obj: any): string | null {
  if (!obj) return null;
  if (looksLikeEmail(obj)) return obj.trim();
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const found = findFirstEmail(v);
      if (found) return found;
    }
    return null;
  }
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const found = findFirstEmail(obj[k]);
      if (found) return found;
    }
  }
  return null;
}

function looksLikeName(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (s.length < 2) return false;
  if (s.length > 80) return false;
  if (s.includes('http://') || s.includes('https://')) return false;
  return /[a-zA-Z]/.test(s) && (s.includes(' ') || s.includes(','));
}

function findFirstName(obj: any): string | null {
  if (!obj) return null;
  if (looksLikeName(obj)) return String(obj).trim();

  if (Array.isArray(obj)) {
    for (const v of obj) {
      const found = findFirstName(v);
      if (found) return found;
    }
    return null;
  }

  if (typeof obj === 'object') {
    // Prefer structured { first, last } patterns if present.
    const firstRaw = obj.first || obj.firstName || obj.firstname;
    const lastRaw = obj.last || obj.lastName || obj.lastname;
    const first = typeof firstRaw === 'string' ? firstRaw.trim() : '';
    const last = typeof lastRaw === 'string' ? lastRaw.trim() : '';
    if (first && last) return `${first} ${last}`.trim();
    if (first && looksLikeName(first)) return first;

    for (const k of Object.keys(obj)) {
      const found = findFirstName(obj[k]);
      if (found) return found;
    }
  }

  return null;
}

function requireWebhookSecret(req: Request, res: Response): boolean {
  const expected = String(process.env.JOTFORM_WEBHOOK_SECRET || '').trim();
  if (!expected) {
    // Safety: don't accept unauthenticated external webhooks in production.
    if ((process.env.NODE_ENV || 'development') === 'production') {
      res.status(500).json({ error: 'Webhook not configured (missing JOTFORM_WEBHOOK_SECRET)' });
      return false;
    }
    return true;
  }
  const provided = String(req.query.secret || '').trim();
  if (!provided || provided !== expected) {
    res.status(401).json({ error: 'Invalid webhook secret' });
    return false;
  }
  return true;
}

function parseNotifyEmails(): string[] {
  // Comma-separated list: "a@b.com,c@d.com"
  return String(process.env.INVESTOR_NDA_NOTIFY_EMAILS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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

// POST /api/investor/nda/webhook?secret=...
// Jotform will call this when a signature/completion event occurs.
// We respond 200 quickly, and (optionally) email a magic link to the signer.
router.post('/nda/webhook', async (req: Request, res: Response) => {
  if (!requireWebhookSecret(req, res)) return;

  const submissionId = String((req.body && (req.body.submissionID || req.body.submissionId)) || '').trim();
  const rawRequest = (req.body && (req.body.rawRequest || req.body.raw_request)) ?? null;

  let parsed: any = null;
  try {
    if (typeof rawRequest === 'string' && rawRequest.trim().length > 0) parsed = JSON.parse(rawRequest);
  } catch {
    parsed = null;
  }

  const signerEmail =
    looksLikeEmail(req.body?.email) ? String(req.body.email).trim()
      : findFirstEmail(parsed);

  const signerName =
    typeof req.body?.name === 'string' && req.body.name.trim()
      ? String(req.body.name).trim()
      : findFirstName(parsed);

  const token = signInvestorFullAccessToken({
    submissionId: submissionId || undefined,
    email: signerEmail || undefined,
  });
  const base = firstClientUrl().replace(/\/$/, '');
  const link = `${base}/investor-site/investors.html?fullToken=${encodeURIComponent(token)}`;

  // If we have an email, try to send them the link.
  let emailed = false;
  if (signerEmail) {
    try {
      emailed = await sendTransactionalEmail({
        to: signerEmail,
        subject: 'Investor Room Access',
        text: `Thanks — your NDA is complete.\n\nAccess the full diligence site here:\n${link}\n\nIf you did not request this, you can ignore this email.`,
      });
    } catch {
      emailed = false;
    }
  }

  // Notify internal recipients (if configured) with signer info.
  const notifyEmails = parseNotifyEmails();
  let notified = false;
  if (notifyEmails.length > 0) {
    try {
      const [to, ...bcc] = notifyEmails;
      notified = await sendTransactionalEmail({
        to,
        bcc: bcc.length > 0 ? bcc : undefined,
        subject: 'NDA signed (Jotform)',
        text:
          `An NDA was signed.\n\n`
          + `Signer name: ${signerName || '(unknown)'}\n`
          + `Signer email: ${signerEmail || '(unknown)'}\n`
          + `Submission ID: ${submissionId || '(unknown)'}\n\n`
          + `Magic link (full diligence):\n${link}\n`,
      });
    } catch {
      notified = false;
    }
  }

  res.json({
    ok: true,
    emailed,
    notified,
    signer: {
      name: signerName || null,
      email: signerEmail || null,
    },
    submissionId: submissionId || null,
    link,
  });
});

// GET /api/investor/nda/verify?token=...
// Used by the static investor site to validate magic links.
router.get('/nda/verify', (req: Request, res: Response) => {
  const token = String(req.query.token || '').trim();
  if (!token) {
    res.status(400).json({ error: 'Missing token' });
    return;
  }
  try {
    const decoded = verifyInvestorFullAccessToken(token);
    res.json({ ok: true, kind: decoded.kind, email: decoded.email || null, submissionId: decoded.submissionId || null });
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
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

