/**
 * MOIC (Multiple on Invested Capital) calculations.
 */

/**
 * Calculate MOIC: total distributions / total invested capital.
 */
export function calcMOIC(totalDistributions: number, totalInvested: number): number {
  if (totalInvested === 0) return 0;
  return totalDistributions / totalInvested;
}

/**
 * Calculate Net MOIC after fees.
 */
export function calcNetMOIC(
  totalDistributions: number,
  totalInvested: number,
  totalFees: number
): number {
  if (totalInvested === 0) return 0;
  return (totalDistributions - totalFees) / totalInvested;
}

/**
 * Calculate LP MOIC from waterfall results.
 */
export function calcLPMOIC(lpDistributions: number, lpCapital: number): number {
  if (lpCapital === 0) return 0;
  return lpDistributions / lpCapital;
}

/**
 * Calculate GP MOIC (on co-invest only).
 */
export function calcGPCoinvestMOIC(
  gpCoinvestReturn: number,
  gpCoinvest: number
): number {
  if (gpCoinvest === 0) return 0;
  return gpCoinvestReturn / gpCoinvest;
}
