const configuredBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();

function baseUrl() {
  return configuredBase && configuredBase.length > 0 ? configuredBase.replace(/\/+$/, '') : '/api';
}

function buildUrl(path: string) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl()}${p}`;
}

async function readJsonOrThrow(resp: Response) {
  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(String((data as any)?.error || resp.statusText || 'Request failed'));
    }
    return data;
  }
  if (!resp.ok) {
    throw new Error(resp.statusText || 'Request failed');
  }
  return null;
}

export async function publicGet<T>(path: string): Promise<T> {
  const resp = await fetch(buildUrl(path), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  });
  return (await readJsonOrThrow(resp)) as T;
}

export async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(buildUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    credentials: 'omit',
  });
  return (await readJsonOrThrow(resp)) as T;
}

