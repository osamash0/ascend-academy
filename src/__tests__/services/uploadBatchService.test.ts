/**
 * Tests for uploadBatchService.ts
 * All calls go through apiClient → MSW intercepts them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { sharedSupabaseMock as supabaseMock } from '@/test/sharedSupabaseMock';

vi.mock('@/integrations/supabase/client', async () => {
  const m = await import('@/test/sharedSupabaseMock');
  return { supabase: m.sharedSupabaseMock };
});

import { fetchBatchSummary } from '@/services/uploadBatchService';

const API = 'http://api.test/api/v1';

beforeEach(() => supabaseMock.reset());

describe('fetchBatchSummary', () => {
  it('returns the lectures array from the envelope', async () => {
    server.use(
      http.get(`${API}/upload/batches/b1`, () =>
        HttpResponse.json({
          batch_id: 'b1',
          lectures: [
            { run_id: 'r1', status: 'queued', error: null, filename: 'a.pdf', lecture_id: null, title: null, deck_summary: null, slide_count: 0, quiz_count: 0, flagged_count: 0 },
          ],
        }),
      ),
    );
    const result = await fetchBatchSummary('b1');
    expect(result).toHaveLength(1);
    expect(result[0].run_id).toBe('r1');
  });

  it('returns an empty array when the batch has no lectures', async () => {
    server.use(
      http.get(`${API}/upload/batches/empty`, () =>
        HttpResponse.json({ batch_id: 'empty', lectures: [] }),
      ),
    );
    const result = await fetchBatchSummary('empty');
    expect(result).toEqual([]);
  });

  it('throws on 404 when the batch does not exist', async () => {
    server.use(
      http.get(`${API}/upload/batches/ghost`, () =>
        new HttpResponse('Not Found', { status: 404 }),
      ),
    );
    await expect(fetchBatchSummary('ghost')).rejects.toThrow();
  });
});
