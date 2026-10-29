import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SpaceWindow, WINDOW_LOOKS, windowOf } from '../sky/SpaceWindow';
import { StarField, starsFor } from '../sky/StarField';
import { FaceStack, SpaceLife, peopleLine } from '../hub/People';
import { MAP_PALETTE } from '../SpaceMap';
import { allSpaces } from '../../mocks/spaces';
import type { Space } from '../../types';

/**
 * A Space drawn from its own files: a round window onto page 1 of its first
 * Lesson, calm black and white, ringed in the map's palette — gold for the
 * path finished, one white point for "you are here". Nothing is counted on
 * screen; the numbers live in the accessible name. And the people in it are
 * said, with their faces, not tabulated.
 */

const base = allSpaces[0];
const space = (over: Partial<Space>): Space => ({ ...base, ...over });
/** The line as the hub says it, through the app's own i18n. */
function Line({ s }: { s: Space }) {
  const { t } = useTranslation('v4Spaces');
  return <p data-line>{peopleLine(t, s) ?? 'null'}</p>;
}
const lineFor = (s: Space) => {
  const { container, unmount } = render(<Line s={s} />);
  const text = container.querySelector('[data-line]')!.textContent;
  unmount();
  return text === 'null' ? null : text;
};

describe('a Space’s window is its own first page', () => {
  it('shows the poster, calm: black and white and dimmed', () => {
    const { container } = render(<SpaceWindow size={80} cover="https://x/p.webp" progress={0} />);
    const img = container.querySelector('[data-cover]')!;
    expect(img.getAttribute('href')).toBe('https://x/p.webp');
    expect(WINDOW_LOOKS.calm.rest).toContain('grayscale(1)');
    expect(container.querySelector('[data-drawn-page]')).toBeNull();
  });

  it('draws a faint page when there is no poster, or it fails to load', () => {
    const { container, rerender } = render(<SpaceWindow size={80} cover={null} progress={0} />);
    expect(container.querySelector('[data-drawn-page]')).not.toBeNull();
    rerender(<SpaceWindow size={80} cover="https://x/broken.webp" progress={0} />);
    fireEvent.error(container.querySelector('[data-cover]')!);
    expect(container.querySelector('[data-drawn-page]')).not.toBeNull();
  });
});

describe('progress is the ring', () => {
  it('has no gold before you start, and gold in proportion after', () => {
    const { container, rerender } = render(<SpaceWindow size={100} progress={0} />);
    expect(container.querySelector('[data-ring-done]')).toBeNull();
    rerender(<SpaceWindow size={100} progress={0.25} />);
    const ring = container.querySelector('[data-ring-done]')!;
    expect(ring.getAttribute('stroke')).toBe(MAP_PALETTE.goldCore);
    const [on, all] = ring.getAttribute('stroke-dasharray')!.split(' ').map(Number);
    expect(on / all).toBeCloseTo(0.25, 2);
  });

  it('marks "you are here" with one white point, only when asked', () => {
    const { container, rerender } = render(<SpaceWindow size={100} progress={0.4} />);
    expect(container.querySelector('[data-ring-here]')).toBeNull();
    rerender(<SpaceWindow size={100} progress={0.4} current />);
    expect(container.querySelector('[data-ring-here]')!.getAttribute('fill')).toBe(MAP_PALETTE.hereRim);
  });

  it('is "here" only in a Space you are in, started and unfinished', () => {
    expect(windowOf(space({ viewerRole: 'member', viewerProgress: 40 })).current).toBe(true);
    expect(windowOf(space({ viewerRole: null, viewerProgress: 40 })).current).toBe(false);
    expect(windowOf(space({ viewerRole: 'member', viewerProgress: 0 })).current).toBe(false);
    expect(windowOf(space({ viewerRole: 'member', viewerProgress: 100 })).current).toBe(false);
  });

  it('draws no number at all', () => {
    const { container } = render(<SpaceWindow size={80} progress={0.3} current label="x" />);
    expect(container.querySelector('text')).toBeNull();
    expect(container.textContent).toBe('');
  });
});

describe('a window is named for screen readers, or hidden', () => {
  it('is an image with the counts in its name when labelled', () => {
    render(<SpaceWindow size={80} progress={0.3} label="Datenbanksysteme. 3 of 10 Lessons done." />);
    expect(screen.getByRole('img', { name: 'Datenbanksysteme. 3 of 10 Lessons done.' })).toBeTruthy();
  });

  it('is decoration when unlabelled, because its control carries the name', () => {
    const { container } = render(<SpaceWindow size={40} progress={0} />);
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('the people in a Space are said, not counted', () => {
  const lea = { id: 'lea', name: 'Lea Brandt', avatarUrl: null };
  const jonas = { id: 'jonas', name: 'Jonas Weber', avatarUrl: null };

  it('names two faces and counts the rest, without the viewer', () => {
    const s = space({ viewerRole: 'member', memberCount: 128, faces: [lea, jonas] });
    expect(lineFor(s)).toBe('Lea, Jonas and 125 others learn here');
  });

  it('reads naturally with only one or two others', () => {
    expect(lineFor(space({ viewerRole: 'member', memberCount: 2, faces: [lea] }))).toBe('Lea learns here');
    expect(lineFor(space({ viewerRole: 'owner', memberCount: 2, faces: [lea, jonas] }))).toBe(
      'Lea and Jonas learn here',
    );
  });

  it('shows a browsing viewer a count, never strangers’ faces', () => {
    const s = space({ viewerRole: null, memberCount: 40, faces: [] });
    expect(lineFor(s)).toBe('40 people learn here');
    const { container } = render(<FaceStack space={s} />);
    expect(container.textContent).toBe('');
  });

  it('says nothing when you learn there alone', () => {
    expect(lineFor(space({ viewerRole: 'member', memberCount: 1, faces: [] }))).toBeNull();
  });

  it('tells you where you stopped, as a way back in', () => {
    const s = space({
      viewerRole: 'member',
      faces: [],
      memberCount: 1,
      lastPlace: { lessonId: 'l7', lessonTitle: 'Drei-Schichten-Modell', page: 32 },
    });
    render(
      <MemoryRouter>
        <SpaceLife space={s} />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /page 32 · Drei-Schichten-Modell/ });
    expect(link.getAttribute('href')).toBe(`/v4/space/${s.id}/lesson/l7`);
  });
});

describe('the star field', () => {
  it('is the same sky on every render', () => {
    expect(starsFor('hub', 60)).toEqual(starsFor('hub', 60));
    expect(starsFor('hub', 60)).not.toEqual(starsFor('profile', 60));
  });

  it('stays faint and out of the way', () => {
    for (const s of starsFor('hub', 80)) {
      expect(s.o).toBeGreaterThanOrEqual(0.25);
      expect(s.o).toBeLessThanOrEqual(0.6);
    }
    const { container } = render(<StarField seed="hub" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('class')).toContain('pointer-events-none');
    expect(svg.querySelectorAll('circle').length).toBe(60);
  });
});
