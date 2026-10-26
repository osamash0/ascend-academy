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
  it('opens the first file you drop, straight into reading', async () => {
    setLiveWorld(emptyWorld({ canUpload: true }));
    repo.bringIn.mockResolvedValue({ status: 'queued', run_id: 'run-1' });
    repo.uploads.mockResolvedValue({ uploads: [upload('run-1', { filename: 'Normalization.pdf' })] });
    mount();
    await screen.findByRole('heading', { level: 1, name: 'Library' });
    await dropFiles([pdf('Normalization.pdf')]);
    await waitFor(() => expect(here()).toBe('/v4/library/m/run-1'));
    expect(screen.getByText('opened')).toBeInTheDocument();
  });

  it('only the first of several files opens', async () => {
    setLiveWorld(emptyWorld({ canUpload: true }));
    repo.bringIn
      .mockResolvedValueOnce({ status: 'queued', run_id: 'run-1' })
      .mockResolvedValueOnce({ status: 'queued', run_id: 'run-2' });
    repo.uploads.mockResolvedValue({ uploads: [upload('run-2'), upload('run-1')] });
    mount();
    await screen.findByRole('heading', { level: 1, name: 'Library' });
    await dropFiles([pdf('a.pdf'), pdf('b.pdf')]);
    await waitFor(() => expect(here()).toBe('/v4/library/m/run-1'));
  });

  it('a refused file does not navigate', async () => {
    setLiveWorld(emptyWorld({ canUpload: true }));
    repo.bringIn.mockRejectedValue(new Error('Upload → 413: {"detail":"too big"}'));
    mount();
    await screen.findByRole('heading', { level: 1, name: 'Library' });
    await dropFiles([pdf('big.pdf')]);
    await waitFor(() => expect(repo.bringIn).toHaveBeenCalled());
    await act(async () => {});
    expect(here()).toBe('/v4/library');
  });

  it('a duplicate opens the existing shelf item (by its lesson), not the lecture id', async () => {
    setLiveWorld(emptyWorld({ canUpload: true }));
    repo.bringIn.mockResolvedValue({ status: 'duplicate', lecture_id: 'lec-1' });
    const old = upload('run-old', { lessonId: 'lec-1', stage: 'ready', pageCount: 4 });
    repo.world.mockResolvedValue(
      emptyWorld({ canUpload: true, uploads: [old], lessons: [{ id: 'lec-1', percentComplete: 0 } as never] }),
    );
    repo.uploads.mockResolvedValue({ uploads: [old] });
    mount();
    await screen.findByRole('heading', { level: 1, name: 'Library' });
    await dropFiles([pdf('again.pdf')]);
    await waitFor(() => expect(here()).toBe('/v4/library/m/run-old'));
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
