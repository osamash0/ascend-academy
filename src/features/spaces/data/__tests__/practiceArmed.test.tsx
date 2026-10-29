import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const practice = vi.fn();
vi.mock('../liveRepository', async (orig) => ({
  ...(await orig<object>()),
  loadLiveRepository: async () => ({ practice }),
}));

const { usePracticeQuestions } = await import('../practice');

describe('usePracticeQuestions for a Lesson still being read', () => {
  it('asks nothing until armed, and an empty answer is never kept', async () => {
    practice.mockResolvedValueOnce({ questions: [] }).mockResolvedValueOnce({ questions: [{ id: 'q1' }] });
    const { result, rerender } = renderHook(({ armed }) => usePracticeQuestions('L-armed', true, armed), {
      initialProps: { armed: false },
    });
    expect(practice).not.toHaveBeenCalled();
    rerender({ armed: true });
    await waitFor(() => expect(result.current.state).toBe('empty'));
    const again = renderHook(() => usePracticeQuestions('L-armed', true, true));
    await waitFor(() => expect(again.result.current.questions).toHaveLength(1));
    expect(practice).toHaveBeenCalledTimes(2);
  });
});
