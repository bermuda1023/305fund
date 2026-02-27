import type Database from 'better-sqlite3';
import { getDb } from '../database';
import { withPostgresClient } from '../postgres-client';
import { dualWriteEnabled, sqliteFallbackEnabled, usePostgresLpRoutes, usePostgresReads } from '../runtime-mode';

type AnyObj = Record<string, any>;

function recalcCalledCapitalForLpSqlite(db: Database.Database, lpAccountId: number) {
  db.prepare(`
    UPDATE lp_accounts
    SET called_capital = COALESCE((
      SELECT SUM(cci.amount)
      FROM capital_call_items cci
      JOIN capital_calls cc ON cc.id = cci.capital_call_id
      WHERE cci.lp_account_id = lp_accounts.id
        AND cc.status IN ('sent', 'partially_received', 'completed')
    ), 0)
    WHERE id = ?
  `).run(lpAccountId);
}

async function recalcCalledCapitalForLpPg(lpAccountId: number) {
  await withPostgresClient(async (client) => {
    await client.query(
      `
      UPDATE lp_accounts
      SET called_capital = COALESCE((
        SELECT SUM(cci.amount)
        FROM capital_call_items cci
        JOIN capital_calls cc ON cc.id = cci.capital_call_id
        WHERE cci.lp_account_id = lp_accounts.id
          AND cc.status IN ('sent', 'partially_received', 'completed')
      ), 0)
      WHERE id = $1
      `,
      [lpAccountId]
    );
  });
}

function shouldUsePgWrite() {
  return usePostgresLpRoutes();
}

function shouldUsePgRead() {
  return usePostgresReads() || usePostgresLpRoutes();
}

export async function getLpAccountByUserId(userId: number): Promise<AnyObj | null> {
  if (shouldUsePgRead()) {
    try {
      return await withPostgresClient(async (client) => {
        const r = await client.query(
          `
          SELECT
            lpa.*,
            COALESCE((
              SELECT SUM(cci.amount)
              FROM capital_call_items cci
              JOIN capital_calls cc ON cc.id = cci.capital_call_id
              WHERE cci.lp_account_id = lpa.id
                AND cc.status IN ('sent', 'partially_received', 'completed')
            ), 0) as called_capital
          FROM lp_accounts lpa
          WHERE lpa.user_id = $1
          LIMIT 1
          `,
          [userId]
        );
        return (r.rows[0] as AnyObj) || null;
      });
    } catch {
      if (!sqliteFallbackEnabled()) throw new Error('Postgres read failed and SQLite fallback is disabled');
    }
  }

  const db = getDb();
  return (
    (db.prepare(
      `
      SELECT
        lpa.*,
        COALESCE((
          SELECT SUM(cci.amount)
          FROM capital_call_items cci
          JOIN capital_calls cc ON cc.id = cci.capital_call_id
          WHERE cci.lp_account_id = lpa.id
            AND cc.status IN ('sent', 'partially_received', 'completed')
        ), 0) as called_capital
      FROM lp_accounts lpa
      WHERE lpa.user_id = ?
      `
    ).get(userId) as AnyObj) || null
  );
}

export async function listLpTransactions(lpAccountId: number): Promise<AnyObj[]> {
  if (shouldUsePgRead()) {
    try {
      return await withPostgresClient(async (client) => {
        const r = await client.query(
          `
          SELECT *
          FROM capital_transactions
          WHERE lp_account_id = $1
          ORDER BY date DESC
          `,
          [lpAccountId]
        );
        return r.rows as AnyObj[];
      });
    } catch {
      if (!sqliteFallbackEnabled()) throw new Error('Postgres read failed and SQLite fallback is disabled');
    }
  }
  const db = getDb();
  return db.prepare(`SELECT * FROM capital_transactions WHERE lp_account_id = ? ORDER BY date DESC`).all(lpAccountId) as AnyObj[];
}

export async function listCapitalCallsAll(): Promise<AnyObj[]> {
  const sql = `
    SELECT cc.*,
      (SELECT COUNT(*) FROM capital_call_items cci WHERE cci.capital_call_id = cc.id AND cci.status = 'received') as received_count,
      (SELECT COUNT(*) FROM capital_call_items cci WHERE cci.capital_call_id = cc.id) as total_items
    FROM capital_calls cc
    ORDER BY cc.call_date DESC
  `;
  if (shouldUsePgRead()) {
    try {
      return await withPostgresClient(async (client) => (await client.query(sql)).rows as AnyObj[]);
    } catch {
      if (!sqliteFallbackEnabled()) throw new Error('Postgres read failed and SQLite fallback is disabled');
    }
  }
  return getDb().prepare(sql).all() as AnyObj[];
}

