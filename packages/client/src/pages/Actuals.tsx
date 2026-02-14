import { useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { fmtCurrency, fmtNumber } from '../lib/format';

/* ── Interfaces ──────────────────────────────────────────────── */

interface Transaction {
  id: number;
  portfolio_unit_id: number | null;
  lp_account_id?: number | null;
  lp_name?: string | null;
  capital_call_item_id?: number | null;
  capital_call_id?: number | null;
  call_number?: number | null;
  date: string;
  amount: number;
  category: string;
  description: string;
  source_file: string | null;
  statement_ref?: string | null;
  receipt_document_id?: number | null;
  reconciled: number;
}

interface Upload {
  id: number;
  filename: string;
  upload_date: string;
  file_type: string;
  row_count: number;
  status: string;
}

interface VarianceRow {
  category: string;
  forecast: number;
  actual: number;
  variance: number;
}

interface VarianceResponse {
  variance: VarianceRow[];
  actuals_by_category: { category: string; total: number; count: number }[];
  monthly_forecast: Record<string, number>;
}

interface PortfolioUnit {
  id: number;
  unit_number: string;
}

interface LearnedMapping {
  id: number;
  description_pattern: string;
  portfolio_unit_id: number;
  unit_number: string | null;
  category: string | null;
  created_at: string;
}

interface AddTransactionForm {
  date: string;
  amount: string;
  category: string;
  description: string;
  statementRef: string;
  portfolioUnitId: string;
  lpAccountId: string;
  capitalCallItemId: string;
}

interface LPAccountOption {
  id: number;
  name: string;
}

interface CapitalCallItemOption {
  item_id: number;
  capital_call_id: number;
  lp_account_id: number;
  lp_name: string;
  amount: number;
  status: string;
  received_amount?: number | null;
  call_number: number;
  due_date: string;
  purpose: string;
  call_status: string;
}

interface UploadResult {
  upload_id: number;
  rows_imported: number;
  rows_skipped: number;
  total_rows: number;
}

interface FileUploadResult {
  upload_id: number;
  filename: string;
  file_type: string;
  status: string;
  message: string;
  rows_imported?: number;
  rows_skipped?: number;
  rows_invalid?: number;
}

interface ReceiptForm {
  portfolioUnitId: string;
  mode: 'existing' | 'new';
  transactionId: string;
  date: string;
  amount: string;
  category: string;
  description: string;
}

/* ── Constants ───────────────────────────────────────────────── */

const CATEGORIES = [
  'rent',
  'hoa',
  'insurance',
  'tax',
  'repair',
  'capital_call',
  'distribution',
  'management_fee',
  'fund_expense',
  'other',
];

const CATEGORY_LABELS: Record<string, string> = {
  rent: 'Rent',
  hoa: 'HOA',
  insurance: 'Insurance',
  tax: 'Tax',
  repair: 'Repair',
  capital_call: 'Capital Call',
  distribution: 'Distribution',
  management_fee: 'Mgmt Fee',
  fund_expense: 'Fund Expense',
  other: 'Other',
};

const LP_ONLY_CATEGORIES = new Set(['capital_call']);
const NON_EXPENSE_CATEGORIES = new Set(['capital_call', 'distribution']);

const emptyForm: AddTransactionForm = {
  date: new Date().toISOString().split('T')[0],
  amount: '',
  category: 'rent',
  description: '',
  statementRef: '',
  portfolioUnitId: '',
  lpAccountId: '',
  capitalCallItemId: '',
};

const PAGE_SIZE = 50;

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = fmtCurrency;
const num = fmtNumber;

function fmtDate(iso: string) {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ── Component ───────────────────────────────────────────────── */

export default function Actuals() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<AddTransactionForm>(emptyForm);
  const [receiptForm, setReceiptForm] = useState<ReceiptForm>({
    portfolioUnitId: '',
    mode: 'existing',
    transactionId: '',
    date: new Date().toISOString().split('T')[0],
    amount: '',
    category: 'repair',
    description: '',
  });

  // Upload feedback state
  const [uploadFeedback, setUploadFeedback] = useState<string | null>(null);

  // Search / filter state
  const [searchText, setSearchText] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  // "Learn this mapping" prompt state
  const [learnPrompt, setLearnPrompt] = useState<{ transactionId: number; description: string; unitId: number } | null>(null);

  // New mapping form state
  const [newMappingPattern, setNewMappingPattern] = useState('');
  const [newMappingUnitId, setNewMappingUnitId] = useState('');
  const [newMappingCategory, setNewMappingCategory] = useState('');

  /* ── Queries ─────────────────────────────────────────────── */

  const { data: transactions = [] } = useQuery<Transaction[]>({
    queryKey: ['actuals-transactions'],
    queryFn: () => api.get('/actuals/transactions', { params: { limit: 5000 } }).then((r) => r.data),
  });

  const { data: uploads = [] } = useQuery<Upload[]>({
    queryKey: ['actuals-uploads'],
    queryFn: () => api.get('/actuals/uploads').then((r) => r.data),
  });

  const { data: variance = [] } = useQuery<VarianceRow[]>({
    queryKey: ['actuals-variance'],
    queryFn: () => api.get('/actuals/variance').then((r) => (r.data as VarianceResponse).variance ?? []),
  });

  const { data: portfolioUnits = [] } = useQuery<PortfolioUnit[]>({
    queryKey: ['portfolio'],
    queryFn: () => api.get('/portfolio').then((r) => r.data),
  });

  const { data: learnedMappings = [] } = useQuery<LearnedMapping[]>({
    queryKey: ['actuals-mappings'],
    queryFn: () => api.get('/actuals/mappings').then((r) => r.data),
  });

  const { data: lpAccounts = [] } = useQuery<LPAccountOption[]>({
    queryKey: ['gp-investors'],
    queryFn: () => api.get('/lp/investors').then((r) => r.data),
  });

  const { data: openCapitalCallItems = [] } = useQuery<CapitalCallItemOption[]>({
    queryKey: ['capital-call-items-open'],
    queryFn: () => api.get('/lp/capital-call-items/open').then((r) => r.data),
  });

  /* ── Mutations ───────────────────────────────────────────── */

  const uploadFile = useMutation<UploadResult, Error, File>({
    mutationFn: async (file: File) => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      const allowed = new Set(['csv', 'pdf', 'ofx', 'qfx', 'xls', 'xlsx']);
      if (!ext || !allowed.has(ext)) {
        throw new Error('Unsupported file type. Use CSV, PDF, OFX, XLS, or XLSX.');
      }

      const formData = new FormData();
      formData.append('file', file);
      const resp = await api.post('/actuals/upload-file', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const result = resp.data as FileUploadResult;
      return {
        upload_id: result.upload_id,
        rows_imported: result.rows_imported ?? 0,
        rows_skipped: result.rows_skipped ?? 0,
        rows_invalid: result.rows_invalid ?? 0,
        total_rows: (result.rows_imported ?? 0) + (result.rows_skipped ?? 0) + (result.rows_invalid ?? 0),
        _message: result.message,
      } as UploadResult & { _message?: string; rows_invalid?: number };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['actuals-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['actuals-uploads'] });
      queryClient.invalidateQueries({ queryKey: ['actuals-variance'] });
      if (fileInputRef.current) fileInputRef.current.value = '';

      // Show upload feedback
      const msg = (data as any)._message;
      if (msg) {
        setUploadFeedback(msg);
      } else {
        const parts: string[] = [];
        if (data.rows_imported > 0) parts.push(`Imported ${data.rows_imported} rows`);
        if (data.rows_skipped > 0) parts.push(`skipped ${data.rows_skipped} duplicates`);
        if ((data as any).rows_invalid > 0) parts.push(`ignored ${(data as any).rows_invalid} invalid rows`);
        if (parts.length === 0) parts.push('No new rows imported');
        setUploadFeedback(parts.join(', '));
      }
      setTimeout(() => setUploadFeedback(null), 8000);
    },
    onError: (err) => {
      setUploadFeedback(`Upload failed: ${err.message}`);
      setTimeout(() => setUploadFeedback(null), 8000);
    },
  });

  const addTransaction = useMutation({
    mutationFn: (data: { portfolioUnitId: number | null; lpAccountId: number | null; capitalCallItemId: number | null; date: string; amount: number; category: string; description: string; statementRef?: string }) =>
      api.post('/actuals/upload', {
        filename: `manual-${Date.now()}`,
        rows: [{
          date: data.date,
          amount: data.amount,
          category: data.category,
          description: data.description,
          statement_ref: data.statementRef || undefined,
          portfolio_unit_id: data.portfolioUnitId,
          lp_account_id: data.lpAccountId,
          capital_call_item_id: data.capitalCallItemId,
        }],
        file_type: 'manual',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actuals-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['actuals-uploads'] });
      queryClient.invalidateQueries({ queryKey: ['actuals-variance'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-summary'] });
      queryClient.invalidateQueries({ queryKey: ['capital-call-items-open'] });
      queryClient.invalidateQueries({ queryKey: ['capital-calls-all'] });
      queryClient.invalidateQueries({ queryKey: ['gp-capital-calls-all'] });
      queryClient.invalidateQueries({ queryKey: ['lp-capital-calls'] });
      queryClient.invalidateQueries({ queryKey: ['lp-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['lp-account'] });
      queryClient.invalidateQueries({ queryKey: ['lp-performance'] });
      setShowAddForm(false);
      setForm(emptyForm);
      setUploadFeedback('Transaction added successfully.');
      setTimeout(() => setUploadFeedback(null), 5000);
    },
    onError: (err: any) => {
      setUploadFeedback(`Failed to add transaction: ${err?.response?.data?.error || err?.message || 'Unknown error'}`);
      setTimeout(() => setUploadFeedback(null), 8000);
    },
  });

  const uploadReceipt = useMutation({
    mutationFn: async (payload: {
      file: File;
      portfolioUnitId: number;
      transactionId?: number;
      createExpense?: boolean;
      date?: string;
      amount?: number;
      category?: string;
      description?: string;
    }) => {
      const formData = new FormData();
      formData.append('file', payload.file);
      formData.append('portfolioUnitId', String(payload.portfolioUnitId));
      if (payload.transactionId) formData.append('transactionId', String(payload.transactionId));
      if (payload.createExpense) formData.append('createExpense', 'true');
      if (payload.date) formData.append('date', payload.date);
      if (payload.amount !== undefined) formData.append('amount', String(payload.amount));
      if (payload.category) formData.append('category', payload.category);
      if (payload.description) formData.append('description', payload.description);
      return api.post('/actuals/receipt', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actuals-transactions'] });
      setUploadFeedback('Receipt saved and linked successfully.');
      setTimeout(() => setUploadFeedback(null), 5000);
      if (receiptInputRef.current) receiptInputRef.current.value = '';
    },
    onError: (err: any) => {
      setUploadFeedback(`Receipt upload failed: ${err?.response?.data?.error || err?.message || 'Unknown error'}`);
      setTimeout(() => setUploadFeedback(null), 8000);
    },
  });

  const updateTransaction = useMutation({
    mutationFn: ({ id, ...data }: { id: number; category?: string; portfolioUnitId?: number | null; lpAccountId?: number | null; capitalCallItemId?: number | null; reconciled?: number; description?: string; statementRef?: string }) => {
      const payload: any = {};
      if (data.category !== undefined) payload.category = data.category;
      if (data.portfolioUnitId !== undefined) payload.portfolio_unit_id = data.portfolioUnitId;
      if (data.lpAccountId !== undefined) payload.lp_account_id = data.lpAccountId;
      if (data.capitalCallItemId !== undefined) payload.capital_call_item_id = data.capitalCallItemId;
      if (data.reconciled !== undefined) payload.reconciled = data.reconciled;
      if (data.description !== undefined) payload.description = data.description;
      if (data.statementRef !== undefined) payload.statement_ref = data.statementRef;
      return api.put(`/actuals/transactions/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actuals-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['actuals-transactions-model'] });
      queryClient.invalidateQueries({ queryKey: ['actuals-variance'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-summary'] });
      queryClient.invalidateQueries({ queryKey: ['capital-calls-all'] });
      queryClient.invalidateQueries({ queryKey: ['capital-call-items-open'] });
      queryClient.invalidateQueries({ queryKey: ['gp-capital-calls-all'] });
      queryClient.invalidateQueries({ queryKey: ['lp-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['lp-account'] });
      queryClient.invalidateQueries({ queryKey: ['lp-capital-calls'] });
      queryClient.invalidateQueries({ queryKey: ['lp-performance'] });
    },
  });

  const createMapping = useMutation({
    mutationFn: (data: { pattern: string; portfolioUnitId: number; category?: string }) =>
      api.post('/actuals/mappings', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actuals-mappings'] });
      setLearnPrompt(null);
      setNewMappingPattern('');
      setNewMappingUnitId('');
      setNewMappingCategory('');
    },
  });

  const deleteMapping = useMutation({
    mutationFn: (id: number) => api.delete(`/actuals/mappings/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actuals-mappings'] });
    },
  });

  /* ── Filtered & paginated transactions ─────────────────────── */

  const filteredTransactions = useMemo(() => {
    let result = transactions;

    if (searchText) {
      const q = searchText.toLowerCase();
      result = result.filter((t) =>
        (t.description || '').toLowerCase().includes(q)
      );
    }

    if (filterCategory) {
      result = result.filter((t) => t.category === filterCategory);
    }

    if (filterDateFrom) {
      result = result.filter((t) => t.date >= filterDateFrom);
    }

    if (filterDateTo) {
      result = result.filter((t) => t.date <= filterDateTo);
    }

    return result;
  }, [transactions, searchText, filterCategory, filterDateFrom, filterDateTo]);

  const totalPages = Math.max(1, Math.ceil(filteredTransactions.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedTransactions = filteredTransactions.slice(
    (safeCurrentPage - 1) * PAGE_SIZE,
    safeCurrentPage * PAGE_SIZE
  );

  /* ── Derived metrics ─────────────────────────────────────── */

  const totalAmount = transactions.reduce((s, t) => s + t.amount, 0);
  const reconciledCount = transactions.filter((t) => t.reconciled).length;
  const unreconciledCount = transactions.length - reconciledCount;

  /* ── Handlers ────────────────────────────────────────────── */

  function handleFileUpload() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile.mutate(file);
  }

  function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    const isLpOnly = LP_ONLY_CATEGORIES.has(form.category);
    if (isLpOnly && !form.lpAccountId) {
      setUploadFeedback('Capital call transactions must be assigned to an LP.');
      setTimeout(() => setUploadFeedback(null), 5000);
      return;
    }
    if (isLpOnly && !form.capitalCallItemId) {
      setUploadFeedback('Select a specific capital call for this LP.');
      setTimeout(() => setUploadFeedback(null), 5000);
      return;
    }
    addTransaction.mutate({
      portfolioUnitId: isLpOnly ? null : (form.portfolioUnitId ? Number(form.portfolioUnitId) : null),
      lpAccountId: isLpOnly ? (form.lpAccountId ? Number(form.lpAccountId) : null) : null,
      capitalCallItemId: isLpOnly ? (form.capitalCallItemId ? Number(form.capitalCallItemId) : null) : null,
      date: form.date,
      amount: Number(form.amount),
      category: form.category,
      description: form.description,
      statementRef: form.statementRef.trim() || undefined,
    });
  }

  function handleCategoryChange(id: number, category: string) {
    if (LP_ONLY_CATEGORIES.has(category)) {
      updateTransaction.mutate({ id, category, portfolioUnitId: null });
      return;
    }
    updateTransaction.mutate({ id, category, lpAccountId: null, capitalCallItemId: null });
  }

  function handleUnitChange(t: Transaction, unitIdStr: string) {
    if (LP_ONLY_CATEGORIES.has(t.category)) return;
    const newUnitId = unitIdStr ? Number(unitIdStr) : null;
    updateTransaction.mutate({ id: t.id, portfolioUnitId: newUnitId });

    // Offer to learn this mapping if a unit was selected and there is a description
    if (newUnitId && t.description) {
      setLearnPrompt({ transactionId: t.id, description: t.description, unitId: newUnitId });
    }
  }

  function handleLpChange(t: Transaction, lpIdStr: string) {
    if (!LP_ONLY_CATEGORIES.has(t.category)) return;
    const newLpId = lpIdStr ? Number(lpIdStr) : null;
    updateTransaction.mutate({ id: t.id, lpAccountId: newLpId, portfolioUnitId: null, capitalCallItemId: null });
  }

  function handleCapitalCallItemChange(t: Transaction, itemIdStr: string) {
    if (!LP_ONLY_CATEGORIES.has(t.category)) return;
    const itemId = itemIdStr ? Number(itemIdStr) : null;
    updateTransaction.mutate({ id: t.id, capitalCallItemId: itemId });
  }

  function handleReconciledToggle(id: number, currentValue: number) {
    updateTransaction.mutate({ id, reconciled: currentValue ? 0 : 1 });
  }

  function handleLearnMapping() {
    if (!learnPrompt) return;
    createMapping.mutate({
      pattern: learnPrompt.description,
      portfolioUnitId: learnPrompt.unitId,
    });
  }

  function handleAddMapping(e: React.FormEvent) {
    e.preventDefault();
    if (!newMappingPattern || !newMappingUnitId) return;
    createMapping.mutate({
      pattern: newMappingPattern,
      portfolioUnitId: Number(newMappingUnitId),
      category: newMappingCategory || undefined,
    });
  }

  function handleClearFilters() {
    setSearchText('');
    setFilterCategory('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setCurrentPage(1);
  }

  function handleReceiptSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = receiptInputRef.current?.files?.[0];
    if (!file) {
      setUploadFeedback('Please select or capture a receipt image first.');
      setTimeout(() => setUploadFeedback(null), 5000);
      return;
    }
    const unitId = Number(receiptForm.portfolioUnitId);
    if (!unitId) {
      setUploadFeedback('Please select a unit for this receipt.');
      setTimeout(() => setUploadFeedback(null), 5000);
      return;
    }
    if (receiptForm.mode === 'existing') {
      const txId = Number(receiptForm.transactionId);
      if (!txId) {
        setUploadFeedback('Please select an existing expense to attach this receipt to.');
        setTimeout(() => setUploadFeedback(null), 5000);
        return;
      }
      uploadReceipt.mutate({ file, portfolioUnitId: unitId, transactionId: txId });
      return;
    }
    const amount = Number(receiptForm.amount);
    if (!receiptForm.date || Number.isNaN(amount)) {
      setUploadFeedback('Date and amount are required to create a new expense from receipt.');
      setTimeout(() => setUploadFeedback(null), 5000);
      return;
    }
    uploadReceipt.mutate({
      file,
      portfolioUnitId: unitId,
      createExpense: true,
      date: receiptForm.date,
      amount,
      category: receiptForm.category,
      description: receiptForm.description,
    });
  }

  /* ── Unit lookup helper ──────────────────────────────────── */

  function unitLabel(portfolioUnitId: number | null): string {
    if (!portfolioUnitId) return '\u2014';
    const u = portfolioUnits.find((pu) => pu.id === portfolioUnitId);
    return u ? u.unit_number : '\u2014';
  }

  const selectedReceiptUnitId = receiptForm.portfolioUnitId ? Number(receiptForm.portfolioUnitId) : null;
  const selectedLpId = form.lpAccountId ? Number(form.lpAccountId) : null;
  const selectedCallItems = useMemo(() => {
    if (!selectedLpId) return [];
    return openCapitalCallItems
      .filter((i) => i.lp_account_id === selectedLpId)
      .sort((a, b) => b.call_number - a.call_number);
  }, [openCapitalCallItems, selectedLpId]);

  const receiptExpenseCandidates = useMemo(() => {
    if (!selectedReceiptUnitId) return [];
    return transactions
      // Include unit-scoped expenses and unassigned expenses so users can link receipts
      // to entries that were created without selecting a unit initially.
      .filter((t) => t.portfolio_unit_id === selectedReceiptUnitId || t.portfolio_unit_id === null)
      .filter((t) => !NON_EXPENSE_CATEGORIES.has(t.category))
      .sort((a, b) => {
        const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
        if (dateDiff !== 0) return dateDiff;
        return b.id - a.id;
      })
      .slice(0, 200);
  }, [transactions, selectedReceiptUnitId]);

  /* ── Render ──────────────────────────────────────────────── */

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>Actual Expense Ledger</h2>
          <p>Track paid cash movements from statements and reconcile unit expenses</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.pdf,.ofx,.qfx,.xls,.xlsx"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <button
            className="btn btn-secondary"
            onClick={handleFileUpload}
            disabled={uploadFile.isPending}
          >
            {uploadFile.isPending ? 'Uploading...' : 'Upload Statement'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? 'Cancel' : '+ Add Transaction'}
          </button>
        </div>
      </div>

      {/* Upload Feedback Banner */}
      {uploadFeedback && (
        <div
          style={{
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            borderRadius: 'var(--radius)',
            background: uploadFeedback.startsWith('Upload failed')
              ? 'rgba(239, 68, 68, 0.15)'
              : 'rgba(16, 185, 129, 0.15)',
            border: `1px solid ${uploadFeedback.startsWith('Upload failed') ? 'var(--red)' : 'var(--green)'}`,
            color: uploadFeedback.startsWith('Upload failed') ? 'var(--red)' : 'var(--green)',
            fontSize: '0.85rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{uploadFeedback}</span>
          <button
            onClick={() => setUploadFeedback(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: '1.1rem',
              padding: '0 0.25rem',
            }}
          >
            x
          </button>
        </div>
      )}

      {/* Learn Mapping Prompt */}
      {learnPrompt && (
        <div
          style={{
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            borderRadius: 'var(--radius)',
            background: 'rgba(59, 130, 246, 0.12)',
            border: '1px solid var(--teal)',
            color: 'var(--text-primary)',
            fontSize: '0.85rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <span>
            Learn mapping: &ldquo;{learnPrompt.description}&rdquo; {'->'} {unitLabel(learnPrompt.unitId)}?
          </span>
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
            <button className="btn btn-primary" onClick={handleLearnMapping} style={{ padding: '0.3rem 0.75rem', fontSize: '0.78rem' }}>
              Learn
            </button>
            <button className="btn btn-secondary" onClick={() => setLearnPrompt(null)} style={{ padding: '0.3rem 0.75rem', fontSize: '0.78rem' }}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Summary Metrics */}
      <div className="card mb-4">
        <div className="card-header">
          <span className="card-title">Receipt Capture (Phone Camera Ready)</span>
          <span className="badge badge-blue">Mobile</span>
        </div>
        <form onSubmit={handleReceiptSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Take Picture / Select Receipt</label>
              <input
                ref={receiptInputRef}
                className="form-input"
                type="file"
                accept="image/*"
                capture="environment"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Unit</label>
              <select
                className="form-select"
                value={receiptForm.portfolioUnitId}
                onChange={(e) => setReceiptForm((p) => ({ ...p, portfolioUnitId: e.target.value, transactionId: '' }))}
                required
              >
                <option value="">Select unit</option>
                {portfolioUnits.map((u) => (
                  <option key={u.id} value={u.id}>{u.unit_number}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Assignment Mode</label>
              <select
                className="form-select"
                value={receiptForm.mode}
                onChange={(e) => setReceiptForm((p) => ({ ...p, mode: e.target.value as 'existing' | 'new' }))}
              >
                <option value="existing">Attach to existing expense</option>
                <option value="new">Create new expense from receipt</option>
              </select>
            </div>
          </div>
          {receiptForm.mode === 'existing' ? (
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Existing Expense</label>
                <select
                  className="form-select"
                  value={receiptForm.transactionId}
                  onChange={(e) => setReceiptForm((p) => ({ ...p, transactionId: e.target.value }))}
                  required
                >
                  <option value="">Select expense</option>
                  {receiptExpenseCandidates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {fmtDate(t.date)} · {CATEGORY_LABELS[t.category] ?? t.category} · {fmt(t.amount)} · {t.description || 'No description'}
                      {t.portfolio_unit_id ? '' : ' · Unassigned'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Date</label>
                  <input className="form-input" type="date" value={receiptForm.date} onChange={(e) => setReceiptForm((p) => ({ ...p, date: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Amount</label>
                  <input className="form-input" type="number" step="0.01" value={receiptForm.amount} onChange={(e) => setReceiptForm((p) => ({ ...p, amount: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Category</label>
                  <select className="form-select" value={receiptForm.category} onChange={(e) => setReceiptForm((p) => ({ ...p, category: e.target.value }))}>
                    {['hoa', 'insurance', 'tax', 'repair', 'management_fee', 'fund_expense', 'other'].map((c) => (
                      <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <input className="form-input" value={receiptForm.description} onChange={(e) => setReceiptForm((p) => ({ ...p, description: e.target.value }))} placeholder="e.g. Plumbing invoice" />
                </div>
              </div>
            </>
          )}
          <button className="btn btn-primary" type="submit" disabled={uploadReceipt.isPending}>
            {uploadReceipt.isPending ? 'Saving receipt...' : 'Save Receipt'}
          </button>
        </form>
      </div>

      {/* Summary Metrics */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Total Transactions</div>
          <div className="metric-value teal">{num(transactions.length)}</div>
          <div className="metric-note">All recorded entries</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Amount</div>
          <div className="metric-value" style={{ color: totalAmount >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {fmt(totalAmount)}
          </div>
          <div className="metric-note">Net cash flow</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Reconciled</div>
          <div className="metric-value green">{reconciledCount}</div>
          <div className="metric-note">Matched to statements</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Unreconciled</div>
          <div className="metric-value" style={{ color: unreconciledCount > 0 ? 'var(--gold)' : 'var(--green)' }}>
            {unreconciledCount}
          </div>
          <div className="metric-note">{unreconciledCount > 0 ? 'Needs review' : 'All clear'}</div>
        </div>
      </div>

      {/* Add Transaction Form (collapsible) */}
      {showAddForm && (
        <div className="card mb-4">
          <div className="card-header">
            <span className="card-title">New Transaction</span>
            <button className="btn btn-secondary" onClick={() => setShowAddForm(false)}>Cancel</button>
          </div>
          <form onSubmit={handleAddSubmit}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Date</label>
                <input
                  className="form-input"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Amount</label>
                <input
                  className="form-input"
                  type="number"
                  step="0.01"
                  placeholder="e.g. 2800 or -1369"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Category</label>
                <select
                  className="form-select"
                  value={form.category}
                  onChange={(e) => {
                    const category = e.target.value;
                    const isLpOnly = LP_ONLY_CATEGORIES.has(category);
                    setForm({
                      ...form,
                      category,
                      portfolioUnitId: isLpOnly ? '' : form.portfolioUnitId,
                      lpAccountId: isLpOnly ? form.lpAccountId : '',
                      capitalCallItemId: isLpOnly ? form.capitalCallItemId : '',
                    });
                  }}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Unit</label>
                <select
                  className="form-select"
                  value={form.portfolioUnitId}
                  onChange={(e) => setForm({ ...form, portfolioUnitId: e.target.value })}
                  disabled={LP_ONLY_CATEGORIES.has(form.category)}
                >
                  <option value="">No unit</option>
                  {portfolioUnits.map((u) => (
                    <option key={u.id} value={u.id}>{u.unit_number}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">LP (for Capital Call)</label>
                <select
                  className="form-select"
                  value={form.lpAccountId}
                  onChange={(e) => setForm({ ...form, lpAccountId: e.target.value, capitalCallItemId: '' })}
                  required={LP_ONLY_CATEGORIES.has(form.category)}
                  disabled={!LP_ONLY_CATEGORIES.has(form.category)}
                >
                  <option value="">{LP_ONLY_CATEGORIES.has(form.category) ? 'Select LP' : 'N/A for this category'}</option>
                  {lpAccounts.map((lp) => (
                    <option key={lp.id} value={lp.id}>{lp.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Capital Call</label>
                <select
                  className="form-select"
                  value={form.capitalCallItemId}
                  onChange={(e) => setForm({ ...form, capitalCallItemId: e.target.value })}
                  required={LP_ONLY_CATEGORIES.has(form.category)}
                  disabled={!LP_ONLY_CATEGORIES.has(form.category) || !form.lpAccountId}
                >
                  <option value="">
                    {!LP_ONLY_CATEGORIES.has(form.category)
                      ? 'N/A for this category'
                      : !form.lpAccountId
                        ? 'Select LP first'
                        : 'Select call'}
                  </option>
                  {selectedCallItems.map((item) => (
                    <option key={item.item_id} value={item.item_id}>
                      #{item.call_number} · {item.purpose || 'Capital call'} · Due {item.due_date}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="Payment description"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Bank Statement Ref</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="e.g. CHK-2026-02-1521"
                  value={form.statementRef}
                  onChange={(e) => setForm({ ...form, statementRef: e.target.value })}
                />
              </div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={addTransaction.isPending}>
              {addTransaction.isPending ? 'Saving...' : 'Add Transaction'}
            </button>
          </form>
        </div>
      )}

      {/* Transactions Table */}
      <div className="card mb-4">
        <div className="card-header">
          <span className="card-title">Transactions</span>
          <span className="badge badge-blue">
            {filteredTransactions.length === transactions.length
              ? `${num(transactions.length)} records`
              : `${num(filteredTransactions.length)} of ${num(transactions.length)} records`}
          </span>
        </div>

        {/* Search / Filter Bar */}
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 200px', minWidth: 150 }}>
            <label className="form-label" style={{ fontSize: '0.7rem', marginBottom: '0.2rem' }}>Search description</label>
            <input
              className="form-input"
              type="text"
              placeholder="Filter by description..."
              value={searchText}
              onChange={(e) => { setSearchText(e.target.value); setCurrentPage(1); }}
              style={{ padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
            />
          </div>
          <div style={{ minWidth: 110 }}>
            <label className="form-label" style={{ fontSize: '0.7rem', marginBottom: '0.2rem' }}>Category</label>
            <select
              className="form-select"
              value={filterCategory}
              onChange={(e) => { setFilterCategory(e.target.value); setCurrentPage(1); }}
              style={{ padding: '0.35rem 0.4rem', fontSize: '0.8rem' }}
            >
              <option value="">All</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 120 }}>
            <label className="form-label" style={{ fontSize: '0.7rem', marginBottom: '0.2rem' }}>From</label>
            <input
              className="form-input"
              type="date"
              value={filterDateFrom}
              onChange={(e) => { setFilterDateFrom(e.target.value); setCurrentPage(1); }}
              style={{ padding: '0.35rem 0.4rem', fontSize: '0.8rem' }}
            />
          </div>
          <div style={{ minWidth: 120 }}>
            <label className="form-label" style={{ fontSize: '0.7rem', marginBottom: '0.2rem' }}>To</label>
            <input
              className="form-input"
              type="date"
              value={filterDateTo}
              onChange={(e) => { setFilterDateTo(e.target.value); setCurrentPage(1); }}
              style={{ padding: '0.35rem 0.4rem', fontSize: '0.8rem' }}
            />
          </div>
          {(searchText || filterCategory || filterDateFrom || filterDateTo) && (
            <button
              className="btn btn-secondary"
              onClick={handleClearFilters}
              style={{ padding: '0.35rem 0.6rem', fontSize: '0.78rem', alignSelf: 'flex-end' }}
            >
              Clear
            </button>
          )}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Category</th>
                <th>Unit</th>
                <th>LP</th>
                <th>Call #</th>
                <th>Source</th>
                <th>Bank Ref</th>
                <th>Receipt</th>
                <th style={{ textAlign: 'center' }}>Reconciled</th>
              </tr>
            </thead>
            <tbody>
              {paginatedTransactions.map((t) => (
                <tr key={t.id}>
                  <td>{fmtDate(t.date)}</td>
                  <td style={{ color: 'var(--text-primary)', fontFamily: 'var(--font)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.description || '\u2014'}
                  </td>
                  <td style={{ color: t.amount >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                    {fmt(t.amount)}
                  </td>
                  <td>
                    <select
                      className="form-select"
                      value={t.category}
                      onChange={(e) => handleCategoryChange(t.id, e.target.value)}
                      style={{
                        padding: '0.25rem 0.4rem',
                        fontSize: '0.75rem',
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        color: 'var(--text-secondary)',
                        width: 'auto',
                        minWidth: 100,
                      }}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="form-select"
                      value={t.portfolio_unit_id ?? ''}
                      onChange={(e) => handleUnitChange(t, e.target.value)}
                      disabled={LP_ONLY_CATEGORIES.has(t.category)}
                      style={{
                        padding: '0.25rem 0.4rem',
                        fontSize: '0.75rem',
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        color: 'var(--text-secondary)',
                        width: 'auto',
                        minWidth: 80,
                      }}
                    >
                      <option value="">{'\u2014'}</option>
                      {portfolioUnits.map((u) => (
                        <option key={u.id} value={u.id}>{u.unit_number}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="form-select"
                      value={t.lp_account_id ?? ''}
                      onChange={(e) => handleLpChange(t, e.target.value)}
                      disabled={!LP_ONLY_CATEGORIES.has(t.category)}
                      style={{
                        padding: '0.25rem 0.4rem',
                        fontSize: '0.75rem',
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        color: 'var(--text-secondary)',
                        width: 'auto',
                        minWidth: 100,
                      }}
                    >
                      <option value="">{LP_ONLY_CATEGORIES.has(t.category) ? 'Select LP' : '\u2014'}</option>
                      {lpAccounts.map((lp) => (
                        <option key={lp.id} value={lp.id}>{lp.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="form-select"
                      value={t.capital_call_item_id ?? ''}
                      onChange={(e) => handleCapitalCallItemChange(t, e.target.value)}
                      disabled={!LP_ONLY_CATEGORIES.has(t.category) || !t.lp_account_id}
                      style={{
                        padding: '0.25rem 0.4rem',
                        fontSize: '0.75rem',
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        color: 'var(--text-secondary)',
                        width: 'auto',
                        minWidth: 105,
                      }}
                    >
                      <option value="">
                        {LP_ONLY_CATEGORIES.has(t.category)
                          ? t.lp_account_id ? 'Select call' : 'Select LP first'
                          : '\u2014'}
                      </option>
                      {openCapitalCallItems
                        .filter((item) => item.lp_account_id === t.lp_account_id)
                        .map((item) => (
                          <option key={item.item_id} value={item.item_id}>
                            #{item.call_number}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                    {t.source_file ? (
                      t.source_file.startsWith('/uploads/')
                        ? <a href={t.source_file} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--teal)' }}>{t.source_file.includes('/uploads/receipts/') ? 'Receipt file' : t.source_file}</a>
                        : t.source_file
                    ) : 'Manual'}
                  </td>
                  <td>
                    <input
                      className="form-input"
                      defaultValue={t.statement_ref || ''}
                      placeholder="Set ref"
                      onBlur={(e) => {
                        const next = e.currentTarget.value.trim();
                        if (next === (t.statement_ref || '')) return;
                        updateTransaction.mutate({ id: t.id, statementRef: next });
                      }}
                      style={{ minWidth: 130, padding: '0.2rem 0.45rem', fontSize: '0.75rem' }}
                    />
                  </td>
                  <td>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = 'image/*';
                        input.setAttribute('capture', 'environment');
                        input.onchange = (ev: any) => {
                          const f = ev?.target?.files?.[0];
                          if (!f) return;
                          if (!t.portfolio_unit_id) {
                            setUploadFeedback('Set a unit first, then attach receipt.');
                            setTimeout(() => setUploadFeedback(null), 5000);
                            return;
                          }
                          uploadReceipt.mutate({
                            file: f,
                            portfolioUnitId: t.portfolio_unit_id,
                            transactionId: t.id,
                          });
                        };
                        input.click();
                      }}
                      disabled={uploadReceipt.isPending}
                    >
                      {t.source_file?.includes('/uploads/receipts/') ? 'Replace' : 'Attach'}
                    </button>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={!!t.reconciled}
                      onChange={() => handleReconciledToggle(t.id, t.reconciled)}
                      style={{
                        width: 16,
                        height: 16,
                        cursor: 'pointer',
                        accentColor: 'var(--teal)',
                      }}
                    />
                  </td>
                </tr>
              ))}
              {paginatedTransactions.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    {transactions.length === 0
                      ? 'No transactions yet. Upload a statement or add one manually.'
                      : 'No transactions match the current filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.6rem 1rem',
              borderTop: '1px solid var(--border)',
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
            }}
          >
            <span>
              Showing {(safeCurrentPage - 1) * PAGE_SIZE + 1}
              {'\u2013'}
              {num(Math.min(safeCurrentPage * PAGE_SIZE, filteredTransactions.length))} of {num(filteredTransactions.length)}
            </span>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                className="btn btn-secondary"
                disabled={safeCurrentPage <= 1}
                onClick={() => setCurrentPage(safeCurrentPage - 1)}
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }}
              >
                Prev
              </button>
              <span style={{ display: 'flex', alignItems: 'center', padding: '0 0.4rem' }}>
                Page {safeCurrentPage} of {totalPages}
              </span>
              <button
                className="btn btn-secondary"
                disabled={safeCurrentPage >= totalPages}
                onClick={() => setCurrentPage(safeCurrentPage + 1)}
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom section: Upload History + Variance side by side */}
      <div className="grid-2">
        {/* Upload History */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Upload History</span>
            <span className="badge badge-gray">{num(uploads.length)} files</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Date</th>
                <th>Type</th>
                <th>Rows</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((u) => (
                <tr key={u.id}>
                  <td style={{ color: 'var(--text-primary)', fontFamily: 'var(--font)' }}>
                    {u.filename}
                  </td>
                  <td>{fmtDate(u.upload_date)}</td>
                  <td>
                    <span className="badge badge-gray" style={{ textTransform: 'uppercase', fontSize: '0.65rem' }}>
                      {u.file_type}
                    </span>
                  </td>
                  <td>{num(u.row_count)}</td>
                  <td>
                    <span
                      className={`badge ${
                        u.status === 'processed' || u.status === 'parsed'
                          ? 'badge-green'
                          : u.status === 'error'
                          ? 'badge-red'
                          : u.status === 'pending_review'
                          ? 'badge-yellow'
                          : 'badge-yellow'
                      }`}
                    >
                      {u.status === 'pending_review' ? 'Pending Review' : u.status}
                    </span>
                  </td>
                </tr>
              ))}
              {uploads.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
                    No uploads yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Variance Analysis */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Variance Analysis</span>
            <span className="badge badge-blue">Forecast vs Actual</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Forecast</th>
                <th>Actual</th>
                <th>Variance</th>
              </tr>
            </thead>
            <tbody>
              {variance.map((v, i) => (
                <tr key={`${v.category}-${i}`}>
                  <td style={{ fontWeight: 600, textTransform: 'capitalize' }}>{CATEGORY_LABELS[v.category] ?? v.category}</td>
                  <td>{fmt(v.forecast)}</td>
                  <td>{fmt(v.actual)}</td>
                  <td style={{ color: v.variance >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                    {v.variance >= 0 ? '+' : ''}{fmt(v.variance)}
                  </td>
                </tr>
              ))}
              {variance.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
                    No variance data available. Add transactions and portfolio units to compare.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Learned Mappings Section */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header">
          <span className="card-title">Learned Mappings</span>
          <span className="badge badge-blue">{num(learnedMappings.length)} patterns</span>
        </div>

        {/* Add new mapping form */}
        <form
          onSubmit={handleAddMapping}
          style={{
            padding: '0.75rem 1rem',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: '1 1 200px', minWidth: 150 }}>
            <label className="form-label" style={{ fontSize: '0.7rem', marginBottom: '0.2rem' }}>Description pattern</label>
            <input
              className="form-input"
              type="text"
              placeholder="e.g. Brickell HOA Payment"
              value={newMappingPattern}
              onChange={(e) => setNewMappingPattern(e.target.value)}
              style={{ padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
              required
            />
          </div>
          <div style={{ minWidth: 110 }}>
            <label className="form-label" style={{ fontSize: '0.7rem', marginBottom: '0.2rem' }}>Unit</label>
            <select
              className="form-select"
              value={newMappingUnitId}
              onChange={(e) => setNewMappingUnitId(e.target.value)}
              style={{ padding: '0.35rem 0.4rem', fontSize: '0.8rem' }}
              required
            >
              <option value="">Select unit</option>
              {portfolioUnits.map((u) => (
                <option key={u.id} value={u.id}>{u.unit_number}</option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 110 }}>
            <label className="form-label" style={{ fontSize: '0.7rem', marginBottom: '0.2rem' }}>Category (optional)</label>
            <select
              className="form-select"
              value={newMappingCategory}
              onChange={(e) => setNewMappingCategory(e.target.value)}
              style={{ padding: '0.35rem 0.4rem', fontSize: '0.8rem' }}
            >
              <option value="">Auto-detect</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </div>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={createMapping.isPending}
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', alignSelf: 'flex-end' }}
          >
            {createMapping.isPending ? 'Saving...' : '+ Add Mapping'}
          </button>
        </form>

        <table className="data-table">
          <thead>
            <tr>
              <th>Description Pattern</th>
              <th>Unit</th>
              <th>Category</th>
              <th>Created</th>
              <th style={{ textAlign: 'center', width: 60 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {learnedMappings.map((m) => (
              <tr key={m.id}>
                <td style={{ color: 'var(--text-primary)', fontFamily: 'var(--font)' }}>
                  {m.description_pattern}
                </td>
                <td>
                  <span className="badge badge-blue">{m.unit_number || unitLabel(m.portfolio_unit_id)}</span>
                </td>
                <td style={{ color: 'var(--text-secondary)' }}>
                  {m.category ? (CATEGORY_LABELS[m.category] ?? m.category) : '\u2014'}
                </td>
                <td style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                  {fmtDate(m.created_at)}
                </td>
                <td style={{ textAlign: 'center' }}>
                  <button
                    onClick={() => deleteMapping.mutate(m.id)}
                    disabled={deleteMapping.isPending}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--red)',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      padding: '0.2rem 0.4rem',
                    }}
                    title="Delete mapping"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {learnedMappings.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
                  No learned mappings yet. Change a transaction's unit assignment to create one, or add manually above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
