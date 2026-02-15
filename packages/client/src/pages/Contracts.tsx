import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import BuildingGrid from '../components/BuildingGrid';
import { fmtNumber } from '../lib/format';

/* ---------- GET /api/contracts row (snake_case from SQLite) ---------- */
interface ContractUnit {
  id: number;
  floor: number;
  unit_letter: string;
  unit_number: string;
  is_fund_owned: boolean;
  consensus_status: string;
  listing_agreement: string;
  ownership_pct: number;
  sqft: number;
  beds: number;
  unit_type_id: number;
  resident_name: string | null;
  resident_type: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
  owner_company: string | null;
  notes: string | null;
}

/* ---------- GET /api/contracts/progress (camelCase) ---------- */
interface VoteProgress {
  totalUnits: number;
  signedConsensus: number;
  signedListing: number;
  unsigned: number;
  unknown: number;
  consensusPct: number;
  listingPct: number;
  neededFor80Pct: number;
  remainingToReach80: number;
  noVotes: number;
  noVotePct: number;
  isBlocked: boolean;
  abstain: number;
  abstainPct: number;
  canPass: boolean;
  noVoteOwnershipPct: number;
  yesVoteOwnershipPct: number;
  fundOwnedUnits: number;
  fundOwnershipPct: number;
}

/* ---------- GET /api/contracts/flagged row (snake_case from SQLite) ---------- */
interface FlaggedUnit {
  unit_number: string;
  resident_name: string | null;
  resident_type: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
  consensus_status: string;
  listing_agreement: string;
  notes: string | null;
  ownership_pct: number;
}

