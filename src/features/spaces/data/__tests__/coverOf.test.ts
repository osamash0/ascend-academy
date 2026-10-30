import { describe, expect, it } from 'vitest';
import type { Upload } from '../world';
import { emptyWorld } from '../../__tests__/emptyWorld';
import { coverOf } from '../useShelf';

const upload = (over: Partial<Upload> = {}): Upload => ({
  id: 'run-1',
  lessonId: null,
  filename: 'Normalization.pdf',
  title: null,
  pageCount: 82,
  stage: 'developing',
  addedAt: '2026-10-29T10:00:00Z',
  ...over,
});

/*
 * The pipeline makes a Lesson's row midway, while the reader still answers 409
 * for it. Seen live 2026-10-29: a cover that opened that Lesson early handed a
 * readable file over to "Nothing to read yet".
 */
describe('a real upload as a cover', () => {
  it('still being read, it opens the file itself even once its Lesson row exists', () => {
    const c = coverOf(upload({ lessonId: 'L1' }), emptyWorld());
    expect(c.opens).toEqual({ kind: 'lesson', spaceId: 'u', lessonId: '' });
  });

  it('still being read but already with pages, it opens its Lesson', () => {
    const c = coverOf(upload({ lessonId: 'L1', readable: true }), emptyWorld());
    expect(c.opens).toEqual({ kind: 'lesson', spaceId: 'u', lessonId: 'L1' });
  });

  it('ready, it opens its Lesson', () => {
    const c = coverOf(upload({ lessonId: 'L1', stage: 'ready' }), emptyWorld());
    expect(c.opens).toEqual({ kind: 'lesson', spaceId: 'u', lessonId: 'L1' });
  });

  it('refused, it stays with the file', () => {
    const c = coverOf(upload({ lessonId: 'L1', stage: 'failed' }), emptyWorld());
    expect(c.opens).toMatchObject({ lessonId: '' });
  });
});
