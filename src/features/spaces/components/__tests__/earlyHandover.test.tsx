import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ShelfItem } from '../../studio/shelf';

/*
 * The Library page of a file still being read (`/v4/library/m/:id`): the early
 * reader, and the handover to the Lesson. The shelf item is driven by hand, so
 * either side can notice the Lesson first; the reader is a stand-in that turns
 * pages and can fire its own handover.
 */
const shelfState = vi.hoisted(() => ({
  item: null as ShelfItem | null,
  subs: new Set<() => void>(),
  v: 0,
}));
/* The item, changed from outside as the Library's poll would change it. */
const setItem = (next: ShelfItem | null) => {
  shelfState.item = next;
  shelfState.v += 1;
  shelfState.subs.forEach((f) => f());
};
vi.mock('../../data/useShelf', async (orig) => {
  const { useSyncExternalStore } = await import('react');
  return {
    ...(await orig<object>()),
    useShelfItem: () => {
      useSyncExternalStore(
        (f: () => void) => (shelfState.subs.add(f), () => shelfState.subs.delete(f)),
        () => shelfState.v,
      );
      return { state: shelfState.item ? 'ready' : 'empty', item: shelfState.item };
    },
  };
});
const uploadsMock = vi.hoisted(() => ({ release: vi.fn(), resend: vi.fn(), canResend: vi.fn(() => false) }));
vi.mock('../../data/uploads', async (orig) => ({
  ...(await orig<object>()),
  releaseLocalFile: uploadsMock.release,
  resend: uploadsMock.resend,
  canResend: uploadsMock.canResend,
}));
vi.mock('../reader/EarlyReader', () => ({
  EarlyReader: (p: {
    initialPage?: number;
    refused?: boolean;
    onPage?: (n: number) => void;
    onReady: (l: string, n: number) => void;
    onRetry?: () => void;
  }) => (
    <div data-testid="early" data-initial={p.initialPage} data-refused={String(!!p.refused)}>
      <button type="button" onClick={() => p.onPage?.(7)}>
        turn to 7
      </button>
      <button type="button" onClick={() => p.onReady('L1', 7)}>
        hand over
      </button>
      {p.onRetry && (
        <button type="button" onClick={p.onRetry}>
          retry
        </button>
      )}
    </div>
  ),
}));

const { default: StudioCanvasScreen } = await import('../../screens/StudioCanvasScreen');

const item = (over: Partial<ShelfItem> = {}, lessonId = ''): ShelfItem =>
  ({
    id: 'run-1',
    filename: 'Normalization.pdf',
    pageCount: 12,
    cover: '',
    stage: 'developing',
    share: { kind: 'private' },
    opens: { kind: 'lesson', spaceId: 'u', lessonId },
    progress: { pagesRead: 0, recallKnew: 0, recallTotal: 0, answers: 0, notes: 0 },
    lastOpenedAt: null,
    lastPage: null,
    addedAt: '2026-10-26T10:00:00Z',
    broughtIn: true,
    ...over,
  }) as ShelfItem;

const Probe = () => {
  const l = useLocation();
  return <p data-testid="loc">{l.pathname + l.search}</p>;
};
const mount = (path = '/v4/library/m/run-1') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/v4/library/m/:materialId" element={<StudioCanvasScreen />} />
        <Route path="/v4/space/:spaceId/lesson/:lessonId/faces" element={<p>faces</p>} />
      </Routes>
      <Probe />
    </MemoryRouter>,
  );
const here = () => screen.getByTestId('loc').textContent;

beforeEach(() => {
  shelfState.item = item();
  Object.values(uploadsMock).forEach((f) => f.mockClear());
  uploadsMock.canResend.mockReturnValue(false);
});

describe('the early reader hands over to the Lesson', () => {
  it('its own handover opens the Lesson at the page being read', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'hand over' }));
    expect(here()).toBe('/v4/space/u/lesson/L1/faces?page=7');
    expect(uploadsMock.release).toHaveBeenCalledWith('run-1', 'L1');
  });

  it('the shelf noticing the Lesson first keeps the page too (the race)', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'turn to 7' }));
    /* The Library's poll wins: the item is ready before the reader's own handover fires. */
    act(() => setItem(item({ stage: 'ready' }, 'L1')));
    expect(await screen.findByText('faces')).toBeInTheDocument();
    expect(here()).toBe('/v4/space/u/lesson/L1/faces?page=7');
    expect(uploadsMock.release).toHaveBeenCalledWith('run-1', 'L1');
  });

  it('a swap that lands on an item already a Lesson keeps the asked page', async () => {
    shelfState.item = item({ stage: 'ready' }, 'L1');
    mount('/v4/library/m/run-1?page=5');
    expect(await screen.findByText('faces')).toBeInTheDocument();
    expect(here()).toBe('/v4/space/u/lesson/L1/faces?page=5');
  });

  it('with no page known, the Lesson opens at its start', async () => {
    shelfState.item = item({ stage: 'ready' }, 'L1');
    mount();
    expect(await screen.findByText('faces')).toBeInTheDocument();
    expect(here()).toBe('/v4/space/u/lesson/L1/faces');
  });

  it('opens the reader at the asked page', async () => {
    mount('/v4/library/m/run-1?page=4');
    expect(await screen.findByTestId('early')).toHaveAttribute('data-initial', '4');
  });
});

describe('a refused file', () => {
  it('offers to send it again when the file is still here', async () => {
    shelfState.item = item({ id: 'sending-1', stage: 'failed' });
    uploadsMock.canResend.mockReturnValue(true);
    mount('/v4/library/m/sending-1');
    expect(await screen.findByTestId('early')).toHaveAttribute('data-refused', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(uploadsMock.resend).toHaveBeenCalledWith('sending-1');
  });
});

describe('a temporary id after a reload', () => {
  it('says calmly the file is gone and leads back to the Library', async () => {
    shelfState.item = null;
    mount('/v4/library/m/sending-3');
    expect(await screen.findByText(/only on this device/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Library' })).toHaveAttribute('href', '/v4/library');
  });
});
