/**
 * LP Portal routes (read-only for LP users).
 * Also investor onboarding and capital call management (GP only).
 */

import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';
import { requireAuth, requireGP, requireAnyRole } from '../middleware/auth';
import {
  projectCashFlows,
  generateDefaultAcquisitionSchedule,
  calcMOIC,
  xirr,
} from '@brickell/engine';
import type { FundAssumptions } from '@brickell/shared';
import type { AcquisitionSchedule } from '@brickell/engine';
import { sendTransactionalEmail } from '../lib/email';
import { readStoredFile } from '../lib/storage';
import {
  createCapitalCallWithItems,
  getLpAccountByUserId,
  listCapitalCallsAll,
  listLpTransactions,
  markCapitalCallItemReceived,
} from '../db/repositories/lp-repository';
import { usePostgresLpRoutes, usePostgresReads } from '../db/runtime-mode';

const router = Router();

function recalcCalledCapitalForLp(db: ReturnType<typeof getDb>, lpAccountId: number) {
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

function recalcLpOwnershipPct(db: ReturnType<typeof getDb>) {
  db.prepare(`
    WITH totals AS (
      SELECT COALESCE(SUM(commitment), 0) as total_commitment
      FROM lp_accounts
      WHERE status != 'inactive'
    )
    UPDATE lp_accounts
    SET ownership_pct = CASE
      WHEN status = 'inactive' THEN 0
      WHEN (SELECT total_commitment FROM totals) <= 0 THEN 0
      ELSE commitment / (SELECT total_commitment FROM totals)
    END
  `).run();
}

function rowToAssumptions(row: any): FundAssumptions {
  return {
    id: row.id,
    name: row.name,
    isActive: !!row.is_active,
    fundSize: row.fund_size,
    fundTermYears: row.fund_term_years,
    investmentPeriodYears: row.investment_period_years,
    gpCoinvestPct: row.gp_coinvest_pct,
    mgmtFeeInvestPct: row.mgmt_fee_invest_pct,
    mgmtFeePostPct: row.mgmt_fee_post_pct,
    mgmtFeeWaiver: !!row.mgmt_fee_waiver,
    prefReturnPct: row.pref_return_pct,
    catchupPct: row.catchup_pct,
    tier1SplitLP: row.tier1_split_lp,
    tier1SplitGP: row.tier1_split_gp,
    tier2HurdleIRR: row.tier2_hurdle_irr,
    tier2SplitLP: row.tier2_split_lp,
    tier2SplitGP: row.tier2_split_gp,
    tier3HurdleIRR: row.tier3_hurdle_irr,
    tier3SplitLP: row.tier3_split_lp,
    tier3SplitGP: row.tier3_split_gp,
    refiEnabled: !!row.refi_enabled,
    refiYear: row.refi_year,
    refiLTV: row.refi_ltv,
    refiRate: row.refi_rate,
    refiTermYears: row.refi_term_years,
    refiCostPct: row.refi_cost_pct,
    rentGrowthPct: row.rent_growth_pct,
    hoaGrowthPct: row.hoa_growth_pct,
    taxGrowthPct: row.tax_growth_pct ?? row.hoa_growth_pct,
    vacancyPct: row.vacancy_pct,
    annualFundOpexMode: row.annual_fund_opex_mode === 'threshold_pct' ? 'threshold_pct' : 'fixed',
    annualFundOpexFixed: Number(row.annual_fund_opex_fixed ?? 75_000),
    annualFundOpexThresholdPct: Number(row.annual_fund_opex_threshold_pct ?? 0.02),
    annualFundOpexAdjustPct: Number(row.annual_fund_opex_adjust_pct ?? 0),
    presentDayLandValue: row.present_day_land_value ?? row.land_value_total,
    landValueTotal: row.land_value_total,
    landGrowthPct: row.land_growth_pct,
    landPSF: row.land_psf,
    mmRate: row.mm_rate,
    excessCashMode: row.excess_cash_mode,
    buildingValuation: row.building_valuation,
    bonusIRRThreshold: row.bonus_irr_threshold,
    bonusMaxYears: row.bonus_max_years,
    bonusYieldThreshold: row.bonus_yield_threshold,
    createdAt: row.created_at,
  };
}

function getPortfolioData(db: ReturnType<typeof getDb>) {
  const units = db.prepare(`
    SELECT
      pu.purchase_date,
      pu.purchase_price,
      pu.total_acquisition_cost,
      COALESCE(pu.monthly_rent, 0) as monthly_rent,
      COALESCE(pu.monthly_hoa, 0) as monthly_hoa,
      COALESCE(pu.monthly_insurance, 0) as annual_insurance,
      COALESCE(pu.monthly_tax, 0) as annual_tax
    FROM portfolio_units pu
    ORDER BY pu.purchase_date
  `).all() as any[];

  const ownershipRow = db.prepare(`
    SELECT COALESCE(SUM(ut.ownership_pct), 0) as total_ownership_pct
    FROM portfolio_units pu
    JOIN building_units bu ON pu.building_unit_id = bu.id
    JOIN unit_types ut ON bu.unit_type_id = ut.id
  `).get() as any;

  if (units.length === 0) return null;

  const totalRent = units.reduce((s: number, u: any) => s + u.monthly_rent, 0);
  const totalHOA = units.reduce((s: number, u: any) => s + u.monthly_hoa, 0);
  const totalAnnualInsurance = units.reduce((s: number, u: any) => s + u.annual_insurance, 0);
  const totalAnnualTax = units.reduce((s: number, u: any) => s + u.annual_tax, 0);
  const count = units.length;

  const acqMap = new Map<number, { units: number; totalCost: number }>();
  for (const u of units) {
    const d = new Date(u.purchase_date);
    const yearOff = d.getFullYear() - 2026;
    const qIdx = yearOff * 4 + Math.floor(d.getMonth() / 3);
    const quarter = Math.max(0, qIdx);
    const existing = acqMap.get(quarter) || { units: 0, totalCost: 0 };
    existing.units += 1;
    existing.totalCost += u.total_acquisition_cost || u.purchase_price || 500_000;
    acqMap.set(quarter, existing);
  }

  const acquisitions: AcquisitionSchedule[] = [];
  for (const [quarter, data] of acqMap) {
    acquisitions.push({
      quarter,
      units: data.units,
      costPerUnit: data.totalCost / data.units,
    });
  }

  return {
    acquisitions,
    avgRent: totalRent / count,
    avgHOA: totalHOA / count,
    avgAnnualInsurance: totalAnnualInsurance / count,
    avgAnnualTax: totalAnnualTax / count,
    annualFundOpex: 75_000,
    totalOwnershipPct: ownershipRow.total_ownership_pct > 0 ? ownershipRow.total_ownership_pct / 100 : undefined,
  };
}

function fmtMoney(value: number) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function storageKeyFromFilePath(filePath: string): string | null {
  const fp = String(filePath || '').trim();
  if (!fp) return null;
  if (fp.startsWith('/api/files/')) return decodeURIComponent(fp.replace('/api/files/', ''));
  if (fp.startsWith('/uploads/')) return fp.replace('/uploads/', '');
  return fp;
}

function renderMergeTemplate(tpl: string, vars: Record<string, string>) {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), v);
  }
  return out;
}

