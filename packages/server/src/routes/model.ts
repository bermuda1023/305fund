/**
 * Financial model routes.
 * Run projections, manage scenarios, sensitivity analysis.
 * Drives model from actual portfolio data when units are owned.
 */

import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';
import { requireAuth, requireGP } from '../middleware/auth';
import { withPostgresClient } from '../db/postgres-client';
import { isPostgresPrimaryMode, usePostgresReads } from '../db/runtime-mode';
import {
  projectCashFlows,
  generateDefaultAcquisitionSchedule,
  runWaterfall,
  calcMOIC,
  calcLPMOIC,
  xirr,
  calcGPEconomics,
  generateSensitivityTable,
  SENSITIVITY_PRESETS,
} from '@brickell/engine';
import type { FundAssumptions } from '@brickell/shared';
import type { AcquisitionSchedule } from '@brickell/engine';

const router = Router();
router.use(requireAuth, requireGP);
const usePostgresModel = () => isPostgresPrimaryMode() || usePostgresReads();

/**
 * Map a DB row to a FundAssumptions object.
 */
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

function assumptionsToRow(a: FundAssumptions) {
  return [
    a.name, a.isActive ? 1 : 0, a.fundSize, a.fundTermYears, a.investmentPeriodYears,
    a.gpCoinvestPct, a.mgmtFeeInvestPct, a.mgmtFeePostPct, a.mgmtFeeWaiver ? 1 : 0,
    a.prefReturnPct, a.catchupPct,
    a.tier1SplitLP, a.tier1SplitGP, a.tier2HurdleIRR, a.tier2SplitLP, a.tier2SplitGP,
    a.tier3HurdleIRR, a.tier3SplitLP, a.tier3SplitGP,
    a.refiEnabled ? 1 : 0, a.refiYear, a.refiLTV, a.refiRate, a.refiTermYears, a.refiCostPct,
    a.rentGrowthPct, a.hoaGrowthPct, a.taxGrowthPct, a.vacancyPct,
    a.annualFundOpexMode, a.annualFundOpexFixed, a.annualFundOpexThresholdPct, a.annualFundOpexAdjustPct,
    a.presentDayLandValue,
    a.landValueTotal, a.landGrowthPct, a.landPSF,
    a.mmRate, a.excessCashMode, a.buildingValuation,
    a.bonusIRRThreshold, a.bonusMaxYears, a.bonusYieldThreshold,
  ];
}

/**
 * Query portfolio_units and compute real operating data + acquisition schedule.
 * Returns { avgRent, avgHOA, avgAnnualInsurance, avgAnnualTax, acquisitions, unitCount }.
 * Falls back to defaults if no units exist.
 */
function getPortfolioData(db: ReturnType<typeof getDb>) {
  const units = db.prepare(`
    SELECT
      pu.id, pu.purchase_date, pu.purchase_price, pu.total_acquisition_cost,
      pu.monthly_rent, pu.monthly_hoa, pu.monthly_insurance, pu.monthly_tax
    FROM portfolio_units pu
    ORDER BY pu.purchase_date
  `).all() as any[];

  // Query real total ownership % from portfolio → building_units → unit_types
  const ownershipRow = db.prepare(`
    SELECT SUM(ut.ownership_pct) as total_ownership_pct
    FROM portfolio_units pu
    JOIN building_units bu ON pu.building_unit_id = bu.id
    JOIN unit_types ut ON bu.unit_type_id = ut.id
  `).get() as any;

  if (units.length === 0) {
    return null; // No portfolio data — use defaults
  }

  // Compute weighted averages (insurance/tax stored as annual per unit)
  const totalRent = units.reduce((s: number, u: any) => s + (u.monthly_rent || 0), 0);
  const totalHOA = units.reduce((s: number, u: any) => s + (u.monthly_hoa || 0), 0);
  const totalIns = units.reduce((s: number, u: any) => s + (u.monthly_insurance || 0), 0); // annual insurance
  const totalTax = units.reduce((s: number, u: any) => s + (u.monthly_tax || 0), 0); // annual tax
  const count = units.length;

  const avgRent = totalRent / count;
  const avgHOA = totalHOA / count;
  const avgAnnualInsurance = totalIns / count;
  const avgAnnualTax = totalTax / count;

  // Build acquisition schedule grouped by quarter
  // Q0 = Q1 2026
  const acqMap = new Map<number, { units: number; totalCost: number }>();
  for (const u of units) {
    const d = new Date(u.purchase_date);
    const yearOff = d.getFullYear() - 2026;
    const qIdx = yearOff * 4 + Math.floor(d.getMonth() / 3);
    const q = Math.max(0, qIdx); // Clamp to 0+
    const existing = acqMap.get(q) || { units: 0, totalCost: 0 };
    existing.units += 1;
    existing.totalCost += u.total_acquisition_cost || u.purchase_price || 500_000;
    acqMap.set(q, existing);
  }

  const acquisitions: AcquisitionSchedule[] = [];
  for (const [quarter, data] of acqMap) {
    acquisitions.push({
      quarter,
      units: data.units,
      costPerUnit: data.totalCost / data.units,
    });
  }

  // ownership_pct in DB is stored as percentage (e.g. 0.312228 = 0.312228%)
  // Convert to decimal for the engine (0.312228% = 0.00312228).
  const totalOwnershipPct = ownershipRow?.total_ownership_pct
    ? ownershipRow.total_ownership_pct / 100
    : null;
  return {
    avgRent,
    avgHOA,
    avgAnnualInsurance,
    avgAnnualTax,
    acquisitions,
    unitCount: count,
    totalMonthlyRent: totalRent,
    totalMonthlyHOA: totalHOA,
    totalOwnershipPct,
  };
}

function calcAnnualFundOpex(assumptions: FundAssumptions, ownershipPct: number): number {
  const base = Math.max(0, Number(assumptions.annualFundOpexFixed || 0));
  if (assumptions.annualFundOpexMode !== 'threshold_pct') {
    return base;
  }
  const threshold = Math.max(0, Number(assumptions.annualFundOpexThresholdPct || 0));
  const adjust = Math.max(0, Number(assumptions.annualFundOpexAdjustPct || 0));
  const excess = Math.max(0, ownershipPct - threshold);
  return base * (1 + excess * adjust);
}

/**
 * Build CashFlowInput using portfolio data or defaults.
 */
type ModelDataMode = 'auto' | 'defaults' | 'sample';

function buildSampleCashFlowInput(assumptions: FundAssumptions) {
  // Sample / sandbox dataset:
  // - ~6 years to deploy (~24 quarters)
  // - unit prices range ~$450k-$800k
  // - net yield target ~3.1% at purchase BEFORE management fees and fund overhead
  //
  // Important: the projection engine uses "average unit" operating assumptions, so yield is
  // matched on average, while purchase prices can vary per quarter via costPerUnit.
  const acquisitions = [
    // Year 1 (4 units)
    { quarter: 0, units: 1, costPerUnit: 460_000 },
    { quarter: 1, units: 1, costPerUnit: 485_000 },
    { quarter: 2, units: 1, costPerUnit: 510_000 },
    { quarter: 3, units: 1, costPerUnit: 535_000 },

    // Year 2 (5 units)
    { quarter: 4, units: 1, costPerUnit: 550_000 },
    { quarter: 5, units: 1, costPerUnit: 575_000 },
    { quarter: 6, units: 2, costPerUnit: 600_000 },
    { quarter: 7, units: 1, costPerUnit: 625_000 },

    // Year 3 (5 units)
    { quarter: 8, units: 1, costPerUnit: 640_000 },
    { quarter: 9, units: 1, costPerUnit: 660_000 },
    { quarter: 10, units: 2, costPerUnit: 680_000 },
    { quarter: 11, units: 1, costPerUnit: 700_000 },

    // Year 4 (5 units)
    { quarter: 12, units: 1, costPerUnit: 710_000 },
    { quarter: 13, units: 2, costPerUnit: 725_000 },
    { quarter: 14, units: 1, costPerUnit: 740_000 },
    { quarter: 15, units: 1, costPerUnit: 755_000 },

    // Year 5 (5 units)
    { quarter: 16, units: 1, costPerUnit: 770_000 },
    { quarter: 17, units: 1, costPerUnit: 780_000 },
    { quarter: 18, units: 2, costPerUnit: 790_000 },
    { quarter: 19, units: 1, costPerUnit: 800_000 },

    // Year 6 (4 units)
    { quarter: 20, units: 1, costPerUnit: 800_000 },
    { quarter: 21, units: 1, costPerUnit: 800_000 },
    { quarter: 22, units: 1, costPerUnit: 800_000 },
    { quarter: 23, units: 1, costPerUnit: 800_000 },
  ];

  // Yield target math (approx):
  // With vacancy=5%, HOA=$1250/mo, insurance=$2500/yr, tax=$3500/yr,
  // rent=$3700/mo gives NOI ~3.1% on ~$680k avg basis (before mgmt fee + fund opex).
  const baseMonthlyRent = 3_700;
  const baseMonthlyHOA = 1_250;
  const baseAnnualInsurance = 2_500;
  const baseAnnualTax = 3_500;

  const unitCount = acquisitions.reduce((s, a) => s + Number(a.units || 0), 0);
  return {
    input: {
      assumptions,
      acquisitions,
      baseMonthlyRent,
      baseMonthlyHOA,
      baseAnnualInsurance,
      baseAnnualTax,
      // Apply the scenario's fund overhead settings so users can stress it in the sample too.
      annualFundOpex: calcAnnualFundOpex(assumptions, 0),
    },
    dataSource: {
      type: 'sample' as const,
      unitCount,
      avgRent: baseMonthlyRent,
      avgHOA: baseMonthlyHOA,
    },
  };
}

