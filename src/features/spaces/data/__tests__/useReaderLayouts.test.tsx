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
/* A lecture read once is memoised by id, so each test reads its own. */
const L1 = '33333333-3333-4333-8333-333333333333';
const L2 = '44444444-4444-4444-8444-444444444444';
const lecture = (L: string, extra: object) => ({
  bundle: {
    locale: 'en',
    requested_locale: 'en',
    is_original_language: true,
    lecture: { id: L, title: 'Normalization', description: null, total_slides: 2, is_archived: false },
    slides: [1, 2].map((n) => ({ id: `s${n}`, slide_number: n, title: `T${n}`, content_text: 'x', summary: '' })),
  },
  concepts: [{ concept_id: 'c1', name: 'One', weight: 1, slide_indices: [0, 1] }],
  pdf_signed_url: 'https://signed',
  ...extra,
});
const layoutPage = { page: 1, verdict: 'layout', reasons: [], blocks: [], paths: [], version: 1 };
const heldPage = { page: 2, verdict: 'original', reasons: ['3 of 40 words missing'], version: 1 };

beforeEach(() => {
  readerLecture.mockReset();
  readerIdeas.mockReset();
  readerIdeas.mockResolvedValue({ concepts: [] });
});

describe('useReaderContent layouts', () => {
  it('passes the pages with a layout through by page number and leaves out an original page', async () => {
    readerLecture.mockResolvedValue(lecture(L1, { layouts: [layoutPage, heldPage, { page: 3 }] }));
    const { result } = renderHook(() => useReaderContent(S, L1));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect([...result.current.layouts.keys()]).toEqual([1]);
  });

  it('is an empty map when the response carries no layouts', async () => {
    readerLecture.mockResolvedValue(lecture(L2, {}));
    const { result } = renderHook(() => useReaderContent(S, L2));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.layouts.size).toBe(0);
  });
});
