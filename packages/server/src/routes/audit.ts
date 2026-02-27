import { Router, type Request, type Response } from 'express';
import { getDb } from '../db/database';
import { requireAuth, requireGP } from '../middleware/auth';
import { withPostgresClient } from '../db/postgres-client';
import { isPostgresPrimaryMode, usePostgresReads } from '../db/runtime-mode';

const router = Router();
router.use(requireAuth, requireGP);
const usePostgresAudit = () => isPostgresPrimaryMode() || usePostgresReads();

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

router.get('/chart-of-accounts', async (req: Request, res: Response) => {
  const sql = `
    SELECT coa.*, f.code as fund_code, f.name as fund_name
    FROM chart_of_accounts coa
    LEFT JOIN funds f ON f.id = coa.fund_id
    ORDER BY coa.fund_id, coa.account_code
  `;
  const rows = usePostgresAudit()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(sql);
      return result.rows;
    })
    : getDb().prepare(sql).all();
  res.json(rows);
});

router.get('/posting-policies', async (req: Request, res: Response) => {
  const sql = `
    SELECT
      pp.*,
      da.account_code as debit_account_code,
      da.account_name as debit_account_name,
      ca.account_code as credit_account_code,
      ca.account_name as credit_account_name
    FROM posting_policies pp
    LEFT JOIN chart_of_accounts da ON da.id = pp.debit_account_id
    LEFT JOIN chart_of_accounts ca ON ca.id = pp.credit_account_id
    ORDER BY pp.category
  `;
  const rows = usePostgresAudit()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(sql);
      return result.rows;
    })
    : getDb().prepare(sql).all();
  res.json(rows);
});

router.get('/activity-feed', async (req: Request, res: Response) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)));
  const auditSql = `
    SELECT at as event_at, action, table_name, record_id, actor_email, ip, request_id, 'audit_log' as source
    FROM audit_log
    ORDER BY at DESC
    LIMIT ?
  `;
  const gateSql = `
    SELECT created_at as event_at, reason as action, 'investor_gate_attempts' as table_name, CAST(id AS TEXT) as record_id,
           NULL as actor_email, ip, NULL as request_id, 'investor_gate' as source
    FROM investor_gate_attempts
    ORDER BY created_at DESC
    LIMIT ?
  `;
  const { auditRows, gateRows } = usePostgresAudit()
    ? await withPostgresClient(async (client) => {
      const [auditResult, gateResult] = await Promise.all([
        client.query(auditSql.replace('?', '$1'), [limit]),
        client.query(gateSql.replace('?', '$1'), [limit]),
      ]);
      return {
        auditRows: auditResult.rows as any[],
        gateRows: gateResult.rows as any[],
      };
    })
    : (() => {
      const db = getDb();
      return {
        auditRows: db.prepare(auditSql).all(limit) as any[],
        gateRows: db.prepare(gateSql).all(limit) as any[],
      };
    })();
  const rows = [...auditRows, ...gateRows]
    .sort((a, b) => String(b.event_at).localeCompare(String(a.event_at)))
    .slice(0, limit);
  res.json(rows);
});

