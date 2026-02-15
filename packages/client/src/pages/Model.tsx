import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from 'recharts';
import api from '../lib/api';
import { fmtCurrency, fmtCurrencyCompact, fmtPct, fmtNumber } from '../lib/format';

/* ── Types ──────────────────────────────────────────────────── */

interface FundAssumptions {
  id?: number;
  name: string;
  isActive: boolean;
  fundSize: number;
  fundTermYears: number;
  investmentPeriodYears: number;
  gpCoinvestPct: number;
  mgmtFeeInvestPct: number;
  mgmtFeePostPct: number;
  mgmtFeeWaiver: boolean;
  prefReturnPct: number;
  catchupPct: number;
  tier1SplitLP: number;
  tier1SplitGP: number;
  tier2HurdleIRR: number;
  tier2SplitLP: number;
  tier2SplitGP: number;
  tier3HurdleIRR: number;
  tier3SplitLP: number;
  tier3SplitGP: number;
  refiEnabled: boolean;
  refiYear: number;
  refiLTV: number;
  refiRate: number;
  refiTermYears: number;
  refiCostPct: number;
  rentGrowthPct: number;
  hoaGrowthPct: number;
  vacancyPct: number;
  annualFundOpexMode: 'fixed' | 'threshold_pct';
  annualFundOpexFixed: number;
  annualFundOpexThresholdPct: number;
  annualFundOpexAdjustPct: number;
  presentDayLandValue: number;
  landValueTotal: number;
  landGrowthPct: number;
  landPSF: number;
  mmRate: number;
  excessCashMode: 'reinvest' | 'mm_sweep' | 'distribute';
  buildingValuation: number;
  bonusIRRThreshold: number;
  bonusMaxYears: number;
  bonusYieldThreshold: number;
}

const DEFAULT_ASSUMPTIONS: FundAssumptions = {
  name: 'New Scenario',
  isActive: false,
  fundSize: 20_000_000,
  fundTermYears: 12,
  investmentPeriodYears: 5,
  gpCoinvestPct: 0.05,
  mgmtFeeInvestPct: 0,
  mgmtFeePostPct: 0.005,
  mgmtFeeWaiver: true,
  prefReturnPct: 0.06,
  catchupPct: 1.0,
  tier1SplitLP: 0.80,
  tier1SplitGP: 0.20,
  tier2HurdleIRR: 0.15,
  tier2SplitLP: 0.70,
  tier2SplitGP: 0.30,
  tier3HurdleIRR: 0.25,
  tier3SplitLP: 0.65,
  tier3SplitGP: 0.35,
  refiEnabled: true,
  refiYear: 6,
  refiLTV: 0.55,
  refiRate: 0.06,
  refiTermYears: 30,
  refiCostPct: 0.02,
  rentGrowthPct: 0.03,
  hoaGrowthPct: 0.02,
  vacancyPct: 0.05,
  annualFundOpexMode: 'fixed',
  annualFundOpexFixed: 75_000,
  annualFundOpexThresholdPct: 0.02,
  annualFundOpexAdjustPct: 0,
  presentDayLandValue: 650_000_000,
  landValueTotal: 800_000_000,
  landGrowthPct: 0.03,
  landPSF: 1700,
  mmRate: 0.045,
  excessCashMode: 'mm_sweep',
  buildingValuation: 215_000_000,
  bonusIRRThreshold: 0.25,
  bonusMaxYears: 12,
  bonusYieldThreshold: 0.04,
};

interface QuarterlyCashFlow {
  quarter: string;
  date: string;
  quarterIndex: number;
  capitalCalls: number;
  capitalReturns: number;
  unitsAcquired: number;
  acquisitionCost: number;
  cumulativeUnits: number;
  grossRent: number;
  vacancy: number;
  netRent: number;
  hoaExpense: number;
  insuranceExpense: number;
  taxExpense: number;
  operatingExpense: number;
  renovationCost?: number;
  netOperatingIncome: number;
  debtDrawdown: number;
  debtRepayment: number;
  interestExpense: number;
  debtBalance: number;
  excessCash: number;
  mmDeposit: number;
  mmWithdrawal: number;
  mmBalance: number;
  mmIncome: number;
  lpDistributions: number;
  mgmtFee: number;
  grossSaleProceeds: number;
  mmLiquidation: number;
  netCashFlow: number;
  cumulativeCashFlow: number;
}

interface WaterfallTier {
  name: string;
  lpAmount: number;
  gpAmount: number;
  totalAmount: number;
}

interface WaterfallResult {
  tiers: WaterfallTier[];
  totalLP: number;
  totalGP: number;
  totalDistributed: number;
  lpPct: number;
  gpPct: number;
}

interface GPEconomics {
  mgmtFeesTotal: number;
  mgmtFeesByYear: number[];
  carryTotal: number;
  carryCatchup: number;
  carryTier1: number;
  carryTier2: number;
  carryTier3: number;
  coinvestReturn: number;
  coinvestCapital: number;
  totalGPComp: number;
  gpIRR: number;
  gpMOIC: number;
  bonusTriggers: {
    irrMet: boolean;
    holdMet: boolean;
    yieldMet: boolean;
    actualIRR: number;
    actualHoldYears: number;
    actualYield: number;
  };
}

interface FundReturns {
  totalEquityCommitted: number;
  capitalDeployed: number;
  totalDistributions: number;
  totalNOI: number;
  netProfit: number;
  fundMOIC: number;
  fundIRR: number;
  lpMOIC: number;
  lpIRR: number;
  gpEconomics: GPEconomics;
  waterfall: WaterfallResult;
}

interface DataSource {
  type: 'portfolio' | 'defaults';
  unitCount: number;
  avgRent: number;
  avgHOA: number;
}

interface ModelRunResult {
  assumptions: FundAssumptions;
  cashFlows: QuarterlyCashFlow[];
  returns: FundReturns;
  waterfall: WaterfallResult;
  gpEconomics: GPEconomics;
  dataSource: DataSource;
  renovationEvents?: Array<{
    id: number;
    portfolioUnitId: number;
    unitNumber: string;
    description: string;
    status: string;
    paidDate: string;
    quarterIndex: number;
    amount: number;
  }>;
  acquisitionEvents?: Array<{
    portfolioUnitId: number;
    unitNumber: string;
    paidDate: string;
    quarterIndex: number;
    amount: number;
  }>;
  capitalCallEvents?: Array<{
    paidDate: string;
    quarterIndex: number;
    amount: number;
  }>;
  liquidityLedger?: Array<{
    label: string;
    month: string;
    capitalCalled: number;
    deployed: number;
    mmIncome: number;
    mmBalanceStart: number;
    mmBalanceEnd: number;
  }>;
}

interface ActualTxn {
  id: number;
  date: string;
  amount: number;
  category: string;
}

/* ── Formatting (using centralized format.ts) ────────────────── */

// Alias for chart axes (compact) and keep backward compat in CSV export
const fmt = fmtCurrency;
const fmtCompact = fmtCurrencyCompact;
const pct = fmtPct;
const num = fmtNumber;

const tooltipStyle = {
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text-primary)',
  fontSize: '0.8rem',
};

/* ── CSV Export ──────────────────────────────────────────────── */

type ReportType = 'cashflows' | 'income_statement' | 'balance_sheet' | 'cash_flow_statement' | 'trial_balance' | 'capital_accounts';

const REPORT_LABELS: Record<ReportType, string> = {
  cashflows: 'Cash Flows',
  income_statement: 'Income Statement',
  balance_sheet: 'Balance Sheet',
  cash_flow_statement: 'Cash Flow Statement',
  trial_balance: 'Trial Balance',
  capital_accounts: 'Capital Accounts',
};

function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportCashFlowCSV(cashFlows: QuarterlyCashFlow[]) {
  const headers = [
    'Quarter', 'Date', 'Capital Calls', 'Gross Rent', 'HOA', 'Net Rent',
    'NOI', 'Debt Balance', 'MM Balance', 'Net Cash Flow', 'Cumulative',
  ];
  const rows = cashFlows.map((cf) => [
    cf.quarter, cf.date, cf.capitalCalls.toFixed(2), cf.grossRent.toFixed(2),
    cf.hoaExpense.toFixed(2), cf.netRent.toFixed(2), cf.netOperatingIncome.toFixed(2),
    cf.debtBalance.toFixed(2), cf.mmBalance.toFixed(2), cf.netCashFlow.toFixed(2),
    cf.cumulativeCashFlow.toFixed(2),
  ]);
  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  downloadCSV(csv, `cashflows_${new Date().toISOString().slice(0, 10)}.csv`);
}

