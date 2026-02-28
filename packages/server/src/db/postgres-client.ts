import { Pool, PoolClient } from 'pg';

let pool: Pool | null = null;

export function getPostgresPool(): Pool {
  if (pool) return pool;
  const connectionString = String(process.env.DATABASE_URL || '').trim();
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for Postgres runtime');
  }
  pool = new Pool({
    connectionString,
    max: Math.max(2, Number(process.env.PG_POOL_MAX || 10)),
    idleTimeoutMillis: Math.max(1_000, Number(process.env.PG_POOL_IDLE_MS || 60_000)),
    connectionTimeoutMillis: Math.max(1_000, Number(process.env.PG_POOL_CONNECT_MS || 30_000)),
    statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT || 20_000),
    query_timeout: Number(process.env.PG_QUERY_TIMEOUT || 20_000),
  });
  pool.on('error', (err) => {
    console.error('[pg-pool] Unexpected pool error:', err.message);
  });
  return pool;
}

export async function withPostgresClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const p = getPostgresPool();
  const client = await p.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function checkPostgresConnectivity(): Promise<void> {
  await withPostgresClient(async (client) => {
    await client.query('SELECT 1');
  });
}

export async function ensureCriticalPostgresTables(): Promise<void> {
  await withPostgresClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS bank_transactions (
        id BIGSERIAL PRIMARY KEY,
        bank_upload_id BIGINT REFERENCES bank_uploads(id),
        bank_account_id BIGINT,
        date DATE NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        description TEXT,
        source_file TEXT,
        statement_ref TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS bank_account_id BIGINT;
      ALTER TABLE bank_uploads ADD COLUMN IF NOT EXISTS bank_account_id BIGINT;
      ALTER TABLE bank_uploads ADD COLUMN IF NOT EXISTS file_path TEXT;
      ALTER TABLE bank_uploads ADD COLUMN IF NOT EXISTS file_sha256 TEXT;
      ALTER TABLE bank_uploads ADD COLUMN IF NOT EXISTS uploaded_by TEXT;
      CREATE INDEX IF NOT EXISTS idx_bank_transactions_upload ON bank_transactions(bank_upload_id);
      CREATE INDEX IF NOT EXISTS idx_bank_transactions_date ON bank_transactions(date);

      CREATE TABLE IF NOT EXISTS accounting_periods (
        month TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
        closed_at TIMESTAMPTZ,
        closed_by TEXT
      );

      ALTER TABLE cash_flow_actuals ADD COLUMN IF NOT EXISTS bank_transaction_id BIGINT;
      ALTER TABLE cash_flow_actuals ADD COLUMN IF NOT EXISTS entity_id BIGINT;
      ALTER TABLE cash_flow_actuals ADD COLUMN IF NOT EXISTS unit_renovation_id BIGINT;
      ALTER TABLE cash_flow_actuals ADD COLUMN IF NOT EXISTS lp_account_id BIGINT;
      ALTER TABLE cash_flow_actuals ADD COLUMN IF NOT EXISTS receipt_document_id BIGINT;

      CREATE INDEX IF NOT EXISTS idx_portfolio_units_entity ON portfolio_units(entity_id);
      CREATE INDEX IF NOT EXISTS idx_capital_call_items_lp ON capital_call_items(lp_account_id);
      CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_entity ON cash_flow_actuals(entity_id);
      CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_bank_txn ON cash_flow_actuals(bank_transaction_id);
      CREATE INDEX IF NOT EXISTS idx_capital_transactions_date ON capital_transactions(date);
    `);
  });
}

