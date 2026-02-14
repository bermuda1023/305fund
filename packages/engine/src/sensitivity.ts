/**
 * Two-way sensitivity table generator.
 * Varies two assumptions and recalculates a target metric.
 */

import type { FundAssumptions } from '@brickell/shared';

export interface SensitivityConfig {
  rowVariable: keyof FundAssumptions;
  rowLabel: string;
  rowValues: number[];
  colVariable: keyof FundAssumptions;
  colLabel: string;
  colValues: number[];
  metricLabel: string;
}

export interface SensitivityResult {
  rowVariable: string;
  colVariable: string;
  rowValues: number[];
  colValues: number[];
  metric: string;
  data: number[][];  // data[rowIdx][colIdx]
}

/**
 * Generate a 2-way sensitivity table.
 *
 * @param baseAssumptions The base case assumptions
 * @param config Which variables to vary and their values
 * @param calculator Function that takes assumptions and returns the target metric
 */
export function generateSensitivityTable(
  baseAssumptions: FundAssumptions,
  config: SensitivityConfig,
  calculator: (assumptions: FundAssumptions) => number
): SensitivityResult {
  const data: number[][] = [];

  for (const rowVal of config.rowValues) {
    const row: number[] = [];
    for (const colVal of config.colValues) {
      const modified = {
        ...baseAssumptions,
        [config.rowVariable]: rowVal,
        [config.colVariable]: colVal,
      };
      try {
        row.push(calculator(modified));
      } catch {
        row.push(NaN);
      }
    }
    data.push(row);
  }

  return {
    rowVariable: config.rowLabel,
    colVariable: config.colLabel,
    rowValues: config.rowValues,
    colValues: config.colValues,
    metric: config.metricLabel,
    data,
  };
}

/**
 * Pre-built sensitivity configurations matching the Excel V3 model.
 */
export const SENSITIVITY_PRESETS = {
  moicVsLandGrowthAndHold: (base: FundAssumptions): SensitivityConfig => ({
    rowVariable: 'landGrowthPct',
    rowLabel: 'Land Growth %',
    rowValues: [0.02, 0.025, 0.03, 0.035, 0.04],
    colVariable: 'fundTermYears',
    colLabel: 'Hold Period (Years)',
    colValues: [6, 7, 8, 9, 10],
    metricLabel: 'Fund MOIC',
  }),

  irrVsLandGrowthAndHold: (base: FundAssumptions): SensitivityConfig => ({
    rowVariable: 'landGrowthPct',
    rowLabel: 'Land Growth %',
    rowValues: [0.02, 0.025, 0.03, 0.035, 0.04],
    colVariable: 'fundTermYears',
    colLabel: 'Hold Period (Years)',
    colValues: [6, 7, 8, 9, 10],
    metricLabel: 'Fund IRR',
  }),

  lpMoicVsLandPremiumAndVacancy: (base: FundAssumptions): SensitivityConfig => ({
    rowVariable: 'landPSF',
    rowLabel: 'Land $/PSF',
    rowValues: [1200, 1400, 1600, 1700, 1800, 2000],
    colVariable: 'vacancyPct',
    colLabel: 'Vacancy Rate',
    colValues: [0.03, 0.05, 0.07, 0.10],
    metricLabel: 'LP MOIC',
  }),
};