export async function createCapitalCallWithItems(input: {
  totalAmount: number;
  callDate: string;
  dueDate: string;
  purpose: string;
  letterTemplate?: string | null;
  customEmailSubject?: string | null;
  customEmailBody?: string | null;
}): Promise<{ callId: number; callNumber: number; items: Array<{ lpId: number; lpName: string; amount: number }> }> {
  const sqliteFlow = () => {
    const db = getDb();
    const lastCall = db.prepare('SELECT MAX(call_number) as max_num FROM capital_calls').get() as AnyObj;
    const callNumber = Number(lastCall?.max_num || 0) + 1;
    const callResult = db.prepare(`
      INSERT INTO capital_calls (
        call_number, total_amount, call_date, due_date, purpose, status, letter_template, custom_email_subject, custom_email_body
      )
      VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)
    `).run(callNumber, input.totalAmount, input.callDate, input.dueDate, input.purpose, input.letterTemplate || null, input.customEmailSubject || null, input.customEmailBody || null);
    const callId = Number(callResult.lastInsertRowid);
    const lps = db.prepare(`SELECT * FROM lp_accounts WHERE status IN ('active', 'pending')`).all() as AnyObj[];
    const totalCommitment = lps.reduce((s, lp) => s + Number(lp.commitment || 0), 0);
    if (lps.length === 0 || totalCommitment <= 0) throw new Error('No eligible LP accounts found with commitments.');
    const insertItem = db.prepare(`INSERT INTO capital_call_items (capital_call_id, lp_account_id, amount, status) VALUES (?, ?, ?, 'pending')`);
    const items: Array<{ lpId: number; lpName: string; amount: number }> = [];
    for (const lp of lps) {
      const amount = Number(input.totalAmount) * (Number(lp.commitment || 0) / totalCommitment);
      insertItem.run(callId, lp.id, amount);
      recalcCalledCapitalForLpSqlite(db, Number(lp.id));
      items.push({ lpId: Number(lp.id), lpName: String(lp.name || ''), amount });
    }
    return { callId, callNumber, items };
  };

  if (!shouldUsePgWrite()) return sqliteFlow();

  const pgFlow = await withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const next = await client.query('SELECT COALESCE(MAX(call_number), 0)::int + 1 AS next FROM capital_calls');
      const callNumber = Number(next.rows[0]?.next || 1);
      const call = await client.query(
        `
        INSERT INTO capital_calls (
          call_number, total_amount, call_date, due_date, purpose, status, letter_template, custom_email_subject, custom_email_body
        )
        VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8)
        RETURNING id
        `,
        [callNumber, input.totalAmount, input.callDate, input.dueDate, input.purpose, input.letterTemplate || null, input.customEmailSubject || null, input.customEmailBody || null]
      );
      const callId = Number(call.rows[0]?.id);
      const lps = (await client.query(`SELECT * FROM lp_accounts WHERE status IN ('active', 'pending')`)).rows as AnyObj[];
      const totalCommitment = lps.reduce((s, lp) => s + Number(lp.commitment || 0), 0);
      if (lps.length === 0 || totalCommitment <= 0) throw new Error('No eligible LP accounts found with commitments.');
      const items: Array<{ lpId: number; lpName: string; amount: number }> = [];
      for (const lp of lps) {
        const amount = Number(input.totalAmount) * (Number(lp.commitment || 0) / totalCommitment);
        await client.query(
          `INSERT INTO capital_call_items (capital_call_id, lp_account_id, amount, status) VALUES ($1, $2, $3, 'pending')`,
          [callId, lp.id, amount]
        );
        await client.query(
          `
          UPDATE lp_accounts
          SET called_capital = COALESCE((
            SELECT SUM(cci.amount)
            FROM capital_call_items cci
            JOIN capital_calls cc ON cc.id = cci.capital_call_id
            WHERE cci.lp_account_id = lp_accounts.id
              AND cc.status IN ('sent', 'partially_received', 'completed')
          ), 0)
          WHERE id = $1
          `,
          [lp.id]
        );
        items.push({ lpId: Number(lp.id), lpName: String(lp.name || ''), amount });
      }
      await client.query('COMMIT');
      return { callId, callNumber, items };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  if (dualWriteEnabled()) {
    try {
      sqliteFlow();
    } catch (error) {
      console.error('[dual-write][lp] SQLite shadow write failed in createCapitalCallWithItems:', error);
    }
  }
  return pgFlow;
}

