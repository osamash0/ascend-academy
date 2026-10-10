import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StudioCanvasScreen from '../../screens/StudioCanvasScreen';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

const mount = async () => {
  const utils = render(
    <MemoryRouter initialEntries={['/v4/library/studio/c/c-norm']}>
      <Routes>
        <Route path="/v4/library/studio/c/:canvasId" element={<StudioCanvasScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => { vi.advanceTimersByTime(700); });
  return utils;
};
const run = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });

describe('Morph on the canvas', () => {
  it('a tap on the switch shows the originals', async () => {
    const { container } = await mount();
    const sw = screen.getByRole('switch', { name: 'Show original' });
    fireEvent.pointerDown(sw, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(sw, { pointerId: 1 });
    await run(400);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('img', { name: 'Page 2 of Normalization.pdf' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-view="original"]').length).toBeGreaterThan(0);
  });

  it('clicking a region flies back to that paragraph', async () => {
    const { container } = await mount();
    fireEvent.keyDown(window, { key: 'o' });
    fireEvent.keyUp(window, { key: 'o' });
    await run(400);
    fireEvent.click(screen.getByRole('button', { name: /^Back to: Klausurrelevant/ }));
    await run(700);
    expect(screen.getByRole('switch', { name: 'Show original' })).toHaveAttribute('aria-checked', 'false');
    expect(container.querySelector('[data-block-id="c-p2-hw"]')).not.toBeNull();
  });

  it('adding a missing block puts it in your version', async () => {
    const { container } = await mount();
    const before = container.querySelectorAll('[data-block-id]').length;
    fireEvent.keyDown(window, { key: 'o' });
    fireEvent.keyUp(window, { key: 'o' });
    await run(400);
    fireEvent.click(screen.getAllByRole('button', { name: 'Not in your version' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Add to your version' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    await run(400);
    expect(container.querySelectorAll('[data-block-id]').length).toBe(before + 1);
  });
});