function generateAccountingCSV(
  reportType: ReportType,
  cashFlows: QuarterlyCashFlow[],
  returns: FundReturns,
): void {
  const today = new Date().toISOString().slice(0, 10);
  const fmtN = (n: number) => n.toFixed(2);
  const sumF = (field: keyof QuarterlyCashFlow) =>
    cashFlows.reduce((s, cf) => s + (cf[field] as number), 0);

  switch (reportType) {
    case 'cashflows': exportCashFlowCSV(cashFlows); return;
    case 'income_statement': {
      const last = cashFlows[cashFlows.length - 1];
      const first = cashFlows[0];
      const period = `${first?.quarter} - ${last?.quarter}`;
      const lines = [
        `Income Statement,${period}`, `As of,${last?.date ?? today}`, '',
        'REVENUE,,', 'Account,Category,Amount',
        `Gross Rental Income,Revenue,${fmtN(sumF('grossRent'))}`,
        `Less: Vacancy,Revenue,${fmtN(-sumF('vacancy'))}`,
        `Money Market Income,Revenue,${fmtN(sumF('mmIncome'))}`,
        `Gain on Sale (Land),Revenue,${fmtN(sumF('grossSaleProceeds'))}`,
        `Total Revenue,,${fmtN(sumF('grossRent') - sumF('vacancy') + sumF('mmIncome') + sumF('grossSaleProceeds'))}`,
        '', 'EXPENSES,,',
        `HOA Expenses,Expense,${fmtN(sumF('hoaExpense'))}`,
        `Insurance,Expense,${fmtN(sumF('insuranceExpense'))}`,
        `Property Tax,Expense,${fmtN(sumF('taxExpense'))}`,
        `Fund Operating Expenses,Expense,${fmtN(sumF('operatingExpense'))}`,
        `Interest Expense,Expense,${fmtN(sumF('interestExpense'))}`,
        `Management Fees,Expense,${fmtN(sumF('mgmtFee'))}`,
        `Total Expenses,,${fmtN(sumF('hoaExpense') + sumF('insuranceExpense') + sumF('taxExpense') + sumF('operatingExpense') + sumF('interestExpense') + sumF('mgmtFee'))}`,
        '',
        `NET INCOME,,${fmtN(sumF('grossRent') - sumF('vacancy') + sumF('mmIncome') + sumF('grossSaleProceeds') - sumF('hoaExpense') - sumF('insuranceExpense') - sumF('taxExpense') - sumF('operatingExpense') - sumF('interestExpense') - sumF('mgmtFee'))}`,
      ];
      downloadCSV(lines.join('\n'), `income_statement_${today}.csv`);
      return;
    }
    case 'balance_sheet': {
      const cf = cashFlows[cashFlows.length - 1];
      const totalAcq = sumF('acquisitionCost');
      const totalCap = sumF('capitalCalls');
      const totalDist = sumF('lpDistributions');
      const lines = [
        'Balance Sheet', `As of,${cf?.date ?? today}`, '',
        'ASSETS,,', 'Account,Category,Amount',
        `Real Estate (at cost),Assets,${fmtN(totalAcq)}`,
        `Money Market Account,Assets,${fmtN(cf?.mmBalance ?? 0)}`,
        `Cash & Equivalents,Assets,${fmtN(Math.max(0, (cf?.cumulativeCashFlow ?? 0) - (cf?.mmBalance ?? 0)))}`,
        `Total Assets,,${fmtN(totalAcq + (cf?.mmBalance ?? 0) + Math.max(0, (cf?.cumulativeCashFlow ?? 0) - (cf?.mmBalance ?? 0)))}`,
        '', 'LIABILITIES,,',
        `Debt Facility,Liabilities,${fmtN(cf?.debtBalance ?? 0)}`,
        `Total Liabilities,,${fmtN(cf?.debtBalance ?? 0)}`,
        '', 'EQUITY,,',
        `Partner Capital,Equity,${fmtN(totalCap)}`,
        `Retained Earnings,Equity,${fmtN((cf?.cumulativeCashFlow ?? 0))}`,
        `Less: Distributions,Equity,${fmtN(-totalDist)}`,
        `Total Equity,,${fmtN(totalCap + (cf?.cumulativeCashFlow ?? 0) - totalDist)}`,
      ];
      downloadCSV(lines.join('\n'), `balance_sheet_${today}.csv`);
      return;
    }
    case 'cash_flow_statement': {
      const cf = cashFlows[cashFlows.length - 1];
      const first = cashFlows[0];
      const period = `${first?.quarter} - ${cf?.quarter}`;
      const opCash = sumF('netRent') - sumF('hoaExpense') - sumF('insuranceExpense')
        - sumF('taxExpense') - sumF('operatingExpense') - sumF('mgmtFee')
        + sumF('mmIncome') - sumF('interestExpense');
      const invCash = -sumF('acquisitionCost') + sumF('grossSaleProceeds')
        - (sumF('mmDeposit') - sumF('mmWithdrawal') - sumF('mmLiquidation'));
      const finCash = sumF('capitalCalls') + sumF('debtDrawdown')
        - sumF('debtRepayment') - sumF('lpDistributions');
      const lines = [
        `Cash Flow Statement,${period}`, `As of,${cf?.date ?? today}`, '',
        'OPERATING ACTIVITIES,,',
        `Net Rental Income,Operating,${fmtN(sumF('netRent'))}`,
        `HOA Expenses,Operating,${fmtN(-sumF('hoaExpense'))}`,
        `Insurance,Operating,${fmtN(-sumF('insuranceExpense'))}`,
        `Property Tax,Operating,${fmtN(-sumF('taxExpense'))}`,
        `Operating Expenses,Operating,${fmtN(-sumF('operatingExpense'))}`,
        `Management Fees,Operating,${fmtN(-sumF('mgmtFee'))}`,
        `Money Market Income,Operating,${fmtN(sumF('mmIncome'))}`,
        `Interest Expense,Operating,${fmtN(-sumF('interestExpense'))}`,
        `Net Cash from Operations,,${fmtN(opCash)}`,
        '', 'INVESTING ACTIVITIES,,',
        `Acquisitions,Investing,${fmtN(-sumF('acquisitionCost'))}`,
        `Sale Proceeds,Investing,${fmtN(sumF('grossSaleProceeds'))}`,
        `Net Cash from Investing,,${fmtN(invCash)}`,
        '', 'FINANCING ACTIVITIES,,',
        `Capital Calls,Financing,${fmtN(sumF('capitalCalls'))}`,
        `Debt Drawdown,Financing,${fmtN(sumF('debtDrawdown'))}`,
        `Debt Repayment,Financing,${fmtN(-sumF('debtRepayment'))}`,
        `LP Distributions,Financing,${fmtN(-sumF('lpDistributions'))}`,
        `Net Cash from Financing,,${fmtN(finCash)}`,
        '', `Net Change in Cash,,${fmtN(opCash + invCash + finCash)}`,
        `Ending Cash,,${fmtN(cf?.cumulativeCashFlow ?? 0)}`,
      ];
      downloadCSV(lines.join('\n'), `cash_flow_statement_${today}.csv`);
      return;
    }
    case 'trial_balance': {
      const cf = cashFlows[cashFlows.length - 1];
      const totalAcq = sumF('acquisitionCost');
      const totalCap = sumF('capitalCalls');
      const totalDist = sumF('lpDistributions');
      const totalRev = sumF('grossRent') - sumF('vacancy') + sumF('mmIncome') + sumF('grossSaleProceeds');
      const totalExp = sumF('hoaExpense') + sumF('insuranceExpense') + sumF('taxExpense')
        + sumF('operatingExpense') + sumF('interestExpense') + sumF('mgmtFee');
      const lines = [
        'Trial Balance', `As of,${cf?.date ?? today}`, '',
        'Account,Debit,Credit',
        `Real Estate (at cost),${fmtN(totalAcq)},0.00`,
        `Money Market Account,${fmtN(cf?.mmBalance ?? 0)},0.00`,
        `Cash & Equivalents,${fmtN(Math.max(0, (cf?.cumulativeCashFlow ?? 0) - (cf?.mmBalance ?? 0)))},0.00`,
        `Debt Facility,0.00,${fmtN(cf?.debtBalance ?? 0)}`,
        `Partner Capital,0.00,${fmtN(totalCap)}`,
        `Distributions,${fmtN(totalDist)},0.00`,
        `Revenue,0.00,${fmtN(totalRev)}`,
        `Expenses,${fmtN(totalExp)},0.00`,
        '',
        `TOTALS,${fmtN(totalAcq + (cf?.mmBalance ?? 0) + Math.max(0, (cf?.cumulativeCashFlow ?? 0) - (cf?.mmBalance ?? 0)) + totalDist + totalExp)},${fmtN((cf?.debtBalance ?? 0) + totalCap + totalRev)}`,
      ];
      downloadCSV(lines.join('\n'), `trial_balance_${today}.csv`);
      return;
    }
    case 'capital_accounts': {
      const totalCap = sumF('capitalCalls');
      const totalDist = sumF('lpDistributions');
      const totalNOI = sumF('netOperatingIncome');
      const gpCoinvest = returns.totalEquityCommitted * 0.05;
      const lpContrib = totalCap - gpCoinvest;
      const lpAlloc = totalNOI * 0.95;
      const gpCarry = returns.gpEconomics.carryTotal;
      const gpMgmt = returns.gpEconomics.mgmtFeesTotal;
      const gpDistAmt = returns.waterfall.totalGP;
      const lines = [
        'Capital Account Summary', `As of,${cashFlows[cashFlows.length - 1]?.date ?? today}`, '',
        'LP CAPITAL ACCOUNT,,', 'Item,Amount',
        `Beginning Balance,0.00`,
        `Contributions,${fmtN(lpContrib)}`,
        `Income Allocations,${fmtN(lpAlloc)}`,
        `Distributions,${fmtN(-totalDist)}`,
        `Ending Balance,${fmtN(lpContrib + lpAlloc - totalDist)}`,
        '', 'GP CAPITAL ACCOUNT,,', 'Item,Amount',
        `Beginning Balance,0.00`,
        `Co-Investment,${fmtN(gpCoinvest)}`,
        `Carried Interest,${fmtN(gpCarry)}`,
        `Management Fees,${fmtN(gpMgmt)}`,
        `Distributions,${fmtN(-gpDistAmt)}`,
        `Ending Balance,${fmtN(gpCoinvest + gpCarry + gpMgmt - gpDistAmt)}`,
      ];
      downloadCSV(lines.join('\n'), `capital_accounts_${today}.csv`);
      return;
    }
  }
}

/* ── Period aggregation ─────────────────────────────────────── */

type Period = 'Monthly' | 'Quarterly' | 'Yearly';

interface ChartRow {
  label: string;
  noi: number;
  rentIn: number;
  hoaOut: number;
  insuranceOut: number;
  taxOut: number;
  fundOpexOut: number;
  renovationsOut: number;
  mgmtFeeOut: number;
  debtCostOut: number;
  mmIncomeIn: number;
  capitalCalls: number;
  deployments: number;
  renovations: number;
  fundOpex: number;
  mgmtFee: number;
  operatingCashFlow: number;
  netCashFlow: number;
  cumulativeCashFlow: number;
}

