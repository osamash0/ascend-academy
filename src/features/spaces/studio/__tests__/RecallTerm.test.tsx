import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { RecallTerm } from '../components/RecallTerm';
import { ProgressRing } from '../components/ProgressRing';
import { Markdown } from '../components/Markdown';

let reducedMotion = false;
vi.mock('motion/react', async () => ({
  ...(await vi.importActual<typeof import('motion/react')>('motion/react')),
  useReducedMotion: () => reducedMotion,
}));
afterEach(() => {
  vi.useRealTimers();
  reducedMotion = false;
});

const setup = (state: 'blank' | 'seen' | 'knew' | 'notYet' = 'blank') => {
  const onReveal = vi.fn();
  const onMark = vi.fn();
  render(<RecallTerm text="BCNF" state={state} page={6} onReveal={onReveal} onMark={onMark} />);
  return { onReveal, onMark };
};

describe('RecallTerm', () => {
  it('blank hides the text but keeps its width', () => {
    setup();
    const b = screen.getByRole('button', { name: 'Reveal term, page 6' });
    expect(b.className).toContain('text-transparent');
    expect(b).toHaveTextContent('BCNF');
  });
  it('click reveals', () => {
    const { onReveal } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Reveal term, page 6' }));
    expect(onReveal).toHaveBeenCalledOnce();
  });
  it('seen shows both marks that call onMark, and they fade after 4s', () => {
    vi.useFakeTimers();
    const { onMark } = setup('seen');
    fireEvent.click(screen.getByRole('button', { name: 'Knew it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not yet' }));
    expect(onMark.mock.calls).toEqual([['knew'], ['notYet']]);
    act(() => void vi.advanceTimersByTime(4100));
    expect(screen.queryByRole('button', { name: 'Knew it' })).toBeNull();
  });
  it('reduced motion means no blur', () => {
    reducedMotion = true;
    const { container } = render(<RecallTerm text="x" state="seen" page={1} onReveal={() => {}} onMark={() => {}} />);
    expect(container.innerHTML).not.toContain('blur(');
  });
});

describe('ProgressRing', () => {
  it('labels and flags completion', () => {
    const { rerender } = render(<ProgressRing knew={3} total={5} label="Recall, page 6: 3 of 5 known" />);
    const img = screen.getByRole('img', { name: 'Recall, page 6: 3 of 5 known' });
    expect(img.closest('[data-complete]')).toBeNull();
    rerender(<ProgressRing knew={5} total={5} label="done" />);
    expect(document.querySelector('[data-complete="true"]')).not.toBeNull();
  });
  it('renders nothing for zero terms', () => {
    const { container } = render(<ProgressRing knew={0} total={0} label="x" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Markdown recall', () => {
  it('renders each **term** as a RecallTerm keyed id:n', () => {
    const onReveal = vi.fn();
    render(
      <Markdown recall={{ blockId: 'id', page: 2, get: () => 'blank', onReveal, onMark: () => {} }}>
        {'Some **alpha** and **beta** here.'}
      </Markdown>,
    );
    const btns = screen.getAllByRole('button', { name: 'Reveal term, page 2' });
    expect(btns).toHaveLength(2);
    btns.forEach((b) => fireEvent.click(b));
    expect(onReveal.mock.calls).toEqual([['id:0'], ['id:1']]);
  });
});
