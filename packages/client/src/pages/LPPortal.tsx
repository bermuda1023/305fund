import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtCurrency, fmtNumber } from '../lib/format';
import { formatNumberInput } from '../lib/numberInput';
import DocumentUpload from '../components/DocumentUpload';
import { downloadFromEndpoint } from '../lib/files';

interface LPAccount {
  id: number;
  name: string;
  entity_name: string | null;
  commitment: number;
  called_capital: number;
  distributions: number;
  ownership_pct: number;
  status: string;
}

interface Transaction {
  id: number;
  type: string;
  amount: number;
  date: string;
  quarter: string;
  notes: string | null;
}

interface CapitalCallItem {
  id: number;
  call_number: number;
  amount: number;
  status: string;
  due_date: string;
  purpose: string;
}

interface Performance {
  fundIRR: number | null;
  fundMOIC: number;
  unitsOwned: number;
  ownershipPct: number;
  totalInvested: number;
  annualNOI: number;
}

interface Investor {
  id: number;
  name: string;
  entity_name: string | null;
  email: string;
  phone: string | null;
  commitment: number;
  called_capital: number;
  distributions: number;
  ownership_pct: number;
  status: string;
  notes: string | null;
}

interface AllCapitalCall {
  id: number;
  call_number: number;
  total_amount: number;
  call_date: string;
  due_date: string;
  purpose: string;
  status: string;
  received_count: number;
  total_items: number;
  custom_email_subject?: string | null;
  custom_email_body?: string | null;
}

interface CapitalCallLineItem {
  id: number;
  investor_name: string;
  amount: number;
  status: string;
  received_amount?: number | null;
  receipt_reference?: string | null;
  bank_txn_id?: string | null;
}

interface CapitalRaisingContact {
  first_name: string;
  last_name: string;
  company: string;
  location: string;
  email: string;
  conference: string;
  title: string;
}

interface CapitalRaisingStats {
  sentToday: number;
  totalSent: number;
}

interface CapitalRaisingSendResult {
  sentCount: number;
  failedCount: number;
  totalContacts: number;
  skippedAlreadySentCount: number;
  fromEmail?: string;
  provider?: string;
  firstFailureReason?: string | null;
  failedReasons?: string[];
}

function getDefaultCallSubject(callNumber: number) {
  return `Capital Call {{call_number}} — {{fund_name}}`.replace('{{call_number}}', String(callNumber));
}

function getDefaultCallBody() {
  return 'Hi {{lp_name}},\n\nThis is a capital call notice for {{fund_name}}.\n\nCall #{{call_number}}\nTotal call amount: ${{call_amount}}\nYour amount: ${{lp_amount}}\nDue date: {{due_date}}\nPurpose: {{purpose}}\n\nPlease remit funds by the due date.\n\nThank you.';
}

interface LPDocument {
  id: number;
  name: string;
  category: string;
  file_path: string;
  uploaded_at: string;
  requires_signature: number;
  signed_at: string | null;
}

interface LPMarksRow {
  month: string;
  contributions: number;
  distributions: number;
  net: number;
  ending_balance: number;
  lp_nav?: number;
  tvpi?: number;
}

interface LPMarksResponse {
  irr: number | null;
  moic: number;
  ending_balance: number;
  total_contributed: number;
  total_distributed: number;
  monthly: LPMarksRow[];
  nav?: {
    series_id: string;
    latest_fund_nav: number;
    latest_lp_nav: number;
    latest_fred_date: string | null;
    latest_fred_value: number | null;
    fred_points: number;
  };
}

interface LedgerRow {
  id: number;
  date: string;
  amount: number;
  category: string;
  description: string | null;
  reconciled: number;
  statement_ref?: string | null;
  unit_number?: string | null;
  entity_name?: string | null;
  renovation_description?: string | null;
  lp_name?: string | null;
  call_number?: number | null;
  assignment_scope: 'unit' | 'entity' | 'lp' | 'fund';
  upload_filename?: string | null;
}

const fmt = fmtCurrency;
const num = fmtNumber;
const LIVE_REFRESH_MS = 10_000;

function InfoTip({ text }: { text: string }) {
  return (
    <span
      title={text}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        borderRadius: 9,
        border: '1px solid var(--border)',
        color: 'var(--text-muted)',
        fontSize: 12,
        cursor: 'help',
        userSelect: 'none',
        marginLeft: 8,
      }}
      aria-label="Info"
    >
      i
    </span>
  );
}

/* ─── GP Investor Management Section ─────────────────────────────── */

