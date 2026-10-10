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
const ask = async (q: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask about this Material' }), { target: { value: q } });
  fireEvent.submit(screen.getByRole('textbox', { name: 'Ask about this Material' }).closest('form')!);
  await act(async () => { vi.advanceTimersByTime(700); });
};
const order = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-view="clean"] [data-block-id]')).map((e) => e.getAttribute('data-block-id'));

describe('asking on the canvas', () => {
  it('weaves the answer under the paragraph it is about and announces it', async () => {
    const { container } = await mount();
    await ask('Why does repeated data cause problems?');
    const ids = order(container);
    const at = ids.indexOf('s-p5-2');
    expect(ids[at + 1]).toMatch(/^ans-/);
    // The Composer has its own status region for notices; the screen's is named.
    expect(screen.getByRole('status', { name: 'Canvas updates' })).toHaveTextContent(/Answer added under: The tools are functional/);
  });

  it('disables the composer while answering', async () => {
    await mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask about this Material' }), { target: { value: 'What is a functional dependency?' } });
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    expect(screen.getByRole('textbox', { name: 'Ask about this Material' })).toBeDisabled();
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(screen.getByRole('textbox', { name: 'Ask about this Material' })).not.toBeDisabled();
  });

  it('is honest about questions it cannot answer, and adds nothing', async () => {
    const { container } = await mount();
    const before = order(container).length;
    await ask('Tell me a joke');
    expect(screen.getByText(/In this preview I can answer a few questions/)).toBeInTheDocument();
    expect(order(container).length).toBe(before);
  });

  it('Remove and Undo put the answer back in the same place', async () => {
    const { container } = await mount();
    await ask('What is a functional dependency?');
    await act(async () => { vi.advanceTimersByTime(3000); });
    const withAnswer = order(container);
    fireEvent.click(screen.getByRole('button', { name: 'Remove this answer' }));
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(order(container).some((id) => id?.startsWith('ans-'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await act(async () => { vi.advanceTimersByTime(50); });
    expect(order(container)).toEqual(withAnswer);
  });

  it('answers fade, not fly, in Source view, and come back settled', async () => {
    const { container } = await mount();
    await ask('What is a functional dependency?');
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(container.querySelector('[data-woven="true"]')).not.toBeNull();
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyUp(window, { key: 's' });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(container.querySelectorAll('[data-view="original"]').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-view="original"] [data-woven]')).toBeNull();
    expect(container.querySelector('[data-woven][data-morph]')).toBeNull();
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyUp(window, { key: 's' });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(order(container).some((id) => id?.startsWith('ans-'))).toBe(true);
    expect(container.querySelector('[data-woven-words]')).toBeNull();
  });

  it('an answer arriving after a flight leaves no paragraph carrying layoutIds', async () => {
    const { container } = await mount();
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyUp(window, { key: 's' });
    await act(async () => { vi.advanceTimersByTime(1000); });
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyUp(window, { key: 's' });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(container.querySelectorAll('[data-view="clean"] [data-morph]').length).toBeGreaterThan(0);
    await ask('What is a functional dependency?');
    expect(container.querySelectorAll('[data-view="clean"] [data-morph]')).toHaveLength(0);
  });

  it('an answer that lands while Source is shown is simply there on return', async () => {
    const { container } = await mount();
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyUp(window, { key: 's' });
    await act(async () => { vi.advanceTimersByTime(1000); });
    await ask('What is a functional dependency?');
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyUp(window, { key: 's' });
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(order(container).some((id) => id?.startsWith('ans-'))).toBe(true);
    expect(container.querySelector('[data-woven-words]')).toBeNull();
    expect(container.querySelector('[data-glow]')).toBeNull();
  });

  it('switching to Source mid-grow does not replay the growth on return', async () => {
    const { container } = await mount();
    await ask('What is a functional dependency?');
    expect(container.querySelector('[data-woven-words]')).not.toBeNull();
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyUp(window, { key: 's' });
    await act(async () => { vi.advanceTimersByTime(1000); });
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyUp(window, { key: 's' });
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(order(container).some((id) => id?.startsWith('ans-'))).toBe(true);
    expect(container.querySelector('[data-woven-words]')).toBeNull();
    expect(container.querySelector('[data-glow]')).toBeNull();
  });

  it('says "Added below" for an answer that grows off-screen, and Jump takes you there', async () => {
    const rect = Element.prototype.getBoundingClientRect;
    const rects = Element.prototype.getClientRects;
    const into = Element.prototype.scrollIntoView;
    const scrolled: Element[] = [];
    // The fresh answer is 0 px tall (it is about to grow) and far below the fold.
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (!this.matches('[data-woven]')) return rect.call(this);
      return { top: 5000, bottom: 5000, left: 0, right: 0, width: 600, height: 0, x: 0, y: 5000, toJSON() {} } as DOMRect;
    };
    Element.prototype.getClientRects = function (this: Element) {
      return (this.matches('[data-woven]') ? [{}] : rects.call(this)) as unknown as DOMRectList;
    };
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      const { container } = await mount();
      await ask('What does pseudotransitivity give me?');
      fireEvent.click(screen.getByRole('button', { name: 'Added below ↓' }));
      expect(scrolled).toContain(container.querySelector('[data-woven]'));
      await act(async () => { vi.advanceTimersByTime(500); });
      expect(screen.queryByRole('button', { name: 'Added below ↓' })).toBeNull();
    } finally {
      Element.prototype.getBoundingClientRect = rect;
      Element.prototype.getClientRects = rects;
      Element.prototype.scrollIntoView = into;
    }
  });

  it('an answer removed before it settles takes its glow with it', async () => {
    const { container } = await mount();
    await ask('What is a functional dependency?');
    expect(container.querySelector('[data-block-id="s-p6-1"]')).toHaveAttribute('data-glow', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Remove this answer' }));
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(order(container).some((id) => id?.startsWith('ans-'))).toBe(false);
    expect(container.querySelector('[data-glow]')).toBeNull();
  });

  it('a citation opens Peek on the paragraph that covers its source', async () => {
    await mount();
    await ask('Why does repeated data cause problems?');
    fireEvent.click(screen.getByRole('button', { name: 'p. 5 — Goal: Avoid redundancies' }));
    expect(screen.getByRole('complementary', { name: 'Source page' })).toHaveTextContent('page 5');
  });
});
