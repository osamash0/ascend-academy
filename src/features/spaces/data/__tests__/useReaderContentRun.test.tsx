import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const readerLecture = vi.fn();
const readerIdeas = vi.fn();
vi.mock('../liveRepository', async (orig) => ({
  ...(await orig<object>()),
  loadLiveRepository: async () => ({ readerLecture, readerIdeas }),
}));
vi.stubEnv('VITE_V4_DATA_MODE', 'live');

const { useReaderContent } = await import('../useReader');
const { default: i18n } = await import('@/i18n');

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

  it('never leaves a partial read in the memo for a later visit without a run', async () => {
    const L2 = '33333333-3333-4333-8333-333333333333';
    const lec = (n: number) => {
      const l = lecture(n);
      l.bundle.lecture.id = L2;
      return l;
    };
    readerLecture.mockResolvedValueOnce(lec(8)).mockResolvedValueOnce(lec(16));
    const first = renderHook(() => useReaderContent(S, L2, { pagesReady: 8, done: false }));
    await waitFor(() => expect(first.result.current.bundle?.slides.length).toBe(8));
    first.unmount();
    const later = renderHook(() => useReaderContent(S, L2, null));
    await waitFor(() => expect(later.result.current.bundle?.slides.length).toBe(16));
    expect(readerLecture).toHaveBeenCalledTimes(2);
  });

  it('without a run, a language change goes back to loading before the new read, as before', async () => {
    const L3 = '44444444-4444-4444-8444-444444444444';
    const lec = (n: number) => {
      const l = lecture(n);
      l.bundle.lecture.id = L3;
      return l;
    };
    readerLecture.mockResolvedValueOnce(lec(8));
    const seen: string[] = [];
    const { result } = renderHook(() => {
      const r = useReaderContent(S, L3, null);
      seen.push(r.state);
      return r;
    });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    seen.length = 0;
    await act(async () => {
      await i18n.changeLanguage(i18n.language === 'de' ? 'en' : 'de');
    });
    expect(seen).toContain('loading');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });
});
