import type { Request } from 'express';
import type { getDb } from '../db/database';
import { withPostgresClient } from '../db/postgres-client';
import { isPostgresPrimaryMode, usePostgresReads } from '../db/runtime-mode';

type Db = ReturnType<typeof getDb>;

function safeJson(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return JSON.stringify(String(value));
    } catch {
      return null;
    }
  }
}

export function writeAuditLog(params: {
  db: Db;
  req: Request;
  action: string;
  tableName: string;
  recordId?: string | number | null;
  before?: unknown;
  after?: unknown;
}) {
  const { db, req, action, tableName, recordId, before, after } = params;
  const actorEmail = String((req as any).user?.email || '');
  const actorUserId = (req as any).user?.id ?? null;
  const requestId = String(req.headers['x-request-id'] || '');
  const ip = String((req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')).split(',')[0].trim();

  try {
    db.prepare(`
      INSERT INTO audit_log (
        actor_email, actor_user_id, action, table_name, record_id, request_id, ip, before_json, after_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      actorEmail || null,
      actorUserId || null,
      String(action),
      String(tableName),
      recordId != null ? String(recordId) : null,
      requestId || null,
      ip || null,
      safeJson(before),
      safeJson(after),
    );
  } catch (error) {
    // Never break core accounting operations if audit logging fails.
    console.warn('[audit] Failed to write audit log:', error);
  }
}

export async function writeAuditLogPg(params: {
  req: Request;
  action: string;
  tableName: string;
  recordId?: string | number | null;
  before?: unknown;
  after?: unknown;
}) {
  const { req, action, tableName, recordId, before, after } = params;
  const actorEmail = String((req as any).user?.email || '');
  const actorUserId = (req as any).user?.id ?? null;
  const requestId = String(req.headers['x-request-id'] || '');
  const ip = String((req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')).split(',')[0].trim();
  try {
    await withPostgresClient(async (client) => {
      await client.query(
        `
        INSERT INTO audit_log (
          actor_email, actor_user_id, action, table_name, record_id, request_id, ip, before_json, after_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          actorEmail || null,
          actorUserId || null,
          String(action),
          String(tableName),
          recordId != null ? String(recordId) : null,
          requestId || null,
          ip || null,
          safeJson(before),
          safeJson(after),
        ]
      );
    });
  } catch (error) {
    // Never break core accounting operations if audit logging fails.
    console.warn('[audit] Failed to write Postgres audit log:', error);
  }
}

export async function writeAuditLogAuto(params: {
  db?: Db;
  req: Request;
  action: string;
  tableName: string;
  recordId?: string | number | null;
  before?: unknown;
  after?: unknown;
}) {
  const usePg = isPostgresPrimaryMode() || usePostgresReads();
  if (usePg) {
    await writeAuditLogPg({
      req: params.req,
      action: params.action,
      tableName: params.tableName,
      recordId: params.recordId,
      before: params.before,
      after: params.after,
    });
    return;
  }
  if (params.db) {
    writeAuditLog({
      db: params.db,
      req: params.req,
      action: params.action,
      tableName: params.tableName,
      recordId: params.recordId,
      before: params.before,
      after: params.after,
    });
  }
}

