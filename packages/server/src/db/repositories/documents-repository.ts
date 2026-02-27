import { getDb } from '../database';
import { withPostgresClient } from '../postgres-client';
import { dualWriteEnabled, sqliteFallbackEnabled, usePostgresDocumentsRoutes, usePostgresReads } from '../runtime-mode';

type AnyObj = Record<string, any>;

async function ensurePostgresSigningTables(): Promise<void> {
  await withPostgresClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_signing_links (
        id BIGSERIAL PRIMARY KEY,
        document_id BIGINT NOT NULL REFERENCES documents(id),
        token_hash TEXT NOT NULL UNIQUE,
        is_single_use INTEGER NOT NULL DEFAULT 1,
        expires_at TIMESTAMPTZ,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        created_by TEXT
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_signatures (
        id BIGSERIAL PRIMARY KEY,
        document_id BIGINT NOT NULL REFERENCES documents(id),
        signing_link_id BIGINT REFERENCES document_signing_links(id),
        signer_name TEXT NOT NULL,
        signer_email TEXT,
        signer_company TEXT,
        signer_title TEXT,
        signature_text TEXT NOT NULL,
        investor_gate_password_hash TEXT,
        investor_gate_password_expires_at TIMESTAMPTZ,
        investor_gate_password_used_at TIMESTAMPTZ,
        signed_at TIMESTAMPTZ DEFAULT NOW(),
        signed_ip TEXT,
        signed_user_agent TEXT,
        original_pdf_sha256 TEXT NOT NULL,
        executed_file_path TEXT,
        executed_pdf_sha256 TEXT
      )
    `);
  });
}

function shouldUsePgWrite() {
  return usePostgresDocumentsRoutes();
}

function shouldUsePgRead() {
  return usePostgresReads() || usePostgresDocumentsRoutes();
}

export async function createDocument(input: {
  parentId: number;
  parentType: string;
  name: string;
  category: string;
  filePath: string;
  fileType: string;
  requiresSignature: boolean;
  uploadedBy: string;
}): Promise<number> {
  const sqliteFlow = () => {
    const db = getDb();
    const r = db.prepare(`
      INSERT INTO documents (parent_id, parent_type, name, category, file_path, file_type, requires_signature, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.parentId,
      input.parentType,
      input.name,
      input.category,
      input.filePath,
      input.fileType,
      input.requiresSignature ? 1 : 0,
      input.uploadedBy
    );
    return Number(r.lastInsertRowid);
  };

  if (!shouldUsePgWrite()) return sqliteFlow();

  const pgId = await withPostgresClient(async (client) => {
    const r = await client.query(
      `
      INSERT INTO documents (parent_id, parent_type, name, category, file_path, file_type, requires_signature, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
      `,
      [
        input.parentId,
        input.parentType,
        input.name,
        input.category,
        input.filePath,
        input.fileType,
        input.requiresSignature ? 1 : 0,
        input.uploadedBy,
      ]
    );
    return Number(r.rows[0]?.id || 0);
  });

  if (dualWriteEnabled()) {
    try {
      sqliteFlow();
    } catch (error) {
      console.error('[dual-write][documents] SQLite shadow write failed in createDocument:', error);
    }
  }
  return pgId;
}

export async function getDocumentById(id: number): Promise<AnyObj | null> {
  if (shouldUsePgRead()) {
    try {
      return await withPostgresClient(async (client) => {
        const r = await client.query(`SELECT * FROM documents WHERE id = $1 LIMIT 1`, [id]);
        return (r.rows[0] as AnyObj) || null;
      });
    } catch {
      if (!sqliteFallbackEnabled()) throw new Error('Postgres read failed and SQLite fallback is disabled');
    }
  }
  return (getDb().prepare(`SELECT * FROM documents WHERE id = ? LIMIT 1`).get(id) as AnyObj) || null;
}

export async function listDocumentsByParent(parentType: string, parentId: number): Promise<AnyObj[]> {
  if (shouldUsePgRead()) {
    try {
      return await withPostgresClient(async (client) => {
        const r = await client.query(
          `SELECT * FROM documents WHERE parent_type = $1 AND parent_id = $2 ORDER BY uploaded_at DESC`,
          [parentType, parentId]
        );
        return r.rows as AnyObj[];
      });
    } catch {
      if (!sqliteFallbackEnabled()) throw new Error('Postgres read failed and SQLite fallback is disabled');
    }
  }
  return getDb()
    .prepare(`SELECT * FROM documents WHERE parent_type = ? AND parent_id = ? ORDER BY uploaded_at DESC`)
    .all(parentType, parentId) as AnyObj[];
}

export async function deleteDocumentById(id: number): Promise<void> {
  const sqliteFlow = () => {
    getDb().prepare(`DELETE FROM documents WHERE id = ?`).run(id);
  };
  if (!shouldUsePgWrite()) {
    sqliteFlow();
    return;
  }
  await withPostgresClient(async (client) => {
    await client.query(`DELETE FROM documents WHERE id = $1`, [id]);
  });
  if (dualWriteEnabled()) {
    try {
      sqliteFlow();
    } catch (error) {
      console.error('[dual-write][documents] SQLite shadow write failed in deleteDocumentById:', error);
    }
  }
}

