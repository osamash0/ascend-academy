import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StudioHomeScreen from '../../screens/StudioHomeScreen';
import StudioCanvasScreen from '../../screens/StudioCanvasScreen';

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/v4/library/studio" element={<StudioHomeScreen />} />
        <Route path="/v4/library/studio/c/:canvasId" element={<StudioCanvasScreen />} />
      </Routes>
    </MemoryRouter>,
  );

describe('Studio home', () => {
  it('offers to open a Material and to continue recent work', async () => {
    at('/v4/library/studio');
    expect(await screen.findByRole('heading', { name: 'Studio' }, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByLabelText(/open material/i)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Normalization\.pdf/ }, { timeout: 2000 })).toHaveAttribute('href', '/v4/library/studio/c/c-norm');
    expect(screen.getByRole('link', { name: 'Manage uploads' })).toHaveAttribute('href', '/v4/library/uploads');
  });
});

describe('Studio canvas', () => {
  it('shows the clean version page by page, with markers only on extracted blocks', async () => {
    const { container } = at('/v4/library/studio/c/c-norm');
    expect(await screen.findByRole('heading', { name: 'Normalization.pdf' }, { timeout: 2000 })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-view="clean"][data-page-anchor]').length).toBeGreaterThanOrEqual(10);
    expect(screen.getAllByRole('button', { name: /Show the original, page 2/ }).length).toBeGreaterThan(0);
    const written = container.querySelector('[data-block-id="w-1"]')!;
    expect(written.querySelector('button')).toBeNull();
  });

  it('underlines low-confidence OCR text', async () => {
    const { container } = at('/v4/library/studio/c/c-norm');
    await screen.findByRole('heading', { name: 'Normalization.pdf' }, { timeout: 2000 });
    expect(container.querySelector('[data-block-id="c-p2-hw"] .decoration-dotted')).not.toBeNull();
  });

  it('says so when the canvas does not exist', async () => {
    at('/v4/library/studio/c/nope');
    expect(await screen.findByText(/That Material isn’t here/, undefined, { timeout: 2000 })).toBeInTheDocument();
  });
});
