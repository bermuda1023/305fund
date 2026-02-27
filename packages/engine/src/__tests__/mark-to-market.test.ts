import { markPortfolio, markUnit } from '../mark-to-market';

const fred = [
  { seriesId: 'MIXRNSA', date: '2024-01-01', value: 300 },
  { seriesId: 'MIXRNSA', date: '2025-01-01', value: 330 },
  { seriesId: 'MIXRNSA', date: '2026-01-01', value: 360 },
];

describe('Mark to market', () => {
  it('marks single unit with index appreciation', () => {
    const mark = markUnit(
      {
        unitId: 1,
        unitNumber: '10A',
        purchaseDate: '2024-01-15',
        purchasePrice: 1_000_000,
      },
      fred as any,
      '2026-01-15'
    );
    expect(mark).toBeTruthy();
    expect(Number(mark?.currentMark || 0)).toBeGreaterThan(1_000_000);
  });

  it('aggregates portfolio totals', () => {
    const portfolio = markPortfolio(
      [
        { unitId: 1, unitNumber: '10A', purchaseDate: '2024-01-15', purchasePrice: 1_000_000 },
        { unitId: 2, unitNumber: '10B', purchaseDate: '2025-01-15', purchasePrice: 800_000 },
      ],
      fred as any,
      '2026-01-15'
    );
    expect(portfolio.unitMarks.length).toBe(2);
    expect(portfolio.totalCurrentMark).toBeGreaterThan(portfolio.totalCostBasis);
  });
});