// ---- LP Read-Only Routes ----

// GET /api/lp/account - My capital account
router.get('/account', requireAuth, requireAnyRole, async (req: Request, res: Response) => {
  try {
    const account = await getLpAccountByUserId(Number(req.user!.userId));
    if (!account) {
      res.status(404).json({ error: 'No LP account found for this user' });
      return;
    }
    res.json(account);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to load LP account' });
  }
});

// GET /api/lp/transactions - My capital calls + distributions
router.get('/transactions', requireAuth, requireAnyRole, async (req: Request, res: Response) => {
  const db = getDb();
  const account = db.prepare('SELECT id FROM lp_accounts WHERE user_id = ?').get(req.user!.userId) as any;
  if (!account) {
    res.status(404).json({ error: 'No LP account found' });
    return;
  }
  try {
    if (usePostgresReads() || usePostgresLpRoutes()) {
      const transactions = await listLpTransactions(Number(account.id));
      res.json(transactions);
      return;
    }
  } catch (error) {
    // Fall back to SQLite below unless fallback has been disabled in runtime.
  }
  const transactions = db.prepare(`
    SELECT * FROM capital_transactions
    WHERE lp_account_id = ?
    ORDER BY date DESC
  `).all(account.id);
  res.json(transactions);
});

// GET /api/lp/ledger - Read-only fund ledger with allocation metadata
router.get('/ledger', requireAuth, requireAnyRole, (req: Request, res: Response) => {
  const db = getDb();
  const account = db.prepare('SELECT id FROM lp_accounts WHERE user_id = ?').get(req.user!.userId) as any;
  if (!account) {
    res.status(404).json({ error: 'No LP account found' });
    return;
  }
  const limitRaw = Number(req.query.limit ?? 250);
  const offsetRaw = Number(req.query.offset ?? 0);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : 250;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
  const category = String(req.query.category || '').trim();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const search = String(req.query.search || '').trim();

  let sql = `
    SELECT
      cfa.id,
      cfa.date,
      cfa.amount,
      cfa.category,
      cfa.description,
      cfa.reconciled,
      cfa.statement_ref,
      cfa.source_file,
      cfa.portfolio_unit_id,
      cfa.entity_id,
      cfa.unit_renovation_id,
      cfa.lp_account_id,
      cfa.capital_call_item_id,
      bt.bank_upload_id,
      bupload.filename as upload_filename,
      bu.unit_number,
      e.name as entity_name,
      ur.description as renovation_description,
      lpa.name as lp_name,
      cci.capital_call_id,
      cc.call_number,
      CASE
        WHEN cfa.portfolio_unit_id IS NOT NULL THEN 'unit'
        WHEN cfa.entity_id IS NOT NULL THEN 'entity'
        WHEN cfa.lp_account_id IS NOT NULL THEN 'lp'
        ELSE 'fund'
      END as assignment_scope
    FROM cash_flow_actuals cfa
    LEFT JOIN bank_transactions bt ON bt.id = cfa.bank_transaction_id
    LEFT JOIN bank_uploads bupload ON bupload.id = bt.bank_upload_id
    LEFT JOIN portfolio_units pu ON pu.id = cfa.portfolio_unit_id
    LEFT JOIN building_units bu ON bu.id = pu.building_unit_id
    LEFT JOIN entities e ON e.id = cfa.entity_id
    LEFT JOIN unit_renovations ur ON ur.id = cfa.unit_renovation_id
    LEFT JOIN lp_accounts lpa ON lpa.id = cfa.lp_account_id
    LEFT JOIN capital_call_items cci ON cci.id = cfa.capital_call_item_id
    LEFT JOIN capital_calls cc ON cc.id = cci.capital_call_id
    WHERE cfa.reconciled = 1
      AND (cfa.lp_account_id IS NULL OR cfa.lp_account_id = ?)
  `;
  const params: any[] = [Number(account.id)];
  if (category) {
    sql += ` AND cfa.category = ?`;
    params.push(category);
  }
  if (from) {
    sql += ` AND cfa.date >= ?`;
    params.push(from);
  }
  if (to) {
    sql += ` AND cfa.date <= ?`;
    params.push(to);
  }
  if (search) {
    sql += ` AND (
      COALESCE(cfa.description, '') LIKE ? OR
      COALESCE(bu.unit_number, '') LIKE ? OR
      COALESCE(e.name, '') LIKE ? OR
      COALESCE(ur.description, '') LIKE ? OR
      COALESCE(lpa.name, '') LIKE ?
    )`;
    const s = `%${search}%`;
    params.push(s, s, s, s, s);
  }

  sql += ` ORDER BY cfa.date DESC, cfa.id DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// GET /api/lp/capital-calls - My pending/historical calls
router.get('/capital-calls', requireAuth, requireAnyRole, (req: Request, res: Response) => {
  const db = getDb();
  const account = db.prepare('SELECT id FROM lp_accounts WHERE user_id = ?').get(req.user!.userId) as any;
  if (!account) {
    res.status(404).json({ error: 'No LP account found' });
    return;
  }

  const calls = db.prepare(`
    SELECT cci.*, cc.call_number, cc.call_date, cc.due_date, cc.purpose, cc.status as call_status
    FROM capital_call_items cci
    JOIN capital_calls cc ON cci.capital_call_id = cc.id
    WHERE cci.lp_account_id = ?
    ORDER BY cc.call_date DESC
  `).all(account.id);
  res.json(calls);
});

// GET /api/lp/documents - My documents
router.get('/documents', requireAuth, requireAnyRole, (req: Request, res: Response) => {
  const db = getDb();
  const account = db.prepare('SELECT id FROM lp_accounts WHERE user_id = ?').get(req.user!.userId) as any;
  if (!account) {
    res.status(404).json({ error: 'No LP account found' });
    return;
  }

  const docs = db.prepare(`
    SELECT * FROM documents
    WHERE (parent_type = 'lp' AND parent_id = ?) OR parent_type = 'fund'
    ORDER BY uploaded_at DESC
  `).all(account.id);
  res.json(docs);
});

function toMonthKey(dateIso: string): string {
  const d = new Date(dateIso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function monthEndDateFromKey(mKey: string): string | null {
  const m = mKey.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(month0) || month0 < 0 || month0 > 11) return null;
  const d = new Date(Date.UTC(year, month0 + 1, 0));
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function interpolateSeries(points: Array<{ date: string; value: number }>, targetDateIso: string): number | null {
  if (!points.length) return null;
  const t = new Date(targetDateIso).getTime();
  if (!Number.isFinite(t)) return null;
  const firstT = new Date(points[0].date).getTime();
  const lastT = new Date(points[points.length - 1].date).getTime();
  if (t <= firstT) return points[0].value;
  if (t >= lastT) return points[points.length - 1].value;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const ta = new Date(a.date).getTime();
    const tb = new Date(b.date).getTime();
    if (t < ta || t > tb) continue;
    const span = tb - ta;
    const frac = span > 0 ? (t - ta) / span : 0;
    return a.value + frac * (b.value - a.value);
  }
  return points[points.length - 1].value;
}

// GET /api/lp/marks - Monthly LP marks (contrib/distrib, NAV, TVPI, IRR/MOIC)
router.get('/marks', requireAuth, requireAnyRole, (req: Request, res: Response) => {
  const db = getDb();
  const account = db.prepare(`
    SELECT *
    FROM lp_accounts
    WHERE user_id = ?
  `).get(req.user!.userId) as any;
  if (!account) {
    res.status(404).json({ error: 'No LP account found' });
    return;
  }
  const isActive = String(account.status || '').toLowerCase() === 'active';

  const txns = db.prepare(`
    SELECT id, type, amount, date, notes
    FROM capital_transactions
    WHERE lp_account_id = ?
    ORDER BY date ASC, id ASC
  `).all(account.id) as Array<{ id: number; type: 'call' | 'distribution'; amount: number; date: string; notes: string | null }>;

  const byMonth: Record<string, { month: string; contributions: number; distributions: number; net: number; ending_balance: number; cumulative_contributed: number; cumulative_distributed: number }> = {};
  let cumulativeContrib = 0;
  let cumulativeDistrib = 0;

  // XIRR flows: calls are negative (LP cash out), distributions positive (cash in).
  const irrFlows: Array<{ amount: number; date: Date }> = [];

  for (const t of txns) {
    const m = toMonthKey(t.date);
    if (!byMonth[m]) {
      byMonth[m] = {
        month: m,
        contributions: 0,
        distributions: 0,
        net: 0,
        ending_balance: 0,
        cumulative_contributed: 0,
        cumulative_distributed: 0,
      };
    }
    if (t.type === 'call') {
      byMonth[m].contributions += Number(t.amount || 0);
      irrFlows.push({ amount: -Math.abs(Number(t.amount || 0)), date: new Date(t.date) });
    } else if (t.type === 'distribution') {
      byMonth[m].distributions += Number(t.amount || 0);
      irrFlows.push({ amount: Math.abs(Number(t.amount || 0)), date: new Date(t.date) });
    }
  }

  const sortedMonths = Object.keys(byMonth).sort();
  for (const m of sortedMonths) {
    const row = byMonth[m];
    row.net = row.distributions - row.contributions;
    cumulativeContrib += row.contributions;
    cumulativeDistrib += row.distributions;
    row.cumulative_contributed = cumulativeContrib;
    row.cumulative_distributed = cumulativeDistrib;
    row.ending_balance = cumulativeContrib - cumulativeDistrib;
  }

  const totalContributed = cumulativeContrib;
  const totalDistributed = cumulativeDistrib;
  const moic = totalContributed > 0 ? totalDistributed / totalContributed : 0;

  let irr: number | null = null;
  const hasFundedCapital = Number(account.called_capital || 0) > 0;
  if (isActive && hasFundedCapital) {
    try {
      const hasPos = irrFlows.some((f) => f.amount > 0);
      const hasNeg = irrFlows.some((f) => f.amount < 0);
      if (irrFlows.length >= 2 && hasPos && hasNeg) {
        irr = xirr(irrFlows);
      }
    } catch {
      irr = null;
    }
  }

  // --- FRED-based NAV marks (quarterly + straight-line interpolation) ---
  const MIAMI_INDEX_SERIES = 'MIXRNSA';
  const fredRows = db.prepare(`
    SELECT date, value
    FROM fred_data
    WHERE series_id = ?
    ORDER BY date ASC
  `).all(MIAMI_INDEX_SERIES) as Array<{ date: string; value: number }>;

  const monthSeries = fredRows
    .map((r) => ({ date: String(r.date || '').slice(0, 10), value: Number(r.value) }))
    .filter((p) => !!p.date && Number.isFinite(p.value))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const latestFred = monthSeries.length ? monthSeries[monthSeries.length - 1] : null;

  const units = db.prepare(`
    SELECT
      pu.id as unit_id,
      pu.purchase_date,
      COALESCE(pu.total_acquisition_cost, pu.purchase_price) as acquisition_basis
    FROM portfolio_units pu
    WHERE pu.purchase_date IS NOT NULL
  `).all() as Array<{ unit_id: number; purchase_date: string; acquisition_basis: number }>;

  // Renovation/repair spend events (reconciled), used to add into basis only after the spend date.
  // amount convention: statement debits are negative. Basis delta = -amount (so negative -> positive basis add).
  const repairEvents = db.prepare(`
    SELECT portfolio_unit_id as unit_id, date, amount
    FROM cash_flow_actuals
    WHERE portfolio_unit_id IS NOT NULL
      AND reconciled = 1
      AND category = 'repair'
    ORDER BY date ASC, id ASC
  `).all() as Array<{ unit_id: number; date: string; amount: number }>;

  const repairsByUnit = new Map<number, Array<{ date: string; delta: number }>>();
  for (const r of repairEvents) {
    const unitId = Number(r.unit_id);
    const date = String(r.date || '').slice(0, 10);
    if (!unitId || !date) continue;
    const delta = -Number(r.amount || 0);
    const list = repairsByUnit.get(unitId) || [];
    list.push({ date, delta });
    repairsByUnit.set(unitId, list);
  }

  const fundNavByMonth: Record<string, number> = {};

  // Build mark months from FRED months + transaction months (so table doesn't jump around).
  const allMonthKeys = new Set<string>([
    ...Object.keys(byMonth),
    ...monthSeries.map((p) => toMonthKey(p.date)),
  ]);
  const allSortedMonths = Array.from(allMonthKeys).sort();
  const markMonths = allSortedMonths
    .map((m) => ({ month: m, date: monthEndDateFromKey(m) }))
    .filter((m) => !!m.date) as Array<{ month: string; date: string }>;

  for (const m of markMonths) fundNavByMonth[m.month] = 0;

  for (const u of units) {
    const purchaseDate = String(u.purchase_date).slice(0, 10);
    const purchaseIndex = interpolateSeries(monthSeries, purchaseDate);
    if (!purchaseIndex || purchaseIndex === 0) continue;

    const events = (repairsByUnit.get(Number(u.unit_id)) || []).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let i = 0;
    let cumulativeReno = 0;

    for (const mp of markMonths) {
      // Only mark units after they exist.
      if (purchaseDate > mp.date) continue;

      // Add reconciled renovation spend up to this month end.
      while (i < events.length && events[i].date <= mp.date) {
        cumulativeReno += events[i].delta;
        i += 1;
      }

      const basis = Number(u.acquisition_basis || 0) + cumulativeReno;
      const indexAtMark = interpolateSeries(monthSeries, mp.date);
      if (!indexAtMark) continue;
      fundNavByMonth[mp.month] += basis * (Number(indexAtMark) / purchaseIndex);
    }
  }

  const ownershipFrac = Number(account.ownership_pct || 0);

  // Recompute cumulative fields across the union so the table is stable even when a month has no cash movement.
  let cumC = 0;
  let cumD = 0;
  const rows = markMonths.map(({ month }) => {
    const base = byMonth[month] || {
      month,
      contributions: 0,
      distributions: 0,
      net: 0,
      ending_balance: 0,
      cumulative_contributed: 0,
      cumulative_distributed: 0,
    };
    base.net = base.distributions - base.contributions;
    cumC += base.contributions;
    cumD += base.distributions;
    base.cumulative_contributed = cumC;
    base.cumulative_distributed = cumD;
    base.ending_balance = cumC - cumD;

    const fundNav = fundNavByMonth[month] ?? 0;
    const lpNav = fundNav * ownershipFrac;
    const totalValue = cumD + lpNav;
    const tvpi = cumC > 0 ? totalValue / cumC : 0;
    return {
      ...base,
      fund_nav: fundNav,
      lp_nav: lpNav,
      tvpi,
    };
  });

  res.json({
    lp_account_id: account.id,
    commitment: Number(account.commitment || 0),
    called_capital: Number(account.called_capital || 0),
    distributions: Number(account.distributions || 0),
    unfunded: Number(account.commitment || 0) - Number(account.called_capital || 0),
    total_contributed: totalContributed,
    total_distributed: totalDistributed,
    ending_balance: totalContributed - totalDistributed,
    moic,
    irr,
    monthly: rows,
    nav: {
      series_id: MIAMI_INDEX_SERIES,
      latest_fund_nav: rows.length ? rows[rows.length - 1].fund_nav : 0,
      latest_lp_nav: rows.length ? rows[rows.length - 1].lp_nav : 0,
      latest_fred_date: latestFred?.date || null,
      latest_fred_value: latestFred?.value ?? null,
      fred_points: monthSeries.length,
    },
  });
});

// GET /api/lp/documents/:id/download - Secure LP doc download
router.get('/documents/:id/download', requireAuth, requireAnyRole, async (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid document id' });

  const account = db.prepare('SELECT id FROM lp_accounts WHERE user_id = ?').get(req.user!.userId) as any;
  if (!account) return res.status(404).json({ error: 'No LP account found' });

  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
  if (!doc) return res.status(404).json({ error: 'Document not found' });

  const isFundDoc = doc.parent_type === 'fund';
  const isMyLpDoc = doc.parent_type === 'lp' && Number(doc.parent_id) === Number(account.id);
  if (!isFundDoc && !isMyLpDoc) {
    return res.status(403).json({ error: 'Not authorized to access this document' });
  }

  try {
    const storageKey = storageKeyFromFilePath(String(doc.file_path || ''));
    if (!storageKey) return res.status(500).json({ error: 'Unsupported document storage path' });
    const file = await readStoredFile(storageKey);
    res.setHeader('Content-Type', file.contentType || doc.file_type || 'application/octet-stream');
    // Force download; viewing inline is still possible if the browser supports it.
    res.setHeader('Content-Disposition', `attachment; filename="${String(doc.name || 'document').replace(/"/g, '')}"`);
    file.body.pipe(res);
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

