import { calcMMIncome, routeExcessCash } from '../excess-cash';

describe('Excess cash routing', () => {
  it('routes to MM sweep and distribution modes', () => {
    const mm = routeExcessCash(100_000, 'mm_sweep');
    expect(mm.mmDepositAmount).toBe(100_000);
    expect(mm.distributionAmount).toBe(0);

    const dist = routeExcessCash(100_000, 'distribute');
    expect(dist.distributionAmount).toBe(100_000);
    expect(dist.mmDepositAmount).toBe(0);
  });

  it('supports capped reinvest and leftover MM deposit', () => {
    const out = routeExcessCash(1_300_000, 'reinvest', 500_000, 2);
    expect(out.unitsAcquirable).toBe(2);
    expect(out.reinvestAmount).toBe(1_000_000);
    expect(out.mmDepositAmount).toBe(300_000);
  });

  it('calculates quarterly MM income from annual rate', () => {
    const income = calcMMIncome(1_000_000, 0.08);
    expect(income).toBeGreaterThan(0);
    expect(income).toBeLessThan(25_000);
  });
});

