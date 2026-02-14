/**
 * Excess cash flow routing logic.
 * Three modes: reinvest in new units, sweep to money market, or distribute to LPs.
 */

export type ExcessCashMode = 'reinvest' | 'mm_sweep' | 'distribute';

export interface ExcessCashResult {
  mode: ExcessCashMode;
  excessAmount: number;
  reinvestAmount: number;
  mmDepositAmount: number;
  distributionAmount: number;
  unitsAcquirable: number;    // How many units could be bought
}

/**
 * Route excess cash based on the selected mode.
 *
 * @param excessCash The net cash available after all expenses
 * @param mode How to handle excess cash
 * @param avgUnitCost Average cost per unit (for reinvest mode)
 * @param maxReinvestUnits Cap on units to buy (0 = unlimited)
 */
export function routeExcessCash(
  excessCash: number,
  mode: ExcessCashMode,
  avgUnitCost: number = 500_000,
  maxReinvestUnits: number = 0
): ExcessCashResult {
  if (excessCash <= 0) {
    return {
      mode,
      excessAmount: excessCash,
      reinvestAmount: 0,
      mmDepositAmount: 0,
      distributionAmount: 0,
      unitsAcquirable: 0,
    };
  }

  switch (mode) {
    case 'reinvest': {
      const unitsAcquirable = Math.floor(excessCash / avgUnitCost);
      const cappedUnits = maxReinvestUnits > 0
        ? Math.min(unitsAcquirable, maxReinvestUnits)
        : unitsAcquirable;
      const reinvestAmount = cappedUnits * avgUnitCost;
      const leftover = excessCash - reinvestAmount;
      return {
        mode,
        excessAmount: excessCash,
        reinvestAmount,
        mmDepositAmount: leftover, // Remainder goes to MM
        distributionAmount: 0,
        unitsAcquirable: cappedUnits,
      };
    }
    case 'mm_sweep':
      return {
        mode,
        excessAmount: excessCash,
        reinvestAmount: 0,
        mmDepositAmount: excessCash,
        distributionAmount: 0,
        unitsAcquirable: 0,
      };
    case 'distribute':
      return {
        mode,
        excessAmount: excessCash,
        reinvestAmount: 0,
        mmDepositAmount: 0,
        distributionAmount: excessCash,
        unitsAcquirable: 0,
      };
  }
}

/**
 * Calculate money market income for a quarter.
 */
export function calcMMIncome(balance: number, annualRate: number): number {
  const quarterlyRate = Math.pow(1 + annualRate, 1 / 4) - 1;
  return balance * quarterlyRate;
}
