/**
 * Centralized HTTP client.
 * Injects a Bearer token on every request:
 *   1. Supabase JWT (preferred) — set after the auth bridge succeeds.
 */
import { supabase } from '@/integrations/supabase/client';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

let sessionPromise: Promise<any> | null = null;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Prevent concurrent getSession calls which can cause Supabase to abort the fetch
  if (!sessionPromise) {
    sessionPromise = supabase.auth.getSession().finally(() => {
      sessionPromise = null;
    });
  }
  
  const { data: { session: supabaseSession } } = await sessionPromise;
  
  if (!supabaseSession) {
    throw new Error('Unauthenticated');
  }
  if (supabaseSession.access_token) {
    headers.Authorization = `Bearer ${supabaseSession.access_token}`;
  }

  return headers;
}

function buildUrl(path: string): string {
  let finalPath = path;
  if (path.startsWith('/api/') && !path.startsWith('/api/v1/')) {
    finalPath = path.replace('/api/', '/api/v1/');
  }

  let url = `${API_BASE}${finalPath}`;
  if (API_BASE.endsWith('/api/v1') && finalPath.startsWith('/api/v1/')) {
    url = API_BASE + finalPath.substring(7);
  } else if (API_BASE.endsWith('/api') && finalPath.startsWith('/api/')) {
    url = API_BASE + finalPath.substring(4);
  }
  
  // Clean up any double slashes (except in protocol)
  return url.replace(/([^:]\/)\/+/g, "$1");
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const headers = await getAuthHeaders();
  
  const url = buildUrl(path);

  const res = await fetch(url, {
    method,
    headers: { ...headers, ...extraHeaders },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  // 204 No Content (and any empty body) must not be parsed as JSON, otherwise
  // every successful DELETE throws on the empty body. Return undefined.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),

  /** Stream variant — returns the raw Response for SSE/NDJSON consumers. */
  stream: async (path: string, body: unknown, signal?: AbortSignal): Promise<Response> => {
    const headers = await getAuthHeaders();

    const url = buildUrl(path);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Stream ${path} → ${res.status}`);
    return res;
  },

  /** FormData upload — lets the browser set the multipart boundary. Returns raw Response. */
  upload: async (path: string, body: FormData, signal?: AbortSignal): Promise<Response> => {
    const headers = await getAuthHeaders();
    delete headers['Content-Type'];

    const url = buildUrl(path);

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal,
      credentials: 'include',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Upload ${path} → ${res.status}: ${text}`);
    }
    return res;
  },
};
