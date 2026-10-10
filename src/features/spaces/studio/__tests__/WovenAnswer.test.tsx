import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WovenAnswer, wordDelays } from '../components/WovenAnswer';
import { WORD_BUDGET_S, WORD_LIMIT, WORD_STAGGER_S } from '../motion';
import type { GeneratedBlock } from '../types';

const block: GeneratedBlock = {
  id: 'a1', origin: 'generated', askedAs: 'Why?', anchorId: 's1',
  markdown: 'Stored **once**, never twice.',
  citations: [{ label: 'p. 5', materialId: 'm', page: 5, blockId: 'p5-b10' }],
};

beforeEach(() => vi.useFakeTimers());
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
});