// GET /api/lp/performance - Fund performance
router.get('/performance', requireAuth, requireAnyRole, (req: Request, res: Response) => {
  // Return high-level fund metrics (no GP-specific detail)
  const db = getDb();
  const account = db.prepare(`
    SELECT id, status, called_capital
    FROM lp_accounts
    WHERE user_id = ?
  `).get(req.user!.userId) as any;
  if (!account) {
    res.status(404).json({ error: 'No LP account found' });
    return;
  }
  const isActive = String(account.status || '').toLowerCase() === 'active';
  const hasFundedCapital = Number(account.called_capital || 0) > 0;
  const portfolio = db.prepare(`
    SELECT
      COUNT(*) as units,
      COALESCE(SUM(ut.ownership_pct), 0) as ownership_pct,
      COALESCE(SUM(pu.total_acquisition_cost), 0) as total_invested,
      COALESCE(SUM((pu.monthly_rent * 12) - (pu.monthly_hoa * 12) - pu.monthly_insurance - pu.monthly_tax), 0) as annual_noi
    FROM portfolio_units pu
    JOIN building_units bu ON pu.building_unit_id = bu.id
    JOIN unit_types ut ON bu.unit_type_id = ut.id
  `).get() as any;

  let fundMOIC = 0;
  let fundIRR: number | null = null;
  let projectedNetProfit = 0;
  let projectedExitEquity = 0;

  const assumptionRow = db.prepare(`
    SELECT *
    FROM fund_assumptions
    ORDER BY is_active DESC, id ASC
    LIMIT 1
  `).get() as any;

  if (assumptionRow) {
    const assumptions = rowToAssumptions(assumptionRow);
    const portfolioData = getPortfolioData(db);

    const cfInput = portfolioData ? {
      assumptions,
      acquisitions: portfolioData.acquisitions,
      baseMonthlyRent: portfolioData.avgRent,
      baseMonthlyHOA: portfolioData.avgHOA,
      baseAnnualInsurance: portfolioData.avgAnnualInsurance,
      baseAnnualTax: portfolioData.avgAnnualTax,
      annualFundOpex: portfolioData.annualFundOpex,
      totalOwnershipPct: portfolioData.totalOwnershipPct,
    } : {
      assumptions,
      acquisitions: generateDefaultAcquisitionSchedule(assumptions),
      baseMonthlyRent: 2800,
      baseMonthlyHOA: 1400,
      baseAnnualInsurance: 2400,
      baseAnnualTax: 2400,
      annualFundOpex: 75_000,
    };

    const cashFlows = projectCashFlows(cfInput);
    if (cashFlows.length > 0) {
      const totalCapitalDeployed = cashFlows.reduce((s, cf) => s + (cf.capitalCalls || 0), 0);
      const totalNOI = cashFlows.reduce((s, cf) => s + (cf.netOperatingIncome || 0), 0);
      const exitCF = cashFlows[cashFlows.length - 1];
      const totalDistributions = (exitCF.grossSaleProceeds || 0) + (exitCF.mmLiquidation || 0);

      projectedExitEquity = totalDistributions;
      projectedNetProfit = totalDistributions + totalNOI - totalCapitalDeployed;
      fundMOIC = calcMOIC(totalDistributions + totalNOI, totalCapitalDeployed);

      const xirrFlows = cashFlows
        .filter((cf) => Math.abs(cf.netCashFlow || 0) > 0.0001)
        .map((cf) => ({ date: new Date(cf.date), amount: cf.netCashFlow }));

      if (isActive && hasFundedCapital) {
        try {
          fundIRR = xirr(xirrFlows);
        } catch {
          fundIRR = null;
        }
      }
    }
  }

  res.json({
    unitsOwned: portfolio.units || 0,
    ownershipPct: portfolio.ownership_pct || 0,
    totalInvested: portfolio.total_invested || 0,
    annualNOI: portfolio.annual_noi || 0,
    fundMOIC,
    fundIRR,
    projectedNetProfit,
    projectedExitEquity,
  });
});