export default function Contracts() {
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [detailForm, setDetailForm] = useState({
    residentName: '',
    residentType: '',
    ownerName: '',
    ownerEmail: '',
    ownerPhone: '',
    ownerCompany: '',
    notes: '',
  });
  const queryClient = useQueryClient();
  const num = fmtNumber;

  const { data: units = [] } = useQuery<ContractUnit[]>({
    queryKey: ['contracts'],
    queryFn: () => api.get('/contracts').then((r) => r.data),
  });

  const { data: progress } = useQuery<VoteProgress>({
    queryKey: ['contracts-progress'],
    queryFn: () => api.get('/contracts/progress').then((r) => r.data),
  });

  const { data: flagged = [] } = useQuery<FlaggedUnit[]>({
    queryKey: ['contracts-flagged'],
    queryFn: () => api.get('/contracts/flagged').then((r) => r.data),
  });

  /* PUT /api/contracts/:id expects camelCase: consensusStatus, listingAgreement */
  const updateStatus = useMutation({
    mutationFn: ({ id, field, value }: { id: number; field: string; value: string }) => {
      const camelField = field === 'consensus_status' ? 'consensusStatus'
        : field === 'listing_agreement' ? 'listingAgreement'
        : field;
      return api.put(`/contracts/${id}`, { [camelField]: value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['contracts-progress'] });
      queryClient.invalidateQueries({ queryKey: ['contracts-flagged'] });
      queryClient.invalidateQueries({ queryKey: ['listings'] });
    },
  });

  const updateUnitDetails = useMutation({
    mutationFn: (payload: {
      id: number;
      residentName?: string;
      residentType?: string;
      ownerName?: string;
      ownerEmail?: string;
      ownerPhone?: string;
      ownerCompany?: string;
      notes?: string;
    }) => {
      const { id, ...data } = payload;
      return api.put(`/contracts/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['contracts-flagged'] });
      queryClient.invalidateQueries({ queryKey: ['listings'] });
    },
  });

  const filtered = units.filter((u) => {
    if (filter === 'signed') return u.consensus_status === 'signed';
    if (filter === 'unsigned') return u.consensus_status === 'unsigned';
    if (filter === 'unknown') return u.consensus_status === 'unknown';
    if (filter === 'owned') return u.is_fund_owned;
    return true;
  }).filter((u) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      u.unit_number.toLowerCase().includes(s) ||
      (u.resident_name?.toLowerCase().includes(s) ?? false) ||
      (u.owner_name?.toLowerCase().includes(s) ?? false)
    );
  });

  const pctBar = progress?.consensusPct ?? 0;
  const selectedUnit = units.find((u) => u.id === selectedUnitId) ?? null;

  useEffect(() => {
    if (!selectedUnit) return;
    setDetailForm({
      residentName: selectedUnit.resident_name ?? '',
      residentType: selectedUnit.resident_type ?? '',
      ownerName: selectedUnit.owner_name ?? '',
      ownerEmail: selectedUnit.owner_email ?? '',
      ownerPhone: selectedUnit.owner_phone ?? '',
      ownerCompany: selectedUnit.owner_company ?? '',
      notes: selectedUnit.notes ?? '',
    });
  }, [selectedUnit]);

  return (
    <div>
      <div className="page-header">
        <h2>Contracts &amp; Consensus</h2>
        <p style={{ color: 'var(--text-muted)' }}>Track building-wide consensus and listing agreement progress</p>
      </div>

      {/* Vote Status Banner */}
      {progress?.isBlocked && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: 8,
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <span style={{ fontSize: '1.25rem' }}>&#9888;</span>
          <span style={{ color: '#ef4444', fontWeight: 600 }}>
            BLOCKED &mdash; {(progress.noVotePct).toFixed(1)}% of units voted NO (5% threshold exceeded)
          </span>
        </div>
      )}
      {progress?.canPass && (
        <div
          style={{
            background: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid rgba(34, 197, 94, 0.4)',
            borderRadius: 8,
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <span style={{ fontSize: '1.25rem' }}>&#10003;</span>
          <span style={{ color: '#22c55e', fontWeight: 600 }}>
            Vote can pass &mdash; {(progress.consensusPct).toFixed(1)}% yes, below 5% no threshold
          </span>
        </div>
      )}

      {/* Progress */}
      <div className="card mb-4">
        <div className="card-header">
          <span className="card-title">Termination Vote Progress</span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <span className="badge badge-blue">{pctBar.toFixed(1)}% of 80% needed</span>
            {progress && !progress.isBlocked && !progress.canPass && (
              <span className="badge" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-dim)' }}>
                In progress
              </span>
            )}
          </div>
        </div>

        {/* Yes-vote progress bar */}
        <div style={{ marginBottom: '0.5rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: 4 }}>
            Yes Votes: {pctBar.toFixed(1)}% (unit count) | {(progress?.yesVoteOwnershipPct ?? 0).toFixed(2)}% (ownership weighted)
          </div>
          <div style={{ background: 'var(--bg-tertiary)', borderRadius: 8, height: 32, overflow: 'hidden', position: 'relative' }}>
            <div
              style={{
                width: `${Math.min(pctBar / 80 * 100, 100)}%`,
                height: '100%',
                background: progress?.canPass ? 'var(--green)' : 'var(--teal)',
                borderRadius: 8,
                transition: 'width 0.5s',
              }}
            />
            {/* 80% threshold marker */}
            <div style={{
              position: 'absolute',
              left: '100%',
              top: 0,
              bottom: 0,
              width: 2,
              background: 'var(--accent-light)',
              opacity: 0.4,
            }} />
            <div style={{
              position: 'absolute',
              left: '100%',
              top: -16,
              fontSize: '0.6rem',
              color: 'var(--text-dim)',
              transform: 'translateX(-50%)',
            }}>80%</div>
          </div>
        </div>

        {/* No-vote danger bar */}
        <div style={{ marginBottom: '0.25rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: 4 }}>
            No Votes: {(progress?.noVotePct ?? 0).toFixed(1)}% (unit count) | {(progress?.noVoteOwnershipPct ?? 0).toFixed(2)}% (ownership weighted)
          </div>
          <div style={{ background: 'var(--bg-tertiary)', borderRadius: 8, height: 16, overflow: 'hidden', position: 'relative' }}>
            <div
              style={{
                width: `${Math.min((progress?.noVotePct ?? 0) / 5 * 100, 100)}%`,
                height: '100%',
                background: (progress?.noVotePct ?? 0) >= 5 ? '#ef4444' : '#f59e0b',
                borderRadius: 8,
                transition: 'width 0.5s',
              }}
            />
            {/* 5% block threshold marker */}
            <div style={{
              position: 'absolute',
              left: '100%',
              top: 0,
              bottom: 0,
              width: 2,
              background: '#ef4444',
              opacity: 0.5,
            }} />
            <div style={{
              position: 'absolute',
              left: '100%',
              top: -14,
              fontSize: '0.6rem',
              color: '#ef4444',
              transform: 'translateX(-50%)',
            }}>5% block</div>
          </div>
        </div>

        {/* Metric cards */}
        <div className="metrics-grid mt-2" style={{ marginBottom: 0 }}>
          <div className="metric-card">
            <div className="metric-label">Yes Votes (Consensus)</div>
            <div className="metric-value green">{num(progress?.signedConsensus ?? 0)}</div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>
              {pctBar.toFixed(1)}% units | {(progress?.yesVoteOwnershipPct ?? 0).toFixed(2)}% ownership
            </div>
          </div>
          <div className="metric-card" style={{
            borderColor: (progress?.noVotePct ?? 0) >= 5 ? 'rgba(239, 68, 68, 0.4)' : undefined,
            background: (progress?.noVotePct ?? 0) >= 5 ? 'rgba(239, 68, 68, 0.08)' : undefined,
          }}>
            <div className="metric-label">No Votes</div>
            <div className="metric-value red">{num(progress?.noVotes ?? 0)}</div>
            <div style={{ fontSize: '0.65rem', color: (progress?.noVotePct ?? 0) >= 5 ? '#ef4444' : 'var(--text-dim)' }}>
              {(progress?.noVotePct ?? 0).toFixed(1)}% units | {(progress?.noVoteOwnershipPct ?? 0).toFixed(2)}% ownership
              {(progress?.noVotePct ?? 0) >= 5 && ' -- BLOCKING'}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Abstained / No Reply</div>
            <div className="metric-value">{num(progress?.abstain ?? 0)}</div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>
              {(progress?.abstainPct ?? 0).toFixed(1)}% of units
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Signed Listing</div>
            <div className="metric-value accent">{num(progress?.signedListing ?? 0)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Needed for 80%</div>
            <div className="metric-value gold">{num(progress?.neededFor80Pct ?? 0)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Remaining to 80%</div>
            <div className="metric-value teal">{num(progress?.remainingToReach80 ?? 0)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Fund Owned Units</div>
            <div className="metric-value green">{num(progress?.fundOwnedUnits ?? 0)}</div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>
              {(progress?.fundOwnershipPct ?? 0).toFixed(2)}% ownership
            </div>
          </div>
        </div>
      </div>

      {/* Building Grid */}
      <div className="card mb-4">
        <div className="card-header">
          <span className="card-title">Building Overview</span>
        </div>
        <BuildingGrid units={units} onUnitClick={(u) => setSelectedUnitId(u.id)} />
      </div>

      {/* Owner / resident details */}
      {selectedUnit && (
        <div className="card mb-4">
          <div className="card-header">
            <span className="card-title">Unit {selectedUnit.unit_number} Owner Details</span>
            <button className="btn btn-secondary" onClick={() => setSelectedUnitId(null)}>
              Close
            </button>
          </div>
          <form
            style={{ padding: '1rem' }}
            onSubmit={(e) => {
              e.preventDefault();
              updateUnitDetails.mutate({ id: selectedUnit.id, ...detailForm });
            }}
          >
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Resident Name</label>
                <input
                  className="form-input"
                  value={detailForm.residentName}
                  onChange={(e) => setDetailForm((p) => ({ ...p, residentName: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Resident Type</label>
                <select
                  className="form-select"
                  value={detailForm.residentType}
                  onChange={(e) => setDetailForm((p) => ({ ...p, residentType: e.target.value }))}
                >
                  <option value="">Unknown</option>
                  <option value="residential">Resident</option>
                  <option value="investment">Investment</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Owner Name</label>
                <input
                  className="form-input"
                  value={detailForm.ownerName}
                  onChange={(e) => setDetailForm((p) => ({ ...p, ownerName: e.target.value }))}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Owner Email</label>
                <input
                  className="form-input"
                  type="email"
                  value={detailForm.ownerEmail}
                  onChange={(e) => setDetailForm((p) => ({ ...p, ownerEmail: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Owner Phone</label>
                <input
                  className="form-input"
                  value={detailForm.ownerPhone}
                  onChange={(e) => setDetailForm((p) => ({ ...p, ownerPhone: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Owner Company</label>
                <input
                  className="form-input"
                  value={detailForm.ownerCompany}
                  onChange={(e) => setDetailForm((p) => ({ ...p, ownerCompany: e.target.value }))}
                />
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: '0.75rem' }}>
              <label className="form-label">Notes</label>
              <textarea
                className="form-input"
                rows={3}
                value={detailForm.notes}
                onChange={(e) => setDetailForm((p) => ({ ...p, notes: e.target.value }))}
                style={{ resize: 'vertical' }}
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={updateUnitDetails.isPending}>
              {updateUnitDetails.isPending ? 'Saving...' : 'Save Owner Details'}
            </button>
          </form>
        </div>
      )}

      {/* Flagged */}
      {flagged.length > 0 && (
        <div className="card mb-4">
          <div className="card-header">
            <span className="card-title">Flagged Holdouts</span>
            <span className="badge badge-red">{num(flagged.length)} unsigned</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Resident</th>
                <th>Type</th>
                <th>Owner Contact</th>
                <th>Ownership %</th>
                <th>Consensus</th>
                <th>Listing</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {flagged.slice(0, 10).map((u, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{u.unit_number}</td>
                  <td>{u.resident_name || '—'}</td>
                  <td>
                    {u.resident_type
                      ? (u.resident_type === 'residential' ? 'Resident' : 'Investment')
                      : 'Unknown'}
                  </td>
                  <td style={{ fontSize: '0.75rem' }}>
                    <div>{u.owner_name || '—'}</div>
                    <div style={{ color: 'var(--text-dim)' }}>{u.owner_email || u.owner_phone || '—'}</div>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{u.ownership_pct?.toFixed(4)}%</td>
                  <td><span className="badge badge-red">{u.consensus_status}</span></td>
                  <td>
                    <span className={`badge badge-${u.listing_agreement === 'signed' ? 'green' : 'red'}`}>
                      {u.listing_agreement}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{u.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Full Table */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">All Units ({num(filtered.length)})</span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              className="form-input"
              style={{ width: 200 }}
              placeholder="Search unit, resident, or owner..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="form-select" style={{ width: 140 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="signed">Signed</option>
              <option value="unsigned">Unsigned</option>
              <option value="unknown">Unknown</option>
              <option value="owned">Fund Owned</option>
            </select>
          </div>
        </div>
        <div style={{ maxHeight: 500, overflow: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Floor</th>
                <th>Resident</th>
                <th>Type</th>
                <th>Owner</th>
                <th>Ownership %</th>
                <th>Consensus</th>
                <th>Listing</th>
                <th>Fund Owned</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.unit_number}</td>
                  <td>{u.floor}</td>
                  <td>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '0.15rem 0.45rem', fontSize: '0.75rem' }}
                      onClick={() => setSelectedUnitId(u.id)}
                    >
                      {u.resident_name || 'View'}
                    </button>
                  </td>
                  <td>
                    {u.resident_type
                      ? (u.resident_type === 'residential' ? 'Resident' : 'Investment')
                      : 'Unknown'}
                  </td>
                  <td style={{ fontSize: '0.75rem' }}>
                    <div>{u.owner_name || '—'}</div>
                    <div style={{ color: 'var(--text-dim)' }}>{u.owner_email || u.owner_phone || '—'}</div>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{u.ownership_pct?.toFixed(4)}%</td>
                  <td>
                    <select
                      className="form-select"
                      style={{ width: 110, padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}
                      value={u.consensus_status}
                      onChange={(e) => updateStatus.mutate({ id: u.id, field: 'consensus_status', value: e.target.value })}
                    >
                      <option value="signed">Signed</option>
                      <option value="unsigned">Unsigned</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </td>
                  <td>
                    <select
                      className="form-select"
                      style={{ width: 110, padding: '0.2rem 0.4rem', fontSize: '0.8rem' }}
                      value={u.listing_agreement}
                      onChange={(e) => updateStatus.mutate({ id: u.id, field: 'listing_agreement', value: e.target.value })}
                    >
                      <option value="signed">Signed</option>
                      <option value="unsigned">Unsigned</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </td>
                  <td>{u.is_fund_owned ? <span className="badge badge-green">Owned</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
