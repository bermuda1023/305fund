import {
  calcMonthlyPayment,
  createDebtFacility,
  debtBalanceAtQuarter,
  generateAmortizationSchedule,
} from '../leverage';

describe('Leverage helpers', () => {
  it('calculates positive monthly payment for amortizing loan', () => {
    const payment = calcMonthlyPayment(1_000_000, 0.08, 30);
    expect(payment).toBeGreaterThan(0);
  });

  it('generates amortization schedule with declining balance', () => {
    const schedule = generateAmortizationSchedule(500_000, 0.07, 30, 4);
    expect(schedule.length).toBeGreaterThan(0);
    expect(schedule[0].beginningBalance).toBeCloseTo(500_000, 4);
    expect(schedule[schedule.length - 1].endingBalance).toBeLessThan(500_000);
  });

  it('creates debt facility and net proceeds after costs', () => {
    const facility = createDebtFacility(10_000_000, 0.6, 0.08, 30, 0.02);
    expect(facility.principal).toBeCloseTo(6_000_000, 4);
    expect(facility.netProceeds).toBeLessThan(facility.principal);
    expect(facility.refiCosts).toBeGreaterThan(0);
    const q4 = debtBalanceAtQuarter(facility.principal, facility.rate, facility.termYears, 4);
    expect(q4).toBeGreaterThan(0);
    expect(q4).toBeLessThan(facility.principal);
  });
});

