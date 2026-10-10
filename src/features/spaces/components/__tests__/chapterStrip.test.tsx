import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChapterStrip, chaptersOf } from '../reader/ChapterStrip';

const SECTIONS = [
  { conceptId: 'b', name: 'Closure', blocks: [{ page: 32 }, { page: 35 }] },
  { conceptId: 'a', name: 'Basics', blocks: [{ page: 1 }, { page: 2 }] },
  { conceptId: 'c', name: 'BCNF', blocks: [{ page: 41 }] },
];

describe('the chapter strip', () => {
  it('turns ideas into page ranges, in reading order, each running to the next', () => {
    expect(chaptersOf(SECTIONS, 82)).toEqual([
      { id: 'a', name: 'Basics', first: 1, last: 31 },
      { id: 'b', name: 'Closure', first: 32, last: 40 },
      { id: 'c', name: 'BCNF', first: 41, last: 82 },
    ]);
  });

  it('names the idea you are in, and jumps to an idea’s first page', () => {
    const onJump = vi.fn();
    render(<ChapterStrip chapters={chaptersOf(SECTIONS, 82)} page={34} onJump={onJump} />);
    expect(screen.getByText('Closure')).toBeInTheDocument();
    expect(screen.getByText(/2 of 3/)).toBeInTheDocument();
    const bcnf = screen.getByRole('button', { name: 'BCNF, pages 41 to 82' });
    fireEvent.pointerEnter(bcnf);
    expect(screen.getByText(/3 of 3/)).toBeInTheDocument();
    fireEvent.click(bcnf);
    expect(onJump).toHaveBeenCalledWith(41);
    expect(screen.getByRole('button', { name: 'Closure, pages 32 to 40' })).toHaveAttribute('aria-current', 'location');
  });
});
