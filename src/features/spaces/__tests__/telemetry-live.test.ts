import { describe, expect, it, vi } from 'vitest';
import { createLiveRepository, type V4Transport } from '../data/liveRepository';

function transport(withBeacon = true) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const http: V4Transport = {
    get: vi.fn(async (path: string) => (calls.push({ method: 'GET', path }), {})) as V4Transport['get'],
    post: vi.fn(async (path: string, body: unknown) => (calls.push({ method: 'POST', path, body }), {})) as V4Transport['post'],
    patch: vi.fn() as V4Transport['patch'],
    delete: vi.fn() as V4Transport['delete'],
    ...(withBeacon
      ? { beacon: vi.fn((path: string, body: unknown) => (calls.push({ method: 'BEACON', path, body }), true)) }
      : {}),
  };
  return { http, calls };
}

const R = '/api/v1/v4/reader/lectures';

describe('the reader’s telemetry, live', () => {
  it('a progress ping carries the session and, when the reader moved, the page now in view', async () => {
    const { http, calls } = transport();
    const repo = createLiveRepository(http);
    await repo.recordReading('l1', 8, 12.5, 's1', 7);
    await repo.recordReading('l1', 3, 4, null);
    expect(calls).toEqual([
      { method: 'POST', path: `${R}/l1/progress`, body: { page: 8, seconds: 12.5, session_id: 's1', to_page: 7 } },
      { method: 'POST', path: `${R}/l1/progress`, body: { page: 3, seconds: 4, session_id: '' } },
    ]);
  });

  it('the last page goes out as a beacon, or as a plain post when there is none', () => {
    const a = transport(true);
    expect(createLiveRepository(a.http).recordReadingBeacon('l1', 5, 30, 's1')).toBe(true);
    expect(a.calls[0]).toEqual({ method: 'BEACON', path: `${R}/l1/progress`, body: { page: 5, seconds: 30, session_id: 's1' } });
    const b = transport(false);
    expect(createLiveRepository(b.http).recordReadingBeacon('l1', 5, 30, 's1')).toBe(false);
    expect(b.calls[0]).toMatchObject({ method: 'POST', path: `${R}/l1/progress` });
  });

  it('help, practice, check-ins and checkpoint answers name their session', async () => {
    const { http, calls } = transport();
    const repo = createLiveRepository(http);
    await repo.explainPage('l1', 12, 's1');
    await repo.askPage('l1', 12, 'Why?', [], 's1');
    await repo.answerPractice('l1', 'q1', 'b', 's1');
    await repo.checkIn('l1', { first: 4, last: 9, idea: 'Joins', rating: 'confused', session_id: 's1' });
    await repo.answerCheckpoint('l1', { first: 4, last: 9, question_id: 1, answer: { kind: 'choice', index: 1 }, session_id: 's1' });
    expect(calls.map((c) => [c.path, c.body])).toEqual([
      [`${R}/l1/pages/12/explain`, { session_id: 's1' }],
      [`${R}/l1/pages/12/ask`, { question: 'Why?', thread: [], session_id: 's1' }],
      [`${R}/l1/practice/answer`, { question_id: 'q1', answer: 'b', session_id: 's1' }],
      [`${R}/l1/check-in`, { first: 4, last: 9, idea: 'Joins', rating: 'confused', session_id: 's1' }],
      [`${R}/l1/checkpoint/answer`, { first: 4, last: 9, question_id: 1, answer: { kind: 'choice', index: 1 }, session_id: 's1' }],
    ]);
  });
});
