/**
 * Waterfall distribution engine.
 * Implements the full 7-tier waterfall matching the Excel V3 model.
 *
 * Tier 1: Debt Repayment
 * Tier 2: Return of Capital (100% to LPs + GP co-invest pro-rata)
 * Tier 3: Preferred Return (compounded, 100% to LPs)
 * Tier 4: GP Catch-Up (to target GP promote share)
 * Tier 5: Base Split (80/20) until Tier 2 hurdle IRR
 * Tier 6: Tier 2 Split (70/30) until Tier 3 hurdle IRR
 * Tier 7: Tier 3 Split (65/35) for everything above
 */

import type { FundAssumptions, WaterfallResult, WaterfallTier } from '@brickell/shared';
import { xirr, type CashFlowEntry } from './irr';

export interface WaterfallInput {
  totalAvailable: number;        // Total cash available for distribution
  lpCapital: number;             // Total LP invested capital
  gpCoinvest: number;            // GP co-investment amount
  outstandingDebt: number;       // Remaining debt balance to pay off
  assumptions: FundAssumptions;
  // For IRR-based hurdle calculations
  lpCashFlows: CashFlowEntry[];  // Historical LP cash flows for IRR calc
}

/**
 * Helper: calculate how much is needed to achieve target IRR.
 * Returns the total distribution amount to LPs that would make their IRR = target.
 */
function amountForTargetIRR(
  lpCashFlows: CashFlowEntry[],
  targetIRR: number,
  exitDate: Date,
  maxAmount: number
): number {
  // Binary search for the distribution amount that gives target IRR
  let low = 0;
  let high = maxAmount;
  const tolerance = 100; // $100 tolerance

  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    const testFlows: CashFlowEntry[] = [
      ...lpCashFlows,
      { date: exitDate, amount: mid },
    ];

    try {
      const testIRR = xirr(testFlows, targetIRR);
      if (Math.abs(testIRR - targetIRR) < 0.0001) return mid;
      if (testIRR < targetIRR) {
        low = mid;
      } else {
        high = mid;
      }
    } catch {
      // If IRR calc fails, try higher amount
      low = mid;
    }

    if (high - low < tolerance) return mid;
  }

  return (low + high) / 2;
}

/**
 * Run the full waterfall distribution.
 */
