/**
 * Document upload/download routes.
 * Polymorphic document storage for entities, units, tenants, renovations, LPs, fund.
 */

import { Router, Request, Response } from 'express';
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