function buildCashFlowInput(assumptions: FundAssumptions, db: ReturnType<typeof getDb>, mode: ModelDataMode = 'auto') {
  if (mode === 'sample') {
    return buildSampleCashFlowInput(assumptions);
  }

  const portfolio = mode === 'defaults' ? null : getPortfolioData(db);

  if (portfolio) {
    return {
      input: {
        assumptions,
        acquisitions: portfolio.acquisitions,
        baseMonthlyRent: portfolio.avgRent,
        baseMonthlyHOA: portfolio.avgHOA,
        // Keep base annual expenses at zero when using portfolio overlays to avoid double counting.
        baseAnnualInsurance: 0,
        baseAnnualTax: 0,
        annualFundOpex: calcAnnualFundOpex(assumptions, portfolio.totalOwnershipPct ?? 0),
        totalOwnershipPct: portfolio.totalOwnershipPct ?? undefined,
      },
      dataSource: {
        type: 'portfolio' as const,
        unitCount: portfolio.unitCount,
        avgRent: portfolio.avgRent,
        avgHOA: portfolio.avgHOA,
      },
    };
  }

  // Default — no owned units yet
  return {
    input: {
      assumptions,
      acquisitions: generateDefaultAcquisitionSchedule(assumptions),
      baseMonthlyRent: 2800,
      baseMonthlyHOA: 1400,
      baseAnnualInsurance: 2400,
      baseAnnualTax: 2400,
      annualFundOpex: calcAnnualFundOpex(assumptions, 0),
    },
    dataSource: {
      type: 'defaults' as const,
      unitCount: 0,
      avgRent: 2800,
      avgHOA: 1400,
    },
  };
}

function quarterIndexFromDate(dateStr: string): number {
  const d = new Date(dateStr);
  const yearOff = d.getFullYear() - 2026;
  return Math.max(0, yearOff * 4 + Math.floor(d.getMonth() / 3));
}

