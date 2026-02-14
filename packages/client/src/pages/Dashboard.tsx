import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import api from '../lib/api';
import { fmtCurrency, fmtCurrencyCompact, fmtPctRaw, fmtNumber } from '../lib/format';

/* ── Backend interfaces (camelCase) ─────────────────────────── */

interface PortfolioSummary {
  totalUnitsOwned: number;
  totalOwnershipPct: number;
  totalInvested: number;
  totalMonthlyRent: number;
  totalMonthlyHOA: number;
  totalMonthlyNOI: number;
  annualizedYield: number;
  totalSqft: number;
  avgPricePSF: number;
  totalRenovationSpend: number;
  unitsWithActiveTenants: number;
  unitsVacant: number;
}

interface ContractsProgress {
  totalUnits: number;
  signedConsensus: number;
  signedListing: number;
  unsigned: number;
  unknown: number;
  consensusPct: number;
  listingPct: number;
  neededFor80Pct: number;
  remainingToReach80: number;
  fundOwnedUnits: number;
  fundOwnershipPct: number;
}

interface PortfolioUnit {
  id: number;
  unit_number: string;
  tenant_name: string | null;
  tenant_status: string | null;
  lease_end?: string;
}

interface ActualsTransaction {
  id: number;
  date: string;
  amount: number;
  description: string;
  category: string;
  reconciled: number;
}

interface CapitalCall {
  id: number;
  call_number: number;
  total_amount: number;
  call_date: string;
  due_date: string;
  purpose: string;
  status: string;
  received_count: number;
  total_items: number;
}

/* ── Helpers ─────────────────────────────────────────────────── */

type Period = 'M' | 'Q' | 'Y';

const PIE_COLORS = ['var(--green)', 'var(--red)', 'var(--text-muted)'];

const fmt = fmtCurrency;
const fmtCompact = fmtCurrencyCompact;
const pct = (n: number) => fmtPctRaw(n, 1);
const num = fmtNumber;

/* ── Component ───────────────────────────────────────────────── */

