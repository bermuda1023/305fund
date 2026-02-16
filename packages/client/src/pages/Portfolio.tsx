import { useState, useMemo, Fragment, useEffect, type CSSProperties } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import DocumentUpload from '../components/DocumentUpload';
import { fmtCurrency, fmtPctRaw, fmtNumber } from '../lib/format';
import { formatNumberInput, parseNumberInput } from '../lib/numberInput';

/* ── Interfaces ──────────────────────────────────────────────── */

interface PortfolioUnit {
  id: number;
  building_unit_id: number;
  entity_id: number | null;
  purchase_date: string;
  purchase_price: number;
  purchase_price_psf: number;
  closing_costs: number;
  transfer_tax: number;
  inspection_cost: number;
  total_acquisition_cost: number;
  monthly_rent: number;
  monthly_hoa: number;
  hoa_is_recurring?: number;
  hoa_reconcile_ref?: string | null;
  monthly_insurance: number;
  insurance_payment_month?: number;
  insurance_payment_day?: number;
  insurance_is_recurring?: number;
  insurance_reconcile_ref?: string | null;
  monthly_tax: number;
  tax_payment_month?: number;
  tax_payment_day?: number;
  tax_is_recurring?: number;
  tax_reconcile_ref?: string | null;
  floor: number;
  unit_number: string;
  unit_letter: string;
  beds: number;
  sqft: number;
  ownership_pct: number;
  entity_name: string | null;
  tenant_name: string | null;
  tenant_status: string | null;
  tenant_rent: number | null;
}

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

interface AvailableUnit {
  id: number;
  floor: number;
  unit_letter: string;
  unit_number: string;
  is_fund_owned: boolean;
  sqft: number;
  beds: number;
}

interface Entity {
  id: number;
  name: string;
  type: string;
  state_of_formation: string | null;
  unit_count: number;
}

interface Tenant {
  id: number;
  portfolio_unit_id: number;
  name: string;
  email: string | null;
  phone: string | null;
  lease_start: string | null;
  lease_end: string | null;
  monthly_rent: number;
  security_deposit: number;
  status: string;
  notes: string | null;
}

interface Communication {
  id: number;
  tenant_id: number;
  type: string;
  subject: string | null;
  body: string | null;
  status: string;
  sent_at: string | null;
  template_name: string | null;
}

interface RentReminderSettings {
  enabled: number;
  days_late_threshold: number;
  subject_template: string;
  body_template: string;
  updated_at: string | null;
}

interface RentReminderRun {
  id: number;
  run_at: string;
  checked_count: number;
  alert_count: number;
  skipped_count: number;
  notes: string | null;
}

interface Renovation {
  id: number;
  portfolio_unit_id: number;
  description: string;
  status: string;
  estimated_cost: number;
  actual_cost: number | null;
  expense_source?: string | null;
  reconcile_ref?: string | null;
  reconciled?: number;
  contractor: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
}

interface AddUnitForm {
  buildingUnitId: number;
  entityId: number | null;
  purchaseDate: string;
  purchasePrice: number;
  closingCosts: number;
  transferTax: number;
  inspectionCost: number;
  monthlyRent: number;
  monthlyInsurance: number;
  monthlyTax: number;
  insurancePaymentMonth: number;
  insurancePaymentDay: number;
  taxPaymentMonth: number;
  taxPaymentDay: number;
}

/* ── Helpers ──────────────────────────────────────────────────── */

const emptyForm: AddUnitForm = {
  buildingUnitId: 0,
  entityId: null,
  purchaseDate: new Date().toISOString().split('T')[0],
  purchasePrice: 500000,
  closingCosts: 5000,
  transferTax: 3500,
  inspectionCost: 500,
  monthlyRent: 2800,
  monthlyInsurance: 1800, // annual insurance
  monthlyTax: Math.round(500000 * 0.0141), // annual property tax
  insurancePaymentMonth: 1,
  insurancePaymentDay: 1,
  taxPaymentMonth: 1,
  taxPaymentDay: 1,
};

const fmt = fmtCurrency;
const fmtPct = (n: number) => fmtPctRaw(n, 2);
const num = fmtNumber;

type DetailTab = 'details' | 'tenants' | 'renovations' | 'documents' | 'cashflows';

/* ── Inline styles ───────────────────────────────────────────── */

const panelStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '1.25rem',
  marginBottom: '1rem',
};

const formRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: '0.75rem',
  marginBottom: '0.75rem',
};

const formGroupStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '0.5rem 0.65rem',
  color: 'var(--text-primary)',
  fontSize: '0.85rem',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = { ...inputStyle };

const tabBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '0.45rem 1rem',
  borderRadius: 6,
  border: 'none',
  cursor: 'pointer',
  fontSize: '0.78rem',
  fontWeight: 600,
  background: active ? 'var(--teal)' : 'var(--bg-tertiary)',
  color: active ? '#fff' : 'var(--text-muted)',
  transition: 'all 0.15s ease',
});

const smallBtnStyle = (variant: 'primary' | 'secondary' | 'danger' | 'success'): React.CSSProperties => {
  const colors: Record<string, string> = {
    primary: 'var(--teal)',
    secondary: 'var(--bg-tertiary)',
    danger: 'var(--red)',
    success: 'var(--green)',
  };
  return {
    padding: '0.35rem 0.75rem',
    borderRadius: 6,
    border: variant === 'secondary' ? '1px solid var(--border)' : 'none',
    cursor: 'pointer',
    fontSize: '0.75rem',
    fontWeight: 600,
    background: colors[variant],
    color: '#fff',
    transition: 'opacity 0.15s ease',
  };
};

const inlineFormStyle: React.CSSProperties = {
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '1rem',
  marginTop: '0.75rem',
};

/* ── Main Component ──────────────────────────────────────────── */

