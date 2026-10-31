import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Lesson, Space } from '../types';
import type { Upload } from '../data/world';
import { emptyWorld } from './emptyWorld';

const repo = {
  bringIn: vi.fn(),
  uploads: vi.fn(),
  removeUpload: vi.fn(),
  world: vi.fn(),
};
vi.mock('../data/liveRepository', () => ({ loadLiveRepository: async () => repo }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const { setLiveWorld } = await import('../data/world');
const { UNDO_MS, bringFilesIn, canRemove, removeFromShelf, retryFor, shelfAcceptsFiles, useShelf, useShelfItem } =
  await import('../data/useShelf');
const { __resetUploads, canResend, localUrlFor, uploadsNow } = await import('../data/uploads');

const upload = (id: string, over: Partial<Upload> = {}): Upload => ({
  id,
  lessonId: null,
  filename: `${id}.pdf`,
  title: null,
  pageCount: 0,
  stage: 'developing',
  addedAt: '2026-10-13T20:00:00Z',
  ...over,
});
const mine = { id: 'u', name: 'My materials', personal: true, viewerRole: 'owner' } as Space;
const graphs = { id: 'lec-1', spaceId: 'u', order: 1, title: 'Graphs', percentComplete: 50, concepts: [] } as unknown as Lesson;

beforeEach(() => {
  __resetUploads();
  Object.values(repo).forEach((f) => f.mockReset());
});
afterEach(() => setLiveWorld(null));

describe('your uploads on a real shelf', () => {
  it('shows each upload as a private cover that opens its Lesson in your own Space', () => {
    setLiveWorld(emptyWorld({
      canUpload: true,
      spaces: [mine],
      lessons: [graphs],
      uploads: [
        upload('run-2'),
        upload('run-1', { lessonId: 'lec-1', stage: 'ready', pageCount: 10, filename: 'graphs.pdf' }),
      ],
    }));
    expect(shelfAcceptsFiles()).toBe(true);
    const { items } = renderHook(() => useShelf()).result.current;
    expect(items.map((i) => [i.id, i.stage, i.opens])).toEqual([
      ['run-2', 'developing', { kind: 'lesson', spaceId: 'u', lessonId: '' }],
      ['run-1', 'ready', { kind: 'lesson', spaceId: 'u', lessonId: 'lec-1' }],
    ]);
    expect(items[1]).toMatchObject({ share: { kind: 'private' }, progress: { pagesRead: 5 } });
    expect(renderHook(() => useShelfItem('run-1')).result.current.item?.filename).toBe('graphs.pdf');
  });

  it('a file sent shows at once, then becomes the server’s run', async () => {
    setLiveWorld(emptyWorld({ canUpload: true }));
    repo.bringIn.mockResolvedValue({ status: 'queued', run_id: 'run-9' });
    repo.uploads.mockResolvedValue({ uploads: [upload('run-9', { filename: 'week3.pdf' })] });

    const [id] = bringFilesIn([new File(['%PDF'], 'week3.pdf')], false);
    expect(uploadsNow()[0]).toMatchObject({ id, filename: 'week3.pdf', stage: 'developing' });
    await waitFor(() => expect(uploadsNow().map((u) => u.id)).toEqual(['run-9']));
    expect(repo.bringIn).toHaveBeenCalledTimes(1);
  });

  it('a reader still on the temporary id keeps the same link while it moves to the run', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:the-file');
    setLiveWorld(emptyWorld({ canUpload: true }));
    repo.bringIn.mockResolvedValue({ status: 'queued', run_id: 'run-9' });
    repo.uploads.mockResolvedValue({ uploads: [upload('run-9', { filename: 'ueb00.pdf' })] });

    const [id] = bringFilesIn([new File(['%PDF'], 'ueb00.pdf')], false);
    expect(localUrlFor(id)).toBe('blob:the-file');
    /* The real cover is on the shelf; the reader has not swapped yet. It must never see no file. */
    await waitFor(() => expect(uploadsNow().map((u) => u.id)).toEqual(['run-9']));
    expect(localUrlFor(id)).toBe('blob:the-file');
    expect(localUrlFor('run-9')).toBe('blob:the-file');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('a refused file stays, failed, with the server’s reason — and can be sent again', async () => {
    setLiveWorld(emptyWorld({ canUpload: true }));
    repo.bringIn.mockRejectedValueOnce(
      new Error('Upload /api/v1/v4/uploads → 403: {"detail":"You have used all 5 uploads for this month."}'),
    );
    const { toast } = await import('sonner');

    const [id] = bringFilesIn([new File(['%PDF'], 'big.pdf')], false);
    await waitFor(() => expect(uploadsNow()[0].stage).toBe('failed'));
    expect(toast.error).toHaveBeenCalledWith('big.pdf: You have used all 5 uploads for this month.');
    expect(canResend(id)).toBe(true);

    const cover = renderHook(() => useShelf()).result.current.items[0];
    repo.bringIn.mockResolvedValue({ status: 'queued', run_id: 'run-10' });
    repo.uploads.mockResolvedValue({ uploads: [upload('run-10')] });
    act(() => retryFor(cover)!());
    await waitFor(() => expect(uploadsNow().map((u) => u.id)).toEqual(['run-10']));
  });

  describe('removing', () => {
    const shelf = () =>
      emptyWorld({
        canUpload: true,
        spaces: [mine],
        lessons: [graphs],
        uploads: [
          upload('run-2'),
          upload('run-1', { lessonId: 'lec-1', stage: 'ready' }),
          upload('run-0', { stage: 'failed' }),
        ],
      });
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('leaves the shelf at once and deletes only when Undo has passed', async () => {
      setLiveWorld(shelf());
      repo.removeUpload.mockResolvedValue({ removed: true });
      repo.world.mockResolvedValue(shelf()); // reloaded quietly afterwards
      const items = renderHook(() => useShelf()).result.current.items;

      const r = removeFromShelf(items);
      expect(r.removed).toBe(2); // the one still being read stays
      expect(uploadsNow().map((u) => u.id)).toEqual(['run-2']);
      expect(repo.removeUpload).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(UNDO_MS);
      // A read file goes by its Lesson; a failed one by its run.
      expect(repo.removeUpload.mock.calls.map((c) => c[0]).sort()).toEqual(['lec-1', 'run-0']);
      expect(repo.world).toHaveBeenCalledTimes(1);
    });

    it('Undo inside the window deletes nothing and puts them back', async () => {
      setLiveWorld(shelf());
      const r = removeFromShelf(renderHook(() => useShelf()).result.current.items);
      r.undo();
      await vi.advanceTimersByTimeAsync(UNDO_MS * 2);
      expect(repo.removeUpload).not.toHaveBeenCalled();
      expect(uploadsNow().map((u) => u.id)).toEqual(['run-2', 'run-1', 'run-0']);
    });

    it('a delete that fails comes back and says so', async () => {
      setLiveWorld(shelf());
      repo.removeUpload.mockRejectedValue(new Error('500'));
      const { toast } = await import('sonner');
      const ready = renderHook(() => useShelf()).result.current.items.filter((i) => i.id === 'run-1');
      expect(canRemove(ready[0])).toBe(true);

      removeFromShelf(ready);
      await vi.advanceTimersByTimeAsync(UNDO_MS);
      expect(uploadsNow().map((u) => u.id)).toEqual(['run-2', 'run-1', 'run-0']);
      expect(toast.error).toHaveBeenCalledWith('run-1.pdf could not be removed. It is back on your shelf.');
    });
  });

  it('a run that failed on the server offers no retry here', () => {
    setLiveWorld(emptyWorld({ canUpload: true, uploads: [upload('run-3', { stage: 'failed' })] }));
    const cover = renderHook(() => useShelf()).result.current.items[0];
    expect(retryFor(cover)).toBeNull();
  });
});