function toMonthly(cashFlows: QuarterlyCashFlow[]): ChartRow[] {
  const rows: ChartRow[] = [];
  for (const cf of cashFlows) {
    for (let m = 0; m < 3; m++) {
      const dateObj = new Date(cf.date);
      const monthDate = new Date(dateObj.getFullYear(), dateObj.getMonth() - 2 + m, 1);
      const label = `${monthDate.toLocaleString('default', { month: 'short' })} ${monthDate.getFullYear()}`;
      const reno = (cf.renovationCost || 0) / 3;
      const fundOpex = Math.max(0, ((cf.operatingExpense || 0) - (cf.renovationCost || 0)) / 3);
      const mgmtFee = (cf.mgmtFee || 0) / 3;
      const rentIn = cf.netRent / 3;
      const hoaOut = -(cf.hoaExpense / 3);
      const insuranceOut = -((cf.insuranceExpense || 0) / 3);
      const taxOut = -((cf.taxExpense || 0) / 3);
      const fundOpexOut = -fundOpex;
      const renovationsOut = -reno;
      const mgmtFeeOut = -mgmtFee;
      const debtCostOut = -((cf.interestExpense || 0) / 3);
      const mmIncomeIn = (cf.mmIncome || 0) / 3;
      const operatingCashFlow = rentIn + hoaOut + insuranceOut + taxOut + fundOpexOut + renovationsOut + mgmtFeeOut + debtCostOut + mmIncomeIn;
      rows.push({
        label,
        noi: cf.netOperatingIncome / 3,
        rentIn,
        hoaOut,
        insuranceOut,
        taxOut,
        fundOpexOut,
        renovationsOut,
        mgmtFeeOut,
        debtCostOut,
        mmIncomeIn,
        capitalCalls: cf.capitalCalls / 3,
        deployments: cf.acquisitionCost / 3,
        renovations: reno,
        fundOpex,
        mgmtFee,
        operatingCashFlow,
        netCashFlow: cf.netCashFlow / 3,
        cumulativeCashFlow: 0,
      });
    }
  }
  let cum = 0;
  for (const row of rows) { cum += row.netCashFlow; row.cumulativeCashFlow = cum; }
  return rows;
}

function toMonthlyWithRenovationTiming(
  cashFlows: QuarterlyCashFlow[],
  renovationEvents: Array<{ paidDate: string; amount: number }>,
  capitalCallEvents: Array<{ paidDate: string; amount: number }>,
  acquisitionEvents: Array<{ paidDate: string; amount: number }>
): ChartRow[] {
  const renoByMonth = new Map<string, number>();
  const callByMonth = new Map<string, number>();
  const deployByMonth = new Map<string, number>();

  for (const ev of renovationEvents) {
    const d = new Date(ev.paidDate);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    renoByMonth.set(key, (renoByMonth.get(key) || 0) + ev.amount);
  }
  for (const ev of capitalCallEvents) {
    const d = new Date(ev.paidDate);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    callByMonth.set(key, (callByMonth.get(key) || 0) + ev.amount);
  }
  for (const ev of acquisitionEvents) {
    const d = new Date(ev.paidDate);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    deployByMonth.set(key, (deployByMonth.get(key) || 0) + ev.amount);
  }

  const hasCallEvents = capitalCallEvents.length > 0;
  const rows: ChartRow[] = [];
  for (const cf of cashFlows) {
    const quarterReno = cf.renovationCost || 0;
    const baseNoiMonthly = (cf.netOperatingIncome + quarterReno) / 3;
    const baseFundOpexMonthly = Math.max(0, ((cf.operatingExpense || 0) - quarterReno) / 3);
    const baseNetWithoutCap = (cf.netCashFlow + cf.capitalCalls + quarterReno) / 3;
    const baseMgmtMonthly = (cf.mgmtFee || 0) / 3;
    const baseDebtCostMonthly = (cf.interestExpense || 0) / 3;
    const baseMmIncomeMonthly = (cf.mmIncome || 0) / 3;
    const baseCallMonthly = cf.capitalCalls / 3;

    for (let m = 0; m < 3; m++) {
      const dateObj = new Date(cf.date);
      const monthDate = new Date(dateObj.getFullYear(), dateObj.getMonth() - 2 + m, 1);
      const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
      const label = `${monthDate.toLocaleString('default', { month: 'short' })} ${monthDate.getFullYear()}`;
      const renoThisMonth = renoByMonth.get(key) || 0;
      const callThisMonth = hasCallEvents ? (callByMonth.get(key) || 0) : baseCallMonthly;
      const deploymentThisMonth = deployByMonth.get(key) || 0;
      const noi = baseNoiMonthly - renoThisMonth;
      const netCashFlow = baseNetWithoutCap - renoThisMonth - callThisMonth;
      const rentIn = cf.netRent / 3;
      const hoaOut = -(cf.hoaExpense / 3);
      const insuranceOut = -((cf.insuranceExpense || 0) / 3);
      const taxOut = -((cf.taxExpense || 0) / 3);
      const fundOpexOut = -baseFundOpexMonthly;
      const renovationsOut = -renoThisMonth;
      const mgmtFeeOut = -baseMgmtMonthly;
      const debtCostOut = -baseDebtCostMonthly;
      const mmIncomeIn = baseMmIncomeMonthly;
      const operatingCashFlow = rentIn + hoaOut + insuranceOut + taxOut + fundOpexOut + renovationsOut + mgmtFeeOut + debtCostOut + mmIncomeIn;
      rows.push({
        label,
        noi,
        rentIn,
        hoaOut,
        insuranceOut,
        taxOut,
        fundOpexOut,
        renovationsOut,
        mgmtFeeOut,
        debtCostOut,
        mmIncomeIn,
        capitalCalls: callThisMonth,
        deployments: deploymentThisMonth,
        renovations: renoThisMonth,
        fundOpex: baseFundOpexMonthly,
        mgmtFee: baseMgmtMonthly,
        operatingCashFlow,
        netCashFlow,
        cumulativeCashFlow: 0,
      });
    }
  }

  let cum = 0;
  for (const row of rows) {
    cum += row.netCashFlow;
    row.cumulativeCashFlow = cum;
  }
  return rows;
}

function toQuarterly(cashFlows: QuarterlyCashFlow[]): ChartRow[] {
  return cashFlows.map((cf) => ({
    label: cf.quarter,
    noi: cf.netOperatingIncome,
    rentIn: cf.netRent,
    hoaOut: -cf.hoaExpense,
    insuranceOut: -(cf.insuranceExpense || 0),
    taxOut: -(cf.taxExpense || 0),
    fundOpexOut: -Math.max(0, (cf.operatingExpense || 0) - (cf.renovationCost || 0)),
    renovationsOut: -(cf.renovationCost || 0),
    mgmtFeeOut: -(cf.mgmtFee || 0),
    debtCostOut: -(cf.interestExpense || 0),
    mmIncomeIn: cf.mmIncome || 0,
    capitalCalls: cf.capitalCalls,
    deployments: cf.acquisitionCost || 0,
    renovations: cf.renovationCost || 0,
    fundOpex: Math.max(0, (cf.operatingExpense || 0) - (cf.renovationCost || 0)),
    mgmtFee: cf.mgmtFee || 0,
    operatingCashFlow:
      cf.netRent
      - cf.hoaExpense
      - (cf.insuranceExpense || 0)
      - (cf.taxExpense || 0)
      - Math.max(0, (cf.operatingExpense || 0) - (cf.renovationCost || 0))
      - (cf.renovationCost || 0)
      - (cf.mgmtFee || 0)
      - (cf.interestExpense || 0)
      + (cf.mmIncome || 0),
    netCashFlow: cf.netCashFlow,
    cumulativeCashFlow: cf.cumulativeCashFlow,
  }));
}

function toYearly(cashFlows: QuarterlyCashFlow[]): ChartRow[] {
  const yearMap = new Map<string, ChartRow>();
  for (const cf of cashFlows) {
    const year = cf.date.slice(0, 4);
    if (!yearMap.has(year)) yearMap.set(year, {
      label: year,
      noi: 0,
      rentIn: 0,
      hoaOut: 0,
      insuranceOut: 0,
      taxOut: 0,
      fundOpexOut: 0,
      renovationsOut: 0,
      mgmtFeeOut: 0,
      debtCostOut: 0,
      mmIncomeIn: 0,
      capitalCalls: 0,
      deployments: 0,
      renovations: 0,
      fundOpex: 0,
      mgmtFee: 0,
      operatingCashFlow: 0,
      netCashFlow: 0,
      cumulativeCashFlow: 0,
    });
    const row = yearMap.get(year)!;
    row.noi += cf.netOperatingIncome;
    row.rentIn += cf.netRent;
    row.hoaOut += -cf.hoaExpense;
    row.insuranceOut += -(cf.insuranceExpense || 0);
    row.taxOut += -(cf.taxExpense || 0);
    row.fundOpexOut += -Math.max(0, (cf.operatingExpense || 0) - (cf.renovationCost || 0));
    row.renovationsOut += -(cf.renovationCost || 0);
    row.mgmtFeeOut += -(cf.mgmtFee || 0);
    row.debtCostOut += -(cf.interestExpense || 0);
    row.mmIncomeIn += (cf.mmIncome || 0);
    row.capitalCalls += cf.capitalCalls;
    row.deployments += cf.acquisitionCost || 0;
    row.renovations += cf.renovationCost || 0;
    row.fundOpex += Math.max(0, (cf.operatingExpense || 0) - (cf.renovationCost || 0));
    row.mgmtFee += cf.mgmtFee || 0;
    row.operatingCashFlow += cf.netOperatingIncome - (cf.mgmtFee || 0);
    row.netCashFlow += cf.netCashFlow;
  }
  const rows = Array.from(yearMap.values());
  let cum = 0;
  for (const row of rows) { cum += row.netCashFlow; row.cumulativeCashFlow = cum; }
  return rows;
}

/* ── Period-aware Table Rows ──────────────────────────────── */

interface TableRow {
  label: string;
  date: string;
  capitalCalls: number;
  deployments: number;
  grossRent: number;
  hoaExpense: number;
  insuranceExpense: number;
  taxExpense: number;
  fundOpex: number;
  renovationCost: number;
  mgmtFee: number;
  netRent: number;
  noi: number;
  debtBalance: number;
  mmBalance: number;
  netCashFlow: number;
  cumulativeCashFlow: number;
}

