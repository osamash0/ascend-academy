import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { LifeBar } from '../Cover';

vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => true,
}));

/** Reduced motion: the life bar is where it belongs at once and fades in; its width never runs. */
describe('LifeBar under reduced motion', () => {
  const bar = (el: HTMLElement) => el.querySelector<HTMLElement>('[aria-hidden] > div')!;

  it('starts at its real width, not at zero', () => {
    const { container } = render(<LifeBar read={6} total={12} />);
    expect(bar(container).style.width).toBe('50%');
  });

  it('starts full while a file develops', () => {
    const { container } = render(<LifeBar read={0} total={12} developing />);
    expect(bar(container).style.width).toBe('100%');
  });
});
