import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area, BarChart, Bar } from 'recharts';
import api from '../lib/api';
import { fmtCurrency, fmtCurrencyCompact, fmtNumber } from '../lib/format';

interface FREDPoint {
  date: string;
  value: number;
}

interface ValuationMark {
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

interface PortfolioValuation {
  totalCostBasis: number;
  totalCurrentMark: number;
  totalUnrealizedGain: number;
  unrealizedGainPct: number;
  markDate: string;
  indexValue: number;
  unitMarks: ValuationMark[];
}

const fmt = fmtCurrency;
const fmtCompact = fmtCurrencyCompact;
const num = fmtNumber;

export default function MarketData() {
  const queryClient = useQueryClient();

  const { data: fredData = [] } = useQuery<FREDPoint[]>({
    queryKey: ['fred'],
    queryFn: () => api.get('/market/fred').then((r) => r.data),
  });

  const { data: valuation } = useQuery<PortfolioValuation>({
    queryKey: ['valuation'],
    queryFn: () => api.get('/market/valuation').then((r) => r.data),
  });

  const refreshFred = useMutation({
    mutationFn: () => api.post('/market/fred/refresh'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fred'] }),
  });

  const chartData = fredData.map((d) => ({
    date: d.date.substring(0, 7),
    value: d.value,
  }));

  // Per-unit gain/loss bar chart data
  const unitChartData = (valuation?.unitMarks ?? []).map((u) => ({
    unit: u.unitNumber,
    gain: u.currentMark - u.purchasePrice,
    changePct: u.changePct,
  }));

  return (
    <div>
      <div className="page-header flex-between">
        <div>
          <h2>Market Data</h2>
          <p>S&P/Case-Shiller Miami Home Price Index and portfolio valuation</p>
        </div>
        <button className="btn btn-primary" onClick={() => refreshFred.mutate()} disabled={refreshFred.isPending}>
          {refreshFred.isPending ? 'Refreshing...' : 'Refresh FRED Data'}
        </button>
      </div>

      {/* Valuation Summary */}
      {valuation && (
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-label">Cost Basis</div>
            <div className="metric-value">{fmt(valuation.totalCostBasis)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Market Value</div>
            <div className="metric-value teal">{fmt(valuation.totalCurrentMark)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Unrealized Gain/Loss</div>
            <div className={`metric-value ${valuation.totalUnrealizedGain >= 0 ? 'green' : 'red'}`}>
              {fmt(valuation.totalUnrealizedGain)}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Change %</div>
            <div className={`metric-value ${valuation.unrealizedGainPct >= 0 ? 'green' : 'red'}`}>
              {(valuation.unrealizedGainPct * 100).toFixed(1)}%
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Index Value</div>
            <div className="metric-value">{valuation.indexValue.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Mark Date</div>
            <div className="metric-value" style={{ fontSize: '1.2rem' }}>{valuation.markDate}</div>
          </div>
        </div>
      )}

      {/* FRED Chart */}
      <div className="card mb-4">
        <div className="card-header">
          <span className="card-title">Case-Shiller Miami Home Price Index (MIXRNSA)</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{num(fredData.length)} data points</span>
        </div>
        {chartData.length > 0 ? (
          <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="fredGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--teal)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--teal)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                  interval={Math.floor(chartData.length / 8)}
                />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <Tooltip
                  formatter={(v: number) => [v.toFixed(2), 'Index']}
                  labelFormatter={(l: string) => `Date: ${l}`}
                  contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }}
                />
                <Area type="monotone" dataKey="value" stroke="var(--teal)" strokeWidth={2} fill="url(#fredGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            No FRED data loaded. Click "Refresh FRED Data" to pull the latest index values.
            <br />
            <span style={{ fontSize: '0.8rem' }}>Requires FRED_API_KEY in .env</span>
          </div>
        )}
      </div>

      {/* Per-Unit Gain/Loss Bar Chart */}
      {unitChartData.length > 0 && (
        <div className="card mb-4">
          <div className="card-header">
            <span className="card-title">Per-Unit Unrealized Gain/Loss</span>
          </div>
          <div style={{ width: '100%', height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={unitChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="unit" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickFormatter={(v) => fmtCompact(v)} />
                <Tooltip
                  formatter={(v: number) => [fmt(v), 'Gain/Loss']}
                  contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }}
                />
                <Bar dataKey="gain" fill="var(--teal)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Per-Unit Valuation Table */}
      {valuation && valuation.unitMarks.length > 0 && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Per-Unit Mark-to-Market</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Purchase Price</th>
                <th>Current Mark</th>
                <th>Gain/Loss</th>
                <th>Change %</th>
              </tr>
            </thead>
            <tbody>
              {valuation.unitMarks.map((u) => {
                const gainLoss = u.currentMark - u.purchasePrice;
                return (
                  <tr key={u.unitId}>
                    <td style={{ fontWeight: 600 }}>{u.unitNumber}</td>
                    <td>{fmt(u.purchasePrice)}</td>
                    <td>{fmt(u.currentMark)}</td>
                    <td style={{ color: gainLoss >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                      {fmt(gainLoss)}
                    </td>
                    <td style={{ color: u.changePct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {(u.changePct * 100).toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
