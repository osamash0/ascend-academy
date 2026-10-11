import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import StudioCanvasScreen from '../../screens/StudioCanvasScreen';
import { CanvasRedirect, To } from '../LibraryRedirects';
import * as shelf from '../../mocks/shelf';
import { STUDIO_CANVAS } from '../../mocks/studio-canvas';

const Probe = () => {
  const l = useLocation();
  return <p data-testid="loc">{l.pathname + l.search}</p>;
};

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/v4/library" element={<Probe />} />
        <Route path="/v4/library/m/:materialId" element={<StudioCanvasScreen />} />
        <Route path="/v4/library/studio" element={<To to="/v4/library" />} />
        <Route path="/v4/library/studio/c/:canvasId" element={<CanvasRedirect />} />
        <Route path="/v4/library/uploads" element={<To to="/v4/library?f=reading&select=1" />} />
        <Route path="/v4/library/drafts" element={<To to="/v4/library?f=shared&select=1" />} />
        <Route path="/v4/library/impact" element={<To to="/v4/library?f=shared" />} />
      </Routes>
      <Probe />
      <Link to="/v4/library/m/m-design-notes">to design notes</Link>
    </MemoryRouter>,
  );

const settle = () => act(async () => { vi.advanceTimersByTime(700); });
const item = (id: string) => shelf.getItems().find((i) => i.id === id)!;

beforeEach(() => {
  vi.useFakeTimers();
  shelf.__reset();
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('redirects', () => {
  it.each([
    ['/v4/library/studio', '/v4/library'],
    ['/v4/library/studio/c/c-norm', '/v4/library/m/m-norm'],
    ['/v4/library/uploads', '/v4/library?f=reading&select=1'],
    ['/v4/library/drafts', '/v4/library?f=shared&select=1'],
    ['/v4/library/impact', '/v4/library?f=shared'],
  ])('%s → %s', async (from, to) => {
    at(from);
    await settle();
    expect(screen.getAllByTestId('loc').at(-1)).toHaveTextContent(to);
  });

  it('sends an old canvas link with no page behind it to the shelf', async () => {
    at('/v4/library/studio/c/nope');
    await settle();
    expect(screen.getAllByTestId('loc').at(-1)).toHaveTextContent(/^\/v4\/library$/);
  });

  it('opens a cover backed by a Lesson as that Lesson', async () => {
    at('/v4/library/m/lib-mat-l-s-linalg-3');
    await settle();
    expect(screen.getAllByTestId('loc').at(-1)).toHaveTextContent('/v4/space/s-linalg/lesson/l-s-linalg-3');
  });
});

describe('the canvas by material', () => {
  it('renders at /m/m-norm with the filename, a way back, and no sample line', async () => {
    at('/v4/library/m/m-norm');
    await settle();
    expect(screen.getByRole('heading', { name: 'Normalization.pdf' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Library' })).toHaveAttribute('href', '/v4/library');
    expect(screen.queryByText('Sample pages in this preview')).toBeNull();
  });
  it('says so quietly when the pages are a sample', async () => {
    at('/v4/library/m/m-design-notes');
    await settle();
    expect(screen.getByRole('heading', { name: 'Design process — my notes.pdf' })).toBeInTheDocument();
    expect(screen.getByText('Sample pages in this preview')).toBeInTheDocument();
  });
  it('shows not-found with a way back', async () => {
    at('/v4/library/m/nope');
    await settle();
    expect(screen.getByText(/That Material isn’t here/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Library/ })).toHaveAttribute('href', '/v4/library');
  });
});

describe('progress flows back to the shelf', () => {
  it('opening touches the item, without moving where you were', async () => {
    const before = item('m-norm');
    at('/v4/library/m/m-norm');
    await settle();
    expect(item('m-norm').lastOpenedAt).not.toBe(before.lastOpenedAt);
    expect(item('m-norm').lastPage).toBe(6);
  });
  it('turning to page 7 marks it read', async () => {
    at('/v4/library/m/m-norm');
    await settle();
    const spy = vi.spyOn(shelf, 'markRead');
    expect(item('m-norm').progress.pagesRead).toBe(6);
    const pager = screen.getAllByRole('button', { name: /next page/i })[0];
    for (let n = 0; n < 6; n++) {
      fireEvent.click(pager);
      await act(async () => { vi.advanceTimersByTime(300); });
    }
    expect(item('m-norm').lastPage).toBe(7);
    expect(item('m-norm').progress.pagesRead).toBe(7);
    expect(spy).toHaveBeenCalled();
  });
  it('moving to another page of yours does not count the arrival as a turn', async () => {
    at('/v4/library/m/m-norm');
    await settle();
    const pager = screen.getAllByRole('button', { name: /next page/i })[0];
    fireEvent.click(pager);
    await act(async () => { vi.advanceTimersByTime(300); });
    // A turn was reported, so the screen holds a "last reported" page.
    expect(item('m-norm').lastPage).not.toBe(6);
    // Same screen, new material: where you land there is not a page you turned to.
    fireEvent.click(screen.getByRole('link', { name: 'to design notes' }));
    await settle();
    expect(screen.getByRole('heading', { name: 'Design process — my notes.pdf' })).toBeInTheDocument();
    expect(item('m-design-notes').lastPage).toBeNull();
  });

  it('an answer adds one, Remove takes it back, Undo restores it', async () => {
    shelf.saveCanvas('m-norm', STUDIO_CANVAS); // no answers yet, so one Remove button
    at('/v4/library/m/m-norm');
    await settle();
    const base = item('m-norm').progress.answers;
    const box = screen.getByRole('textbox', { name: 'Ask about this Material' });
    fireEvent.change(box, { target: { value: 'Why does repeated data cause problems?' } });
    fireEvent.submit(box.closest('form')!);
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(item('m-norm').progress.answers).toBe(base + 1);
    await act(async () => { vi.advanceTimersByTime(3000); });
    fireEvent.click(screen.getByRole('button', { name: 'Remove this answer' }));
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(item('m-norm').progress.answers).toBe(base);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await act(async () => { vi.advanceTimersByTime(50); });
    expect(item('m-norm').progress.answers).toBe(base + 1);
  });
});
