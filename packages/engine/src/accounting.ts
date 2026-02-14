/**
 * Accounting export generator.
 * Produces structured fund accounting data from model results:
 *   - Trial Balance
 *   - Income Statement
 *   - Balance Sheet
 *   - Cash Flow Statement
 *   - Capital Account Summary
 */

import type {
  QuarterlyCashFlow,
  FundAssumptions,
  WaterfallResult,
  GPEconomics,
  FundReturns,
} from '@brickell/shared';

/* ── Shared types ─────────────────────────────────────────────── */

export interface AccountingRow {
  account: string;
  category: string;
  amount: number;
}

export interface IncomeStatementReport {
  reportType: 'income_statement';
  asOfDate: string;
  periodLabel: string;
  revenue: AccountingRow[];
  expenses: AccountingRow[];
  totalRevenue: number;
  totalExpenses: number;
  netIncome: number;
}

export interface BalanceSheetReport {
  reportType: 'balance_sheet';
  asOfDate: string;
  assets: AccountingRow[];
  liabilities: AccountingRow[];
  equity: AccountingRow[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
}

export interface CashFlowStatementReport {
  reportType: 'cash_flow_statement';
  asOfDate: string;
  periodLabel: string;
  operating: AccountingRow[];
  investing: AccountingRow[];
  financing: AccountingRow[];
  totalOperating: number;
  totalInvesting: number;
  totalFinancing: number;
  netChange: number;
  beginningCash: number;
  endingCash: number;
}

export interface TrialBalanceReport {
  reportType: 'trial_balance';
  asOfDate: string;
  entries: { account: string; debit: number; credit: number }[];
  totalDebits: number;
  totalCredits: number;
}

export interface CapitalAccountReport {
  reportType: 'capital_accounts';
  asOfDate: string;
  lpSummary: {
    beginningBalance: number;
    contributions: number;
    allocations: number;
    distributions: number;
    endingBalance: number;
  };
  gpSummary: {
    beginningBalance: number;
    contributions: number;
    carry: number;
    mgmtFees: number;
    distributions: number;
    endingBalance: number;
  };
}

export type AccountingReport =
  | IncomeStatementReport
  | BalanceSheetReport
  | CashFlowStatementReport
  | TrialBalanceReport
  | CapitalAccountReport;

/* ── Helpers ──────────────────────────────────────────────────── */

function sumField(cfs: QuarterlyCashFlow[], field: keyof QuarterlyCashFlow): number {
  return cfs.reduce((s, cf) => s + (cf[field] as number), 0);
}

function quarterToDate(q: string): string {
  // "Q1 2026" → "2026-03-31" (end of quarter)
  const match = q.match(/Q(\d)\s+(\d{4})/);
  if (!match) return q;
  const qNum = parseInt(match[1]);
  const year = parseInt(match[2]);
  const month = qNum * 3;
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/* ── Report generators ────────────────────────────────────────── */

/**
 * Generate an Income Statement for a range of quarters.
 */
export function generateIncomeStatement(
  cashFlows: QuarterlyCashFlow[],
  assumptions: FundAssumptions,
  fromQuarter?: number,
  toQuarter?: number,
): IncomeStatementReport {
  const cfs = cashFlows.filter(
    (cf) => (fromQuarter == null || cf.quarterIndex >= fromQuarter) &&
            (toQuarter == null || cf.quarterIndex <= toQuarter),
  );

  const last = cfs[cfs.length - 1];
  const first = cfs[0];
  const periodLabel = first && last ? `${first.quarter} – ${last.quarter}` : 'Full Fund Life';

  const grossRent = sumField(cfs, 'grossRent');
  const vacancy = sumField(cfs, 'vacancy');
  const mmIncome = sumField(cfs, 'mmIncome');
  const saleProceeds = sumField(cfs, 'grossSaleProceeds');

  const hoaExpense = sumField(cfs, 'hoaExpense');
  const insuranceExpense = sumField(cfs, 'insuranceExpense');
  const taxExpense = sumField(cfs, 'taxExpense');
  const operatingExpense = sumField(cfs, 'operatingExpense');
  const interestExpense = sumField(cfs, 'interestExpense');
  const mgmtFee = sumField(cfs, 'mgmtFee');

  const revenue: AccountingRow[] = [
    { account: 'Gross Rental Income', category: 'Revenue', amount: grossRent },
    { account: 'Less: Vacancy', category: 'Revenue', amount: -vacancy },
    { account: 'Money Market Income', category: 'Revenue', amount: mmIncome },
  ];
  if (saleProceeds > 0) {
    revenue.push({ account: 'Gain on Sale (Land)', category: 'Revenue', amount: saleProceeds });
  }

  const expenses: AccountingRow[] = [
    { account: 'HOA Expenses', category: 'Expense', amount: hoaExpense },
    { account: 'Insurance', category: 'Expense', amount: insuranceExpense },
    { account: 'Property Tax', category: 'Expense', amount: taxExpense },
    { account: 'Fund Operating Expenses', category: 'Expense', amount: operatingExpense },
    { account: 'Interest Expense', category: 'Expense', amount: interestExpense },
    { account: 'Management Fees', category: 'Expense', amount: mgmtFee },
  ];

  const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);
  const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0);

