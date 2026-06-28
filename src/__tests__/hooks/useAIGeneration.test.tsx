/**
 * Tests for useAIGeneration.
 *
 * I/O boundaries:
 *   - apiClient (HTTP) → MSW intercepts
 *   - useToast → mocked
 *   - useAiModel → mocked (returns 'gemini')
 *
 * We drive the hook via renderHook and verify:
 *   - isAdministrativeQuiz pure function
 *   - handleGenerateSummary: success path, empty-content guard, error fallback, loading state
 *   - handleGenerateQuiz: success path, administrative quiz detection, empty-content guard
 *   - handleGenerateTitle: success path
 *   - handleGenerateContent: success path
 *   - handleGenerateAllQuizzes: processes pending slides in bulk
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { sharedSupabaseMock as supabaseMock } from '@/test/sharedSupabaseMock';

vi.mock('@/integrations/supabase/client', async () => {
  const m = await import('@/test/sharedSupabaseMock');
  return { supabase: m.sharedSupabaseMock };
});

const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@/hooks/use-ai-model', () => ({
  useAiModel: () => ({ aiModel: 'gemini' }),
}));

import { useAIGeneration, isAdministrativeQuiz } from '@/hooks/useAIGeneration';
import type { SlideData } from '@/types/lectureUpload';

const API = 'http://api.test/api/v1';

function makeSlide(content = 'The mitochondria is the powerhouse of the cell.'): SlideData {
  return {
    title: 'Intro',
    content,
    summary: '',
    questions: [{ question: '', options: ['', '', '', ''], correctAnswer: 0 }],
  };
}

function makeHook(slides: SlideData[]) {
  const updateSlide = vi.fn();
  const hook = renderHook(() => useAIGeneration({ slides, updateSlide }));
  return { ...hook, updateSlide };
}

beforeEach(() => {
  supabaseMock.reset();
  toastMock.mockClear();
});

// ─── isAdministrativeQuiz (pure) ─────────────────────────────────────────────

describe('isAdministrativeQuiz', () => {
  it('returns false for undefined', () => {
    expect(isAdministrativeQuiz(undefined)).toBe(false);
  });

  it('returns true for the canonical administrative question text', () => {
    expect(
      isAdministrativeQuiz({ question: 'This slide contains administrative information.' }),
    ).toBe(true);
  });

  it('returns true when all options are "N/A"', () => {
    expect(
      isAdministrativeQuiz({ question: 'Any?', options: ['N/A', 'N/A', 'N/A'] }),
    ).toBe(true);
  });

  it('returns false for a real quiz question', () => {
    expect(
      isAdministrativeQuiz({ question: 'What is React?', options: ['A', 'B', 'C', 'D'] }),
    ).toBe(false);
  });

  it('returns falsy (undefined) when options is absent — NOTE: this is a latent bug (should return false)', () => {
    // BUG: `quiz.options && quiz.options.every(...)` short-circuits to undefined
    // when options is not present. The return should be `!!quiz.options && ...`.
    // This test documents actual behavior; do NOT "fix" by loosening it further.
    expect(isAdministrativeQuiz({ question: 'Normal question?' })).toBeFalsy();
  });
});

// ─── handleGenerateSummary ────────────────────────────────────────────────────

describe('handleGenerateSummary', () => {
  it('calls updateSlide with generated summary on success', async () => {
    server.use(
      http.post(`${API}/ai/generate-summary`, () =>
        HttpResponse.json({ summary: 'AI summary of content' }),
      ),
    );
    const slides = [makeSlide()];
    const { result, updateSlide } = makeHook(slides);

    await act(async () => {
      await result.current.handleGenerateSummary(0);
    });

    expect(updateSlide).toHaveBeenCalledWith(0, 'summary', 'AI summary of content');
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Summary Generated' }));
  });

  it('shows destructive toast and does NOT call updateSlide when content is empty', async () => {
    const slides = [makeSlide('')];
    const { result, updateSlide } = makeHook(slides);

    await act(async () => {
      await result.current.handleGenerateSummary(0);
    });

    expect(updateSlide).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'No content', variant: 'destructive' }),
    );
  });

  it('shows error toast when API returns 500', async () => {
    server.use(
      http.post(`${API}/ai/generate-summary`, () =>
        new HttpResponse('Internal Error', { status: 500 }),
      ),
    );
    const slides = [makeSlide()];
    const { result } = makeHook(slides);

    await act(async () => {
      await result.current.handleGenerateSummary(0);
    });

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'AI Error', variant: 'destructive' }),
    );
  });

  it('sets isAiLoading for the operation while in flight, then clears it', async () => {
    let resolveRequest: (v: unknown) => void;
    server.use(
      http.post(`${API}/ai/generate-summary`, () =>
        new Promise((resolve) => { resolveRequest = resolve; }),
      ),
    );
    const slides = [makeSlide()];
    const { result, updateSlide } = makeHook(slides);

    // Start without awaiting
    act(() => { void result.current.handleGenerateSummary(0); });

    await waitFor(() => {
      expect(result.current.isAiLoading(0, 'summary')).toBe(true);
    });

    // Resolve the request
    await act(async () => {
      resolveRequest!(HttpResponse.json({ summary: 'done' }));
    });

    expect(result.current.isAiLoading(0, 'summary')).toBe(false);
  });
});

// ─── handleGenerateQuiz ───────────────────────────────────────────────────────

describe('handleGenerateQuiz', () => {
  it('calls updateSlide with question data on success', async () => {
    server.use(
      http.post(`${API}/ai/generate-quiz`, () =>
        HttpResponse.json({
          question: 'What is 2+2?',
          options: ['3', '4', '5', '6'],
          correctAnswer: 1,
          explanation: 'Basic arithmetic',
        }),
      ),
    );
    const slides = [makeSlide()];
    const { result, updateSlide } = makeHook(slides);

    await act(async () => {
      await result.current.handleGenerateQuiz(0);
    });

    expect(updateSlide).toHaveBeenCalledWith(
      0,
      'questions',
      expect.arrayContaining([
        expect.objectContaining({ question: 'What is 2+2?' }),
      ]),
    );
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Quiz Generated' }));
  });

  it('does NOT add question and shows admin toast for administrative quiz', async () => {
    server.use(
      http.post(`${API}/ai/generate-quiz`, () =>
        HttpResponse.json({
          question: 'This slide contains administrative information.',
          options: ['N/A', 'N/A', 'N/A', 'N/A'],
          correctAnswer: 0,
        }),
      ),
    );
    const slides = [makeSlide('Welcome to Syllabus Day. Office hours: M-F 9-5.')];
    const { result, updateSlide } = makeHook(slides);

    await act(async () => {
      await result.current.handleGenerateQuiz(0);
    });

    // Should call updateSlide with empty questions array
    expect(updateSlide).toHaveBeenCalledWith(0, 'questions', []);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Syllabus / Logistical Slide' }),
    );
  });

  it('shows destructive toast when content is empty', async () => {
    const slides = [makeSlide('')];
    const { result, updateSlide } = makeHook(slides);

    await act(async () => {
      await result.current.handleGenerateQuiz(0);
    });

    expect(updateSlide).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'No content', variant: 'destructive' }),
    );
  });
});

// ─── handleGenerateTitle ──────────────────────────────────────────────────────

describe('handleGenerateTitle', () => {
  it('calls updateSlide with AI-suggested title', async () => {
    server.use(
      http.post(`${API}/ai/suggest-title`, () =>
        HttpResponse.json({ title: 'The Powerhouse' }),
      ),
    );
    const slides = [makeSlide()];
    const { result, updateSlide } = makeHook(slides);

    await act(async () => {
      await result.current.handleGenerateTitle(0);
    });

    expect(updateSlide).toHaveBeenCalledWith(0, 'title', 'The Powerhouse');
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Title Suggested' }));
  });

  it('shows error toast on 500', async () => {
    server.use(
      http.post(`${API}/ai/suggest-title`, () =>
        new HttpResponse('err', { status: 500 }),
      ),
    );
    const slides = [makeSlide()];
    const { result } = makeHook(slides);

    await act(async () => {
      await result.current.handleGenerateTitle(0);
    });

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'AI Error', variant: 'destructive' }),
    );
  });
});

// ─── handleGenerateContent ────────────────────────────────────────────────────

describe('handleGenerateContent', () => {
  it('calls updateSlide with expanded content', async () => {
    server.use(
      http.post(`${API}/ai/suggest-content`, () =>
        HttpResponse.json({ content: 'Expanded slide content here.' }),
      ),
    );
    const slides = [makeSlide()];
    const { result, updateSlide } = makeHook(slides);

    await act(async () => {
      await result.current.handleGenerateContent(0);
    });

    expect(updateSlide).toHaveBeenCalledWith(0, 'content', 'Expanded slide content here.');
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Content Enhanced' }));
  });
});

// ─── handleGenerateAllQuizzes ─────────────────────────────────────────────────

describe('handleGenerateAllQuizzes', () => {
  it('processes all slides without existing quizzes and shows summary toast', async () => {
    // 2 slides with content, no existing quiz suggestions
    const slides = [makeSlide(), makeSlide('Second slide content here.')];
    // Clear the default question so they count as pending
    slides[0].questions = [{ question: '', options: ['', '', '', ''], correctAnswer: 0 }];
    slides[1].questions = [{ question: '', options: ['', '', '', ''], correctAnswer: 0 }];
    const { result } = makeHook(slides);

    await act(async () => {
      await result.current.handleGenerateAllQuizzes();
    });

    await waitFor(() => {
      expect(result.current.isBulkGenerating).toBe(false);
    });

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Quiz Suggestions Ready' }),
    );
    // Both slides should now have suggested quizzes
    expect(Object.keys(result.current.suggestedQuizzes)).toHaveLength(2);
  });

  it('does nothing when all slides already have suggested quizzes', async () => {
    const slides = [makeSlide()];
    const { result } = makeHook(slides);

    // Pre-populate suggestedQuizzes via state
    act(() => {
      result.current.setSuggestedQuizzes({
        0: { question: 'Pre-existing?', options: ['A', 'B', 'C', 'D'], correctAnswer: 0, added: true },
      });
    });

    await act(async () => {
      await result.current.handleGenerateAllQuizzes();
    });

    // Should not show any toast since nothing was pending
    expect(toastMock).not.toHaveBeenCalled();
  });
});