export async function markCapitalCallItemReceived(input: {
  callId: number;
  itemId: number;
  receivedAmount?: number;
  receiptReference?: string;
  bankTxnId?: string;
}): Promise<void> {
  const sqliteFlow = () => {
    const db = getDb();
    const item = db.prepare(`
      SELECT *
      FROM capital_call_items
      WHERE id = ? AND capital_call_id = ?
    `).get(input.itemId, input.callId) as AnyObj;
    if (!item) throw new Error('Capital call item not found for this call');
    const amount = Number(input.receivedAmount ?? item.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('receivedAmount must be a positive number');
    const expected = Number(item.amount || 0);
    const isPartial = amount < expected;
    db.prepare(`
      UPDATE capital_call_items
      SET status = ?,
          received_at = CURRENT_TIMESTAMP,
          received_amount = ?,
          receipt_reference = COALESCE(?, receipt_reference),
          bank_txn_id = COALESCE(?, bank_txn_id)
      WHERE id = ?
    `).run(isPartial ? 'pending' : 'received', amount, input.receiptReference || null, input.bankTxnId || null, input.itemId);
    const existingTxn = db.prepare(`
      SELECT id FROM capital_transactions
      WHERE capital_call_item_id = ? AND type = 'call'
      ORDER BY id ASC
      LIMIT 1
    `).get(input.itemId) as AnyObj;
    if (existingTxn?.id) {
      db.prepare(`
        UPDATE capital_transactions
        SET amount = ?, date = date('now'), notes = 'Capital call received'
        WHERE id = ?
      `).run(amount, Number(existingTxn.id));
    } else {
      db.prepare(`
        INSERT INTO capital_transactions (lp_account_id, capital_call_item_id, type, amount, date, notes)
        VALUES (?, ?, 'call', ?, date('now'), 'Capital call received')
      `).run(item.lp_account_id, item.id, amount);
    }
    recalcCalledCapitalForLpSqlite(db, Number(item.lp_account_id));
    const agg = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) as received_count,
        COUNT(*) as total_count
      FROM capital_call_items
      WHERE capital_call_id = ?
    `).get(input.callId) as AnyObj;
    if (agg) {
      const nextStatus =
        Number(agg.received_count) === 0 ? 'sent' :
        Number(agg.received_count) < Number(agg.total_count) ? 'partially_received' :
        'completed';
      db.prepare(`UPDATE capital_calls SET status = ? WHERE id = ?`).run(nextStatus, input.callId);
    }
  };

  if (!shouldUsePgWrite()) {
    sqliteFlow();
    return;
  }

  await withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const itemR = await client.query(
        `
        SELECT * FROM capital_call_items
        WHERE id = $1 AND capital_call_id = $2
        `,
        [input.itemId, input.callId]
      );
      const item = itemR.rows[0] as AnyObj | undefined;
      if (!item) throw new Error('Capital call item not found for this call');
      const amount = Number(input.receivedAmount ?? item.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('receivedAmount must be a positive number');
      const expected = Number(item.amount || 0);
      const isPartial = amount < expected;
      await client.query(
        `
        UPDATE capital_call_items
        SET status = $1,
            received_at = CURRENT_TIMESTAMP,
            received_amount = $2,
            receipt_reference = COALESCE($3, receipt_reference),
            bank_txn_id = COALESCE($4, bank_txn_id)
        WHERE id = $5
        `,
        [isPartial ? 'pending' : 'received', amount, input.receiptReference || null, input.bankTxnId || null, input.itemId]
      );
      const existingTxn = await client.query(
        `
        SELECT id FROM capital_transactions
        WHERE capital_call_item_id = $1 AND type = 'call'
        ORDER BY id ASC
        LIMIT 1
        `,
        [input.itemId]
      );
      const existingId = Number(existingTxn.rows[0]?.id || 0);
      if (existingId > 0) {
        await client.query(
          `
          UPDATE capital_transactions
          SET amount = $1, date = CURRENT_DATE, notes = 'Capital call received'
          WHERE id = $2
          `,
          [amount, existingId]
        );
      } else {
        await client.query(
          `
          INSERT INTO capital_transactions (lp_account_id, capital_call_item_id, type, amount, date, notes)
          VALUES ($1, $2, 'call', $3, CURRENT_DATE, 'Capital call received')
          `,
          [item.lp_account_id, item.id, amount]
        );
      }
      await client.query(
        `
        UPDATE lp_accounts
        SET called_capital = COALESCE((
          SELECT SUM(cci.amount)
          FROM capital_call_items cci
          JOIN capital_calls cc ON cc.id = cci.capital_call_id
          WHERE cci.lp_account_id = lp_accounts.id
            AND cc.status IN ('sent', 'partially_received', 'completed')
        ), 0)
        WHERE id = $1
        `,
        [item.lp_account_id]
      );
      const agg = await client.query(
        `
        SELECT
          SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END)::int as received_count,
          COUNT(*)::int as total_count
        FROM capital_call_items
        WHERE capital_call_id = $1
        `,
        [input.callId]
      );
      const receivedCount = Number(agg.rows[0]?.received_count || 0);
      const totalCount = Number(agg.rows[0]?.total_count || 0);
      const nextStatus = receivedCount === 0 ? 'sent' : receivedCount < totalCount ? 'partially_received' : 'completed';
      await client.query(`UPDATE capital_calls SET status = $1 WHERE id = $2`, [nextStatus, input.callId]);
      await client.query('COMMIT');
      await recalcCalledCapitalForLpPg(Number(item.lp_account_id));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  if (dualWriteEnabled()) {
    try {
      sqliteFlow();
    } catch (error) {
      console.error('[dual-write][lp] SQLite shadow write failed in markCapitalCallItemReceived:', error);
    }
  }
}

