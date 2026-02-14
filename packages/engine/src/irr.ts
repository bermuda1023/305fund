/**
 * IRR (Internal Rate of Return) solver.
 * Implements XIRR — handles irregular cash flow dates.
 * Uses Newton-Raphson with bisection fallback.
 */

export interface CashFlowEntry {
  date: Date;
  amount: number; // Negative = outflow, Positive = inflow
}

/**
 * Calculate the number of years between two dates (fractional).
 */
function yearFrac(d1: Date, d2: Date): number {
  return (d2.getTime() - d1.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

/**
 * Net Present Value at a given rate for irregular cash flows.
 */
export function xnpv(rate: number, cashFlows: CashFlowEntry[]): number {
  if (cashFlows.length === 0) return 0;
  const d0 = cashFlows[0].date;
  let npv = 0;
  for (const cf of cashFlows) {
    const t = yearFrac(d0, cf.date);
    npv += cf.amount / Math.pow(1 + rate, t);
  }
  return npv;
}

/**
 * Derivative of XNPV with respect to rate.
 */
function xnpvDerivative(rate: number, cashFlows: CashFlowEntry[]): number {
  if (cashFlows.length === 0) return 0;
  const d0 = cashFlows[0].date;
  let deriv = 0;
  for (const cf of cashFlows) {
    const t = yearFrac(d0, cf.date);
    if (t === 0) continue;
    deriv -= t * cf.amount / Math.pow(1 + rate, t + 1);
  }
  return deriv;
}

/**
 * XIRR — Internal Rate of Return for irregular cash flows.
 * Equivalent to Excel's XIRR function.
 *
 * @param cashFlows Array of { date, amount } where negatives are investments
 * @param guess Initial guess for IRR (default 0.1 = 10%)
 * @param maxIterations Maximum Newton-Raphson iterations
 * @param tolerance Convergence tolerance
 * @returns Annualized IRR as a decimal (e.g., 0.2423 = 24.23%)
 */
export function xirr(
  cashFlows: CashFlowEntry[],
  guess: number = 0.1,
  maxIterations: number = 1000,
  tolerance: number = 1e-10
): number {
  if (cashFlows.length < 2) {
    throw new Error('Need at least 2 cash flows to compute IRR');
  }

  // Verify there are both positive and negative cash flows
  const hasNeg = cashFlows.some(cf => cf.amount < 0);
  const hasPos = cashFlows.some(cf => cf.amount > 0);
  if (!hasNeg || !hasPos) {
    throw new Error('Cash flows must contain both investments (negative) and returns (positive)');
  }

  // Sort by date
  const sorted = [...cashFlows].sort((a, b) => a.date.getTime() - b.date.getTime());

  // Try Newton-Raphson first
  let rate = guess;
  for (let i = 0; i < maxIterations; i++) {
    const npv = xnpv(rate, sorted);
    if (Math.abs(npv) < tolerance) return rate;

    const deriv = xnpvDerivative(rate, sorted);
    if (Math.abs(deriv) < 1e-14) break; // Derivative too small, switch to bisection

    const newRate = rate - npv / deriv;

    // Guard against divergence
    if (newRate < -0.99) break;
    if (Math.abs(newRate - rate) < tolerance) return newRate;
    rate = newRate;
  }

  // Fallback: Bisection method
  return bisectionXIRR(sorted, tolerance, maxIterations);
}

/**
 * Bisection method fallback for XIRR.
 */
function bisectionXIRR(
  cashFlows: CashFlowEntry[],
  tolerance: number,
  maxIterations: number
): number {
  let low = -0.99;
  let high = 10.0; // 1000% IRR max

  // Ensure signs differ at bounds
  let npvLow = xnpv(low, cashFlows);
  let npvHigh = xnpv(high, cashFlows);

  // Expand bounds if needed
  while (npvLow * npvHigh > 0 && high < 1000) {
    high *= 2;
    npvHigh = xnpv(high, cashFlows);
  }

  if (npvLow * npvHigh > 0) {
    throw new Error('Could not find IRR within bounds');
  }

  for (let i = 0; i < maxIterations; i++) {
    const mid = (low + high) / 2;
    const npvMid = xnpv(mid, cashFlows);

    if (Math.abs(npvMid) < tolerance || (high - low) / 2 < tolerance) {
      return mid;
    }

    if (npvMid * npvLow < 0) {
      high = mid;
      npvHigh = npvMid;
    } else {
      low = mid;
      npvLow = npvMid;
    }
  }

  return (low + high) / 2;
}

/**
 * Simple IRR for evenly-spaced periodic cash flows.
 * Uses Newton-Raphson on the standard NPV formula.
 */
export function irr(
  cashFlows: number[],
  guess: number = 0.1,
  maxIterations: number = 1000,
  tolerance: number = 1e-10
): number {
  if (cashFlows.length < 2) {
    throw new Error('Need at least 2 cash flows');
  }

  let rate = guess;
  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let deriv = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      const pv = cashFlows[t] / Math.pow(1 + rate, t);
      npv += pv;
      if (t > 0) {
        deriv -= t * cashFlows[t] / Math.pow(1 + rate, t + 1);
      }
    }

    if (Math.abs(npv) < tolerance) return rate;
    if (Math.abs(deriv) < 1e-14) break;

    const newRate = rate - npv / deriv;
    if (newRate < -0.99) break;
    if (Math.abs(newRate - rate) < tolerance) return newRate;
    rate = newRate;
  }

  throw new Error('IRR did not converge');
}
