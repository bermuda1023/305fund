import api from './api';

function inferKeyFromPath(filePath: string): { url: string; filename?: string } {
  // Stored paths come back as:
  // - local: /uploads/<folder>/<file>
  // - s3:    /api/files/<encoded key>
  // We always fetch via an authenticated API call so the JWT is included.
  if (filePath.startsWith('/uploads/')) {
    const key = filePath.replace('/uploads/', '');
    return { url: `files/${encodeURIComponent(key)}` };
  }
  if (filePath.startsWith('/api/files/')) {
    // Use as-is (absolute path) so it works regardless of api.baseURL.
    return { url: filePath };
  }
  // Fallback: try to fetch the path directly.
  return { url: filePath };
}

export async function openStoredFile(filePath: string, filename?: string) {
  const { url } = inferKeyFromPath(filePath);
  const resp = await api.get(url, { responseType: 'blob' });
  const blob = new Blob([resp.data]);
  const objectUrl = window.URL.createObjectURL(blob);

  // Try to open in a new tab; if blocked, fall back to download.
  const opened = window.open(objectUrl, '_blank', 'noopener,noreferrer');
  if (!opened) {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename || 'file';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Give the browser a moment to start reading it.
  setTimeout(() => window.URL.revokeObjectURL(objectUrl), 30_000);
}

export async function downloadFromEndpoint(endpointUrl: string, filename: string) {
  const resp = await api.get(endpointUrl, { responseType: 'blob' });
  const blob = new Blob([resp.data]);
  const objectUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => window.URL.revokeObjectURL(objectUrl), 30_000);
}

