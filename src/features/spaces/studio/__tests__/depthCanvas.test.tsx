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
    // Marked inline, so nothing that looks for Source's own section of page 5 finds this one.
    expect(inner).toHaveAttribute('data-inline', 'true');
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

  it('[ and ] work on keyboards that type them with Alt or AltGr, never with Cmd or Ctrl alone', async () => {
    await mount();
    const first = Number(/\d+/.exec(screen.getAllByRole('radiogroup')[0].getAttribute('aria-label')!)![0]);
    fireEvent.keyDown(window, { key: ']', altKey: true }); // a German Mac: Option+6
    await run();
    expect(checked(first)).toBe('Full');
    fireEvent.keyDown(window, { key: '[', ctrlKey: true, altKey: true }); // AltGr on Windows
    await run();
    expect(checked(first)).toBe('Summary');
    fireEvent.keyDown(window, { key: ']', ctrlKey: true });
    await run();
    expect(checked(first)).toBe('Summary');
    fireEvent.keyDown(window, { key: ']', metaKey: true, altKey: true });
    await run();
    expect(checked(first)).toBe('Summary');
  });

  it('[ and ] act on the page that holds focus', async () => {
    const { container } = await mount();
    const first = Number(/\d+/.exec(screen.getAllByRole('radiogroup')[0].getAttribute('aria-label')!)![0]);
    expect(first).not.toBe(6);
    const para = container.querySelector<HTMLElement>('[data-view="clean"] [data-block-id="s-p6-1"]')!;
    para.focus();
    fireEvent.keyDown(para, { key: ']' });
    await run();
    expect(checked(6)).toBe('Full');
    expect(checked(first)).toBe('Summary');
  });

  it('Source and back keep your place at once, never with a glide', async () => {
    await mount();
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    try {
      fireEvent.keyDown(window, { key: 's' });
      fireEvent.keyUp(window, { key: 's' });
      await run(800);
      expect(scrollBy).toHaveBeenCalled();
      for (const call of scrollBy.mock.calls) expect(call[0]).toMatchObject({ behavior: 'instant' });
    } finally {
      scrollBy.mockRestore();
    }
  });

  it('back to a paragraph from Source opens its page back to Summary when it is not shown', async () => {
    const { container } = await mount();
    await choose(6, 'Full');
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyUp(window, { key: 's' });
    await run(800);
    const source = container.querySelector<HTMLElement>('[data-view="original"][data-page-anchor="6"]')!;
    fireEvent.click(within(source).getByRole('button', { name: /^Back to: A functional dependency/ }));
    await run(1500);
    expect(checked(6)).toBe('Summary');
    expect(ids(container, 6)).toContain('s-p6-1');
  });

  it('back to a paragraph from the page shown inline opens it back to Summary', async () => {
    const { container } = await mount();
    await choose(6, 'Page');
    const inner = section(container, 6).querySelector<HTMLElement>('[data-inline="true"]')!;
    fireEvent.click(within(inner).getByRole('button', { name: /^Back to: A functional dependency/ }));
    await run(1500);
    expect(checked(6)).toBe('Summary');
    expect(ids(container, 6)).toContain('s-p6-1');
  });

  it('a question asked from text selected in the full text lands under the summary that covers it', async () => {
    const { container } = await mount();
    await choose(6, 'Full');
    const para = container.querySelector('[data-view="clean"] [data-block-id="full-p6-b6"]')!;
    const text = document.createTreeWalker(para, NodeFilter.SHOW_TEXT).nextNode()!;
    const sel = vi.spyOn(window, 'getSelection');
    sel.mockReturnValue({ isCollapsed: false, anchorNode: text } as unknown as Selection);
    document.dispatchEvent(new Event('selectionchange'));
    sel.mockRestore();
    const box = screen.getByRole('textbox', { name: 'Ask about this Material' });
    fireEvent.change(box, { target: { value: 'Why does repeated data cause problems?' } });
    fireEvent.submit(box.closest('form')!);
    await run(700);
    const answer = shelf.canvasFor('m-norm')!.blocks.find((b) => b.origin === 'generated');
    expect(answer).toMatchObject({ anchorId: 's-p6-1' });
    expect(ids(container, 6).some((id) => id?.startsWith('ans-'))).toBe(true);
  });

  it('Try again opens a page back to Summary when its term is not shown, and lands on it', async () => {
    const { container } = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Recall' }));
    await run(50);
    const p6 = () => container.querySelector<HTMLElement>('[data-view="clean"] [data-block-id="s-p6-1"]')!;
    fireEvent.click(within(p6()).getByRole('button', { name: 'Reveal term, page 6' }));
    await run(50);
    fireEvent.click(within(p6()).getByRole('button', { name: 'Not yet' }));
    await run(50);
    await choose(6, 'Full');
    // The Material still has a term to try again, though page 6 now reads in full.
    expect(screen.getByText('1 term to try again')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await run();
    expect(checked(6)).toBe('Summary');
    expect(within(p6()).getByRole('button', { name: 'Reveal term, page 6' })).toHaveFocus();
  });
});
