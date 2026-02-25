/**
 * Public helper to start the investor NDA signing flow without using the GP upload workflow.
 *
 * Supports either:
 * - `INVESTOR_NDA_STORAGE_KEY` (preferred, for S3/R2-backed deployments), or
 * - `INVESTOR_NDA_PDF_PATH` (local filesystem path fallback).
 *
 * The server will:
 * - ensure a `documents` row exists for the NDA (category 'nda', parent_type 'fund', parent_id 0)
 * - create a reusable signing link
 * - return a signing URL (e.g. http://localhost:5173/sign/<token>)
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { createHash, randomBytes } from 'crypto';
import { Readable } from 'stream';
import { getDb } from '../db/database';
import { readStoredFile, saveUploadedBuffer } from '../lib/storage';

const router = Router();

function sha256Hex(input: Buffer | string): string {
  return createHash('sha256').update(input as any).digest('hex');
}

function buildSigningUrl(token: string) {
  const base = String(process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0]?.trim() || 'http://localhost:5173';
  const normalizedBase = base.replace(/\/+$/, '');
  return `${normalizedBase}/sign/${encodeURIComponent(token)}`;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: any[] = [];
  return await new Promise((resolve, reject) => {
    stream.on('data', (c) => {
      if (c instanceof Uint8Array) chunks.push(c);
      else chunks.push(Buffer.from(c));
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function readConfiguredInvestorNda(): Promise<{ bytes: Buffer; filename: string }> {
  const storageKey = String(process.env.INVESTOR_NDA_STORAGE_KEY || '').trim();
  if (storageKey) {
    const fromStorage = await readStoredFile(storageKey);
    if (!(fromStorage.body instanceof Readable)) {
      throw new Error('INVESTOR_NDA_STORAGE_KEY resolved to non-readable body');
    }
    const bytes = await streamToBuffer(fromStorage.body);
    const filename = path.basename(storageKey) || 'nda.pdf';
    return { bytes, filename };
  }

  const configuredPath = String(process.env.INVESTOR_NDA_PDF_PATH || '').trim();
  if (!configuredPath) {
    throw new Error('INVESTOR_NDA_STORAGE_KEY or INVESTOR_NDA_PDF_PATH must be configured');
  }
  if (!fs.existsSync(configuredPath)) {
    throw new Error(`INVESTOR_NDA_PDF_PATH not found: ${configuredPath}`);
  }
  const bytes = fs.readFileSync(configuredPath);
  const filename = path.basename(configuredPath) || 'nda.pdf';
  return { bytes, filename };
}

function configuredNdaStorageFilePath(): { filePath: string; filename: string } | null {
  const storageKey = String(process.env.INVESTOR_NDA_STORAGE_KEY || '').trim();
  if (!storageKey) return null;
  return {
    // Point documents.file_path directly at the configured storage object.
    filePath: `/api/files/${encodeURIComponent(storageKey)}`,
    filename: path.basename(storageKey) || 'nda.pdf',
  };
}

async function ensureInvestorNdaDocument(db: ReturnType<typeof getDb>) {
  const existing = db.prepare(`
    SELECT id, file_path, file_type, requires_signature
    FROM documents
    WHERE parent_type = 'fund' AND parent_id = 0 AND category = 'nda'
    ORDER BY id DESC
    LIMIT 1
  `).get() as any;

  const configuredStorage = configuredNdaStorageFilePath();
  if (configuredStorage) {
    if (existing?.id) {
      db.prepare(`
        UPDATE documents
        SET name = ?, file_path = ?, file_type = ?, requires_signature = 1, uploaded_by = ?, signed_at = NULL
        WHERE id = ?
      `).run(
        configuredStorage.filename,
        configuredStorage.filePath,
        'application/pdf',
        'system',
        Number(existing.id)
      );
      return { documentId: Number(existing.id) };
    }

    const inserted = db.prepare(`
      INSERT INTO documents (parent_id, parent_type, name, category, file_path, file_type, requires_signature, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      0,
      'fund',
      configuredStorage.filename,
      'nda',
      configuredStorage.filePath,
      'application/pdf',
      'system'
    );
    return { documentId: Number(inserted.lastInsertRowid) };
  }

  if (existing?.id && String(existing.file_type || '').includes('pdf') && Number(existing.requires_signature) === 1) {
    return { documentId: Number(existing.id) };
  }

  const { bytes, filename } = await readConfiguredInvestorNda();
  const stored = await saveUploadedBuffer(bytes, 'documents', filename, 'application/pdf');

  const result = db.prepare(`
    INSERT INTO documents (parent_id, parent_type, name, category, file_path, file_type, requires_signature, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    0,
    'fund',
    filename,
    'nda',
    stored.filePath,
    'application/pdf',
    'system'
  );

  return { documentId: Number(result.lastInsertRowid) };
}

// POST /api/public/investor-nda/start -> { url }
router.post('/start', async (_req: Request, res: Response) => {
  const db = getDb();
  try {
    const { documentId } = await ensureInvestorNdaDocument(db);

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(rawToken);
    const expiresAtIso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Reusable signing link for the investor NDA flow.
    db.prepare(`
      INSERT INTO document_signing_links (document_id, token_hash, is_single_use, expires_at, created_by)
      VALUES (?, ?, 0, ?, ?)
    `).run(documentId, tokenHash, expiresAtIso, 'system');

    res.json({ url: buildSigningUrl(rawToken), expiresAt: expiresAtIso });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to start NDA signing' });
  }
});

export default router;

