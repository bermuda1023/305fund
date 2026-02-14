import type { FundAssumptions } from '../types/fund';

/**
 * Default fund assumptions matching Excel V3 "Base Case"
 */
export const DEFAULT_ASSUMPTIONS: Omit<FundAssumptions, 'id' | 'createdAt'> = {
  name: 'Base Case',
  isActive: true,

  // Fund structure
  fundSize: 20_000_000,
  fundTermYears: 12,
  investmentPeriodYears: 10,
  gpCoinvestPct: 0.05,

  // Fees
  mgmtFeeInvestPct: 0.00,
  mgmtFeePostPct: 0.005,
  mgmtFeeWaiver: true,

  // Waterfall
  prefReturnPct: 0.06,
  catchupPct: 1.00,
  tier1SplitLP: 0.80,
  tier1SplitGP: 0.20,
  tier2HurdleIRR: 0.15,
  tier2SplitLP: 0.70,
  tier2SplitGP: 0.30,
  tier3HurdleIRR: 0.25,
  tier3SplitLP: 0.65,
  tier3SplitGP: 0.35,

  // Leverage
  refiEnabled: true,
  refiYear: 6,
  refiLTV: 0.55,
  refiRate: 0.06,
  refiTermYears: 30,
  refiCostPct: 0.02,

  // Growth
  rentGrowthPct: 0.03,
  hoaGrowthPct: 0.02,
  vacancyPct: 0.05,

  // Land valuation
  presentDayLandValue: 650_000_000,
  landValueTotal: 800_000_000,
  landGrowthPct: 0.03,
  landPSF: 1_700,

  // Cash management
  mmRate: 0.045,
  excessCashMode: 'mm_sweep',

  // Building
  buildingValuation: 215_000_000,

  // Bonus triggers
  bonusIRRThreshold: 0.25,
  bonusMaxYears: 12,
  bonusYieldThreshold: 0.04,
};
