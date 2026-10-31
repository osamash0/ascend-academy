import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import i18n from '@/i18n';
import { useEffect, useState } from 'react';

const practice = vi.fn();
const answerPractice = vi.fn();
vi.mock('../liveRepository', async (orig) => ({
  ...(await orig<object>()),
  loadLiveRepository: async () => ({ practice, answerPractice }),
}));

const { usePracticeQuestions, submitAnswer } = await import('../practice');

beforeEach(() => vi.clearAllMocks());
afterEach(async () => { await act(() => i18n.changeLanguage('en')); });

describe('usePracticeQuestions for a Lesson still being read', () => {
  it('does not repeatedly reset practice while a new language is loading', async () => {
    let finishGerman!: (value: { questions: { id: string }[] }) => void;
    practice.mockImplementation((_id, lang) => lang === 'de'
      ? new Promise((resolve) => { finishGerman = resolve; })
      : Promise.resolve({ questions: [{ id: 'english' }] }));
    const { result } = renderHook(() => {
      const bank = usePracticeQuestions('L-loading-language', true);
      const [resets, setResets] = useState(0);
      // Practice resets its turns when a different question bank arrives.
      // Bound the counter so a regression fails without an endless render loop.
      useEffect(() => { setResets((n) => Math.min(10, n + 1)); }, [bank.questions]);
      return { ...bank, resets };
    });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    const before = result.current.resets;
    await act(() => i18n.changeLanguage('de'));
    expect(result.current.state).toBe('loading');
    expect(result.current.resets).toBe(before + 1);
    await act(async () => { finishGerman({ questions: [{ id: 'german' }] }); });
    await waitFor(() => expect(result.current.questions[0]?.id).toBe('german'));
  });

  it('separates languages and ignores a late reply from the previous language', async () => {
    let finishEnglish!: (value: { questions: { id: string }[] }) => void;
    practice.mockImplementation((_id, lang) => lang === 'en'
      ? new Promise((resolve) => { finishEnglish = resolve; })
      : Promise.resolve({ questions: [{ id: 'german' }] }));
    const { result } = renderHook(() => usePracticeQuestions('L-language', true));
    await waitFor(() => expect(practice).toHaveBeenCalledWith('L-language', 'en'));
    await act(() => i18n.changeLanguage('de'));
    await waitFor(() => expect(result.current.questions[0]?.id).toBe('german'));
    await act(async () => { finishEnglish({ questions: [{ id: 'english' }] }); });
    expect(result.current.questions[0]?.id).toBe('german');
    await act(() => i18n.changeLanguage('en'));
    await waitFor(() => expect(result.current.questions[0]?.id).toBe('english'));
    expect(practice).toHaveBeenCalledTimes(2);
  });

  it('submits the original choice value while showing translated choices', async () => {
    answerPractice.mockResolvedValue({ correct: true, xp: 10 });
    const q = { id: 'q-localized', lessonId: 'L', prompt: 'Which?', choices: ['Yes', 'No'],
      correctAnswer: 'Yes', explanation: 'Because.', answerValues: ['Ja', 'Nein'] };
    expect(await submitAnswer('L', q, 'Yes')).toEqual({ correct: true, xp: 10 });
    expect(answerPractice).toHaveBeenCalledWith('L', 'q-localized', 'Ja', null);
  });

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