function monthKeyFromDate(dateStr: string): string | null {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthStartFromQuarterMonth(cfDate: string, monthOffsetInQuarter: number): Date | null {
  const d = new Date(cfDate);
  if (Number.isNaN(d.getTime())) return null;
  // Engine quarter dates are the first month of the quarter (YYYY-MM-01).
  // Expand into 3 month-start points.
  return new Date(d.getFullYear(), d.getMonth() + monthOffsetInQuarter, 1);
}

function dateFromMonthDay(year: number, month: number, day: number): string {
  const safeMonth = Math.max(1, Math.min(12, Math.round(month || 1)));
  const dim = new Date(year, safeMonth, 0).getDate();
  const safeDay = Math.max(1, Math.min(dim, Math.round(day || 1)));
  return `${year}-${String(safeMonth).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

function getAnnualExpenseEvents(
  db: ReturnType<typeof getDb>,
  assumptions: FundAssumptions,
  fundTermYears: number
) {
  const rows = db.prepare(`
    SELECT
      pu.id as portfolio_unit_id,
      pu.purchase_date,
      COALESCE(pu.monthly_insurance, 0) as annual_insurance,
      COALESCE(pu.monthly_tax, 0) as annual_tax,
      COALESCE(pu.insurance_payment_month, 1) as insurance_payment_month,
      COALESCE(pu.insurance_payment_day, 1) as insurance_payment_day,
      COALESCE(pu.tax_payment_month, 1) as tax_payment_month,
      COALESCE(pu.tax_payment_day, 1) as tax_payment_day
    FROM portfolio_units pu
  `).all() as any[];

  const byQuarterInsurance = new Map<number, number>();
  const byQuarterTax = new Map<number, number>();
  const events: Array<{ paidDate: string; category: 'insurance' | 'tax'; amount: number }> = [];
  const startYear = 2026;
  const maxQuarter = fundTermYears * 4;

  for (const r of rows) {
    const purchase = new Date(r.purchase_date);
    for (let y = 0; y < fundTermYears; y++) {
      const year = startYear + y;

      if (r.annual_insurance > 0) {
        const date = dateFromMonthDay(year, Number(r.insurance_payment_month), Number(r.insurance_payment_day));
        const d = new Date(date);
        if (!Number.isNaN(purchase.getTime()) && d >= purchase) {
          const qIdx = quarterIndexFromDate(date);
          if (qIdx >= 0 && qIdx < maxQuarter) {
            const grownInsurance = Number(r.annual_insurance) * Math.pow(1 + assumptions.hoaGrowthPct, y);
            byQuarterInsurance.set(qIdx, (byQuarterInsurance.get(qIdx) || 0) + grownInsurance);
            events.push({ paidDate: date, category: 'insurance', amount: grownInsurance });
          }
        }
      }

      if (r.annual_tax > 0) {
        const date = dateFromMonthDay(year, Number(r.tax_payment_month), Number(r.tax_payment_day));
        const d = new Date(date);
        if (!Number.isNaN(purchase.getTime()) && d >= purchase) {
          const qIdx = quarterIndexFromDate(date);
          if (qIdx >= 0 && qIdx < maxQuarter) {
            const taxGrowthPct = Number((assumptions as any).taxGrowthPct ?? assumptions.hoaGrowthPct ?? 0);
            const grownTax = Number(r.annual_tax) * Math.pow(1 + taxGrowthPct, y);
            byQuarterTax.set(qIdx, (byQuarterTax.get(qIdx) || 0) + grownTax);
            events.push({ paidDate: date, category: 'tax', amount: grownTax });
          }
        }
      }
    }
  }

  return { byQuarterInsurance, byQuarterTax, events };
}

function getRenovationEvents(db: ReturnType<typeof getDb>) {
  const rows = db.prepare(`
    SELECT
      ur.id,
      ur.portfolio_unit_id,
      ur.description,
      ur.status,
      ur.start_date,
      ur.end_date,
      COALESCE(ur.actual_cost, ur.estimated_cost, 0) as paid_cost,
      bu.unit_number
    FROM unit_renovations ur
    JOIN portfolio_units pu ON ur.portfolio_unit_id = pu.id
    JOIN building_units bu ON pu.building_unit_id = bu.id
    WHERE COALESCE(ur.actual_cost, ur.estimated_cost, 0) > 0
      AND (ur.start_date IS NOT NULL OR ur.end_date IS NOT NULL)
    ORDER BY COALESCE(ur.end_date, ur.start_date)
  `).all() as any[];

  const events = rows.map((r) => {
    const paidDate = r.end_date || r.start_date;
    return {
      id: r.id,
      portfolioUnitId: r.portfolio_unit_id,
      unitNumber: r.unit_number,
      description: r.description,
      status: r.status,
      paidDate,
      quarterIndex: quarterIndexFromDate(paidDate),
      amount: Number(r.paid_cost || 0),
    };
  });

  const byQuarter = new Map<number, number>();
  for (const e of events) {
    byQuarter.set(e.quarterIndex, (byQuarter.get(e.quarterIndex) || 0) + e.amount);
  }

  return { events, byQuarter };
}

function getAcquisitionEvents(db: ReturnType<typeof getDb>) {
  const rows = db.prepare(`
    SELECT
      pu.id as portfolio_unit_id,
      pu.purchase_date,
      COALESCE(pu.total_acquisition_cost, pu.purchase_price, 0) as amount,
      bu.unit_number
    FROM portfolio_units pu
    JOIN building_units bu ON pu.building_unit_id = bu.id
    WHERE pu.purchase_date IS NOT NULL
    ORDER BY pu.purchase_date
  `).all() as any[];

  return rows
    .map((r) => ({
      portfolioUnitId: Number(r.portfolio_unit_id),
      unitNumber: String(r.unit_number),
      paidDate: String(r.purchase_date),
      quarterIndex: quarterIndexFromDate(String(r.purchase_date)),
      amount: Number(r.amount || 0),
    }))
    .filter((e) => e.amount > 0);
}

function getCapitalCallEvents(db: ReturnType<typeof getDb>) {
  const rows = db.prepare(`
    SELECT date, SUM(amount) as amount
    FROM capital_transactions
    WHERE type = 'call'
    GROUP BY date
    ORDER BY date
  `).all() as Array<{ date: string; amount: number }>;

  return rows
    .map((r) => ({
      paidDate: String(r.date),
      quarterIndex: quarterIndexFromDate(String(r.date)),
      amount: Number(r.amount || 0),
    }))
    .filter((e) => e.amount > 0);
}

function buildLiquidityLedger(
  assumptions: FundAssumptions,
  capitalCallEvents: Array<{ paidDate: string; amount: number }>,
  acquisitionEvents: Array<{ paidDate: string; amount: number }>,
  db: ReturnType<typeof getDb>
) {
  const callByMonth = new Map<string, number>();
  const deployByMonth = new Map<string, number>();
  const startYear = 2026;
  const totalMonths = assumptions.fundTermYears * 12;

  for (const e of capitalCallEvents) {
    const d = new Date(e.paidDate);
    if (Number.isNaN(d.getTime())) continue;
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    callByMonth.set(k, (callByMonth.get(k) || 0) + e.amount);
  }
  for (const e of acquisitionEvents) {
    const d = new Date(e.paidDate);
    if (Number.isNaN(d.getTime())) continue;
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    deployByMonth.set(k, (deployByMonth.get(k) || 0) + e.amount);
  }

  const expenseRows = db.prepare(`
    SELECT date, SUM(ABS(amount)) as amount
    FROM cash_flow_actuals
    WHERE amount < 0
      AND category IN ('hoa', 'insurance', 'tax', 'repair', 'management_fee', 'fund_expense', 'other')
    GROUP BY date
  `).all() as Array<{ date: string; amount: number }>;
  for (const r of expenseRows) {
    const d = new Date(r.date);
    if (Number.isNaN(d.getTime())) continue;
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    deployByMonth.set(k, (deployByMonth.get(k) || 0) + Number(r.amount || 0));
  }

  const monthlyRate = Number(assumptions.mmRate || 0) / 12;
  let mmBalance = 0;
  const rows: Array<{
    label: string;
    month: string;
    capitalCalled: number;
    deployed: number;
    mmIncome: number;
    mmBalanceStart: number;
    mmBalanceEnd: number;
  }> = [];

  for (let i = 0; i < totalMonths; i++) {
    const d = new Date(startYear, i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const called = callByMonth.get(k) || 0;
    const deployed = deployByMonth.get(k) || 0;
    const start = mmBalance;
    const income = start * monthlyRate;
    const end = Math.max(0, start + called - deployed + income);
    rows.push({
      label: `${d.toLocaleString('default', { month: 'short' })} ${d.getFullYear()}`,
      month: k,
      capitalCalled: called,
      deployed,
      mmIncome: income,
      mmBalanceStart: start,
      mmBalanceEnd: end,
    });
    mmBalance = end;
  }

  return rows;
}

type ModelEvalResult = {
  assumptions: FundAssumptions;
  cashFlows: any[];
  renovationEvents: any[];
  acquisitionEvents: any[];
  capitalCallEvents: any[];
  portfolioUnits?: Array<{
    portfolioUnitId: number;
    unitNumber: string;
    purchaseDate: string;
    monthlyHOA: number;
    proformaMonthlyRent: number;
    tenantMonthlyRent: number | null;
    leaseStart: string | null;
    leaseEnd: string | null;
    tenantStatus: string | null;
  }>;
  annualExpenseEvents: Array<{ paidDate: string; category: 'insurance' | 'tax'; amount: number }>;
  liquidityLedger: any[];
  dataSource: {
    type: 'portfolio' | 'defaults' | 'sample';
    unitCount: number;
    avgRent: number;
    avgHOA: number;
  };
  returns: {
    totalEquityCommitted: number;
    capitalDeployed: number;
    totalDistributions: number;
    totalNOI: number;
    netProfit: number;
    fundMOIC: number;
    fundIRR: number;
    lpMOIC: number;
    lpIRR: number;
    gpEconomics: any;
    waterfall: any;
  };
  waterfall: any;
  gpEconomics: any;
};

type PgModelSnapshot = {
  portfolioRows: any[];
  ownershipRow: { total_ownership_pct?: number } | null;
  annualExpenseRows: any[];
  renovationRows: any[];
  acquisitionRows: any[];
  capitalCallRows: Array<{ date: string; amount: number }>;
  liquidityExpenseRows: Array<{ date: string; amount: number }>;
  portfolioModelRows: any[];
};

async function fetchModelSnapshotPg(): Promise<PgModelSnapshot> {
  return withPostgresClient(async (client) => {
    const [
      portfolioRowsResult,
      ownershipResult,
      annualExpenseResult,
      renovationResult,
      acquisitionResult,
      capitalCallResult,
      expenseResult,
      portfolioModelResult,
    ] = await Promise.all([
      client.query(`
        SELECT
          pu.id, pu.purchase_date, pu.purchase_price, pu.total_acquisition_cost,
          pu.monthly_rent, pu.monthly_hoa, pu.monthly_insurance, pu.monthly_tax
        FROM portfolio_units pu
        ORDER BY pu.purchase_date
      `),
      client.query(`
        SELECT SUM(ut.ownership_pct) as total_ownership_pct
        FROM portfolio_units pu
        JOIN building_units bu ON pu.building_unit_id = bu.id
        JOIN unit_types ut ON bu.unit_type_id = ut.id
      `),
      client.query(`
        SELECT
          pu.id as portfolio_unit_id,
          pu.purchase_date,
          COALESCE(pu.monthly_insurance, 0) as annual_insurance,
          COALESCE(pu.monthly_tax, 0) as annual_tax,
          COALESCE(pu.insurance_payment_month, 1) as insurance_payment_month,
          COALESCE(pu.insurance_payment_day, 1) as insurance_payment_day,
          COALESCE(pu.tax_payment_month, 1) as tax_payment_month,
          COALESCE(pu.tax_payment_day, 1) as tax_payment_day
        FROM portfolio_units pu
      `),
      client.query(`
        SELECT
          ur.id,
          ur.portfolio_unit_id,
          ur.description,
          ur.status,
          ur.start_date,
          ur.end_date,
          COALESCE(ur.actual_cost, ur.estimated_cost, 0) as paid_cost,
          bu.unit_number
        FROM unit_renovations ur
        JOIN portfolio_units pu ON ur.portfolio_unit_id = pu.id
        JOIN building_units bu ON pu.building_unit_id = bu.id
        WHERE COALESCE(ur.actual_cost, ur.estimated_cost, 0) > 0
          AND (ur.start_date IS NOT NULL OR ur.end_date IS NOT NULL)
        ORDER BY COALESCE(ur.end_date, ur.start_date)
      `),
      client.query(`
        SELECT
          pu.id as portfolio_unit_id,
          pu.purchase_date,
          COALESCE(pu.total_acquisition_cost, pu.purchase_price, 0) as amount,
          bu.unit_number
        FROM portfolio_units pu
        JOIN building_units bu ON pu.building_unit_id = bu.id
        WHERE pu.purchase_date IS NOT NULL
        ORDER BY pu.purchase_date
      `),
      client.query(`
        SELECT date, SUM(amount) as amount
        FROM capital_transactions
        WHERE type = 'call'
        GROUP BY date
        ORDER BY date
      `),
      client.query(`
        SELECT date, SUM(ABS(amount)) as amount
        FROM cash_flow_actuals
        WHERE amount < 0
          AND category IN ('hoa', 'insurance', 'tax', 'repair', 'management_fee', 'fund_expense', 'other')
        GROUP BY date
      `),
      client.query(`
        SELECT
          pu.id as portfolio_unit_id,
          bu.unit_number,
          pu.purchase_date,
          COALESCE(pu.monthly_hoa, 0) as monthly_hoa,
          COALESCE(pu.monthly_rent, 0) as proforma_monthly_rent,
          t.monthly_rent as tenant_monthly_rent,
          t.lease_start,
          t.lease_end,
          t.status as tenant_status
        FROM portfolio_units pu
        JOIN building_units bu ON bu.id = pu.building_unit_id
        LEFT JOIN tenants t
          ON t.portfolio_unit_id = pu.id
         AND t.status IN ('active', 'month_to_month')
        WHERE pu.purchase_date IS NOT NULL
        ORDER BY pu.purchase_date ASC
      `),
    ]);
    return {
      portfolioRows: portfolioRowsResult.rows as any[],
      ownershipRow: (ownershipResult.rows[0] || null) as any,
      annualExpenseRows: annualExpenseResult.rows as any[],
      renovationRows: renovationResult.rows as any[],
      acquisitionRows: acquisitionResult.rows as any[],
      capitalCallRows: capitalCallResult.rows as Array<{ date: string; amount: number }>,
      liquidityExpenseRows: expenseResult.rows as Array<{ date: string; amount: number }>,
      portfolioModelRows: portfolioModelResult.rows as any[],
    };
  });
}

function evaluateAssumptionsPg(
  assumptions: FundAssumptions,
  snapshot: PgModelSnapshot,
  mode: ModelDataMode = 'auto'
): ModelEvalResult {
  const buildPortfolioData = () => {
    const units = snapshot.portfolioRows;
    const ownershipRow = snapshot.ownershipRow;
    if (units.length === 0) return null;
    const totalRent = units.reduce((s: number, u: any) => s + Number(u.monthly_rent || 0), 0);
    const totalHOA = units.reduce((s: number, u: any) => s + Number(u.monthly_hoa || 0), 0);
    const totalIns = units.reduce((s: number, u: any) => s + Number(u.monthly_insurance || 0), 0);
    const totalTax = units.reduce((s: number, u: any) => s + Number(u.monthly_tax || 0), 0);
    const count = units.length;
    const acqMap = new Map<number, { units: number; totalCost: number }>();
    for (const u of units) {
      const d = new Date(u.purchase_date);
      const yearOff = d.getFullYear() - 2026;
      const qIdx = yearOff * 4 + Math.floor(d.getMonth() / 3);
      const q = Math.max(0, qIdx);
      const existing = acqMap.get(q) || { units: 0, totalCost: 0 };
      existing.units += 1;
      existing.totalCost += Number(u.total_acquisition_cost || u.purchase_price || 500_000);
      acqMap.set(q, existing);
    }
    const acquisitions: AcquisitionSchedule[] = [];
    for (const [quarter, data] of acqMap) {
      acquisitions.push({ quarter, units: data.units, costPerUnit: data.totalCost / data.units });
    }
    return {
      avgRent: totalRent / count,
      avgHOA: totalHOA / count,
      avgAnnualInsurance: totalIns / count,
      avgAnnualTax: totalTax / count,
      acquisitions,
      unitCount: count,
      totalOwnershipPct: ownershipRow?.total_ownership_pct ? Number(ownershipRow.total_ownership_pct) / 100 : null,
    };
  };

  const portfolio = mode === 'defaults' ? null : buildPortfolioData();
  const cfInput = mode === 'sample'
    ? buildSampleCashFlowInput(assumptions).input
    : portfolio
      ? {
        assumptions,
        acquisitions: portfolio.acquisitions,
        baseMonthlyRent: portfolio.avgRent,
        baseMonthlyHOA: portfolio.avgHOA,
        baseAnnualInsurance: 0,
        baseAnnualTax: 0,
        annualFundOpex: calcAnnualFundOpex(assumptions, portfolio.totalOwnershipPct ?? 0),
        totalOwnershipPct: portfolio.totalOwnershipPct ?? undefined,
      }
      : {
        assumptions,
        acquisitions: generateDefaultAcquisitionSchedule(assumptions),
        baseMonthlyRent: 2800,
        baseMonthlyHOA: 1400,
        baseAnnualInsurance: 2400,
        baseAnnualTax: 2400,
        annualFundOpex: calcAnnualFundOpex(assumptions, 0),
      };

  const dataSource = mode === 'sample'
    ? buildSampleCashFlowInput(assumptions).dataSource
    : portfolio
      ? { type: 'portfolio' as const, unitCount: portfolio.unitCount, avgRent: portfolio.avgRent, avgHOA: portfolio.avgHOA }
      : { type: 'defaults' as const, unitCount: 0, avgRent: 2800, avgHOA: 1400 };

  const baseCashFlows = projectCashFlows(cfInput);

  const annualExpenseRows = snapshot.annualExpenseRows;
  const byQuarterInsurance = new Map<number, number>();
  const byQuarterTax = new Map<number, number>();
  const annualEvents: Array<{ paidDate: string; category: 'insurance' | 'tax'; amount: number }> = [];
  const startYear = 2026;
  const maxQuarter = assumptions.fundTermYears * 4;
  for (const r of annualExpenseRows) {
    const purchase = new Date(r.purchase_date);
    for (let y = 0; y < assumptions.fundTermYears; y++) {
      const year = startYear + y;
      if (Number(r.annual_insurance || 0) > 0) {
        const date = dateFromMonthDay(year, Number(r.insurance_payment_month), Number(r.insurance_payment_day));
        const d = new Date(date);
        if (!Number.isNaN(purchase.getTime()) && d >= purchase) {
          const qIdx = quarterIndexFromDate(date);
          if (qIdx >= 0 && qIdx < maxQuarter) {
            const grown = Number(r.annual_insurance) * Math.pow(1 + assumptions.hoaGrowthPct, y);
            byQuarterInsurance.set(qIdx, (byQuarterInsurance.get(qIdx) || 0) + grown);
            annualEvents.push({ paidDate: date, category: 'insurance', amount: grown });
          }
        }
      }
      if (Number(r.annual_tax || 0) > 0) {
        const date = dateFromMonthDay(year, Number(r.tax_payment_month), Number(r.tax_payment_day));
        const d = new Date(date);
        if (!Number.isNaN(purchase.getTime()) && d >= purchase) {
          const qIdx = quarterIndexFromDate(date);
          if (qIdx >= 0 && qIdx < maxQuarter) {
            const taxGrowthPct = Number((assumptions as any).taxGrowthPct ?? assumptions.hoaGrowthPct ?? 0);
            const grown = Number(r.annual_tax) * Math.pow(1 + taxGrowthPct, y);
            byQuarterTax.set(qIdx, (byQuarterTax.get(qIdx) || 0) + grown);
            annualEvents.push({ paidDate: date, category: 'tax', amount: grown });
          }
        }
      }
    }
  }

  const renoEvents = snapshot.renovationRows.map((r) => {
    const paidDate = r.end_date || r.start_date;
    return {
      id: r.id,
      portfolioUnitId: r.portfolio_unit_id,
      unitNumber: r.unit_number,
      description: r.description,
      status: r.status,
      paidDate,
      quarterIndex: quarterIndexFromDate(String(paidDate)),
      amount: Number(r.paid_cost || 0),
    };
  });
  const renoByQuarter = new Map<number, number>();
  for (const e of renoEvents) renoByQuarter.set(e.quarterIndex, (renoByQuarter.get(e.quarterIndex) || 0) + e.amount);
  const acquisitionEvents = snapshot.acquisitionRows
    .map((r) => ({
      portfolioUnitId: Number(r.portfolio_unit_id),
      unitNumber: String(r.unit_number),
      paidDate: String(r.purchase_date),
      quarterIndex: quarterIndexFromDate(String(r.purchase_date)),
      amount: Number(r.amount || 0),
    }))
    .filter((e) => e.amount > 0);
  const capitalCallEvents = snapshot.capitalCallRows
    .map((r) => ({
      paidDate: String(r.date),
      quarterIndex: quarterIndexFromDate(String(r.date)),
      amount: Number(r.amount || 0),
    }))
    .filter((e) => e.amount > 0);

  const callByMonth = new Map<string, number>();
  const deployByMonth = new Map<string, number>();
  for (const e of capitalCallEvents) {
    const d = new Date(e.paidDate);
    if (!Number.isNaN(d.getTime())) callByMonth.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, (callByMonth.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) || 0) + e.amount);
  }
  for (const e of acquisitionEvents) {
    const d = new Date(e.paidDate);
    if (!Number.isNaN(d.getTime())) deployByMonth.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, (deployByMonth.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) || 0) + e.amount);
  }
  for (const r of snapshot.liquidityExpenseRows) {
    const d = new Date(r.date);
    if (!Number.isNaN(d.getTime())) deployByMonth.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, (deployByMonth.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) || 0) + Number(r.amount || 0));
  }
  const liquidityLedger: any[] = [];
  const monthlyRate = Number(assumptions.mmRate || 0) / 12;
  let mmBalance = 0;
  for (let i = 0; i < assumptions.fundTermYears * 12; i++) {
    const d = new Date(2026, i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const called = callByMonth.get(k) || 0;
    const deployed = deployByMonth.get(k) || 0;
    const start = mmBalance;
    const income = start * monthlyRate;
    const end = Math.max(0, start + called - deployed + income);
    liquidityLedger.push({ label: `${d.toLocaleString('default', { month: 'short' })} ${d.getFullYear()}`, month: k, capitalCalled: called, deployed, mmIncome: income, mmBalanceStart: start, mmBalanceEnd: end });
    mmBalance = end;
  }

  const portfolioUnits = snapshot.portfolioModelRows.map((r) => ({
    portfolioUnitId: Number(r.portfolio_unit_id),
    unitNumber: String(r.unit_number),
    purchaseDate: String(r.purchase_date),
    monthlyHOA: Number(r.monthly_hoa || 0),
    proformaMonthlyRent: Number(r.proforma_monthly_rent || 0),
    tenantMonthlyRent: r.tenant_monthly_rent != null ? Number(r.tenant_monthly_rent) : null,
    leaseStart: r.lease_start ? String(r.lease_start) : null,
    leaseEnd: r.lease_end ? String(r.lease_end) : null,
    tenantStatus: r.tenant_status ? String(r.tenant_status) : null,
  }));

  const cashFlows = baseCashFlows.map((cf) => {
    const renovationCost = renoByQuarter.get(cf.quarterIndex) || 0;
    const insuranceCost = byQuarterInsurance.get(cf.quarterIndex) || 0;
    const taxCost = byQuarterTax.get(cf.quarterIndex) || 0;
    return {
      ...cf,
      renovationCost,
      insuranceExpense: cf.insuranceExpense + insuranceCost,
      taxExpense: cf.taxExpense + taxCost,
      operatingExpense: cf.operatingExpense + renovationCost,
      netOperatingIncome: cf.netOperatingIncome - renovationCost - insuranceCost - taxCost,
      netCashFlow: cf.netCashFlow - renovationCost - insuranceCost - taxCost,
    };
  });
  let cumulative = 0;
  for (const cf of cashFlows) {
    cumulative += cf.netCashFlow;
    cf.cumulativeCashFlow = cumulative;
  }
  const exitCF = cashFlows[cashFlows.length - 1];
  const totalDistributions = exitCF.grossSaleProceeds + exitCF.mmLiquidation;
  const interimDistributions = cashFlows.reduce((s, cf) => s + (cf.lpDistributions || 0), 0);
  const totalCapitalDeployed = cashFlows.reduce((s, cf) => s + cf.capitalCalls, 0);
  const totalNOI = cashFlows.reduce((s, cf) => s + cf.netOperatingIncome, 0);
  const gpCoinvest = assumptions.fundSize * assumptions.gpCoinvestPct;
  const lpCapital = assumptions.fundSize - gpCoinvest;
  const fundMOIC = calcMOIC(totalDistributions + interimDistributions, totalCapitalDeployed);
  const insuranceByMonth = new Map<string, number>();
  const taxByMonth = new Map<string, number>();
  for (const ev of annualEvents) {
    const k = monthKeyFromDate(ev.paidDate);
    if (!k) continue;
    if (ev.category === 'insurance') insuranceByMonth.set(k, (insuranceByMonth.get(k) || 0) + ev.amount);
    if (ev.category === 'tax') taxByMonth.set(k, (taxByMonth.get(k) || 0) + ev.amount);
  }
  const renoByMonth = new Map<string, number>();
  for (const ev of renoEvents) {
    const k = monthKeyFromDate(String(ev.paidDate));
    if (!k) continue;
    renoByMonth.set(k, (renoByMonth.get(k) || 0) + ev.amount);
  }
  const callByMonth2 = new Map<string, number>();
  for (const ev of capitalCallEvents) {
    const k = monthKeyFromDate(ev.paidDate);
    if (!k) continue;
    callByMonth2.set(k, (callByMonth2.get(k) || 0) + ev.amount);
  }
  const hasCallEvents = capitalCallEvents.length > 0;
  const hasAnnualOpsEvents = annualEvents.length > 0;
  const xirrFlows: Array<{ date: Date; amount: number }> = [];
  for (const cf of cashFlows) {
    const quarterReno = Number(cf.renovationCost || 0);
    const baseFundOpexMonthly = Math.max(0, (Number(cf.operatingExpense || 0) - quarterReno) / 3);
    const baseMgmtMonthly = Number(cf.mgmtFee || 0) / 3;
    const baseDebtRepayMonthly = Number(cf.debtRepayment || 0) / 3;
    const baseInterestMonthly = Number(cf.interestExpense || 0) / 3;
    for (let m = 0; m < 3; m++) {
      const monthStart = monthStartFromQuarterMonth(String(cf.date), m);
      if (!monthStart) continue;
      const k = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`;
      const capitalCall = hasCallEvents ? (callByMonth2.get(k) || 0) : (m === 0 ? Number(cf.capitalCalls || 0) : 0);
      const insurance = hasAnnualOpsEvents ? (insuranceByMonth.get(k) || 0) : (m === 0 ? Number(cf.insuranceExpense || 0) : 0);
      const tax = hasAnnualOpsEvents ? (taxByMonth.get(k) || 0) : (m === 0 ? Number(cf.taxExpense || 0) : 0);
      const renovations = renoByMonth.get(k) || 0;
      const netRentMonthly = Number(cf.netRent || 0) / 3;
      const hoaMonthly = Number(cf.hoaExpense || 0) / 3;
      const debtDrawdown = m === 0 ? Number(cf.debtDrawdown || 0) : 0;
      const grossSaleProceeds = m === 2 ? Number(cf.grossSaleProceeds || 0) : 0;
      const mmLiquidation = m === 2 ? Number(cf.mmLiquidation || 0) : 0;
      const lpDistributions = m === 2 ? Number(cf.lpDistributions || 0) : 0;
      const noi = netRentMonthly - hoaMonthly - insurance - tax - baseFundOpexMonthly - renovations;
      const netCF = -capitalCall + noi - baseMgmtMonthly + debtDrawdown - baseDebtRepayMonthly - baseInterestMonthly + grossSaleProceeds + mmLiquidation - lpDistributions;
      if (Math.abs(netCF) > 0.0001) xirrFlows.push({ date: monthStart, amount: netCF });
    }
  }
  let fundIRR = 0;
  try { fundIRR = xirr(xirrFlows); } catch { fundIRR = 0; }
  const waterfall = runWaterfall({
    totalAvailable: totalDistributions,
    lpCapital,
    gpCoinvest,
    outstandingDebt: exitCF.debtBalance,
    assumptions,
    lpCashFlows: xirrFlows.map((f) => ({ ...f, amount: f.amount * (lpCapital / assumptions.fundSize) })),
  });
  const lpMOIC = calcLPMOIC(waterfall.totalLP + interimDistributions, lpCapital);
  const gpEcon = calcGPEconomics({
    assumptions,
    waterfall,
    totalNOI,
    actualHoldYears: assumptions.fundTermYears,
    actualYield: exitCF.netOperatingIncome > 0 ? (exitCF.netOperatingIncome * 4) / totalCapitalDeployed : 0,
    fundIRR,
    capitalDeployed: totalCapitalDeployed,
    numQuartersInvesting: assumptions.investmentPeriodYears * 4,
    numQuartersPost: (assumptions.fundTermYears - assumptions.investmentPeriodYears) * 4,
    cashFlows,
  });
  return {
    assumptions,
    cashFlows,
    renovationEvents: renoEvents,
    acquisitionEvents,
    capitalCallEvents,
    portfolioUnits,
    annualExpenseEvents: annualEvents,
    liquidityLedger,
    dataSource,
    returns: {
      totalEquityCommitted: assumptions.fundSize,
      capitalDeployed: totalCapitalDeployed,
      totalDistributions: totalDistributions + interimDistributions,
      totalNOI,
      netProfit: totalDistributions + interimDistributions - totalCapitalDeployed,
      fundMOIC,
      fundIRR,
      lpMOIC,
      lpIRR: 0,
      gpEconomics: gpEcon,
      waterfall,
    },
    waterfall,
    gpEconomics: gpEcon,
  };
}

