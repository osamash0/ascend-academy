import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StudioCanvasScreen from '../../screens/StudioCanvasScreen';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

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

describe('Peek on the canvas', () => {
  it('opens on hover-rest with the page and an outline', async () => {
    const { container } = await mount();
    const block = container.querySelector('[data-block-id="c-p2-hw"]')!;
    fireEvent.pointerEnter(block, { pointerType: 'mouse' });
    await act(async () => { vi.advanceTimersByTime(350); });
    const peek = screen.getByRole('complementary', { name: 'Original page' });
    expect(peek).toHaveTextContent('Normalization.pdf · page 2');
    expect(screen.getByTestId('peek-outline')).toBeInTheDocument();
  });

  it('opens from the marker at once, and pins', async () => {
    await mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'Show the original, page 2' })[0]);
    const pin = screen.getByRole('button', { name: 'Pin' });
    expect(pin).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(pin);
    expect(screen.getByRole('button', { name: 'Pin' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the whole page without an outline when there are no coordinates', async () => {
    await mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'Show the original, page 3' })[0]);
    expect(screen.getByRole('complementary', { name: 'Original page' })).toHaveTextContent('page 3');
    expect(screen.queryByTestId('peek-outline')).toBeNull();
  });

  it('closes on Escape', async () => {
    await mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'Show the original, page 2' })[0]);
    fireEvent.keyDown(window, { key: 'Escape' });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(screen.queryByRole('complementary', { name: 'Original page' })).toBeNull();
  });

  it('stays open after Pin then unpin while the pointer is over it', async () => {
    await mount();
    fireEvent.click(screen.getAllByRole('button', { name: 'Show the original, page 2' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole('complementary', { name: 'Original page' })).toBeInTheDocument();
  });
});