function toTableMonthly(cashFlows: QuarterlyCashFlow[]): TableRow[] {
  const rows: TableRow[] = [];
  for (const cf of cashFlows) {
    for (let m = 0; m < 3; m++) {
      const dateObj = new Date(cf.date);
      const monthDate = new Date(dateObj.getFullYear(), dateObj.getMonth() - 2 + m, 1);
      const label = `${monthDate.toLocaleString('default', { month: 'short' })} ${monthDate.getFullYear()}`;
      const dateStr = monthDate.toISOString().slice(0, 10);
      rows.push({
        label,
        date: dateStr,
        capitalCalls: cf.capitalCalls / 3,
        deployments: cf.acquisitionCost / 3,
        grossRent: cf.grossRent / 3,
        hoaExpense: cf.hoaExpense / 3,
        insuranceExpense: (cf.insuranceExpense || 0) / 3,
        taxExpense: (cf.taxExpense || 0) / 3,
        fundOpex: Math.max(0, ((cf.operatingExpense || 0) - (cf.renovationCost || 0)) / 3),
        renovationCost: (cf.renovationCost || 0) / 3,
        mgmtFee: (cf.mgmtFee || 0) / 3,
        netRent: cf.netRent / 3,
        noi: cf.netOperatingIncome / 3,
        // Balances are point-in-time — show same balance for all 3 months in the quarter
        debtBalance: cf.debtBalance,
        mmBalance: cf.mmBalance,
        netCashFlow: cf.netCashFlow / 3,
        cumulativeCashFlow: 0,
      });
    }
  }
  let cum = 0;
  for (const row of rows) { cum += row.netCashFlow; row.cumulativeCashFlow = cum; }
  return rows;
}

function toTableMonthlyWithRenovationTiming(
  cashFlows: QuarterlyCashFlow[],
  renovationEvents: Array<{ paidDate: string; amount: number }>,
  capitalCallEvents: Array<{ paidDate: string; amount: number }>,
  acquisitionEvents: Array<{ paidDate: string; amount: number }>
): TableRow[] {
  const renoByMonth = new Map<string, number>();
  const callByMonth = new Map<string, number>();
  const deployByMonth = new Map<string, number>();
  for (const ev of renovationEvents) {
    const d = new Date(ev.paidDate);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    renoByMonth.set(key, (renoByMonth.get(key) || 0) + ev.amount);
  }
  for (const ev of capitalCallEvents) {
    const d = new Date(ev.paidDate);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    callByMonth.set(key, (callByMonth.get(key) || 0) + ev.amount);
  }
  for (const ev of acquisitionEvents) {
    const d = new Date(ev.paidDate);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    deployByMonth.set(key, (deployByMonth.get(key) || 0) + ev.amount);
  }
  const hasCallEvents = capitalCallEvents.length > 0;

  const rows: TableRow[] = [];
  for (const cf of cashFlows) {
    const quarterReno = cf.renovationCost || 0;
    const baseInsuranceMonthly = (cf.insuranceExpense || 0) / 3;
    const baseTaxMonthly = (cf.taxExpense || 0) / 3;
    const baseFundOpexMonthly = Math.max(0, ((cf.operatingExpense || 0) - quarterReno) / 3);
    const baseNetWithoutCap = (cf.netCashFlow + cf.capitalCalls + quarterReno) / 3;
    const baseMgmtMonthly = (cf.mgmtFee || 0) / 3;
    const baseCallMonthly = cf.capitalCalls / 3;

    for (let m = 0; m < 3; m++) {
      const dateObj = new Date(cf.date);
      const monthDate = new Date(dateObj.getFullYear(), dateObj.getMonth() - 2 + m, 1);
      const dateStr = monthDate.toISOString().slice(0, 10);
      const key = dateStr.slice(0, 7);
      const renoThisMonth = renoByMonth.get(key) || 0;
      const callThisMonth = hasCallEvents ? (callByMonth.get(key) || 0) : baseCallMonthly;
      const deploymentThisMonth = deployByMonth.get(key) || 0;
      const noi = (cf.netRent / 3)
        - (cf.hoaExpense / 3)
        - baseInsuranceMonthly
        - baseTaxMonthly
        - baseFundOpexMonthly
        - renoThisMonth;
      rows.push({
        label: `${monthDate.toLocaleString('default', { month: 'short' })} ${monthDate.getFullYear()}`,
        date: dateStr,
        capitalCalls: callThisMonth,
        deployments: deploymentThisMonth,
        grossRent: cf.grossRent / 3,
        hoaExpense: cf.hoaExpense / 3,
        insuranceExpense: baseInsuranceMonthly,
        taxExpense: baseTaxMonthly,
        fundOpex: baseFundOpexMonthly,
        renovationCost: renoThisMonth,
        mgmtFee: baseMgmtMonthly,
        netRent: cf.netRent / 3,
        noi,
        debtBalance: cf.debtBalance,
        mmBalance: cf.mmBalance,
        netCashFlow: baseNetWithoutCap - renoThisMonth - callThisMonth,
        cumulativeCashFlow: 0,
      });
    }
  }
  let cum = 0;
  for (const row of rows) { cum += row.netCashFlow; row.cumulativeCashFlow = cum; }
  return rows;
}

function toTableQuarterly(cashFlows: QuarterlyCashFlow[]): TableRow[] {
  return cashFlows.map((cf) => ({
    label: cf.quarter,
    date: cf.date,
    capitalCalls: cf.capitalCalls,
    deployments: cf.acquisitionCost || 0,
    grossRent: cf.grossRent,
    hoaExpense: cf.hoaExpense,
    insuranceExpense: cf.insuranceExpense || 0,
    taxExpense: cf.taxExpense || 0,
    fundOpex: Math.max(0, (cf.operatingExpense || 0) - (cf.renovationCost || 0)),
    renovationCost: cf.renovationCost || 0,
    mgmtFee: cf.mgmtFee || 0,
    netRent: cf.netRent,
    noi: cf.netOperatingIncome,
    debtBalance: cf.debtBalance,
    mmBalance: cf.mmBalance,
    netCashFlow: cf.netCashFlow,
    cumulativeCashFlow: cf.cumulativeCashFlow,
  }));
}

function toTableYearly(cashFlows: QuarterlyCashFlow[]): TableRow[] {
  const yearMap = new Map<string, TableRow>();
  for (const cf of cashFlows) {
    const year = cf.date.slice(0, 4);
    if (!yearMap.has(year)) {
      yearMap.set(year, {
        label: year, date: `${year}-12-31`,
        capitalCalls: 0, deployments: 0, grossRent: 0, hoaExpense: 0, insuranceExpense: 0, taxExpense: 0, fundOpex: 0, renovationCost: 0, mgmtFee: 0, netRent: 0, noi: 0,
        debtBalance: 0, mmBalance: 0, netCashFlow: 0, cumulativeCashFlow: 0,
      });
    }
    const row = yearMap.get(year)!;
    row.capitalCalls += cf.capitalCalls;
    row.deployments += cf.acquisitionCost || 0;
    row.grossRent += cf.grossRent;
    row.hoaExpense += cf.hoaExpense;
    row.insuranceExpense += cf.insuranceExpense || 0;
    row.taxExpense += cf.taxExpense || 0;
    row.fundOpex += Math.max(0, (cf.operatingExpense || 0) - (cf.renovationCost || 0));
    row.renovationCost += cf.renovationCost || 0;
    row.mgmtFee += cf.mgmtFee || 0;
    row.netRent += cf.netRent;
    row.noi += cf.netOperatingIncome;
    // Use last quarter's balances for year-end
    row.debtBalance = cf.debtBalance;
    row.mmBalance = cf.mmBalance;
    row.netCashFlow += cf.netCashFlow;
  }
  const rows = Array.from(yearMap.values());
  let cum = 0;
  for (const row of rows) { cum += row.netCashFlow; row.cumulativeCashFlow = cum; }
  return rows;
}

/* ── Assumptions Editor Field Config ────────────────────────── */

interface FieldDef {
  key: keyof FundAssumptions;
  label: string;
  type: 'dollar' | 'pct' | 'int' | 'bool' | 'select';
  options?: { value: string; label: string }[];
}

const fieldGroups: { title: string; fields: FieldDef[] }[] = [
  {
    title: 'Fund Structure',
    fields: [
      { key: 'fundSize', label: 'Fund Size', type: 'dollar' },
      { key: 'fundTermYears', label: 'Fund Term (Years)', type: 'int' },
      { key: 'investmentPeriodYears', label: 'Investment Period (Years)', type: 'int' },
      { key: 'gpCoinvestPct', label: 'GP Co-Invest %', type: 'pct' },
    ],
  },
  {
    title: 'Management Fees',
    fields: [
      { key: 'mgmtFeeInvestPct', label: 'Fee (Investment Period)', type: 'pct' },
      { key: 'mgmtFeePostPct', label: 'Fee (Post-Deploy)', type: 'pct' },
      { key: 'mgmtFeeWaiver', label: 'Fee Waiver / Offset', type: 'bool' },
    ],
  },
  {
    title: 'Waterfall',
    fields: [
      { key: 'prefReturnPct', label: 'Preferred Return', type: 'pct' },
      { key: 'catchupPct', label: 'GP Catch-Up %', type: 'pct' },
      { key: 'tier1SplitLP', label: 'Tier 1 LP Split', type: 'pct' },
      { key: 'tier1SplitGP', label: 'Tier 1 GP Split', type: 'pct' },
      { key: 'tier2HurdleIRR', label: 'Tier 2 Hurdle IRR', type: 'pct' },
      { key: 'tier2SplitLP', label: 'Tier 2 LP Split', type: 'pct' },
      { key: 'tier2SplitGP', label: 'Tier 2 GP Split', type: 'pct' },
      { key: 'tier3HurdleIRR', label: 'Tier 3 Hurdle IRR', type: 'pct' },
      { key: 'tier3SplitLP', label: 'Tier 3 LP Split', type: 'pct' },
      { key: 'tier3SplitGP', label: 'Tier 3 GP Split', type: 'pct' },
    ],
  },
  {
    title: 'Leverage / Refinance',
    fields: [
      { key: 'refiEnabled', label: 'Refi Enabled', type: 'bool' },
      { key: 'refiYear', label: 'Refi Year', type: 'int' },
      { key: 'refiLTV', label: 'Refi LTV', type: 'pct' },
      { key: 'refiRate', label: 'Refi Rate', type: 'pct' },
      { key: 'refiTermYears', label: 'Refi Term (Years)', type: 'int' },
      { key: 'refiCostPct', label: 'Refi Cost %', type: 'pct' },
    ],
  },
  {
    title: 'Growth Assumptions',
    fields: [
      { key: 'rentGrowthPct', label: 'Rent Growth (Annual)', type: 'pct' },
      { key: 'hoaGrowthPct', label: 'HOA Growth (Annual)', type: 'pct' },
      { key: 'vacancyPct', label: 'Vacancy Rate', type: 'pct' },
    ],
  },
  {
    title: 'Fund Operating Overhead',
    fields: [
      { key: 'annualFundOpexMode', label: 'Fund Opex Mode', type: 'select', options: [
        { value: 'fixed', label: 'Fixed Annual Amount' },
        { value: 'threshold_pct', label: 'Adjust % Above Ownership Threshold' },
      ]},
      { key: 'annualFundOpexFixed', label: 'Annual Fund Opex (Base $)', type: 'dollar' },
      { key: 'annualFundOpexThresholdPct', label: 'Ownership Threshold', type: 'pct' },
      { key: 'annualFundOpexAdjustPct', label: 'Adjustment Multiplier', type: 'pct' },
    ],
  },
  {
    title: 'Exit Valuation',
    fields: [
      { key: 'presentDayLandValue', label: 'Present Day Land Value', type: 'dollar' },
      { key: 'landValueTotal', label: 'Land Value (at Exit)', type: 'dollar' },
    ],
  },
  {
    title: 'Cash Management',
    fields: [
      { key: 'mmRate', label: 'Money Market Rate', type: 'pct' },
      { key: 'excessCashMode', label: 'Excess Cash Mode', type: 'select', options: [
        { value: 'reinvest', label: 'Reinvest' },
        { value: 'mm_sweep', label: 'MM Sweep' },
        { value: 'distribute', label: 'Distribute' },
      ]},
    ],
  },
  {
    title: 'Bonus Triggers',
    fields: [
      { key: 'bonusIRRThreshold', label: 'IRR Threshold', type: 'pct' },
      { key: 'bonusMaxYears', label: 'Max Years', type: 'int' },
      { key: 'bonusYieldThreshold', label: 'Yield Threshold', type: 'pct' },
    ],
  },
];