function getPortfolioUnitsForModel(db: ReturnType<typeof getDb>) {
  const rows = db.prepare(`
    SELECT
      pu.id as portfolio_unit_id,
      bu.unit_number,
      pu.purchase_date,
      COALESCE(pu.monthly_hoa, 0) as monthly_hoa,
      COALESCE(pu.monthly_rent, 0) as proforma_monthly_rent,
      t.monthly_rent as tenant_monthly_rent,
      t.lease_start,
      t.lease_end,
      t.status as tenant_status
    FROM portfolio_units pu
    JOIN building_units bu ON bu.id = pu.building_unit_id
    LEFT JOIN tenants t
      ON t.portfolio_unit_id = pu.id
     AND t.status IN ('active', 'month_to_month')
    WHERE pu.purchase_date IS NOT NULL
    ORDER BY pu.purchase_date ASC
  `).all() as any[];

  return rows.map((r) => ({
    portfolioUnitId: Number(r.portfolio_unit_id),
    unitNumber: String(r.unit_number),
    purchaseDate: String(r.purchase_date),
    monthlyHOA: Number(r.monthly_hoa || 0),
    proformaMonthlyRent: Number(r.proforma_monthly_rent || 0),
    tenantMonthlyRent: r.tenant_monthly_rent != null ? Number(r.tenant_monthly_rent) : null,
    leaseStart: r.lease_start ? String(r.lease_start) : null,
    leaseEnd: r.lease_end ? String(r.lease_end) : null,
    tenantStatus: r.tenant_status ? String(r.tenant_status) : null,
  }));
}

