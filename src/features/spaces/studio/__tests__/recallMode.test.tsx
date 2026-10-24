import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CleanBlock } from '../components/CleanBlock';
import type { SummaryBlock } from '../types';
import StudioCanvasScreen from '../../screens/StudioCanvasScreen';
import * as shelf from '../../mocks/shelf';
import { STUDIO_CANVAS } from '../../mocks/studio-canvas';
import { pageProgress } from '../recall';

const KEY = 'studio:recall:m-norm';
const TOTAL = pageProgress(STUDIO_CANVAS.blocks, { on: true, terms: {} }).total;

beforeEach(() => {
  vi.useFakeTimers();
  shelf.__reset();
  shelf.saveCanvas('m-norm', STUDIO_CANVAS);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

const tree = () => (
  <MemoryRouter initialEntries={['/v4/library/m/m-norm']}>
    <Routes>
      <Route path="/v4/library/m/:materialId" element={<StudioCanvasScreen />} />
    </Routes>
  </MemoryRouter>
);
const mount = async () => {
  const utils = render(tree());
  await act(async () => { vi.advanceTimersByTime(700); });
  return utils;
};
const tick = async (ms = 50) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
const toggle = () => screen.getByRole('button', { name: 'Recall' });
const block = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-view="clean"] [data-block-id="${id}"]`)!;
const reveals = () => screen.queryAllByRole('button', { name: /^Reveal term/ });
const pressR = async (target: Element | Window = window) => {
  fireEvent.keyDown(target, { key: 'r' });
  await tick();
};
const item = () => shelf.getItems().find((i) => i.id === 'm-norm')!;

describe('Recall mode on the page', () => {
  it('a Recall toggle and R turn summary terms into blanks', async () => {
    const { container } = await mount();
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(reveals()).toHaveLength(0);
    await pressR();
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(within(block(container, 's-p6-1')).getByRole('button', { name: 'Reveal term, page 6' })).toBeInTheDocument();
    expect(reveals()).toHaveLength(TOTAL);
    fireEvent.click(toggle());
    await tick();
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(reveals()).toHaveLength(0);
  });

  it('Knew it fills the page ring and feeds the shelf', async () => {
    const { container } = await mount();
    fireEvent.click(toggle());
    await tick();
    expect(screen.getByRole('img', { name: 'Recall, page 6: 0 of 1 known' })).toBeInTheDocument();
    fireEvent.click(within(block(container, 's-p6-1')).getByRole('button', { name: 'Reveal term, page 6' }));
    await tick();
    fireEvent.click(within(block(container, 's-p6-1')).getByRole('button', { name: 'Knew it' }));
    await tick();
    expect(screen.getByRole('img', { name: 'Recall, page 6: 1 of 1 known' })).toBeInTheDocument();
    expect(item().progress).toMatchObject({ recallKnew: 1, recallTotal: TOTAL });
    // Start over clears every mark, and focus comes back to the toggle.
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    await tick();
    expect(screen.getByRole('img', { name: 'Recall, page 6: 0 of 1 known' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull();
    expect(toggle()).toHaveFocus();
    expect(item().progress).toMatchObject({ recallKnew: 0, recallTotal: TOTAL });
  });

  it('Not yet counts toward the try-again line; Try again re-blanks and focuses', async () => {
    const { container } = await mount();
    fireEvent.click(toggle());
    await tick();
    const notYet = async (id: string) => {
      fireEvent.click(within(block(container, id)).getAllByRole('button', { name: /^Reveal term/ })[0]);
      await tick();
      fireEvent.click(within(block(container, id)).getByRole('button', { name: 'Not yet' }));
      await tick();
    };
    await notYet('s-p6-1');
    expect(screen.getByText('1 term to try again')).toBeInTheDocument();
    await notYet('s-p1-1');
    expect(screen.getByText('2 terms to try again')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await tick();
    const first = within(block(container, 's-p1-1')).getByRole('button', { name: 'Reveal term, page 1' });
    expect(first).toHaveFocus();
    expect(within(block(container, 's-p6-1')).getByRole('button', { name: 'Reveal term, page 6' })).toBeInTheDocument();
    expect(screen.queryByText(/to try again/)).toBeNull();
  });

  it('never blanks your notes or answers', async () => {
    shelf.saveCanvas('m-norm', {
      ...STUDIO_CANVAS,
      blocks: STUDIO_CANVAS.blocks.map((b) => (b.id === 'w-1' ? { ...b, markdown: 'My **note** on the roadmap.' } : b)),
    });
    const { container } = await mount();
    const q = 'What is a functional dependency?';
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask about this Material' }), { target: { value: q } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Ask about this Material' }).closest('form')!);
    await tick(700);
    await tick(3000);
    fireEvent.click(toggle());
    await tick();
    expect(within(block(container, 'w-1')).queryAllByRole('button', { name: /^Reveal term/ })).toHaveLength(0);
    const answer = container.querySelector<HTMLElement>('[data-view="clean"] [data-woven]')!;
    expect(answer).not.toBeNull();
    expect(within(answer).queryAllByRole('button', { name: /^Reveal term/ })).toHaveLength(0);
  });

  it('is off-limits while Source is shown', async () => {
    await mount();
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyUp(window, { key: 's' });
    await tick(1000);
    expect(toggle()).toBeDisabled();
    await pressR();
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
  });

  it('the hint names R while it shows', async () => {
    shelf.markRead('m-norm', 1); // a first visit: the hint, not "Back on page 6"
    await mount();
    expect(screen.getByText('Rest on a paragraph to see the source, press S, or ask below · R to recall')).toBeInTheDocument();
  });

  it('ignores R while you type in the composer', async () => {
    await mount();
    await pressR(screen.getByRole('textbox', { name: 'Ask about this Material' }));
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    // An open menu (Share) owns its keys too.
    const menu = document.body.appendChild(document.createElement('div'));
    menu.setAttribute('role', 'menu');
    await pressR();
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    menu.remove();
  });

  it('keeps Recall and its marks per page across a reload', async () => {
    const first = await mount();
    fireEvent.click(toggle());
    await tick();
    fireEvent.click(within(block(first.container, 's-p6-1')).getByRole('button', { name: 'Reveal term, page 6' }));
    await tick();
    fireEvent.click(within(block(first.container, 's-p6-1')).getByRole('button', { name: 'Knew it' }));
    await tick();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ on: true, terms: { 's-p6-1:0': 'knew' } });
    first.unmount();
    const again = await mount();
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(within(block(again.container, 's-p6-1')).getByText('functional dependency')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Recall, page 6: 1 of 1 known' })).toBeInTheDocument();
  });

  it('still works when storage throws', async () => {
    const blocked = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(blocked as unknown as Storage);
    await mount();
    await pressR();
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(reveals().length).toBeGreaterThan(0);
  });

  it('still works when storage cannot be written', async () => {
    const writes: string[] = [];
    const full = {
      getItem: () => null,
      setItem: (k: string) => { writes.push(k); throw new Error('full'); },
    };
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(full as unknown as Storage);
    const { container } = await mount();
    fireEvent.click(toggle());
    await tick();
    fireEvent.click(within(block(container, 's-p6-1')).getByRole('button', { name: 'Reveal term, page 6' }));
    await tick();
    fireEvent.click(within(block(container, 's-p6-1')).getByRole('button', { name: 'Knew it' }));
    await tick();
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: 'Recall, page 6: 1 of 1 known' })).toBeInTheDocument();
    expect(writes).toContain(KEY); // it tried, and carried on
  });

  it('Space on a blank reveals it and does not open Peek', async () => {
    const { container } = await mount();
    fireEvent.click(toggle());
    await tick();
    // What a browser does with Space on a focused button: keydown (not prevented), then the press.
    const space = async (el: HTMLElement) => {
      el.focus();
      expect(fireEvent.keyDown(el, { key: ' ' })).toBe(true);
      fireEvent.keyUp(el, { key: ' ' });
      fireEvent.click(el);
      await tick(500);
    };
    await space(within(block(container, 's-p6-1')).getByRole('button', { name: 'Reveal term, page 6' }));
    expect(screen.queryByRole('complementary', { name: 'Source page' })).toBeNull();
    await space(within(block(container, 's-p6-1')).getByRole('button', { name: 'Knew it' }));
    expect(screen.getByRole('img', { name: 'Recall, page 6: 1 of 1 known' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Source page' })).toBeNull();
  });

  it('resting on a summary paragraph does not start Peek while Recall is on', async () => {
    const { container } = await mount();
    fireEvent.click(toggle());
    await tick();
    fireEvent.pointerEnter(block(container, 's-p6-1'), { pointerType: 'mouse' });
    await tick(2000);
    expect(screen.queryByRole('complementary', { name: 'Source page' })).toBeNull();
    // The marker still opens it.
    fireEvent.click(within(block(container, 's-p6-1')).getByRole('button', { name: 'Show the source, page 6' }));
    await tick(500);
    expect(screen.getByRole('complementary', { name: 'Source page' })).toBeInTheDocument();
  });
});

describe('a paragraph keeps its keys to itself', () => {
  const summary: SummaryBlock = {
    id: 's', origin: 'summary', markdown: 'A **functional dependency** holds.', gist: false, edited: false,
    source: { materialId: 'm', page: 6, blockIds: ['b'] },
  };
  const setup = () => {
    const props = {
      page: 6, index: 0, count: 1, morph: false, flying: false, lowConfidence: false, active: false, flash: false,
      markerDisabled: false, onPointerEnter: vi.fn(), onPointerLeave: vi.fn(), onOpenPeek: vi.fn(), onClosePeek: vi.fn(),
    };
    const recall = { get: () => 'blank' as const, onReveal: vi.fn(), onMark: vi.fn() };
    const utils = render(<CleanBlock {...props} block={summary} recall={recall} />);
    return { ...utils, props };
  };

  it('Space and Esc on a blank are the blank\'s, not the paragraph\'s', () => {
    const { props } = setup();
    const blank = screen.getByRole('button', { name: 'Reveal term, page 6' });
    // Not prevented: the browser goes on to press the button.
    expect(fireEvent.keyDown(blank, { key: ' ' })).toBe(true);
    fireEvent.keyDown(blank, { key: 'Escape' });
    expect(props.onOpenPeek).not.toHaveBeenCalled();
    expect(props.onClosePeek).not.toHaveBeenCalled();
  });

  it('Space and Esc on the paragraph itself still open and close Peek', () => {
    const { props, container } = setup();
    const para = container.querySelector<HTMLElement>('[data-block-id="s"]')!;
    fireEvent.keyDown(para, { key: ' ' });
    fireEvent.keyDown(para, { key: 'Escape' });
    expect(props.onOpenPeek).toHaveBeenCalledWith('s');
    expect(props.onClosePeek).toHaveBeenCalled();
  });
});