/* ── Inline form input ──────────────────────────────────────── */

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.4rem 0.6rem',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text-primary)',
  fontSize: '0.8rem',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.7rem',
  color: 'var(--text-muted)',
  marginBottom: '0.2rem',
  fontWeight: 500,
  letterSpacing: '0.02em',
};

function FieldInput({ field, value, form, onChange }: {
  field: FieldDef;
  value: any;
  form: FundAssumptions;
  onChange: (key: keyof FundAssumptions, val: any) => void;
}) {
  if (field.type === 'bool') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', height: '100%', paddingTop: '1.1rem' }}>
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(field.key, e.target.checked)}
          style={{ accentColor: 'var(--teal)', width: 16, height: 16 }}
        />
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{field.label}</span>
      </div>
    );
  }
  if (field.type === 'select') {
    return (
      <div>
        <label style={labelStyle}>{field.label}</label>
        <select
          value={value ?? ''}
          onChange={(e) => onChange(field.key, e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer' }}
        >
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    );
  }

  const displayValue = field.type === 'pct'
    ? ((value ?? 0) * 100).toFixed(2)
    : field.type === 'dollar'
      ? Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
      : (value ?? 0).toString();

  const handleChange = (raw: string) => {
    const cleaned = raw.replace(/,/g, '');
    if (cleaned.trim() === '') {
      onChange(field.key, 0);
      return;
    }
    const num = parseFloat(cleaned);
    if (isNaN(num)) return;
    if (field.type === 'pct') onChange(field.key, num / 100);
    else if (field.type === 'int') onChange(field.key, Math.round(num));
    else onChange(field.key, num);
  };

  const isMMDisabled = field.key === 'mmRate' && form.excessCashMode === 'distribute';
  const isOpexThresholdField = field.key === 'annualFundOpexThresholdPct' || field.key === 'annualFundOpexAdjustPct';
  const isOpexThresholdDisabled = isOpexThresholdField && form.annualFundOpexMode !== 'threshold_pct';
  const isDisabled = isMMDisabled || isOpexThresholdDisabled;

  return (
    <div>
      <label style={labelStyle}>
        {field.label}
        {field.type === 'pct' && <span style={{ opacity: 0.5 }}> (%)</span>}
        {field.type === 'dollar' && <span style={{ opacity: 0.5 }}> ($)</span>}
      </label>
      <input
        type={field.type === 'dollar' ? 'text' : 'number'}
        value={displayValue}
        onChange={(e) => handleChange(e.target.value)}
        step={field.type === 'pct' ? 0.01 : field.type === 'int' ? 1 : 1000}
        disabled={isDisabled}
        style={{
          ...inputStyle,
          ...(isDisabled ? { opacity: 0.55, background: 'var(--bg-tertiary)', cursor: 'not-allowed' } : {}),
        }}
      />
      {isMMDisabled && (
        <div style={{ marginTop: '0.2rem', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
          Disabled while excess cash mode is set to Distribute.
        </div>
      )}
      {isOpexThresholdDisabled && (
        <div style={{ marginTop: '0.2rem', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
          Enabled only when Fund Opex Mode is set to threshold adjustment.
        </div>
      )}
    </div>
  );
}

/* ── Component ──────────────────────────────────────────────── */

export default function Model() {
  const queryClient = useQueryClient();
  const [activeScenario, setActiveScenario] = useState<number | null>(null);
  const [period, setPeriod] = useState<Period>('Quarterly');
  const [zoomStartPct, setZoomStartPct] = useState(0);
  const [zoomEndPct, setZoomEndPct] = useState(100);
  const [cashViewMode, setCashViewMode] = useState<'overall' | 'operating'>('overall');
  const [includeCapitalCalls, setIncludeCapitalCalls] = useState(true);
  const [includeDeployments, setIncludeDeployments] = useState(true);
  const [includeRenovations, setIncludeRenovations] = useState(true);
  const [includeFundOpex, setIncludeFundOpex] = useState(true);
  const [includeMgmtFees, setIncludeMgmtFees] = useState(true);
  const [showCumulative, setShowCumulative] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editForm, setEditForm] = useState<FundAssumptions>({ ...DEFAULT_ASSUMPTIONS });
  const [scenarioName, setScenarioName] = useState('');

  /* Fetch scenarios */
  const { data: scenarios = [] } = useQuery<FundAssumptions[]>({
    queryKey: ['scenarios'],
    queryFn: () => api.get('/model/scenarios').then((r) => r.data),
  });

  /* Run model mutation */
  const runModel = useMutation({
    mutationFn: (scenarioId: number) =>
      api.post('/model/run', { scenarioId }).then((r) => r.data as ModelRunResult),
  });

  const { data: actualTxns = [] } = useQuery<ActualTxn[]>({
    queryKey: ['actuals-transactions-model'],
    queryFn: () => api.get('/actuals/transactions', { params: { limit: 5000 } }).then((r) => r.data),
  });

  /* Save scenario mutation */
  const saveScenario = useMutation({
    mutationFn: (data: { id?: number; assumptions: FundAssumptions }) => {
      if (data.id) {
        return api.put(`/model/scenarios/${data.id}`, data.assumptions);
      }
      return api.post('/model/scenarios', data.assumptions).then((r) => r.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
    },
  });

  /* Delete scenario mutation */
  const deleteScenario = useMutation({
    mutationFn: (id: number) => api.delete(`/model/scenarios/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenarios'] });
      setActiveScenario(null);
    },
  });

  const result = runModel.data as ModelRunResult | undefined;

  const handleRun = useCallback(
    (id: number) => {
      setActiveScenario(id);
      runModel.mutate(id);
    },
    [runModel],
  );

  // When scenario is selected, load its assumptions into editor
  useEffect(() => {
    if (activeScenario && scenarios.length > 0) {
      const s = scenarios.find((x) => x.id === activeScenario);
      if (s) {
        setEditForm({ ...s });
        setScenarioName(s.name);
      }
    }
  }, [activeScenario, scenarios]);

  // When result comes back with assumptions, update editor
  useEffect(() => {
    if (result?.assumptions) {
      setEditForm({ ...result.assumptions } as FundAssumptions);
      setScenarioName(result.assumptions.name || 'Base Case');
    }
  }, [result?.assumptions]);

  const handleFieldChange = (key: keyof FundAssumptions, val: any) => {
    setEditForm((prev) => ({ ...prev, [key]: val }));
  };

  const handleSaveAndRerun = async () => {
    const a = { ...editForm, name: scenarioName || editForm.name };
    const id = activeScenario || editForm.id;
    if (id) {
      await saveScenario.mutateAsync({ id, assumptions: a });
      handleRun(id);
    }
  };

  const handleSaveAsNew = async () => {
    const name = scenarioName || `Scenario ${scenarios.length + 1}`;
    const a = { ...editForm, name, isActive: false };
    const res = await saveScenario.mutateAsync({ assumptions: a });
    const newId = (res as any)?.id;
    if (newId) {
      handleRun(newId);
    }
    queryClient.invalidateQueries({ queryKey: ['scenarios'] });
  };

  /* Destructure */
  const returns = result?.returns;
  const gpEcon = result?.gpEconomics;
  const waterfall = result?.waterfall;
  const cashFlows = result?.cashFlows;
  const dataSource = result?.dataSource;
  const renovationEvents = result?.renovationEvents ?? [];
  const acquisitionEvents = result?.acquisitionEvents ?? [];
  const capitalCallEvents = result?.capitalCallEvents ?? [];
  const liquidityLedger = result?.liquidityLedger ?? [];
  const mmIncomeTotal = useMemo(
    () => (cashFlows ?? []).reduce((sum, cf) => sum + (cf.mmIncome || 0), 0),
    [cashFlows],
  );

  const baseChartData = useMemo(() => {
    if (!cashFlows || cashFlows.length === 0) return [];
    const renoEvents = renovationEvents;
    switch (period) {
      case 'Monthly': return toMonthlyWithRenovationTiming(cashFlows, renoEvents, capitalCallEvents, acquisitionEvents);
      case 'Quarterly': return toQuarterly(cashFlows);
      case 'Yearly': return toYearly(cashFlows);
    }
  }, [cashFlows, period, renovationEvents, capitalCallEvents, acquisitionEvents]);

  const chartData = useMemo(() => {
    let cumulative = 0;
    return baseChartData.map((row) => {
      const renoAdj = includeRenovations ? row.renovations : 0;
      const capCallAdj = includeCapitalCalls ? row.capitalCalls : 0;
      const fundOpexAdj = includeFundOpex ? row.fundOpex : 0;
      const feeAdj = includeMgmtFees ? row.mgmtFee : 0;
      const operatingCF = row.rentIn
        + row.hoaOut
        + row.insuranceOut
        + row.taxOut
        + (includeFundOpex ? row.fundOpexOut : 0)
        + (includeRenovations ? row.renovationsOut : 0)
        + (includeMgmtFees ? row.mgmtFeeOut : 0)
        + row.debtCostOut
        + row.mmIncomeIn;
      const netCashFlow = cashViewMode === 'operating' ? operatingCF : operatingCF - capCallAdj;
      cumulative += netCashFlow;
      return {
        ...row,
        operatingCashFlow: operatingCF,
        netCashFlow,
        cumulativeCashFlow: cumulative,
      };
    });
  }, [baseChartData, includeRenovations, includeCapitalCalls, includeFundOpex, includeMgmtFees, cashViewMode]);

  const zoomedChartData = useMemo(() => {
    if (!chartData || chartData.length === 0) return [];
    if (chartData.length === 1) return chartData;

    const maxIdx = chartData.length - 1;
    const startIdx = Math.max(0, Math.min(maxIdx, Math.floor((zoomStartPct / 100) * maxIdx)));
    const endIdx = Math.max(startIdx, Math.min(maxIdx, Math.ceil((zoomEndPct / 100) * maxIdx)));
    return chartData.slice(startIdx, endIdx + 1);
  }, [chartData, zoomStartPct, zoomEndPct]);

  const tableData = useMemo(() => {
    if (!cashFlows || cashFlows.length === 0) return [];
    switch (period) {
      case 'Monthly': return toTableMonthlyWithRenovationTiming(cashFlows, renovationEvents, capitalCallEvents, acquisitionEvents);
      case 'Quarterly': return toTableQuarterly(cashFlows);
      case 'Yearly': return toTableYearly(cashFlows);
    }
  }, [cashFlows, period, renovationEvents, capitalCallEvents, acquisitionEvents]);

  const waterfallData = useMemo(() => {
    if (!waterfall) return [];
    return waterfall.tiers
      .filter((t) => t.lpAmount > 0 || t.gpAmount > 0)
      .map((t) => ({ name: t.name, LP: t.lpAmount, GP: t.gpAmount }));
  }, [waterfall]);

  const trendData = useMemo(() => {
    if (!zoomedChartData || zoomedChartData.length === 0) return [];
    const bucketMap = new Map<string, number>();

    const operatingCats = new Set(['rent', 'hoa', 'insurance', 'tax', 'repair', 'management_fee', 'fund_expense']);
    for (const t of actualTxns) {
      const d = new Date(t.date);
      if (Number.isNaN(d.getTime())) continue;
      let label: string;
      if (period === 'Monthly') {
        label = `${d.toLocaleString('default', { month: 'short' })} ${d.getFullYear()}`;
      } else if (period === 'Quarterly') {
        const q = Math.floor(d.getMonth() / 3) + 1;
        label = `Q${q} ${d.getFullYear()}`;
      } else {
        label = `${d.getFullYear()}`;
      }
      const include = cashViewMode === 'overall' ? true : operatingCats.has(t.category);
      if (!include) continue;
      bucketMap.set(label, (bucketMap.get(label) || 0) + t.amount);
    }

    return zoomedChartData.map((r) => {
      const actual = bucketMap.get(r.label) || 0;
      const projected = r.netCashFlow;
      return {
        label: r.label,
        projected,
        actual,
        variance: actual - projected,
      };
    });
  }, [zoomedChartData, actualTxns, period, cashViewMode]);

  return (
    <div>
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="page-header">
        <h2>Financial Model</h2>
        <p>Run projections and analyze fund performance</p>
      </div>

      {/* ── Data Source Indicator ─────────────────────────────── */}
      {dataSource && (
        <div
          className="card mb-4"
          style={{
            padding: '0.75rem 1rem',
            background: dataSource.type === 'portfolio'
              ? 'rgba(0, 184, 148, 0.08)'
              : 'rgba(255, 159, 67, 0.08)',
            borderColor: dataSource.type === 'portfolio' ? 'var(--teal)' : 'var(--gold)',
          }}
        >
          <span style={{
            fontSize: '0.8rem',
            color: dataSource.type === 'portfolio' ? 'var(--teal)' : 'var(--gold)',
            fontWeight: 600,
          }}>
            {dataSource.type === 'portfolio'
              ? `Model based on ${num(dataSource.unitCount)} owned unit${dataSource.unitCount !== 1 ? 's' : ''} (avg rent $${num(dataSource.avgRent)}/mo, avg HOA $${num(dataSource.avgHOA)}/mo)`
              : 'Using default assumptions (no units in portfolio yet)'}
          </span>
        </div>
      )}

      {/* ── Scenario Selection ──────────────────────────────── */}
      <div className="card mb-4">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="card-title">Scenarios</span>
          <button
            className={`btn ${editorOpen ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setEditorOpen(!editorOpen)}
            style={{ fontSize: '0.8rem' }}
          >
            {editorOpen ? 'Hide Editor' : 'Edit Assumptions'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {scenarios.map((s) => (
            <button
              key={s.id}
              className={`btn ${activeScenario === s.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => handleRun(s.id!)}
              disabled={runModel.isPending}
            >
              {s.name} {s.isActive ? '(Active)' : ''}
            </button>
          ))}
          {scenarios.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>
              No scenarios saved. The default assumptions will be used.
            </p>
          )}
          <button
            className="btn btn-primary"
            onClick={() => handleRun(scenarios[0]?.id || 0)}
            disabled={runModel.isPending}
          >
            {runModel.isPending ? 'Running...' : 'Run Model'}
          </button>
        </div>
      </div>

      {/* ── Assumptions Editor (collapsible) ─────────────────── */}
      {editorOpen && (
        <div className="card mb-4">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span className="card-title">Assumptions Editor</span>
              <input
                type="text"
                value={scenarioName}
                onChange={(e) => setScenarioName(e.target.value)}
                placeholder="Scenario name"
                style={{ ...inputStyle, width: 200 }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary"
                onClick={handleSaveAndRerun}
                disabled={saveScenario.isPending || !activeScenario}
                style={{ fontSize: '0.8rem' }}
              >
                {saveScenario.isPending ? 'Saving...' : 'Save & Rerun'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleSaveAsNew}
                disabled={saveScenario.isPending}
                style={{ fontSize: '0.8rem' }}
              >
                Save as New Scenario
              </button>
              {activeScenario && (
                <button
                  className="btn"
                  onClick={() => {
                    if (confirm('Delete this scenario?')) {
                      deleteScenario.mutate(activeScenario);
                    }
                  }}
                  style={{ fontSize: '0.8rem', color: 'var(--red)', border: '1px solid var(--red)', background: 'none' }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>

          {/* Field groups */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem', marginTop: '0.5rem' }}>
            {fieldGroups.map((group) => (
              <div
                key={group.title}
                style={{
                  padding: '0.75rem',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{
                  fontSize: '0.75rem', fontWeight: 700, color: 'var(--teal)',
                  letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.5rem',
                }}>
                  {group.title}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  {group.fields.map((f) => (
                    <FieldInput key={f.key} field={f} value={editForm[f.key]} form={editForm} onChange={handleFieldChange} />
                  ))}
                </div>
                {group.title === 'Exit Valuation' && (
                  <div style={{ marginTop: '0.55rem', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      Implied Land Value Growth (from present day to exit)
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--accent-light)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                      {editForm.presentDayLandValue > 0 && editForm.fundTermYears > 0
                        ? pct(Math.pow(editForm.landValueTotal / editForm.presentDayLandValue, 1 / editForm.fundTermYears) - 1)
                        : '—'}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Error state ─────────────────────────────────────── */}
      {runModel.isError && (
        <div className="card mb-4" style={{ borderColor: 'var(--red)', background: 'var(--red-dim)', padding: '1rem' }}>
          <span style={{ color: 'var(--red)', fontWeight: 600 }}>Error: </span>
          <span style={{ color: 'var(--text-secondary)' }}>
            {(runModel.error as Error)?.message ?? 'Failed to run model'}
          </span>
        </div>
      )}

      {result && returns && gpEcon && waterfall && cashFlows && (
        <>
          {/* ── KPI Metrics ───────────────────────────────────── */}
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-label">Fund IRR</div>
              <div className="metric-value teal">{pct(returns.fundIRR)}</div>
              <div className="metric-note">Net of fees</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Fund MOIC</div>
              <div className="metric-value teal">{returns.fundMOIC.toFixed(2)}x</div>
              <div className="metric-note">Multiple on invested capital</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Total Distributions</div>
              <div className="metric-value accent">{fmt(returns.totalDistributions)}</div>
              <div className="metric-note">Exit proceeds + NOI</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Net Profit</div>
              <div className="metric-value green">{fmt(returns.netProfit)}</div>
              <div className="metric-note">After return of capital</div>
            </div>
            <div className="metric-card" style={result?.assumptions.excessCashMode === 'distribute' ? { opacity: 0.55 } : undefined}>
              <div className="metric-label">MM Fund Return</div>
              <div className="metric-value">{fmt(mmIncomeTotal)}</div>
              <div className="metric-note">
                {result?.assumptions.excessCashMode === 'distribute'
                  ? 'Disabled (excess cash distributed)'
                  : 'Total money market income'}
              </div>
            </div>
          </div>

          {liquidityLedger.length > 0 && (
            <div className="card mb-4">
              <div className="card-header">
                <span className="card-title">Capital Liquidity Ledger</span>
                <span className="badge badge-blue">Capital called -&gt; MM -&gt; deployments</span>
              </div>
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <LineChart data={liquidityLedger} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval={11} angle={-30} textAnchor="end" height={50} />
                    <YAxis tickFormatter={(v: number) => fmtCompact(v, '')} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <Tooltip formatter={(v: number, name: string) => [fmt(v), name]} contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
                    <Line type="monotone" dataKey="capitalCalled" name="Capital Called" stroke="var(--accent-light)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="deployed" name="Deployed (Units + Expenses)" stroke="var(--red)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="mmBalanceEnd" name="MM Ending Balance" stroke="var(--teal)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── GP Economics ───────────────────────────────────── */}
          <div className="card mb-4">
            <div className="card-header"><span className="card-title">GP Economics</span></div>
            <div className="metrics-grid" style={{ marginBottom: 0 }}>
              <div className="metric-card">
                <div className="metric-label">Management Fees</div>
                <div className="metric-value">{fmt(gpEcon.mgmtFeesTotal)}</div>
                <div className="metric-note">{num(gpEcon.mgmtFeesByYear.length)}yr fee stream</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Carried Interest</div>
                <div className="metric-value gold">{fmt(gpEcon.carryTotal)}</div>
                <div className="metric-note">
                  Catch-up {fmt(gpEcon.carryCatchup)} + Tiers {fmt(gpEcon.carryTier1 + gpEcon.carryTier2 + gpEcon.carryTier3)}
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Co-Invest Return</div>
                <div className="metric-value">{fmt(gpEcon.coinvestReturn)}</div>
                <div className="metric-note">On {fmt(gpEcon.coinvestCapital)} invested</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Total GP Comp</div>
                <div className="metric-value gold">{fmt(gpEcon.totalGPComp)}</div>
                <div className="metric-note">GP MOIC {gpEcon.gpMOIC.toFixed(1)}x</div>
              </div>
            </div>
            <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Bonus Triggers:</span>
              <span style={{ color: gpEcon.bonusTriggers.irrMet ? 'var(--green)' : 'var(--red)' }}>
                IRR {gpEcon.bonusTriggers.irrMet ? 'Met' : 'Not Met'} ({pct(gpEcon.bonusTriggers.actualIRR)})
              </span>
              <span style={{ color: gpEcon.bonusTriggers.holdMet ? 'var(--green)' : 'var(--red)' }}>
                Hold {gpEcon.bonusTriggers.holdMet ? 'Met' : 'Not Met'} ({gpEcon.bonusTriggers.actualHoldYears}yr)
              </span>
              <span style={{ color: gpEcon.bonusTriggers.yieldMet ? 'var(--green)' : 'var(--red)' }}>
                Yield {gpEcon.bonusTriggers.yieldMet ? 'Met' : 'Not Met'} ({pct(gpEcon.bonusTriggers.actualYield)})
              </span>
            </div>
          </div>

          {/* ── Waterfall Chart ────────────────────────────────── */}
          <div className="card mb-4">
            <div className="card-header">
              <span className="card-title">Waterfall Distribution</span>
              <span className="badge badge-blue">LP {pct(waterfall.lpPct)} / GP {pct(waterfall.gpPct)}</span>
            </div>
            <div style={{ padding: '0 1rem 0.75rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span className="badge badge-green">LP Total {fmt(waterfall.totalLP)}</span>
              <span className="badge badge-gold">GP Total {fmt(waterfall.totalGP)}</span>
              <span className="badge badge-gray">Distributed {fmt(waterfall.totalDistributed)}</span>
              <span className="badge badge-gray">{num(waterfallData.length)} active tiers</span>
            </div>
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={waterfallData} layout="vertical" margin={{ left: 20, right: 20, top: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v: number) => fmtCompact(v)} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} />
                  <Tooltip formatter={(v: number, name: string) => [fmt(v), name]} contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
                  <Bar dataKey="LP" name="LP" stackId="stack" fill="var(--teal)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="GP" name="GP" stackId="stack" fill="var(--gold)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Waterfall Schedule Table ───────────────────────── */}
          <div className="card mb-4">
            <div className="card-header">
              <span className="card-title">Waterfall Schedule</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tier</th>
                    <th style={{ textAlign: 'right' }}>LP Amount</th>
                    <th style={{ textAlign: 'right' }}>GP Amount</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>LP % Tier</th>
                    <th style={{ textAlign: 'right' }}>GP % Tier</th>
                    <th style={{ textAlign: 'right' }}>LP Running Total</th>
                    <th style={{ textAlign: 'right' }}>GP Running Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    let lpRunning = 0;
                    let gpRunning = 0;
                    return waterfall.tiers.map((tier, i) => {
                      lpRunning += tier.lpAmount;
                      gpRunning += tier.gpAmount;
                      return (
                        <tr key={i}>
                          <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{tier.name}</td>
                          <td style={{ textAlign: 'right', color: 'var(--teal)' }}>{fmt(tier.lpAmount)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--gold)' }}>{fmt(tier.gpAmount)}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(tier.totalAmount)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{tier.totalAmount > 0 ? pct(tier.lpAmount / tier.totalAmount) : '—'}</td>
                          <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{tier.totalAmount > 0 ? pct(tier.gpAmount / tier.totalAmount) : '—'}</td>
                          <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmt(lpRunning)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmt(gpRunning)}</td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                    <td>Total</td>
                    <td style={{ textAlign: 'right', color: 'var(--teal)' }}>{fmt(waterfall.totalLP)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--gold)' }}>{fmt(waterfall.totalGP)}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(waterfall.totalDistributed)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{pct(waterfall.lpPct)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{pct(waterfall.gpPct)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* ── Cash Flow Chart ────────────────────────────────── */}
          <div className="card mb-4">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="card-title">Cash Flows</span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <div style={{ display: 'flex', gap: '0.25rem', background: 'var(--bg-tertiary)', borderRadius: 8, padding: '0.25rem' }}>
                  {(['Monthly', 'Quarterly', 'Yearly'] as Period[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPeriod(p)}
                      style={{
                        padding: '0.35rem 0.85rem', borderRadius: 6, border: 'none', cursor: 'pointer',
                        fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.03em',
                        background: period === p ? 'var(--teal)' : 'transparent',
                        color: period === p ? '#fff' : 'var(--text-muted)',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '0.25rem', background: 'var(--bg-tertiary)', borderRadius: 8, padding: '0.25rem' }}>
                  <button className={`btn ${cashViewMode === 'overall' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.25rem 0.65rem', fontSize: '0.72rem' }} onClick={() => setCashViewMode('overall')}>Overall</button>
                  <button className={`btn ${cashViewMode === 'operating' ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '0.25rem 0.65rem', fontSize: '0.72rem' }} onClick={() => setCashViewMode('operating')}>Operating</button>
                </div>
              </div>
            </div>
            <div style={{ padding: '0 1rem 0.75rem', display: 'flex', gap: '0.9rem', flexWrap: 'wrap' }}>
              {cashViewMode === 'overall' && (
                <>
                  <label style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <input type="checkbox" checked={includeCapitalCalls} onChange={(e) => setIncludeCapitalCalls(e.target.checked)} />
                    Capital calls
                  </label>
                  <label style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <input type="checkbox" checked={includeDeployments} onChange={(e) => setIncludeDeployments(e.target.checked)} />
                    Deployments (acquisition)
                  </label>
                </>
              )}
              <label style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <input type="checkbox" checked={includeRenovations} onChange={(e) => setIncludeRenovations(e.target.checked)} />
                Renovations
              </label>
              <label style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <input type="checkbox" checked={includeFundOpex} onChange={(e) => setIncludeFundOpex(e.target.checked)} />
                Fund opex
              </label>
              <label style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <input type="checkbox" checked={includeMgmtFees} onChange={(e) => setIncludeMgmtFees(e.target.checked)} />
                Management fees
              </label>
              <label style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <input type="checkbox" checked={showCumulative} onChange={(e) => setShowCumulative(e.target.checked)} />
                Cumulative line
              </label>
              {cashViewMode === 'operating' && (
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Operating view excludes capital calls and deployments.
                </span>
              )}
            </div>
            <div style={{ padding: '0 1rem 0.75rem', borderTop: '1px solid var(--border)', marginTop: '-0.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Timeline Zoom Window</span>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '0.15rem 0.55rem', fontSize: '0.72rem' }}
                  onClick={() => { setZoomStartPct(0); setZoomEndPct(100); }}
                >
                  Full
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.35rem' }}>
                <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  Start
                  <input
                    type="range"
                    min={0}
                    max={99}
                    value={Math.min(zoomStartPct, zoomEndPct - 1)}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setZoomStartPct(Math.min(next, zoomEndPct - 1));
                    }}
                    style={{ width: '100%' }}
                  />
                </label>
                <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  End
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={Math.max(zoomEndPct, zoomStartPct + 1)}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setZoomEndPct(Math.max(next, zoomStartPct + 1));
                    }}
                    style={{ width: '100%' }}
                  />
                </label>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {zoomedChartData.length > 0
                  ? `Showing ${zoomedChartData[0].label} \u2192 ${zoomedChartData[zoomedChartData.length - 1].label} (${zoomedChartData.length} points)`
                  : 'No points in selected window'}
              </div>
            </div>
            <div style={{ width: '100%', height: 360 }}>
              <ResponsiveContainer>
                <AreaChart data={zoomedChartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradNOI" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--teal)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="var(--teal)" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gradCapCalls" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent-light)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="var(--accent-light)" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gradCumulative" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--green)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--green)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval={period === 'Monthly' ? 11 : period === 'Quarterly' ? 3 : 0} angle={-30} textAnchor="end" height={50} />
                  <YAxis yAxisId="left" tickFormatter={(v: number) => fmtCompact(v, '')} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => fmtCompact(v, '')} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                  <Tooltip formatter={(v: number, name: string) => [fmt(v), name]} contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
                  {cashViewMode === 'overall' && (
                    <>
                      <Area yAxisId="left" type="monotone" dataKey="noi" name="NOI" stroke="var(--teal)" strokeWidth={2} fill="url(#gradNOI)" dot={false} activeDot={{ r: 4, fill: 'var(--teal)', stroke: 'var(--bg-primary)', strokeWidth: 2 }} />
                      {includeCapitalCalls && (
                        <Area yAxisId="left" type="monotone" dataKey="capitalCalls" name="Capital Calls" stroke="var(--accent-light)" strokeWidth={2} fill="url(#gradCapCalls)" dot={false} activeDot={{ r: 4, fill: 'var(--accent-light)', stroke: 'var(--bg-primary)', strokeWidth: 2 }} />
                      )}
                      {includeDeployments && (
                        <Area yAxisId="left" type="monotone" dataKey="deployments" name="Deployments" stroke="var(--red)" strokeWidth={1.8} fillOpacity={0.08} fill="var(--red)" dot={false} />
                      )}
                      {includeRenovations && (
                        <Area yAxisId="left" type="monotone" dataKey="renovations" name="Renovations" stroke="var(--gold)" strokeWidth={1.5} fillOpacity={0.1} fill="var(--gold)" dot={false} />
                      )}
                      {includeFundOpex && (
                        <Area yAxisId="left" type="monotone" dataKey="fundOpex" name="Fund Opex" stroke="#ff9f43" strokeWidth={1.5} fillOpacity={0.1} fill="#ff9f43" dot={false} />
                      )}
                      {includeMgmtFees && (
                        <Area yAxisId="left" type="monotone" dataKey="mgmtFee" name="Mgmt Fees" stroke="#ff7f50" strokeWidth={1.5} fillOpacity={0.08} fill="#ff7f50" dot={false} />
                      )}
                    </>
                  )}
                  {cashViewMode === 'operating' && (
                    <>
                      <Area yAxisId="left" type="monotone" dataKey="rentIn" name="Rent (in)" stroke="var(--green)" strokeWidth={1.8} fillOpacity={0.12} fill="var(--green)" dot={false} />
                      <Area yAxisId="left" type="monotone" dataKey="mmIncomeIn" name="MM Gains (in)" stroke="var(--teal)" strokeWidth={1.5} fillOpacity={0.1} fill="var(--teal)" dot={false} />
                      <Area yAxisId="left" type="monotone" dataKey="hoaOut" name="HOA (out)" stroke="var(--red)" strokeWidth={1.3} fillOpacity={0.08} fill="var(--red)" dot={false} />
                      <Area yAxisId="left" type="monotone" dataKey="insuranceOut" name="Insurance (out)" stroke="#f87171" strokeWidth={1.2} fillOpacity={0.08} fill="#f87171" dot={false} />
                      <Area yAxisId="left" type="monotone" dataKey="taxOut" name="Tax (out)" stroke="#ef4444" strokeWidth={1.2} fillOpacity={0.08} fill="#ef4444" dot={false} />
                      {includeFundOpex && (
                        <Area yAxisId="left" type="monotone" dataKey="fundOpexOut" name="Fund Opex (out)" stroke="#ff9f43" strokeWidth={1.3} fillOpacity={0.08} fill="#ff9f43" dot={false} />
                      )}
                      {includeRenovations && (
                        <Area yAxisId="left" type="monotone" dataKey="renovationsOut" name="Renovations (out)" stroke="var(--gold)" strokeWidth={1.3} fillOpacity={0.08} fill="var(--gold)" dot={false} />
                      )}
                      {includeMgmtFees && (
                        <Area yAxisId="left" type="monotone" dataKey="mgmtFeeOut" name="Mgmt Fee (out)" stroke="#ff7f50" strokeWidth={1.3} fillOpacity={0.08} fill="#ff7f50" dot={false} />
                      )}
                      <Area yAxisId="left" type="monotone" dataKey="debtCostOut" name="Debt Cost (out)" stroke="#a855f7" strokeWidth={1.3} fillOpacity={0.08} fill="#a855f7" dot={false} />
                    </>
                  )}
                  <Area yAxisId="left" type="monotone" dataKey="netCashFlow" name={cashViewMode === 'operating' ? 'Operating CF' : 'Net CF'} stroke="var(--green)" strokeWidth={2} fill="none" dot={false} />
                  {showCumulative && (
                    <Area yAxisId="right" type="monotone" dataKey="cumulativeCashFlow" name="Cumulative" stroke="var(--green)" strokeWidth={1.5} fill="url(#gradCumulative)" dot={false} strokeDasharray="4 2" activeDot={{ r: 4, fill: 'var(--green)', stroke: 'var(--bg-primary)', strokeWidth: 2 }} />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Cash Flow Table (period-aware) ───────────────── */}
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="card-title">{period} Cash Flows</span>
              <div style={{ position: 'relative' }}>
                <button className="btn btn-secondary" onClick={() => setExportOpen(!exportOpen)} style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem' }}>
                  Export Accounting &#x25BE;
                </button>
                {exportOpen && (
                  <div style={{ position: 'absolute', right: 0, top: '110%', background: 'var(--bg-secondary)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '0.35rem 0', zIndex: 50, minWidth: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                    {(Object.keys(REPORT_LABELS) as ReportType[]).map((rt) => (
                      <button key={rt} onClick={() => { generateAccountingCSV(rt, cashFlows, returns); setExportOpen(false); }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.5rem 1rem', background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '0.8rem', cursor: 'pointer', transition: 'background 0.15s' }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                      >
                        {REPORT_LABELS[rt]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div style={{ maxHeight: 500, overflow: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Date</th>
                    <th style={{ textAlign: 'right' }}>Capital Calls</th>
                    <th style={{ textAlign: 'right' }}>Deployments</th>
                    <th style={{ textAlign: 'right' }}>Gross Rent</th>
                    <th style={{ textAlign: 'right' }}>HOA</th>
                    <th style={{ textAlign: 'right' }}>Insurance</th>
                    <th style={{ textAlign: 'right' }}>Tax</th>
                    <th style={{ textAlign: 'right' }}>Fund Opex</th>
                    <th style={{ textAlign: 'right' }}>Renovations</th>
                    <th style={{ textAlign: 'right' }}>Mgmt Fee</th>
                    <th style={{ textAlign: 'right' }}>Net Rent</th>
                    <th style={{ textAlign: 'right' }}>NOI</th>
                    <th style={{ textAlign: 'right' }}>Debt Bal</th>
                    <th style={{ textAlign: 'right' }}>MM Bal</th>
                    <th style={{ textAlign: 'right' }}>Operating CF</th>
                    <th style={{ textAlign: 'right' }}>Net CF</th>
                    <th style={{ textAlign: 'right' }}>Cumulative</th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((row, i) => (
                    <tr key={i}>
                      <td>{row.label}</td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{row.date}</td>
                      <td style={{ textAlign: 'right', color: row.capitalCalls > 0 ? 'var(--accent-light)' : 'var(--text-muted)' }}>
                        {row.capitalCalls > 0 ? fmt(row.capitalCalls) : '\u2014'}
                      </td>
                      <td style={{ textAlign: 'right', color: row.deployments > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
                        {row.deployments > 0 ? fmt(row.deployments) : '\u2014'}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--green)' }}>
                        {row.grossRent > 0 ? fmt(row.grossRent) : '\u2014'}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--red)' }}>
                        {row.hoaExpense > 0 ? fmt(row.hoaExpense) : '\u2014'}
                      </td>
                      <td style={{ textAlign: 'right', color: row.insuranceExpense > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
                        {row.insuranceExpense > 0 ? fmt(row.insuranceExpense) : '\u2014'}
                      </td>
                      <td style={{ textAlign: 'right', color: row.taxExpense > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
                        {row.taxExpense > 0 ? fmt(row.taxExpense) : '\u2014'}
                      </td>
                      <td style={{ textAlign: 'right', color: row.fundOpex > 0 ? '#ff7f50' : 'var(--text-muted)' }}>
                        {row.fundOpex > 0 ? fmt(row.fundOpex) : '\u2014'}
                      </td>
                      <td style={{ textAlign: 'right', color: row.renovationCost > 0 ? 'var(--gold)' : 'var(--text-muted)' }}>
                        {row.renovationCost > 0 ? fmt(row.renovationCost) : '\u2014'}
                      </td>
                      <td style={{ textAlign: 'right', color: row.mgmtFee > 0 ? '#ff7f50' : 'var(--text-muted)' }}>
                        {row.mgmtFee > 0 ? fmt(row.mgmtFee) : '\u2014'}
                      </td>
                      <td style={{ textAlign: 'right' }}>{row.netRent > 0 ? fmt(row.netRent) : '\u2014'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{row.noi !== 0 ? fmt(row.noi) : '\u2014'}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{row.debtBalance > 0 ? fmt(row.debtBalance) : '\u2014'}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{row.mmBalance > 0 ? fmt(row.mmBalance) : '\u2014'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: (row.noi - row.mgmtFee) >= 0 ? 'var(--teal)' : 'var(--red)' }}>
                        {fmt(row.noi - row.mgmtFee)}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: row.netCashFlow < 0 ? 'var(--red)' : row.netCashFlow > 0 ? 'var(--green)' : undefined }}>
                        {row.netCashFlow !== 0 ? fmt(row.netCashFlow) : '\u2014'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: row.cumulativeCashFlow < 0 ? 'var(--red)' : row.cumulativeCashFlow > 0 ? 'var(--green)' : undefined }}>
                        {fmt(row.cumulativeCashFlow)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card mt-4">
            <div className="card-header">
              <span className="card-title">Trend vs Projection</span>
              <span className="badge badge-blue">{cashViewMode === 'overall' ? 'Overall CF' : 'Operating CF'}</span>
            </div>
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <LineChart data={trendData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <YAxis tickFormatter={(v: number) => fmtCompact(v, '')} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                  <Tooltip formatter={(v: number, name: string) => [fmt(v), name]} contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
                  <Line type="monotone" dataKey="projected" name="Projected" stroke="var(--teal)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="actual" name="Actual" stroke="var(--gold)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="variance" name="Variance" stroke="var(--green)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {renovationEvents.length > 0 && (
            <div className="card mt-4">
              <div className="card-header">
                <span className="card-title">Renovation Cash Timing (Actual/Estimated)</span>
                <span className="badge badge-blue">{num(renovationEvents.length)} events</span>
              </div>
              <div style={{ maxHeight: 280, overflow: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Paid Date</th>
                      <th>Unit</th>
                      <th>Description</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {renovationEvents.map((ev) => (
                      <tr key={ev.id}>
                        <td>{ev.paidDate}</td>
                        <td style={{ fontWeight: 600 }}>{ev.unitNumber}</td>
                        <td>{ev.description}</td>
                        <td style={{ textTransform: 'capitalize' }}>{ev.status.replace('_', ' ')}</td>
                        <td style={{ textAlign: 'right', color: 'var(--gold)', fontWeight: 600 }}>{fmt(ev.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
