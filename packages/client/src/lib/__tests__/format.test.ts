import { fmtCurrency, fmtCurrencyCompact, fmtNumber, fmtPct, fmtPctRaw } from '../format';

describe('format utilities', () => {
  it('formats currency and numbers', () => {
    expect(fmtCurrency(1234567)).toBe('$1,234,567');
    expect(fmtNumber(1234567)).toBe('1,234,567');
  });

  it('formats compact currency and percentages', () => {
    expect(fmtCurrencyCompact(1_250_000)).toBe('$1.3M');
    expect(fmtCurrencyCompact(25_100)).toBe('$25K');
    expect(fmtPct(0.1234, 1)).toBe('12.3%');
    expect(fmtPctRaw(12.34, 1)).toBe('12.3%');
  });
});

