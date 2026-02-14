// Fund-level types for financial modeling

export interface FundAssumptions {
  id?: number;
  name: string;
  isActive: boolean;

  // Fund structure
  fundSize: number;           // Total fund size (e.g., 20_000_000)
  fundTermYears: number;      // Variable (6-15)
  investmentPeriodYears: number;
  gpCoinvestPct: number;      // e.g., 0.05 = 5%

  // Fees
  mgmtFeeInvestPct: number;   // During investment period
  mgmtFeePostPct: number;     // Post-deployment (e.g., 0.005 = 0.5%)
  mgmtFeeWaiver: boolean;     // If true, fees offset against carry

  // Waterfall
  prefReturnPct: number;       // e.g., 0.06 = 6%
  catchupPct: number;          // e.g., 1.0 = 100% GP catch-up
  tier1SplitLP: number;        // e.g., 0.80
  tier1SplitGP: number;        // e.g., 0.20
  tier2HurdleIRR: number;      // e.g., 0.15 = 15%
  tier2SplitLP: number;
  tier2SplitGP: number;
  tier3HurdleIRR: number;      // e.g., 0.25 = 25%
  tier3SplitLP: number;
  tier3SplitGP: number;

  // Leverage
  refiEnabled: boolean;
  refiYear: number;
  refiLTV: number;
  refiRate: number;
  refiTermYears: number;
  refiCostPct: number;

  // Growth assumptions
  rentGrowthPct: number;       // Annual, e.g., 0.03 = 3%
  hoaGrowthPct: number;
  vacancyPct: number;

  // Land valuation
  presentDayLandValue: number;   // Current land value (today)
  landValueTotal: number;      // Current total land value (e.g., 800_000_000)
  landGrowthPct: number;
  landPSF: number;             // $/sqft for land

  // Cash management
  mmRate: number;              // Money market rate (e.g., 0.045 = 4.5%)
  excessCashMode: 'reinvest' | 'mm_sweep' | 'distribute';

  // Building basis
  buildingValuation: number;   // Current implied value (e.g., 215_000_000)

  // Bonus triggers
  bonusIRRThreshold: number;
  bonusMaxYears: number;
  bonusYieldThreshold: number;

  createdAt?: string;
}

export interface WaterfallTier {
  tierIndex: number;          // 1=Debt, 2=ROC, 3=Pref, 4=Catchup, 5+=splits
  name: string;
  lpAmount: number;
  gpAmount: number;
  totalAmount: number;
}

export interface WaterfallResult {
  tiers: WaterfallTier[];
  totalLP: number;
  totalGP: number;
  totalDistributed: number;
  lpPct: number;
  gpPct: number;
}

export interface QuarterlyCashFlow {
  quarter: string;             // "Q1 2026"
  date: string;                // ISO date
  quarterIndex: number;        // 0-based

  // Capital activity
  capitalCalls: number;
  capitalReturns: number;

  // Acquisitions
  unitsAcquired: number;
  acquisitionCost: number;
  cumulativeUnits: number;

  // Operating
  grossRent: number;
  vacancy: number;
  netRent: number;
  hoaExpense: number;
  insuranceExpense: number;
  taxExpense: number;
  operatingExpense: number;
  netOperatingIncome: number;

  // Debt
  debtDrawdown: number;
  debtRepayment: number;
  interestExpense: number;
  debtBalance: number;

  // Cash management
  excessCash: number;
  mmDeposit: number;
  mmWithdrawal: number;
  mmBalance: number;
  mmIncome: number;

  // Distributions (if excess_cash_mode = 'distribute')
  lpDistributions: number;

  // Management fees
  mgmtFee: number;

  // Exit (final quarter only)
  grossSaleProceeds: number;
  mmLiquidation: number;

  // Totals
  netCashFlow: number;
  cumulativeCashFlow: number;
}

export interface SensitivityTable {
  rowVariable: string;         // e.g., "Land Growth %"
  colVariable: string;         // e.g., "Hold Period (Years)"
  rowValues: number[];
  colValues: number[];
  metric: string;              // e.g., "Fund MOIC" or "LP IRR"
  data: number[][];            // [row][col]
}

export interface GPEconomics {
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

export interface FundReturns {
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

export interface ModelRunResult {
  assumptions: FundAssumptions;
  cashFlows: QuarterlyCashFlow[];
  returns: FundReturns;
  waterfall: WaterfallResult;
  gpEconomics: GPEconomics;
}
