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
    idleTimeoutMillis: Math.max(1_000, Number(process.env.PG_POOL_IDLE_MS || 30_000)),
    connectionTimeoutMillis: Math.max(1_000, Number(process.env.PG_POOL_CONNECT_MS || 10_000)),
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

