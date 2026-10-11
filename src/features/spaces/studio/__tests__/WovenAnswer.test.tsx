import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WovenAnswer, wordDelays } from '../components/WovenAnswer';
import { BLOCK_S, BLOCK_STAGGER_S, GROW_S, WORD_BUDGET_S, WORD_LIMIT, WORD_STAGGER_S } from '../motion';
import type { GeneratedBlock } from '../types';

const block: GeneratedBlock = {
  id: 'a1', origin: 'generated', askedAs: 'Why?', anchorId: 's1',
  markdown: 'Stored **once**, never twice.',
  citations: [{ label: 'p. 5', materialId: 'm', page: 5, blockId: 'p5-b10' }],
};

let reducedMotion = false;
vi.mock('motion/react', async (orig) => ({
  ...(await orig<typeof import('motion/react')>()),
  useReducedMotion: () => reducedMotion,
}));

beforeEach(() => {
  reducedMotion = false;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('wordDelays', () => {
  it('staggers short answers word by word', () => {
    expect(wordDelays(3)).toEqual([0, WORD_STAGGER_S, 2 * WORD_STAGGER_S]);
  });
  it('never takes longer than the budget, however long the answer', () => {
    const d = wordDelays(400);
    expect(Math.max(...d)).toBeLessThanOrEqual(WORD_BUDGET_S + 1e-9);
    // after WORD_LIMIT words the rest settle in groups, not one by one
    expect(new Set(d.slice(WORD_LIMIT)).size).toBeLessThan(400 - WORD_LIMIT);
  });
});

describe('wordDelays edge', () => {
  it('stays finite and in budget just past the word limit', () => {
    const d = wordDelays(WORD_LIMIT + 1);
    expect(d.every(Number.isFinite)).toBe(true);
    expect(Math.max(...d)).toBeLessThanOrEqual(WORD_BUDGET_S + 1e-9);
  });
});

describe('WovenAnswer', () => {
  it('shows the tag, the question, the answer and its citations', () => {
    render(<WovenAnswer block={block} fresh={false} onSettled={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText('From your question')).toBeInTheDocument();
    expect(screen.getByText('Why?')).toBeInTheDocument();
    expect(screen.getByText('once').closest('[data-streamdown="strong"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /p\. 5/ })).toBeInTheDocument();
    expect(document.querySelector('[data-block-id="a1"][data-extracted="false"]')).not.toBeNull();
  });
  it('settles at once when it is not fresh', () => {
    const onSettled = vi.fn();
    render(<WovenAnswer block={block} fresh={false} onSettled={onSettled} onRemove={vi.fn()} />);
    expect(onSettled).toHaveBeenCalledWith('a1');
  });
  it('while growing, words are hidden from screen readers and the full text is there once', () => {
    render(<WovenAnswer block={block} fresh onSettled={vi.fn()} onRemove={vi.fn()} />);
    expect(document.querySelector('[data-woven-words][aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText('Stored once, never twice.', { selector: '.sr-only' })).toBeInTheDocument();
  });
  it('Remove asks the screen to remove it once the collapse is done', async () => {
    const onRemove = vi.fn();
    render(<WovenAnswer block={block} fresh={false} onSettled={vi.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove this answer' }));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(onRemove).toHaveBeenCalledWith('a1');
  });
  it('a fresh answer settles after its timer, not at mount', async () => {
    const onSettled = vi.fn();
    render(<WovenAnswer block={block} fresh onSettled={onSettled} onRemove={vi.fn()} />);
    expect(onSettled).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith('a1');
  });
  it('with reduced motion a fresh answer is simply there', () => {
    reducedMotion = true;
    const onSettled = vi.fn();
    render(<WovenAnswer block={block} fresh onSettled={onSettled} onRemove={vi.fn()} />);
    expect(onSettled).toHaveBeenCalledWith('a1');
    expect(document.querySelector('[data-woven-words]')).toBeNull();
  });
  it('a re-render with a new onRemove mid-collapse does not restart the timer', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const { rerender } = render(<WovenAnswer block={block} fresh={false} onSettled={vi.fn()} onRemove={a} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove this answer' }));
    await act(async () => { vi.advanceTimersByTime(200); });
    rerender(<WovenAnswer block={block} fresh={false} onSettled={vi.fn()} onRemove={b} />);
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });
  it('a citation without a source block is not a button', () => {
    const b: GeneratedBlock = { ...block, citations: [{ label: 'p. 9', materialId: 'm', page: 9 }] };
    render(<WovenAnswer block={b} fresh={false} onSettled={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText('p. 9').tagName).toBe('SPAN');
    expect(screen.queryByRole('button', { name: /p\. 9/ })).toBeNull();
  });

  it('fades back in after the flight when it returns on the page that flies', () => {
    const { container, unmount } = render(<WovenAnswer block={block} fresh={false} flying onSettled={vi.fn()} onRemove={vi.fn()} />);
    expect((container.firstElementChild as HTMLElement).style.opacity).toBe('0');
    unmount();
    const other = render(<WovenAnswer block={block} fresh={false} onSettled={vi.fn()} onRemove={vi.fn()} />);
    expect((other.container.firstElementChild as HTMLElement).style.opacity).not.toBe('0');
  });

  it('clips only while its height moves, so the Remove focus ring shows once settled', () => {
    const { container } = render(<WovenAnswer block={block} fresh={false} onSettled={vi.fn()} onRemove={vi.fn()} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).not.toHaveClass('overflow-hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Remove this answer' }));
    expect(root).toHaveClass('overflow-hidden');
  });
});

describe('WovenAnswer, shaped', () => {
  const shaped: GeneratedBlock = {
    ...block,
    format: 'A table to try',
    markdown: 'Plain words.',
    blocks: [
      { type: 'text', md: 'Plain words.' },
      { type: 'compare', columns: [{ title: 'One', points: ['a'] }, { title: 'Two', points: ['b'] }] },
      { type: 'check', question: 'Which?', options: [{ text: 'A', correct: true, why: 'Because.' }, { text: 'B', why: 'No.' }] },
    ],
  };
  const delays = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('[data-block-delay]')).map((e) => Number(e.getAttribute('data-block-delay')));

  it('renders its cards, named, and its format label', () => {
    render(<WovenAnswer block={shaped} fresh={false} onSettled={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'One · Two' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Which?' })).toBeInTheDocument();
    expect(screen.getByText(/A table to try/)).toBeInTheDocument();
  });
  it('carries increasing animation delays when fresh, none when not', () => {
    const { container, unmount } = render(<WovenAnswer block={shaped} fresh onSettled={vi.fn()} onRemove={vi.fn()} />);
    const d = delays(container);
    expect(d).toHaveLength(3);
    expect(d[1]).toBeGreaterThan(d[0]);
    expect(d[2]).toBeGreaterThan(d[1]);
    unmount();
    const again = render(<WovenAnswer block={shaped} fresh={false} onSettled={vi.fn()} onRemove={vi.fn()} />);
    expect(delays(again.container)).toEqual([]);
  });
  it('settles after the last block has arrived', async () => {
    const onSettled = vi.fn();
    render(<WovenAnswer block={shaped} fresh onSettled={onSettled} onRemove={vi.fn()} />);
    const total = (GROW_S * 0.2 + 2 * BLOCK_STAGGER_S + BLOCK_S) * 1000;
    await act(async () => { vi.advanceTimersByTime(total - 50); });
    expect(onSettled).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
  it('does not add a second, hidden reading of a settled answer', () => {
    render(<WovenAnswer block={shaped} fresh={false} onSettled={vi.fn()} onRemove={vi.fn()} />);
    expect(document.querySelector('.sr-only')).toBeNull();
  });
});

