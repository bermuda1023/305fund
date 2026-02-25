import { useEffect, useMemo, useState } from 'react';
import { publicPost } from '../lib/publicApi';

function buildRedirectUrl(targetUrl: string, investorAccessToken: string) {
  const token = encodeURIComponent(investorAccessToken);
  const t = String(targetUrl || '').trim();
  if (!t) return null;
  // targetUrl typically already has a hash: .../investors.html#opportunity
  // Append as a hash-param so investors.html can read it and move it into sessionStorage.
  if (t.includes('#')) return `${t}&access=${token}`;
  return `${t}#access=${token}`;
}

export default function InvestorGate() {
  const ndaProofToken = useMemo(() => sessionStorage.getItem('ndaProofToken') || '', []);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [showWakeHint, setShowWakeHint] = useState(false);

  useEffect(() => {
    if (!unlocking) {
      setShowWakeHint(false);
      return;
    }
    const t = window.setTimeout(() => setShowWakeHint(true), 2000);
    return () => window.clearTimeout(t);
  }, [unlocking]);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.25rem' }}>
      <h2 style={{ marginTop: 0 }}>Investor Access</h2>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
        Enter your unique access code from the NDA email to unlock the hidden content.
      </p>

      {!ndaProofToken ? (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Missing NDA proof</span>
          </div>
          <div style={{ padding: '1rem', color: 'var(--text-muted)' }}>
            This session is missing the NDA proof token. Please return to the signing link and sign again.
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Access Code</span>
          </div>
          <div style={{ padding: '1rem' }}>
            <div className="form-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Investor Access Code</label>
                <input
                  className="form-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your access code"
                  autoFocus
                />
              </div>
            </div>

            {error ? (
              <div style={{ color: 'var(--red)', marginBottom: '0.75rem' }}>{error}</div>
            ) : null}

            <button
              className="btn btn-primary"
              disabled={!password.trim() || unlocking}
              onClick={async () => {
                setUnlocking(true);
                setError(null);
                try {
                  const resp = await publicPost<{ investorAccessToken: string; investorTargetUrl: string }>(
                    '/public/investor-gate/unlock',
                    { password, ndaProofToken }
                  );
                  const redirectUrl = buildRedirectUrl(resp.investorTargetUrl, resp.investorAccessToken);
                  if (!redirectUrl) throw new Error('Missing redirect URL');
                  // Don't keep NDA proof around longer than needed.
                  sessionStorage.removeItem('ndaProofToken');
                  window.location.href = redirectUrl;
                } catch (e: any) {
                  setError(e?.message || 'Unlock failed');
                } finally {
                  setUnlocking(false);
                }
              }}
            >
              {unlocking ? 'Unlocking...' : 'Unlock and Continue'}
            </button>
            {unlocking && showWakeHint ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.55rem' }}>
                Server may be waking up. This can take a few extra seconds on free hosting.
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

