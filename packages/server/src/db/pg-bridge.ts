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
  'bank_uploads',
  'bank_transactions',
  'accounting_periods',
  'audit_log',
  'cash_flow_actuals',
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
let lastPullAt = 0;
let lastPushError: Error | null = null;
let lastPushAt = 0;
let lastPushSuccessAt = 0;

function quoteIdent(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function getConnectionString(): string | null {
  const raw = String(process.env.DATABASE_URL || '').trim();
  return raw || null;
}

function allowEmptyReplace(): boolean {
  return String(process.env.PG_BRIDGE_ALLOW_EMPTY_REPLACE || '').toLowerCase() === '1';
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

async function postgresColumns(client: Client, table: string): Promise<string[]> {
  try {
    const result = await client.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
      `,
      [table]
    );
    return (result.rows as Array<{ column_name: string }>).map((r) => r.column_name);
  } catch {
    return [];
  }
}

function intersectColumns(sqliteCols: string[], pgCols: string[]): string[] {
  if (sqliteCols.length === 0 || pgCols.length === 0) return [];
  const pgSet = new Set(pgCols);
  // Keep SQLite ordering, since SQLite insert statement uses this order.
  return sqliteCols.filter((c) => pgSet.has(c));
}

function toSqliteBindable(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'object' && value !== null && typeof (value as any).valueOf === 'function') {
    const primitive = (value as any).valueOf();
    if (primitive !== value) return toSqliteBindable(primitive);
  }
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
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

async function bestEffortUpsertTableFromRows(
  client: Client,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[]
) {
  if (rows.length === 0 || columns.length === 0) return;

  const colList = columns.map(quoteIdent).join(', ');
  const hasId = columns.includes('id');
  const updateColumns = columns.filter((c) => c !== 'id');
  let synced = 0;
  let skipped = 0;

  for (const row of rows) {
    const params = columns.map((col) => row[col] ?? null);
    const slots = columns.map((_, idx) => `$${idx + 1}`).join(', ');
    const upsertSql = hasId
      ? `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES (${slots})
         ON CONFLICT (id) DO UPDATE SET ${updateColumns.map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`).join(', ')}`
      : `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES (${slots})`;
    try {
      await client.query(upsertSql, params);
      synced += 1;
    } catch (error) {
      skipped += 1;
      if (skipped <= 5) {
        console.warn(`[pg-bridge] Skipped row while syncing ${table}:`, error);
      }
    }
  }

  console.warn(`[pg-bridge] Best-effort sync for ${table}: synced=${synced}, skipped=${skipped}`);
}

async function syncSqliteToPostgres(database: Database.Database) {
  const connectionString = getConnectionString();
  if (!connectionString) return;

  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const table of TABLES_IN_ORDER) {
      // Special-case audit_log: append-only incremental sync, otherwise the full-table
      // replace would get slower over time and re-upload the whole log every mutation.
      if (table === 'audit_log') {
        const sqliteCols = sqliteColumns(database, table);
        if (sqliteCols.length === 0) continue;
        const pgCols = await postgresColumns(client, table);
        const columns = intersectColumns(sqliteCols, pgCols);
        if (!columns.includes('id')) {
          console.warn('[pg-bridge] Skipping push for audit_log: missing id column');
          continue;
        }
        const colList = columns.map(quoteIdent).join(', ');
        const remoteMax = await client.query(`SELECT COALESCE(MAX(id), 0)::bigint AS m FROM ${quoteIdent(table)}`);
        const maxId = Number(remoteMax.rows[0]?.m || 0);
        const pending = database
          .prepare(`SELECT ${colList} FROM ${table} WHERE id > ? ORDER BY id ASC`)
          .all(maxId) as Record<string, unknown>[];
        if (pending.length === 0) continue;

        const rowChunks = chunkRows(pending, 250);
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
          const insertSql = `
            INSERT INTO ${quoteIdent(table)} (${colList})
            VALUES ${tuples.join(', ')}
            ON CONFLICT (id) DO NOTHING
          `;
          await client.query(insertSql, params);
        }
        continue;
      }

      const sqliteCols = sqliteColumns(database, table);
      if (sqliteCols.length === 0) continue;
      const pgCols = await postgresColumns(client, table);
      const columns = intersectColumns(sqliteCols, pgCols);
      if (columns.length === 0) {
        console.warn(`[pg-bridge] Skipping push for ${table}: no shared columns between SQLite and Postgres`);
        continue;
      }
      const colList = columns.map(quoteIdent).join(', ');
      const rows = database
        .prepare(`SELECT ${colList} FROM ${table}`)
        .all() as Record<string, unknown>[];

      // Safety: never let an empty runtime SQLite accidentally wipe a non-empty Postgres table.
      // This protects production data if the bridge is misconfigured (wrong DB, missing pull, etc.).
      if (!allowEmptyReplace() && rows.length === 0) {
        try {
          const existing = await client.query(`SELECT COUNT(*)::int AS c FROM ${quoteIdent(table)}`);
          const remoteCount = Number(existing.rows[0]?.c || 0);
          if (remoteCount > 0) {
            console.warn(`[pg-bridge] Skipping empty push for ${table}: sqlite_rows=0, postgres_rows=${remoteCount}`);
            continue;
          }
        } catch (error) {
          console.warn(`[pg-bridge] Failed to check Postgres count for ${table}; skipping empty push as precaution`, error);
          continue;
        }
      }

      await client.query('BEGIN');
      try {
        await replacePostgresTableFromRows(client, table, columns, rows);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        console.warn(`[pg-bridge] Full-table sync failed for ${table}. Falling back to best-effort upsert.`, error);
        await bestEffortUpsertTableFromRows(client, table, columns, rows);
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
        // Special-case audit_log: incremental pull without clearing local history.
        if (table === 'audit_log') {
          const sqliteCols = sqliteColumns(database, table);
          if (sqliteCols.length === 0) continue;
          const pgCols = await postgresColumns(client, table);
          const columns = intersectColumns(sqliteCols, pgCols);
          if (!columns.includes('id')) {
            console.warn('[pg-bridge] Skipping pull for audit_log: missing id column');
            continue;
          }
          const colList = columns.map(quoteIdent).join(', ');
          const localMax = Number((database.prepare(`SELECT COALESCE(MAX(id), 0) as m FROM ${table}`).get() as any)?.m || 0);
          const result = await client.query(
            `SELECT ${colList} FROM ${quoteIdent(table)} WHERE id > $1 ORDER BY id ASC`,
            [localMax]
          );
          if (result.rows.length === 0) continue;
          const values = columns.map(() => '?').join(', ');
          const stmt = database.prepare(`INSERT OR IGNORE INTO ${table} (${colList}) VALUES (${values})`);
          database.exec('BEGIN');
          try {
            for (const row of result.rows as Record<string, unknown>[]) {
              const bindValues = columns.map((col) => toSqliteBindable(row[col]));
              stmt.run(...bindValues);
            }
            database.exec('COMMIT');
          } catch (error) {
            database.exec('ROLLBACK');
            console.warn('[pg-bridge] audit_log incremental pull failed:', error);
          }
          continue;
        }

        const sqliteCols = sqliteColumns(database, table);
        if (sqliteCols.length === 0) continue;
        const pgCols = await postgresColumns(client, table);
        const columns = intersectColumns(sqliteCols, pgCols);
        if (columns.length === 0) {
          console.warn(`[pg-bridge] Skipping pull for ${table}: no shared columns between SQLite and Postgres`);
          continue;
        }
        const colList = columns.map(quoteIdent).join(', ');
        const result = await client.query(`SELECT ${colList} FROM ${quoteIdent(table)}`);

        database.exec('BEGIN');
        try {
          const beforeCount = Number((database.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as any)?.c || 0);
          // Safety: never clear a populated SQLite table when Postgres returns zero rows.
          // This can happen if DATABASE_URL points at the wrong DB, permissions change,
          // a transient issue occurs, or a table unexpectedly appears empty.
          if (!allowEmptyReplace() && result.rows.length === 0 && beforeCount > 0) {
            throw new Error(`[pg-bridge] Refusing empty replace for ${table}: source_rows=0, previous_rows=${beforeCount}`);
          }
          database.prepare(`DELETE FROM ${table}`).run();
          if (result.rows.length) {
            const values = columns.map(() => '?').join(', ');
            const stmt = database.prepare(`INSERT INTO ${table} (${colList}) VALUES (${values})`);
            let inserted = 0;
            let skipped = 0;
            for (const row of result.rows as Record<string, unknown>[]) {
              const bindValues = columns.map((col) => toSqliteBindable(row[col]));
              try {
                stmt.run(...bindValues);
                inserted += 1;
              } catch (rowError) {
                // Last-resort fallback: force every non-buffer into string/number/null primitives.
                const fallback = bindValues.map((v) => {
                  if (v === null || v === undefined) return null;
                  if (Buffer.isBuffer(v)) return v;
                  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
                  if (typeof v === 'string') return v;
                  if (typeof v === 'bigint') return v.toString();
                  return String(v);
                });
                try {
                  stmt.run(...fallback);
                  inserted += 1;
                } catch {
                  skipped += 1;
                  if (skipped <= 3) {
                    console.warn(`[pg-bridge] Skipped row in ${table} during pull`, rowError);
                  }
                }
              }
            }
            if (skipped > 0) {
              console.warn(`[pg-bridge] Pull partially loaded ${table}: inserted=${inserted}, skipped=${skipped}`);
            }
            // Safety: never commit a destructive empty-table replacement when source had rows.
            // If all rows failed to insert, rollback so previously loaded runtime data remains available.
            if (inserted === 0 && result.rows.length > 0) {
              throw new Error(
                `[pg-bridge] Refusing to clear ${table}: source_rows=${result.rows.length}, inserted=0, previous_rows=${beforeCount}`
              );
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

export type PostgresBridgeStatus = {
  enabled: boolean;
  pushInFlight: boolean;
  pullInFlight: boolean;
  pushQueued: boolean;
  debounceScheduled: boolean;
  lastPullAt: number | null;
  lastPushAt: number | null;
  lastPushSuccessAt: number | null;
  lastPushError: string | null;
};

export function getPostgresBridgeStatus(): PostgresBridgeStatus {
  return {
    enabled: isPostgresBridgeEnabled(),
    pushInFlight,
    pullInFlight,
    pushQueued,
    debounceScheduled: !!debounceTimer,
    lastPullAt: lastPullAt > 0 ? lastPullAt : null,
    lastPushAt: lastPushAt > 0 ? lastPushAt : null,
    lastPushSuccessAt: lastPushSuccessAt > 0 ? lastPushSuccessAt : null,
    lastPushError: lastPushError ? String(lastPushError.message || lastPushError) : null,
  };
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
    lastPullAt = Date.now();
    console.log('[pg-bridge] Pull complete');
  } finally {
    pullInFlight = false;
  }
}

export async function hydrateSqliteFromPostgresIfStale(maxAgeMs = 20_000): Promise<void> {
  if (!isPostgresBridgeEnabled()) return;
  const age = Date.now() - lastPullAt;
  if (age < maxAgeMs) return;
  await hydrateSqliteFromPostgres();
}

async function runPush(reason: string) {
  if (!sqliteProvider || !isPostgresBridgeEnabled()) return;

  if (pushInFlight || pullInFlight) {
    pushQueued = true;
    return;
  }

  pushInFlight = true;
  lastPushAt = Date.now();
  pushQueued = false;
  try {
    await syncSqliteToPostgres(sqliteProvider());
    lastPushError = null;
    lastPushSuccessAt = Date.now();
    console.log(`[pg-bridge] Push complete (${reason})`);
  } catch (error) {
    lastPushError = error instanceof Error ? error : new Error(String(error));
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

export async function flushPostgresPush(reason = 'mutation-flush', timeoutMs = 12_000): Promise<void> {
  if (!isPostgresBridgeEnabled() || !sqliteProvider) return;

  const startedAt = Date.now();
  // Request an immediate push cycle.
  pushQueued = true;
  if (!pushInFlight && !pullInFlight) {
    await runPush(reason);
  }

  // Wait until bridge activity settles, driving queued push cycles when needed.
  while (pushInFlight || pullInFlight || pushQueued) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for Postgres bridge synchronization');
    }
    if (!pushInFlight && !pullInFlight && pushQueued) {
      await runPush('flush-queued');
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  if (lastPushError) {
    throw lastPushError;
  }
}