function evaluateAssumptions(
  assumptions: FundAssumptions,
  db: ReturnType<typeof getDb>,
  mode: ModelDataMode = 'auto'
): ModelEvalResult {
  // Build inputs from real portfolio data (or defaults)
  const { input: cfInput, dataSource } = buildCashFlowInput(assumptions, db, mode);

  // Generate cash flows
  const baseCashFlows = projectCashFlows(cfInput);

  // Apply real renovation timing/costs and annual insurance/tax timing from portfolio
  const reno = getRenovationEvents(db);
  const acquisitionEvents = getAcquisitionEvents(db);
  const capitalCallEvents = getCapitalCallEvents(db);
  const liquidityLedger = buildLiquidityLedger(assumptions, capitalCallEvents, acquisitionEvents, db);
  const annualOps = getAnnualExpenseEvents(db, assumptions, assumptions.fundTermYears);
  const portfolioUnits = getPortfolioUnitsForModel(db);
  const cashFlows = baseCashFlows.map((cf) => {
    const renovationCost = reno.byQuarter.get(cf.quarterIndex) || 0;
    const insuranceCost = annualOps.byQuarterInsurance.get(cf.quarterIndex) || 0;
    const taxCost = annualOps.byQuarterTax.get(cf.quarterIndex) || 0;
    return {
      ...cf,
      renovationCost,
      insuranceExpense: cf.insuranceExpense + insuranceCost,
      taxExpense: cf.taxExpense + taxCost,
      operatingExpense: cf.operatingExpense + renovationCost,
      netOperatingIncome: cf.netOperatingIncome - renovationCost - insuranceCost - taxCost,
      netCashFlow: cf.netCashFlow - renovationCost - insuranceCost - taxCost,
    };
  });
  let cumulative = 0;
  for (const cf of cashFlows) {
    cumulative += cf.netCashFlow;
    cf.cumulativeCashFlow = cumulative;
  }

  // Calculate returns
  const exitCF = cashFlows[cashFlows.length - 1];
  const totalDistributions = exitCF.grossSaleProceeds + exitCF.mmLiquidation;
  const interimDistributions = cashFlows.reduce((s, cf) => s + (cf.lpDistributions || 0), 0);
  const totalCapitalDeployed = cashFlows.reduce((s, cf) => s + cf.capitalCalls, 0);
  const totalNOI = cashFlows.reduce((s, cf) => s + cf.netOperatingIncome, 0);

  const gpCoinvest = assumptions.fundSize * assumptions.gpCoinvestPct;
  const lpCapital = assumptions.fundSize - gpCoinvest;

  // Fund MOIC
  const fundMOIC = calcMOIC(totalDistributions + interimDistributions, totalCapitalDeployed);

  // Build XIRR cash flows
  // Compute IRR using monthly-dated cash flows (no quarterly smoothing for discrete events).
  // This keeps tax/insurance/capital calls/renovations on their actual months/dates.
  const insuranceByMonth = new Map<string, number>();
  const taxByMonth = new Map<string, number>();
  for (const ev of annualOps.events) {
    const k = monthKeyFromDate(ev.paidDate);
    if (!k) continue;
    if (ev.category === 'insurance') insuranceByMonth.set(k, (insuranceByMonth.get(k) || 0) + ev.amount);
    if (ev.category === 'tax') taxByMonth.set(k, (taxByMonth.get(k) || 0) + ev.amount);
  }
  const renoByMonth = new Map<string, number>();
  for (const ev of reno.events) {
    const k = monthKeyFromDate(ev.paidDate);
    if (!k) continue;
    renoByMonth.set(k, (renoByMonth.get(k) || 0) + ev.amount);
  }
  const callByMonth = new Map<string, number>();
  for (const ev of capitalCallEvents) {
    const k = monthKeyFromDate(ev.paidDate);
    if (!k) continue;
    callByMonth.set(k, (callByMonth.get(k) || 0) + ev.amount);
  }
  const hasCallEvents = capitalCallEvents.length > 0;
  const hasAnnualOpsEvents = annualOps.events.length > 0;

  const xirrFlows: Array<{ date: Date; amount: number }> = [];
  for (const cf of cashFlows) {
    const quarterReno = Number(cf.renovationCost || 0);
    const baseFundOpexMonthly = Math.max(0, (Number(cf.operatingExpense || 0) - quarterReno) / 3);
    const baseMgmtMonthly = Number(cf.mgmtFee || 0) / 3;
    const baseDebtRepayMonthly = Number(cf.debtRepayment || 0) / 3;
    const baseInterestMonthly = Number(cf.interestExpense || 0) / 3;

    for (let m = 0; m < 3; m++) {
      const monthStart = monthStartFromQuarterMonth(String(cf.date), m);
      if (!monthStart) continue;
      const k = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`;

      // Discrete events: never smooth. If we don't have actual events, post projected quarter in first month.
      const capitalCall = hasCallEvents ? (callByMonth.get(k) || 0) : (m === 0 ? Number(cf.capitalCalls || 0) : 0);
      const insurance = hasAnnualOpsEvents ? (insuranceByMonth.get(k) || 0) : (m === 0 ? Number(cf.insuranceExpense || 0) : 0);
      const tax = hasAnnualOpsEvents ? (taxByMonth.get(k) || 0) : (m === 0 ? Number(cf.taxExpense || 0) : 0);
      const renovations = renoByMonth.get(k) || 0;

      // Continuous items: allocate evenly within the quarter (we only have quarterly outputs from the engine).
      const netRentMonthly = Number(cf.netRent || 0) / 3;
      const hoaMonthly = Number(cf.hoaExpense || 0) / 3;
      const debtDrawdown = m === 0 ? Number(cf.debtDrawdown || 0) : 0;
      const grossSaleProceeds = m === 2 ? Number(cf.grossSaleProceeds || 0) : 0;
      const mmLiquidation = m === 2 ? Number(cf.mmLiquidation || 0) : 0;
      const lpDistributions = m === 2 ? Number(cf.lpDistributions || 0) : 0;

      const noi = netRentMonthly - hoaMonthly - insurance - tax - baseFundOpexMonthly - renovations;
      const netCF =
        -capitalCall
        + noi
        - baseMgmtMonthly
        + debtDrawdown
        - baseDebtRepayMonthly
        - baseInterestMonthly
        + grossSaleProceeds
        + mmLiquidation
        - lpDistributions;

      if (Math.abs(netCF) > 0.0001) {
        xirrFlows.push({ date: monthStart, amount: netCF });
      }
    }
  }

  let fundIRR = 0;
  try {
    fundIRR = xirr(xirrFlows);
  } catch {
    fundIRR = 0;
  }

  // Run waterfall
  const waterfall = runWaterfall({
    totalAvailable: totalDistributions,
    lpCapital,
    gpCoinvest,
    outstandingDebt: exitCF.debtBalance,
    assumptions,
    lpCashFlows: xirrFlows.map(f => ({
      ...f,
      amount: f.amount * (lpCapital / assumptions.fundSize),
    })),
  });

  // LP MOIC includes both interim distributions and terminal waterfall payouts.
  const lpMOIC = calcLPMOIC(waterfall.totalLP + interimDistributions, lpCapital);

  // GP Economics
  const gpEcon = calcGPEconomics({
    assumptions,
    waterfall,
    totalNOI,
    actualHoldYears: assumptions.fundTermYears,
    actualYield: exitCF.netOperatingIncome > 0
      ? (exitCF.netOperatingIncome * 4) / totalCapitalDeployed
      : 0,
    fundIRR,
    capitalDeployed: totalCapitalDeployed,
    numQuartersInvesting: assumptions.investmentPeriodYears * 4,
    numQuartersPost: (assumptions.fundTermYears - assumptions.investmentPeriodYears) * 4,
    cashFlows,
  });

  return {
    assumptions,
    cashFlows,
    renovationEvents: reno.events,
    acquisitionEvents,
    capitalCallEvents,
    portfolioUnits,
    annualExpenseEvents: annualOps.events,
    liquidityLedger,
    dataSource,
    returns: {
      totalEquityCommitted: assumptions.fundSize,
      capitalDeployed: totalCapitalDeployed,
      totalDistributions: totalDistributions + interimDistributions,
      totalNOI,
      netProfit: totalDistributions + interimDistributions - totalCapitalDeployed,
      fundMOIC,
      fundIRR,
      lpMOIC,
      lpIRR: 0, // TODO: compute LP-specific IRR
      gpEconomics: gpEcon,
      waterfall,
    },
    waterfall,
    gpEconomics: gpEcon,
  };
}

type StressKey =
  | 'exitYears'
  | 'landValue'
  | 'landGrowthBps'
  | 'rentGrowthBps'
  | 'vacancyBps'
  | 'expenseOverrun'
  | 'refiRateBps';

type StressDefinition = {
  key: StressKey;
  label: string;
  description: string;
  format: 'years' | 'pct' | 'bps';
  values: number[];
  apply: (a: FundAssumptions, shock: number) => FundAssumptions;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const STRESS_DEFINITIONS: Record<StressKey, StressDefinition> = {
  exitYears: {
    key: 'exitYears',
    label: 'Exit Timing (Hold Period)',
    description: 'Earlier or later exit date impact.',
    format: 'years',
    values: [-2, -1, 0, 1, 2],
    apply: (a, shock) => {
      const fundTermYears = clamp(Math.round(a.fundTermYears + shock), 3, 20);
      const investmentPeriodYears = clamp(Math.min(a.investmentPeriodYears, fundTermYears - 1), 1, 15);
      return {
        ...a,
        fundTermYears,
        investmentPeriodYears,
        bonusMaxYears: clamp(Math.min(a.bonusMaxYears, fundTermYears), 1, 25),
      };
    },
  },
  landValue: {
    key: 'landValue',
    label: 'Land Value Shock',
    description: 'Instant up/down shock to land and basis values.',
    format: 'pct',
    values: [-0.2, -0.1, 0, 0.1, 0.2],
    apply: (a, shock) => ({
      ...a,
      landValueTotal: Math.max(1, a.landValueTotal * (1 + shock)),
      landPSF: Math.max(1, a.landPSF * (1 + shock)),
      buildingValuation: Math.max(1, a.buildingValuation * (1 + shock * 0.35)),
    }),
  },
  landGrowthBps: {
    key: 'landGrowthBps',
    label: 'Land Growth Rate',
    description: 'Long-run land growth assumption in basis points.',
    format: 'bps',
    values: [-150, -75, 0, 75, 150],
    apply: (a, shock) => ({
      ...a,
      landGrowthPct: clamp(a.landGrowthPct + shock / 10_000, -0.1, 0.2),
    }),
  },
  rentGrowthBps: {
    key: 'rentGrowthBps',
    label: 'Rent Growth Rate',
    description: 'Annual rent growth stress in basis points.',
    format: 'bps',
    values: [-150, -75, 0, 75, 150],
    apply: (a, shock) => ({
      ...a,
      rentGrowthPct: clamp(a.rentGrowthPct + shock / 10_000, -0.1, 0.2),
    }),
  },
  vacancyBps: {
    key: 'vacancyBps',
    label: 'Vacancy Shock',
    description: 'Higher/lower vacancy versus base case.',
    format: 'bps',
    values: [-300, -150, 0, 150, 300],
    apply: (a, shock) => ({
      ...a,
      vacancyPct: clamp(a.vacancyPct + shock / 10_000, 0, 0.35),
    }),
  },
  expenseOverrun: {
    key: 'expenseOverrun',
    label: 'Expense Overrun',
    description: 'General opex pressure via HOA growth and fee rates.',
    format: 'pct',
    values: [0, 0.1, 0.2, 0.3, 0.4],
    apply: (a, shock) => ({
      ...a,
      hoaGrowthPct: clamp(a.hoaGrowthPct * (1 + shock), -0.05, 0.25),
      mgmtFeeInvestPct: clamp(a.mgmtFeeInvestPct * (1 + shock), 0, 0.1),
      mgmtFeePostPct: clamp(a.mgmtFeePostPct * (1 + shock), 0, 0.1),
      refiCostPct: clamp(a.refiCostPct * (1 + shock), 0, 0.2),
    }),
  },
  refiRateBps: {
    key: 'refiRateBps',
    label: 'Interest / Refi Rate',
    description: 'Debt/refinance rate stress in basis points.',
    format: 'bps',
    values: [-100, -50, 0, 50, 100],
    apply: (a, shock) => ({
      ...a,
      refiRate: clamp(a.refiRate + shock / 10_000, 0.01, 0.2),
    }),
  },
};

function getScenarioAssumptions(db: ReturnType<typeof getDb>, scenarioId?: number): FundAssumptions | null {
  const row = db.prepare('SELECT * FROM fund_assumptions WHERE id = ?').get(scenarioId || 1) as any;
  return row ? rowToAssumptions(row) : null;
}

async function getScenarioAssumptionsPg(scenarioId?: number): Promise<FundAssumptions | null> {
  return withPostgresClient(async (client) => {
    const result = await client.query('SELECT * FROM fund_assumptions WHERE id = $1 LIMIT 1', [scenarioId || 1]);
    const row = result.rows[0] as any;
    return row ? rowToAssumptions(row) : null;
  });
}

// GET /api/model/scenarios
router.get('/scenarios', async (req: Request, res: Response) => {
  const rows = usePostgresModel()
    ? await withPostgresClient(async (client) => {
      const result = await client.query('SELECT * FROM fund_assumptions ORDER BY is_active DESC, created_at DESC');
      return result.rows;
    })
    : getDb().prepare('SELECT * FROM fund_assumptions ORDER BY is_active DESC, created_at DESC').all();
  res.json(rows.map(rowToAssumptions));
});

// POST /api/model/scenarios — Create new scenario
router.post('/scenarios', async (req: Request, res: Response) => {
  const a = req.body as FundAssumptions;

  const params = assumptionsToRow(a);
  const sql = `
    INSERT INTO fund_assumptions (
      name, is_active, fund_size, fund_term_years, investment_period_years,
      gp_coinvest_pct, mgmt_fee_invest_pct, mgmt_fee_post_pct, mgmt_fee_waiver,
      pref_return_pct, catchup_pct,
      tier1_split_lp, tier1_split_gp, tier2_hurdle_irr, tier2_split_lp, tier2_split_gp,
      tier3_hurdle_irr, tier3_split_lp, tier3_split_gp,
      refi_enabled, refi_year, refi_ltv, refi_rate, refi_term_years, refi_cost_pct,
      rent_growth_pct, hoa_growth_pct, tax_growth_pct, vacancy_pct,
      annual_fund_opex_mode, annual_fund_opex_fixed, annual_fund_opex_threshold_pct, annual_fund_opex_adjust_pct,
      present_day_land_value,
      land_value_total, land_growth_pct, land_psf,
      mm_rate, excess_cash_mode, building_valuation,
      bonus_irr_threshold, bonus_max_years, bonus_yield_threshold
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const insertedId = usePostgresModel()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        `INSERT INTO fund_assumptions (
          name, is_active, fund_size, fund_term_years, investment_period_years,
          gp_coinvest_pct, mgmt_fee_invest_pct, mgmt_fee_post_pct, mgmt_fee_waiver,
          pref_return_pct, catchup_pct,
          tier1_split_lp, tier1_split_gp, tier2_hurdle_irr, tier2_split_lp, tier2_split_gp,
          tier3_hurdle_irr, tier3_split_lp, tier3_split_gp,
          refi_enabled, refi_year, refi_ltv, refi_rate, refi_term_years, refi_cost_pct,
          rent_growth_pct, hoa_growth_pct, tax_growth_pct, vacancy_pct,
          annual_fund_opex_mode, annual_fund_opex_fixed, annual_fund_opex_threshold_pct, annual_fund_opex_adjust_pct,
          present_day_land_value,
          land_value_total, land_growth_pct, land_psf,
          mm_rate, excess_cash_mode, building_valuation,
          bonus_irr_threshold, bonus_max_years, bonus_yield_threshold
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11,
          $12, $13, $14, $15, $16,
          $17, $18, $19,
          $20, $21, $22, $23, $24, $25,
          $26, $27, $28, $29,
          $30, $31, $32, $33,
          $34,
          $35, $36, $37,
          $38, $39, $40,
          $41, $42, $43
        ) RETURNING id`,
        params
      );
      return Number(result.rows[0]?.id || 0);
    })
    : Number(getDb().prepare(sql).run(...params).lastInsertRowid);
  res.status(201).json({ id: insertedId });
});

