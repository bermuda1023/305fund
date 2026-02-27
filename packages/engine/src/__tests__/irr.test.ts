import { xirr, xnpv } from '../irr';

describe('xirr', () => {
  it('matches a simple one-year 10% return', () => {
    const flows = [
      { date: new Date('2024-01-01T00:00:00Z'), amount: -1000 },
      { date: new Date('2025-01-01T00:00:00Z'), amount: 1100 },
    ];
    const rate = xirr(flows);
    // Uses a 365.25-day denominator, so 1 calendar year is slightly below 10%.
    expect(rate).toBeCloseTo(0.0998, 3);
  });

  it('solves irregular dates with low residual NPV', () => {
    const flows = [
      { date: new Date('2024-01-01T00:00:00Z'), amount: -1000 },
      { date: new Date('2024-07-15T00:00:00Z'), amount: 500 },
      { date: new Date('2025-03-10T00:00:00Z'), amount: 650 },
    ];
    const rate = xirr(flows);
    const residual = xnpv(rate, flows);
    expect(Math.abs(residual)).toBeLessThan(1e-5);
  });

  it('throws when cash flows are missing opposite signs', () => {
    const onlyOutflows = [
      { date: new Date('2024-01-01T00:00:00Z'), amount: -1000 },
      { date: new Date('2024-06-01T00:00:00Z'), amount: -100 },
    ];
    expect(() => xirr(onlyOutflows)).toThrow(/both investments/i);
  });
});
