/**
 * Mark-to-market portfolio valuation using FRED index data.
 * Uses the S&P/Case-Shiller Miami Home Price Index (MIXRNSA).
 */

import type { FREDDataPoint, ValuationMark, PortfolioValuation } from '@brickell/shared';

export interface MarkToMarketUnit {
  unitId: number;
  unitNumber: string;
  purchaseDate: string;        // ISO date
  purchasePrice: number;
}

/**
 * Normalize and sort FRED points (monthly observations).
 */
type IndexPoint = { date: string; value: number };

function toMonthlySeries(data: FREDDataPoint[]): IndexPoint[] {
  if (!data.length) return [];
  const out: IndexPoint[] = [];
  for (const p of data) {
    const date = String(p.date || '').slice(0, 10);
    const value = Number(p.value);
    if (!date || !Number.isFinite(value)) continue;
    out.push({ date, value });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

/**
 * Linear interpolation between monthly observation points.
 * If the target is outside the observed range, we clamp to the nearest endpoint.
 */
function interpolateIndex(points: IndexPoint[], targetDate: string): IndexPoint | null {
  if (points.length === 0) return null;
  const t = new Date(targetDate).getTime();
  if (!Number.isFinite(t)) return null;

  const firstT = new Date(points[0].date).getTime();
  const lastT = new Date(points[points.length - 1].date).getTime();
  if (t <= firstT) return { date: targetDate, value: points[0].value };
  if (t >= lastT) return { date: targetDate, value: points[points.length - 1].value };

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const ta = new Date(a.date).getTime();
    const tb = new Date(b.date).getTime();
    if (t < ta || t > tb) continue;
    const span = tb - ta;
    const frac = span > 0 ? (t - ta) / span : 0;
    return { date: targetDate, value: a.value + frac * (b.value - a.value) };
  }

  // Shouldn't happen, but keep it safe.
  return { date: targetDate, value: points[points.length - 1].value };
}

/**
 * Calculate mark-to-market for a single unit.
 */
export function markUnit(
  unit: MarkToMarketUnit,
  fredData: FREDDataPoint[],
  currentDate: string
): ValuationMark | null {
  const series = toMonthlySeries(fredData);
  const purchaseIndex = interpolateIndex(series, unit.purchaseDate);
  const currentIndex = interpolateIndex(series, currentDate);

  if (!purchaseIndex || !currentIndex) return null;
  if (purchaseIndex.value === 0) return null;

  const changePct = (currentIndex.value - purchaseIndex.value) / purchaseIndex.value;
  const currentMark = unit.purchasePrice * (1 + changePct);

  return {
    unitId: unit.unitId,
    unitNumber: unit.unitNumber,
    purchaseDate: unit.purchaseDate,
    purchasePrice: unit.purchasePrice,
    currentMark,
    markDate: currentDate,
    changePct,
    indexAtPurchase: purchaseIndex.value,
    indexCurrent: currentIndex.value,
  };
}

/**
 * Calculate portfolio-level mark-to-market valuation.
 */
export function markPortfolio(
  units: MarkToMarketUnit[],
  fredData: FREDDataPoint[],
  currentDate: string
): PortfolioValuation {
  const unitMarks: ValuationMark[] = [];
  let totalCostBasis = 0;
  let totalCurrentMark = 0;

  const series = toMonthlySeries(fredData);
  for (const unit of units) {
    // Compute per-unit marks off the same reduced/interpolated series.
    const purchaseIndex = interpolateIndex(series, unit.purchaseDate);
    const currentIndex = interpolateIndex(series, currentDate);
    if (!purchaseIndex || !currentIndex) continue;
    if (purchaseIndex.value === 0) continue;

    const changePct = (currentIndex.value - purchaseIndex.value) / purchaseIndex.value;
    const currentMark = unit.purchasePrice * (1 + changePct);

    const mark: ValuationMark = {
      unitId: unit.unitId,
      unitNumber: unit.unitNumber,
      purchaseDate: unit.purchaseDate,
      purchasePrice: unit.purchasePrice,
      currentMark,
      markDate: currentDate,
      changePct,
      indexAtPurchase: purchaseIndex.value,
      indexCurrent: currentIndex.value,
    };
    if (mark) {
      unitMarks.push(mark);
      totalCostBasis += mark.purchasePrice;
      totalCurrentMark += mark.currentMark;
    }
  }

  const currentIndex = interpolateIndex(series, currentDate);

  return {
    totalCostBasis,
    totalCurrentMark,
    totalUnrealizedGain: totalCurrentMark - totalCostBasis,
    unrealizedGainPct: totalCostBasis > 0 ? (totalCurrentMark - totalCostBasis) / totalCostBasis : 0,
    markDate: currentDate,
    indexValue: currentIndex?.value ?? 0,
    unitMarks,
  };
}
