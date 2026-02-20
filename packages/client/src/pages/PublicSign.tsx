import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { buildPublicUrl, publicGet, publicPost } from '../lib/publicApi';

type SignMeta = {
  document: { id: number; name: string };
  alreadySigned: boolean;
};

type PdfFormField = {
  name: string;
  label: string;
  type: 'text';
  required: boolean;
  readOnly: boolean;
  defaultValue?: string;
};

export default function PublicSign() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [meta, setMeta] = useState<SignMeta | null>(null);
  const [pdfFields, setPdfFields] = useState<PdfFormField[]>([]);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);

  const [signerEmail, setSignerEmail] = useState('');
  const [agree, setAgree] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const visiblePdfFields = useMemo(
    () => pdfFields.filter((f) => f.name !== 'Recipient'),
    [pdfFields]
  );

  const docEndpoint = useMemo(() => {
    if (!token) return null;
    return buildPublicUrl(`/public/sign/${encodeURIComponent(token)}/document`);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    let nextBlobUrl: string | null = null;
    (async () => {
      if (!token) {
        setError('Missing signing token');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const data = await publicGet<SignMeta>(`/public/sign/${encodeURIComponent(token)}`);
        if (cancelled) return;
        setMeta(data);
        setError(null);

        const fieldsResp = await publicGet<{ fields: PdfFormField[] }>(`/public/sign/${encodeURIComponent(token)}/form-fields`);
        if (cancelled) return;
        setPdfFields(fieldsResp.fields || []);
        const initial: Record<string, string> = {};
        for (const f of fieldsResp.fields || []) {
          initial[f.name] = f.defaultValue || '';
        }
        setFormValues(initial);

        if (docEndpoint) {
          const docResp = await fetch(docEndpoint, {
            method: 'GET',
            headers: { Accept: 'application/pdf' },
            credentials: 'omit',
          });
          if (!docResp.ok) {
            throw new Error(`Failed to load NDA PDF (${docResp.status})`);
          }
          const blob = await docResp.blob();
          nextBlobUrl = URL.createObjectURL(blob);
          if (!cancelled) {
            setPdfBlobUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return nextBlobUrl;
            });
          }
        }
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Failed to load signing page');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (nextBlobUrl) URL.revokeObjectURL(nextBlobUrl);
    };
  }, [token, docEndpoint]);

  const missingRequired = useMemo(() => {
    const missing: string[] = [];
    for (const f of visiblePdfFields) {
      if (!f.required) continue;
      const v = String(formValues[f.name] || '').trim();
      if (!v) missing.push(f.label || f.name);
    }
    return missing;
  }, [visiblePdfFields, formValues]);
  const signatureValue = String(formValues['Signature_es_:signatureblock'] || '').trim();
  const hasFullNameSignature = useMemo(() => {
    // Require at least first + last name-like words.
    return /^[A-Za-z][A-Za-z'`.-]*\s+[A-Za-z][A-Za-z'`.-]*(?:\s+[A-Za-z][A-Za-z'`.-]*)*$/.test(signatureValue);
  }, [signatureValue]);
  const canSubmit = missingRequired.length === 0 && hasFullNameSignature && agree && !submitting;

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '1.25rem' }}>
      <h2 style={{ marginTop: 0 }}>NDA Signature</h2>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
        Review the document and sign to continue.
      </p>

      {loading ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading...</div>
      ) : error ? (
        <div style={{ color: 'var(--red)' }}>{error}</div>
      ) : meta ? (
        <>
          <div className="card mb-4">
            <div className="card-header">
              <span className="card-title">{meta.document.name}</span>
              {meta.alreadySigned ? (
                <span className="badge" style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--green)' }}>
                  Previously signed
                </span>
              ) : null}
            </div>
            <div style={{ padding: '1rem' }}>
              {pdfBlobUrl ? (
                <iframe
                  title="NDA PDF"
                  src={pdfBlobUrl}
                  style={{ width: '100%', height: 520, border: '1px solid var(--border)', borderRadius: 8 }}
                />
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading NDA preview…</div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="card-title">Sign</span>
            </div>
            <div style={{ padding: '1rem' }}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Email (optional)</label>
                  <input
                    className="form-input"
                    type="email"
                    value={signerEmail}
                    onChange={(e) => setSignerEmail(e.target.value)}
                    placeholder="you@company.com"
                  />
                </div>
              </div>

              {visiblePdfFields.length > 0 ? (
                <div className="form-row">
                  {visiblePdfFields.map((f) => (
                    <div key={f.name} className="form-group" style={{ flex: 1, minWidth: 220 }}>
                      <label className="form-label">
                        {f.label}{f.required ? ' *' : ''}
                      </label>
                      <input
                        className="form-input"
                        value={formValues[f.name] || ''}
                        disabled={f.readOnly}
                        onChange={(e) => setFormValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
                        placeholder={f.readOnly ? '' : f.label}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.35rem' }}>
                Fields entered below are used to fill the final signed PDF.
              </div>

              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                By signing, you agree this acts as an electronic signature.
              </div>

              <div style={{ margin: '0.75rem 0' }}>
                <label style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  <input
                    type="checkbox"
                    checked={agree}
                    onChange={(e) => setAgree(e.target.checked)}
                    style={{ marginRight: '0.5rem' }}
                  />
                  I agree to the NDA terms
                </label>
              </div>

              {error ? (
                <div style={{ color: 'var(--red)', marginBottom: '0.75rem' }}>{error}</div>
              ) : null}
              {!error && missingRequired.length > 0 ? (
                <div style={{ color: 'var(--gold)', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
                  Missing required fields: {missingRequired.join(', ')}
                </div>
              ) : null}
              {!error && signatureValue && !hasFullNameSignature ? (
                <div style={{ color: 'var(--gold)', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
                  Signature must be your full name (first and last).
                </div>
              ) : null}

              <button
                className="btn btn-primary"
                disabled={!canSubmit}
                onClick={async () => {
                  if (!token) return;
                  setSubmitting(true);
                  setError(null);
                  try {
                    const resp = await publicPost<{ success: boolean; ndaProofToken: string }>(
                      `/public/sign/${encodeURIComponent(token)}/submit`,
                      { signerEmail, formValues }
                    );
                    sessionStorage.setItem('ndaProofToken', resp.ndaProofToken);
                    navigate('/investor-gate');
                  } catch (e: any) {
                    setError(e?.message || 'Failed to submit signature');
                  } finally {
                    setSubmitting(false);
                  }
                }}
              >
                {submitting ? 'Submitting...' : 'Sign and Continue'}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