router.get('/close-pack/:month', async (req: Request, res: Response) => {
  const month = String(req.params.month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: 'Month must be YYYY-MM' });
    return;
  }
  const from = `${month}-01`;
  const to = `${month}-31`;

  const trialBalanceSql = `
    SELECT
      coa.account_code,
      coa.account_name,
      coa.account_type,
      ROUND(SUM(COALESCE(jel.debit, 0) - COALESCE(jel.credit, 0)), 2) as net_balance
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN chart_of_accounts coa ON coa.id = jel.account_id
    WHERE je.entry_date >= ? AND je.entry_date <= ?
    GROUP BY coa.id
    ORDER BY coa.account_code
  `;

  const pnlSql = `
    SELECT
      coa.account_code,
      coa.account_name,
      coa.account_type,
      ROUND(SUM(COALESCE(jel.credit, 0) - COALESCE(jel.debit, 0)), 2) as amount
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN chart_of_accounts coa ON coa.id = jel.account_id
    WHERE je.entry_date >= ? AND je.entry_date <= ?
      AND coa.account_type IN ('revenue', 'expense')
    GROUP BY coa.id
    ORDER BY coa.account_code
  `;

  const balanceSheetSql = `
    SELECT
      coa.account_code,
      coa.account_name,
      coa.account_type,
      ROUND(SUM(COALESCE(jel.debit, 0) - COALESCE(jel.credit, 0)), 2) as amount
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN chart_of_accounts coa ON coa.id = jel.account_id
    WHERE je.entry_date <= ?
      AND coa.account_type IN ('asset', 'liability', 'equity')
    GROUP BY coa.id
    ORDER BY coa.account_code
  `;

  const rollupSql = `
    SELECT
      category,
      ROUND(SUM(amount), 2) as amount,
      COUNT(*) as rows
    FROM cash_flow_actuals
    WHERE reconciled = 1 AND date >= ? AND date <= ?
    GROUP BY category
    ORDER BY category
  `;
  const trialBalancePgSql = `
    SELECT
      coa.account_code,
      coa.account_name,
      coa.account_type,
      ROUND(SUM(COALESCE(jel.debit, 0) - COALESCE(jel.credit, 0)), 2) as net_balance
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN chart_of_accounts coa ON coa.id = jel.account_id
    WHERE je.entry_date >= $1 AND je.entry_date <= $2
    GROUP BY coa.id
    ORDER BY coa.account_code
  `;
  const pnlPgSql = `
    SELECT
      coa.account_code,
      coa.account_name,
      coa.account_type,
      ROUND(SUM(COALESCE(jel.credit, 0) - COALESCE(jel.debit, 0)), 2) as amount
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN chart_of_accounts coa ON coa.id = jel.account_id
    WHERE je.entry_date >= $1 AND je.entry_date <= $2
      AND coa.account_type IN ('revenue', 'expense')
    GROUP BY coa.id
    ORDER BY coa.account_code
  `;
  const balanceSheetPgSql = `
    SELECT
      coa.account_code,
      coa.account_name,
      coa.account_type,
      ROUND(SUM(COALESCE(jel.debit, 0) - COALESCE(jel.credit, 0)), 2) as amount
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN chart_of_accounts coa ON coa.id = jel.account_id
    WHERE je.entry_date <= $1
      AND coa.account_type IN ('asset', 'liability', 'equity')
    GROUP BY coa.id
    ORDER BY coa.account_code
  `;
  const rollupPgSql = `
    SELECT
      category,
      ROUND(SUM(amount), 2) as amount,
      COUNT(*) as rows
    FROM cash_flow_actuals
    WHERE reconciled = 1 AND date >= $1 AND date <= $2
    GROUP BY category
    ORDER BY category
  `;
  const { trialBalance, pnl, balanceSheet, reconciledOnlyRollup } = usePostgresAudit()
    ? await withPostgresClient(async (client) => {
      const [tb, p, bs, rr] = await Promise.all([
        client.query(trialBalancePgSql, [from, to]),
        client.query(pnlPgSql, [from, to]),
        client.query(balanceSheetPgSql, [to]),
        client.query(rollupPgSql, [from, to]),
      ]);
      return {
        trialBalance: tb.rows,
        pnl: p.rows,
        balanceSheet: bs.rows,
        reconciledOnlyRollup: rr.rows,
      };
    })
    : (() => {
      const db = getDb();
      return {
        trialBalance: db.prepare(trialBalanceSql).all(from, to),
        pnl: db.prepare(pnlSql).all(from, to),
        balanceSheet: db.prepare(balanceSheetSql).all(to),
        reconciledOnlyRollup: db.prepare(rollupSql).all(from, to),
      };
    })();

  res.json({
    month,
    period: { from, to },
    trialBalance,
    pnl,
    balanceSheet,
    reconciledOnlyRollup,
  });
});