export async function createSigningLink(input: {
  documentId: number;
  tokenHash: string;
  isSingleUse: number;
  expiresAtIso: string;
  createdBy: string;
}): Promise<void> {
  const sqliteFlow = () => {
    getDb()
      .prepare(
        `
      INSERT INTO document_signing_links (document_id, token_hash, is_single_use, expires_at, created_by)
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run(input.documentId, input.tokenHash, input.isSingleUse, input.expiresAtIso, input.createdBy);
  };
  if (!shouldUsePgWrite()) {
    sqliteFlow();
    return;
  }
  await ensurePostgresSigningTables();
  await withPostgresClient(async (client) => {
    await client.query(
      `
      INSERT INTO document_signing_links (document_id, token_hash, is_single_use, expires_at, created_by)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [input.documentId, input.tokenHash, input.isSingleUse, input.expiresAtIso, input.createdBy]
    );
  });
  if (dualWriteEnabled()) {
    try {
      sqliteFlow();
    } catch (error) {
      console.error('[dual-write][documents] SQLite shadow write failed in createSigningLink:', error);
    }
  }
}

export async function getSigningLinkByTokenHash(tokenHash: string): Promise<AnyObj | null> {
  if (shouldUsePgRead()) {
    try {
      await ensurePostgresSigningTables();
      return await withPostgresClient(async (client) => {
        const r = await client.query(`SELECT * FROM document_signing_links WHERE token_hash = $1 LIMIT 1`, [tokenHash]);
        return (r.rows[0] as AnyObj) || null;
      });
    } catch {
      if (!sqliteFallbackEnabled()) throw new Error('Postgres read failed and SQLite fallback is disabled');
    }
  }
  return (
    (getDb().prepare(`SELECT * FROM document_signing_links WHERE token_hash = ? LIMIT 1`).get(tokenHash) as AnyObj) || null
  );
}

export async function insertDocumentSignature(input: {
  documentId: number;
  signingLinkId: number;
  signerName: string;
  signerEmail: string | null;
  signerCompany: string | null;
  signerTitle: string | null;
  signatureText: string;
  investorGatePasswordHash: string;
  signedIp: string | null;
  signedUserAgent: string | null;
  originalPdfSha256: string;
  executedFilePath: string;
  executedPdfSha256: string;
}): Promise<number> {
  const sqliteFlow = () => {
    const r = getDb()
      .prepare(
        `
      INSERT INTO document_signatures (
        document_id, signing_link_id,
        signer_name, signer_email, signer_company, signer_title, signature_text,
        investor_gate_password_hash,
        signed_ip, signed_user_agent,
        original_pdf_sha256,
        executed_file_path, executed_pdf_sha256
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        input.documentId,
        input.signingLinkId,
        input.signerName,
        input.signerEmail,
        input.signerCompany,
        input.signerTitle,
        input.signatureText,
        input.investorGatePasswordHash,
        input.signedIp,
        input.signedUserAgent,
        input.originalPdfSha256,
        input.executedFilePath,
        input.executedPdfSha256
      );
    return Number(r.lastInsertRowid);
  };
  if (!shouldUsePgWrite()) return sqliteFlow();
  await ensurePostgresSigningTables();
  const pgId = await withPostgresClient(async (client) => {
    const r = await client.query(
      `
      INSERT INTO document_signatures (
        document_id, signing_link_id,
        signer_name, signer_email, signer_company, signer_title, signature_text,
        investor_gate_password_hash,
        signed_ip, signed_user_agent,
        original_pdf_sha256,
        executed_file_path, executed_pdf_sha256
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id
      `,
      [
        input.documentId,
        input.signingLinkId,
        input.signerName,
        input.signerEmail,
        input.signerCompany,
        input.signerTitle,
        input.signatureText,
        input.investorGatePasswordHash,
        input.signedIp,
        input.signedUserAgent,
        input.originalPdfSha256,
        input.executedFilePath,
        input.executedPdfSha256,
      ]
    );
    return Number(r.rows[0]?.id || 0);
  });
  if (dualWriteEnabled()) {
    try {
      sqliteFlow();
    } catch (error) {
      console.error('[dual-write][documents] SQLite shadow write failed in insertDocumentSignature:', error);
    }
  }
  return pgId;
}

export async function markDocumentAndLinkUsed(documentId: number, signingLinkId: number): Promise<void> {
  const sqliteFlow = () => {
    const db = getDb();
    db.prepare(`UPDATE documents SET signed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(documentId);
    db.prepare(`UPDATE document_signing_links SET used_at = CURRENT_TIMESTAMP WHERE id = ?`).run(signingLinkId);
  };
  if (!shouldUsePgWrite()) {
    sqliteFlow();
    return;
  }
  await withPostgresClient(async (client) => {
    await client.query(`UPDATE documents SET signed_at = CURRENT_TIMESTAMP WHERE id = $1`, [documentId]);
    await client.query(`UPDATE document_signing_links SET used_at = CURRENT_TIMESTAMP WHERE id = $1`, [signingLinkId]);
  });
  if (dualWriteEnabled()) {
    try {
      sqliteFlow();
    } catch (error) {
      console.error('[dual-write][documents] SQLite shadow write failed in markDocumentAndLinkUsed:', error);
    }
  }
}

