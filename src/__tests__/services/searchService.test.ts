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
  it('returns empty sections without a request for a blank query', async () => {
    const result = await globalSearch('   ');
    expect(result).toEqual({ lectures: [], slides: [], concepts: [], worksheets: [] });
  });

  it('returns the search results envelope', async () => {
    server.use(
      http.get(`${API}/search`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('q')).toBe('mitosis');
        return HttpResponse.json({
          lectures: [{ id: 'l1', course_id: 'c1', title: 'Cell Biology', description: null }],
          slides: [], concepts: [], worksheets: [],
        });
      }),
    );
    const result = await globalSearch('mitosis');
    expect(result.lectures).toHaveLength(1);
  });

  it('throws on a server error', async () => {
    server.use(
      http.get(`${API}/search`, () => new HttpResponse('err', { status: 500 })),
    );
    await expect(globalSearch('mitosis')).rejects.toThrow();
  });
});

describe('askCourseTutor', () => {
  it('sends the required ai_model field alongside course_id and question', async () => {
    server.use(
      http.post(`${API}/search/ask`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body).toEqual({
          course_id: 'c1',
          question: 'What is mitosis?',
          ai_model: 'auto',
          history: null,
          allow_ungrounded: false,
        });
        return HttpResponse.json({
          reply: 'Mitosis is cell division.',
          citations: [{ source_index: 1, lecture_id: 'l1', lecture_title: 'Cell Biology', slide_index: 3, similarity: 0.9 }],
          grounded: true,
        });
      }),
    );
    const result = await askCourseTutor({ courseId: 'c1', question: 'What is mitosis?', aiModel: 'auto' });
    expect(result.grounded).toBe(true);
    expect(result.citations).toHaveLength(1);
  });

  it('never omits ai_model even when every optional field is left out', async () => {
    // Regression guard: this is the exact shape that used to reach the backend
    // with no ai_model at all, silently falling back to a broken default
    // ("llama3", a local-Ollama-only path) on every real deployment.
    server.use(
      http.post(`${API}/search/ask`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.ai_model).toBeTruthy();
        expect(body.ai_model).not.toBe('llama3');
        return HttpResponse.json({ reply: '', citations: [], grounded: false });
      }),
    );
    await askCourseTutor({ courseId: 'c1', question: 'x', aiModel: 'cerebras' });
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
      aiModel: 'auto',
      history: [{ role: 'user', content: 'hi' }],
      allowUngrounded: true,
    });
  });

  it('throws on a server error', async () => {
    server.use(
      http.post(`${API}/search/ask`, () => new HttpResponse('err', { status: 500 })),
    );
    await expect(askCourseTutor({ courseId: 'c1', question: 'x', aiModel: 'auto' })).rejects.toThrow();
  });
});
