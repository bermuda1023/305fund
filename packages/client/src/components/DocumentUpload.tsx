/**
 * Reusable Document Upload component.
 * Works with any parent type: unit, entity, tenant, renovation, lp, fund.
 */

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { openStoredFile } from '../lib/files';

interface Document {
  id: number;
  parent_id: number;
  parent_type: string;
  name: string;
  category: string;
  file_path: string;
  file_type: string;
  uploaded_at: string;
  requires_signature: number;
  signed_at: string | null;
  uploaded_by: string;
}

interface DocumentUploadProps {
  parentType: 'unit' | 'entity' | 'tenant' | 'renovation' | 'lp' | 'fund';
  parentId: number;
}

const CATEGORIES = [
  'general',
  'kyc',
  'aml',
  'accreditation',
  'ppm',
  'subscription',
  'side_letter',
  'w9',
  'tax_form',
  'id_doc',
  'banking',
  'compliance',
  'signed_investment_docs',
  'lease',
  'purchase_agreement',
  'closing_docs',
  'insurance',
  'tax',
  'formation',
  'operating_agreement',
  'financial',
  'correspondence',
  'inspection',
  'renovation',
  'other',
];

const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  kyc: 'KYC',
  aml: 'AML',
  accreditation: 'Accreditation',
  ppm: 'PPM',
  subscription: 'Subscription Docs',
  side_letter: 'Side Letter',
  w9: 'W-9',
  tax_form: 'Tax Form',
  id_doc: 'ID Document',
  banking: 'Banking / Wiring',
  compliance: 'Compliance',
  signed_investment_docs: 'Signed Investment Docs',
  lease: 'Lease',
  purchase_agreement: 'Purchase Agreement',
  closing_docs: 'Closing Documents',
  insurance: 'Insurance',
  tax: 'Tax',
  formation: 'Formation Docs',
  operating_agreement: 'Operating Agreement',
  financial: 'Financial',
  correspondence: 'Correspondence',
  inspection: 'Inspection',
  renovation: 'Renovation',
  other: 'Other',
};

const inputStyle: React.CSSProperties = {
  padding: '0.4rem 0.6rem',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text-primary)',
  fontSize: '0.8rem',
};

export default function DocumentUpload({ parentType, parentId }: DocumentUploadProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState('general');
  const [requiresSignature, setRequiresSignature] = useState(false);
  const [uploading, setUploading] = useState(false);

  const queryKey = ['documents', parentType, parentId];

  const { data: documents = [], isLoading } = useQuery<Document[]>({
    queryKey,
    queryFn: () => api.get(`/documents/${parentType}/${parentId}`).then((r) => r.data),
    enabled: !!parentId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('parentType', parentType);
      formData.append('parentId', parentId.toString());
      formData.append('category', category);
      formData.append('requiresSignature', requiresSignature ? 'true' : 'false');
      return api.post('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setUploading(false);
      setRequiresSignature(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: () => setUploading(false),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/documents/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const handleUpload = () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    uploadMutation.mutate(file);
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.includes('pdf')) return '\u{1F4C4}';
    if (fileType.includes('image')) return '\u{1F5BC}';
    if (fileType.includes('spreadsheet') || fileType.includes('excel') || fileType.includes('csv')) return '\u{1F4CA}';
    if (fileType.includes('word') || fileType.includes('document')) return '\u{1F4DD}';
    return '\u{1F4CE}';
  };

  const formatDate = (d: string) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatSize = (name: string) => {
    // We don't have file size from the API, so just show the extension
    const ext = name.split('.').pop()?.toUpperCase() || '';
    return ext;
  };

  return (
    <div>
      {/* Upload controls */}
      <div style={{
        display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem',
        flexWrap: 'wrap',
      }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.csv"
          style={{ ...inputStyle, flex: 1, minWidth: 180 }}
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer', minWidth: 140 }}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>
          ))}
        </select>
        <button
          className="btn btn-primary"
          onClick={handleUpload}
          disabled={uploading || uploadMutation.isPending}
          style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
      </div>
      <div style={{ marginBottom: '0.75rem' }}>
        <label style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
          <input
            type="checkbox"
            checked={requiresSignature}
            onChange={(e) => setRequiresSignature(e.target.checked)}
            style={{ marginRight: '0.35rem' }}
          />
          Requires signature
        </label>
      </div>

      {/* Error */}
      {uploadMutation.isError && (
        <div style={{ color: 'var(--red)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
          Upload failed: {(uploadMutation.error as Error)?.message || 'Unknown error'}
        </div>
      )}

      {/* Document list */}
      {isLoading ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading documents...</p>
      ) : documents.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No documents uploaded yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {documents.map((doc) => (
            <div
              key={doc.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.5rem 0.75rem',
                background: 'var(--bg-tertiary)',
                borderRadius: 6,
                border: '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: '1.2rem' }}>{getFileIcon(doc.file_type)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    void openStoredFile(doc.file_path, doc.name).catch((err) => {
                      window.alert(err?.response?.data?.error || err?.message || 'Failed to open file');
                    });
                  }}
                  style={{
                    color: 'var(--teal)',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    textDecoration: 'none',
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {doc.name}
                </a>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', gap: '0.75rem', marginTop: '0.15rem' }}>
                  <span>{CATEGORY_LABELS[doc.category] || doc.category}</span>
                  <span>{formatSize(doc.name)}</span>
                  <span>{formatDate(doc.uploaded_at)}</span>
                  {doc.requires_signature ? (
                    <span style={{ color: doc.signed_at ? 'var(--green)' : 'var(--gold)' }}>
                      {doc.signed_at ? 'Signed' : 'Signature required'}
                    </span>
                  ) : null}
                  {doc.uploaded_by && <span>by {doc.uploaded_by}</span>}
                </div>
              </div>
              <button
                onClick={() => {
                  if (confirm(`Delete "${doc.name}"?`)) {
                    deleteMutation.mutate(doc.id);
                  }
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--red)',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  padding: '0.25rem 0.5rem',
                  borderRadius: 4,
                  opacity: 0.7,
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
