import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StudioCanvasScreen from '../../screens/StudioCanvasScreen';
import * as shelf from '../../mocks/shelf';
import { STUDIO_CANVAS } from '../../mocks/studio-canvas';

beforeEach(() => {
  vi.useFakeTimers();
  shelf.__reset();
  shelf.saveCanvas('m-norm', STUDIO_CANVAS);
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

const mount = async () => {
  const utils = render(
    <MemoryRouter initialEntries={['/v4/library/m/m-norm']}>
      <Routes>
        <Route path="/v4/library/m/:materialId" element={<StudioCanvasScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => { vi.advanceTimersByTime(700); });
  return utils;
};
const run = (ms = 600) => act(async () => { vi.advanceTimersByTime(ms); });
const section = (c: HTMLElement, page: number) =>
  c.querySelector<HTMLElement>(`[data-view="clean"][data-page-anchor="${page}"]`)!;
/** What the page shows: a paragraph fading out (jsdom never finishes the fade) is already gone. */
const ids = (c: HTMLElement, page: number) =>
  Array.from(section(c, page).querySelectorAll('[data-block-id]'))
    .filter((e) => !e.closest('[data-leaving]'))
    .map((e) => e.getAttribute('data-block-id'));
const dial = (page: number) => screen.getByRole('radiogroup', { name: `Depth for page ${page}` });
const choose = async (page: number, label: string, shiftKey = false) => {
  fireEvent.click(within(dial(page)).getByRole('radio', { name: label }), { shiftKey });
  await run();
};
const checked = (page: number) =>
  within(dial(page)).getAllByRole('radio').find((r) => r.getAttribute('aria-checked') === 'true')?.getAttribute('aria-label');

describe('the Depth dial on the canvas', () => {
  it('Gist on page 2 keeps the gist and your own blocks, and no other page changes', async () => {
    const { container } = await mount();
    const page6 = ids(container, 6);
    await choose(2, 'Gist');
    expect(ids(container, 2)).toEqual(['s-p2-1', 'w-1', 'c-p2-hw']);
    expect(ids(container, 6)).toEqual(page6);
    expect(checked(2)).toBe('Gist');
    expect(checked(6)).toBe('Summary');
  });

  it('Full on page 6 opens the summary into the text it covers', async () => {
    const { container } = await mount();
    await choose(6, 'Full');
    const shown = ids(container, 6);
    expect(shown).toContain('full-p6-b6');
    expect(shown).not.toContain('s-p6-1');
    expect(shown.indexOf('full-p6-b1')).toBeLessThan(shown.indexOf('full-p6-b6'));
  });

  it('Page on page 5 shows the page itself in Learn, and page 4 stays a summary', async () => {
    const { container } = await mount();
    await choose(5, 'Page');
    const main = container.querySelector('main')!;
    const inner = main.querySelector('[data-view="clean"] [data-view="original"][data-page-anchor="5"]');
    expect(inner).not.toBeNull();
    expect(within(inner as HTMLElement).getByRole('img', { name: 'Page 5 of Normalization.pdf' })).toBeInTheDocument();
    expect(ids(container, 4)).toContain('s-p4-1');
    expect(screen.getByRole('switch', { name: 'Show source' })).toHaveAttribute('aria-checked', 'false');
  });

  it('Shift sets every page at once', async () => {
    const { container } = await mount();
    await choose(2, 'Gist', true);
    expect(checked(2)).toBe('Gist');
    expect(checked(6)).toBe('Gist');
    expect(ids(container, 6)).not.toContain('s-p6-2');
    await choose(6, 'Summary', true);
    expect(checked(2)).toBe('Summary');
    expect(ids(container, 6)).toContain('s-p6-2');
  });

  it('] goes deeper on the current page and [ shallower, but not while typing', async () => {
    await mount();
    const first = Number(/\d+/.exec(screen.getAllByRole('radiogroup')[0].getAttribute('aria-label')!)![0]);
    expect(checked(first)).toBe('Summary');
    fireEvent.keyDown(window, { key: ']' });
    await run();
    expect(checked(first)).toBe('Full');
    fireEvent.keyDown(window, { key: ']', repeat: true });
    await run();
    expect(checked(first)).toBe('Full');
    fireEvent.keyDown(window, { key: '[' });
    await run();
    expect(checked(first)).toBe('Summary');
    fireEvent.keyDown(window, { key: '[', metaKey: true });
    await run();
    expect(checked(first)).toBe('Summary');
    const box = screen.getByRole('textbox', { name: 'Ask about this Material' });
    box.focus();
    fireEvent.keyDown(box, { key: '[' });
    await run();
    expect(checked(first)).toBe('Summary');
  });

  it('Source and back keeps each page at its depth', async () => {
    const { container } = await mount();
    await choose(2, 'Gist');
    await choose(6, 'Full');
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyUp(window, { key: 's' });
    await run(800);
    // Source overrides the dial while it is shown.
    expect(screen.getByRole('switch', { name: 'Show source' })).toHaveAttribute('aria-checked', 'true');
    expect(container.querySelector('[data-view="original"][data-page-anchor="6"] img')).not.toBeNull();
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyUp(window, { key: 's' });
    await run(800);
    expect(checked(2)).toBe('Gist');
    expect(checked(6)).toBe('Full');
    expect(ids(container, 2)).toEqual(['s-p2-1', 'w-1', 'c-p2-hw']);
    expect(ids(container, 6)).toContain('full-p6-b6');
  });

  it('an answer asked while page 6 is at Gist is there, after the gist', async () => {
    const { container } = await mount();
    await choose(6, 'Gist');
    const box = screen.getByRole('textbox', { name: 'Ask about this Material' });
    fireEvent.change(box, { target: { value: 'What is a functional dependency?' } });
    fireEvent.submit(box.closest('form')!);
    await run(700);
    const shown = ids(container, 6);
    expect(shown[0]).toBe('s-p6-1');
    expect(shown[1]).toMatch(/^ans-/);
    expect(shown).not.toContain('s-p6-2');
  });

  it('at Page your own blocks still follow the page: notes, handwriting and answers', async () => {
    const { container } = await mount();
    const box = screen.getByRole('textbox', { name: 'Ask about this Material' });
    fireEvent.change(box, { target: { value: 'What is a functional dependency?' } });
    fireEvent.submit(box.closest('form')!);
    await run(700);
    await choose(6, 'Page');
    expect(ids(container, 6)).toEqual([expect.stringMatching(/^ans-/)]);
    await choose(2, 'Page');
    expect(ids(container, 2)).toEqual(['w-1', 'c-p2-hw']);
  });

  it('Recall rings count only what is rendered: none at Full', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Recall' }));
    await run(50);
    expect(screen.getByRole('img', { name: /^Recall, page 6:/ })).toBeInTheDocument();
    await choose(6, 'Full');
    expect(screen.queryByRole('img', { name: /^Recall, page 6:/ })).toBeNull();
  });
});
