import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Peek } from '../components/Peek';
import type { Region } from '../geometry';
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

const openFromMarker = () =>
  fireEvent.click(screen.getAllByRole('button', { name: 'Show the original, page 2' })[0]);

describe('Full page', () => {
  it('outlives the Peek that opened it and does not reopen later', async () => {
    await mount();
    openFromMarker();
    fireEvent.click(screen.getByRole('button', { name: /Full page/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.pointerLeave(screen.getByRole('complementary', { name: 'Original page', hidden: true }));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByRole('dialog')).toBeNull();
    openFromMarker();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Escape while it is open does not close the Peek', async () => {
    await mount();
    openFromMarker();
    fireEvent.click(screen.getByRole('button', { name: /Full page/ }));
    fireEvent.keyDown(window, { key: 'Escape' });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole('complementary', { name: 'Original page', hidden: true })).toBeInTheDocument();
  });
});

describe('Peek view', () => {
  const region: Region = {
    page: { materialId: 'm', page: 2, width: 100, height: 140, imageUrl: '/p2.png' } as Region['page'],
    box: null,
  };
  const props = {
    materialName: 'N.pdf', pinned: false, sourceRemoved: false,
    onTogglePin() {}, onFullPage() {}, onPointerEnter() {}, onPointerLeave() {},
  };

  it('says so when the source was removed, with no Full page button', () => {
    render(<Peek region={region} {...props} sourceRemoved />);
    expect(screen.getByText('The original file was removed. Your clean version keeps working.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Full page/ })).toBeNull();
  });

  it('offers Try again on a load error, and resets retries on a new page', () => {
    const { rerender } = render(<Peek region={region} {...props} />);
    fireEvent.error(screen.getByRole('img'));
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(screen.getByRole('img').getAttribute('src')).toBe('/p2.png?retry=1');
    const next = { ...region, page: { ...region.page, page: 3, imageUrl: '/p3.png' } };
    rerender(<Peek region={next} {...props} />);
    expect(screen.getAllByRole('img').map((i) => i.getAttribute('src'))).toContain('/p3.png');
  });
});