  return {
    reportType: 'income_statement',
    asOfDate: last ? quarterToDate(last.quarter) : new Date().toISOString().slice(0, 10),
    periodLabel,
    revenue,
    expenses,
    totalRevenue,
    totalExpenses,
    netIncome: totalRevenue - totalExpenses,
  };
}

/**
 * Generate a Balance Sheet as of a specific quarter.
 */
export function generateBalanceSheet(
  cashFlows: QuarterlyCashFlow[],
  assumptions: FundAssumptions,
  asOfQuarter?: number,
): BalanceSheetReport {
  const qi = asOfQuarter ?? cashFlows.length - 1;
  const cf = cashFlows[qi];
  if (!cf) {
    return {
      reportType: 'balance_sheet',
      asOfDate: new Date().toISOString().slice(0, 10),
      assets: [],
      liabilities: [],
      equity: [],
      totalAssets: 0,
      totalLiabilities: 0,
      totalEquity: 0,
    };
  }

  const totalAcqCost = cashFlows.slice(0, qi + 1).reduce((s, c) => s + c.acquisitionCost, 0);
  const totalCapitalCalled = cashFlows.slice(0, qi + 1).reduce((s, c) => s + c.capitalCalls, 0);
  const totalDistributed = cashFlows.slice(0, qi + 1).reduce((s, c) => s + c.lpDistributions, 0);
  const totalRevenue = cashFlows.slice(0, qi + 1).reduce((s, c) => s + c.grossRent - c.vacancy + c.mmIncome + c.grossSaleProceeds, 0);
  const totalExpenses = cashFlows.slice(0, qi + 1).reduce(
    (s, c) => s + c.hoaExpense + c.insuranceExpense + c.taxExpense + c.operatingExpense + c.interestExpense + c.mgmtFee,
    0,
  );
  const retainedEarnings = totalRevenue - totalExpenses;

  const assets: AccountingRow[] = [
    { account: 'Real Estate (at cost)', category: 'Assets', amount: totalAcqCost },
    { account: 'Money Market Account', category: 'Assets', amount: cf.mmBalance },
    { account: 'Cash & Equivalents', category: 'Assets', amount: Math.max(0, cf.cumulativeCashFlow - cf.mmBalance) },
  ];

  const liabilities: AccountingRow[] = [
    { account: 'Debt Facility', category: 'Liabilities', amount: cf.debtBalance },
  ];

  const gpCoinvest = assumptions.fundSize * assumptions.gpCoinvestPct;
  const lpCapital = totalCapitalCalled - gpCoinvest;

  const equity: AccountingRow[] = [
    { account: 'LP Capital Contributions', category: 'Equity', amount: Math.max(0, lpCapital) },
    { account: 'GP Co-Investment', category: 'Equity', amount: gpCoinvest },
    { account: 'Retained Earnings', category: 'Equity', amount: retainedEarnings },
    { account: 'Less: Distributions', category: 'Equity', amount: -totalDistributed },
  ];

  const totalAssets = assets.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0);
  const totalEquity = equity.reduce((s, r) => s + r.amount, 0);

  return {
    reportType: 'balance_sheet',
    asOfDate: quarterToDate(cf.quarter),
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
  };
}

/**
 * Generate a Cash Flow Statement for a range of quarters.
 */