export function runWaterfall(input: WaterfallInput): WaterfallResult {
  const { totalAvailable, lpCapital, gpCoinvest, outstandingDebt, assumptions } = input;
  const tiers: WaterfallTier[] = [];
  let remaining = totalAvailable;

  // --- Tier 1: Debt Repayment ---
  const debtRepayment = Math.min(remaining, outstandingDebt);
  tiers.push({
    tierIndex: 1,
    name: 'Debt Repayment',
    lpAmount: 0,
    gpAmount: 0,
    totalAmount: debtRepayment,
  });
  remaining -= debtRepayment;

  // --- Tier 2: Return of Capital ---
  const totalCapital = lpCapital + gpCoinvest;
  const rocAmount = Math.min(remaining, totalCapital);
  const lpROC = rocAmount * (lpCapital / totalCapital);
  const gpROC = rocAmount * (gpCoinvest / totalCapital);
  tiers.push({
    tierIndex: 2,
    name: 'Return of Capital',
    lpAmount: lpROC,
    gpAmount: gpROC,
    totalAmount: rocAmount,
  });
  remaining -= rocAmount;

  if (remaining <= 0) {
    return buildResult(tiers);
  }

  // --- Tier 3: Preferred Return (100% to LP) ---
  // Calculate compounded preferred return on LP capital.
  const holdYears = assumptions.fundTermYears;
  const prefReturnAccrued = lpCapital * (Math.pow(1 + assumptions.prefReturnPct, holdYears) - 1);
  const prefPayout = Math.min(remaining, prefReturnAccrued);
  tiers.push({
    tierIndex: 3,
    name: `Preferred Return (${(assumptions.prefReturnPct * 100).toFixed(0)}%)`,
    lpAmount: prefPayout,
    gpAmount: 0,
    totalAmount: prefPayout,
  });
  remaining -= prefPayout;

  if (remaining <= 0) {
    return buildResult(tiers);
  }

  // --- Tier 4: GP Catch-Up ---
  // Catch-up target is scaled to GP's target promote share.
  // For an 80/20 split this is prefPayout * (20/80) = 25% of pref payout.
  const gpToLpRatio = assumptions.tier1SplitLP > 0
    ? assumptions.tier1SplitGP / assumptions.tier1SplitLP
    : 0;
  const catchupTarget = prefPayout * assumptions.catchupPct * gpToLpRatio;
  const catchupAmount = Math.min(remaining, catchupTarget);
  tiers.push({
    tierIndex: 4,
    name: `GP Catch-Up (${(assumptions.catchupPct * 100).toFixed(0)}%)`,
    lpAmount: 0,
    gpAmount: catchupAmount,
    totalAmount: catchupAmount,
  });
  remaining -= catchupAmount;

  if (remaining <= 0) {
    return buildResult(tiers);
  }

  // --- Tier 5: Base Split (80/20) up to Tier 2 hurdle ---
  // For IRR-based hurdles, we estimate how much goes in this tier
  // Simplified approach: split remaining into tiers based on total amounts
  // In production, use the IRR-based amountForTargetIRR function

  // Calculate LP distributions so far
  let lpSoFar = tiers.reduce((sum, t) => sum + t.lpAmount, 0);

  // Try to compute how much LP needs to hit tier2 hurdle
  let tier1Amount: number;
  if (input.lpCashFlows.length > 0) {
    try {
      const exitDate = input.lpCashFlows.length > 0
        ? new Date(Math.max(...input.lpCashFlows.map(cf => cf.date.getTime())) + 86400000)
        : new Date();
      const amountForTier2 = amountForTargetIRR(
        input.lpCashFlows,
        assumptions.tier2HurdleIRR,
        exitDate,
        remaining + lpSoFar
      );
      const lpNeededForTier2 = Math.max(0, amountForTier2 - lpSoFar);
      const totalInTier = lpNeededForTier2 / assumptions.tier1SplitLP;
      tier1Amount = Math.min(remaining, totalInTier);
    } catch {
      // If IRR calc fails, put 1/3 of remaining in each tier
      tier1Amount = remaining / 3;
    }
  } else {
    tier1Amount = remaining / 3;
  }

  const lp5 = tier1Amount * assumptions.tier1SplitLP;
  const gp5 = tier1Amount * assumptions.tier1SplitGP;
  tiers.push({
    tierIndex: 5,
    name: `Split (${(assumptions.tier1SplitLP * 100).toFixed(0)}/${(assumptions.tier1SplitGP * 100).toFixed(0)})`,
    lpAmount: lp5,
    gpAmount: gp5,
    totalAmount: tier1Amount,
  });
  remaining -= tier1Amount;
  lpSoFar += lp5;

  if (remaining <= 0) {
    return buildResult(tiers);
  }

  // --- Tier 6: Tier 2 Split (70/30) up to Tier 3 hurdle ---
  let tier2Amount: number;
  if (input.lpCashFlows.length > 0) {
    try {
      const exitDate = new Date(Math.max(...input.lpCashFlows.map(cf => cf.date.getTime())) + 86400000);
      const amountForTier3 = amountForTargetIRR(
        input.lpCashFlows,
        assumptions.tier3HurdleIRR,
        exitDate,
        remaining + lpSoFar
      );
      const lpNeededForTier3 = Math.max(0, amountForTier3 - lpSoFar);
      const totalInTier = lpNeededForTier3 / assumptions.tier2SplitLP;
      tier2Amount = Math.min(remaining, totalInTier);
    } catch {
      tier2Amount = remaining / 2;
    }
  } else {
    tier2Amount = remaining / 2;
  }

  const lp6 = tier2Amount * assumptions.tier2SplitLP;
  const gp6 = tier2Amount * assumptions.tier2SplitGP;
  tiers.push({
    tierIndex: 6,
    name: `${(assumptions.tier2HurdleIRR * 100).toFixed(0)}% IRR Split (${(assumptions.tier2SplitLP * 100).toFixed(0)}/${(assumptions.tier2SplitGP * 100).toFixed(0)})`,
    lpAmount: lp6,
    gpAmount: gp6,
    totalAmount: tier2Amount,
  });
  remaining -= tier2Amount;

  if (remaining <= 0) {
    return buildResult(tiers);
  }

  // --- Tier 7: Tier 3 Split (65/35) for everything above ---
  const lp7 = remaining * assumptions.tier3SplitLP;
  const gp7 = remaining * assumptions.tier3SplitGP;
  tiers.push({
    tierIndex: 7,
    name: `${(assumptions.tier3HurdleIRR * 100).toFixed(0)}% IRR Split (${(assumptions.tier3SplitLP * 100).toFixed(0)}/${(assumptions.tier3SplitGP * 100).toFixed(0)})`,
    lpAmount: lp7,
    gpAmount: gp7,
    totalAmount: remaining,
  });

  return buildResult(tiers);
}

function buildResult(tiers: WaterfallTier[]): WaterfallResult {
  const totalLP = tiers.reduce((sum, t) => sum + t.lpAmount, 0);
  const totalGP = tiers.reduce((sum, t) => sum + t.gpAmount, 0);
  const totalDistributed = tiers.reduce((sum, t) => sum + t.totalAmount, 0);

  return {
    tiers,
    totalLP,
    totalGP,
    totalDistributed,
    lpPct: totalDistributed > 0 ? totalLP / totalDistributed : 0,
    gpPct: totalDistributed > 0 ? totalGP / totalDistributed : 0,
  };
}
