import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StudioHomeScreen from '../../screens/StudioHomeScreen';
import LibraryScreen from '../../screens/LibraryScreen';
import StudioCanvasScreen from '../../screens/StudioCanvasScreen';

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/v4/library/studio" element={<StudioHomeScreen />} />
        <Route path="/v4/library/m/:materialId" element={<StudioCanvasScreen />} />
      </Routes>
    </MemoryRouter>,
  );

describe('Studio home', () => {
  it('offers to open a Material and to continue recent work', async () => {
    at('/v4/library/studio');
    expect(await screen.findByRole('heading', { name: 'Studio' }, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByLabelText(/open material/i)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Normalization\.pdf/ }, { timeout: 2000 })).toHaveAttribute('href', '/v4/library/studio/c/c-norm');
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage uploads' })).toHaveAttribute('href', '/v4/library/uploads');
    expect(screen.getAllByRole('link', { name: 'Library' }).some((l) => l.getAttribute('href') === '/v4/library')).toBe(true);
  });
});

describe('Library has no Studio door', () => {
  // One Library (spec §4): Studio is no longer a place, so the shelf has no door to it.
  it('shows the shelf and no Studio nav', async () => {
    render(
      <MemoryRouter>
        <LibraryScreen />
      </MemoryRouter>,
    );
    await screen.findByRole('tablist', { name: 'Filter' }, { timeout: 3000 });
    expect(screen.queryByRole('navigation', { name: 'Studio' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Studio' })).toBeNull();
  });
});

describe('Studio canvas', () => {
  it('shows the Learn view page by page, with markers only on extracted blocks', async () => {
    const { container } = at('/v4/library/m/m-norm');
    expect(await screen.findByRole('heading', { name: 'Normalization.pdf' }, { timeout: 2000 })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-view="clean"][data-page-anchor]').length).toBeGreaterThanOrEqual(10);
    expect(screen.getAllByRole('button', { name: /Show the source, page 2/ }).length).toBeGreaterThan(0);
    const written = container.querySelector('[data-block-id="w-1"]')!;
    expect(written.querySelector('button')).toBeNull();
  });

  it('underlines low-confidence OCR text', async () => {
    const { container } = at('/v4/library/m/m-norm');
    await screen.findByRole('heading', { name: 'Normalization.pdf' }, { timeout: 2000 });
    expect(container.querySelector('[data-block-id="c-p2-hw"] .decoration-dotted')).not.toBeNull();
  });

  it('says so when the canvas does not exist', async () => {
    at('/v4/library/m/nope');
    expect(await screen.findByText(/That Material isn’t here/, undefined, { timeout: 2000 })).toBeInTheDocument();
  });
});

describe('canvas states', () => {
  const setSearch = (q: string) => window.history.replaceState({}, '', `/?mock=${q}`);
  afterEach(() => window.history.replaceState({}, '', '/'));

  it('renders the error state', async () => {
    setSearch('error');
    at('/v4/library/m/m-norm');
    expect(await screen.findByText(/Couldn’t load this Material/, undefined, { timeout: 2000 })).toBeInTheDocument();
  });

  it('renders the loading state', () => {
    setSearch('loading');
    const { container } = at('/v4/library/m/m-norm');
    expect(container.querySelector('.studio-surface')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Normalization.pdf' })).toBeNull();
  });
});
