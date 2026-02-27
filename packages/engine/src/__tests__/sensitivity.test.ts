import { generateSensitivityTable, SENSITIVITY_PRESETS } from '../sensitivity';

const baseAssumptions: any = {
  landGrowthPct: 0.03,
  fundTermYears: 8,
  landPSF: 1700,
  vacancyPct: 0.05,
};

describe('Sensitivity tables', () => {
  it('generates two-way matrix and handles calculator errors', () => {
    const result = generateSensitivityTable(
      baseAssumptions,
      {
        rowVariable: 'landGrowthPct',
        rowLabel: 'Land Growth %',
        rowValues: [0.02, 0.03],
        colVariable: 'fundTermYears',
        colLabel: 'Hold',
        colValues: [7, 8, 9],
        metricLabel: 'Metric',
      },
      (a: any) => {
        if (a.fundTermYears === 9) throw new Error('force NaN cell');
        return a.landGrowthPct * a.fundTermYears;
      }
    );
    expect(result.data.length).toBe(2);
    expect(result.data[0].length).toBe(3);
    expect(Number.isNaN(result.data[0][2])).toBe(true);
  });

  it('ships expected preset dimensions', () => {
    const preset = SENSITIVITY_PRESETS.moicVsLandGrowthAndHold(baseAssumptions);
    expect(preset.rowValues.length).toBeGreaterThan(0);
    expect(preset.colValues.length).toBeGreaterThan(0);
  });
});

