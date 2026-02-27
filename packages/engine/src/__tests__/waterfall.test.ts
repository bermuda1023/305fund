import { DEFAULT_ASSUMPTIONS } from '@brickell/shared';
import { runWaterfall } from '../waterfall';

function baseInput(overrides: Partial<Parameters<typeof runWaterfall>[0]> = {}) {
  return {
    totalAvailable: 1_000_000,
    lpCapital: 400_000,
    gpCoinvest: 100_000,
    outstandingDebt: 250_000,
    assumptions: {
      ...DEFAULT_ASSUMPTIONS,
      fundTermYears: 1,
      prefReturnPct: 0.08,
      catchupPct: 1,
      tier1SplitLP: 0.8,
      tier1SplitGP: 0.2,
      tier2HurdleIRR: 0.15,
      tier2SplitLP: 0.7,
      tier2SplitGP: 0.3,
      tier3HurdleIRR: 0.25,
      tier3SplitLP: 0.65,
      tier3SplitGP: 0.35,
    },
    lpCashFlows: [
      { date: new Date('2024-01-01T00:00:00Z'), amount: -400_000 },
    ],
    ...overrides,
  };
}

describe('runWaterfall', () => {
  it('conserves cash and returns deterministic tier totals', () => {
    const input = baseInput();
    const result = runWaterfall(input);
    const debtTier = result.tiers.find((t) => t.tierIndex === 1);
    expect(result.totalDistributed).toBeCloseTo(input.totalAvailable, 2);
    expect((result.totalLP + result.totalGP) + Number(debtTier?.totalAmount || 0)).toBeCloseTo(result.totalDistributed, 2);
    expect(result.tiers[0].name).toBe('Debt Repayment');
    expect(result.tiers[0].totalAmount).toBeCloseTo(input.outstandingDebt, 2);
  });

  it('pays return-of-capital pro-rata LP/GP', () => {
    const input = baseInput({ totalAvailable: 500_000, outstandingDebt: 0 });
    const result = runWaterfall(input);
    const rocTier = result.tiers.find((t) => t.tierIndex === 2);
    expect(rocTier).toBeDefined();
    expect(rocTier!.lpAmount).toBeCloseTo(400_000, 2);
    expect(rocTier!.gpAmount).toBeCloseTo(100_000, 2);
  });

  it('handles zero distributable cash safely', () => {
    const input = baseInput({ totalAvailable: 0, outstandingDebt: 0 });
    const result = runWaterfall(input);
    expect(result.totalDistributed).toBe(0);
    expect(result.totalLP).toBe(0);
    expect(result.totalGP).toBe(0);
    expect(result.tiers.length).toBeGreaterThan(0);
  });
});
