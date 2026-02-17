import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { fmtCurrency, fmtNumber } from '../lib/format';
import { formatNumberInput, parseNumberInput } from '../lib/numberInput';

/* ---------- GET /api/listings row (snake_case from SQLite) ---------- */
interface Listing {
  id: number;
  unit_number: string;
  source: string;
  source_url: string | null;
  asking_price: number;
  price_psf: number;
  listed_date: string;
  status: string;
  implied_building_value: number;
  floor: number | null;
  unit_letter: string | null;
  sqft: number | null;
  ownership_pct: number | null;
  is_fund_owned: number | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
  owner_company: string | null;
}

/* ---------- GET /api/listings/:id/what-if response (nested) ---------- */
interface WhatIfResponse {
  listing: Listing;
  currentPortfolio: {
    units: number;
    ownershipPct: number;
    totalInvested: number;
  };
  whatIf: {
    units: number;
    ownershipPct: number;
    totalInvested: number;
    additionalOwnershipPct: number;
  };
  flags: string[];
}

const fmt = fmtCurrency;
const num = fmtNumber;

/* ---------- POST /api/listings/manual body (camelCase) ---------- */
const emptyForm = {
  unitNumber: '',
  source: 'manual',
  sourceUrl: '',
  askingPrice: 0,
  listedDate: new Date().toISOString().split('T')[0],
};

/* ---------- PUT /api/listings/:id body (camelCase) ---------- */
const emptyEditForm = {
  unitNumber: '',
  source: 'manual',
  sourceUrl: '',
  askingPrice: 0,
  listedDate: new Date().toISOString().split('T')[0],
  status: 'active' as string,
};

