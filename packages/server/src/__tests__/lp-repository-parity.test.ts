import os from 'os';
import path from 'path';
import { initDb, getDb, closeDb } from '../db/database';
import { getPostgresPool } from '../db/postgres-client';
import {
  createCapitalCallWithItems,
  getLpAccountByUserId,
  listCapitalCallsAll,
} from '../db/repositories/lp-repository';

const hasPg = !!String(process.env.DATABASE_URL || '').trim();
const describeIfPg = hasPg ? describe : describe.skip;

describeIfPg('LP repository parity (sqlite vs postgres)', () => {
  let sqliteUserId = 0;
  let pgUserId = 0;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_PATH = path.join(os.tmpdir(), `brickell-parity-${Date.now()}.db`);
    initDb();
    const db = getDb();
    db.prepare(`INSERT INTO users (email, password_hash, role, name) VALUES (?, ?, ?, ?)`).run(
      'parity-lp@example.com',
      'x',
      'lp',
      'Parity LP'
    );
    const user = db.prepare(`SELECT id FROM users WHERE email = ?`).get('parity-lp@example.com') as any;
    sqliteUserId = Number(user.id);
    db.prepare(`
      INSERT INTO lp_accounts (user_id, name, entity_name, email, phone, commitment, ownership_pct, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, 'Parity LP', 'Parity LLC', 'parity-lp@example.com', '3050000000', 500000, 1, 'active');

    const pool = getPostgresPool();
    await pool.query(`DELETE FROM capital_transactions`);
    await pool.query(`DELETE FROM capital_call_items`);
    await pool.query(`DELETE FROM capital_calls`);
    await pool.query(`DELETE FROM lp_accounts`);
    await pool.query(`DELETE FROM users WHERE email = $1`, ['parity-lp@example.com']);
    const u = await pool.query(
      `INSERT INTO users (email, password_hash, role, name) VALUES ($1, $2, $3, $4) RETURNING id`,
      ['parity-lp@example.com', 'x', 'lp', 'Parity LP']
    );
    pgUserId = Number(u.rows[0].id);
    await pool.query(
      `
      INSERT INTO lp_accounts (user_id, name, entity_name, email, phone, commitment, ownership_pct, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [pgUserId, 'Parity LP', 'Parity LLC', 'parity-lp@example.com', '3050000000', 500000, 1, 'active']
    );
  });

  afterAll(async () => {
    closeDb();
    try {
      const pool = getPostgresPool();
      await pool.end();
    } catch {
      // ignore test teardown failures
    }
  });

  it('returns equivalent LP account shape', async () => {
    process.env.USE_POSTGRES_READ = '0';
    const sqliteAccount = await getLpAccountByUserId(sqliteUserId);
    process.env.USE_POSTGRES_READ = '1';
    const pgAccount = await getLpAccountByUserId(pgUserId);
    expect(sqliteAccount).toBeTruthy();
    expect(pgAccount).toBeTruthy();
    expect(String(pgAccount?.email || '').toLowerCase()).toBe(String(sqliteAccount?.email || '').toLowerCase());
    expect(Number(pgAccount?.commitment || 0)).toBeCloseTo(Number(sqliteAccount?.commitment || 0), 4);
  });

  it('creates calls with matching aggregate outcomes', async () => {
    process.env.USE_POSTGRES_LP = '0';
    const sqliteCreated = await createCapitalCallWithItems({
      totalAmount: 25000,
      callDate: '2026-02-01',
      dueDate: '2026-02-15',
      purpose: 'parity sqlite',
    });
    const sqliteCalls = await listCapitalCallsAll();

    process.env.USE_POSTGRES_LP = '1';
    const pgCreated = await createCapitalCallWithItems({
      totalAmount: 25000,
      callDate: '2026-02-01',
      dueDate: '2026-02-15',
      purpose: 'parity postgres',
    });
    const pgCalls = await listCapitalCallsAll();

    expect(sqliteCreated.items.length).toBeGreaterThan(0);
    expect(pgCreated.items.length).toBeGreaterThan(0);
    expect(sqliteCalls.length).toBeGreaterThan(0);
    expect(pgCalls.length).toBeGreaterThan(0);
    expect(Number(sqliteCreated.items[0].amount)).toBeCloseTo(Number(pgCreated.items[0].amount), 2);
  });
});