export default function Dashboard() {
  const [period, setPeriod] = useState<Period>('M');

  const { data: summary } = useQuery<PortfolioSummary>({
    queryKey: ['portfolio-summary'],
    queryFn: () => api.get('/portfolio/summary').then((r) => r.data),
  });

  const { data: progress } = useQuery<ContractsProgress>({
    queryKey: ['contracts-progress'],
    queryFn: () => api.get('/contracts/progress').then((r) => r.data),
  });

  const { data: portfolioUnits } = useQuery<PortfolioUnit[]>({
    queryKey: ['portfolio-units'],
    queryFn: () => api.get('/portfolio').then((r) => r.data),
  });

  const { data: unreconciledTxns } = useQuery<ActualsTransaction[]>({
    queryKey: ['unreconciled-transactions'],
    queryFn: () => api.get('/actuals/transactions?reconciled=false&limit=10').then((r) => r.data),
  });

  const { data: capitalCalls } = useQuery<CapitalCall[]>({
    queryKey: ['capital-calls-all'],
    queryFn: () => api.get('/lp/capital-calls/all').then((r) => r.data),
  });

  /* Upcoming lease expirations (within 90 days) */
  const now = new Date();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  const expiringLeases = (portfolioUnits ?? [])
    .filter((u) => {
      if (!u.tenant_name || !u.lease_end) return false;
      const end = new Date(u.lease_end);
      const diff = end.getTime() - now.getTime();
      return diff >= 0 && diff <= ninetyDaysMs;
    })
    .map((u) => {
      const daysRemaining = Math.ceil((new Date(u.lease_end!).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      return { ...u, daysRemaining };
    })
    .sort((a, b) => a.daysRemaining - b.daysRemaining);

  /* Active/pending capital calls */
  const activeCalls = (capitalCalls ?? []).filter((c) =>
    ['draft', 'active', 'pending', 'sent', 'partially_received'].includes(c.status)
  );

  /* Pie data for consensus vote breakdown */
  const pieData = progress
    ? [
        { name: 'Signed', value: progress.signedConsensus },
        { name: 'Unsigned', value: progress.unsigned },
        { name: 'Unknown', value: progress.unknown },
      ]
    : [];

  /* Area chart data for monthly cash-flow */
  const incomeData = summary
    ? [
        { name: 'Rent', value: summary.totalMonthlyRent },
        { name: 'HOA', value: -summary.totalMonthlyHOA },
        { name: 'NOI', value: summary.totalMonthlyNOI },
      ]
    : [];

  /* Area chart data for investment breakdown */
  const investmentData = summary
    ? [
        { name: 'Acquisition', value: summary.totalInvested - summary.totalRenovationSpend },
        { name: 'Renovation', value: summary.totalRenovationSpend },
        { name: 'Total', value: summary.totalInvested },
      ]
    : [];

  return (
    <div>
      {/* Header with period toggle */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>Dashboard</h2>
          <p>Fund overview and key performance indicators</p>
        </div>
        <div style={{ display: 'flex', gap: '0.25rem', background: 'var(--bg-tertiary)', borderRadius: 8, padding: '0.25rem' }}>
          {(['M', 'Q', 'Y'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                padding: '0.35rem 0.85rem',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.75rem',
                fontWeight: 600,
                letterSpacing: '0.03em',
                background: period === p ? 'var(--teal)' : 'transparent',
                color: period === p ? '#fff' : 'var(--text-muted)',
                transition: 'all 0.15s ease',
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Metrics */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Units Owned</div>
          <div className="metric-value teal">{num(summary?.totalUnitsOwned ?? 0)}</div>
          <div className="metric-note">
            {num(summary?.unitsWithActiveTenants ?? 0)} leased &middot; {num(summary?.unitsVacant ?? 0)} vacant
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Fund Ownership</div>
          <div className="metric-value teal">{pct(summary?.totalOwnershipPct ?? 0)}</div>
          <div className="metric-note">80% needed for termination</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Invested</div>
          <div className="metric-value">{fmt(summary?.totalInvested ?? 0)}</div>
          <div className="metric-note">
            {fmt(summary?.avgPricePSF ?? 0)}/sqft &middot; {(summary?.totalSqft ?? 0).toLocaleString()} sqft
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Monthly NOI</div>
          <div className="metric-value green">{fmt(summary?.totalMonthlyNOI ?? 0)}</div>
          <div className="metric-note">
            Rent {fmt(summary?.totalMonthlyRent ?? 0)} | HOA {fmt(summary?.totalMonthlyHOA ?? 0)}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Annualized Yield</div>
          <div className="metric-value accent">{pct(summary?.annualizedYield ?? 0)}</div>
          <div className="metric-note">Based on current NOI</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Renovation Spend</div>
          <div className="metric-value">{fmt(summary?.totalRenovationSpend ?? 0)}</div>
          <div className="metric-note">Across {num(summary?.totalUnitsOwned ?? 0)} units</div>
        </div>
      </div>

      <div className="grid-2">
        {/* Consensus Progress Pie */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Consensus Progress</span>
            <span className="badge badge-blue">{pct(progress?.consensusPct ?? 0)}</span>
          </div>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  dataKey="value"
                  strokeWidth={0}
                  label={({ name, value }: { name: string; value: number }) => `${name}: ${value}`}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text-primary)',
                    fontSize: '0.8rem',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            {num(progress?.signedConsensus ?? 0)} signed &middot; {num(progress?.unsigned ?? 0)} unsigned &middot; {num(progress?.unknown ?? 0)} unknown
          </div>
          <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
            Listing: {pct(progress?.listingPct ?? 0)} &middot; Need {num(progress?.remainingToReach80 ?? 0)} more for 80%
          </div>
        </div>

        {/* Monthly Cash Flow Area Chart */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Monthly Cash Flow</span>
            <span className="badge badge-green">{period === 'M' ? 'Monthly' : period === 'Q' ? 'Quarterly' : 'Yearly'}</span>
          </div>
          <div style={{ width: '100%', height: 250 }}>
            <ResponsiveContainer>
              <AreaChart data={incomeData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradTeal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--teal)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--teal)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gradRed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--red)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--red)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                <YAxis tickFormatter={(v: number) => fmtCompact(v, '')} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                <Tooltip
                  formatter={(v: number) => fmt(v)}
                  contentStyle={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text-primary)',
                    fontSize: '0.8rem',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="var(--teal)"
                  strokeWidth={2}
                  fill="url(#gradTeal)"
                  dot={{ fill: 'var(--teal)', strokeWidth: 0, r: 4 }}
                  activeDot={{ r: 6, fill: 'var(--teal)', stroke: 'var(--bg-primary)', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Second row of charts */}
      <div className="grid-2" style={{ marginTop: '1.5rem' }}>
        {/* Investment Breakdown Area Chart */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Investment Breakdown</span>
          </div>
          <div style={{ width: '100%', height: 250 }}>
            <ResponsiveContainer>
              <AreaChart data={investmentData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradAccent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent-light)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--accent-light)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                <YAxis tickFormatter={(v: number) => fmtCompact(v, '')} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                <Tooltip
                  formatter={(v: number) => fmt(v)}
                  contentStyle={{
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text-primary)',
                    fontSize: '0.8rem',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="var(--accent-light)"
                  strokeWidth={2}
                  fill="url(#gradAccent)"
                  dot={{ fill: 'var(--accent-light)', strokeWidth: 0, r: 4 }}
                  activeDot={{ r: 6, fill: 'var(--accent-light)', stroke: 'var(--bg-primary)', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Occupancy Summary */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Occupancy & Contracts</span>
          </div>
          <div style={{ padding: '1rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Occupancy bar */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.4rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Occupancy</span>
                <span style={{ color: 'var(--green)', fontWeight: 600 }}>
                  {summary ? Math.round((summary.unitsWithActiveTenants / (summary.totalUnitsOwned || 1)) * 100) : 0}%
                </span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    borderRadius: 4,
                    width: summary ? `${(summary.unitsWithActiveTenants / (summary.totalUnitsOwned || 1)) * 100}%` : '0%',
                    background: 'linear-gradient(90deg, var(--green), var(--teal))',
                    transition: 'width 0.6s ease',
                  }}
                />
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                {num(summary?.unitsWithActiveTenants ?? 0)} leased of {num(summary?.totalUnitsOwned ?? 0)} owned
              </div>
            </div>

            {/* Consensus progress bar */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.4rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Consensus Signatures</span>
                <span style={{ color: 'var(--accent-light)', fontWeight: 600 }}>{pct(progress?.consensusPct ?? 0)}</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    borderRadius: 4,
                    width: `${progress?.consensusPct ?? 0}%`,
                    background: 'linear-gradient(90deg, var(--accent-light), var(--teal))',
                    transition: 'width 0.6s ease',
                  }}
                />
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                {num(progress?.signedConsensus ?? 0)} of {num(progress?.totalUnits ?? 0)} units &middot; Need {num(progress?.remainingToReach80 ?? 0)} more
              </div>
            </div>

            {/* Listing progress bar */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.4rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Listing Agreements</span>
                <span style={{ color: 'var(--teal)', fontWeight: 600 }}>{pct(progress?.listingPct ?? 0)}</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    borderRadius: 4,
                    width: `${progress?.listingPct ?? 0}%`,
                    background: 'linear-gradient(90deg, var(--teal), var(--green))',
                    transition: 'width 0.6s ease',
                  }}
                />
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                {num(progress?.signedListing ?? 0)} of {num(progress?.totalUnits ?? 0)} units signed
              </div>
            </div>

            {/* Fund ownership summary */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text-muted)' }}>Fund-Owned Units</span>
              <span style={{ color: 'var(--teal)', fontWeight: 600 }}>
                {num(progress?.fundOwnedUnits ?? 0)} ({pct(progress?.fundOwnershipPct ?? 0)})
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Operational Widgets Row */}
      <div
        style={{
          marginTop: '1.5rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '1.5rem',
        }}
      >
        {/* Upcoming Lease Expirations */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Upcoming Lease Expirations</span>
            {expiringLeases.length > 0 && (
              <span className="badge badge-yellow">{num(expiringLeases.length)}</span>
            )}
          </div>
          {expiringLeases.length === 0 ? (
            <div style={{ padding: '1.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No leases expiring in the next 90 days
            </div>
          ) : (
            <table className="data-table" style={{ width: '100%', fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  <th style={{ color: 'var(--text-muted)', fontWeight: 600, padding: '0.5rem 0.75rem', textAlign: 'left' }}>Unit</th>
                  <th style={{ color: 'var(--text-muted)', fontWeight: 600, padding: '0.5rem 0.75rem', textAlign: 'left' }}>Tenant</th>
                  <th style={{ color: 'var(--text-muted)', fontWeight: 600, padding: '0.5rem 0.75rem', textAlign: 'left' }}>Lease End</th>
                  <th style={{ color: 'var(--text-muted)', fontWeight: 600, padding: '0.5rem 0.75rem', textAlign: 'right' }}>Days Left</th>
                </tr>
              </thead>
              <tbody>
                {expiringLeases.map((u) => {
                  const badgeClass =
                    u.daysRemaining < 30 ? 'badge-red' : u.daysRemaining < 60 ? 'badge-yellow' : 'badge-green';
                  const color =
                    u.daysRemaining < 30 ? 'var(--red)' : u.daysRemaining < 60 ? 'var(--gold)' : 'var(--green)';
                  return (
                    <tr key={u.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-primary)' }}>{u.unit_number}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-secondary)' }}>{u.tenant_name}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-secondary)' }}>
                        {new Date(u.lease_end!).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
                        <span className={`badge ${badgeClass}`} style={{ color, fontWeight: 600 }}>
                          {num(u.daysRemaining)}d
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Unreconciled Transactions */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Unreconciled Transactions</span>
            {(unreconciledTxns ?? []).length > 0 && (
              <span className="badge badge-red">{num((unreconciledTxns ?? []).length)}</span>
            )}
          </div>
          {(unreconciledTxns ?? []).length === 0 ? (
            <div style={{ padding: '1.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              All transactions reconciled
            </div>
          ) : (
            <>
              <table className="data-table" style={{ width: '100%', fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    <th style={{ color: 'var(--text-muted)', fontWeight: 600, padding: '0.5rem 0.75rem', textAlign: 'left' }}>Date</th>
                    <th style={{ color: 'var(--text-muted)', fontWeight: 600, padding: '0.5rem 0.75rem', textAlign: 'left' }}>Description</th>
                    <th style={{ color: 'var(--text-muted)', fontWeight: 600, padding: '0.5rem 0.75rem', textAlign: 'right' }}>Amount</th>
                    <th style={{ color: 'var(--text-muted)', fontWeight: 600, padding: '0.5rem 0.75rem', textAlign: 'left' }}>Category</th>
                  </tr>
                </thead>
                <tbody>
                  {(unreconciledTxns ?? []).map((txn) => (
                    <tr key={txn.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {new Date(txn.date).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-primary)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {txn.description}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: txn.amount < 0 ? 'var(--red)' : 'var(--green)', fontWeight: 600 }}>
                        {fmt(txn.amount)}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)' }}>{txn.category}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border)', textAlign: 'right' }}>
                <span style={{ color: 'var(--teal)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                  View all in Actuals &rarr;
                </span>
              </div>
            </>
          )}
        </div>

        {/* Capital Call Status */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Capital Call Status</span>
            {activeCalls.length > 0 && (
              <span className="badge badge-blue">{num(activeCalls.length)}</span>
            )}
          </div>
          {activeCalls.length === 0 ? (
            <div style={{ padding: '1.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No pending capital calls
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.75rem 1rem' }}>
              {activeCalls.map((call) => {
                const progressPct = call.total_items > 0 ? (call.received_count / call.total_items) * 100 : 0;
                return (
                  <div key={call.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                      <span style={{ color: 'var(--text-primary)', fontSize: '0.82rem', fontWeight: 600 }}>
                        Call #{call.call_number} &mdash; {fmt(call.total_amount)} &mdash; due {new Date(call.due_date).toLocaleDateString()}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            borderRadius: 3,
                            width: `${progressPct}%`,
                            background: progressPct >= 100 ? 'var(--green)' : 'linear-gradient(90deg, var(--teal), var(--green))',
                            transition: 'width 0.4s ease',
                          }}
                        />
                      </div>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {num(call.received_count)}/{num(call.total_items)}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                      {call.purpose}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
