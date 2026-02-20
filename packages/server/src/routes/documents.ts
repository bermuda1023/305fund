/**
 * Document upload/download routes.
 * Polymorphic document storage for entities, units, tenants, renovations, LPs, fund.
 */

import { Router, Request, Response } from 'express';
import { createHash, randomBytes } from 'crypto';
import { getDb } from '../db/database';
import { requireAuth, requireGP } from '../middleware/auth';
import multer from 'multer';
import { deleteStoredFile, saveUploadedBuffer } from '../lib/storage';

const router = Router();
router.use(requireAuth, requireGP);

const ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'text/csv',
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  },
});

// POST /api/documents/upload — Upload a document
router.post('/upload', upload.single('file'), (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const { parentType, parentId, category = 'general', requiresSignature = false } = req.body;

  if (!parentType || !parentId) {
    res.status(400).json({ error: 'parentType and parentId are required' });
    return;
  }

  const validTypes = ['entity', 'unit', 'tenant', 'renovation', 'lp', 'fund'];
  if (!validTypes.includes(parentType)) {
    res.status(400).json({ error: `Invalid parentType. Use: ${validTypes.join(', ')}` });
    return;
  }

  const db = getDb();
  (async () => {
    const stored = await saveUploadedBuffer(
      file.buffer,
      'documents',
      file.originalname,
      file.mimetype
    );
    const result = db.prepare(`
      INSERT INTO documents (parent_id, parent_type, name, category, file_path, file_type, requires_signature, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      parentId,
      parentType,
      file.originalname,
      category,
      stored.filePath,
      file.mimetype,
      requiresSignature ? 1 : 0,
      (req as any).user?.email || 'unknown'
    );

    res.status(201).json({
      id: result.lastInsertRowid,
      name: file.originalname,
      filePath: stored.filePath,
      fileType: file.mimetype,
    });
  })().catch((error: any) => {
    res.status(500).json({ error: error?.message || 'Failed to store document' });
  });
});

function sha256Hex(input: Buffer | string): string {
  // TS/Node typings can disagree on Buffer's ArrayBufferLike; cast to keep runtime correct.
  return createHash('sha256').update(input as any).digest('hex');
}

function buildSigningUrl(token: string) {
  const base = String(process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0]?.trim() || 'http://localhost:5173';
  const normalizedBase = base.replace(/\/+$/, '');
  return `${normalizedBase}/sign/${encodeURIComponent(token)}`;
}

// POST /api/documents/:id/signing-link — Create a public signing link (GP only)
router.post('/:id/signing-link', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const documentId = Number(id);
  if (!Number.isFinite(documentId) || documentId <= 0) {
    res.status(400).json({ error: 'Invalid document id' });
    return;
  }

  const isSingleUse = req.body?.isSingleUse === false ? 0 : 1;
  const expiresInDaysRaw = req.body?.expiresInDays;
  const expiresInDays = expiresInDaysRaw == null ? 14 : Number(expiresInDaysRaw);
  if (!Number.isFinite(expiresInDays) || expiresInDays < 1 || expiresInDays > 365) {
    res.status(400).json({ error: 'expiresInDays must be between 1 and 365' });
    return;
  }

  const doc = db.prepare(
    `SELECT id, name, file_type, requires_signature FROM documents WHERE id = ? LIMIT 1`
  ).get(documentId) as any;
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }
  if (!doc.requires_signature) {
    res.status(400).json({ error: 'Document does not require signature' });
    return;
  }
  if (!String(doc.file_type || '').includes('pdf')) {
    res.status(400).json({ error: 'Only PDF documents can be signed' });
    return;
  }

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = sha256Hex(rawToken);
  const expiresAtIso = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO document_signing_links (document_id, token_hash, is_single_use, expires_at, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    documentId,
    tokenHash,
    isSingleUse,
    expiresAtIso,
    (req as any).user?.email || 'unknown'
  );

  res.json({
    url: buildSigningUrl(rawToken),
    expiresAt: expiresAtIso,
    isSingleUse: !!isSingleUse,
  });
});

// GET /api/documents/:parentType/:parentId — List documents for a parent
router.get('/:parentType/:parentId', (req: Request, res: Response) => {
  const db = getDb();
  const { parentType, parentId } = req.params;

  const docs = db.prepare(
    'SELECT * FROM documents WHERE parent_type = ? AND parent_id = ? ORDER BY uploaded_at DESC'
  ).all(parentType, parentId);

  res.json(docs);
});

// DELETE /api/documents/:id — Remove document
router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;

  const doc = db.prepare('SELECT file_path FROM documents WHERE id = ?').get(id) as any;
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  (async () => {
    await deleteStoredFile(doc.file_path);
    db.prepare('DELETE FROM documents WHERE id = ?').run(id);
    res.json({ success: true });
  })().catch((error: any) => {
    res.status(500).json({ error: error?.message || 'Failed to delete document file' });
  });
});

export default router;
