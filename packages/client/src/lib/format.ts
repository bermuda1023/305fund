/**
 * Centralized number formatting utilities for the 305 opportunites fund platform.
 * All currency/percentage displays should use these functions.
 */

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

/**
 * Format as full currency with commas: $1,234,567
 * Use for table cells, metric cards, detail panels.
 */
export function fmtCurrency(n: number): string {
  return currencyFormatter.format(n);
}

/**
 * Format as compact currency: $1.2M, $450K
 * Use ONLY for chart axes and tight labels.
 */
export function fmtCurrencyCompact(n: number, prefix = '$'): string {
  if (Math.abs(n) >= 1_000_000_000) return `${prefix}${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${prefix}${(n / 1_000).toFixed(0)}K`;
  return `${prefix}${n.toFixed(0)}`;
}

/**
 * Format a decimal as percentage: 0.06 → "6.00%"
 * Takes a decimal value (e.g., 0.06 for 6%).
 */
export function fmtPct(n: number, decimals = 2): string {
  return `${(n * 100).toFixed(decimals)}%`;
}

/**
 * Format a raw percentage value: 6.0 → "6.00%"
 * Takes an already-percentage value (e.g., 6.0 for 6%).
 */
export function fmtPctRaw(n: number, decimals = 2): string {
  return `${n.toFixed(decimals)}%`;
}

/**
 * Format a plain number with commas: 1,234
 */
export function fmtNumber(n: number): string {
  return numberFormatter.format(n);
}
