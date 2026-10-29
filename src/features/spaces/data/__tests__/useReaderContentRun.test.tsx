import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const readerLecture = vi.fn();
const readerIdeas = vi.fn();
vi.mock('../liveRepository', async (orig) => ({
  ...(await orig<object>()),
  loadLiveRepository: async () => ({ readerLecture, readerIdeas }),
}));
vi.stubEnv('VITE_V4_DATA_MODE', 'live');

const { useReaderContent } = await import('../useReader');

const S = '11111111-1111-4111-8111-111111111111';
const L = '22222222-2222-4222-8222-222222222222';
/* The real ReaderLecture shape: the localized bundle is snake_case under `bundle`. */
const lecture = (n: number) => ({
  bundle: {
    locale: 'en',
    requested_locale: 'en',
    is_original_language: true,
    lecture: { id: L, title: 'Normalization', description: null, total_slides: n, is_archived: false },
    slides: Array.from({ length: n }, (_, i) => ({
      id: `s${i + 1}`,
      slide_number: i + 1,
      title: `T${i + 1}`,
      content_text: 'x',
      summary: '',
    })),
  },
  concepts: [],
  pdf_signed_url: 'https://signed',
});

beforeEach(() => {
  readerLecture.mockReset();
  readerIdeas.mockReset();
  readerIdeas.mockResolvedValue({ concepts: [] });
});

describe('useReaderContent following a running upload', () => {
  it('reads the Lesson again as Luna writes more pages, and asks for ideas only once she is done', async () => {
    readerLecture.mockResolvedValueOnce(lecture(8)).mockResolvedValueOnce(lecture(16)).mockResolvedValueOnce(lecture(16));
    const { result, rerender } = renderHook(({ run }) => useReaderContent(S, L, run), {
      initialProps: { run: { pagesReady: 8, done: false } },
    });
    await waitFor(() => expect(result.current.bundle?.slides.length).toBe(8));
    rerender({ run: { pagesReady: 16, done: false } });
    await waitFor(() => expect(result.current.bundle?.slides.length).toBe(16));
    expect(result.current.state).toBe('ready');
    expect(readerIdeas).not.toHaveBeenCalled();
    rerender({ run: { pagesReady: 16, done: true } });
    await waitFor(() => expect(readerIdeas).toHaveBeenCalledTimes(1));
    expect(readerLecture).toHaveBeenCalledTimes(3);
  });
});
