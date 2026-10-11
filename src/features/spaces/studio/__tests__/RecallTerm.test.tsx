import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { RecallTerm } from '../components/RecallTerm';
import { ProgressRing } from '../components/ProgressRing';
import { termsIn } from '../recall';
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

const keysFor = (md: string) => {
  const onReveal = vi.fn();
  const { container, unmount } = render(
    <StrictMode>
      <Markdown recall={{ blockId: 'id', page: 2, get: () => 'blank', onReveal, onMark: () => {} }}>{md}</Markdown>
    </StrictMode>,
  );
  const btns = screen.queryAllByRole('button', { name: 'Reveal term, page 2' });
  btns.forEach((b) => fireEvent.click(b));
  const keys = onReveal.mock.calls.map((c) => c[0]);
  unmount();
  void container;
  return keys;
};

describe('Markdown recall keys', () => {
  it('survives StrictMode with id:0 and id:1', () => {
    expect(keysFor('Some **alpha** and **beta** here.')).toEqual(['id:0', 'id:1']);
  });
  it('duplicate terms get their own keys', () => {
    expect(keysFor('**x** then **x** again, and **y**.')).toEqual(['id:0', 'id:1', 'id:2']);
  });
  it('indexes run across paragraphs and lists', () => {
    expect(keysFor('First **a**.\n\n- item **b**\n\nLast **c**.')).toEqual(['id:0', 'id:1', 'id:2']);
  });
  it.each([
    ['nested emphasis inside bold', 'x **a *b* c** and **d**'],
    ['bold inside inline code', 'x `**a**` and **d**'],
    ['bold inside a code fence', 'x\n\n```\n**a**\n```\n\nand **d**'],
    ['bold wrapping a line', 'x **a\nb** and **d**'],
    ['bold with a link', 'x **[a](https://e.example)** and **d**'],
    ['underscores in a term', 'x **a_b** and **d**'],
  ])('termsIn agrees with what renders: %s', (_n, md) => {
    const terms = termsIn(md);
    const keys = keysFor(md);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toEqual(terms.map((_t, i) => `id:${i}`));
  });
  it('wrapped bold is one term', () => {
    expect(termsIn('x **a\nb** y')).toEqual(['a b']);
  });
  it('multi-block ids key per block', () => {
    const onReveal = vi.fn();
    render(
      <>
        <Markdown recall={{ blockId: 'b1', page: 1, get: () => 'blank', onReveal, onMark: () => {} }}>{'**p**'}</Markdown>
        <Markdown recall={{ blockId: 'b2', page: 1, get: () => 'blank', onReveal, onMark: () => {} }}>{'**q**'}</Markdown>
      </>,
    );
    screen.getAllByRole('button').forEach((b) => fireEvent.click(b));
    expect(onReveal.mock.calls).toEqual([['b1:0'], ['b2:0']]);
  });
  it('a term stays mounted when its parent re-renders; the timer is not restarted', () => {
    vi.useFakeTimers();
    const mk = (get: () => 'seen') => (
      <Markdown recall={{ blockId: 'id', page: 1, get, onReveal: () => {}, onMark: () => {} }}>{'**t**'}</Markdown>
    );
    const { rerender } = render(mk(() => 'seen'));
    const knew = screen.getByRole('button', { name: 'Knew it' });
    act(() => void vi.advanceTimersByTime(3000));
    rerender(mk(() => 'seen'));
    expect(screen.getByRole('button', { name: 'Knew it' })).toBe(knew);
    act(() => void vi.advanceTimersByTime(1200));
    expect(screen.queryByRole('button', { name: 'Knew it' })).toBeNull();
  });
});

describe('RecallTerm focus and motion', () => {
  it('blur is present when motion is allowed', () => {
    const { container } = render(<RecallTerm text="x" state="seen" page={1} onReveal={() => {}} onMark={() => {}} />);
    expect(container.innerHTML).toContain('blur(');
  });
  it('focus moves to Knew it on reveal, and back to the term after marking', () => {
    const onMark = vi.fn();
    const { rerender } = render(<RecallTerm text="BCNF" state="blank" page={1} onReveal={() => {}} onMark={onMark} />);
    rerender(<RecallTerm text="BCNF" state="seen" page={1} onReveal={() => {}} onMark={onMark} />);
    expect(screen.getByRole('button', { name: 'Knew it' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Not yet' }));
    expect(screen.getByLabelText('BCNF, revealed')).toHaveFocus();
  });
  it('focus returns to the term when the pair times out', () => {
    vi.useFakeTimers();
    const { rerender } = render(<RecallTerm text="BCNF" state="blank" page={1} onReveal={() => {}} onMark={() => {}} />);
    rerender(<RecallTerm text="BCNF" state="seen" page={1} onReveal={() => {}} onMark={() => {}} />);
    act(() => void vi.advanceTimersByTime(4100));
    expect(screen.getByLabelText('BCNF, revealed')).toHaveFocus();
  });
});
