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

let sqliteProvider: (() => Database.Database) | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
let pushInFlight = false;
let pushQueued = false;
let pullInFlight = false;

function quoteIdent(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function getConnectionString(): string | null {
  const raw = String(process.env.DATABASE_URL || '').trim();
  return raw || null;
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  if (rows.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function sqliteColumns(database: Database.Database, table: string): string[] {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.map((c) => c.name);
}

async function replacePostgresTableFromRows(
  client: Client,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[]
) {
  const colList = columns.map(quoteIdent).join(', ');
  await client.query(`TRUNCATE TABLE ${quoteIdent(table)} RESTART IDENTITY CASCADE`);

  if (rows.length === 0) return;

  const rowChunks = chunkRows(rows, 250);
  for (const batch of rowChunks) {
    const params: unknown[] = [];
    let p = 1;
    const tuples = batch.map((row) => {
      const slots = columns.map((col) => {
        params.push(row[col] ?? null);
        return `$${p++}`;
      });
      return `(${slots.join(', ')})`;
    });

    await client.query(
      `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES ${tuples.join(', ')}`,
      params
    );
  }

  if (columns.includes('id')) {
    await client.query(
      `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${quoteIdent(table)}), 1), (SELECT COUNT(*) > 0 FROM ${quoteIdent(table)}))`,
      [table]
    );
  }
}

async function syncSqliteToPostgres(database: Database.Database) {
  const connectionString = getConnectionString();
  if (!connectionString) return;

  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const table of TABLES_IN_ORDER) {
      const columns = sqliteColumns(database, table);
      if (columns.length === 0) continue;
      const colList = columns.map(quoteIdent).join(', ');
      const rows = database
        .prepare(`SELECT ${colList} FROM ${table}`)
        .all() as Record<string, unknown>[];

      await client.query('BEGIN');
      try {
        await replacePostgresTableFromRows(client, table, columns, rows);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

async function syncPostgresToSqlite(database: Database.Database) {
  const connectionString = getConnectionString();
  if (!connectionString) return;

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const hasRows = await client.query('SELECT COUNT(*)::int AS c FROM building_units');
    const count = Number(hasRows.rows[0]?.c || 0);
    if (count === 0) {
      console.log('[pg-bridge] Postgres building_units is empty; skipping startup pull');
      return;
    }

    database.exec('PRAGMA foreign_keys = OFF');
    try {
      for (const table of TABLES_IN_ORDER) {
        const columns = sqliteColumns(database, table);
        if (columns.length === 0) continue;
        const colList = columns.map(quoteIdent).join(', ');
        const result = await client.query(`SELECT ${colList} FROM ${quoteIdent(table)}`);

        database.exec('BEGIN');
        try {
          database.prepare(`DELETE FROM ${table}`).run();
          if (result.rows.length) {
            const values = columns.map(() => '?').join(', ');
            const stmt = database.prepare(`INSERT INTO ${table} (${colList}) VALUES (${values})`);
            for (const row of result.rows as Record<string, unknown>[]) {
              stmt.run(...columns.map((col) => row[col] ?? null));
            }
          }
          database.exec('COMMIT');
        } catch (tableError) {
          database.exec('ROLLBACK');
          console.error(`[pg-bridge] Pull skipped table "${table}":`, tableError);
        }
      }
    } finally {
      database.exec('PRAGMA foreign_keys = ON');
    }
  } finally {
    await client.end();
  }
}

export function isPostgresBridgeEnabled(): boolean {
  const connectionString = getConnectionString();
  if (!connectionString) return false;
  return process.env.PG_BRIDGE_DISABLED !== '1';
}

export function configurePostgresBridge(provider: () => Database.Database) {
  sqliteProvider = provider;
}

export async function hydrateSqliteFromPostgres(): Promise<void> {
  if (!isPostgresBridgeEnabled() || !sqliteProvider) return;
  if (pushInFlight || pullInFlight) return;
  pullInFlight = true;
  try {
    await syncPostgresToSqlite(sqliteProvider());
    console.log('[pg-bridge] Pull complete');
  } finally {
    pullInFlight = false;
  }
}

async function runPush(reason: string) {
  if (!sqliteProvider || !isPostgresBridgeEnabled()) return;

  if (pushInFlight || pullInFlight) {
    pushQueued = true;
    return;
  }

  pushInFlight = true;
  try {
    await syncSqliteToPostgres(sqliteProvider());
    console.log(`[pg-bridge] Push complete (${reason})`);
  } catch (error) {
    console.error('[pg-bridge] Push failed:', error);
  } finally {
    pushInFlight = false;
    if (pushQueued) {
      pushQueued = false;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void runPush('queued');
      }, 1500);
    }
  }
}

export function schedulePostgresPush(reason = 'mutation') {
  if (!isPostgresBridgeEnabled() || !sqliteProvider) return;

  const debounceMs = Math.max(500, Number(process.env.PG_BRIDGE_DEBOUNCE_MS || 2000));
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runPush(reason);
  }, debounceMs);
}