// PUT /api/model/scenarios/:id — Update existing scenario
router.put('/scenarios/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const a = req.body as FundAssumptions;

  const existing = usePostgresModel()
    ? await withPostgresClient(async (client) => {
      const result = await client.query('SELECT id FROM fund_assumptions WHERE id = $1 LIMIT 1', [id]);
      return result.rows[0] || null;
    })
    : getDb().prepare('SELECT id FROM fund_assumptions WHERE id = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'Scenario not found' });
    return;
  }

  const params = [...assumptionsToRow(a), id];
  if (usePostgresModel()) {
    await withPostgresClient(async (client) => {
      await client.query(
        `UPDATE fund_assumptions SET
           name = $1, is_active = $2, fund_size = $3, fund_term_years = $4, investment_period_years = $5,
           gp_coinvest_pct = $6, mgmt_fee_invest_pct = $7, mgmt_fee_post_pct = $8, mgmt_fee_waiver = $9,
           pref_return_pct = $10, catchup_pct = $11,
           tier1_split_lp = $12, tier1_split_gp = $13, tier2_hurdle_irr = $14, tier2_split_lp = $15, tier2_split_gp = $16,
           tier3_hurdle_irr = $17, tier3_split_lp = $18, tier3_split_gp = $19,
           refi_enabled = $20, refi_year = $21, refi_ltv = $22, refi_rate = $23, refi_term_years = $24, refi_cost_pct = $25,
           rent_growth_pct = $26, hoa_growth_pct = $27, tax_growth_pct = $28, vacancy_pct = $29,
           annual_fund_opex_mode = $30, annual_fund_opex_fixed = $31, annual_fund_opex_threshold_pct = $32, annual_fund_opex_adjust_pct = $33,
           present_day_land_value = $34,
           land_value_total = $35, land_growth_pct = $36, land_psf = $37,
           mm_rate = $38, excess_cash_mode = $39, building_valuation = $40,
           bonus_irr_threshold = $41, bonus_max_years = $42, bonus_yield_threshold = $43
         WHERE id = $44`,
        params
      );
    });
  } else {
    getDb().prepare(`
      UPDATE fund_assumptions SET
        name = ?, is_active = ?, fund_size = ?, fund_term_years = ?, investment_period_years = ?,
        gp_coinvest_pct = ?, mgmt_fee_invest_pct = ?, mgmt_fee_post_pct = ?, mgmt_fee_waiver = ?,
        pref_return_pct = ?, catchup_pct = ?,
        tier1_split_lp = ?, tier1_split_gp = ?, tier2_hurdle_irr = ?, tier2_split_lp = ?, tier2_split_gp = ?,
        tier3_hurdle_irr = ?, tier3_split_lp = ?, tier3_split_gp = ?,
        refi_enabled = ?, refi_year = ?, refi_ltv = ?, refi_rate = ?, refi_term_years = ?, refi_cost_pct = ?,
        rent_growth_pct = ?, hoa_growth_pct = ?, tax_growth_pct = ?, vacancy_pct = ?,
        annual_fund_opex_mode = ?, annual_fund_opex_fixed = ?, annual_fund_opex_threshold_pct = ?, annual_fund_opex_adjust_pct = ?,
        present_day_land_value = ?,
        land_value_total = ?, land_growth_pct = ?, land_psf = ?,
        mm_rate = ?, excess_cash_mode = ?, building_valuation = ?,
        bonus_irr_threshold = ?, bonus_max_years = ?, bonus_yield_threshold = ?
      WHERE id = ?
    `).run(...params);
  }

  res.json({ success: true });
});

