import { getDb } from '../database';
import { withPostgresClient } from '../postgres-client';
import { sqliteFallbackEnabled, usePostgresActualsRoutes, usePostgresReads } from '../runtime-mode';

type QueryFilters = {
  unit_id?: number;
  entity_id?: number;
  category?: string;
  reconciled?: boolean;
  upload_id?: number;
  limit?: number;
  offset?: number;
};

type AnyObj = Record<string, any>;

function baseSql(
  actualsTable: 'cash_flow_actuals' | 'cash_flows_actual' = 'cash_flow_actuals',
  includeBankTransactions = true
) {
  const bankAmountSelect = includeBankTransactions ? 'bt.amount' : 'NULL';
  const bankDescSelect = includeBankTransactions ? 'bt.description' : 'NULL';
  const bankJoin = includeBankTransactions
    ? 'LEFT JOIN bank_transactions bt ON cfa.bank_transaction_id = bt.id'
    : '';
  return `SELECT
      cfa.*,
      ${bankAmountSelect} as bank_amount,
      ${bankDescSelect} as bank_description,
      e.name as entity_name,
      ur.description as renovation_description,
      pu.id as portfolio_unit_id,
      bu.unit_number,
      lpa.name as lp_name,
      cci.capital_call_id, cc.call_number
    FROM ${actualsTable} cfa
    ${bankJoin}
    LEFT JOIN portfolio_units pu ON cfa.portfolio_unit_id = pu.id
    LEFT JOIN entities e ON cfa.entity_id = e.id
    LEFT JOIN unit_renovations ur ON cfa.unit_renovation_id = ur.id
    LEFT JOIN building_units bu ON pu.building_unit_id = bu.id
    LEFT JOIN lp_accounts lpa ON cfa.lp_account_id = lpa.id
    LEFT JOIN capital_call_items cci ON cfa.capital_call_item_id = cci.id
    LEFT JOIN capital_calls cc ON cci.capital_call_id = cc.id
    WHERE 1=1`;
}

async function resolvePostgresActualsMetadata(): Promise<{
  actualsTable: 'cash_flow_actuals' | 'cash_flows_actual';
  hasBankTransactions: boolean;
}> {
  return withPostgresClient(async (client) => {
    const result = await client.query(
      `
      SELECT
        to_regclass('public.cash_flow_actuals') as canonical,
        to_regclass('public.cash_flows_actual') as legacy,
        to_regclass('public.bank_transactions') as bank_transactions
      `
    );
    const row = result.rows[0] as {
      canonical?: string | null;
      legacy?: string | null;
      bank_transactions?: string | null;
    } | undefined;
    const actualsTable = row?.canonical ? 'cash_flow_actuals' : row?.legacy ? 'cash_flows_actual' : 'cash_flow_actuals';
    return {
      actualsTable,
      hasBankTransactions: !!row?.bank_transactions,
    };
  });
}

export async function listActualTransactions(filters: QueryFilters): Promise<AnyObj[]> {
  const limit = Math.max(1, Math.min(1000, Number(filters.limit ?? 100)));
  const offset = Math.max(0, Number(filters.offset ?? 0));

  if (usePostgresReads() || usePostgresActualsRoutes()) {
    try {
      const { actualsTable, hasBankTransactions } = await resolvePostgresActualsMetadata();
      return await withPostgresClient(async (client) => {
        let sql = baseSql(actualsTable, hasBankTransactions);
        const params: any[] = [];
        const bind = (v: any) => {
          params.push(v);
          return `$${params.length}`;
        };
        if (filters.unit_id) sql += ` AND cfa.portfolio_unit_id = ${bind(filters.unit_id)}`;
        if (filters.entity_id) sql += ` AND cfa.entity_id = ${bind(filters.entity_id)}`;
        if (filters.category) sql += ` AND cfa.category = ${bind(filters.category)}`;
        if (filters.reconciled !== undefined) sql += ` AND cfa.reconciled = ${bind(filters.reconciled ? 1 : 0)}`;
        if (filters.upload_id && hasBankTransactions) sql += ` AND bt.bank_upload_id = ${bind(filters.upload_id)}`;
        if (filters.upload_id && !hasBankTransactions) return [] as AnyObj[];
        sql += ` ORDER BY cfa.date DESC LIMIT ${bind(limit)} OFFSET ${bind(offset)}`;
        const r = await client.query(sql, params);
        return r.rows as AnyObj[];
      });
    } catch {
      if (!sqliteFallbackEnabled()) throw new Error('Postgres read failed and SQLite fallback is disabled');
    }
  }

  const db = getDb();
  let sql = baseSql();
  const params: any[] = [];
  if (filters.unit_id) {
    sql += ` AND cfa.portfolio_unit_id = ?`;
    params.push(filters.unit_id);
  }
  if (filters.entity_id) {
    sql += ` AND cfa.entity_id = ?`;
    params.push(filters.entity_id);
  }
  if (filters.category) {
    sql += ` AND cfa.category = ?`;
    params.push(filters.category);
  }
  if (filters.reconciled !== undefined) {
    sql += ` AND cfa.reconciled = ?`;
    params.push(filters.reconciled ? 1 : 0);
  }
  if (filters.upload_id) {
    sql += ` AND bt.bank_upload_id = ?`;
    params.push(filters.upload_id);
  }
  sql += ` ORDER BY cfa.date DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  return db.prepare(sql).all(...params) as AnyObj[];
}

