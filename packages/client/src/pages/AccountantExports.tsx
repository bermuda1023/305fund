import { useState } from 'react';
import api from '../lib/api';

function saveCsv(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AccountantExports() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [status, setStatus] = useState<string>('');

  const download = async (mode: 'quickbooks' | 'tax') => {
    try {
      setStatus(`Preparing ${mode} export...`);
      const response = await api.get(`/audit/exports/${month}`, {
        params: { mode },
        responseType: 'blob',
      });
      saveCsv(new Blob([response.data], { type: 'text/csv;charset=utf-8' }), `${mode}-ledger-${month}.csv`);
      setStatus(`${mode} export downloaded`);
    } catch (error: any) {
      setStatus(error?.response?.data?.error || error?.message || 'Failed to export package');
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Export Center</h2>
        <p>Accountant-ready package outputs for bookkeeping and tax support.</p>
      </div>
      <div className="card" style={{ maxWidth: 700 }}>
        <div className="card-header">
          <span className="card-title">Monthly Packages</span>
        </div>
        <div style={{ padding: '1rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label className="form-label">Month</label>
            <input className="form-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <button className="btn btn-secondary" onClick={() => download('quickbooks')}>
            QuickBooks-style CSV
          </button>
          <button className="btn btn-primary" onClick={() => download('tax')}>
            Tax-return support CSV
          </button>
          {status ? <div style={{ fontSize: '0.85rem', opacity: 0.85 }}>{status}</div> : null}
        </div>
      </div>
    </div>
  );
}