// DELETE /api/model/scenarios/:id
router.delete('/scenarios/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  const existing = usePostgresModel()
    ? await withPostgresClient(async (client) => {
      const result = await client.query('SELECT id FROM fund_assumptions WHERE id = $1 LIMIT 1', [id]);
      return result.rows[0] || null;
    })
    : getDb().prepare('SELECT id FROM fund_assumptions WHERE id = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'Scenario not found' });
    return;
  }

  if (usePostgresModel()) {
    await withPostgresClient(async (client) => {
      await client.query('DELETE FROM fund_assumptions WHERE id = $1', [id]);
    });
  } else {
    getDb().prepare('DELETE FROM fund_assumptions WHERE id = ?').run(id);
  }
  res.json({ success: true });
});

// POST /api/model/run - Run full projection (uses real portfolio data when available)
router.post('/run', async (req: Request, res: Response) => {
  const db = getDb();
  const { scenarioId, dataMode } = req.body as { scenarioId?: number; dataMode?: ModelDataMode };

  const assumptions = usePostgresModel()
    ? await getScenarioAssumptionsPg(scenarioId)
    : getScenarioAssumptions(db, scenarioId);
  if (!assumptions) {
    res.status(404).json({ error: 'Scenario not found' });
    return;
  }
  const mode: ModelDataMode = (dataMode === 'defaults' || dataMode === 'sample') ? dataMode : 'auto';
  const result = usePostgresModel()
    ? evaluateAssumptionsPg(assumptions, await fetchModelSnapshotPg(), mode)
    : evaluateAssumptions(assumptions, db, mode);
  res.json(result);
});