router.post('/journal/rebuild', async (req: Request, res: Response) => {
  if (usePostgresAudit()) {
    const rebuilt = await withPostgresClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(`DELETE FROM journal_entry_lines`);
        await client.query(`DELETE FROM journal_entries`);
        const policiesResult = await client.query(`
          SELECT category, debit_account_id, credit_account_id, memo_template
          FROM posting_policies
          WHERE debit_account_id IS NOT NULL AND credit_account_id IS NOT NULL
        `);
        const policies = policiesResult.rows as Array<{ category: string; debit_account_id: number; credit_account_id: number; memo_template: string | null }>;
        const map = new Map(policies.map((p) => [p.category, p]));
        const actualsResult = await client.query(`
          SELECT id, date, category, amount, description, entity_id, portfolio_unit_id, lp_account_id
          FROM cash_flow_actuals
          WHERE reconciled = 1
          ORDER BY date ASC, id ASC
        `);
        const actuals = actualsResult.rows as any[];
        let count = 0;
        for (const row of actuals) {
          const policy = map.get(String(row.category));
          if (!policy) continue;
          const amount = Math.abs(Number(row.amount || 0));
          if (!amount) continue;
          const entryResult = await client.query(
            `INSERT INTO journal_entries (fund_id, entry_date, source_type, source_id, entity_id, description, posted_by)
             VALUES (1, $1, $2, $3, $4, $5, 'system')
             RETURNING id`,
            [row.date, 'cash_flow_actual', String(row.id), row.entity_id || null, row.description || null]
          );
          const entryId = Number(entryResult.rows[0]?.id || 0);
          await client.query(
            `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, entity_id, unit_id, lp_account_id, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [entryId, policy.debit_account_id, amount, 0, row.entity_id || null, row.portfolio_unit_id || null, row.lp_account_id || null, policy.memo_template || null]
          );
          await client.query(
            `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, entity_id, unit_id, lp_account_id, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [entryId, policy.credit_account_id, 0, amount, row.entity_id || null, row.portfolio_unit_id || null, row.lp_account_id || null, policy.memo_template || null]
          );
          count += 1;
        }
        await client.query('COMMIT');
        return count;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
    res.json({ success: true, rebuilt });
    return;
  }

  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM journal_entry_lines`).run();
    db.prepare(`DELETE FROM journal_entries`).run();
    const policies = db.prepare(`
      SELECT category, debit_account_id, credit_account_id, memo_template
      FROM posting_policies
      WHERE debit_account_id IS NOT NULL AND credit_account_id IS NOT NULL
    `).all() as Array<{ category: string; debit_account_id: number; credit_account_id: number; memo_template: string | null }>;
    const map = new Map(policies.map((p) => [p.category, p]));
    const actuals = db.prepare(`
      SELECT id, date, category, amount, description, entity_id, portfolio_unit_id, lp_account_id
      FROM cash_flow_actuals
      WHERE reconciled = 1
      ORDER BY date ASC, id ASC
    `).all() as any[];
    const insertEntry = db.prepare(`
      INSERT INTO journal_entries (fund_id, entry_date, source_type, source_id, entity_id, description, posted_by)
      VALUES (1, ?, ?, ?, ?, ?, 'system')
    `);
    const insertLine = db.prepare(`
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, entity_id, unit_id, lp_account_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let count = 0;
    for (const row of actuals) {
      const policy = map.get(String(row.category));
      if (!policy) continue;
      const amount = Math.abs(Number(row.amount || 0));
      if (!amount) continue;
      const entry = insertEntry.run(row.date, 'cash_flow_actual', String(row.id), row.entity_id || null, row.description || null);
      const entryId = Number(entry.lastInsertRowid);
      insertLine.run(entryId, policy.debit_account_id, amount, 0, row.entity_id || null, row.portfolio_unit_id || null, row.lp_account_id || null, policy.memo_template || null);
      insertLine.run(entryId, policy.credit_account_id, 0, amount, row.entity_id || null, row.portfolio_unit_id || null, row.lp_account_id || null, policy.memo_template || null);
      count += 1;
    }
    return count;
  });
  const rebuilt = tx();
  res.json({ success: true, rebuilt });
});

