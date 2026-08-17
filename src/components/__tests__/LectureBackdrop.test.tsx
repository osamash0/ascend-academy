import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LectureBackdrop } from '@/components/console/LectureBackdrop';

/**
 * Regression guard for the Supabase egress fix.
 *
 * LectureBackdrop used to paint the console hero by handing the lecture's
 * pdf_url to react-pdf and rendering page 1. pdf.js auto-fetches the rest of a
 * document, so focusing a lecture in the library downloaded its entire PDF --
 * 1.6 MB on average, up to 6.9 MB -- purely as decoration. That was the dominant
 * contributor to a 5 GB egress overage at only 15 monthly active users.
 *
 * The backdrop must now read only the small pre-rendered poster. If someone
 * re-points it at the PDF, these tests fail.
 */

const resolvePosterUrl = vi.fn();
const resolvePdfUrl = vi.fn();

vi.mock('@/services/lectureService', () => ({
  get resolvePosterUrl() {
    return resolvePosterUrl;
  },
  get resolvePdfUrl() {
    return resolvePdfUrl;
  },
}));

/**
 * LectureBackdrop keeps a module-level signed-URL cache that intentionally
 * outlives unmounts, so each test needs its own lecture id or it would be served
 * from a previous test's cache entry.
 */
let idCounter = 0;
const nextLecture = () => {
  idCounter += 1;
  const id = `1f7113e4-de82-4095-9538-6fc0871aa5${String(idCounter).padStart(2, '0')}`;
  return { lectureId: id, posterUrl: `lectures/${id}/poster.webp` };
};

describe('LectureBackdrop', () => {
  beforeEach(() => {
    resolvePosterUrl.mockReset().mockResolvedValue('https://storage/poster.webp?token=abc');
    resolvePdfUrl.mockReset();
  });

  it('renders the poster as an image', async () => {
    render(<LectureBackdrop {...nextLecture()} />);

    const img = await waitFor(() => screen.getByRole('presentation', { hidden: true }));
    expect(img).toHaveAttribute('src', 'https://storage/poster.webp?token=abc');
  });

  it('never resolves or fetches the source PDF', async () => {
    render(<LectureBackdrop {...nextLecture()} />);
    await waitFor(() => expect(resolvePosterUrl).toHaveBeenCalledTimes(1));

    // The whole point of the fix: no PDF resolution, ever.
    expect(resolvePdfUrl).not.toHaveBeenCalled();
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('shows the ambient gradient only when a lecture has no poster', async () => {
    const { container } = render(
      <LectureBackdrop lectureId={nextLecture().lectureId} posterUrl={null} />,
    );

    await waitFor(() => expect(container.querySelector('div')).toBeTruthy());
    expect(container.querySelector('img')).toBeNull();
    // Must not silently fall back to the PDF when a poster is missing.
    expect(resolvePosterUrl).not.toHaveBeenCalled();
    expect(resolvePdfUrl).not.toHaveBeenCalled();
  });

  it('reveals a poster that was already cached before onLoad could fire', async () => {
    // Browser-verified regression: `load` does not bubble, so React attaches the
    // handler directly to the <img>. A memory-cached poster can dispatch `load`
    // in the gap between element creation and listener attachment, so `onLoad`
    // never fires. The backdrop then sat at opacity 0 forever and the hero looked
    // empty -- the art was fully downloaded and decoded but invisible.
    // jsdom never fires load on its own, so an untouched <img> here reproduces
    // exactly that "event already missed" state.
    // Every <img> reports complete/naturalWidth as if served from cache, set
    // before render so the very first effect sees it.
    Object.defineProperty(HTMLImageElement.prototype, 'complete', {
      get: () => true,
      configurable: true,
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      get: () => 1440,
      configurable: true,
    });

    try {
      render(<LectureBackdrop {...nextLecture()} />);
      const img = await waitFor(() => screen.getByRole('presentation', { hidden: true }));

      // Must reach FULL opacity. Asserting merely "> 0" would not catch the bug:
      // when it was live the wrapper sat frozen at ~0.06, a stale interrupted
      // value, because the animation target was 0.
      await waitFor(
        () => {
          const opacity = Number(img.parentElement!.style.opacity || '1');
          expect(opacity).toBeGreaterThan(0.9);
        },
        { timeout: 3000 },  // the reveal is a 1.1s fade
      );
    } finally {
      // @ts-expect-error -- restore jsdom's own descriptors for the other tests
      delete HTMLImageElement.prototype.complete;
      // @ts-expect-error -- ditto
      delete HTMLImageElement.prototype.naturalWidth;
    }
  });

  it('does not re-resolve a poster it has already seen', async () => {
    const props = nextLecture();
    const { unmount } = render(<LectureBackdrop {...props} />);
    await waitFor(() => expect(resolvePosterUrl).toHaveBeenCalledTimes(1));
    unmount();

    render(<LectureBackdrop {...props} />);
    await waitFor(() => expect(screen.getByRole('presentation', { hidden: true })).toBeTruthy());
    expect(resolvePosterUrl).toHaveBeenCalledTimes(1);
  });
});
