import { getDb } from './database';
import { createHash } from 'crypto';
import { withPostgresClient } from './postgres-client';

export type ReconcileTableResult = {
  table: string;
  sqliteCount: number;
  postgresCount: number;
  delta: number;
  withinThreshold: boolean;
  sqliteChecksum: string | null;
  postgresChecksum: string | null;
  checksumMatch: boolean;
};

export type ReconcileResult = {
  generatedAt: number;
  threshold: number;
  pass: boolean;
  tables: ReconcileTableResult[];
};

export const CRITICAL_RECON_TABLES = [
  'lp_accounts',
  'capital_calls',
  'capital_call_items',
  'capital_transactions',
  'cash_flow_actuals',
  'documents',
] as const;

const TABLE_CHECKSUM_COLUMNS: Record<(typeof CRITICAL_RECON_TABLES)[number], string[]> = {
  lp_accounts: ['id', 'user_id', 'name', 'email', 'status', 'commitment', 'ownership_pct', 'called_capital'],
  capital_calls: ['id', 'call_number', 'total_amount', 'call_date', 'due_date', 'status', 'purpose'],
  capital_call_items: ['id', 'capital_call_id', 'lp_account_id', 'amount', 'status', 'received_amount'],
  capital_transactions: ['id', 'lp_account_id', 'capital_call_item_id', 'type', 'amount', 'date', 'quarter'],
  cash_flow_actuals: ['id', 'bank_transaction_id', 'portfolio_unit_id', 'entity_id', 'lp_account_id', 'amount', 'category', 'reconciled'],
  documents: ['id', 'parent_id', 'parent_type', 'name', 'category', 'file_path', 'file_type', 'requires_signature', 'signed_at'],
};

function hashPayload(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

async function getPostgresCount(table: string): Promise<number> {
  return withPostgresClient(async (client) => {
    const r = await client.query(`SELECT COUNT(*)::int AS c FROM "${table}"`);
    return Number(r.rows[0]?.c || 0);
  });
}

function getSqliteCount(table: string): number {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c?: number };
  return Number(row?.c || 0);
}

async function getPostgresChecksum(table: string, columns: string[]): Promise<string> {
  const rowExpr = columns
    .map((c) => `COALESCE(${c}::text, '')`)
    .join(` || '|' || `);
  const sql = `
    SELECT COALESCE(string_agg(row_sig, '|' ORDER BY id), '') AS payload
    FROM (
      SELECT ${rowExpr} AS row_sig, id
      FROM "${table}"
    ) t
  `;
  return withPostgresClient(async (client) => {
    const r = await client.query(sql);
    return hashPayload(String(r.rows[0]?.payload || ''));
  });
}

function getSqliteChecksum(table: string, columns: string[]): string {
  const rowExpr = columns
    .map((c) => `COALESCE(CAST(${c} AS TEXT), '')`)
    .join(` || '|' || `);
  const sql = `
    SELECT COALESCE(group_concat(row_sig, '|'), '') AS payload
    FROM (
      SELECT ${rowExpr} AS row_sig
      FROM ${table}
      ORDER BY id
    ) t
  `;
  const row = getDb().prepare(sql).get() as { payload?: string };
  return hashPayload(String(row?.payload || ''));
}

export async function reconcileCriticalTables(threshold = 0): Promise<ReconcileResult> {
  const cleanThreshold = Math.max(0, Math.floor(Number(threshold) || 0));
  const tables: ReconcileTableResult[] = [];

  for (const table of CRITICAL_RECON_TABLES) {
    let sqliteCount = -1;
    let postgresCount = -1;
    let sqliteChecksum: string | null = null;
    let postgresChecksum: string | null = null;
    try {
      sqliteCount = getSqliteCount(table);
    } catch {
      sqliteCount = -1;
    }
    try {
      postgresCount = await getPostgresCount(table);
    } catch {
      postgresCount = -1;
    }
    try {
      sqliteChecksum = getSqliteChecksum(table, TABLE_CHECKSUM_COLUMNS[table]);
    } catch {
      sqliteChecksum = null;
    }
    try {
      postgresChecksum = await getPostgresChecksum(table, TABLE_CHECKSUM_COLUMNS[table]);
    } catch {
      postgresChecksum = null;
    }
    const delta = sqliteCount >= 0 && postgresCount >= 0 ? Math.abs(sqliteCount - postgresCount) : Number.MAX_SAFE_INTEGER;
    const checksumMatch = !!sqliteChecksum && !!postgresChecksum && sqliteChecksum === postgresChecksum;
    tables.push({
      table,
      sqliteCount,
      postgresCount,
      delta,
      withinThreshold: delta <= cleanThreshold,
      sqliteChecksum,
      postgresChecksum,
      checksumMatch,
    });
  }

  const pass = tables.every((t) => t.withinThreshold && t.checksumMatch);
  return {
    generatedAt: Date.now(),
    threshold: cleanThreshold,
    pass,
    tables,
  };
}

