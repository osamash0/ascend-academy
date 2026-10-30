import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/*
 * A course read once is shared — but a course read before a lecture existed
 * must not answer "not found" for it. That is the handover from the early
 * reader: the file has just become a Lesson in a Space read minutes ago.
 */
const SPACE = '11111111-1111-4111-8111-111111111111';
const OLD = '22222222-2222-4222-8222-222222222222';
const NEW = '33333333-3333-4333-8333-333333333333';
const lecture = (id: string, order: number) => ({ id, title: `L${order}`, total_slides: 4, order });
const course = (lectures: ReturnType<typeof lecture>[]) => ({
  id: SPACE,
  title: 'Mine',
  description: null,
  color: null,
  author: null,
  lectures,
});

const readerCourse = vi.fn();
vi.mock('../liveRepository', async (orig) => ({
  ...(await orig<object>()),
  loadLiveRepository: async () => ({ readerCourse, readerIdeas: async () => ({ concepts: [] }) }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('useReaderLesson and a Lesson newer than its course', () => {
  it('reads the course again once instead of answering not found', async () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    const { useReaderLesson } = await import('../useReader');
    readerCourse.mockResolvedValueOnce(course([lecture(OLD, 1)])).mockResolvedValue(course([lecture(OLD, 1), lecture(NEW, 2)]));

    const first = renderHook(() => useReaderLesson(SPACE, OLD));
    await waitFor(() => expect(first.result.current.lesson?.id).toBe(OLD));
    first.unmount();

    const next = renderHook(() => useReaderLesson(SPACE, NEW));
    await waitFor(() => expect(next.result.current.state).toBe('ready'));
    await waitFor(() => expect(next.result.current.lesson?.id).toBe(NEW));
    expect(readerCourse).toHaveBeenCalledTimes(2);

    /* Known now: no third read. */
    const again = renderHook(() => useReaderLesson(SPACE, OLD));
    await waitFor(() => expect(again.result.current.lesson?.id).toBe(OLD));
    expect(readerCourse).toHaveBeenCalledTimes(2);
  });
});