router.get('/exports/:month', async (req: Request, res: Response) => {
  const month = String(req.params.month || '').trim();
  const mode = String(req.query.mode || 'quickbooks').trim().toLowerCase() === 'tax' ? 'tax' : 'quickbooks';
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: 'Month must be YYYY-MM' });
    return;
  }
  const from = `${month}-01`;
  const to = `${month}-31`;

  const sql = `
    SELECT
      je.entry_date,
      je.source_type,
      je.source_id,
      je.description,
      coa.account_code,
      coa.account_name,
      coa.account_type,
      jel.debit,
      jel.credit,
      jel.notes
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN chart_of_accounts coa ON coa.id = jel.account_id
    WHERE je.entry_date >= ? AND je.entry_date <= ?
    ORDER BY je.entry_date, je.id, jel.id
  `;
  const pgSql = `
    SELECT
      je.entry_date,
      je.source_type,
      je.source_id,
      je.description,
      coa.account_code,
      coa.account_name,
      coa.account_type,
      jel.debit,
      jel.credit,
      jel.notes
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN chart_of_accounts coa ON coa.id = jel.account_id
    WHERE je.entry_date >= $1 AND je.entry_date <= $2
    ORDER BY je.entry_date, je.id, jel.id
  `;
  let rows: any[] = [];
  try {
    rows = usePostgresAudit()
      ? await withPostgresClient(async (client) => {
        const result = await client.query(pgSql, [from, to]);
        return result.rows as any[];
      })
      : (getDb().prepare(sql).all(from, to) as any[]);
  } catch {
    // Fallback for environments that haven't created accounting journal tables yet.
    const fallbackSql = `
      SELECT id, date, amount, category, description
      FROM cash_flow_actuals
      WHERE date >= ? AND date <= ?
      ORDER BY date, id
    `;
    const fallbackRows = usePostgresAudit()
      ? await withPostgresClient(async (client) => {
        const result = await client.query(
          fallbackSql.replace('date >= ? AND date <= ?', 'date >= $1 AND date <= $2'),
          [from, to]
        );
        return result.rows as any[];
      })
      : (getDb().prepare(fallbackSql).all(from, to) as any[]);
    rows = fallbackRows.map((r: any) => {
      const amt = Number(r.amount || 0);
      return {
        entry_date: r.date,
        source_type: 'cash_flow_actual',
        source_id: r.id,
        description: r.description || r.category || '',
        account_code: '',
        account_name: r.category || '',
        debit: amt > 0 ? amt : 0,
        credit: amt < 0 ? Math.abs(amt) : 0,
        notes: r.description || '',
      };
    });
  }

  const header = mode === 'tax'
    ? ['Date', 'SourceType', 'SourceId', 'AccountCode', 'AccountName', 'Debit', 'Credit', 'Memo']
    : ['TxnDate', 'Account', 'AccountCode', 'Debit', 'Credit', 'Memo', 'SourceType', 'SourceId'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const values = mode === 'tax'
      ? [r.entry_date, r.source_type, r.source_id, r.account_code, r.account_name, r.debit, r.credit, r.description || r.notes || '']
      : [r.entry_date, r.account_name, r.account_code, r.debit, r.credit, r.description || r.notes || '', r.source_type, r.source_id];
    lines.push(values.map(csvEscape).join(','));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${mode}-ledger-${month}.csv"`);
  res.send(lines.join('\n'));
});

export default router;
