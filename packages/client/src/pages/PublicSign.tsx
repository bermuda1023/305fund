import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
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
  const [sourcePdfBytes, setSourcePdfBytes] = useState<ArrayBuffer | null>(null);
  const [previewRendering, setPreviewRendering] = useState(false);

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
          const bytes = await docResp.arrayBuffer();
          if (!cancelled) setSourcePdfBytes(bytes);
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
    };
  }, [token, docEndpoint]);

  useEffect(() => {
    if (!sourcePdfBytes) return;
    let cancelled = false;
    const debounce = window.setTimeout(() => {
      (async () => {
        try {
          setPreviewRendering(true);
          const pdf = await PDFDocument.load(sourcePdfBytes as any);
          const form = pdf.getForm();
          const previewValues: Record<string, string> = {
            ...formValues,
            // Keep Recipient synced even though we hide that field in UI.
            Recipient: String(formValues.Recipient || formValues.Name || '').trim(),
          };
          for (const field of pdfFields) {
            // Date and Recipient are read-only in UI, but we still render them in preview.
            if (field.readOnly && field.name !== 'Date' && field.name !== 'Recipient') continue;
            const val = String(previewValues[field.name] || '').trim();
            try {
              form.getTextField(field.name).setText(val);
            } catch {
              // Ignore unknown/non-text fields in preview mode.
            }
          }
          try {
            const font = await pdf.embedFont(StandardFonts.Helvetica);
            const signatureFont = await pdf.embedFont(StandardFonts.TimesRomanItalic);
            try {
              const signatureField = form.getTextField('Signature_es_:signatureblock');
              const sigText = valOrSig(previewValues['Signature_es_:signatureblock']);
              signatureField.setText(sigText);
              signatureField.updateAppearances(signatureFont);
              signatureField.setFontSize(18);

              // Browser PDF viewers can ignore custom field appearances.
              // Draw the signature directly at the field widget coordinates as a reliable fallback.
              if (sigText) {
                const widgets = ((signatureField as any)?.acroField?.getWidgets?.() || []) as any[];
                const pages = pdf.getPages();
                for (const widget of widgets) {
                  const rect = widget?.getRectangle?.();
                  if (!rect) continue;
                  const widgetPageRef = widget?.getOrCreateP?.();
                  let page =
                    pages.find((p) => String((p as any)?.ref) === String(widgetPageRef)) || pages[0];
                  if (!page) continue;
                  const fieldHeight = Number(rect.height || 22);
                  const size = Math.max(16, Math.min(22, fieldHeight * 0.85));
                  const x = Number(rect.x || 80) + 2;
                  const y = Number(rect.y || 120) + Math.max(0.5, (fieldHeight - size) * 0.45);
                  page.drawText(sigText, {
                    x,
                    y,
                    size,
                    font: signatureFont,
                    color: rgb(0.12, 0.2, 0.45),
                    opacity: 0.98,
                  });
                }
              }
            } catch {
              // Signature field might not exist on all templates.
            }
            form.updateFieldAppearances(font);
            try {
              // Re-apply after global update so preview keeps the cursive-like signature style.
              const signatureField = form.getTextField('Signature_es_:signatureblock');
              signatureField.updateAppearances(signatureFont);
              signatureField.setFontSize(18);
            } catch {
              // Signature field might not exist on all templates.
            }
          } catch {
            // Fallback to default viewer rendering when font update fails.
          }
          const previewBytes = await pdf.save();
          const blobUrl = URL.createObjectURL(new Blob([previewBytes as any], { type: 'application/pdf' }));
          if (cancelled) {
            URL.revokeObjectURL(blobUrl);
            return;
          }
          setPdfBlobUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return blobUrl;
          });
        } catch {
          // Keep prior preview visible if live render fails.
        } finally {
          if (!cancelled) setPreviewRendering(false);
        }
      })();
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(debounce);
    };
  }, [sourcePdfBytes, formValues, pdfFields]);

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
                  style={{
                    width: '100%',
                    height: '78vh',
                    minHeight: 520,
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                  }}
                />
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading NDA preview…</div>
              )}
              {pdfBlobUrl ? (
                <div style={{ marginTop: '0.5rem' }}>
                  <a href={pdfBlobUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                    Open Full PDF
                  </a>
                </div>
              ) : null}
              {previewRendering ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.45rem' }}>
                  Updating preview...
                </div>
              ) : null}
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
                        onChange={(e) =>
                          setFormValues((prev) => {
                            const nextVal = e.target.value;
                            if (f.name === 'Name') {
                              return { ...prev, Name: nextVal, Recipient: nextVal };
                            }
                            return { ...prev, [f.name]: nextVal };
                          })
                        }
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
                    const payloadFormValues: Record<string, string> = {
                      ...formValues,
                      Recipient: String(formValues.Recipient || formValues.Name || '').trim(),
                    };
                    const resp = await publicPost<{ success: boolean; ndaProofToken: string }>(
                      `/public/sign/${encodeURIComponent(token)}/submit`,
                      { signerEmail, formValues: payloadFormValues }
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

function valOrSig(v: unknown): string {
  return String(v || '').trim();
}

