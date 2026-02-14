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
 * Find the closest FRED index value for a given date.
 * FRED data is monthly, so we find the nearest month.
 */
function findClosestIndex(data: FREDDataPoint[], targetDate: string): FREDDataPoint | null {
  if (data.length === 0) return null;

  const target = new Date(targetDate).getTime();
  let closest = data[0];
  let minDiff = Math.abs(new Date(data[0].date).getTime() - target);

  for (const point of data) {
    const diff = Math.abs(new Date(point.date).getTime() - target);
    if (diff < minDiff) {
      minDiff = diff;
      closest = point;
    }
  }

  return closest;
}

/**
 * Calculate mark-to-market for a single unit.
 */
export function markUnit(
  unit: MarkToMarketUnit,
  fredData: FREDDataPoint[],
  currentDate: string
): ValuationMark | null {
  const purchaseIndex = findClosestIndex(fredData, unit.purchaseDate);
  const currentIndex = findClosestIndex(fredData, currentDate);

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

  for (const unit of units) {
    const mark = markUnit(unit, fredData, currentDate);
    if (mark) {
      unitMarks.push(mark);
      totalCostBasis += mark.purchasePrice;
      totalCurrentMark += mark.currentMark;
    }
  }

  const currentIndex = findClosestIndex(fredData, currentDate);

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
