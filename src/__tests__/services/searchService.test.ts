/**
 * Tests for searchService.ts
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

import { globalSearch, askCourseTutor } from '@/services/searchService';

const API = 'http://api.test/api/v1';

beforeEach(() => supabaseMock.reset());

describe('globalSearch', () => {
  it('returns empty results for a blank query without calling the API', async () => {
    server.use(
      http.get(`${API}/search`, () => {
        throw new Error('should not be called for a blank query');
      }),
    );
    const result = await globalSearch('   ');
    expect(result).toEqual({ lectures: [], slides: [], concepts: [], worksheets: [] });
  });

  it('returns results from the API for a real query', async () => {
    server.use(
      http.get(`${API}/search`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('q')).toBe('mitosis');
        return HttpResponse.json({
          lectures: [{ id: 'l1', course_id: null, title: 'Cell Biology', description: null }],
          slides: [],
          concepts: [],
          worksheets: [],
        });
      }),
    );
    const result = await globalSearch('mitosis');
    expect(result.lectures).toHaveLength(1);
    expect(result.lectures[0].title).toBe('Cell Biology');
  });

  it('throws on a server error', async () => {
    server.use(
      http.get(`${API}/search`, () => new HttpResponse('err', { status: 500 })),
    );
    await expect(globalSearch('mitosis')).rejects.toThrow();
  });
});

describe('askCourseTutor', () => {
  it('posts the question and returns a grounded reply with citations', async () => {
    server.use(
      http.post(`${API}/search/ask`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body).toEqual({
          course_id: 'c1',
          question: 'What is mitosis?',
          history: null,
          allow_ungrounded: false,
        });
        return HttpResponse.json({
          reply: 'Mitosis is cell division.',
          citations: [{ source_index: 0, lecture_id: 'l1', lecture_title: 'Cell Biology', slide_index: 2, similarity: 0.9 }],
          grounded: true,
        });
      }),
    );
    const result = await askCourseTutor({ courseId: 'c1', question: 'What is mitosis?' });
    expect(result.grounded).toBe(true);
    expect(result.citations).toHaveLength(1);
  });

  it('passes history and allowUngrounded through when provided', async () => {
    server.use(
      http.post(`${API}/search/ask`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.history).toEqual([{ role: 'user', content: 'hi' }]);
        expect(body.allow_ungrounded).toBe(true);
        return HttpResponse.json({ reply: '', citations: [], grounded: false });
      }),
    );
    await askCourseTutor({
      courseId: 'c1',
      question: 'What is mitosis?',
      history: [{ role: 'user', content: 'hi' }],
      allowUngrounded: true,
    });
  });

  it('throws on a server error', async () => {
    server.use(
      http.post(`${API}/search/ask`, () => new HttpResponse('err', { status: 500 })),
    );
    await expect(askCourseTutor({ courseId: 'c1', question: 'x' })).rejects.toThrow();
  });
});
