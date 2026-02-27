import { DEFAULT_ASSUMPTIONS } from '@brickell/shared';
import { generateDefaultAcquisitionSchedule, projectCashFlows } from '../cashflows';
import {
  generateBalanceSheet,
  generateCashFlowStatement,
  generateIncomeStatement,
  incomeStatementToCSV,
} from '../accounting';

describe('Cashflows + accounting reports', () => {
  const assumptions: any = {
    ...DEFAULT_ASSUMPTIONS,
    id: 1,
    createdAt: '2026-01-01',
  };

  it('projects non-empty quarterly cash flows', () => {
    const cashFlows = projectCashFlows({
      assumptions,
      acquisitions: generateDefaultAcquisitionSchedule(assumptions),
      baseMonthlyRent: 2800,
      baseMonthlyHOA: 1400,
      baseAnnualInsurance: 2400,
      baseAnnualTax: 2400,
      annualFundOpex: 75_000,
    });
    expect(cashFlows.length).toBe(assumptions.fundTermYears * 4);
    expect(cashFlows[0].quarter).toContain('Q');
  });

  it('builds accounting reports and CSV output', () => {
    const cashFlows = projectCashFlows({
      assumptions,
      acquisitions: [{ quarter: 0, units: 2, costPerUnit: 500_000 }],
      baseMonthlyRent: 2800,
      baseMonthlyHOA: 1400,
      baseAnnualInsurance: 2400,
      baseAnnualTax: 2400,
      annualFundOpex: 75_000,
    });

    const income = generateIncomeStatement(cashFlows, assumptions);
    const balance = generateBalanceSheet(cashFlows, assumptions);
    const cfs = generateCashFlowStatement(cashFlows, assumptions);
    const csv = incomeStatementToCSV(income);

    expect(income.totalRevenue).toBeDefined();
    expect(balance.totalAssets).toBeDefined();
    expect(cfs.netChange).toBeDefined();
    expect(csv).toContain('Income Statement');
  });
});