function GPInvestorSection() {
  const queryClient = useQueryClient();
  const [showOnboardForm, setShowOnboardForm] = useState(false);
  const [expandedInvestorDocsId, setExpandedInvestorDocsId] = useState<number | null>(null);
  const [onboardForm, setOnboardForm] = useState({
    name: '',
    entityName: '',
    email: '',
    phone: '',
    commitment: '',
    notes: '',
  });

  const { data: investors = [] } = useQuery<Investor[]>({
    queryKey: ['gp-investors'],
    queryFn: () => api.get('/lp/investors').then((r) => r.data),
    refetchInterval: LIVE_REFRESH_MS,
  });

  const onboardMutation = useMutation({
    mutationFn: (payload: typeof onboardForm) =>
      api.post('/lp/investors', payload).then((r) => r.data),
    onSuccess: (data: { tempPassword?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['gp-investors'] });
      queryClient.invalidateQueries({ queryKey: ['lp-account'] });
      queryClient.invalidateQueries({ queryKey: ['lp-marks'] });
      queryClient.invalidateQueries({ queryKey: ['lp-performance'] });
      if (data.tempPassword) {
        alert(`Investor onboarded successfully!\n\nTemporary password: ${data.tempPassword}\n\nPlease share this securely with the investor.`);
      }
      setOnboardForm({ name: '', entityName: '', email: '', phone: '', commitment: '', notes: '' });
      setShowOnboardForm(false);
    },
    onError: (err: any) => {
      window.alert(err?.response?.data?.error || 'Failed to onboard investor.');
    },
  });

  const updateInvestorStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'active' | 'pending' }) =>
      api.patch(`/lp/investors/${id}/status`, { status }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gp-investors'] });
    },
    onError: (err: any) => {
      window.alert(err?.response?.data?.error || 'Failed to update investor status.');
    },
  });

  const removeInvestorMutation = useMutation({
    mutationFn: ({ id, confirmText }: { id: number; confirmText: string }) =>
      api.post(`/lp/investors/${id}/remove`, { confirmText }).then((r) => r.data),
    onSuccess: (result: { id?: number; status?: string }) => {
      const removedId = Number(result?.id);
      if (Number.isFinite(removedId) && removedId > 0) {
        queryClient.setQueryData<Investor[]>(['gp-investors'], (prev) =>
          Array.isArray(prev) ? prev.filter((inv) => inv.id !== removedId) : prev
        );
      }
      queryClient.invalidateQueries({ queryKey: ['gp-investors'] });
      window.alert('LP removed successfully.');
    },
    onError: (err: any) => {
      window.alert(err?.response?.data?.error || 'Failed to remove LP.');
    },
  });

  const visibleInvestors = investors.filter((i) => i.status !== 'inactive' && i.status !== 'removed');
  const totalCommitments = visibleInvestors.reduce((s, i) => s + i.commitment, 0);
  const totalCalled = visibleInvestors.reduce((s, i) => s + i.called_capital, 0);
  const totalDistributed = visibleInvestors.reduce((s, i) => s + i.distributions, 0);

  return (
    <>
      <div className="card mb-4">
        <div className="card-header flex-between">
          <span className="card-title">Investor Management</span>
          <span className="badge" style={{ background: 'var(--teal)', color: '#fff' }}>{num(visibleInvestors.length)} LPs</span>
        </div>

        {/* Summary metrics */}
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-label">Total Commitments</div>
            <div className="metric-value">{fmt(totalCommitments)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Total Called</div>
            <div className="metric-value teal">{fmt(totalCalled)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Total Distributed</div>
            <div className="metric-value green">{fmt(totalDistributed)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Number of LPs</div>
            <div className="metric-value accent">{num(visibleInvestors.length)}</div>
          </div>
        </div>

        {/* Onboard Investor toggle */}
        <div style={{ padding: '0 1.25rem 1rem' }}>
          <button
            className="btn btn-primary"
            onClick={() => setShowOnboardForm(!showOnboardForm)}
          >
            {showOnboardForm ? 'Cancel' : '+ Onboard Investor'}
          </button>
        </div>

        {/* Onboard form (collapsible) */}
        {showOnboardForm && (
          <form
            style={{ padding: '0 1.25rem 1.25rem' }}
            onSubmit={(e) => {
              e.preventDefault();
              onboardMutation.mutate(onboardForm);
            }}
          >
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Full Name *</label>
                <input
                  className="form-input"
                  required
                  value={onboardForm.name}
                  onChange={(e) => setOnboardForm({ ...onboardForm, name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Entity Name</label>
                <input
                  className="form-input"
                  value={onboardForm.entityName}
                  onChange={(e) => setOnboardForm({ ...onboardForm, entityName: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Email *</label>
                <input
                  className="form-input"
                  type="email"
                  required
                  value={onboardForm.email}
                  onChange={(e) => setOnboardForm({ ...onboardForm, email: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input
                  className="form-input"
                  value={onboardForm.phone}
                  onChange={(e) => setOnboardForm({ ...onboardForm, phone: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Commitment ($) *</label>
                <input
                  className="form-input"
                  type="text"
                  inputMode="numeric"
                  required
                  min="0"
                  value={formatNumberInput(onboardForm.commitment)}
                  onChange={(e) => setOnboardForm({ ...onboardForm, commitment: e.target.value.replace(/,/g, '') })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Notes</label>
                <input
                  className="form-input"
                  value={onboardForm.notes}
                  onChange={(e) => setOnboardForm({ ...onboardForm, notes: e.target.value })}
                />
              </div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={onboardMutation.isPending}>
              {onboardMutation.isPending ? 'Onboarding...' : 'Onboard Investor'}
            </button>
          </form>
        )}

        {/* Investors table */}
        {visibleInvestors.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Entity</th>
                <th>Email</th>
                <th>Commitment</th>
                <th>Called</th>
                <th>Distributions</th>
                <th>Ownership %</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleInvestors.map((inv) => (
                [
                  <tr key={inv.id}>
                    <td style={{ fontWeight: 600 }}>{inv.name}</td>
                    <td>{inv.entity_name || '—'}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{inv.email}</td>
                    <td>{fmt(inv.commitment)}</td>
                    <td style={{ color: 'var(--teal)' }}>{fmt(inv.called_capital)}</td>
                    <td style={{ color: 'var(--green)' }}>{fmt(inv.distributions)}</td>
                    <td>{(inv.ownership_pct * 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
                    <td>
                      {inv.status === 'pending' ? (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.2rem 0.65rem', fontSize: '0.78rem' }}
                          onClick={() =>
                            updateInvestorStatusMutation.mutate({
                              id: inv.id,
                              status: 'active',
                            })
                          }
                          title="Mark this investor as Active"
                          disabled={updateInvestorStatusMutation.isPending}
                        >
                          {updateInvestorStatusMutation.isPending ? 'Updating...' : 'Set Active'}
                        </button>
                      ) : inv.status === 'active' ? (
                        <span
                          className="badge"
                          style={{
                            background: 'rgba(16,185,129,0.15)',
                            color: 'var(--green)',
                          }}
                        >
                          active
                        </span>
                      ) : (
                        <span
                          className="badge"
                          style={{
                            background: 'rgba(100,116,139,0.2)',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {inv.status}
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                          onClick={() =>
                            setExpandedInvestorDocsId(expandedInvestorDocsId === inv.id ? null : inv.id)
                          }
                        >
                          {expandedInvestorDocsId === inv.id ? 'Hide Docs' : 'Docs'}
                        </button>
                        {inv.status !== 'inactive' && inv.status !== 'removed' && (
                          <button
                            className="btn"
                            style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', borderColor: 'var(--red)', color: 'var(--red)' }}
                            disabled={removeInvestorMutation.isPending}
                            onClick={() => {
                              const emailPart = String(inv.email || '').trim().toLowerCase();
                              const phrase = emailPart ? `REMOVE ${emailPart}` : `REMOVE LP-${inv.id}`;
                              const entered = window.prompt(
                                `To remove this LP, type exactly:\n${phrase}`,
                                ''
                              );
                              if (!entered) return;
                              removeInvestorMutation.mutate({ id: inv.id, confirmText: entered });
                            }}
                            title="Guarded soft-remove (requires typed confirmation phrase)"
                          >
                            Remove LP
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>,
                  expandedInvestorDocsId === inv.id && (
                    <tr key={`docs-${inv.id}`}>
                      <td colSpan={9} style={{ padding: 0 }}>
                        <div
                          style={{
                            background: 'var(--bg-tertiary)',
                            padding: '1rem 1.25rem',
                            borderTop: '1px solid var(--border)',
                            borderBottom: '1px solid var(--border)',
                          }}
                        >
                          <h4 style={{ margin: '0 0 0.75rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            Investor Documents — {inv.name}
                          </h4>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '0.65rem' }}>
                            Suggested categories: KYC, AML, Accreditation, PPM, Subscription Docs, Signed Investment Docs, and Tax Forms.
                          </div>
                          <DocumentUpload parentType="lp" parentId={inv.id} />
                        </div>
                      </td>
                    </tr>
                  ),
                ]
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/* ─── GP Capital Call Management Section ─────────────────────────── */

function GPCapitalCallSection() {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [expandedCallId, setExpandedCallId] = useState<number | null>(null);
  const [sendAsBcc, setSendAsBcc] = useState(true);
  const [createForm, setCreateForm] = useState({
    totalAmount: '',
    callDate: '',
    dueDate: '',
    purpose: '',
    letterTemplate: '',
    customEmailSubject: '',
    customEmailBody: '',
  });

  const { data: capitalCalls = [] } = useQuery<AllCapitalCall[]>({
    queryKey: ['gp-capital-calls-all'],
    queryFn: () => api.get('/lp/capital-calls/all').then((r) => r.data),
    refetchInterval: LIVE_REFRESH_MS,
  });

  const { data: expandedItems = [] } = useQuery<CapitalCallLineItem[]>({
    queryKey: ['gp-capital-call-items', expandedCallId],
    queryFn: () =>
      api.get(`/lp/capital-calls/${expandedCallId}/items`).then((r) => r.data),
    enabled: expandedCallId !== null,
    refetchInterval: expandedCallId !== null ? LIVE_REFRESH_MS : false,
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof createForm) =>
      api.post('/lp/capital-calls/create', payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gp-capital-calls-all'] });
      setCreateForm({
        totalAmount: '', callDate: '', dueDate: '', purpose: '', letterTemplate: '',
        customEmailSubject: '', customEmailBody: '',
      });
      setShowCreateForm(false);
    },
  });

  const sendCallMutation = useMutation({
    mutationFn: (callId: number) =>
      api.post(`/lp/capital-calls/${callId}/send`, { bccMode: sendAsBcc }).then((r) => r.data),
    onSuccess: (result: { sentCount?: number; failedCount?: number; message?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['gp-capital-calls-all'] });
      queryClient.invalidateQueries({ queryKey: ['gp-capital-call-items', expandedCallId] });
      queryClient.invalidateQueries({ queryKey: ['lp-capital-calls'] });
      queryClient.invalidateQueries({ queryKey: ['gp-investors'] });
      queryClient.invalidateQueries({ queryKey: ['lp-account'] });
      window.alert(
        `Capital call send complete.\nSent: ${result?.sentCount ?? 0}\nFailed: ${result?.failedCount ?? 0}`
      );
    },
    onError: (err: any) => {
      window.alert(err?.response?.data?.error || 'Failed to send capital call emails.');
    },
  });

  const markReceivedMutation = useMutation({
    mutationFn: ({ callId, itemId, receivedAmount, receiptReference, bankTxnId }: {
      callId: number; itemId: number; receivedAmount?: number; receiptReference?: string; bankTxnId?: string;
    }) =>
      api.put(`/lp/capital-calls/${callId}/items/${itemId}/received`, {
        receivedAmount, receiptReference, bankTxnId,
      }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gp-capital-calls-all'] });
      queryClient.invalidateQueries({ queryKey: ['gp-capital-call-items', expandedCallId] });
      queryClient.invalidateQueries({ queryKey: ['gp-investors'] });
      queryClient.invalidateQueries({ queryKey: ['lp-account'] });
      queryClient.invalidateQueries({ queryKey: ['lp-transactions'] });
    },
  });

  return (
    <div className="card mb-4">
      <div className="card-header flex-between">
        <span className="card-title">Capital Call Management</span>
        <span className="badge" style={{ background: 'var(--gold)', color: '#000' }}>
          {num(capitalCalls.length)} calls
        </span>
      </div>

      {/* Create Capital Call toggle */}
      <div style={{ padding: '0 1.25rem 1rem' }}>
        <button
          className="btn btn-primary"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          {showCreateForm ? 'Cancel' : '+ Create Capital Call'}
        </button>
      </div>

      {/* Create form (collapsible) */}
      {showCreateForm && (
        <form
          style={{ padding: '0 1.25rem 1.25rem' }}
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(createForm);
          }}
        >
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Total Amount ($) *</label>
              <input
                className="form-input"
                type="text"
                inputMode="numeric"
                required
                min="0"
                value={formatNumberInput(createForm.totalAmount)}
                onChange={(e) => setCreateForm({ ...createForm, totalAmount: e.target.value.replace(/,/g, '') })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Purpose *</label>
              <input
                className="form-input"
                required
                value={createForm.purpose}
                onChange={(e) => setCreateForm({ ...createForm, purpose: e.target.value })}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Call Date *</label>
              <input
                className="form-input"
                type="date"
                required
                value={createForm.callDate}
                onChange={(e) => setCreateForm({ ...createForm, callDate: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Due Date *</label>
              <input
                className="form-input"
                type="date"
                required
                value={createForm.dueDate}
                onChange={(e) => setCreateForm({ ...createForm, dueDate: e.target.value })}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Letter Template</label>
              <input
                className="form-input"
                placeholder="Optional template name or reference"
                value={createForm.letterTemplate}
                onChange={(e) => setCreateForm({ ...createForm, letterTemplate: e.target.value })}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Custom Email Subject</label>
              <input
                className="form-input"
                placeholder="Capital Call Notice — [Fund Name]"
                value={createForm.customEmailSubject}
                onChange={(e) => setCreateForm({ ...createForm, customEmailSubject: e.target.value })}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Custom Email Body</label>
              <textarea
                className="form-input"
                rows={4}
                placeholder={'Example:\nHi {{lp_name}},\nYour allocation for call #{{call_number}} is ${{lp_amount}} due {{due_date}}.\nPurpose: {{purpose}}'}
                value={createForm.customEmailBody}
                onChange={(e) => setCreateForm({ ...createForm, customEmailBody: e.target.value })}
              />
            </div>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.55rem' }}>
            Mail merge tags: {'{{lp_name}}'}, {'{{investor_name}}'}, {'{{fund_name}}'}, {'{{call_number}}'}, {'{{call_amount}}'}, {'{{lp_amount}}'}, {'{{due_date}}'}, {'{{purpose}}'}
          </div>
          <button className="btn btn-primary" type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating...' : 'Create Capital Call'}
          </button>
        </form>
      )}

      {/* Capital calls table */}
      <div style={{ padding: '0 1.25rem 0.8rem' }}>
        <label style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
          <input
            type="checkbox"
            checked={sendAsBcc}
            onChange={(e) => setSendAsBcc(e.target.checked)}
            style={{ marginRight: '0.35rem' }}
          />
          Default to BCC when sending capital call emails
        </label>
      </div>
      {capitalCalls.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Call #</th>
              <th>Total Amount</th>
              <th>Call Date</th>
              <th>Due Date</th>
              <th>Purpose</th>
              <th>Status</th>
              <th>Received / Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {capitalCalls.map((cc) => (
              <>
                <tr key={cc.id}>
                  <td style={{ fontWeight: 600 }}>Call #{num(cc.call_number)}</td>
                  <td style={{ fontWeight: 600 }}>{fmt(cc.total_amount)}</td>
                  <td>{cc.call_date}</td>
                  <td>{cc.due_date}</td>
                  <td>{cc.purpose}</td>
                  <td>
                    <span
                      className="badge"
                      style={{
                        background:
                          cc.status === 'completed'
                            ? 'rgba(16,185,129,0.15)'
                            : cc.status === 'sent'
                              ? 'rgba(234,179,8,0.15)'
                              : 'rgba(100,116,139,0.15)',
                        color:
                          cc.status === 'completed'
                            ? 'var(--green)'
                            : cc.status === 'sent'
                              ? 'var(--gold)'
                              : 'var(--text-muted)',
                      }}
                    >
                      {cc.status}
                    </span>
                  </td>
                  <td>
                    <span style={{ color: 'var(--teal)' }}>{num(cc.received_count)}</span>
                    <span style={{ color: 'var(--text-muted)' }}> / {num(cc.total_items)}</span>
                  </td>
                  <td>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                      onClick={() =>
                        setExpandedCallId(expandedCallId === cc.id ? null : cc.id)
                      }
                    >
                      {expandedCallId === cc.id ? 'Collapse' : 'Expand'}
                    </button>
                    {(cc.status === 'draft' || cc.status === 'partially_received') && (
                      <button
                        className="btn btn-primary"
                        style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', marginLeft: '0.35rem' }}
                        onClick={() => sendCallMutation.mutate(cc.id)}
                        disabled={sendCallMutation.isPending}
                      >
                        {sendCallMutation.isPending ? 'Sending...' : 'Send to All LPs'}
                      </button>
                    )}
                  </td>
                </tr>
                {expandedCallId === cc.id && (
                  <tr key={`${cc.id}-detail`}>
                    <td colSpan={8} style={{ padding: 0 }}>
                      <div
                        style={{
                          background: 'var(--bg-tertiary)',
                          padding: '1rem 1.25rem',
                          borderTop: '1px solid var(--border)',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <h4 style={{ margin: '0 0 0.75rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                          Per-LP Allocations — Call #{cc.call_number}
                        </h4>
                        <div
                          style={{
                            marginBottom: '0.85rem',
                            padding: '0.75rem',
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            background: 'var(--bg-secondary)',
                          }}
                        >
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                            Email Subject
                          </div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', marginBottom: '0.6rem' }}>
                            {cc.custom_email_subject?.trim() || getDefaultCallSubject(cc.call_number)}
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                            Email / Letter Message
                          </div>
                          <pre
                            style={{
                              whiteSpace: 'pre-wrap',
                              margin: 0,
                              fontFamily: 'var(--font-mono)',
                              fontSize: '0.78rem',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {cc.custom_email_body?.trim() || getDefaultCallBody()}
                          </pre>
                        </div>
                        {expandedItems.length > 0 ? (
                          <table className="data-table" style={{ marginBottom: 0 }}>
                            <thead>
                              <tr>
                                <th>Investor</th>
                                <th>Amount</th>
                                <th>Status</th>
                                <th>Reconciliation</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {expandedItems.map((item) => (
                                <tr key={item.id}>
                                  <td style={{ fontWeight: 600 }}>{item.investor_name}</td>
                                  <td>{fmt(item.amount)}</td>
                                  <td>
                                    <span
                                      className="badge"
                                      style={{
                                        background:
                                          item.status === 'received'
                                            ? 'rgba(16,185,129,0.15)'
                                            : 'rgba(234,179,8,0.15)',
                                        color:
                                          item.status === 'received'
                                            ? 'var(--green)'
                                            : 'var(--gold)',
                                      }}
                                    >
                                      {item.status}
                                    </span>
                                  </td>
                                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                    {item.receipt_reference ? `Ref: ${item.receipt_reference}` : '—'}
                                    {item.bank_txn_id ? ` · Bank Txn: ${item.bank_txn_id}` : ''}
                                  </td>
                                  <td>
                                    {item.status !== 'received' && (
                                      <button
                                        className="btn btn-primary"
                                        style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                                        disabled={markReceivedMutation.isPending}
                                        onClick={() => {
                                          const amtRaw = window.prompt('Received amount (leave blank for full amount):', String(item.amount));
                                          const ref = window.prompt('Bank or card reference ID (optional):', '');
                                          const txn = window.prompt('Bank transaction ID (optional):', '');
                                          const parsedAmt = amtRaw && amtRaw.trim() !== '' ? Number(amtRaw) : undefined;
                                          if (parsedAmt != null && Number.isNaN(parsedAmt)) return;
                                          markReceivedMutation.mutate({
                                            callId: cc.id,
                                            itemId: item.id,
                                            receivedAmount: parsedAmt,
                                            receiptReference: ref || undefined,
                                            bankTxnId: txn || undefined,
                                          });
                                        }}
                                      >
                                        Mark Received
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            No line items found for this call.
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function GPCapitalRaisingSection() {
  const [contacts, setContacts] = useState<CapitalRaisingContact[]>([]);
  const [contactFileName, setContactFileName] = useState('');
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [subject, setSubject] = useState('Intro — {{fund_name}}');
  const [body, setBody] = useState(
    'Hi {{first_name}},\n\nGreat meeting you at {{conference}}.\n\nI wanted to share {{fund_name}} and see if this fits your current mandate.\n\nBest,\n305 Opportunities Fund'
  );
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [fromOverride, setFromOverride] = useState('');
  const [fundName, setFundName] = useState('305 Opportunities Fund');
  const [batchSize, setBatchSize] = useState(50);
  const [delayMs, setDelayMs] = useState(0);
  const [statusText, setStatusText] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: raisingStats } = useQuery<CapitalRaisingStats>({
    queryKey: ['capital-raising-stats'],
    queryFn: () => api.get('/lp/capital-raising/stats').then((r) => r.data),
    refetchInterval: LIVE_REFRESH_MS,
  });

  const parseContactsMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const response = await api.post('/lp/capital-raising/contacts/parse', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data as {
        filename: string;
        totalContacts: number;
        skippedRows: number;
        contacts: CapitalRaisingContact[];
      };
    },
    onSuccess: (result) => {
      setContactFileName(result.filename);
      setContacts(result.contacts || []);
      setStatusText(`Loaded ${num(result.totalContacts)} contacts (${num(result.skippedRows)} skipped).`);
    },
    onError: (err: any) => {
      window.alert(err?.response?.data?.error || 'Failed to parse contact file.');
    },
  });

  const sendCampaignMutation = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('subject', subject);
      form.append('body', body);
      form.append('cc', cc);
      form.append('bcc', bcc);
      if (fromOverride.trim()) form.append('from', fromOverride.trim());
      form.append('fundName', fundName);
      form.append('batchSize', String(batchSize));
      form.append('delayMs', String(delayMs));
      form.append('contacts', JSON.stringify(contacts));
      if (attachmentFile) form.append('attachment', attachmentFile);
      const response = await api.post('/lp/capital-raising/send', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return response.data as CapitalRaisingSendResult;
    },
    onSuccess: (result) => {
      const reasonHint = result.firstFailureReason
        ? `\n\nFirst failure reason:\n${result.firstFailureReason}`
        : '';
      const senderInfo = result.fromEmail
        ? `\nSender: ${result.fromEmail}${result.provider ? ` via ${result.provider}` : ''}`
        : '';
      setStatusText(
        `Campaign complete. Sent ${num(result.sentCount)}, failed ${num(result.failedCount)}, skipped already sent ${num(result.skippedAlreadySentCount ?? 0)}.${
          result.firstFailureReason ? ` First failure: ${result.firstFailureReason}` : ''
        }`
      );
      queryClient.invalidateQueries({ queryKey: ['capital-raising-stats'] });
      window.alert(
        `Capital raising send complete.\nSent: ${result.sentCount}\nFailed: ${result.failedCount}\nSkipped (already sent): ${result.skippedAlreadySentCount ?? 0}${senderInfo}${reasonHint}`
      );
    },
    onError: (err: any) => {
      window.alert(err?.response?.data?.error || 'Failed to send campaign.');
    },
  });

  return (
    <div className="card mb-4">
      <div className="card-header flex-between">
        <span className="card-title">Capital Raising Mail Merge</span>
        <span className="badge" style={{ background: 'var(--teal)', color: '#fff' }}>
          {num(contacts.length)} contacts
        </span>
      </div>

      <div style={{ padding: '0 1.25rem 1rem' }}>
        {raisingStats && (
          <div
            style={{
              marginBottom: '0.85rem',
              padding: '0.7rem 0.8rem',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--bg-secondary)',
              fontSize: '0.82rem',
              color: 'var(--text-secondary)',
            }}
          >
            Sent today: {num(raisingStats.sentToday)} · Total sent historically: {num(raisingStats.totalSent)}
          </div>
        )}
        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Upload Contact File (.xlsx, .xlsm, .csv)</label>
            <input
              className="form-input"
              type="file"
              accept=".xlsx,.xlsm,.csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                parseContactsMutation.mutate(file);
              }}
            />
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
              Columns expected: First Name, Last Name, Company, Location, Email, Conference, Title.
            </div>
            {contactFileName && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                Loaded file: {contactFileName}
              </div>
            )}
          </div>
        </div>

        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Email Subject *</label>
            <input
              className="form-input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Intro — {{fund_name}}"
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Email Body *</label>
            <textarea
              className="form-input"
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={'Hi {{first_name}},\n\n...'}
            />
          </div>
        </div>

        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.55rem' }}>
          Mail merge tags: {'{{first_name}}'}, {'{{last_name}}'}, {'{{full_name}}'}, {'{{company}}'}, {'{{location}}'}, {'{{email}}'}, {'{{conference}}'}, {'{{title}}'}, {'{{fund_name}}'}
        </div>

        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">From (sender email)</label>
            <input
              className="form-input"
              value={fromOverride}
              onChange={(e) => setFromOverride(e.target.value)}
              placeholder="info@305opportunityfund.com"
            />
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Must be a verified Single Sender (or part of an authenticated domain) in SendGrid/Resend. Leave blank to use the server FROM_EMAIL default.
            </div>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">CC (comma separated)</label>
            <input className="form-input" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="lance@305opportunityfund.com, team@fund.com" />
          </div>
          <div className="form-group">
            <label className="form-label">BCC (comma separated)</label>
            <input className="form-input" value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="audit@fund.com" />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Fund Name</label>
            <input className="form-input" value={fundName} onChange={(e) => setFundName(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Batch Size</label>
            <input
              className="form-input"
              type="number"
              min={1}
              max={200}
              value={batchSize}
              onChange={(e) => setBatchSize(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Delay Between Batches (ms)</label>
            <input
              className="form-input"
              type="number"
              min={0}
              value={delayMs}
              onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Attachment (optional)</label>
            <input
              className="form-input"
              type="file"
              onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-primary"
            disabled={
              parseContactsMutation.isPending
              || sendCampaignMutation.isPending
              || contacts.length === 0
              || !subject.trim()
              || !body.trim()
            }
            onClick={() => sendCampaignMutation.mutate()}
          >
            {sendCampaignMutation.isPending ? 'Sending Campaign...' : 'Send Campaign'}
          </button>
        </div>

        {statusText && (
          <div style={{ marginTop: '0.65rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            {statusText}
          </div>
        )}
      </div>

      {contacts.length > 0 && (
        <div style={{ padding: '0 1.25rem 1rem' }}>
          <h4 style={{ margin: '0 0 0.55rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Contact Preview
          </h4>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th>Location</th>
                <th>Email</th>
                <th>Conference</th>
                <th>Title</th>
              </tr>
            </thead>
            <tbody>
              {contacts.slice(0, 10).map((c, idx) => (
                <tr key={`${c.email}-${idx}`}>
                  <td>{`${c.first_name || ''} ${c.last_name || ''}`.trim() || '—'}</td>
                  <td>{c.company || '—'}</td>
                  <td>{c.location || '—'}</td>
                  <td>{c.email}</td>
                  <td>{c.conference || '—'}</td>
                  <td>{c.title || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {contacts.length > 10 && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.45rem' }}>
              Showing first 10 of {num(contacts.length)} contacts.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Main LP Portal Page ────────────────────────────────────────── */

export default function LPPortal({ adminMode = false }: { adminMode?: boolean }) {
  const { user } = useAuth();
  const [ledgerCategory, setLedgerCategory] = useState('');
  const [ledgerSearch, setLedgerSearch] = useState('');

  const { data: account } = useQuery<LPAccount>({
    queryKey: ['lp-account'],
    queryFn: () => api.get('/lp/account').then((r) => r.data),
    enabled: !adminMode,
    refetchInterval: !adminMode ? LIVE_REFRESH_MS : false,
  });

  const { data: transactions = [] } = useQuery<Transaction[]>({
    queryKey: ['lp-transactions'],
    queryFn: () => api.get('/lp/transactions').then((r) => r.data),
    enabled: !adminMode,
    refetchInterval: !adminMode ? LIVE_REFRESH_MS : false,
  });

  const { data: capitalCalls = [] } = useQuery<CapitalCallItem[]>({
    queryKey: ['lp-capital-calls'],
    queryFn: () => api.get('/lp/capital-calls').then((r) => r.data),
    enabled: !adminMode,
    refetchInterval: !adminMode ? LIVE_REFRESH_MS : false,
  });

  const { data: performance } = useQuery<Performance>({
    queryKey: ['lp-performance'],
    queryFn: () => api.get('/lp/performance').then((r) => r.data),
    refetchInterval: !adminMode ? LIVE_REFRESH_MS : false,
  });

  const { data: lpDocuments = [] } = useQuery<LPDocument[]>({
    queryKey: ['lp-documents'],
    queryFn: () => api.get('/lp/documents').then((r) => r.data),
    enabled: !adminMode,
    refetchInterval: !adminMode ? LIVE_REFRESH_MS : false,
  });

  const { data: marks } = useQuery<LPMarksResponse>({
    queryKey: ['lp-marks'],
    queryFn: () => api.get('/lp/marks').then((r) => r.data),
    enabled: !adminMode,
    refetchInterval: !adminMode ? LIVE_REFRESH_MS : false,
  });
  const { data: ledgerRows = [] } = useQuery<LedgerRow[]>({
    queryKey: ['lp-ledger', ledgerCategory, ledgerSearch],
    queryFn: () =>
      api.get('/lp/ledger', {
        params: {
          limit: 300,
          ...(ledgerCategory ? { category: ledgerCategory } : {}),
          ...(ledgerSearch ? { search: ledgerSearch } : {}),
        },
      }).then((r) => r.data),
    enabled: !adminMode,
    refetchInterval: !adminMode ? LIVE_REFRESH_MS : false,
  });

  const unfunded = (account?.commitment ?? 0) - (account?.called_capital ?? 0);
  const canShowIrr = String(account?.status || '').toLowerCase() === 'active' && (account?.called_capital ?? 0) > 0;

  const capitalPie = account ? [
    { name: 'Called', value: account.called_capital },
    { name: 'Unfunded', value: Math.max(0, unfunded) },
  ] : [];

  return (
    <div>
      <div className="page-header">
        <h2>{adminMode ? 'LP Administration' : 'Investor Portal'}</h2>
        <p>Welcome, {user?.name}</p>
      </div>

      {adminMode ? (
        <>
          <GPInvestorSection />
          <GPCapitalCallSection />
          <GPCapitalRaisingSection />
        </>
      ) : (
        <>

      {/* ── LP Sections (limited LP dashboard) ── */}

      {/* Capital Account Summary */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Commitment</div>
          <div className="metric-value">{fmt(account?.commitment ?? 0)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Called Capital</div>
          <div className="metric-value teal">{fmt(account?.called_capital ?? 0)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Unfunded</div>
          <div className="metric-value gold">{fmt(unfunded)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Distributions</div>
          <div className="metric-value green">{fmt(account?.distributions ?? 0)}</div>
        </div>
      </div>

      <div className="grid-2">
        {/* Capital Breakdown */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Capital Status</span>
          </div>
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={capitalPie} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${fmt(value)}`}>
                  <Cell fill="var(--teal)" />
                  <Cell fill="rgba(100,116,139,0.3)" />
                </Pie>
                <Tooltip
                  formatter={(v: number) => fmt(v)}
                  contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Ownership: {((account?.ownership_pct ?? 0) * 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
          </div>
        </div>

        {/* Fund Performance */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Fund Performance</span>
          </div>
          <div className="metrics-grid" style={{ marginBottom: 0 }}>
            <div className="metric-card">
              <div className="metric-label">Fund IRR</div>
              <div className="metric-value teal">
                {canShowIrr && performance?.fundIRR != null ? `${(performance.fundIRR * 100).toFixed(1)}%` : '—'}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Fund MOIC</div>
              <div className="metric-value teal">{performance ? `${performance.fundMOIC.toFixed(2)}x` : '—'}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Units Owned</div>
              <div className="metric-value">{performance ? num(performance.unitsOwned) : '—'}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Annual NOI</div>
              <div className="metric-value green">{performance ? fmt(performance.annualNOI) : '—'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Pending Capital Calls */}
      {capitalCalls.filter(c => c.status === 'pending' || c.status === 'sent').length > 0 && (
        <div className="card mt-4">
          <div className="card-header">
            <span className="card-title">Pending Capital Calls</span>
            <span className="badge badge-yellow">{num(capitalCalls.filter(c => c.status === 'pending' || c.status === 'sent').length)} pending</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Call #</th>
                <th>Amount</th>
                <th>Due Date</th>
                <th>Purpose</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {capitalCalls.filter(c => c.status === 'pending' || c.status === 'sent').map((cc) => (
                <tr key={cc.id}>
                  <td style={{ fontWeight: 600 }}>Call #{num(cc.call_number)}</td>
                  <td style={{ fontWeight: 600 }}>{fmt(cc.amount)}</td>
                  <td>{cc.due_date}</td>
                  <td>{cc.purpose}</td>
                  <td><span className={`badge badge-${cc.status === 'sent' ? 'yellow' : 'gray'}`}>{cc.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Transaction History */}
      <div className="card mt-4">
        <div className="card-header">
          <span className="card-title">Transaction History</span>
        </div>
        {transactions.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Quarter</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>{t.quarter}</td>
                  <td>
                    <span className={`badge badge-${t.type === 'call' ? 'blue' : 'green'}`}>
                      {t.type === 'call' ? 'Capital Call' : 'Distribution'}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600, color: t.type === 'distribution' ? 'var(--green)' : undefined }}>
                    {fmt(t.amount)}
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>{t.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            No transactions yet.
          </div>
        )}
      </div>

      {/* Fund Reconciliation Ledger (read-only) */}
      <div className="card mt-4">
        <div className="card-header">
          <span className="card-title">Fund Reconciliation Ledger (Read-Only)</span>
          <span className="badge badge-blue">{num(ledgerRows.length)} rows</span>
        </div>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <input
            className="form-input"
            style={{ maxWidth: 260 }}
            placeholder="Search unit/entity/description..."
            value={ledgerSearch}
            onChange={(e) => setLedgerSearch(e.target.value)}
          />
          <select
            className="form-select"
            style={{ maxWidth: 220 }}
            value={ledgerCategory}
            onChange={(e) => setLedgerCategory(e.target.value)}
          >
            <option value="">All categories</option>
            <option value="rent">Rent</option>
            <option value="hoa">HOA</option>
            <option value="insurance">Insurance</option>
            <option value="tax">Tax</option>
            <option value="repair">Repair</option>
            <option value="fund_expense">Fund Expense</option>
            <option value="management_fee">Management Fee</option>
            <option value="capital_call">Capital Call</option>
            <option value="distribution">Distribution</option>
            <option value="other">Other</option>
          </select>
        </div>
        {ledgerRows.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Category</th>
                <th>Description</th>
                <th>Assignment</th>
                <th>Call</th>
                <th>Reconciled</th>
              </tr>
            </thead>
            <tbody>
              {ledgerRows.map((r) => (
                <tr key={r.id}>
                  <td>{r.date}</td>
                  <td style={{ color: r.amount >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{fmt(r.amount)}</td>
                  <td style={{ textTransform: 'capitalize' }}>{r.category.replaceAll('_', ' ')}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{r.description || '—'}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {r.unit_number ? `Unit ${r.unit_number}` : r.entity_name ? `Entity ${r.entity_name}` : r.renovation_description ? `Reno ${r.renovation_description}` : r.lp_name ? 'LP investor' : 'Fund-level'}
                  </td>
                  <td>{r.call_number ? `#${r.call_number}` : '—'}</td>
                  <td>Yes</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
            No ledger rows yet.
          </div>
        )}
      </div>

      {/* Monthly Marks */}
      <div className="card mt-4">
        <div className="card-header">
          <span className="card-title">
            Monthly Marks
            <InfoTip
              text={[
                'NAV v1 (estimated): we mark your units using FRED MIXRNSA as an objective index.',
                'Basis = acquisition basis (total acquisition cost) + reconciled renovation spend-to-date (repair).',
                'Index values are monthly observations and we use straight-line interpolation between them.',
                'TVPI = (cumulative distributions + estimated NAV) / cumulative contributions.',
                'This is a rules-based estimate, not an appraisal.',
              ].join(' ')}
            />
          </span>
          <span className="badge badge-blue">Your economics</span>
        </div>
        {(() => {
          const latestDate = marks?.nav?.latest_fred_date || null;
          const latest = latestDate ? new Date(latestDate) : null;
          const ageDays = latest ? Math.floor((Date.now() - latest.getTime()) / (1000 * 60 * 60 * 24)) : null;
          // Case-Shiller often lags; treat this as informational until it gets unusually stale.
          const warnDays = 150;
          if (!latest || ageDays === null || !Number.isFinite(ageDays)) return null;
          const color = ageDays >= warnDays ? 'var(--gold)' : 'var(--text-muted)';
          const label = ageDays >= warnDays ? 'FRED data stale' : 'FRED data lag';
          return (
            <div style={{ padding: '0 1rem 0.75rem', color, fontSize: '0.8rem' }}>
              {label}: latest MIXRNSA observation {latestDate} ({ageDays} days old).
            </div>
          );
        })()}
        <div className="metrics-grid" style={{ marginBottom: 0 }}>
          <div className="metric-card">
            <div className="metric-label">LP IRR</div>
              <div className="metric-value teal">{canShowIrr && marks?.irr != null ? `${(marks.irr * 100).toFixed(1)}%` : '—'}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">LP MOIC</div>
            <div className="metric-value teal">{marks ? `${marks.moic.toFixed(2)}x` : '—'}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Total Contributed</div>
            <div className="metric-value">{fmt(marks?.total_contributed ?? 0)}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Total Distributed</div>
            <div className="metric-value green">{fmt(marks?.total_distributed ?? 0)}</div>
          </div>
        </div>

        {marks?.monthly?.length ? (
          <div style={{ padding: '0 1rem 1rem' }}>
            <table className="data-table" style={{ marginBottom: 0 }}>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Contributions</th>
                  <th>Distributions</th>
                  <th>Net</th>
                  <th>Estimated NAV</th>
                  <th>TVPI</th>
                </tr>
              </thead>
              <tbody>
                {marks.monthly.slice(-24).map((m) => (
                  <tr key={m.month}>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{m.month}</td>
                    <td style={{ fontWeight: 600 }}>{fmt(m.contributions)}</td>
                    <td style={{ fontWeight: 600, color: 'var(--green)' }}>{fmt(m.distributions)}</td>
                    <td style={{ fontWeight: 600, color: m.net >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {m.net >= 0 ? '+' : ''}{fmt(m.net)}
                    </td>
                    <td style={{ fontWeight: 600 }}>{fmt(m.lp_nav ?? 0)}</td>
                    <td style={{ fontWeight: 600 }}>{m.tvpi != null ? `${m.tvpi.toFixed(2)}x` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ paddingTop: '0.5rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Estimated NAV uses monthly FRED MIXRNSA observations with straight-line interpolation between months.
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
            No monthly data yet.
          </div>
        )}
      </div>

      {/* Investor Document Vault */}
      <div className="card mt-4">
        <div className="card-header">
          <span className="card-title">Investor Documents</span>
          <span className="badge badge-blue">{num(lpDocuments.length)} files</span>
        </div>
        {lpDocuments.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Category</th>
                <th>Uploaded</th>
                <th>Signature</th>
              </tr>
            </thead>
            <tbody>
              {lpDocuments.map((d) => (
                <tr key={d.id}>
                  <td>
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        void downloadFromEndpoint(`lp/documents/${d.id}/download`, d.name).catch((err) => {
                          window.alert(err?.response?.data?.error || err?.message || 'Failed to download document');
                        });
                      }}
                      style={{ color: 'var(--teal)' }}
                    >
                      {d.name}
                    </a>
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{d.category.replaceAll('_', ' ')}</td>
                  <td>{new Date(d.uploaded_at).toLocaleDateString()}</td>
                  <td>
                    {d.requires_signature
                      ? d.signed_at ? 'Signed' : 'Pending signature'
                      : 'N/A'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            No investor documents yet.
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
