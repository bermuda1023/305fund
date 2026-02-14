// IRR & MOIC
export { xirr, xnpv, irr, type CashFlowEntry } from './irr';
export { calcMOIC, calcNetMOIC, calcLPMOIC, calcGPCoinvestMOIC } from './moic';

// Waterfall
export { runWaterfall, type WaterfallInput } from './waterfall';

// Cash Flows
export {
  projectCashFlows,
  generateDefaultAcquisitionSchedule,
  type CashFlowInput,
  type AcquisitionSchedule,
} from './cashflows';

// Leverage
export {
  calcMonthlyPayment,
  createDebtFacility,
  generateAmortizationSchedule,
  debtBalanceAtQuarter,
  type DebtFacility,
  type QuarterlyDebtPayment,
} from './leverage';

// Excess Cash
export {
  routeExcessCash,
  calcMMIncome,
  type ExcessCashMode,
  type ExcessCashResult,
} from './excess-cash';

// GP Economics
export {
  calcGPEconomics,
  calcManagementFees,
  type GPEconomicsInput,
} from './gp-economics';

// Sensitivity
export {
  generateSensitivityTable,
  SENSITIVITY_PRESETS,
  type SensitivityConfig,
  type SensitivityResult,
} from './sensitivity';

// Mark-to-Market
export {
  markUnit,
  markPortfolio,
  type MarkToMarketUnit,
} from './mark-to-market';

// Accounting Export
export {
  generateIncomeStatement,
  generateBalanceSheet,
  generateCashFlowStatement,
  generateTrialBalance,
  generateCapitalAccounts,
  incomeStatementToCSV,
  balanceSheetToCSV,
  cashFlowStatementToCSV,
  trialBalanceToCSV,
  capitalAccountsToCSV,
  type AccountingReport,
  type AccountingRow,
  type IncomeStatementReport,
  type BalanceSheetReport,
  type CashFlowStatementReport,
  type TrialBalanceReport,
  type CapitalAccountReport,
} from './accounting';