export function generateCashFlowStatement(
  cashFlows: QuarterlyCashFlow[],
  assumptions: FundAssumptions,
  fromQuarter?: number,
  toQuarter?: number,
): CashFlowStatementReport {
  const cfs = cashFlows.filter(
    (cf) => (fromQuarter == null || cf.quarterIndex >= fromQuarter) &&
            (toQuarter == null || cf.quarterIndex <= toQuarter),
  );

  const last = cfs[cfs.length - 1];
  const first = cfs[0];
  const periodLabel = first && last ? `${first.quarter} – ${last.quarter}` : 'Full Fund Life';
  const prevCF = first && first.quarterIndex > 0 ? cashFlows[first.quarterIndex - 1] : null;
  const beginningCash = prevCF ? prevCF.cumulativeCashFlow : 0;

  const operating: AccountingRow[] = [
    { account: 'Net Rental Income', category: 'Operating', amount: sumField(cfs, 'netRent') },
    { account: 'HOA Expenses', category: 'Operating', amount: -sumField(cfs, 'hoaExpense') },
    { account: 'Insurance', category: 'Operating', amount: -sumField(cfs, 'insuranceExpense') },
    { account: 'Property Tax', category: 'Operating', amount: -sumField(cfs, 'taxExpense') },
    { account: 'Operating Expenses', category: 'Operating', amount: -sumField(cfs, 'operatingExpense') },
    { account: 'Management Fees', category: 'Operating', amount: -sumField(cfs, 'mgmtFee') },
    { account: 'Money Market Income', category: 'Operating', amount: sumField(cfs, 'mmIncome') },
    { account: 'Interest Expense', category: 'Operating', amount: -sumField(cfs, 'interestExpense') },
  ];

  const investing: AccountingRow[] = [
    { account: 'Acquisitions', category: 'Investing', amount: -sumField(cfs, 'acquisitionCost') },
    { account: 'Sale Proceeds', category: 'Investing', amount: sumField(cfs, 'grossSaleProceeds') },
    { account: 'MM Deposits (net)', category: 'Investing', amount: -(sumField(cfs, 'mmDeposit') - sumField(cfs, 'mmWithdrawal') - sumField(cfs, 'mmLiquidation')) },
  ];

  const financing: AccountingRow[] = [
    { account: 'Capital Calls', category: 'Financing', amount: sumField(cfs, 'capitalCalls') },
    { account: 'Debt Drawdown', category: 'Financing', amount: sumField(cfs, 'debtDrawdown') },
    { account: 'Debt Repayment', category: 'Financing', amount: -sumField(cfs, 'debtRepayment') },
    { account: 'LP Distributions', category: 'Financing', amount: -sumField(cfs, 'lpDistributions') },
  ];

  const totalOperating = operating.reduce((s, r) => s + r.amount, 0);
  const totalInvesting = investing.reduce((s, r) => s + r.amount, 0);
  const totalFinancing = financing.reduce((s, r) => s + r.amount, 0);

  return {
    reportType: 'cash_flow_statement',
    asOfDate: last ? quarterToDate(last.quarter) : new Date().toISOString().slice(0, 10),
    periodLabel,
    operating,
    investing,
    financing,
    totalOperating,
    totalInvesting,
    totalFinancing,
    netChange: totalOperating + totalInvesting + totalFinancing,
    beginningCash,
    endingCash: last ? last.cumulativeCashFlow : 0,
  };
}

/**
 * Generate a Trial Balance as of a specific quarter.
 */
export function generateTrialBalance(
  cashFlows: QuarterlyCashFlow[],
  assumptions: FundAssumptions,
  asOfQuarter?: number,
): TrialBalanceReport {
  const qi = asOfQuarter ?? cashFlows.length - 1;
  const cf = cashFlows[qi];
  if (!cf) {
    return {
      reportType: 'trial_balance',
      asOfDate: new Date().toISOString().slice(0, 10),
      entries: [],
      totalDebits: 0,
      totalCredits: 0,
    };
  }

  const totalAcqCost = cashFlows.slice(0, qi + 1).reduce((s, c) => s + c.acquisitionCost, 0);
  const totalCapCalls = cashFlows.slice(0, qi + 1).reduce((s, c) => s + c.capitalCalls, 0);
  const totalDistributed = cashFlows.slice(0, qi + 1).reduce((s, c) => s + c.lpDistributions, 0);
  const totalRevenue = cashFlows.slice(0, qi + 1).reduce((s, c) => s + c.grossRent - c.vacancy + c.mmIncome + c.grossSaleProceeds, 0);
  const totalExpenses = cashFlows.slice(0, qi + 1).reduce(
    (s, c) => s + c.hoaExpense + c.insuranceExpense + c.taxExpense + c.operatingExpense + c.interestExpense + c.mgmtFee,
    0,
  );

  const entries: { account: string; debit: number; credit: number }[] = [
    // Assets (debit balances)
    { account: 'Real Estate (at cost)', debit: totalAcqCost, credit: 0 },
    { account: 'Money Market Account', debit: cf.mmBalance, credit: 0 },
    { account: 'Cash & Equivalents', debit: Math.max(0, cf.cumulativeCashFlow - cf.mmBalance), credit: 0 },
    // Liabilities (credit balances)
    { account: 'Debt Facility', debit: 0, credit: cf.debtBalance },
    // Equity (credit balances)
    { account: 'Partner Capital', debit: 0, credit: totalCapCalls },
    { account: 'Distributions', debit: totalDistributed, credit: 0 },
    // Revenue (credit balances)
    { account: 'Revenue', debit: 0, credit: totalRevenue },
    // Expenses (debit balances)
    { account: 'Expenses', debit: totalExpenses, credit: 0 },
  ];

  const totalDebits = entries.reduce((s, e) => s + e.debit, 0);
  const totalCredits = entries.reduce((s, e) => s + e.credit, 0);

  return {
    reportType: 'trial_balance',
    asOfDate: quarterToDate(cf.quarter),
    entries,
    totalDebits,
    totalCredits,
  };
}

