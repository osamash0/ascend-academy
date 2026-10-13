import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Lesson, Space } from '../types';
import type { Upload } from '../data/world';
import { emptyWorld } from './emptyWorld';

const repo = {
  bringIn: vi.fn(),
  uploads: vi.fn(),
  world: vi.fn(),
};
vi.mock('../data/liveRepository', () => ({ loadLiveRepository: async () => repo }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const { setLiveWorld } = await import('../data/world');
const { bringFilesIn, retryFor, shelfAcceptsFiles, useShelf, useShelfItem } = await import('../data/useShelf');
const { __resetUploads, canResend, uploadsNow } = await import('../data/uploads');

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

  it('a run that failed on the server offers no retry here', () => {
    setLiveWorld(emptyWorld({ canUpload: true, uploads: [upload('run-3', { stage: 'failed' })] }));
    const cover = renderHook(() => useShelf()).result.current.items[0];
    expect(retryFor(cover)).toBeNull();
  });
});
