import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { fmtCurrency, fmtNumber, fmtPctRaw } from '../lib/format';

interface Scenario {
  id: number;
  name: string;
  isActive: boolean;
}

type StressFormat = 'years' | 'pct' | 'bps';
type StressKey =
  | 'exitYears'
  | 'landValue'
  | 'landGrowthBps'
  | 'rentGrowthBps'
  | 'vacancyBps'
  | 'expenseOverrun'
  | 'refiRateBps';

interface StressOption {
  key: StressKey;
  label: string;
  description: string;
  format: StressFormat;
  values: number[];
}

interface StressRow {
  shock: number;
  fundIRR: number;
  fundMOIC: number;
  lpMOIC: number;
  netProfit: number;
  deltaIRR: number;
  deltaMOIC: number;
  deltaLPMOIC: number;
  deltaNetProfit: number;
}

interface OneWayTable {
  key: StressKey;
  label: string;
  description: string;
  format: StressFormat;
  rows: StressRow[];
}

interface MatrixCell {
  fundIRR: number;
  fundMOIC: number;
  lpMOIC: number;
  netProfit: number;
  deltaIRR: number;
  deltaMOIC: number;
}

interface StressResponse {
  base: {
    scenarioId: number;
    scenarioName: string;
    fundIRR: number;
    fundMOIC: number;
    lpMOIC: number;
    netProfit: number;
  };
  options: StressOption[];
  selectedKeys: StressKey[];
  oneWay: OneWayTable[];
  matrix: {
    rowKey: StressKey;
    rowLabel: string;
    rowFormat: StressFormat;
    rowValues: number[];
    colKey: StressKey;
    colLabel: string;
    colFormat: StressFormat;
    colValues: number[];
    data: MatrixCell[][];
  };
}

const fmt = fmtCurrency;
const num = fmtNumber;
const pctRaw = (n: number, d = 2) => fmtPctRaw(n, d);

function formatShock(v: number, format: StressFormat): string {
  if (format === 'years') {
    return `${v > 0 ? '+' : ''}${num(v)}y`;
  }
  if (format === 'bps') {
    return `${v > 0 ? '+' : ''}${num(v)} bps`;
  }
  return `${v > 0 ? '+' : ''}${pctRaw(v, 1)}`;
}

function cellColor(value: number, min: number, max: number): string {
  if (!Number.isFinite(value)) return 'rgba(100,116,139,0.12)';
  if (max <= min) return 'rgba(0,206,209,0.12)';
  const ratio = (value - min) / (max - min);
  if (ratio >= 0.66) return 'rgba(16,185,129,0.22)';
  if (ratio >= 0.33) return 'rgba(0,206,209,0.2)';
  return 'rgba(239,68,68,0.22)';
}

