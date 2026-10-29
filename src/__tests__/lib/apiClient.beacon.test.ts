import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-1' } } }) } },
}));

const ok = () => Promise.resolve(new Response('{}', { status: 200 }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('apiClient.beacon', () => {
  it('cannot send before any request has seen a token', async () => {
    const fetchMock = vi.fn(ok);
    vi.stubGlobal('fetch', fetchMock);
    const { apiClient } = await import('@/lib/apiClient');
    expect(apiClient.beacon('/api/v1/x', { a: 1 })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a keepalive POST with the last token, synchronously', async () => {
    const fetchMock = vi.fn(ok);
    vi.stubGlobal('fetch', fetchMock);
    const { apiClient } = await import('@/lib/apiClient');
    await apiClient.get('/api/v1/warm');
    fetchMock.mockClear();
    expect(apiClient.beacon('/api/v1/v4/reader/lectures/l1/progress', { page: 3 })).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/v4/reader/lectures/l1/progress');
    expect(init.keepalive).toBe(true);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect(init.body).toBe(JSON.stringify({ page: 3 }));
  });
});
