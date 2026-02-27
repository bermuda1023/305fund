import { getDb } from './database';
import { withPostgresClient } from './postgres-client';

export type ReconcileTableResult = {
  table: string;
  sqliteCount: number;
  postgresCount: number;
  delta: number;
  withinThreshold: boolean;
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

export async function reconcileCriticalTables(threshold = 0): Promise<ReconcileResult> {
  const cleanThreshold = Math.max(0, Math.floor(Number(threshold) || 0));
  const tables: ReconcileTableResult[] = [];

  for (const table of CRITICAL_RECON_TABLES) {
    let sqliteCount = -1;
    let postgresCount = -1;
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
    const delta = sqliteCount >= 0 && postgresCount >= 0 ? Math.abs(sqliteCount - postgresCount) : Number.MAX_SAFE_INTEGER;
    tables.push({
      table,
      sqliteCount,
      postgresCount,
      delta,
      withinThreshold: delta <= cleanThreshold,
    });
  }

  const pass = tables.every((t) => t.withinThreshold);
  return {
    generatedAt: Date.now(),
    threshold: cleanThreshold,
    pass,
    tables,
  };
}