// ---- GP-Only: Investor Management ----

// POST /api/lp/investors - Onboard new investor (GP only)
router.post('/investors', requireAuth, requireGP, async (req: Request, res: Response) => {
  const db = getDb();
  const { name, entityName, email, phone, commitment, notes } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(name || '').trim();
  const commitmentNum = Number(commitment);

  if (!cleanName) {
    res.status(400).json({ error: 'Name is required' });
    return;
  }
  if (!normalizedEmail) {
    res.status(400).json({ error: 'Email is required' });
    return;
  }
  if (!Number.isFinite(commitmentNum) || commitmentNum <= 0) {
    res.status(400).json({ error: 'Commitment must be a positive number' });
    return;
  }

  let reactivatingLpId: number | null = null;
  let reactivatingLpNotes: string | null = null;
  const existingUser = db.prepare('SELECT id, role FROM users WHERE email = ?').get(normalizedEmail) as any;
  if (existingUser) {
    const existingLp = db.prepare('SELECT id, status, notes FROM lp_accounts WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(existingUser.id) as any;
    if (existingLp) {
      const status = String(existingLp.status || '').toLowerCase();
      if (status === 'inactive') {
        reactivatingLpId = Number(existingLp.id);
        reactivatingLpNotes = existingLp.notes ? String(existingLp.notes) : null;
      } else {
        res.status(409).json({ error: `An LP with email ${normalizedEmail} already exists.` });
        return;
      }
    }
    if (String(existingUser.role || '').toLowerCase() !== 'lp') {
      res.status(409).json({ error: `Email ${normalizedEmail} already belongs to a non-LP user.` });
      return;
    }
  }

  try {
    // Create user account for LP
    const bcrypt = require('bcryptjs');
    const tempPassword = Math.random().toString(36).slice(2, 10);
    const hash = bcrypt.hashSync(tempPassword, 10);
    let userId: number;
    if (existingUser?.id) {
      db.prepare(`
        UPDATE users
        SET password_hash = ?, role = 'lp', name = ?, must_change_password = 1
        WHERE id = ?
      `).run(hash, cleanName, Number(existingUser.id));
      userId = Number(existingUser.id);
    } else {
      const userResult = db.prepare(
        'INSERT INTO users (email, password_hash, role, name, must_change_password) VALUES (?, ?, ?, ?, 1)'
      ).run(normalizedEmail, hash, 'lp', cleanName);
      userId = Number(userResult.lastInsertRowid);
    }

    let lpId: number;
    if (reactivatingLpId) {
      const reactivatedStamp = `[${new Date().toISOString()}] LP reactivated during onboarding`;
      const mergedNotes = [notes, reactivatingLpNotes, reactivatedStamp].filter(Boolean).join('\n');
      db.prepare(`
        UPDATE lp_accounts
        SET user_id = ?,
            name = ?,
            entity_name = ?,
            email = ?,
            phone = ?,
            commitment = ?,
            status = 'pending',
            notes = ?
        WHERE id = ?
      `).run(userId, cleanName, entityName || null, normalizedEmail, phone || null, commitmentNum, mergedNotes || null, reactivatingLpId);
      lpId = Number(reactivatingLpId);
    } else {
      // Calculate ownership pct (stored as fraction, e.g. 0.25 = 25%)
      const totalCommitment = (db.prepare(
        "SELECT COALESCE(SUM(commitment), 0) as total FROM lp_accounts WHERE status != 'inactive'"
      ).get() as any).total + commitmentNum;
      const ownershipPct = commitmentNum / totalCommitment;
      const lpResult = db.prepare(`
        INSERT INTO lp_accounts (user_id, name, entity_name, email, phone, commitment, ownership_pct, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(userId, cleanName, entityName, normalizedEmail, phone, commitmentNum, ownershipPct, notes);
      lpId = Number(lpResult.lastInsertRowid);
    }

    // Recalculate all LP ownership percentages (inactive LPs do not dilute active ones)
    recalcLpOwnershipPct(db);

    let emailSent = false;
    const fundName = String(process.env.FUND_NAME || '305 Opportunities Fund');
    emailSent = await sendTransactionalEmail({
      to: normalizedEmail,
      subject: `Your ${fundName} investor portal account`,
      text:
        `Hi ${cleanName || 'Investor'},\n\n` +
        `Your investor portal account has been created.\n\n` +
        `Email: ${normalizedEmail}\n` +
        `Temporary password: ${tempPassword}\n\n` +
        `Please log in and change your password immediately. You will be prompted to change it on first login.\n\n` +
        `If you were not expecting this email, please contact support.`,
    });

    res.status(reactivatingLpId ? 200 : 201).json({
      id: lpId,
      userId,
      tempPassword, // Return so GP can share with LP
      emailSent,
      reactivated: !!reactivatingLpId,
    });
  } catch (err: any) {
    if (String(err?.code || '') === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: `Email ${normalizedEmail} already exists.` });
      return;
    }
    res.status(500).json({ error: err?.message || 'Failed to onboard investor' });
  }
});

// GET /api/lp/investors - List all investors (GP only)
router.get('/investors', requireAuth, requireGP, (req: Request, res: Response) => {
  const db = getDb();
  const investors = db.prepare(`
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
    ORDER BY
      CASE
        WHEN lpa.status = 'active' THEN 0
        WHEN lpa.status = 'pending' THEN 1
        ELSE 2
      END,
      lpa.name
  `).all();
  res.json(investors);
});

// PATCH /api/lp/investors/:id/status - Toggle LP status between pending/active
router.patch('/investors/:id/status', requireAuth, requireGP, (req: Request, res: Response) => {
  const db = getDb();
  const investorId = Number(req.params.id);
  const status = String(req.body?.status || '').trim().toLowerCase();
  if (!Number.isFinite(investorId) || investorId <= 0) {
    res.status(400).json({ error: 'Invalid investor id' });
    return;
  }
  if (!['active', 'pending'].includes(status)) {
    res.status(400).json({ error: 'status must be active or pending' });
    return;
  }

  const investor = db.prepare('SELECT id FROM lp_accounts WHERE id = ?').get(investorId) as any;
  if (!investor) {
    res.status(404).json({ error: 'Investor not found' });
    return;
  }

  db.prepare('UPDATE lp_accounts SET status = ? WHERE id = ?').run(status, investorId);
  recalcLpOwnershipPct(db);
  res.json({ success: true, id: investorId, status });
});

// POST /api/lp/investors/:id/remove - guarded soft-remove of LP account
router.post('/investors/:id/remove', requireAuth, requireGP, (req: Request, res: Response) => {
  const db = getDb();
  try {
    const investorId = Number(req.params.id);
    const confirmText = String(req.body?.confirmText || '');
    if (!Number.isFinite(investorId) || investorId <= 0) {
      res.status(400).json({ error: 'Invalid investor id' });
      return;
    }

    const investor = db.prepare(`
      SELECT id, email, status, notes
      FROM lp_accounts
      WHERE id = ?
    `).get(investorId) as any;
    if (!investor) {
      res.status(404).json({ error: 'Investor not found' });
      return;
    }
    if (String(investor.status || '').toLowerCase() === 'inactive') {
      res.json({ success: true, id: investorId, status: 'inactive' });
      return;
    }

    const emailPart = String(investor.email || '').trim().toLowerCase();
    const expectedPhrase = emailPart ? `REMOVE ${emailPart}` : `REMOVE LP-${investorId}`;
    if (!expectedPhrase || confirmText.trim().toLowerCase() !== expectedPhrase.toLowerCase()) {
      res.status(400).json({ error: `Confirmation text mismatch. Type exactly: ${expectedPhrase}` });
      return;
    }

    const stampedNote = `[${new Date().toISOString()}] LP soft-removed by GP`;
    const nextNotes = investor.notes ? `${investor.notes}\n${stampedNote}` : stampedNote;
    db.prepare(`
      UPDATE lp_accounts
      SET status = 'inactive',
          notes = ?
      WHERE id = ?
    `).run(nextNotes, investorId);
    recalcLpOwnershipPct(db);

    res.json({ success: true, id: investorId, status: 'inactive' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to remove investor' });
  }
});

// ---- GP-Only: Capital Calls ----

// GET /api/lp/capital-call-items/open - Call items for reconciliation in Actuals (GP)
router.get('/capital-call-items/open', requireAuth, requireGP, (req: Request, res: Response) => {
  const db = getDb();
  const lpAccountId = req.query.lpAccountId ? Number(req.query.lpAccountId) : null;

  let sql = `
    SELECT
      cci.id as item_id,
      cci.capital_call_id,
      cci.lp_account_id,
      cci.amount,
      cci.status,
      cci.received_amount,
      cc.call_number,
      cc.call_date,
      cc.due_date,
      cc.purpose,
      cc.status as call_status,
      lpa.name as lp_name
    FROM capital_call_items cci
    JOIN capital_calls cc ON cc.id = cci.capital_call_id
    JOIN lp_accounts lpa ON lpa.id = cci.lp_account_id
    WHERE cc.status IN ('draft', 'sent', 'partially_received', 'completed')
  `;
  const params: any[] = [];
  if (lpAccountId) {
    sql += ' AND cci.lp_account_id = ?';
    params.push(lpAccountId);
  }
  sql += ' ORDER BY cc.call_date DESC, cc.call_number DESC, lpa.name ASC';

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// POST /api/lp/capital-calls/create - Create capital call
router.post('/capital-calls/create', requireAuth, requireGP, async (req: Request, res: Response) => {
  const db = getDb();
  const { totalAmount, callDate, dueDate, purpose, letterTemplate, customEmailSubject, customEmailBody } = req.body;
  if (usePostgresLpRoutes()) {
    try {
      const result = await createCapitalCallWithItems({
        totalAmount: Number(totalAmount),
        callDate: String(callDate),
        dueDate: String(dueDate),
        purpose: String(purpose || ''),
        letterTemplate: letterTemplate || null,
        customEmailSubject: customEmailSubject || null,
        customEmailBody: customEmailBody || null,
      });
      res.status(201).json(result);
      return;
    } catch (error: any) {
      res.status(400).json({ error: error?.message || 'Failed to create capital call' });
      return;
    }
  }

  // Get next call number
  const lastCall = db.prepare(
    'SELECT MAX(call_number) as max_num FROM capital_calls'
  ).get() as any;
  const callNumber = (lastCall.max_num || 0) + 1;

  const callResult = db.prepare(`
    INSERT INTO capital_calls (
      call_number, total_amount, call_date, due_date, purpose, status, letter_template, custom_email_subject, custom_email_body
    )
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)
  `).run(callNumber, totalAmount, callDate, dueDate, purpose, letterTemplate, customEmailSubject, customEmailBody);

  const callId = callResult.lastInsertRowid;

  // Auto-calculate per-LP amounts
  const lps = db.prepare(`
    SELECT *
    FROM lp_accounts
    WHERE status IN ('active', 'pending')
  `).all() as any[];
  const totalCommitment = lps.reduce((s: number, lp: any) => s + lp.commitment, 0);
  if (lps.length === 0 || totalCommitment <= 0) {
    res.status(400).json({ error: 'No eligible LP accounts found with commitments.' });
    return;
  }

  const insertItem = db.prepare(`
    INSERT INTO capital_call_items (capital_call_id, lp_account_id, amount, status)
    VALUES (?, ?, ?, 'pending')
  `);

  const items = [];
  for (const lp of lps) {
    const amount = totalAmount * (lp.commitment / totalCommitment);
    insertItem.run(callId, lp.id, amount);
    recalcCalledCapitalForLp(db, Number(lp.id));
    items.push({ lpId: lp.id, lpName: lp.name, amount });
  }

  res.status(201).json({ callId, callNumber, items });
});

// GET /api/lp/capital-calls/all - List all capital calls (GP)
router.get('/capital-calls/all', requireAuth, requireGP, async (req: Request, res: Response) => {
  try {
    const calls = await listCapitalCallsAll();
    res.json(calls);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to load capital calls' });
  }
});

// GET /api/lp/capital-calls/:callId/items - List per-LP items for a call (GP)
router.get('/capital-calls/:callId/items', requireAuth, requireGP, (req: Request, res: Response) => {
  const db = getDb();
  const { callId } = req.params;
  const items = db.prepare(`
    SELECT cci.*, lpa.name as investor_name
    FROM capital_call_items cci
    JOIN lp_accounts lpa ON cci.lp_account_id = lpa.id
    WHERE cci.capital_call_id = ?
    ORDER BY lpa.name
  `).all(Number(callId));
  res.json(items);
});

// POST /api/lp/capital-calls/:callId/send - Bulk send call notices (custom email template supported)
router.post('/capital-calls/:callId/send', requireAuth, requireGP, async (req: Request, res: Response) => {
  const db = getDb();
  const { callId } = req.params;
  const bccMode = req.body?.bccMode !== undefined ? !!req.body.bccMode : true;
  const fundName = String(req.body?.fundName || process.env.FUND_NAME || '305 Opportunities Fund');
  const fromEmail = process.env.FROM_EMAIL || 'info@305opportunityfund.com';

  const call = db.prepare(`
    SELECT id, call_number, total_amount, due_date, purpose, custom_email_subject, custom_email_body
    FROM capital_calls
    WHERE id = ?
  `).get(callId) as any;
  if (!call) {
    res.status(404).json({ error: 'Capital call not found' });
    return;
  }

  const items = db.prepare(`
    SELECT
      cci.id as item_id,
      cci.amount,
      cci.status,
      lpa.id as lp_account_id,
      lpa.name as investor_name,
      lpa.email as investor_email
    FROM capital_call_items cci
    JOIN lp_accounts lpa ON cci.lp_account_id = lpa.id
    WHERE cci.capital_call_id = ?
  `).all(Number(callId)) as Array<{
    item_id: number;
    amount: number;
    status: string;
    lp_account_id: number;
    investor_name: string;
    investor_email: string | null;
  }>;
  if (items.length === 0) {
    res.status(400).json({ error: 'No LP line items found for this call. Create/allocate the call first.' });
    return;
  }

  const baseSubject = String(
    call.custom_email_subject || 'Capital Call {{call_number}} — {{fund_name}}'
  );
  const baseBody = String(
    call.custom_email_body ||
      'Hi {{lp_name}},\n\nThis is a capital call notice for {{fund_name}}.\n\nCall #{{call_number}}\nTotal call amount: ${{call_amount}}\nYour amount: ${{lp_amount}}\nDue date: {{due_date}}\nPurpose: {{purpose}}\n\nPlease remit funds by the due date.\n\nThank you.'
  );

  const markItemSent = db.prepare(`
    UPDATE capital_call_items
    SET status = CASE WHEN status = 'pending' THEN 'sent' ELSE status END,
        sent_at = CASE WHEN sent_at IS NULL THEN CURRENT_TIMESTAMP ELSE sent_at END,
        email_sent = 1
    WHERE id = ?
  `);

  const markItemSendFailed = db.prepare(`
    UPDATE capital_call_items
    SET email_sent = 0
    WHERE id = ?
  `);

  let sentCount = 0;
  let failedCount = 0;

  for (const item of items) {
    if (!item.investor_email || !item.investor_email.trim()) {
      failedCount += 1;
      markItemSendFailed.run(item.item_id);
      continue;
    }

    const mergeVars = {
      lp_name: item.investor_name,
      investor_name: item.investor_name,
      fund_name: fundName,
      call_number: String(call.call_number),
      call_amount: fmtMoney(Number(call.total_amount)),
      lp_amount: fmtMoney(Number(item.amount)),
      due_date: String(call.due_date || ''),
      purpose: String(call.purpose || ''),
    };
    const subject = renderMergeTemplate(baseSubject, mergeVars);
    const body = renderMergeTemplate(baseBody, mergeVars);

    // Send directly to each LP for reliability. Optional BCC sends a copy to fund inbox.
    const toAddress = item.investor_email.trim();
    const bcc = bccMode ? [fromEmail] : undefined;

    const ok = await sendTransactionalEmail({
      to: toAddress,
      bcc,
      subject,
      text: body,
    });

    if (ok) {
      sentCount += 1;
      markItemSent.run(item.item_id);
    } else {
      failedCount += 1;
      markItemSendFailed.run(item.item_id);
    }
  }

  if (sentCount > 0) {
    db.prepare(`
      UPDATE capital_calls
      SET status = 'sent'
      WHERE id = ? AND status IN ('draft', 'partially_received')
    `).run(callId);
  }

  res.json({
    success: true,
    callId: Number(callId),
    bccMode,
    sentCount,
    failedCount,
    emailTemplate: {
      subject: baseSubject,
      body: baseBody,
    },
    availableMergeTags: [
      '{{lp_name}}',
      '{{investor_name}}',
      '{{fund_name}}',
      '{{call_number}}',
      '{{call_amount}}',
      '{{lp_amount}}',
      '{{due_date}}',
      '{{purpose}}',
    ],
    message: 'Capital call notices processed with mail merge and per-LP delivery.',
  });
});

// PUT /api/lp/capital-calls/:callId/items/:itemId/received - Mark as received
router.put('/capital-calls/:callId/items/:itemId/received', requireAuth, requireGP, async (req: Request, res: Response) => {
  const db = getDb();
  const callIdNum = Number(req.params.callId);
  const itemIdNum = Number(req.params.itemId);
  if (!Number.isFinite(callIdNum) || callIdNum <= 0 || !Number.isFinite(itemIdNum) || itemIdNum <= 0) {
    return res.status(400).json({ error: 'Invalid callId or itemId' });
  }
  const {
    receivedAmount,
    receiptReference,
    bankTxnId,
  } = req.body as {
    receivedAmount?: number;
    receiptReference?: string;
    bankTxnId?: string;
  };

  if (usePostgresLpRoutes()) {
    try {
      await markCapitalCallItemReceived({
        callId: callIdNum,
        itemId: itemIdNum,
        receivedAmount,
        receiptReference,
        bankTxnId,
      });
      res.json({ success: true });
      return;
    } catch (error: any) {
      const msg = String(error?.message || 'Failed to mark call item received');
      const code = msg.includes('not found') ? 404 : msg.includes('positive number') ? 400 : 500;
      res.status(code).json({ error: msg });
      return;
    }
  }

  const item = db.prepare(`
    SELECT *
    FROM capital_call_items
    WHERE id = ? AND capital_call_id = ?
  `).get(itemIdNum, callIdNum) as any;
  if (!item) return res.status(404).json({ error: 'Capital call item not found for this call' });

  const amount = Number(receivedAmount ?? item.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'receivedAmount must be a positive number' });
  }
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
  `).run(isPartial ? 'pending' : 'received', amount, receiptReference || null, bankTxnId || null, itemIdNum);

  // Idempotent posting: keep a single capital transaction row per call item.
  const existingTxn = db.prepare(`
    SELECT id
    FROM capital_transactions
    WHERE capital_call_item_id = ? AND type = 'call'
    ORDER BY id ASC
    LIMIT 1
  `).get(itemIdNum) as any;
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

  recalcCalledCapitalForLp(db, Number(item.lp_account_id));

  const agg = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) as received_count,
      COUNT(*) as total_count
    FROM capital_call_items
    WHERE capital_call_id = ?
  `).get(callIdNum) as any;
  if (agg) {
    const nextStatus =
      agg.received_count === 0 ? 'sent' :
      agg.received_count < agg.total_count ? 'partially_received' :
      'completed';
    db.prepare(`UPDATE capital_calls SET status = ? WHERE id = ?`).run(nextStatus, callIdNum);
  }

  res.json({ success: true });
});

export default router;
