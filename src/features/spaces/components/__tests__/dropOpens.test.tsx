import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Upload } from '../../data/world';
import { emptyWorld } from '../../__tests__/emptyWorld';

const repo = { bringIn: vi.fn(), uploads: vi.fn(), removeUpload: vi.fn(), world: vi.fn() };
vi.mock('../../data/liveRepository', async (orig) => ({
  ...(await orig<object>()),
  loadLiveRepository: async () => repo,
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const { setLiveWorld } = await import('../../data/world');
const { __resetUploads } = await import('../../data/uploads');
const { default: LibraryScreen } = await import('../../screens/LibraryScreen');
const shelf = await import('../../mocks/shelf');

const Probe = () => <p data-testid="loc">{useLocation().pathname}</p>;
const mount = () =>
  render(
    <MemoryRouter initialEntries={['/v4/library']}>
      <Routes>
        <Route path="/v4/library" element={<LibraryScreen />} />
        <Route path="/v4/library/m/:id" element={<p>opened</p>} />
      </Routes>
      <Probe />
    </MemoryRouter>,
  );
const dropFiles = (files: File[]) =>
  act(async () => {
    fireEvent.drop(window, { dataTransfer: { files, types: ['Files'] } });
  });
const pdf = (name: string) => new File(['%PDF'], name, { type: 'application/pdf' });
const upload = (id: string, over: Partial<Upload> = {}): Upload => ({
  id,
  lessonId: null,
  filename: `${id}.pdf`,
  title: null,
  pageCount: 0,
  stage: 'developing',
  addedAt: '2026-10-26T10:00:00Z',
  ...over,
});
const here = () => screen.getByTestId('loc').textContent;

beforeEach(() => {
  __resetUploads();
  Object.values(repo).forEach((f) => f.mockReset());
});
afterEach(() => {
  setLiveWorld(null);
  shelf.__reset();
});

describe('dropping a file opens it', () => {
  it('opens at once on the temporary id, before the server has answered', async () => {
    setLiveWorld(emptyWorld({ canUpload: true }));
    repo.bringIn.mockReturnValue(new Promise(() => {})); // never answers
    mount();
    await screen.findByRole('heading', { level: 1, name: 'Library' });
    await dropFiles([pdf('Normalization.pdf')]);
    await waitFor(() => expect(here()).toMatch(/^\/v4\/library\/m\/sending-\d+$/));
    expect(screen.getByText('opened')).toBeInTheDocument();
  });

  it('only the first of several files opens', async () => {
    setLiveWorld(emptyWorld({ canUpload: true }));
    repo.bringIn.mockReturnValue(new Promise(() => {}));
    mount();
    await screen.findByRole('heading', { level: 1, name: 'Library' });
    await dropFiles([pdf('a.pdf'), pdf('b.pdf')]);
    const first = here();
    await act(async () => {});
    expect(here()).toBe(first);
    expect(first).toMatch(/\/m\/sending-\d+$/);
  });

  it('the demo world keeps its synchronous path and stays on the shelf', async () => {
    mount();
    await screen.findByRole('heading', { level: 1, name: 'Library' });
    await dropFiles([pdf('Fresh.pdf')]);
    await act(async () => {});
    expect(here()).toBe('/v4/library');
    expect(repo.bringIn).not.toHaveBeenCalled();
  });
});

describe('the temporary id resolves', () => {
  it('maps to the run id once accepted and on the shelf, and the file stays readable from this device', async () => {
    const { bringInLive, resolvedUploadId, localFileFor } = await import('../../data/uploads');
    setLiveWorld(emptyWorld({ canUpload: true }));
    repo.bringIn.mockResolvedValue({ status: 'queued', run_id: 'run-1' });
    repo.uploads.mockResolvedValue({ uploads: [upload('run-1')] });
    const [id] = bringInLive([pdf('a.pdf')]);
    expect(localFileFor(id)?.name).toBe('a.pdf');
    expect(resolvedUploadId(id)).toBeNull();
    await waitFor(() => expect(resolvedUploadId(id)).toBe('run-1'));
    expect(localFileFor('run-1')?.name).toBe('a.pdf');
  });

  it('a duplicate resolves to the cover that already holds the Lesson', async () => {
    const { bringInLive, resolvedUploadId } = await import('../../data/uploads');
    setLiveWorld(emptyWorld({ canUpload: true }));
    const old = upload('run-old', { lessonId: 'lec-1', stage: 'ready', pageCount: 4 });
    repo.bringIn.mockResolvedValue({ status: 'duplicate', lecture_id: 'lec-1' });
    repo.world.mockResolvedValue(
      emptyWorld({ canUpload: true, uploads: [old], lessons: [{ id: 'lec-1', percentComplete: 0 } as never] }),
    );
    repo.uploads.mockResolvedValue({ uploads: [old] });
    const [id] = bringInLive([pdf('again.pdf')]);
    await waitFor(() => expect(resolvedUploadId(id)).toBe('run-old'));
  });

  it('a refused file never resolves, and its failed cover stays', async () => {
    const { bringInLive, resolvedUploadId, uploadsNow } = await import('../../data/uploads');
    setLiveWorld(emptyWorld({ canUpload: true }));
    repo.bringIn.mockRejectedValue(new Error('Upload → 413: {"detail":"too big"}'));
    const [id] = bringInLive([pdf('big.pdf')]);
    await waitFor(() => expect(uploadsNow().find((u) => u.id === id)?.stage).toBe('failed'));
    expect(resolvedUploadId(id)).toBeNull();
  });
});
