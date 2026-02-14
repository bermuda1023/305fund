import dotenv from 'dotenv';
dotenv.config();

import { Client } from 'pg';
import { POSTGRES_SCHEMA } from './postgres-schema';

async function run() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for Postgres migration');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query('BEGIN');
    await client.query(POSTGRES_SCHEMA);
    await client.query('COMMIT');
    console.log('Postgres schema migration complete');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error('Postgres migration failed:', error);
  process.exit(1);
});
