import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('names the idea you are in, and jumps to an idea’s first page', async () => {
    const onJump = vi.fn();
    render(<ChapterStrip chapters={chaptersOf(SECTIONS, 82)} page={34} onJump={onJump} />);
    const nav = screen.getByRole('navigation', { name: 'Ideas in this Lesson' });
    expect(nav).toHaveTextContent(/Idea 2 of 3.*Closure/);
    /* Page 34 of 32–40: said as what is left, not as page numbers to decode. */
    expect(nav).toHaveTextContent('6 pages left in this idea');
    const bcnf = screen.getByRole('button', { name: 'BCNF, pages 41 to 82' });
    fireEvent.pointerEnter(bcnf);
    await waitFor(() => expect(nav).toHaveTextContent(/Idea 3 of 3.*BCNF/));
    expect(nav).toHaveTextContent('Pages 41–82 · click to go there');
    fireEvent.click(bcnf);
    expect(onJump).toHaveBeenCalledWith(41);
    expect(screen.getByRole('button', { name: 'Closure, pages 32 to 40' })).toHaveAttribute('aria-current', 'location');
  });
});