/**
 * Generate Capital Account summaries for LP and GP.
 */
export function generateCapitalAccounts(
  cashFlows: QuarterlyCashFlow[],
  assumptions: FundAssumptions,
  returns: FundReturns,
  asOfQuarter?: number,
): CapitalAccountReport {
  const qi = asOfQuarter ?? cashFlows.length - 1;
  const cf = cashFlows[qi];
  if (!cf) {
    return {
      reportType: 'capital_accounts',
      asOfDate: new Date().toISOString().slice(0, 10),
      lpSummary: { beginningBalance: 0, contributions: 0, allocations: 0, distributions: 0, endingBalance: 0 },
      gpSummary: { beginningBalance: 0, contributions: 0, carry: 0, mgmtFees: 0, distributions: 0, endingBalance: 0 },
    };
  }

  const totalCapCalls = cashFlows.slice(0, qi + 1).reduce((s, c) => s + c.capitalCalls, 0);
  const gpCoinvest = assumptions.fundSize * assumptions.gpCoinvestPct;
  const lpContributions = totalCapCalls - gpCoinvest;
  const totalDistributed = cashFlows.slice(0, qi + 1).reduce((s, c) => s + c.lpDistributions, 0);

  // Allocations = LP share of net income
  const totalNOI = cashFlows.slice(0, qi + 1).reduce((s, c) => s + c.netOperatingIncome, 0);
  const totalWaterfallDistributed = returns.waterfall.totalLP + returns.waterfall.totalGP;
  const lpSharePct = totalWaterfallDistributed > 0
    ? returns.waterfall.totalLP / totalWaterfallDistributed
    : (1 - assumptions.gpCoinvestPct);
  const lpAllocations = totalNOI * lpSharePct;

  const lpEndingBalance = lpContributions + lpAllocations - totalDistributed;

  // GP economics
  const gpCarry = returns.gpEconomics.carryTotal;
  const gpMgmtFees = returns.gpEconomics.mgmtFeesTotal;
  const gpDistributions = returns.waterfall.totalGP;
  const gpEndingBalance = gpCoinvest + gpCarry + gpMgmtFees - gpDistributions;

  return {
    reportType: 'capital_accounts',
    asOfDate: quarterToDate(cf.quarter),
    lpSummary: {
      beginningBalance: 0,
      contributions: lpContributions,
      allocations: lpAllocations,
      distributions: totalDistributed,
      endingBalance: lpEndingBalance,
    },
    gpSummary: {
      beginningBalance: 0,
      contributions: gpCoinvest,
      carry: gpCarry,
      mgmtFees: gpMgmtFees,
      distributions: gpDistributions,
      endingBalance: gpEndingBalance,
    },
  };
}

/* ── CSV formatters ───────────────────────────────────────────── */

function fmtNum(n: number): string {
  return n.toFixed(2);
}

export function incomeStatementToCSV(report: IncomeStatementReport): string {
  const lines: string[] = [
    `Income Statement,${report.periodLabel}`,
    `As of,${report.asOfDate}`,
    '',
    'REVENUE,,',
    'Account,Category,Amount',
  ];
  for (const r of report.revenue) {
    lines.push(`${r.account},${r.category},${fmtNum(r.amount)}`);
  }
  lines.push(`Total Revenue,,${fmtNum(report.totalRevenue)}`);
  lines.push('');
  lines.push('EXPENSES,,');
  for (const r of report.expenses) {
    lines.push(`${r.account},${r.category},${fmtNum(r.amount)}`);
  }
  lines.push(`Total Expenses,,${fmtNum(report.totalExpenses)}`);
  lines.push('');
  lines.push(`NET INCOME,,${fmtNum(report.netIncome)}`);
  return lines.join('\n');
}

