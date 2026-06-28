/**
 * Tests for useSlideManager.
 *
 * This hook is pure React state — no I/O, no mocking needed.
 * We verify slide CRUD and activeSlideIndex bookkeeping.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSlideManager } from '@/hooks/useSlideManager';

// ─── addSlide ─────────────────────────────────────────────────────────────────

describe('useSlideManager — addSlide', () => {
  it('appends a blank slide and moves activeSlideIndex to the end', () => {
    const { result } = renderHook(() => useSlideManager());
    act(() => { result.current.addSlide(); });
    expect(result.current.slides).toHaveLength(1);
    expect(result.current.activeSlideIndex).toBe(0);
    expect(result.current.slides[0].title).toBe('');
    expect(result.current.slides[0].questions).toHaveLength(1);
  });

  it('appends a second slide and moves focus to index 1', () => {
    const { result } = renderHook(() => useSlideManager());
    act(() => { result.current.addSlide(); });
    act(() => { result.current.addSlide(); });
    expect(result.current.slides).toHaveLength(2);
    expect(result.current.activeSlideIndex).toBe(1);
  });

  it('inserts a slide after the specified index', () => {
    const { result } = renderHook(() => useSlideManager());
    // Build slides one at a time so slidesRef is fresh between calls
    act(() => { result.current.addSlide(); });
    act(() => { result.current.addSlide(); });
    act(() => { result.current.updateSlide(0, 'title', 'A'); });
    act(() => { result.current.updateSlide(1, 'title', 'B'); });
    // Insert after index 0 → should produce [A, new, B]
    act(() => { result.current.addSlide(0); });
    expect(result.current.slides).toHaveLength(3);
    expect(result.current.slides[0].title).toBe('A');
    expect(result.current.slides[1].title).toBe('');  // newly inserted
    expect(result.current.slides[2].title).toBe('B');
    expect(result.current.activeSlideIndex).toBe(1);
  });
});

// ─── removeSlide ──────────────────────────────────────────────────────────────

describe('useSlideManager — removeSlide', () => {
  it('removes a slide from the middle', () => {
    const { result } = renderHook(() => useSlideManager());
    // Add 3 slides — each in its own act() so slidesRef stays current
    act(() => { result.current.addSlide(); });
    act(() => { result.current.addSlide(); });
    act(() => { result.current.addSlide(); });
    act(() => { result.current.updateSlide(0, 'title', 'A'); });
    act(() => { result.current.updateSlide(1, 'title', 'B'); });
    act(() => { result.current.updateSlide(2, 'title', 'C'); });
    act(() => { result.current.removeSlide(1); });
    expect(result.current.slides).toHaveLength(2);
    expect(result.current.slides.map((s) => s.title)).toEqual(['A', 'C']);
  });

  it('removes the last (only) slide — results in empty array', () => {
    const { result } = renderHook(() => useSlideManager());
    act(() => { result.current.addSlide(); });
    act(() => { result.current.removeSlide(0); });
    expect(result.current.slides).toHaveLength(0);
    expect(result.current.activeSlideIndex).toBe(0);
  });

  it('removes the first slide and adjusts activeSlideIndex', () => {
    const { result } = renderHook(() => useSlideManager());
    act(() => { result.current.addSlide(); });
    act(() => { result.current.addSlide(); });
    act(() => { result.current.setActiveSlideIndex(1); });
    act(() => { result.current.removeSlide(0); });
    expect(result.current.slides).toHaveLength(1);
    // activeSlideIndex was 1; removed index 0 (which is ≤ active) → moves to 0
    expect(result.current.activeSlideIndex).toBe(0);
  });

  it('removes the last slide and clamps activeSlideIndex', () => {
    const { result } = renderHook(() => useSlideManager());
    act(() => { result.current.addSlide(); });
    act(() => { result.current.addSlide(); });
    act(() => { result.current.setActiveSlideIndex(1); });
    act(() => { result.current.removeSlide(1); });
    expect(result.current.slides).toHaveLength(1);
    expect(result.current.activeSlideIndex).toBe(0);
  });
});

// ─── updateSlide ──────────────────────────────────────────────────────────────

describe('useSlideManager — updateSlide', () => {
  it('updates the title field of the correct slide', () => {
    const { result } = renderHook(() => useSlideManager());
    act(() => { result.current.addSlide(); });
    act(() => { result.current.addSlide(); });
    act(() => { result.current.updateSlide(0, 'title', 'My Title'); });
    expect(result.current.slides[0].title).toBe('My Title');
    expect(result.current.slides[1].title).toBe(''); // other slide untouched
  });

  it('updates the content field', () => {
    const { result } = renderHook(() => useSlideManager());
    act(() => { result.current.addSlide(); });
    act(() => { result.current.updateSlide(0, 'content', 'Hello world'); });
    expect(result.current.slides[0].content).toBe('Hello world');
  });

  it('does not mutate other slides', () => {
    const { result } = renderHook(() => useSlideManager());
    act(() => { result.current.addSlide(); });
    act(() => { result.current.addSlide(); });
    act(() => { result.current.addSlide(); });
    act(() => { result.current.updateSlide(1, 'summary', 'mid'); });
    expect(result.current.slides[0].summary).toBe('');
    expect(result.current.slides[2].summary).toBe('');
  });
});

// ─── updateQuestionText ───────────────────────────────────────────────────────

describe('useSlideManager — updateQuestionText', () => {
  it('updates the question text on the correct slide/question', () => {
    const { result } = renderHook(() => useSlideManager());
    act(() => { result.current.addSlide(); });
    act(() => { result.current.updateQuestionText(0, 0, 'What is 2+2?'); });
    expect(result.current.slides[0].questions[0].question).toBe('What is 2+2?');
  });
});

// ─── updateCorrectAnswer ──────────────────────────────────────────────────────

describe('useSlideManager — updateCorrectAnswer', () => {
  it('updates the correctAnswer index', () => {
    const { result } = renderHook(() => useSlideManager());
    act(() => { result.current.addSlide(); });
    act(() => { result.current.updateCorrectAnswer(0, 0, 3); });
    expect(result.current.slides[0].questions[0].correctAnswer).toBe(3);
  });
});

// ─── updateOption ─────────────────────────────────────────────────────────────

describe('useSlideManager — updateOption', () => {
  it('updates the correct option text without affecting others', () => {
    const { result } = renderHook(() => useSlideManager());
    act(() => { result.current.addSlide(); });
    act(() => { result.current.updateOption(0, 0, 2, 'Option C'); });
    const opts = result.current.slides[0].questions[0].options;
    expect(opts[0]).toBe('');
    expect(opts[1]).toBe('');
    expect(opts[2]).toBe('Option C');
    expect(opts[3]).toBe('');
  });
});