// POST /api/model/sensitivity
router.post('/sensitivity', async (req: Request, res: Response) => {
  const db = getDb();
  const { scenarioId, preset } = req.body;

  const assumptions = usePostgresModel()
    ? await getScenarioAssumptionsPg(scenarioId)
    : getScenarioAssumptions(db, scenarioId);
  if (!assumptions) {
    res.status(404).json({ error: 'Scenario not found' });
    return;
  }

  const presetFn = SENSITIVITY_PRESETS[preset as keyof typeof SENSITIVITY_PRESETS];
  if (!presetFn) {
    res.status(400).json({ error: 'Unknown preset. Use: moicVsLandGrowthAndHold, irrVsLandGrowthAndHold, lpMoicVsLandPremiumAndVacancy' });
    return;
  }

  const config = presetFn(assumptions);
  const pgSnapshot = usePostgresModel() ? await fetchModelSnapshotPg() : null;
  const result = generateSensitivityTable(assumptions, config, (a) => {
    return pgSnapshot
      ? evaluateAssumptionsPg(a, pgSnapshot, 'auto').returns.fundMOIC
      : evaluateAssumptions(a, db, 'auto').returns.fundMOIC;
  });

  res.json(result);
});

// POST /api/model/sensitivity-stress
router.post('/sensitivity-stress', async (req: Request, res: Response) => {
  const db = getDb();
  const { scenarioId, enabledKeys, rowKey, colKey } = req.body as {
    scenarioId?: number;
    enabledKeys?: string[];
    rowKey?: StressKey;
    colKey?: StressKey;
  };

  const assumptions = usePostgresModel()
    ? await getScenarioAssumptionsPg(scenarioId)
    : getScenarioAssumptions(db, scenarioId);
  if (!assumptions) {
    res.status(404).json({ error: 'Scenario not found' });
    return;
  }

  const validKeys = Object.keys(STRESS_DEFINITIONS) as StressKey[];
  const selectedKeys = (enabledKeys || [])
    .filter((k): k is StressKey => validKeys.includes(k as StressKey));
  const keys = selectedKeys.length > 0 ? selectedKeys : (['exitYears', 'landValue', 'vacancyBps', 'expenseOverrun'] as StressKey[]);

  const cache = new Map<string, { fundIRR: number; fundMOIC: number; lpMOIC: number; netProfit: number }>();
  const pgSnapshot = usePostgresModel() ? await fetchModelSnapshotPg() : null;
  const evaluateMetrics = (a: FundAssumptions) => {
    const key = JSON.stringify([
      a.fundTermYears, a.investmentPeriodYears, a.landValueTotal, a.landGrowthPct, a.rentGrowthPct,
      a.vacancyPct, a.hoaGrowthPct, a.mgmtFeeInvestPct, a.mgmtFeePostPct, a.refiRate, a.refiCostPct, a.landPSF, a.buildingValuation,
      a.presentDayLandValue,
    ]);
    const hit = cache.get(key);
    if (hit) return hit;
    const out = pgSnapshot
      ? evaluateAssumptionsPg(a, pgSnapshot, 'auto')
      : evaluateAssumptions(a, db, 'auto');
    const metrics = {
      fundIRR: out.returns.fundIRR,
      fundMOIC: out.returns.fundMOIC,
      lpMOIC: out.returns.lpMOIC,
      netProfit: out.returns.netProfit,
    };
    cache.set(key, metrics);
    return metrics;
  };

  const base = evaluateMetrics(assumptions);

  const oneWay = keys.map((k) => {
    const def = STRESS_DEFINITIONS[k];
    const rows = def.values.map((shock) => {
      const stressed = def.apply(assumptions, shock);
      const m = evaluateMetrics(stressed);
      return {
        shock,
        fundIRR: m.fundIRR,
        fundMOIC: m.fundMOIC,
        lpMOIC: m.lpMOIC,
        netProfit: m.netProfit,
        deltaIRR: m.fundIRR - base.fundIRR,
        deltaMOIC: m.fundMOIC - base.fundMOIC,
        deltaLPMOIC: m.lpMOIC - base.lpMOIC,
        deltaNetProfit: m.netProfit - base.netProfit,
      };
    });
    return {
      key: def.key,
      label: def.label,
      description: def.description,
      format: def.format,
      rows,
    };
  });

  const defaultRowKey = keys[0] || 'exitYears';
  const defaultColKey = keys.find((k) => k !== defaultRowKey) || 'landValue';
  const matrixRowKey = (rowKey && validKeys.includes(rowKey)) ? rowKey : defaultRowKey;
  const matrixColKey = (colKey && validKeys.includes(colKey) && colKey !== matrixRowKey) ? colKey : defaultColKey;
  const rowDef = STRESS_DEFINITIONS[matrixRowKey];
  const colDef = STRESS_DEFINITIONS[matrixColKey];

  const matrix = rowDef.values.map((rowShock) => {
    return colDef.values.map((colShock) => {
      const rowApplied = rowDef.apply(assumptions, rowShock);
      const bothApplied = colDef.apply(rowApplied, colShock);
      const m = evaluateMetrics(bothApplied);
      return {
        fundIRR: m.fundIRR,
        fundMOIC: m.fundMOIC,
        lpMOIC: m.lpMOIC,
        netProfit: m.netProfit,
        deltaIRR: m.fundIRR - base.fundIRR,
        deltaMOIC: m.fundMOIC - base.fundMOIC,
      };
    });
  });

  res.json({
    base: {
      scenarioId: assumptions.id,
      scenarioName: assumptions.name,
      fundIRR: base.fundIRR,
      fundMOIC: base.fundMOIC,
      lpMOIC: base.lpMOIC,
      netProfit: base.netProfit,
    },
    options: validKeys.map((k) => ({
      key: k,
      label: STRESS_DEFINITIONS[k].label,
      description: STRESS_DEFINITIONS[k].description,
      format: STRESS_DEFINITIONS[k].format,
      values: STRESS_DEFINITIONS[k].values,
    })),
    selectedKeys: keys,
    oneWay,
    matrix: {
      rowKey: matrixRowKey,
      rowLabel: rowDef.label,
      rowFormat: rowDef.format,
      rowValues: rowDef.values,
      colKey: matrixColKey,
      colLabel: colDef.label,
      colFormat: colDef.format,
      colValues: colDef.values,
      data: matrix,
    },
  });
});

export default router;