export default function Sensitivity() {
  const { data: scenarios = [] } = useQuery<Scenario[]>({
    queryKey: ['scenarios'],
    queryFn: () => api.get('/model/scenarios').then((r) => r.data),
  });

  const defaultScenarioId = scenarios.find((s) => s.isActive)?.id ?? scenarios[0]?.id ?? 1;
  const [scenarioId, setScenarioId] = useState<number>(1);
  const [enabledKeys, setEnabledKeys] = useState<StressKey[]>(['exitYears', 'landValue', 'vacancyBps', 'expenseOverrun']);
  const [rowKey, setRowKey] = useState<StressKey>('exitYears');
  const [colKey, setColKey] = useState<StressKey>('landValue');
  const [matrixMetric, setMatrixMetric] = useState<'fundIRR' | 'fundMOIC' | 'lpMOIC' | 'netProfit'>('fundIRR');

  const effectiveScenarioId = scenarioId > 0 ? scenarioId : defaultScenarioId;

  const runStress = useMutation({
    mutationFn: () =>
      api.post('/model/sensitivity-stress', {
        scenarioId: effectiveScenarioId,
        enabledKeys,
        rowKey,
        colKey,
      }).then((r) => r.data as StressResponse),
  });

  const stress = runStress.data;

  const rankingRows = useMemo(() => {
    if (!stress) return [];
    const rows: Array<{
      stress: string;
      shock: string;
      fundIRR: number;
      fundMOIC: number;
      lpMOIC: number;
      netProfit: number;
      score: number;
    }> = [];
    for (const t of stress.oneWay) {
      for (const r of t.rows) {
        const score = (r.deltaIRR * 100) + (r.deltaMOIC * 40);
        rows.push({
          stress: t.label,
          shock: formatShock(r.shock, t.format),
          fundIRR: r.fundIRR,
          fundMOIC: r.fundMOIC,
          lpMOIC: r.lpMOIC,
          netProfit: r.netProfit,
          score,
        });
      }
    }
    return rows.sort((a, b) => a.score - b.score);
  }, [stress]);

  const matrixExtents = useMemo(() => {
    if (!stress) return { min: 0, max: 0 };
    const values: number[] = [];
    for (const row of stress.matrix.data) {
      for (const c of row) {
        values.push(c[matrixMetric]);
      }
    }
    return {
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }, [stress, matrixMetric]);

  const options = stress?.options ?? [];

  return (
    <div>
      <div className="page-header">
        <h2>Sensitivity Analysis</h2>
        <p>Stress test fund returns across exit timing, land value, growth, vacancy, rates, and expense overruns.</p>
      </div>

      <div className="card mb-4">
        <div className="card-header">
          <span className="card-title">Stress Controls</span>
          <button className="btn btn-primary" onClick={() => runStress.mutate()} disabled={runStress.isPending || scenarios.length === 0}>
            {runStress.isPending ? 'Running...' : 'Run Stress Test'}
          </button>
        </div>

        <div style={{ padding: '1rem' }}>
          <div className="form-row">
            <div style={{ flex: 1 }}>
              <label className="form-label">Scenario</label>
              <select
                className="form-select"
                value={effectiveScenarioId}
                onChange={(e) => setScenarioId(Number(e.target.value))}
              >
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="form-label">Matrix Row Variable</label>
              <select className="form-select" value={rowKey} onChange={(e) => setRowKey(e.target.value as StressKey)}>
                {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="form-label">Matrix Column Variable</label>
              <select className="form-select" value={colKey} onChange={(e) => setColKey(e.target.value as StressKey)}>
                {options.filter((o) => o.key !== rowKey).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginTop: '0.8rem' }}>
            <label className="form-label">Enable Stress Dimensions</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(280px, 1fr))', gap: '0.5rem', marginTop: '0.4rem' }}>
              {options.map((o) => {
                const enabled = enabledKeys.includes(o.key);
                return (
                  <label key={o.key} style={{ display: 'flex', gap: '0.45rem', alignItems: 'flex-start', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setEnabledKeys((prev) => prev.includes(o.key) ? prev : [...prev, o.key]);
                        } else {
                          setEnabledKeys((prev) => prev.filter((k) => k !== o.key));
                        }
                      }}
                    />
                    <span>
                      <strong>{o.label}</strong>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{o.description}</div>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {stress && (
        <>
          <div className="metrics-grid mb-4">
            <div className="metric-card">
              <div className="metric-label">Base Scenario</div>
              <div className="metric-value">{stress.base.scenarioName}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Base Fund IRR</div>
              <div className="metric-value teal">{pctRaw(stress.base.fundIRR, 2)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Base Fund MOIC</div>
              <div className="metric-value teal">{stress.base.fundMOIC.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Base LP MOIC</div>
              <div className="metric-value accent">{stress.base.lpMOIC.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Base Net Profit</div>
              <div className="metric-value green">{fmt(stress.base.netProfit)}</div>
            </div>
          </div>

          <div className="card mb-4">
            <div className="card-header">
              <span className="card-title">2D Stress Matrix</span>
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                <button className={`btn ${matrixMetric === 'fundIRR' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMatrixMetric('fundIRR')}>IRR</button>
                <button className={`btn ${matrixMetric === 'fundMOIC' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMatrixMetric('fundMOIC')}>Fund MOIC</button>
                <button className={`btn ${matrixMetric === 'lpMOIC' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMatrixMetric('lpMOIC')}>LP MOIC</button>
                <button className={`btn ${matrixMetric === 'netProfit' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMatrixMetric('netProfit')}>Net Profit</button>
              </div>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{stress.matrix.rowLabel} \ {stress.matrix.colLabel}</th>
                  {stress.matrix.colValues.map((cv) => (
                    <th key={cv} style={{ textAlign: 'right' }}>{formatShock(cv, stress.matrix.colFormat)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stress.matrix.rowValues.map((rv, rIdx) => (
                  <tr key={rv}>
                    <td style={{ fontWeight: 600 }}>{formatShock(rv, stress.matrix.rowFormat)}</td>
                    {stress.matrix.data[rIdx].map((cell, cIdx) => (
                      <td
                        key={`${rv}-${cIdx}`}
                        style={{
                          textAlign: 'right',
                          background: cellColor(cell[matrixMetric], matrixExtents.min, matrixExtents.max),
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {matrixMetric === 'fundIRR' ? pctRaw(cell.fundIRR, 2)
                          : matrixMetric === 'fundMOIC' ? `${cell.fundMOIC.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`
                          : matrixMetric === 'lpMOIC' ? `${cell.lpMOIC.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`
                          : fmt(cell.netProfit)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card mb-4">
            <div className="card-header">
              <span className="card-title">Worst / Best Cases (Across Enabled Stresses)</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{num(rankingRows.length)} scenarios evaluated</span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Stress</th>
                  <th>Shock</th>
                  <th style={{ textAlign: 'right' }}>Fund IRR</th>
                  <th style={{ textAlign: 'right' }}>Fund MOIC</th>
                  <th style={{ textAlign: 'right' }}>LP MOIC</th>
                  <th style={{ textAlign: 'right' }}>Net Profit</th>
                </tr>
              </thead>
              <tbody>
                {[...rankingRows.slice(0, 5), ...rankingRows.slice(-5)].map((r, i) => (
                  <tr key={`${r.stress}-${r.shock}-${i}`}>
                    <td>{r.stress}</td>
                    <td>{r.shock}</td>
                    <td style={{ textAlign: 'right' }}>{pctRaw(r.fundIRR, 2)}</td>
                    <td style={{ textAlign: 'right' }}>{r.fundMOIC.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x</td>
                    <td style={{ textAlign: 'right' }}>{r.lpMOIC.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x</td>
                    <td style={{ textAlign: 'right' }}>{fmt(r.netProfit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {stress.oneWay.map((table) => (
            <div className="card mb-4" key={table.key}>
              <div className="card-header">
                <span className="card-title">{table.label}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{table.description}</span>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Shock</th>
                    <th style={{ textAlign: 'right' }}>Fund IRR</th>
                    <th style={{ textAlign: 'right' }}>Fund MOIC</th>
                    <th style={{ textAlign: 'right' }}>LP MOIC</th>
                    <th style={{ textAlign: 'right' }}>Net Profit</th>
                    <th style={{ textAlign: 'right' }}>&Delta; IRR</th>
                    <th style={{ textAlign: 'right' }}>&Delta; Fund MOIC</th>
                    <th style={{ textAlign: 'right' }}>&Delta; LP MOIC</th>
                    <th style={{ textAlign: 'right' }}>&Delta; Net Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r) => (
                    <tr key={r.shock}>
                      <td>{formatShock(r.shock, table.format)}</td>
                      <td style={{ textAlign: 'right' }}>{pctRaw(r.fundIRR, 2)}</td>
                      <td style={{ textAlign: 'right' }}>{r.fundMOIC.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x</td>
                      <td style={{ textAlign: 'right' }}>{r.lpMOIC.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x</td>
                      <td style={{ textAlign: 'right' }}>{fmt(r.netProfit)}</td>
                      <td style={{ textAlign: 'right', color: r.deltaIRR >= 0 ? 'var(--green)' : 'var(--red)' }}>{pctRaw(r.deltaIRR, 2)}</td>
                      <td style={{ textAlign: 'right', color: r.deltaMOIC >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {r.deltaMOIC >= 0 ? '+' : ''}{r.deltaMOIC.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x
                      </td>
                      <td style={{ textAlign: 'right', color: r.deltaLPMOIC >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {r.deltaLPMOIC >= 0 ? '+' : ''}{r.deltaLPMOIC.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x
                      </td>
                      <td style={{ textAlign: 'right', color: r.deltaNetProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {r.deltaNetProfit >= 0 ? '+' : ''}{fmt(r.deltaNetProfit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
