// Market data and FRED integration types

export interface FREDDataPoint {
  date: string;
  value: number;
  seriesId: string;
}

export interface ValuationMark {
  unitId: number;
  unitNumber: string;
  purchaseDate: string;
  purchasePrice: number;
  currentMark: number;
  markDate: string;
  changePct: number;
  indexAtPurchase: number;
  indexCurrent: number;
}

export interface PortfolioValuation {
  totalCostBasis: number;
  totalCurrentMark: number;
  totalUnrealizedGain: number;
  unrealizedGainPct: number;
  markDate: string;
  indexValue: number;
  unitMarks: ValuationMark[];
}
