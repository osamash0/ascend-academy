/**
 * Tests for reviewService.ts
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

import { getQueue, grade, getStats, suspend } from '@/services/reviewService';

const API = 'http://api.test/api/v1';

beforeEach(() => supabaseMock.reset());

const CARD = {
  card_id: 'c1',
  lecture_id: 'l1',
  source_type: 'concept_qa' as const,
  front: { question: 'What is mitosis?' },
  back: { correct_answer: 'Cell division' },
  state: 'review' as const,
};

describe('getQueue', () => {
  it('returns the due queue with no limit param', async () => {
    server.use(
      http.get(`${API}/review/queue`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.has('limit')).toBe(false);
        return HttpResponse.json({ cards: [CARD], total_due: 1 });
      }),
    );
    const result = await getQueue();
    expect(result.total_due).toBe(1);
    expect(result.cards[0].card_id).toBe('c1');
  });

  it('passes a limit query param when given', async () => {
    server.use(
      http.get(`${API}/review/queue`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('limit')).toBe('5');
        return HttpResponse.json({ cards: [], total_due: 0 });
      }),
    );
    await getQueue(5);
  });

  it('throws on a server error', async () => {
    server.use(
      http.get(`${API}/review/queue`, () => new HttpResponse('err', { status: 500 })),
    );
    await expect(getQueue()).rejects.toThrow();
  });
});

describe('grade', () => {
  it('posts rating and elapsed_ms and returns the grade result', async () => {
    server.use(
      http.post(`${API}/review/c1/grade`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body).toEqual({ rating: 3, elapsed_ms: 1200 });
        return HttpResponse.json({
          card_id: 'c1',
          rating: 3,
          due_at: '2026-09-01T00:00:00Z',
          state: 'review',
          interval_days: 4,
        });
      }),
    );
    const result = await grade('c1', 3, 1200);
    expect(result.interval_days).toBe(4);
  });

  it('throws on 404 when the card does not exist', async () => {
    server.use(
      http.post(`${API}/review/ghost/grade`, () =>
        new HttpResponse('Not Found', { status: 404 }),
      ),
    );
    await expect(grade('ghost', 3)).rejects.toThrow();
  });
});

describe('getStats', () => {
  it('returns review stats', async () => {
    server.use(
      http.get(`${API}/review/stats`, () =>
        HttpResponse.json({ due_today: 5, streak: 3, retention_pct: 82.5, reviews_last_30d: 40 }),
      ),
    );
    const result = await getStats();
    expect(result.due_today).toBe(5);
    expect(result.streak).toBe(3);
  });
});

describe('suspend', () => {
  it('marks a card suspended', async () => {
    server.use(
      http.post(`${API}/review/cards/c1/suspend`, () =>
        HttpResponse.json({ card_id: 'c1', suspended: true }),
      ),
    );
    const result = await suspend('c1');
    expect(result.suspended).toBe(true);
  });

  it('throws on a server error', async () => {
    server.use(
      http.post(`${API}/review/cards/c1/suspend`, () => new HttpResponse('err', { status: 500 })),
    );
    await expect(suspend('c1')).rejects.toThrow();
  });
});
