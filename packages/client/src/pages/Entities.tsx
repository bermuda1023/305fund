import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { fmtCurrency, fmtNumber } from '../lib/format';
import DocumentUpload from '../components/DocumentUpload';

/* ---------- Interfaces ---------- */

interface Entity {
  id: number;
  name: string;
  type: string;
  state_of_formation: string | null;
  ein: string | null;
  registered_agent: string | null;
  formation_date: string | null;
  status: string;
  notes: string | null;
  unit_count: number;
}

interface EntityForm {
  name: string;
  type: string;
  stateOfFormation: string;
  ein: string;
  registeredAgent: string;
  formationDate: string;
  notes: string;
}

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
  monthly_insurance: number;
  monthly_tax: number;
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

interface Renovation {
  id: number;
  portfolio_unit_id: number;
  description: string;
  status: string;
  estimated_cost: number;
  actual_cost: number | null;
  contractor: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
}

interface ActualTransaction {
  id: number;
  date: string;
  amount: number;
  category: string;
  description: string;
}

/* ---------- Constants ---------- */

const ENTITY_TYPES = ['llc', 'trust', 'corp', 'individual'] as const;

const TYPE_LABELS: Record<string, string> = {
  llc: 'LLC',
  trust: 'Trust',
  corp: 'Corporation',
  individual: 'Individual',
};

const emptyForm: EntityForm = {
  name: '',
  type: 'llc',
  stateOfFormation: '',
  ein: '',
  registeredAgent: '',
  formationDate: '',
  notes: '',
};

const fmt = fmtCurrency;
const num = fmtNumber;

type EntityDetailTab = 'details' | 'documents' | 'units' | 'accounting';

/* ---------- Helpers ---------- */

function entityToForm(e: Entity): EntityForm {
  return {
    name: e.name,
    type: e.type,
    stateOfFormation: e.state_of_formation ?? '',
    ein: e.ein ?? '',
    registeredAgent: e.registered_agent ?? '',
    formationDate: e.formation_date ?? '',
    notes: e.notes ?? '',
  };
}

/* ---------- Inline styles ---------- */

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

/* ================================================================
   MAIN COMPONENT
   ================================================================ */

