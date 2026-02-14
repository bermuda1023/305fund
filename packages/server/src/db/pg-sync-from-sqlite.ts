import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import Database from 'better-sqlite3';
import { Client } from 'pg';

const TABLES_IN_ORDER = [
  'users',
  'fund_assumptions',
  'unit_types',
  'entities',
  'building_units',
  'portfolio_units',
  'tenants',
  'unit_renovations',
  'lp_accounts',
  'capital_calls',
  'capital_call_items',
  'documents',
  'cash_flow_actuals',
  'bank_uploads',
  'learned_mappings',
  'listings',
  'fred_data',
  'capital_transactions',
  'tenant_communications',
  'rent_reminder_settings',
  'rent_reminder_runs',
] as const;

type TableName = typeof TABLES_IN_ORDER[number];

function sqlitePath() {
  return process.env.DB_PATH || path.join(process.cwd(), 'brickell-fund.db');
}

function quoteIdent(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

async function run() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for pg sync');
  }

  const sqlite = new Database(sqlitePath(), { readonly: true });
  const pg = new Client({ connectionString });
  await pg.connect();

  try {
    for (const table of TABLES_IN_ORDER) {
      const sqliteCols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (sqliteCols.length === 0) continue;
      const columns = sqliteCols.map((c) => c.name);
      const colList = columns.map(quoteIdent).join(', ');

      const rows = sqlite.prepare(`SELECT ${colList} FROM ${table}`).all() as Record<string, unknown>[];

      await pg.query('BEGIN');
      try {
        await pg.query(`TRUNCATE TABLE ${quoteIdent(table)} RESTART IDENTITY CASCADE`);
        if (rows.length > 0) {
          const valuesSql: string[] = [];
          const params: unknown[] = [];
          let p = 1;
          for (const row of rows) {
            const tupleSlots: string[] = [];
            for (const col of columns) {
              tupleSlots.push(`$${p++}`);
              params.push(row[col] ?? null);
            }
            valuesSql.push(`(${tupleSlots.join(', ')})`);
          }
          await pg.query(
            `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES ${valuesSql.join(', ')}`,
            params
          );
        }
        await pg.query('COMMIT');
      } catch (error) {
        await pg.query('ROLLBACK');
        throw new Error(`Failed syncing table ${table}: ${String(error)}`);
      }

      const hasId = columns.includes('id');
      if (hasId) {
        await pg.query(
          `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${quoteIdent(table)}), 1), (SELECT COUNT(*) > 0 FROM ${quoteIdent(table)}))`,
          [table]
        );
      }

      console.log(`Synced ${table}: ${rows.length} rows`);
    }
  } finally {
    sqlite.close();
    await pg.end();
  }
}

run().catch((error) => {
  console.error('SQLite -> Postgres sync failed:', error);
  process.exit(1);
});
