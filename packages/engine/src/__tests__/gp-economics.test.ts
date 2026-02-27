import { calcGPEconomics, calcManagementFees } from '../gp-economics';

const assumptions: any = {
  fundSize: 10_000_000,
  investmentPeriodYears: 3,
  mgmtFeeInvestPct: 0.02,
  mgmtFeePostPct: 0.01,
  mgmtFeeWaiver: false,
  gpCoinvestPct: 0.1,
  bonusIRRThreshold: 0.15,
  bonusMaxYears: 8,
  bonusYieldThreshold: 0.05,
};

describe('GP economics', () => {
  it('calculates management fees by phase', () => {
    const fees = calcManagementFees(assumptions, 12, 8, 6_000_000);
    expect(fees.total).toBeGreaterThan(0);
    expect(fees.byYear.length).toBeGreaterThan(0);
  });

  it('aggregates carry tiers and bonus trigger flags', () => {
    const out = calcGPEconomics({
      assumptions,
      waterfall: {
        tiers: [
          { tierIndex: 1, name: 'Return of Capital', gpAmount: 200_000 },
          { tierIndex: 4, name: 'Catch-up', gpAmount: 50_000 },
          { tierIndex: 5, name: 'Tier 1', gpAmount: 30_000 },
          { tierIndex: 6, name: 'Tier 2', gpAmount: 20_000 },
        ],
      } as any,
      totalNOI: 1_000_000,
      actualHoldYears: 7,
      actualYield: 0.06,
      fundIRR: 0.16,
      capitalDeployed: 6_000_000,
      numQuartersInvesting: 12,
      numQuartersPost: 8,
    });
    expect(out.carryTotal).toBeGreaterThan(0);
    expect(out.totalGPComp).toBeGreaterThan(out.carryTotal);
    expect(out.bonusTriggers.irrMet).toBe(true);
  });
});