export default function Entities() {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState<EntityForm>({ ...emptyForm });
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [editForm, setEditForm] = useState<EntityForm>({ ...emptyForm });
  const [activeTab, setActiveTab] = useState<EntityDetailTab>('details');
  const queryClient = useQueryClient();

  /* ---------- Queries ---------- */
  const { data: entities = [] } = useQuery<Entity[]>({
    queryKey: ['entities'],
    queryFn: () => api.get('/entities').then((r) => r.data),
  });

  /* ---------- Mutations ---------- */
  const createEntity = useMutation({
    mutationFn: (data: EntityForm) => api.post('/entities', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entities'] });
      setShowCreateForm(false);
      setCreateForm({ ...emptyForm });
    },
  });

  const updateEntity = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EntityForm }) =>
      api.put(`/entities/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entities'] });
      setSelectedEntity(null);
    },
  });

  /* ---------- Derived ---------- */
  const activeCount = entities.filter((e) => e.status === 'active').length;
  const dissolvedCount = entities.filter((e) => e.status === 'dissolved').length;
  const totalUnitsHeld = entities.reduce((sum, e) => sum + (e.unit_count ?? 0), 0);

  /* ---------- Handlers ---------- */
  const openDetail = (entity: Entity) => {
    setSelectedEntity(entity);
    setEditForm(entityToForm(entity));
    setActiveTab('details');
  };

  const closeDetail = () => {
    setSelectedEntity(null);
  };

  /* ---------- Shared form fields renderer ---------- */
  const renderFormFields = (
    form: EntityForm,
    setForm: React.Dispatch<React.SetStateAction<EntityForm>>,
    nameRequired: boolean
  ) => (
    <>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Entity Name {nameRequired && '*'}</label>
          <input
            className="form-input"
            type="text"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="e.g. Brickell Holdings LLC"
            required={nameRequired}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Type</label>
          <select
            className="form-select"
            value={form.type}
            onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
          >
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">State of Formation</label>
          <input
            className="form-input"
            type="text"
            value={form.stateOfFormation}
            onChange={(e) => setForm((prev) => ({ ...prev, stateOfFormation: e.target.value }))}
            placeholder="e.g. Florida"
          />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">EIN</label>
          <input
            className="form-input"
            type="text"
            value={form.ein}
            onChange={(e) => setForm((prev) => ({ ...prev, ein: e.target.value }))}
            placeholder="XX-XXXXXXX"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Registered Agent</label>
          <input
            className="form-input"
            type="text"
            value={form.registeredAgent}
            onChange={(e) => setForm((prev) => ({ ...prev, registeredAgent: e.target.value }))}
            placeholder="Agent name"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Formation Date</label>
          <input
            className="form-input"
            type="date"
            value={form.formationDate}
            onChange={(e) => setForm((prev) => ({ ...prev, formationDate: e.target.value }))}
          />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group" style={{ flex: 1 }}>
          <label className="form-label">Notes</label>
          <textarea
            className="form-input"
            rows={3}
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
            placeholder="Additional notes..."
            style={{
              resize: 'vertical',
              fontFamily: 'inherit',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '0.5rem 0.75rem',
              width: '100%',
            }}
          />
        </div>
      </div>
    </>
  );

  return (
    <div>
      {/* Page Header */}
      <div className="page-header flex-between">
        <div>
          <h2>Entities</h2>
          <p style={{ color: 'var(--text-muted)' }}>
            Manage LLCs, trusts, and other holding entities
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          + Create Entity
        </button>
      </div>

      {/* Summary Metrics */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Total Entities</div>
          <div className="metric-value teal">{num(entities.length)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Active</div>
          <div className="metric-value green">{num(activeCount)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Dissolved</div>
          <div className="metric-value red">{num(dissolvedCount)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Units Held</div>
          <div className="metric-value accent">{num(totalUnitsHeld)}</div>
        </div>
      </div>

      {/* Create Entity Form (collapsible) */}
      {showCreateForm && (
        <div className="card mb-4">
          <div className="card-header">
            <span className="card-title">New Entity</span>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setShowCreateForm(false);
                setCreateForm({ ...emptyForm });
              }}
            >
              Cancel
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!createForm.name.trim()) return;
              createEntity.mutate(createForm);
            }}
          >
            {renderFormFields(createForm, setCreateForm, true)}
            <div style={{ marginTop: '0.75rem' }}>
              <button
                className="btn btn-primary"
                type="submit"
                disabled={createEntity.isPending || !createForm.name.trim()}
              >
                {createEntity.isPending ? 'Creating...' : 'Create Entity'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Entity Detail / Tabbed Panel */}
      {selectedEntity && (
        <div className="card mb-4">
          <div className="card-header" style={{ flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span className="card-title">
                {selectedEntity.name} &mdash; {TYPE_LABELS[selectedEntity.type] ?? selectedEntity.type}
              </span>
              <button className="btn btn-secondary" onClick={closeDetail}>
                Close
              </button>
            </div>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              {(['details', 'documents', 'units', 'accounting'] as EntityDetailTab[]).map((tab) => (
                <button
                  key={tab}
                  style={tabBtnStyle(activeTab === tab)}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div style={{ padding: '1rem' }}>
            {activeTab === 'details' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!editForm.name.trim()) return;
                  updateEntity.mutate({ id: selectedEntity.id, data: editForm });
                }}
              >
                {renderFormFields(editForm, setEditForm, true)}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    marginTop: '0.75rem',
                  }}
                >
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={updateEntity.isPending || !editForm.name.trim()}
                  >
                    {updateEntity.isPending ? 'Saving...' : 'Save Changes'}
                  </button>
                  <span
                    style={{
                      fontSize: '0.78rem',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    ID: {selectedEntity.id} &middot; Units assigned:{' '}
                    <strong style={{ color: 'var(--teal)' }}>
                      {num(selectedEntity.unit_count)}
                    </strong>
                  </span>
                </div>
              </form>
            )}
            {activeTab === 'documents' && (
              <DocumentUpload parentType="entity" parentId={selectedEntity.id} />
            )}
            {activeTab === 'units' && (
              <EntityUnitsTab entityId={selectedEntity.id} entityName={selectedEntity.name} />
            )}
            {activeTab === 'accounting' && (
              <EntityAccountingTab entityId={selectedEntity.id} entityName={selectedEntity.name} />
            )}
          </div>
        </div>
      )}

      {/* Entities Table */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">All Entities ({num(entities.length)})</span>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>State</th>
              <th>EIN</th>
              <th>Formation Date</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}># Units</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((e) => (
              <tr
                key={e.id}
                style={{
                  cursor: 'pointer',
                  background: selectedEntity?.id === e.id ? 'rgba(0,206,209,0.08)' : undefined,
                  borderLeft: selectedEntity?.id === e.id ? '3px solid var(--teal)' : '3px solid transparent',
                }}
                onClick={() => openDetail(e)}
              >
                <td style={{ fontWeight: 600 }}>{e.name}</td>
                <td>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '0.15rem 0.5rem',
                      borderRadius: 4,
                      fontSize: '0.78rem',
                      fontWeight: 500,
                      background: 'var(--bg-tertiary)',
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {TYPE_LABELS[e.type] ?? e.type}
                  </span>
                </td>
                <td>{e.state_of_formation || '\u2014'}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                  {e.ein || '\u2014'}
                </td>
                <td>
                  {e.formation_date
                    ? new Date(e.formation_date + 'T00:00:00').toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : '\u2014'}
                </td>
                <td>
                  <span
                    className="badge"
                    style={{
                      background:
                        e.status === 'active'
                          ? 'rgba(0, 200, 150, 0.15)'
                          : 'rgba(255, 80, 80, 0.15)',
                      color:
                        e.status === 'active' ? 'var(--green)' : 'var(--red)',
                      padding: '0.2rem 0.6rem',
                      borderRadius: 4,
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      textTransform: 'capitalize',
                    }}
                  >
                    {e.status}
                  </span>
                </td>
                <td
                  style={{
                    textAlign: 'right',
                    fontWeight: 600,
                    fontFamily: 'var(--font-mono)',
                    color: e.unit_count > 0 ? 'var(--teal)' : 'var(--text-muted)',
                  }}
                >
                  {num(e.unit_count)}
                </td>
              </tr>
            ))}
            {entities.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    textAlign: 'center',
                    padding: '2rem',
                    color: 'var(--text-muted)',
                  }}
                >
                  No entities yet. Click &quot;+ Create Entity&quot; to get
                  started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ================================================================
   ENTITY UNITS TAB
   ================================================================ */

function EntityUnitsTab({ entityId, entityName }: { entityId: number; entityName: string }) {
  const { data: allUnits = [], isLoading } = useQuery<PortfolioUnit[]>({
    queryKey: ['portfolio'],
    queryFn: () => api.get('/portfolio').then((r) => r.data),
  });

  const entityUnits = useMemo(
    () => allUnits.filter((u) => u.entity_id === entityId),
    [allUnits, entityId],
  );

  const computeNOI = (u: PortfolioUnit) =>
    u.monthly_rent - u.monthly_hoa - (u.monthly_insurance / 12) - (u.monthly_tax / 12);

  const tenantBadge = (status: string | null) => {
    if (!status) return { label: 'Vacant', color: 'var(--text-muted)' };
    if (status === 'active') return { label: 'Active', color: 'var(--green)' };
    if (status === 'month_to_month') return { label: 'M2M', color: 'var(--gold)' };
    if (status === 'expired') return { label: 'Expired', color: 'var(--red)' };
    return { label: status, color: 'var(--text-muted)' };
  };

  /* Totals */
  const totalPurchase = entityUnits.reduce((s, u) => s + u.purchase_price, 0);
  const totalRent = entityUnits.reduce((s, u) => s + u.monthly_rent, 0);
  const totalHOA = entityUnits.reduce((s, u) => s + u.monthly_hoa, 0);
  const totalNOI = entityUnits.reduce((s, u) => s + computeNOI(u), 0);

  if (isLoading) {
    return <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading units...</p>;
  }

  return (
    <div>
      <h4 style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.6rem' }}>
        Units Assigned to {entityName} ({num(entityUnits.length)})
      </h4>

      {entityUnits.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          No units assigned to this entity. Assign units from the Portfolio page.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Unit #</th>
                <th style={{ textAlign: 'right' }}>Purchase Price</th>
                <th style={{ textAlign: 'right' }}>Monthly Rent</th>
                <th style={{ textAlign: 'right' }}>Monthly HOA</th>
                <th style={{ textAlign: 'right' }}>Monthly NOI</th>
                <th>Tenant Status</th>
              </tr>
            </thead>
            <tbody>
              {entityUnits.map((u) => {
                const noi = computeNOI(u);
                const badge = tenantBadge(u.tenant_status);
                return (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>{u.unit_number}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                      {fmt(u.purchase_price)}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>
                      {fmt(u.monthly_rent)}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--red)' }}>
                      {fmt(u.monthly_hoa)}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: noi >= 0 ? 'var(--green)' : 'var(--red)' }}>
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
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                <td>Totals ({num(entityUnits.length)} units)</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                  {fmt(totalPurchase)}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>
                  {fmt(totalRent)}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--red)' }}>
                  {fmt(totalHOA)}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: totalNOI >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {fmt(totalNOI)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   ENTITY ACCOUNTING TAB
   ================================================================ */

function EntityAccountingTab({ entityId, entityName }: { entityId: number; entityName: string }) {
  /* Fetch portfolio units */
  const { data: allUnits = [], isLoading: unitsLoading } = useQuery<PortfolioUnit[]>({
    queryKey: ['portfolio'],
    queryFn: () => api.get('/portfolio').then((r) => r.data),
  });

  const entityUnits = useMemo(
    () => allUnits.filter((u) => u.entity_id === entityId),
    [allUnits, entityId],
  );

  const unitIds = useMemo(() => entityUnits.map((u) => u.id), [entityUnits]);

  /* Fetch renovations for each unit in this entity */
  const { data: allRenovations = [] } = useQuery<Renovation[]>({
    queryKey: ['entity-renovations', entityId, unitIds],
    queryFn: async () => {
      if (unitIds.length === 0) return [];
      const results: Renovation[] = [];
      for (const uid of unitIds) {
        const res = await api.get(`/portfolio/units/${uid}/renovations`);
        results.push(...res.data);
      }
      return results;
    },
    enabled: unitIds.length > 0,
  });

  /* Fetch actuals transactions for units in this entity */
  const { data: allActuals = [] } = useQuery<ActualTransaction[]>({
    queryKey: ['entity-actuals', entityId, unitIds],
    queryFn: async () => {
      if (unitIds.length === 0) return [];
      const results: ActualTransaction[] = [];
      for (const uid of unitIds) {
        const res = await api.get(`/actuals/transactions?unit_id=${uid}&reconciled=true&limit=500`);
        results.push(...res.data);
      }
      return results;
    },
    enabled: unitIds.length > 0,
  });

  // Fetch entity-level allocations (not tied to a unit) for this entity
  const { data: entityActuals = [] } = useQuery<ActualTransaction[]>({
    queryKey: ['entity-actuals-direct', entityId],
    queryFn: () => api.get(`/actuals/transactions?entity_id=${entityId}&reconciled=true&limit=2000`).then((r) => r.data),
  });

  /* ---------- Computed metrics ---------- */

  const totalAcquisition = entityUnits.reduce((s, u) => s + u.total_acquisition_cost, 0);
  const totalMonthlyRevenue = entityUnits.reduce((s, u) => s + u.monthly_rent, 0);
  const totalMonthlyHOA = entityUnits.reduce((s, u) => s + u.monthly_hoa, 0);
  const totalMonthlyInsurance = entityUnits.reduce((s, u) => s + (u.monthly_insurance / 12), 0);
  const totalMonthlyTax = entityUnits.reduce((s, u) => s + (u.monthly_tax / 12), 0);
  const totalMonthlyExpenses = totalMonthlyHOA + totalMonthlyInsurance + totalMonthlyTax;
  const netMonthlyIncome = totalMonthlyRevenue - totalMonthlyExpenses;
  const annualizedNOI = netMonthlyIncome * 12;
  const annualizedYield = totalAcquisition > 0 ? annualizedNOI / totalAcquisition : 0;

  const totalRenovationSpend = allRenovations.reduce(
    (s, r) => s + (r.actual_cost ?? r.estimated_cost),
    0,
  );

  /* ---------- Last 6 months cash flow table from actuals ---------- */

  const last6Months = useMemo(() => {
    const result = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleString('default', { month: 'short', year: 'numeric' });
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      result.push({ label, key });
    }
    return result;
  }, []);

  const actualsByMonth = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();
    for (const a of [...allActuals, ...entityActuals]) {
      const d = new Date(a.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const entry = map.get(key) || { income: 0, expense: 0 };
      if (a.amount >= 0) {
        entry.income += a.amount;
      } else {
        entry.expense += Math.abs(a.amount);
      }
      map.set(key, entry);
    }
    return map;
  }, [allActuals, entityActuals]);

  if (unitsLoading) {
    return <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading accounting data...</p>;
  }

  if (entityUnits.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        No units assigned to this entity. Financial data will appear once units are assigned.
      </div>
    );
  }

  return (
    <div>
      <h4 style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.6rem' }}>
        Financial Summary &mdash; {entityName}
      </h4>

      {/* Metric cards grid */}
      <div className="metrics-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="metric-card">
          <div className="metric-label">Total Acquisition Cost</div>
          <div className="metric-value teal">{fmt(totalAcquisition)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Monthly Revenue</div>
          <div className="metric-value green">{fmt(totalMonthlyRevenue)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Monthly Expenses</div>
          <div className="metric-value red">{fmt(totalMonthlyExpenses)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Net Monthly Income</div>
          <div className="metric-value" style={{ color: netMonthlyIncome >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {fmt(netMonthlyIncome)}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Annualized NOI</div>
          <div className="metric-value" style={{ color: annualizedNOI >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {fmt(annualizedNOI)}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Annualized Yield</div>
          <div className="metric-value accent">
            {(annualizedYield * 100).toFixed(2)}%
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Renovation Spend</div>
          <div className="metric-value" style={{ color: 'var(--gold)' }}>
            {fmt(totalRenovationSpend)}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Units in Entity</div>
          <div className="metric-value teal">{num(entityUnits.length)}</div>
        </div>
      </div>

      {/* Expense breakdown */}
      <h4 style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.6rem' }}>
        Monthly Expense Breakdown
      </h4>
      <div style={formRowStyle}>
        <div style={formGroupStyle}>
          <span style={labelStyle}>HOA</span>
          <span style={{ color: 'var(--red)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{fmt(totalMonthlyHOA)}</span>
        </div>
        <div style={formGroupStyle}>
          <span style={labelStyle}>Insurance</span>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{fmt(totalMonthlyInsurance)}</span>
        </div>
        <div style={formGroupStyle}>
          <span style={labelStyle}>Property Tax</span>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{fmt(totalMonthlyTax)}</span>
        </div>
        <div style={formGroupStyle}>
          <span style={labelStyle}>Total Monthly Expenses</span>
          <span style={{ color: 'var(--red)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{fmt(totalMonthlyExpenses)}</span>
        </div>
      </div>

      {/* Last 6 months cash flow table (actuals) */}
      {allActuals.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <h4 style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.6rem' }}>
            Last 6 Months &mdash; Actual Cash Flows
          </h4>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th style={{ textAlign: 'right' }}>Income</th>
                  <th style={{ textAlign: 'right' }}>Expenses</th>
                  <th style={{ textAlign: 'right' }}>Net</th>
                </tr>
              </thead>
              <tbody>
                {last6Months.map((m) => {
                  const entry = actualsByMonth.get(m.key);
                  const income = entry?.income ?? 0;
                  const expense = entry?.expense ?? 0;
                  const net = income - expense;
                  const hasData = entry != null;
                  return (
                    <tr key={m.key}>
                      <td>{m.label}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: hasData ? 'var(--green)' : 'var(--text-muted)' }}>
                        {hasData ? fmt(income) : '\u2014'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: hasData ? 'var(--red)' : 'var(--text-muted)' }}>
                        {hasData ? fmt(expense) : '\u2014'}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: hasData ? (net >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)' }}>
                        {hasData ? fmt(net) : '\u2014'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Projected 12-month summary (always show) */}
      <div style={{ marginTop: '1.5rem' }}>
        <h4 style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.6rem' }}>
          12-Month Projected Summary
        </h4>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Line Item</th>
                <th style={{ textAlign: 'right' }}>Monthly</th>
                <th style={{ textAlign: 'right' }}>Annual</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Rental Revenue</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>{fmt(totalMonthlyRevenue)}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>{fmt(totalMonthlyRevenue * 12)}</td>
              </tr>
              <tr>
                <td>HOA Fees</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--red)' }}>({fmt(totalMonthlyHOA)})</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--red)' }}>({fmt(totalMonthlyHOA * 12)})</td>
              </tr>
              <tr>
                <td>Insurance</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>({fmt(totalMonthlyInsurance)})</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>({fmt(totalMonthlyInsurance * 12)})</td>
              </tr>
              <tr>
                <td>Property Tax</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>({fmt(totalMonthlyTax)})</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>({fmt(totalMonthlyTax * 12)})</td>
              </tr>
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                <td>Net Operating Income</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: netMonthlyIncome >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {fmt(netMonthlyIncome)}
                </td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: annualizedNOI >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {fmt(annualizedNOI)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
