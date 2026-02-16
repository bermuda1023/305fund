import axios from 'axios';

const configuredBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();

function normalizeApiBase(raw?: string): string {
  const s = (raw || '').trim().replace(/\/+$/, '');
  if (!s) return '/api';
  // If the user provides https://host/api already, keep it.
  if (s.endsWith('/api')) return s;
  // If they provided just https://host, make it https://host/api.
  return `${s}/api`;
}

const api = axios.create({
  baseURL: normalizeApiBase(configuredBase),
});

// Add JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token && token !== 'undefined' && token !== 'null') {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // If we're sending FormData, let the browser/axios set the multipart boundary.
  // Forcing application/json breaks multer (file will be "missing").
  const isFormData = typeof FormData !== 'undefined' && config.data instanceof FormData;
  if (isFormData) {
    try {
      // AxiosHeaders in newer axios has .delete(), but keep it compatible.
      delete (config.headers as any)['Content-Type'];
      delete (config.headers as any)['content-type'];
    } catch {
      // ignore
    }
  } else {
    // Default JSON content type when not uploading files.
    if (!(config.headers as any)['Content-Type'] && !(config.headers as any)['content-type']) {
      (config.headers as any)['Content-Type'] = 'application/json';
    }
  }
  return config;
});

// Handle 401 — redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
