/**
 * Tests for practiceSheetsService.ts
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

import {
  listPracticeSheets,
  createManualSheet,
  generateAutoSheet,
  getPracticeSheet,
  updatePracticeSheet,
  deletePracticeSheet,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  reorderQuestions,
  submitAttempt,
  getMyAttempts,
} from '@/services/practiceSheetsService';

const API = 'http://api.test/api/v1';

beforeEach(() => supabaseMock.reset());

const SHEET = {
  id: 'sh1',
  lecture_id: 'l1',
  kind: 'auto' as const,
  title: 'Week 1 Practice',
  status: 'published' as const,
  created_by: 'p1',
  created_at: null,
  updated_at: null,
};

const QUESTION = {
  id: 'q1',
  sheet_id: 'sh1',
  order_index: 0,
  type: 'multiple_choice' as const,
  prompt: 'What is React?',
  choices: ['A', 'B', 'C', 'D'],
  correct_answer: 'A',
  explanation: null,
  source_quiz_question_id: null,
  created_at: null,
  updated_at: null,
};

// ─── listPracticeSheets ───────────────────────────────────────────────────────

describe('listPracticeSheets', () => {
  it('returns empty array by default', async () => {
    const result = await listPracticeSheets('l1');
    expect(result).toEqual([]);
  });

  it('returns sheets from envelope', async () => {
    server.use(
      http.get(`${API}/lectures/l1/practice-sheets`, () =>
        HttpResponse.json({ success: true, data: [SHEET] }),
      ),
    );
    const result = await listPracticeSheets('l1');
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Week 1 Practice');
  });

  it('throws on 500', async () => {
    server.use(
      http.get(`${API}/lectures/l1/practice-sheets`, () =>
        new HttpResponse('err', { status: 500 }),
      ),
    );
    await expect(listPracticeSheets('l1')).rejects.toThrow();
  });
});

// ─── createManualSheet ────────────────────────────────────────────────────────

describe('createManualSheet', () => {
  it('posts and returns created sheet', async () => {
    server.use(
      http.post(`${API}/lectures/l1/practice-sheets`, () =>
        HttpResponse.json({ success: true, data: SHEET }),
      ),
    );
    const result = await createManualSheet('l1', 'Week 1 Practice');
    expect(result.id).toBe('sh1');
    expect(result.kind).toBe('auto');
  });
});

// ─── generateAutoSheet ────────────────────────────────────────────────────────

describe('generateAutoSheet', () => {
  it('posts to /auto and returns sheet', async () => {
    server.use(
      http.post(`${API}/lectures/l1/practice-sheets/auto`, () =>
        HttpResponse.json({ success: true, data: { ...SHEET, kind: 'auto' } }),
      ),
    );
    const result = await generateAutoSheet('l1');
    expect(result.kind).toBe('auto');
  });

  it('throws on backend error', async () => {
    server.use(
      http.post(`${API}/lectures/l1/practice-sheets/auto`, () =>
        new HttpResponse('AI error', { status: 500 }),
      ),
    );
    await expect(generateAutoSheet('l1')).rejects.toThrow();
  });
});

// ─── getPracticeSheet ─────────────────────────────────────────────────────────

describe('getPracticeSheet', () => {
  it('returns sheet by id', async () => {
    server.use(
      http.get(`${API}/practice-sheets/sh1`, () =>
        HttpResponse.json({ success: true, data: SHEET }),
      ),
    );
    const result = await getPracticeSheet('sh1');
    expect(result.id).toBe('sh1');
  });

  it('throws on 404', async () => {
    server.use(
      http.get(`${API}/practice-sheets/nope`, () =>
        new HttpResponse('Not Found', { status: 404 }),
      ),
    );
    await expect(getPracticeSheet('nope')).rejects.toThrow();
  });
});

// ─── updatePracticeSheet ──────────────────────────────────────────────────────

describe('updatePracticeSheet', () => {
  it('patches and returns updated sheet', async () => {
    server.use(
      http.patch(`${API}/practice-sheets/sh1`, () =>
        HttpResponse.json({
          success: true,
          data: { ...SHEET, status: 'draft' },
        }),
      ),
    );
    const result = await updatePracticeSheet('sh1', { status: 'draft' });
    expect(result.status).toBe('draft');
  });
});

// ─── deletePracticeSheet ──────────────────────────────────────────────────────

describe('deletePracticeSheet', () => {
  it('resolves without throwing on 204', async () => {
    server.use(
      http.delete(`${API}/practice-sheets/sh1`, () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(deletePracticeSheet('sh1')).resolves.not.toThrow();
  });
});

// ─── addQuestion ──────────────────────────────────────────────────────────────

describe('addQuestion', () => {
  it('posts and returns new question', async () => {
    server.use(
      http.post(`${API}/practice-sheets/sh1/questions`, () =>
        HttpResponse.json({ success: true, data: QUESTION }),
      ),
    );
    const result = await addQuestion('sh1', {
      type: 'multiple_choice',
      prompt: 'What is React?',
      choices: ['A', 'B', 'C', 'D'],
      correct_answer: 'A',
    });
    expect(result.id).toBe('q1');
  });
});

// ─── updateQuestion ───────────────────────────────────────────────────────────

describe('updateQuestion', () => {
  it('patches and returns updated question', async () => {
    server.use(
      http.patch(`${API}/practice-sheets/sh1/questions/q1`, () =>
        HttpResponse.json({
          success: true,
          data: { ...QUESTION, prompt: 'Updated?' },
        }),
      ),
    );
    const result = await updateQuestion('sh1', 'q1', {
      type: 'multiple_choice',
      prompt: 'Updated?',
    });
    expect(result.prompt).toBe('Updated?');
  });
});

// ─── deleteQuestion ───────────────────────────────────────────────────────────

describe('deleteQuestion', () => {
  it('resolves without throwing on 204', async () => {
    server.use(
      http.delete(`${API}/practice-sheets/sh1/questions/q1`, () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(deleteQuestion('sh1', 'q1')).resolves.not.toThrow();
  });
});

// ─── reorderQuestions ─────────────────────────────────────────────────────────

describe('reorderQuestions', () => {
  it('posts question_ids and returns reordered list', async () => {
    server.use(
      http.post(`${API}/practice-sheets/sh1/reorder`, () =>
        HttpResponse.json({ success: true, data: [QUESTION] }),
      ),
    );
    const result = await reorderQuestions('sh1', ['q1']);
    expect(result).toHaveLength(1);
  });
});

// ─── submitAttempt ────────────────────────────────────────────────────────────

describe('submitAttempt', () => {
  it('posts answers and returns attempt with score', async () => {
    const ATTEMPT = {
      id: 'at1',
      sheet_id: 'sh1',
      student_id: 's1',
      answers: { q1: 'A' },
      score: 100,
      is_preview: false,
      submitted_at: '2026-01-01T00:00:00Z',
    };
    server.use(
      http.post(`${API}/practice-sheets/sh1/attempts`, () =>
        HttpResponse.json({ success: true, data: ATTEMPT }),
      ),
    );
    const result = await submitAttempt('sh1', { q1: 'A' });
    expect(result.score).toBe(100);
    expect(result.is_preview).toBe(false);
  });

  it('sends is_preview=true when preview mode', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${API}/practice-sheets/sh1/attempts`, async ({ request }) => {
        body = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          success: true,
          data: { id: 'at2', sheet_id: 'sh1', student_id: 's1', answers: {}, score: null, is_preview: true, submitted_at: '' },
        });
      }),
    );
    await submitAttempt('sh1', {}, true);
    expect(body.is_preview).toBe(true);
  });

  it('submitting empty answers is allowed (sends empty object)', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${API}/practice-sheets/sh1/attempts`, async ({ request }) => {
        body = await request.json() as Record<string, unknown>;
        return HttpResponse.json({
          success: true,
          data: { id: 'at3', sheet_id: 'sh1', student_id: 's1', answers: {}, score: 0, is_preview: false, submitted_at: '' },
        });
      }),
    );
    await submitAttempt('sh1', {});
    expect(body.answers).toEqual({});
  });
});

// ─── getMyAttempts ────────────────────────────────────────────────────────────

describe('getMyAttempts', () => {
  it('returns list of attempts', async () => {
    const ATTEMPT = {
      id: 'at1', sheet_id: 'sh1', student_id: 's1',
      answers: {}, score: 80, is_preview: false, submitted_at: '',
    };
    server.use(
      http.get(`${API}/practice-sheets/sh1/attempts/mine`, () =>
        HttpResponse.json({ success: true, data: [ATTEMPT] }),
      ),
    );
    const result = await getMyAttempts('sh1');
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(80);
  });
});