export default function Listings() {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [whatIf, setWhatIf] = useState<{ id: number; data: WhatIfResponse } | null>(null);
  const queryClient = useQueryClient();

  const { data: listings = [] } = useQuery<Listing[]>({
    queryKey: ['listings'],
    queryFn: () => api.get('/listings').then((r) => r.data),
  });

  const addListing = useMutation({
    mutationFn: (data: typeof emptyForm) => api.post('/listings/manual', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      setShowAdd(false);
      setForm(emptyForm);
    },
  });

  const updateListing = useMutation({
    mutationFn: ({ id, data }: { id: number; data: typeof emptyEditForm }) =>
      api.put(`/listings/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      setEditingId(null);
      setEditForm(emptyEditForm);
    },
  });

  const deleteListing = useMutation({
    mutationFn: (id: number) => api.delete(`/listings/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['listings'] });
    },
  });

  const startEditing = (listing: Listing) => {
    setEditingId(listing.id);
    setEditForm({
      unitNumber: listing.unit_number,
      source: listing.source,
      sourceUrl: listing.source_url ?? '',
      askingPrice: listing.asking_price,
      listedDate: listing.listed_date,
      status: listing.status,
    });
  };

  const handleDelete = (id: number) => {
    if (window.confirm('Delete this listing?')) {
      deleteListing.mutate(id);
    }
  };

  const runWhatIf = async (listing: Listing) => {
    const { data } = await api.get(`/listings/${listing.id}/what-if`);
    setWhatIf({ id: listing.id, data });
  };

  return (
    <div>
      <div className="page-header flex-between">
        <div>
          <h2>Units for Sale</h2>
          <p style={{ color: 'var(--text-muted)' }}>Units currently for sale at Brickell Town House</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(!showAdd)}>
          + Add Listing
        </button>
      </div>

      {/* Add Listing Form */}
      {showAdd && (
        <div className="card mb-4">
          <div className="card-header">
            <span className="card-title">Add Listing</span>
            <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); addListing.mutate(form); }}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Unit Number</label>
                <input
                  className="form-input"
                  value={form.unitNumber}
                  onChange={(e) => setForm({ ...form, unitNumber: e.target.value })}
                  placeholder="e.g., 6N"
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Source</label>
                <select className="form-select" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                  <option value="manual">Manual</option>
                  <option value="zillow">Zillow</option>
                  <option value="realtor">Realtor.com</option>
                  <option value="redfin">Redfin</option>
                  <option value="mls">MLS</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Asking Price</label>
                <input
                  className="form-input"
                  type="text"
                  inputMode="numeric"
                  value={formatNumberInput(form.askingPrice)}
                  onChange={(e) => setForm({ ...form, askingPrice: parseNumberInput(e.target.value) })}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Listed Date</label>
                <input
                  className="form-input"
                  type="date"
                  value={form.listedDate}
                  onChange={(e) => setForm({ ...form, listedDate: e.target.value })}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Source URL (optional)</label>
              <input
                className="form-input"
                value={form.sourceUrl}
                onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
                placeholder="https://..."
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={addListing.isPending}>
              {addListing.isPending ? 'Adding...' : 'Add Listing'}
            </button>
          </form>
        </div>
      )}

      {/* Listings Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
        {listings.map((listing) => (
          <div key={listing.id} className="card">
            {editingId === listing.id ? (
              /* ---------- Edit Mode ---------- */
              <form onSubmit={(e) => { e.preventDefault(); updateListing.mutate({ id: listing.id, data: editForm }); }}>
                <div className="card-header" style={{ marginBottom: '0.75rem' }}>
                  <span className="card-title">Edit Listing</span>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Unit Number</label>
                    <input
                      className="form-input"
                      value={editForm.unitNumber}
                      onChange={(e) => setEditForm({ ...editForm, unitNumber: e.target.value })}
                      placeholder="e.g., 6N"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Source</label>
                    <select className="form-select" value={editForm.source} onChange={(e) => setEditForm({ ...editForm, source: e.target.value })}>
                      <option value="manual">Manual</option>
                      <option value="zillow">Zillow</option>
                      <option value="realtor">Realtor.com</option>
                      <option value="redfin">Redfin</option>
                      <option value="mls">MLS</option>
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Asking Price</label>
                    <input
                      className="form-input"
                      type="text"
                      inputMode="numeric"
                      value={formatNumberInput(editForm.askingPrice)}
                      onChange={(e) => setEditForm({ ...editForm, askingPrice: parseNumberInput(e.target.value) })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Listed Date</label>
                    <input
                      className="form-input"
                      type="date"
                      value={editForm.listedDate}
                      onChange={(e) => setEditForm({ ...editForm, listedDate: e.target.value })}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Status</label>
                    <select className="form-select" value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                      <option value="active">Active</option>
                      <option value="pending">Pending</option>
                      <option value="sold">Sold</option>
                      <option value="withdrawn">Withdrawn</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Source URL (optional)</label>
                  <input
                    className="form-input"
                    value={editForm.sourceUrl}
                    onChange={(e) => setEditForm({ ...editForm, sourceUrl: e.target.value })}
                    placeholder="https://..."
                  />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                  <button className="btn btn-primary" type="submit" disabled={updateListing.isPending}>
                    {updateListing.isPending ? 'Saving...' : 'Save'}
                  </button>
                  <button className="btn btn-secondary" type="button" onClick={() => { setEditingId(null); setEditForm(emptyEditForm); }}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              /* ---------- Display Mode ---------- */
              <>
                <div className="flex-between mb-2">
                  <div>
                    <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Unit {listing.unit_number}</span>
                    {listing.floor && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                        Floor {listing.floor}
                      </span>
                    )}
                  </div>
                  <span className={`badge badge-${listing.status === 'active' ? 'green' : listing.status === 'pending' ? 'yellow' : 'gray'}`}>
                    {listing.status}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.85rem' }}>
                  <div>
                    <div className="metric-label">Asking Price</div>
                    <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{fmt(listing.asking_price)}</div>
                  </div>
                  <div>
                    <div className="metric-label">Price/sqft</div>
                    <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                      {listing.price_psf ? fmt(listing.price_psf) : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="metric-label">Size</div>
                    <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {listing.sqft ? `${num(listing.sqft)} sqft` : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="metric-label">Ownership %</div>
                    <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--accent-light)' }}>
                      {listing.ownership_pct ? `${listing.ownership_pct.toFixed(4)}%` : '—'}
                    </div>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div className="metric-label">Implied Building Value</div>
                    <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--teal)' }}>
                      {listing.implied_building_value ? fmt(listing.implied_building_value) : '—'}
                    </div>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div className="metric-label">Owner Contact</div>
                    <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {listing.owner_name || (listing.is_fund_owned ? '305 Opportunities Fund' : '—')}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {listing.owner_company ? `${listing.owner_company} · ` : ''}
                      {listing.owner_email || listing.owner_phone || 'No contact'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                  <button className="btn btn-gold" onClick={() => runWhatIf(listing)} style={{ flex: 1, justifyContent: 'center' }}>
                    What-If Analysis
                  </button>
                  <button className="btn btn-secondary" onClick={() => startEditing(listing)}>
                    Edit
                  </button>
                  <button
                    className="btn"
                    style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                    onClick={() => handleDelete(listing.id)}
                    disabled={deleteListing.isPending}
                  >
                    Delete
                  </button>
                  {listing.source_url && (
                    <a href={listing.source_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                      View
                    </a>
                  )}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>
                  {listing.source} — Listed {listing.listed_date}
                </div>

                {/* What-If Result */}
                {whatIf?.id === listing.id && (
                  <div style={{
                    marginTop: '0.75rem',
                    padding: '0.75rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius)',
                    fontSize: '0.85rem',
                    border: '1px solid var(--border)',
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--accent-light)' }}>
                      What-If: Add This Unit
                    </div>
                    <div className="form-row">
                      <div>
                        <div className="metric-label">Current Ownership</div>
                        <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                          {whatIf.data.currentPortfolio.ownershipPct.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                        </div>
                      </div>
                      <div>
                        <div className="metric-label">New Ownership</div>
                        <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>
                          {whatIf.data.whatIf.ownershipPct.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                        </div>
                      </div>
                      <div>
                        <div className="metric-label">Additional %</div>
                        <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--teal)' }}>
                          +{whatIf.data.whatIf.additionalOwnershipPct.toFixed(4)}%
                        </div>
                      </div>
                    </div>
                    <div className="form-row mt-1">
                      <div>
                        <div className="metric-label">Current Invested</div>
                        <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                          {fmt(whatIf.data.currentPortfolio.totalInvested)}
                        </div>
                      </div>
                      <div>
                        <div className="metric-label">New Total Invested</div>
                        <div style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--gold)' }}>
                          {fmt(whatIf.data.whatIf.totalInvested)}
                        </div>
                      </div>
                    </div>
                    {whatIf.data.flags.length > 0 && (
                      <div style={{ marginTop: '0.5rem' }}>
                        {whatIf.data.flags.map((flag, i) => (
                          <div key={i} style={{ fontSize: '0.75rem', color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>
                            {flag}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        {listings.length === 0 && (
          <div className="card" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            No active listings. Click &quot;Add Listing&quot; to manually add a unit for sale.
          </div>
        )}
      </div>
    </div>
  );
}