export function balanceSheetToCSV(report: BalanceSheetReport): string {
  const lines: string[] = [
    `Balance Sheet`,
    `As of,${report.asOfDate}`,
    '',
    'ASSETS,,',
    'Account,Category,Amount',
  ];
  for (const r of report.assets) {
    lines.push(`${r.account},${r.category},${fmtNum(r.amount)}`);
  }
  lines.push(`Total Assets,,${fmtNum(report.totalAssets)}`);
  lines.push('');
  lines.push('LIABILITIES,,');
  for (const r of report.liabilities) {
    lines.push(`${r.account},${r.category},${fmtNum(r.amount)}`);
  }
  lines.push(`Total Liabilities,,${fmtNum(report.totalLiabilities)}`);
  lines.push('');
  lines.push('EQUITY,,');
  for (const r of report.equity) {
    lines.push(`${r.account},${r.category},${fmtNum(r.amount)}`);
  }
  lines.push(`Total Equity,,${fmtNum(report.totalEquity)}`);
  lines.push('');
  lines.push(`Total Liabilities + Equity,,${fmtNum(report.totalLiabilities + report.totalEquity)}`);
  return lines.join('\n');
}

export function cashFlowStatementToCSV(report: CashFlowStatementReport): string {
  const lines: string[] = [
    `Cash Flow Statement,${report.periodLabel}`,
    `As of,${report.asOfDate}`,
    '',
    'OPERATING ACTIVITIES,,',
    'Account,Category,Amount',
  ];
  for (const r of report.operating) {
    lines.push(`${r.account},${r.category},${fmtNum(r.amount)}`);
  }
  lines.push(`Net Cash from Operations,,${fmtNum(report.totalOperating)}`);
  lines.push('');
  lines.push('INVESTING ACTIVITIES,,');
  for (const r of report.investing) {
    lines.push(`${r.account},${r.category},${fmtNum(r.amount)}`);
  }
  lines.push(`Net Cash from Investing,,${fmtNum(report.totalInvesting)}`);
  lines.push('');
  lines.push('FINANCING ACTIVITIES,,');
  for (const r of report.financing) {
    lines.push(`${r.account},${r.category},${fmtNum(r.amount)}`);
  }
  lines.push(`Net Cash from Financing,,${fmtNum(report.totalFinancing)}`);
  lines.push('');
  lines.push(`Net Change in Cash,,${fmtNum(report.netChange)}`);
  lines.push(`Beginning Cash,,${fmtNum(report.beginningCash)}`);
  lines.push(`Ending Cash,,${fmtNum(report.endingCash)}`);
  return lines.join('\n');
}

export function trialBalanceToCSV(report: TrialBalanceReport): string {
  const lines: string[] = [
    `Trial Balance`,
    `As of,${report.asOfDate}`,
    '',
    'Account,Debit,Credit',
  ];
  for (const e of report.entries) {
    lines.push(`${e.account},${fmtNum(e.debit)},${fmtNum(e.credit)}`);
  }
  lines.push('');
  lines.push(`TOTALS,${fmtNum(report.totalDebits)},${fmtNum(report.totalCredits)}`);
  return lines.join('\n');
}

export function capitalAccountsToCSV(report: CapitalAccountReport): string {
  const lp = report.lpSummary;
  const gp = report.gpSummary;
  const lines: string[] = [
    `Capital Account Summary`,
    `As of,${report.asOfDate}`,
    '',
    'LP CAPITAL ACCOUNT,,',
    'Item,Amount',
    `Beginning Balance,${fmtNum(lp.beginningBalance)}`,
    `Contributions,${fmtNum(lp.contributions)}`,
    `Income Allocations,${fmtNum(lp.allocations)}`,
    `Distributions,${fmtNum(-lp.distributions)}`,
    `Ending Balance,${fmtNum(lp.endingBalance)}`,
    '',
    'GP CAPITAL ACCOUNT,,',
    'Item,Amount',
    `Beginning Balance,${fmtNum(gp.beginningBalance)}`,
    `Co-Investment,${fmtNum(gp.contributions)}`,
    `Carried Interest,${fmtNum(gp.carry)}`,
    `Management Fees,${fmtNum(gp.mgmtFees)}`,
    `Distributions,${fmtNum(-gp.distributions)}`,
    `Ending Balance,${fmtNum(gp.endingBalance)}`,
  ];
  return lines.join('\n');
}