export default function Portfolio() {
  const queryClient = useQueryClient();

  /* ── Top-level state ── */
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<AddUnitForm>(emptyForm);
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('details');

  /* ── Entity quick-create ── */
  const [showNewEntity, setShowNewEntity] = useState(false);
  const [newEntity, setNewEntity] = useState({ name: '', type: 'llc', stateOfFormation: '' });

  /* ── Queries ── */
  const { data: units = [] } = useQuery<PortfolioUnit[]>({
    queryKey: ['portfolio'],
    queryFn: () => api.get('/portfolio').then((r) => r.data),
  });

  const { data: summary } = useQuery<PortfolioSummary>({
    queryKey: ['portfolio-summary'],
    queryFn: () => api.get('/portfolio/summary').then((r) => r.data),
  });

  const { data: allBuildingUnits = [] } = useQuery<AvailableUnit[]>({
    queryKey: ['contracts'],
    queryFn: () => api.get('/contracts').then((r) => r.data),
  });

  const { data: entities = [] } = useQuery<Entity[]>({
    queryKey: ['entities'],
    queryFn: () => api.get('/entities').then((r) => r.data),
  });

  const availableUnits = useMemo(
    () => allBuildingUnits.filter((u) => !u.is_fund_owned),
    [allBuildingUnits],
  );

  const selectedUnit = useMemo(
    () => units.find((u) => u.id === selectedUnitId) ?? null,
    [units, selectedUnitId],
  );

  /* ── Mutations ── */
  const addUnit = useMutation({
    mutationFn: (data: AddUnitForm) => api.post('/portfolio/units', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-summary'] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['contracts-progress'] });
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      setShowAddForm(false);
      setForm(emptyForm);
    },
  });

  const createEntity = useMutation({
    mutationFn: (data: { name: string; type: string; stateOfFormation: string }) =>
      api.post('/entities', data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['entities'] });
      setForm((prev) => ({ ...prev, entityId: res.data.id }));
      setShowNewEntity(false);
      setNewEntity({ name: '', type: 'llc', stateOfFormation: '' });
    },
  });

  /* ── Price-change handler ── */
  const handlePriceChange = (newPrice: number) => {
    setForm((prev) => ({
      ...prev,
      purchasePrice: newPrice,
      monthlyTax: Math.round(newPrice * 0.0141),
    }));
  };

  /* ── Compute monthly NOI for table ── */
  const computeNOI = (u: PortfolioUnit) =>
    u.monthly_rent - u.monthly_hoa - (u.monthly_insurance / 12) - (u.monthly_tax / 12);

  const tenantBadge = (status: string | null) => {
    if (!status) return { label: 'Vacant', color: 'var(--text-muted)' };
    if (status === 'active') return { label: 'Active', color: 'var(--green)' };
    if (status === 'month_to_month') return { label: 'M2M', color: 'var(--gold)' };
    if (status === 'expired') return { label: 'Expired', color: 'var(--red)' };
    return { label: status, color: 'var(--text-muted)' };
  };

  /* ══════════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════════ */

  return (
    <div>
      {/* ── Page header ── */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>Portfolio</h2>
          <p style={{ color: 'var(--text-muted)' }}>
            {num(summary?.totalUnitsOwned ?? units.length)} units owned &mdash;{' '}
            {fmtPct(summary?.totalOwnershipPct ?? 0)} building ownership
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? 'Cancel' : '+ Add Unit'}
        </button>
      </div>

      {/* ── Summary metrics ── */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Total Units Owned</div>
          <div className="metric-value teal">{num(summary?.totalUnitsOwned ?? 0)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Ownership %</div>
          <div className="metric-value teal">{fmtPct(summary?.totalOwnershipPct ?? 0)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Invested</div>
          <div className="metric-value">{fmt(summary?.totalInvested ?? 0)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Monthly NOI</div>
          <div className="metric-value green">{fmt(summary?.totalMonthlyNOI ?? 0)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Annualized Yield</div>
          <div className="metric-value accent">
            {((summary?.annualizedYield ?? 0) * 100).toFixed(2)}%
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Active Tenants</div>
          <div className="metric-value green">{num(summary?.unitsWithActiveTenants ?? 0)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Vacant Units</div>
          <div className="metric-value red">{num(summary?.unitsVacant ?? 0)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Effective Land Price</div>
          <div className="metric-value">
            {summary && summary.totalOwnershipPct > 0
              ? fmt(Math.round(summary.totalInvested / (summary.totalOwnershipPct / 100)))
              : '—'}
          </div>
          <div className="metric-note">Implied building value</div>
        </div>
      </div>

      {/* ── Add Unit form (collapsible) ── */}
      {showAddForm && (
        <div className="card mb-4">
          <div className="card-header">
            <span className="card-title">Add Unit to Portfolio</span>
            <button className="btn btn-secondary" onClick={() => setShowAddForm(false)}>Cancel</button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (form.buildingUnitId === 0) return;
              addUnit.mutate(form);
            }}
            style={{ padding: '1rem' }}
          >
            {/* Row 1: Unit picker + Entity picker + Purchase date */}
            <div style={formRowStyle}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Building Unit</label>
                <select
                  style={selectStyle}
                  value={form.buildingUnitId}
                  onChange={(e) => setForm((prev) => ({ ...prev, buildingUnitId: Number(e.target.value) }))}
                  required
                >
                  <option value={0}>Select unit...</option>
                  {availableUnits.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.unit_number} (Floor {u.floor}, {num(u.sqft)} sqft, {u.beds}BR)
                    </option>
                  ))}
                </select>
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Entity / LLC</label>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <select
                    style={{ ...selectStyle, flex: 1 }}
                    value={form.entityId ?? ''}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        entityId: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
                    required
                  >
                    <option value="">Select entity...</option>
                    {entities.map((ent) => (
                      <option key={ent.id} value={ent.id}>
                        {ent.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    style={smallBtnStyle('secondary')}
                    onClick={() => setShowNewEntity(!showNewEntity)}
                  >
                    + New
                  </button>
                </div>
                {showNewEntity && (
                  <div style={{ ...inlineFormStyle, marginTop: '0.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <input
                        style={{ ...inputStyle, flex: 2, minWidth: 120 }}
                        placeholder="Entity name"
                        value={newEntity.name}
                        onChange={(e) => setNewEntity({ ...newEntity, name: e.target.value })}
                      />
                      <select
                        style={{ ...selectStyle, flex: 1, minWidth: 80 }}
                        value={newEntity.type}
                        onChange={(e) => setNewEntity({ ...newEntity, type: e.target.value })}
                      >
                        <option value="llc">LLC</option>
                        <option value="lp">LP</option>
                        <option value="trust">Trust</option>
                        <option value="corp">Corp</option>
                      </select>
                      <input
                        style={{ ...inputStyle, flex: 1, minWidth: 80 }}
                        placeholder="State (e.g. FL)"
                        value={newEntity.stateOfFormation}
                        onChange={(e) => setNewEntity({ ...newEntity, stateOfFormation: e.target.value })}
                      />
                      <button
                        type="button"
                        style={smallBtnStyle('primary')}
                        onClick={() => {
                          if (!newEntity.name.trim()) return;
                          createEntity.mutate(newEntity);
                        }}
                      >
                        {createEntity.isPending ? 'Creating...' : 'Create'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Purchase Date</label>
                <input
                  style={inputStyle}
                  type="date"
                  value={form.purchaseDate}
                  onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })}
                  required
                />
              </div>
            </div>

            {/* Row 2: Purchase fields */}
            <div style={formRowStyle}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Purchase Price</label>
                <input
                  style={inputStyle}
                  type="text"
                  inputMode="numeric"
                  value={formatNumberInput(form.purchasePrice)}
                  onChange={(e) => handlePriceChange(parseNumberInput(e.target.value))}
                  required
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Closing Costs</label>
                <input
                  style={inputStyle}
                  type="text"
                  inputMode="numeric"
                  value={formatNumberInput(form.closingCosts)}
                  onChange={(e) => setForm({ ...form, closingCosts: parseNumberInput(e.target.value) })}
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Transfer Tax</label>
                <input
                  style={inputStyle}
                  type="text"
                  inputMode="numeric"
                  value={formatNumberInput(form.transferTax)}
                  onChange={(e) => setForm({ ...form, transferTax: parseNumberInput(e.target.value) })}
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Inspection Cost</label>
                <input
                  style={inputStyle}
                  type="text"
                  inputMode="numeric"
                  value={formatNumberInput(form.inspectionCost)}
                  onChange={(e) => setForm({ ...form, inspectionCost: parseNumberInput(e.target.value) })}
                />
              </div>
            </div>

            {/* Row 3: Operating and annual bill assumptions */}
            <div style={formRowStyle}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Monthly Rent</label>
                <input
                  style={inputStyle}
                  type="text"
                  inputMode="numeric"
                  value={formatNumberInput(form.monthlyRent)}
                  onChange={(e) => setForm({ ...form, monthlyRent: parseNumberInput(e.target.value) })}
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Annual Insurance (one payment)</label>
                <input
                  style={inputStyle}
                  type="text"
                  inputMode="numeric"
                  value={formatNumberInput(form.monthlyInsurance)}
                  onChange={(e) => setForm({ ...form, monthlyInsurance: parseNumberInput(e.target.value) })}
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Annual Property Tax (one payment)</label>
                <input
                  style={inputStyle}
                  type="text"
                  inputMode="numeric"
                  value={formatNumberInput(form.monthlyTax)}
                  onChange={(e) => setForm({ ...form, monthlyTax: parseNumberInput(e.target.value) })}
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Insurance Paid Month/Day</label>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  <input
                    style={inputStyle}
                    type="number"
                    min={1}
                    max={12}
                    value={form.insurancePaymentMonth}
                    onChange={(e) => setForm({ ...form, insurancePaymentMonth: Number(e.target.value) })}
                  />
                  <input
                    style={inputStyle}
                    type="number"
                    min={1}
                    max={31}
                    value={form.insurancePaymentDay}
                    onChange={(e) => setForm({ ...form, insurancePaymentDay: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Tax Paid Month/Day</label>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  <input
                    style={inputStyle}
                    type="number"
                    min={1}
                    max={12}
                    value={form.taxPaymentMonth}
                    onChange={(e) => setForm({ ...form, taxPaymentMonth: Number(e.target.value) })}
                  />
                  <input
                    style={inputStyle}
                    type="number"
                    min={1}
                    max={31}
                    value={form.taxPaymentDay}
                    onChange={(e) => setForm({ ...form, taxPaymentDay: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Monthly HOA</label>
                <div style={{ ...inputStyle, background: 'transparent', border: 'none', padding: '0.5rem 0', color: 'var(--teal)', fontWeight: 600, fontSize: '0.85rem' }}>
                  Auto-filled from building data
                </div>
              </div>
            </div>

            <button className="btn btn-primary" type="submit" disabled={addUnit.isPending || form.buildingUnitId === 0}>
              {addUnit.isPending ? 'Adding...' : 'Add Unit'}
            </button>
          </form>
        </div>
      )}

      {/* ── Units table ── */}
      <div className="card mb-4">
        <div className="card-header">
          <span className="card-title">Owned Units</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Click a row to view details
          </span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Unit #</th>
              <th>Floor</th>
              <th>Type</th>
              <th>Entity</th>
              <th>Purchase Price</th>
              <th>Monthly Rent</th>
              <th>Monthly HOA</th>
              <th>Monthly NOI</th>
              <th>Tenant Status</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => {
              const noi = computeNOI(u);
              const badge = tenantBadge(u.tenant_status);
              const isSelected = selectedUnitId === u.id;
              return (
                <tr
                  key={u.id}
                  style={{
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(0,206,209,0.08)' : undefined,
                    borderLeft: isSelected ? '3px solid var(--teal)' : '3px solid transparent',
                  }}
                  onClick={() => {
                    setSelectedUnitId(isSelected ? null : u.id);
                    setActiveTab('details');
                  }}
                >
                  <td style={{ fontWeight: 600 }}>{u.unit_number}</td>
                  <td>{u.floor}</td>
                  <td>
                    {u.beds}BR / {u.sqft.toLocaleString()} sqft
                  </td>
                  <td>{u.entity_name || <span style={{ color: 'var(--text-muted)' }}>&mdash;</span>}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{fmt(u.purchase_price)}</td>
                  <td style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{fmt(u.monthly_rent)}</td>
                  <td style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>{fmt(u.monthly_hoa)}</td>
                  <td style={{ color: noi >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'var(--font-mono)' }}>
                    {fmt(noi)}
                  </td>
                  <td>
                    <span
                      style={{
                        padding: '0.2rem 0.6rem',
                        borderRadius: 999,
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        background: `${badge.color}22`,
                        color: badge.color,
                      }}
                    >
                      {badge.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {units.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  No units yet. Click &quot;+ Add Unit&quot; to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Tabbed unit detail panel ── */}
      {selectedUnit && (
        <div className="card mb-4">
          <div className="card-header" style={{ flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span className="card-title">Unit {selectedUnit.unit_number} &mdash; Detail</span>
              <button className="btn btn-secondary" onClick={() => setSelectedUnitId(null)}>Close</button>
            </div>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              {(['details', 'tenants', 'renovations', 'cashflows', 'documents'] as DetailTab[]).map((tab) => (
                <button
                  key={tab}
                  style={tabBtnStyle(activeTab === tab)}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === 'cashflows' ? 'Cash Flows' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div style={{ padding: '1rem' }}>
            {activeTab === 'details' && (
              <DetailsTab
                unit={selectedUnit}
                entities={entities}
                onDeleted={() => setSelectedUnitId(null)}
              />
            )}
            {activeTab === 'tenants' && <TenantsTab unitId={selectedUnit.id} />}
            {activeTab === 'renovations' && <RenovationsTab unitId={selectedUnit.id} />}
            {activeTab === 'cashflows' && <CashFlowsTab unit={selectedUnit} />}
            {activeTab === 'documents' && <DocumentUpload parentType="unit" parentId={selectedUnit.id} />}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   DETAILS TAB
   ══════════════════════════════════════════════════════════════ */

function DetailsTab({ unit, entities, onDeleted }: { unit: PortfolioUnit; entities: Entity[]; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    monthlyRent: unit.monthly_rent,
    monthlyHOA: unit.monthly_hoa,
    monthlyInsurance: unit.monthly_insurance,
    monthlyTax: unit.monthly_tax,
    insurancePaymentMonth: unit.insurance_payment_month || 1,
    insurancePaymentDay: unit.insurance_payment_day || 1,
    taxPaymentMonth: unit.tax_payment_month || 1,
    taxPaymentDay: unit.tax_payment_day || 1,
    hoaIsRecurring: unit.hoa_is_recurring !== 0,
    insuranceIsRecurring: false,
    taxIsRecurring: false,
    hoaReconcileRef: unit.hoa_reconcile_ref || '',
    insuranceReconcileRef: unit.insurance_reconcile_ref || '',
    taxReconcileRef: unit.tax_reconcile_ref || '',
    entityId: unit.entity_id,
  });

  const updateUnit = useMutation({
    mutationFn: (data: typeof editForm) => api.put(`/portfolio/units/${unit.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-summary'] });
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      setEditing(false);
    },
  });

  const deleteUnit = useMutation({
    mutationFn: () => api.delete(`/portfolio/units/${unit.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-summary'] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['contracts-progress'] });
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      queryClient.invalidateQueries({ queryKey: ['entities'] });
      queryClient.invalidateQueries({ queryKey: ['lp-performance'] });
      queryClient.invalidateQueries({ queryKey: ['actuals-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['actuals-variance'] });
      onDeleted();
    },
    onError: (err: any) => {
      alert(err?.response?.data?.error || err?.message || 'Failed to delete unit');
    },
  });

  // Reset edit form when unit changes
  const resetForm = () => {
    setEditForm({
      monthlyRent: unit.monthly_rent,
      monthlyHOA: unit.monthly_hoa,
      monthlyInsurance: unit.monthly_insurance,
      monthlyTax: unit.monthly_tax,
      insurancePaymentMonth: unit.insurance_payment_month || 1,
      insurancePaymentDay: unit.insurance_payment_day || 1,
      taxPaymentMonth: unit.tax_payment_month || 1,
      taxPaymentDay: unit.tax_payment_day || 1,
      hoaIsRecurring: unit.hoa_is_recurring !== 0,
      insuranceIsRecurring: false,
      taxIsRecurring: false,
      hoaReconcileRef: unit.hoa_reconcile_ref || '',
      insuranceReconcileRef: unit.insurance_reconcile_ref || '',
      taxReconcileRef: unit.tax_reconcile_ref || '',
      entityId: unit.entity_id,
    });
  };

  return (
    <div>
      {/* Read-only acquisition details */}
      <div style={{ marginBottom: '1rem' }}>
        <h4 style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.6rem' }}>
          Acquisition Details
        </h4>
        <div style={formRowStyle}>
          <div style={formGroupStyle}>
            <span style={labelStyle}>Floor / Letter</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{unit.floor}{unit.unit_letter}</span>
          </div>
          <div style={formGroupStyle}>
            <span style={labelStyle}>Size</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{unit.sqft.toLocaleString()} sqft / {unit.beds}BR</span>
          </div>
          <div style={formGroupStyle}>
            <span style={labelStyle}>Ownership %</span>
            <span style={{ color: 'var(--accent-light)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{unit.ownership_pct?.toFixed(4)}%</span>
          </div>
          <div style={formGroupStyle}>
            <span style={labelStyle}>Purchase Date</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{unit.purchase_date || 'N/A'}</span>
          </div>
        </div>
        <div style={formRowStyle}>
          <div style={formGroupStyle}>
            <span style={labelStyle}>Purchase Price</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{fmt(unit.purchase_price)}</span>
          </div>
          <div style={formGroupStyle}>
            <span style={labelStyle}>Price / sqft</span>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{fmt(unit.purchase_price_psf)}</span>
          </div>
          <div style={formGroupStyle}>
            <span style={labelStyle}>Closing Costs</span>
            <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{fmt(unit.closing_costs)}</span>
          </div>
          <div style={formGroupStyle}>
            <span style={labelStyle}>Transfer Tax</span>
            <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{fmt(unit.transfer_tax)}</span>
          </div>
          <div style={formGroupStyle}>
            <span style={labelStyle}>Inspection Cost</span>
            <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{fmt(unit.inspection_cost)}</span>
          </div>
          <div style={formGroupStyle}>
            <span style={labelStyle}>Total Acquisition</span>
            <span style={{ color: 'var(--teal)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{fmt(unit.total_acquisition_cost)}</span>
          </div>
          <div style={formGroupStyle}>
            <span style={labelStyle}>Effective Land Price</span>
            <span style={{ color: 'var(--gold)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
              {unit.ownership_pct > 0
                ? fmt(Math.round(unit.purchase_price / (unit.ownership_pct / 100)))
                : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Editable monthly fields */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
          <h4 style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>
            Monthly / Editable
          </h4>
          {!editing && (
            <button style={smallBtnStyle('primary')} onClick={() => { resetForm(); setEditing(true); }}>
              Edit
            </button>
          )}
        </div>

        {editing ? (
          <div>
            <div style={formRowStyle}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Monthly Rent</label>
                <input
                  style={inputStyle}
                  type="text"
                  inputMode="numeric"
                  value={formatNumberInput(editForm.monthlyRent)}
                  onChange={(e) => setEditForm({ ...editForm, monthlyRent: parseNumberInput(e.target.value) })}
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Monthly HOA</label>
                <input
                  style={inputStyle}
                  type="text"
                  inputMode="numeric"
                  value={formatNumberInput(editForm.monthlyHOA)}
                  onChange={(e) => setEditForm({ ...editForm, monthlyHOA: parseNumberInput(e.target.value) })}
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Annual Insurance (one payment)</label>
                <input
                  style={inputStyle}
                  type="text"
                  inputMode="numeric"
                  value={formatNumberInput(editForm.monthlyInsurance)}
                  onChange={(e) => setEditForm({ ...editForm, monthlyInsurance: parseNumberInput(e.target.value) })}
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Annual Property Tax (one payment)</label>
                <input
                  style={inputStyle}
                  type="text"
                  inputMode="numeric"
                  value={formatNumberInput(editForm.monthlyTax)}
                  onChange={(e) => setEditForm({ ...editForm, monthlyTax: parseNumberInput(e.target.value) })}
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Insurance Paid Month/Day</label>
                <div style={{ ...inputStyle, color: 'var(--text-muted)' }}>
                  {editForm.insurancePaymentMonth}/{editForm.insurancePaymentDay} (from actual payment date)
                </div>
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Tax Paid Month/Day</label>
                <div style={{ ...inputStyle, color: 'var(--text-muted)' }}>
                  {editForm.taxPaymentMonth}/{editForm.taxPaymentDay} (from actual payment date)
                </div>
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Entity</label>
                <select
                  style={selectStyle}
                  value={editForm.entityId ?? ''}
                  onChange={(e) => setEditForm({ ...editForm, entityId: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">None</option>
                  {entities.map((ent) => (
                    <option key={ent.id} value={ent.id}>{ent.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={formRowStyle}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>HOA Recurrence</label>
                <label style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                  <input type="checkbox" checked={editForm.hoaIsRecurring} onChange={(e) => setEditForm({ ...editForm, hoaIsRecurring: e.target.checked })} /> Monthly recurring
                </label>
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Insurance Billing</label>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', paddingTop: '0.35rem' }}>Annual payment</div>
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Property Tax Billing</label>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', paddingTop: '0.35rem' }}>Annual payment</div>
              </div>
            </div>
            <div style={formRowStyle}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>HOA Reconciliation Ref</label>
                <input style={{ ...inputStyle, opacity: 0.8 }} value={editForm.hoaReconcileRef} readOnly placeholder="Auto-filled from Actuals" />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Insurance Reconciliation Ref</label>
                <input style={{ ...inputStyle, opacity: 0.8 }} value={editForm.insuranceReconcileRef} readOnly placeholder="Auto-filled from Actuals" />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Tax Reconciliation Ref</label>
                <input style={{ ...inputStyle, opacity: 0.8 }} value={editForm.taxReconcileRef} readOnly placeholder="Auto-filled from Actuals" />
              </div>
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.75rem' }}>
              Reconciliation references are managed from the Actual Expense Ledger to keep an auditable bank-trace source of truth.
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                style={smallBtnStyle('primary')}
                onClick={() => updateUnit.mutate(editForm)}
                disabled={updateUnit.isPending}
              >
                {updateUnit.isPending ? 'Saving...' : 'Save'}
              </button>
              <button style={smallBtnStyle('secondary')} onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div style={formRowStyle}>
            <div style={formGroupStyle}>
              <span style={labelStyle}>Monthly Rent</span>
              <span style={{ color: 'var(--green)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{fmt(unit.monthly_rent)}</span>
            </div>
            <div style={formGroupStyle}>
              <span style={labelStyle}>Monthly HOA</span>
              <span style={{ color: 'var(--red)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                {fmt(unit.monthly_hoa)} {unit.hoa_is_recurring !== 0 ? '(recurring)' : '(one-time)'}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Ref: {unit.hoa_reconcile_ref || '—'}</span>
            </div>
            <div style={formGroupStyle}>
              <span style={labelStyle}>Annual Insurance</span>
              <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                {fmt(unit.monthly_insurance)} (annual)
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                Paid on {unit.insurance_payment_month || 1}/{unit.insurance_payment_day || 1}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Ref: {unit.insurance_reconcile_ref || '—'}</span>
            </div>
            <div style={formGroupStyle}>
              <span style={labelStyle}>Annual Property Tax</span>
              <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                {fmt(unit.monthly_tax)} (annual)
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                Paid on {unit.tax_payment_month || 1}/{unit.tax_payment_day || 1}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Ref: {unit.tax_reconcile_ref || '—'}</span>
            </div>
            <div style={formGroupStyle}>
              <span style={labelStyle}>Entity</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{unit.entity_name || '(none)'}</span>
            </div>
          </div>
        )}
      </div>

      {/* Delete button */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '1rem' }}>
        <button
          style={smallBtnStyle('danger')}
          onClick={() => {
            if (window.confirm(`Delete unit ${unit.unit_number} from portfolio? This cannot be undone.`)) {
              deleteUnit.mutate();
            }
          }}
          disabled={deleteUnit.isPending}
        >
          {deleteUnit.isPending ? 'Deleting...' : 'Delete Unit from Portfolio'}
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TENANTS TAB
   ══════════════════════════════════════════════════════════════ */

function TenantsTab({ unitId }: { unitId: number }) {
  const queryClient = useQueryClient();
  const [showAddTenant, setShowAddTenant] = useState(false);
  const [editingTenantId, setEditingTenantId] = useState<number | null>(null);
  const [expandedCommsId, setExpandedCommsId] = useState<number | null>(null);
  const [showReminderSettings, setShowReminderSettings] = useState(false);
  const [reminderForm, setReminderForm] = useState({
    enabled: true,
    daysLateThreshold: 5,
    subjectTemplate: 'Rent Reminder: {{unit_number}} is {{days_late}} day(s) past due',
    bodyTemplate:
      'Hi {{tenant_name}},\n\nOur records show rent for {{period_label}} is still outstanding.\n\nAmount due: {{amount_due}}\nAmount received: {{amount_paid}}\nOutstanding: {{amount_outstanding}}\n\nPlease submit payment as soon as possible.\n\nThank you.',
  });

  const [tenantForm, setTenantForm] = useState({
    name: '',
    email: '',
    phone: '',
    leaseStart: '',
    leaseEnd: '',
    monthlyRent: 0,
    securityDeposit: 0,
    notes: '',
  });

  const [editTenantForm, setEditTenantForm] = useState<{
    name: string; email: string; phone: string; leaseStart: string; leaseEnd: string;
    monthlyRent: number; securityDeposit: number; status: string; notes: string;
  }>({
    name: '', email: '', phone: '', leaseStart: '', leaseEnd: '',
    monthlyRent: 0, securityDeposit: 0, status: 'active', notes: '',
  });

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['tenants', unitId],
    queryFn: () => api.get(`/portfolio/units/${unitId}/tenants`).then((r) => r.data),
  });

  const { data: reminderSettings } = useQuery<RentReminderSettings>({
    queryKey: ['rent-reminder-settings'],
    queryFn: () => api.get('/portfolio/rent-reminder-settings').then((r) => r.data),
  });

  const { data: reminderRuns = [] } = useQuery<RentReminderRun[]>({
    queryKey: ['rent-reminder-runs'],
    queryFn: () => api.get('/portfolio/rent-reminders/runs').then((r) => r.data),
  });

  useEffect(() => {
    if (!reminderSettings) return;
    setReminderForm({
      enabled: !!reminderSettings.enabled,
      daysLateThreshold: Number(reminderSettings.days_late_threshold || 0),
      subjectTemplate: reminderSettings.subject_template || '',
      bodyTemplate: reminderSettings.body_template || '',
    });
  }, [reminderSettings]);

  const addTenant = useMutation({
    mutationFn: (data: typeof tenantForm) => api.post(`/portfolio/units/${unitId}/tenants`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants', unitId] });
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-summary'] });
      setShowAddTenant(false);
      setTenantForm({ name: '', email: '', phone: '', leaseStart: '', leaseEnd: '', monthlyRent: 0, securityDeposit: 0, notes: '' });
    },
  });

  const updateTenant = useMutation({
    mutationFn: ({ id, data }: { id: number; data: typeof editTenantForm }) =>
      api.put(`/portfolio/tenants/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants', unitId] });
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      setEditingTenantId(null);
    },
  });

  const deleteTenant = useMutation({
    mutationFn: (id: number) => api.delete(`/portfolio/tenants/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants', unitId] });
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-summary'] });
    },
  });

  const saveReminderSettings = useMutation({
    mutationFn: (data: typeof reminderForm) =>
      api.put('/portfolio/rent-reminder-settings', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rent-reminder-settings'] });
    },
  });

  const runRentReminders = useMutation({
    mutationFn: () => api.post('/portfolio/rent-reminders/run'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rent-reminder-runs'] });
      queryClient.invalidateQueries({ queryKey: ['tenants', unitId] });
    },
  });

  const startEditTenant = (t: Tenant) => {
    setEditingTenantId(t.id);
    setEditTenantForm({
      name: t.name,
      email: t.email || '',
      phone: t.phone || '',
      leaseStart: t.lease_start || '',
      leaseEnd: t.lease_end || '',
      monthlyRent: t.monthly_rent,
      securityDeposit: t.security_deposit,
      status: t.status,
      notes: t.notes || '',
    });
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h4 style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>
          Tenants ({num(tenants.length)})
        </h4>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button style={smallBtnStyle('secondary')} onClick={() => setShowReminderSettings((v) => !v)}>
            {showReminderSettings ? 'Hide Rent Alerts' : 'Rent Alerts'}
          </button>
          <button style={smallBtnStyle('primary')} onClick={() => setShowAddTenant(!showAddTenant)}>
            {showAddTenant ? 'Cancel' : '+ Add Tenant'}
          </button>
        </div>
      </div>

      {showReminderSettings && (
        <div style={{ ...inlineFormStyle, marginBottom: '0.75rem' }}>
          <h5 style={{ margin: '0 0 0.6rem 0', color: 'var(--text-primary)' }}>Unpaid Rent Alerts</h5>
          <div style={formRowStyle}>
            <div style={formGroupStyle}>
              <label style={labelStyle}>Enabled</label>
              <label style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                <input
                  type="checkbox"
                  checked={reminderForm.enabled}
                  onChange={(e) => setReminderForm((p) => ({ ...p, enabled: e.target.checked }))}
                />{' '}
                Auto-send late rent reminders
              </label>
            </div>
            <div style={formGroupStyle}>
              <label style={labelStyle}>Days Late Threshold (xyz)</label>
              <input
                style={inputStyle}
                type="number"
                min={0}
                max={60}
                value={reminderForm.daysLateThreshold}
                onChange={(e) => setReminderForm((p) => ({ ...p, daysLateThreshold: Number(e.target.value) }))}
              />
            </div>
          </div>
          <div style={formGroupStyle}>
            <label style={labelStyle}>Subject Template</label>
            <input
              style={inputStyle}
              value={reminderForm.subjectTemplate}
              onChange={(e) => setReminderForm((p) => ({ ...p, subjectTemplate: e.target.value }))}
            />
          </div>
          <div style={{ ...formGroupStyle, marginTop: '0.6rem' }}>
            <label style={labelStyle}>Body Template</label>
            <textarea
              style={{ ...inputStyle, minHeight: 100, resize: 'vertical', fontFamily: 'inherit' }}
              value={reminderForm.bodyTemplate}
              onChange={(e) => setReminderForm((p) => ({ ...p, bodyTemplate: e.target.value }))}
            />
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.45rem' }}>
            Variables: {'{{tenant_name}}'}, {'{{unit_number}}'}, {'{{days_late}}'}, {'{{period_label}}'}, {'{{amount_due}}'}, {'{{amount_paid}}'}, {'{{amount_outstanding}}'}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
            <button
              style={smallBtnStyle('primary')}
              onClick={() => saveReminderSettings.mutate(reminderForm)}
              disabled={saveReminderSettings.isPending}
            >
              {saveReminderSettings.isPending ? 'Saving...' : 'Save Alert Settings'}
            </button>
            <button
              style={smallBtnStyle('success')}
              onClick={() => runRentReminders.mutate()}
              disabled={runRentReminders.isPending}
            >
              {runRentReminders.isPending ? 'Running...' : 'Run Reminder Sweep Now'}
            </button>
          </div>
          <div style={{ marginTop: '0.9rem' }}>
            <div style={{ ...labelStyle, marginBottom: '0.35rem' }}>Recent Reminder Runs</div>
            {reminderRuns.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>No runs yet.</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Run At</th>
                    <th>Checked</th>
                    <th>Alerts</th>
                    <th>Skipped</th>
                  </tr>
                </thead>
                <tbody>
                  {reminderRuns.slice(0, 6).map((run) => (
                    <tr key={run.id}>
                      <td>{new Date(run.run_at).toLocaleString()}</td>
                      <td>{num(run.checked_count)}</td>
                      <td>{num(run.alert_count)}</td>
                      <td>{num(run.skipped_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Add Tenant form */}
      {showAddTenant && (
        <div style={inlineFormStyle}>
          <div style={formRowStyle}>
            <div style={formGroupStyle}>
              <label style={labelStyle}>Name</label>
              <input style={inputStyle} value={tenantForm.name} onChange={(e) => setTenantForm({ ...tenantForm, name: e.target.value })} required />
            </div>
            <div style={formGroupStyle}>
              <label style={labelStyle}>Email</label>
              <input style={inputStyle} type="email" value={tenantForm.email} onChange={(e) => setTenantForm({ ...tenantForm, email: e.target.value })} />
            </div>
            <div style={formGroupStyle}>
              <label style={labelStyle}>Phone</label>
              <input style={inputStyle} value={tenantForm.phone} onChange={(e) => setTenantForm({ ...tenantForm, phone: e.target.value })} />
            </div>
          </div>
          <div style={formRowStyle}>
            <div style={formGroupStyle}>
              <label style={labelStyle}>Lease Start</label>
              <input style={inputStyle} type="date" value={tenantForm.leaseStart} onChange={(e) => setTenantForm({ ...tenantForm, leaseStart: e.target.value })} />
            </div>
            <div style={formGroupStyle}>
              <label style={labelStyle}>Lease End</label>
              <input style={inputStyle} type="date" value={tenantForm.leaseEnd} onChange={(e) => setTenantForm({ ...tenantForm, leaseEnd: e.target.value })} />
            </div>
            <div style={formGroupStyle}>
              <label style={labelStyle}>Monthly Rent</label>
              <input style={inputStyle} type="text" inputMode="numeric" value={formatNumberInput(tenantForm.monthlyRent)} onChange={(e) => setTenantForm({ ...tenantForm, monthlyRent: parseNumberInput(e.target.value) })} />
            </div>
            <div style={formGroupStyle}>
              <label style={labelStyle}>Security Deposit</label>
              <input style={inputStyle} type="text" inputMode="numeric" value={formatNumberInput(tenantForm.securityDeposit)} onChange={(e) => setTenantForm({ ...tenantForm, securityDeposit: parseNumberInput(e.target.value) })} />
            </div>
          </div>
          <div style={formGroupStyle}>
            <label style={labelStyle}>Notes</label>
            <input style={inputStyle} value={tenantForm.notes} onChange={(e) => setTenantForm({ ...tenantForm, notes: e.target.value })} />
          </div>
          <div style={{ marginTop: '0.75rem' }}>
            <button style={smallBtnStyle('primary')} onClick={() => { if (tenantForm.name.trim()) addTenant.mutate(tenantForm); }} disabled={addTenant.isPending}>
              {addTenant.isPending ? 'Adding...' : 'Add Tenant'}
            </button>
          </div>
        </div>
      )}

      {/* Tenant list */}
      {tenants.length === 0 && !showAddTenant && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          No tenants. Click &quot;+ Add Tenant&quot; to add one.
        </div>
      )}

      {tenants.map((t) => (
        <div key={t.id} style={{ ...panelStyle, marginTop: '0.5rem' }}>
          {editingTenantId === t.id ? (
            /* Inline edit mode */
            <div>
              <div style={formRowStyle}>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>Name</label>
                  <input style={inputStyle} value={editTenantForm.name} onChange={(e) => setEditTenantForm({ ...editTenantForm, name: e.target.value })} />
                </div>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>Email</label>
                  <input style={inputStyle} type="email" value={editTenantForm.email} onChange={(e) => setEditTenantForm({ ...editTenantForm, email: e.target.value })} />
                </div>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>Phone</label>
                  <input style={inputStyle} value={editTenantForm.phone} onChange={(e) => setEditTenantForm({ ...editTenantForm, phone: e.target.value })} />
                </div>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>Status</label>
                  <select style={selectStyle} value={editTenantForm.status} onChange={(e) => setEditTenantForm({ ...editTenantForm, status: e.target.value })}>
                    <option value="active">Active</option>
                    <option value="month_to_month">Month-to-Month</option>
                    <option value="expired">Expired</option>
                    <option value="terminated">Terminated</option>
                  </select>
                </div>
              </div>
              <div style={formRowStyle}>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>Lease Start</label>
                  <input style={inputStyle} type="date" value={editTenantForm.leaseStart} onChange={(e) => setEditTenantForm({ ...editTenantForm, leaseStart: e.target.value })} />
                </div>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>Lease End</label>
                  <input style={inputStyle} type="date" value={editTenantForm.leaseEnd} onChange={(e) => setEditTenantForm({ ...editTenantForm, leaseEnd: e.target.value })} />
                </div>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>Monthly Rent</label>
                  <input style={inputStyle} type="text" inputMode="numeric" value={formatNumberInput(editTenantForm.monthlyRent)} onChange={(e) => setEditTenantForm({ ...editTenantForm, monthlyRent: parseNumberInput(e.target.value) })} />
                </div>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>Security Deposit</label>
                  <input style={inputStyle} type="text" inputMode="numeric" value={formatNumberInput(editTenantForm.securityDeposit)} onChange={(e) => setEditTenantForm({ ...editTenantForm, securityDeposit: parseNumberInput(e.target.value) })} />
                </div>
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Notes</label>
                <input style={inputStyle} value={editTenantForm.notes} onChange={(e) => setEditTenantForm({ ...editTenantForm, notes: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                <button style={smallBtnStyle('primary')} onClick={() => updateTenant.mutate({ id: t.id, data: editTenantForm })} disabled={updateTenant.isPending}>
                  {updateTenant.isPending ? 'Saving...' : 'Save'}
                </button>
                <button style={smallBtnStyle('secondary')} onClick={() => setEditingTenantId(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            /* Display mode */
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <div>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem' }}>{t.name}</span>
                  <span
                    style={{
                      marginLeft: '0.5rem',
                      padding: '0.15rem 0.5rem',
                      borderRadius: 999,
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      background: t.status === 'active' ? 'rgba(0,200,83,0.15)' : t.status === 'month_to_month' ? 'rgba(255,193,7,0.15)' : 'rgba(255,82,82,0.15)',
                      color: t.status === 'active' ? 'var(--green)' : t.status === 'month_to_month' ? 'var(--gold)' : 'var(--red)',
                    }}
                  >
                    {t.status}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button style={smallBtnStyle('secondary')} onClick={() => startEditTenant(t)}>Edit</button>
                  <button
                    style={smallBtnStyle('danger')}
                    onClick={() => {
                      if (window.confirm(`Delete tenant ${t.name}?`)) deleteTenant.mutate(t.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {t.email && <span>Email: {t.email}</span>}
                {t.phone && <span>Phone: {t.phone}</span>}
                {t.lease_start && <span>Lease: {t.lease_start} &rarr; {t.lease_end || 'ongoing'}</span>}
                <span style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>Rent: {fmt(t.monthly_rent)}</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>Deposit: {fmt(t.security_deposit)}</span>
              </div>
              {t.notes && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem', fontStyle: 'italic' }}>
                  {t.notes}
                </div>
              )}

              {/* Communications toggle */}
              <div style={{ marginTop: '0.6rem', borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}>
                <button
                  style={{ ...smallBtnStyle('secondary'), fontSize: '0.7rem' }}
                  onClick={() => setExpandedCommsId(expandedCommsId === t.id ? null : t.id)}
                >
                  {expandedCommsId === t.id ? 'Hide Communications' : 'Communications'}
                </button>
                {expandedCommsId === t.id && <CommunicationsSection tenantId={t.id} />}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Communications sub-section ── */

function CommunicationsSection({ tenantId }: { tenantId: number }) {
  const queryClient = useQueryClient();
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [msgForm, setMsgForm] = useState({ type: 'email', subject: '', body: '' });

  const { data: comms = [] } = useQuery<Communication[]>({
    queryKey: ['communications', tenantId],
    queryFn: () => api.get(`/portfolio/tenants/${tenantId}/communications`).then((r) => r.data),
  });

  const createComm = useMutation({
    mutationFn: (data: typeof msgForm) => api.post(`/portfolio/tenants/${tenantId}/communications`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['communications', tenantId] });
      setShowNewMessage(false);
      setMsgForm({ type: 'email', subject: '', body: '' });
    },
  });

  const sendComm = useMutation({
    mutationFn: (id: number) => api.put(`/portfolio/communications/${id}/send`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['communications', tenantId] });
    },
  });

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {num(comms.length)} message{comms.length !== 1 ? 's' : ''}
        </span>
        <button style={{ ...smallBtnStyle('primary'), fontSize: '0.7rem' }} onClick={() => setShowNewMessage(!showNewMessage)}>
          {showNewMessage ? 'Cancel' : '+ New Message'}
        </button>
      </div>

      {showNewMessage && (
        <div style={inlineFormStyle}>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <select
              style={{ ...selectStyle, width: 100 }}
              value={msgForm.type}
              onChange={(e) => setMsgForm({ ...msgForm, type: e.target.value })}
            >
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </select>
            <input
              style={{ ...inputStyle, flex: 1 }}
              placeholder="Subject"
              value={msgForm.subject}
              onChange={(e) => setMsgForm({ ...msgForm, subject: e.target.value })}
            />
          </div>
          <textarea
            style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }}
            placeholder="Message body..."
            value={msgForm.body}
            onChange={(e) => setMsgForm({ ...msgForm, body: e.target.value })}
          />
          <div style={{ marginTop: '0.5rem' }}>
            <button
              style={smallBtnStyle('primary')}
              onClick={() => createComm.mutate(msgForm)}
              disabled={createComm.isPending}
            >
              {createComm.isPending ? 'Creating...' : 'Create Draft'}
            </button>
          </div>
        </div>
      )}

      {comms.map((c) => (
        <div key={c.id} style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)', fontSize: '0.78rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{
                padding: '0.1rem 0.4rem',
                borderRadius: 4,
                fontSize: '0.65rem',
                fontWeight: 600,
                background: c.type === 'email' ? 'rgba(0,206,209,0.15)' : 'rgba(255,193,7,0.15)',
                color: c.type === 'email' ? 'var(--teal)' : 'var(--gold)',
                marginRight: '0.4rem',
              }}>
                {c.type.toUpperCase()}
              </span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{c.subject || '(no subject)'}</span>
              <span style={{
                marginLeft: '0.5rem',
                padding: '0.1rem 0.4rem',
                borderRadius: 4,
                fontSize: '0.6rem',
                fontWeight: 600,
                background: c.status === 'sent' ? 'rgba(0,200,83,0.15)' : 'rgba(255,255,255,0.08)',
                color: c.status === 'sent' ? 'var(--green)' : 'var(--text-muted)',
              }}>
                {c.status}
              </span>
            </div>
            {c.status === 'draft' && (
              <button
                style={smallBtnStyle('success')}
                onClick={() => sendComm.mutate(c.id)}
                disabled={sendComm.isPending}
              >
                Send
              </button>
            )}
          </div>
          {c.body && (
            <div style={{ color: 'var(--text-muted)', marginTop: '0.25rem', whiteSpace: 'pre-wrap', fontSize: '0.73rem' }}>
              {c.body}
            </div>
          )}
          {c.sent_at && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '0.2rem' }}>
              Sent: {new Date(c.sent_at).toLocaleString()}
            </div>
          )}
        </div>
      ))}

      {comms.length === 0 && !showNewMessage && (
        <div style={{ textAlign: 'center', padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
          No communications yet.
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   RENOVATIONS TAB
   ══════════════════════════════════════════════════════════════ */

function RenovationsTab({ unitId }: { unitId: number }) {
  const queryClient = useQueryClient();
  const [showAddReno, setShowAddReno] = useState(false);
  const [editingRenoId, setEditingRenoId] = useState<number | null>(null);

  const [renoForm, setRenoForm] = useState({
    description: '',
    estimatedCost: 0,
    expenseSource: 'bank',
    reconcileRef: '',
    reconciled: false,
    contractor: '',
    startDate: '',
    endDate: '',
    notes: '',
  });

  const [editRenoForm, setEditRenoForm] = useState({
    description: '',
    status: 'planned',
    estimatedCost: 0,
    actualCost: 0,
    expenseSource: 'bank',
    reconcileRef: '',
    reconciled: false,
    contractor: '',
    startDate: '',
    endDate: '',
    notes: '',
  });

  const { data: renovations = [] } = useQuery<Renovation[]>({
    queryKey: ['renovations', unitId],
    queryFn: () => api.get(`/portfolio/units/${unitId}/renovations`).then((r) => r.data),
  });

  const addReno = useMutation({
    mutationFn: (data: typeof renoForm) => api.post(`/portfolio/units/${unitId}/renovations`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['renovations', unitId] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-summary'] });
      setShowAddReno(false);
      setRenoForm({ description: '', estimatedCost: 0, expenseSource: 'bank', reconcileRef: '', reconciled: false, contractor: '', startDate: '', endDate: '', notes: '' });
    },
  });

  const updateReno = useMutation({
    mutationFn: ({ id, data }: { id: number; data: typeof editRenoForm }) =>
      api.put(`/portfolio/renovations/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['renovations', unitId] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-summary'] });
      setEditingRenoId(null);
    },
  });

  const deleteReno = useMutation({
    mutationFn: (id: number) => api.delete(`/portfolio/renovations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['renovations', unitId] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-summary'] });
    },
  });

  const startEditReno = (r: Renovation) => {
    setEditingRenoId(r.id);
    setEditRenoForm({
      description: r.description,
      status: r.status,
      estimatedCost: r.estimated_cost,
      actualCost: r.actual_cost ?? 0,
      expenseSource: r.expense_source || 'bank',
      reconcileRef: r.reconcile_ref || '',
      reconciled: !!r.reconciled,
      contractor: r.contractor || '',
      startDate: r.start_date || '',
      endDate: r.end_date || '',
      notes: r.notes || '',
    });
  };

  const statusColors: Record<string, string> = {
    planned: 'var(--text-muted)',
    in_progress: 'var(--gold)',
    completed: 'var(--green)',
    cancelled: 'var(--red)',
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h4 style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>
          Renovations ({num(renovations.length)})
        </h4>
        <button style={smallBtnStyle('primary')} onClick={() => setShowAddReno(!showAddReno)}>
          {showAddReno ? 'Cancel' : '+ Add Renovation'}
        </button>
      </div>

      {/* Add Renovation form */}
      {showAddReno && (
        <div style={inlineFormStyle}>
          <div style={formRowStyle}>
            <div style={{ ...formGroupStyle, gridColumn: 'span 2' }}>
              <label style={labelStyle}>Description</label>
              <input style={inputStyle} value={renoForm.description} onChange={(e) => setRenoForm({ ...renoForm, description: e.target.value })} required />
            </div>
            <div style={formGroupStyle}>
              <label style={labelStyle}>Estimated Cost</label>
              <input style={inputStyle} type="text" inputMode="numeric" value={formatNumberInput(renoForm.estimatedCost)} onChange={(e) => setRenoForm({ ...renoForm, estimatedCost: parseNumberInput(e.target.value) })} />
            </div>
            <div style={formGroupStyle}>
              <label style={labelStyle}>Expense Source</label>
              <select style={selectStyle} value={renoForm.expenseSource} onChange={(e) => setRenoForm({ ...renoForm, expenseSource: e.target.value })}>
                <option value="bank">Bank</option>
                <option value="credit_card">Credit Card</option>
                <option value="wire">Wire</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div style={formRowStyle}>
            <div style={formGroupStyle}>
              <label style={labelStyle}>Contractor</label>
              <input style={inputStyle} value={renoForm.contractor} onChange={(e) => setRenoForm({ ...renoForm, contractor: e.target.value })} />
            </div>
            <div style={formGroupStyle}>
              <label style={labelStyle}>Start Date</label>
              <input style={inputStyle} type="date" value={renoForm.startDate} onChange={(e) => setRenoForm({ ...renoForm, startDate: e.target.value })} />
            </div>
            <div style={formGroupStyle}>
              <label style={labelStyle}>End Date</label>
              <input style={inputStyle} type="date" value={renoForm.endDate} onChange={(e) => setRenoForm({ ...renoForm, endDate: e.target.value })} />
            </div>
          </div>
          <div style={formGroupStyle}>
            <label style={labelStyle}>Reconciliation Ref</label>
            <input style={inputStyle} value={renoForm.reconcileRef} onChange={(e) => setRenoForm({ ...renoForm, reconcileRef: e.target.value })} />
          </div>
          <div style={formGroupStyle}>
            <label style={labelStyle}>
              <input type="checkbox" checked={renoForm.reconciled} onChange={(e) => setRenoForm({ ...renoForm, reconciled: e.target.checked })} /> Reconciled with statement
            </label>
          </div>
          <div style={formGroupStyle}>
            <label style={labelStyle}>Notes</label>
            <input style={inputStyle} value={renoForm.notes} onChange={(e) => setRenoForm({ ...renoForm, notes: e.target.value })} />
          </div>
          <div style={{ marginTop: '0.75rem' }}>
            <button style={smallBtnStyle('primary')} onClick={() => { if (renoForm.description.trim()) addReno.mutate(renoForm); }} disabled={addReno.isPending}>
              {addReno.isPending ? 'Adding...' : 'Add Renovation'}
            </button>
          </div>
        </div>
      )}

      {/* Renovation list */}
      {renovations.length === 0 && !showAddReno && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          No renovations. Click &quot;+ Add Renovation&quot; to track one.
        </div>
      )}

      {renovations.map((r) => (
        <div key={r.id} style={{ ...panelStyle, marginTop: '0.5rem' }}>
          {editingRenoId === r.id ? (
            /* Inline edit mode */
            <div>
              <div style={formRowStyle}>
                <div style={{ ...formGroupStyle, gridColumn: 'span 2' }}>
                  <label style={labelStyle}>Description</label>
                  <input style={inputStyle} value={editRenoForm.description} onChange={(e) => setEditRenoForm({ ...editRenoForm, description: e.target.value })} />
                </div>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>Status</label>
                  <select style={selectStyle} value={editRenoForm.status} onChange={(e) => setEditRenoForm({ ...editRenoForm, status: e.target.value })}>
                    <option value="planned">Planned</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
              <div style={formRowStyle}>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>Estimated Cost</label>
                  <input style={inputStyle} type="text" inputMode="numeric" value={formatNumberInput(editRenoForm.estimatedCost)} onChange={(e) => setEditRenoForm({ ...editRenoForm, estimatedCost: parseNumberInput(e.target.value) })} />
                </div>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>Actual Cost</label>
                  <input style={inputStyle} type="text" inputMode="numeric" value={formatNumberInput(editRenoForm.actualCost ?? 0)} onChange={(e) => setEditRenoForm({ ...editRenoForm, actualCost: parseNumberInput(e.target.value) })} />
                </div>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>Expense Source</label>
                  <select style={selectStyle} value={editRenoForm.expenseSource} onChange={(e) => setEditRenoForm({ ...editRenoForm, expenseSource: e.target.value })}>
                    <option value="bank">Bank</option>
                    <option value="credit_card">Credit Card</option>
                    <option value="wire">Wire</option>
                    <option value="cash">Cash</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>Contractor</label>
                  <input style={inputStyle} value={editRenoForm.contractor} onChange={(e) => setEditRenoForm({ ...editRenoForm, contractor: e.target.value })} />
                </div>
              </div>
              <div style={formRowStyle}>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>Start Date</label>
                  <input style={inputStyle} type="date" value={editRenoForm.startDate} onChange={(e) => setEditRenoForm({ ...editRenoForm, startDate: e.target.value })} />
                </div>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>End Date</label>
                  <input style={inputStyle} type="date" value={editRenoForm.endDate} onChange={(e) => setEditRenoForm({ ...editRenoForm, endDate: e.target.value })} />
                </div>
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Reconciliation Ref</label>
                <input style={inputStyle} value={editRenoForm.reconcileRef} onChange={(e) => setEditRenoForm({ ...editRenoForm, reconcileRef: e.target.value })} />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>
                  <input type="checkbox" checked={editRenoForm.reconciled} onChange={(e) => setEditRenoForm({ ...editRenoForm, reconciled: e.target.checked })} /> Reconciled with statement
                </label>
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Notes</label>
                <input style={inputStyle} value={editRenoForm.notes} onChange={(e) => setEditRenoForm({ ...editRenoForm, notes: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                <button style={smallBtnStyle('primary')} onClick={() => updateReno.mutate({ id: r.id, data: editRenoForm })} disabled={updateReno.isPending}>
                  {updateReno.isPending ? 'Saving...' : 'Save'}
                </button>
                <button style={smallBtnStyle('secondary')} onClick={() => setEditingRenoId(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            /* Display mode */
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.92rem' }}>{r.description}</span>
                  <span
                    style={{
                      marginLeft: '0.5rem',
                      padding: '0.15rem 0.5rem',
                      borderRadius: 999,
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      background: `${statusColors[r.status] || 'var(--text-muted)'}22`,
                      color: statusColors[r.status] || 'var(--text-muted)',
                    }}
                  >
                    {r.status.replace('_', ' ')}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button style={smallBtnStyle('secondary')} onClick={() => startEditReno(r)}>Edit</button>
                  <button
                    style={smallBtnStyle('danger')}
                    onClick={() => {
                      if (window.confirm('Delete this renovation?')) deleteReno.mutate(r.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.4rem' }}>
                <span style={{ fontFamily: 'var(--font-mono)' }}>Est: {fmt(r.estimated_cost)}</span>
                {r.actual_cost != null && <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>Actual: {fmt(r.actual_cost)}</span>}
                <span style={{ color: 'var(--text-muted)' }}>Source: {r.expense_source || 'bank'}</span>
                <span style={{ color: r.reconciled ? 'var(--green)' : 'var(--gold)' }}>{r.reconciled ? 'Reconciled' : 'Unreconciled'}</span>
                {r.reconcile_ref && <span style={{ color: 'var(--text-muted)' }}>Ref: {r.reconcile_ref}</span>}
                {r.contractor && <span>Contractor: {r.contractor}</span>}
                {r.start_date && <span>{r.start_date} &rarr; {r.end_date || 'TBD'}</span>}
              </div>
              {r.notes && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem', fontStyle: 'italic' }}>
                  {r.notes}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   CASH FLOWS TAB
   ══════════════════════════════════════════════════════════════ */

interface ActualTransaction {
  id: number;
  date: string;
  amount: number;
  category: string;
  description: string;
}

function CashFlowsTab({ unit }: { unit: PortfolioUnit }) {
  const [expandedRenoMonth, setExpandedRenoMonth] = useState<string | null>(null);
  const [mode, setMode] = useState<'operating' | 'overall'>('overall');
  const [includeRenovations, setIncludeRenovations] = useState(true);
  const [includeCapitalCalls, setIncludeCapitalCalls] = useState(true);
  const [showActuals, setShowActuals] = useState(true);
  const [selectedActualCategories, setSelectedActualCategories] = useState<string[]>([]);

  // Fetch actuals for this unit
  const { data: actuals = [] } = useQuery<ActualTransaction[]>({
    queryKey: ['unit-actuals', unit.id],
    queryFn: () => api.get(`/actuals/transactions?unit_id=${unit.id}&reconciled=true&limit=200`).then((r) => r.data),
  });

  const { data: unitCosts } = useQuery<any>({
    queryKey: ['unit-costs', unit.id],
    queryFn: () => api.get(`/portfolio/units/${unit.id}/costs`).then((r) => r.data),
  });

  const actualCategories = useMemo(
    () => Array.from(new Set(actuals.map((a) => a.category))).sort(),
    [actuals]
  );

  // Fetch renovations for this unit
  const { data: renovations = [] } = useQuery<Renovation[]>({
    queryKey: ['unit-renovations-cf', unit.id],
    queryFn: () => api.get(`/portfolio/units/${unit.id}/renovations`).then((r) => r.data),
  });

  // Generate 12-month projected cash flows
  const months = useMemo(() => {
    const result = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const label = d.toLocaleString('default', { month: 'short', year: 'numeric' });
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      result.push({ label, key, date: d });
    }
    return result;
  }, []);

  // Group actuals by month
  const actualsByMonth = useMemo(() => {
    const operatingCats = new Set(['rent', 'hoa', 'insurance', 'tax', 'repair']);
    const filtered = actuals.filter((a) => {
      const selectedOk = selectedActualCategories.length === 0 || selectedActualCategories.includes(a.category);
      const modeOk = mode === 'overall' || operatingCats.has(a.category);
      return selectedOk && modeOk;
    });
    const map = new Map<string, number>();
    for (const a of filtered) {
      const d = new Date(a.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      map.set(key, (map.get(key) || 0) + a.amount);
    }
    return map;
  }, [actuals, mode, selectedActualCategories]);

  // Compute the capital call month key from purchase_date
  const capitalCallMonthKey = useMemo(() => {
    if (!unit.purchase_date) return null;
    const d = new Date(unit.purchase_date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, [unit.purchase_date]);

  // Group renovations by month (based on start_date)
  const renoByMonth = useMemo(() => {
    const map = new Map<string, { total: number; items: Renovation[] }>();
    for (const r of renovations) {
      if (!r.start_date) continue;
      const d = new Date(r.start_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const existing = map.get(key) || { total: 0, items: [] };
      const cost = r.actual_cost != null ? r.actual_cost : r.estimated_cost;
      existing.total += cost;
      existing.items.push(r);
      map.set(key, existing);
    }
    return map;
  }, [renovations]);

  const monthlyBaseNOI = unit.monthly_rent - unit.monthly_hoa;
  const insurancePayMonth = unit.insurance_payment_month || 1;
  const taxPayMonth = unit.tax_payment_month || 1;

  // Compute 12-month totals
  const totals = useMemo(() => {
    let totalReno = 0;
    let totalCapCall = 0;
    let totalOperatingCF = 0;
    let totalOverallCF = 0;
    for (const m of months) {
      const monthNum = Number(m.key.split('-')[1]);
      const insuranceExpense = monthNum === insurancePayMonth ? unit.monthly_insurance : 0;
      const taxExpense = monthNum === taxPayMonth ? unit.monthly_tax : 0;
      const renoCost = renoByMonth.get(m.key)?.total ?? 0;
      const capCall = m.key === capitalCallMonthKey ? unit.total_acquisition_cost : 0;
      const appliedReno = includeRenovations ? renoCost : 0;
      const appliedCapCall = includeCapitalCalls ? capCall : 0;
      const operatingCF = monthlyBaseNOI - insuranceExpense - taxExpense - appliedReno;
      const overallCF = operatingCF - appliedCapCall;
      totalReno += appliedReno;
      totalCapCall += appliedCapCall;
      totalOperatingCF += operatingCF;
      totalOverallCF += overallCF;
    }
    return {
      totalReno,
      totalCapCall,
      totalNOI: totalOperatingCF + totalReno,
      totalOperatingCF,
      totalOverallCF,
      totalCashFlow: mode === 'operating' ? totalOperatingCF : totalOverallCF,
    };
  }, [months, renoByMonth, capitalCallMonthKey, unit.total_acquisition_cost, monthlyBaseNOI, unit.monthly_insurance, unit.monthly_tax, insurancePayMonth, taxPayMonth, includeRenovations, includeCapitalCalls, mode]);

  const rhStyle: CSSProperties = { textAlign: 'right', fontFamily: 'var(--font-mono)' };

  return (
    <div>
      <h4 style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.6rem' }}>
        12-Month Projected Cash Flows
      </h4>

      {unitCosts && (
        <div className="metrics-grid" style={{ marginBottom: '1rem' }}>
          <div className="metric-card">
            <div className="metric-label">Acquisition Cost</div>
            <div className="metric-value teal">{fmt(Number(unitCosts.acquisitionCost || 0))}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Renovation Spend (Reconciled)</div>
            <div className="metric-value gold">{fmt(Number(unitCosts.renovationSpend || 0))}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Total Basis</div>
            <div className="metric-value">{fmt(Number(unitCosts.totalBasis || 0))}</div>
          </div>
        </div>
      )}

      {/* Effective Land Price for this unit */}
      {unit.ownership_pct > 0 && (
        <div style={{ marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Effective Land Price: <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{fmt(Math.round(unit.purchase_price / (unit.ownership_pct / 100)))}</span>
          &nbsp;&middot;&nbsp; Ownership: <span style={{ color: 'var(--accent-light)', fontWeight: 600 }}>{unit.ownership_pct?.toFixed(4)}%</span>
        </div>
      )}

      <div style={{ marginBottom: '0.9rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button className={`btn ${mode === 'overall' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('overall')}>
          Overall CF
        </button>
        <button className={`btn ${mode === 'operating' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('operating')}>
          Operating CF
        </button>
        <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <input type="checkbox" checked={includeCapitalCalls} onChange={(e) => setIncludeCapitalCalls(e.target.checked)} />
          Include capital calls
        </label>
        <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <input type="checkbox" checked={includeRenovations} onChange={(e) => setIncludeRenovations(e.target.checked)} />
          Include renovations
        </label>
        <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <input type="checkbox" checked={showActuals} onChange={(e) => setShowActuals(e.target.checked)} />
          Show actuals/variance
        </label>
      </div>

      {actualCategories.length > 0 && (
        <div style={{ marginBottom: '0.8rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          {actualCategories.map((c) => {
            const active = selectedActualCategories.length === 0 || selectedActualCategories.includes(c);
            return (
              <button
                key={c}
                className="btn btn-secondary"
                style={{
                  padding: '0.2rem 0.55rem',
                  fontSize: '0.72rem',
                  opacity: active ? 1 : 0.45,
                  textTransform: 'capitalize',
                }}
                onClick={() => {
                  if (selectedActualCategories.length === 0) {
                    setSelectedActualCategories(actualCategories.filter((x) => x !== c));
                    return;
                  }
                  if (selectedActualCategories.includes(c)) {
                    const next = selectedActualCategories.filter((x) => x !== c);
                    setSelectedActualCategories(next.length === 0 ? [] : next);
                  } else {
                    setSelectedActualCategories([...selectedActualCategories, c]);
                  }
                }}
              >
                {c.replace('_', ' ')}
              </button>
            );
          })}
          {selectedActualCategories.length > 0 && (
            <button className="btn btn-secondary" style={{ padding: '0.2rem 0.55rem', fontSize: '0.72rem' }} onClick={() => setSelectedActualCategories([])}>
              Reset actual filters
            </button>
          )}
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Month</th>
              <th style={{ textAlign: 'right' }}>Capital Call</th>
              <th style={{ textAlign: 'right' }}>Rent</th>
              <th style={{ textAlign: 'right' }}>HOA</th>
              <th style={{ textAlign: 'right' }}>Insurance (annual)</th>
              <th style={{ textAlign: 'right' }}>Tax (annual)</th>
              <th style={{ textAlign: 'right' }}>Renovations</th>
              <th style={{ textAlign: 'right' }}>Projected NOI</th>
              <th style={{ textAlign: 'right' }}>{mode === 'operating' ? 'Operating CF' : 'Total Cash Flow'}</th>
              {showActuals && actuals.length > 0 && <th style={{ textAlign: 'right' }}>{mode === 'operating' ? 'Actual Operating CF' : 'Actual CF'}</th>}
              {showActuals && actuals.length > 0 && <th style={{ textAlign: 'right' }}>Variance</th>}
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const capCall = m.key === capitalCallMonthKey ? unit.total_acquisition_cost : 0;
              const renoCost = renoByMonth.get(m.key)?.total ?? 0;
              const appliedCapCall = includeCapitalCalls ? capCall : 0;
              const appliedRenoCost = includeRenovations ? renoCost : 0;
              const monthNum = Number(m.key.split('-')[1]);
              const annualInsurance = monthNum === insurancePayMonth ? unit.monthly_insurance : 0;
              const annualTax = monthNum === taxPayMonth ? unit.monthly_tax : 0;
              const insuranceDisplay = monthNum === 1 ? fmt(annualInsurance) : '—';
              const taxDisplay = monthNum === 1 ? fmt(annualTax) : '—';
              const renoItems = renoByMonth.get(m.key)?.items ?? [];
              const adjNOI = monthlyBaseNOI - annualInsurance - annualTax - appliedRenoCost;
              const operatingCF = adjNOI;
              const totalCF = operatingCF - appliedCapCall;
              const projectedCF = mode === 'operating' ? operatingCF : totalCF;
              const actualNOI = actualsByMonth.get(m.key);
              const variance = actualNOI != null ? actualNOI - projectedCF : null;
              const hasRenos = includeRenovations && renoItems.length > 0;
              const isExpanded = expandedRenoMonth === m.key;

              return (
                <Fragment key={m.key}>
                  <tr>
                    <td>{m.label}</td>
                    <td style={{ ...rhStyle, color: appliedCapCall > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
                      {appliedCapCall > 0 ? `(${fmt(appliedCapCall)})` : '—'}
                    </td>
                    <td style={{ ...rhStyle, color: 'var(--green)' }}>{fmt(unit.monthly_rent)}</td>
                    <td style={{ ...rhStyle, color: 'var(--red)' }}>{fmt(unit.monthly_hoa)}</td>
                    <td style={{ ...rhStyle, color: 'var(--text-muted)' }}>{insuranceDisplay}</td>
                    <td style={{ ...rhStyle, color: 'var(--text-muted)' }}>{taxDisplay}</td>
                    <td style={{ ...rhStyle, color: appliedRenoCost > 0 ? 'var(--gold)' : 'var(--text-muted)' }}>
                      {appliedRenoCost > 0 ? (
                        <span
                          style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                          onClick={() => setExpandedRenoMonth(isExpanded ? null : m.key)}
                          title="Click to expand renovation details"
                        >
                          ({fmt(appliedRenoCost)})
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ ...rhStyle, fontWeight: 600, color: adjNOI >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {fmt(adjNOI)}
                    </td>
                    <td style={{ ...rhStyle, fontWeight: 600, color: projectedCF >= 0 ? 'var(--teal)' : 'var(--red)' }}>
                      {fmt(projectedCF)}
                    </td>
                    {showActuals && actuals.length > 0 && (
                      <td style={{ ...rhStyle, fontWeight: 600, color: actualNOI != null ? (actualNOI >= 0 ? 'var(--teal)' : 'var(--red)') : 'var(--text-muted)' }}>
                        {actualNOI != null ? fmt(actualNOI) : '—'}
                      </td>
                    )}
                    {showActuals && actuals.length > 0 && (
                      <td style={{ ...rhStyle, fontWeight: 600, color: variance != null ? (variance >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)' }}>
                        {variance != null ? `${variance >= 0 ? '+' : ''}${fmt(variance)}` : '—'}
                      </td>
                    )}
                  </tr>
                  {/* Expandable renovation detail rows */}
                  {hasRenos && isExpanded && renoItems.map((r) => {
                    const cost = r.actual_cost != null ? r.actual_cost : r.estimated_cost;
                    return (
                      <tr key={`reno-${r.id}`} style={{ background: 'var(--bg-tertiary)' }}>
                        <td colSpan={2} />
                        <td colSpan={4} style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', paddingLeft: '1.2rem' }}>
                          {r.description}
                          {r.contractor && <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem' }}>({r.contractor})</span>}
                          {r.status === 'completed' && <span style={{ color: 'var(--green)', marginLeft: '0.5rem', fontSize: '0.7rem' }}>DONE</span>}
                          {r.status === 'in_progress' && <span style={{ color: 'var(--gold)', marginLeft: '0.5rem', fontSize: '0.7rem' }}>IN PROGRESS</span>}
                        </td>
                        <td style={{ ...rhStyle, fontSize: '0.78rem', color: 'var(--gold)' }}>
                          ({fmt(cost)})
                          {r.actual_cost == null && <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginLeft: '0.3rem' }}>est.</span>}
                        </td>
                        <td colSpan={showActuals && actuals.length > 0 ? 3 : 1} />
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
              <td>12-Month Total</td>
              <td style={{ ...rhStyle, color: totals.totalCapCall > 0 ? 'var(--red)' : 'var(--text-muted)' }}>
                {totals.totalCapCall > 0 ? `(${fmt(totals.totalCapCall)})` : '—'}
              </td>
              <td style={{ ...rhStyle, color: 'var(--green)' }}>{fmt(unit.monthly_rent * 12)}</td>
              <td style={{ ...rhStyle, color: 'var(--red)' }}>{fmt(unit.monthly_hoa * 12)}</td>
              <td style={{ textAlign: 'right' }}>{fmt(unit.monthly_insurance)}</td>
              <td style={{ textAlign: 'right' }}>{fmt(unit.monthly_tax)}</td>
              <td style={{ ...rhStyle, color: totals.totalReno > 0 ? 'var(--gold)' : 'var(--text-muted)' }}>
                {totals.totalReno > 0 ? `(${fmt(totals.totalReno)})` : '—'}
              </td>
              <td style={{ ...rhStyle, color: totals.totalNOI >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {fmt(totals.totalNOI)}
              </td>
              <td style={{ ...rhStyle, color: totals.totalCashFlow >= 0 ? 'var(--teal)' : 'var(--red)' }}>
                {fmt(totals.totalCashFlow)}
              </td>
              {showActuals && actuals.length > 0 && <td></td>}
              {showActuals && actuals.length > 0 && <td></td>}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Recent actuals list */}
      {actuals.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <h4 style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.6rem' }}>
            Recent Transactions
          </h4>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {actuals.slice(0, 20).map((a) => (
                <tr key={a.id}>
                  <td style={{ fontSize: '0.8rem' }}>{new Date(a.date).toLocaleDateString()}</td>
                  <td style={{ color: 'var(--text-primary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.description || '—'}
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{a.category.replace('_', ' ')}</td>
                  <td style={{ textAlign: 'right', color: a.amount >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                    {fmt(a.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* DocumentsTab replaced by inline <DocumentUpload> component */
