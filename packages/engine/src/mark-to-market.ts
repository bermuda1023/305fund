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
 * Convert an ISO date into a quarter key (e.g. 2026-Q1).
 */
function quarterKey(dateIso: string): { year: number; q: number; key: string } {
  const d = new Date(dateIso);
  const year = d.getFullYear();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return { year, q, key: `${year}-Q${q}` };
}

function quarterEndDate(year: number, q: number): string {
  // q: 1..4
  const month = q * 3; // 3, 6, 9, 12
  const d = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last day of quarter
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

type IndexPoint = { date: string; value: number };

/**
 * The user’s intended rule is “quarterly index points + straight-line interpolation between them”.
 * FRED data might be monthly, so we reduce it into quarter-end points (using the latest obs in each quarter).
 */
function toQuarterEndSeries(data: FREDDataPoint[]): IndexPoint[] {
  if (!data.length) return [];

  const byQuarter = new Map<string, { obsDate: string; value: number; year: number; q: number }>();
  for (const p of data) {
    const dateIso = String(p.date || '').slice(0, 10);
    if (!dateIso) continue;
    const { year, q, key } = quarterKey(dateIso);
    const existing = byQuarter.get(key);
    if (!existing || dateIso > existing.obsDate) {
      byQuarter.set(key, { obsDate: dateIso, value: Number(p.value), year, q });
    }
  }

  return Array.from(byQuarter.values())
    .map((v) => ({ date: quarterEndDate(v.year, v.q), value: v.value }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Linear interpolation between quarter-end points.
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
  const quarterSeries = toQuarterEndSeries(fredData);
  const purchaseIndex = interpolateIndex(quarterSeries, unit.purchaseDate);
  const currentIndex = interpolateIndex(quarterSeries, currentDate);

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

  const quarterSeries = toQuarterEndSeries(fredData);
  for (const unit of units) {
    // Compute per-unit marks off the same reduced/interpolated series.
    const purchaseIndex = interpolateIndex(quarterSeries, unit.purchaseDate);
    const currentIndex = interpolateIndex(quarterSeries, currentDate);
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

  const currentIndex = interpolateIndex(quarterSeries, currentDate);

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
