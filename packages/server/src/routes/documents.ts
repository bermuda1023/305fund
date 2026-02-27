/**
 * Document upload/download routes.
 * Polymorphic document storage for entities, units, tenants, renovations, LPs, fund.
 */

import { Router, Request, Response } from 'express';
import { createHash, randomBytes } from 'crypto';
import { requireAuth, requireGP } from '../middleware/auth';
import multer from 'multer';
import { deleteStoredFile, saveUploadedBuffer } from '../lib/storage';
import {
  createDocument,
  createSigningLink,
  deleteDocumentById,
  getDocumentById,
  listDocumentsByParent,
} from '../db/repositories/documents-repository';

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
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
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

  try {
    const stored = await saveUploadedBuffer(
      file.buffer,
      'documents',
      file.originalname,
      file.mimetype
    );
    const id = await createDocument({
      parentId: Number(parentId),
      parentType: String(parentType),
      name: file.originalname,
      category: String(category),
      filePath: stored.filePath,
      fileType: file.mimetype,
      requiresSignature: String(requiresSignature).trim().toLowerCase() === 'true' || String(requiresSignature).trim() === '1',
      uploadedBy: (req as any).user?.email || 'unknown',
    });

    res.status(201).json({
      id,
      name: file.originalname,
      filePath: stored.filePath,
      fileType: file.mimetype,
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to store document' });
  }
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
router.post('/:id/signing-link', async (req: Request, res: Response) => {
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

  const doc = await getDocumentById(documentId);
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
  await createSigningLink({
    documentId,
    tokenHash,
    isSingleUse,
    expiresAtIso,
    createdBy: (req as any).user?.email || 'unknown',
  });

  res.json({
    url: buildSigningUrl(rawToken),
    expiresAt: expiresAtIso,
    isSingleUse: !!isSingleUse,
  });
});

// GET /api/documents/:parentType/:parentId — List documents for a parent
router.get('/:parentType/:parentId', async (req: Request, res: Response) => {
  const { parentType, parentId } = req.params;
  const docs = await listDocumentsByParent(String(parentType), Number(parentId));
  res.json(docs);
});

// DELETE /api/documents/:id — Remove document
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const doc = await getDocumentById(Number(id));
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  try {
    await deleteStoredFile(doc.file_path);
    await deleteDocumentById(Number(id));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to delete document file' });
  }
});

export default router;
