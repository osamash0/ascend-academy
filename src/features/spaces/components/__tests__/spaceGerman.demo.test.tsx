import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import SpaceScreen, { type SpaceTab } from '../../screens/SpaceScreen';

/*
 * A German reader walks through a demo Space without one English word of the
 * Space page's own chrome: the overview (Up next, the path, the community),
 * the map and the members.
 *
 * The demo content (Space names, Lesson titles, contribution titles, people)
 * is the mocks' and stays English. Chrome owned by other files (the top bar,
 * badges, dialogs) is checked by their own slices, so the sentinel lists only
 * phrases SpaceScreen, LessonRow, SpaceMap and ContributionCard say.
 */

const ENGLISH_CHROME = [
  'Official',
  'Grounded',
  'Not grounded',
  'Guided',
  'Endorsed',
  'Star this Space',
  'Up next',
  'Continue',
  'Manage',
  'Archived',
  'read-only',
  'The path',
  'Add Lesson',
  'Add the first Lesson',
  'more Lessons',
  'more Lesson',
  'Show less',
  'From the community',
  'from the community',
  'Contribute',
  'Nothing from the community yet',
  'overview',
  'Members',
  /* 'Owner' alone is not listed: badges.tsx (EndorsedBadge) says it, and that file is not this slice's. */
  'Editor',
  'Showing',
  'Nobody else',
  /* 'Processing' alone is not listed: a demo Lesson is called "Query Processing". */
  'Draft',
  'Needs review',
  'Source file removed',
  'complete',
  'Lessons cleared',
  'ideas cleared',
  'Progress map',
  'You are here',
  'YOU ARE HERE',
  'CLEARED',
  'Not yet',
  'Contributions',
  'Write-up',
  'Practice set',
  'Find it a new home',
  'Endorse',
  'Hide',
  'Unhide',
  'Promote',
  'Report',
  'Reported',
  'Hidden by the Owner',
  'Like this',
  'likes',
];

/** Everything the screen says: its text, and what it says to a screen reader. */
const said = () => {
  const root = document.body;
  const attrs = [...root.querySelectorAll<HTMLElement>('[aria-label],[title],[placeholder]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
  );
  /* SVG <title> children are tooltips, and say things too. */
  const titles = [...root.querySelectorAll('title')].map((el) => el.textContent ?? '');
  return [root.textContent ?? '', ...attrs, ...titles].join('\n');
};

/* Whole words only, so a sentinel never trips on a longer German word. */
const leftover = () => {
  const all = said();
  return ENGLISH_CHROME.filter((w) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(all));
};
/* No key printed raw instead of its words. */
const rawKeys = () => said().match(/\bdemo\.[a-z][\w.]*/g) ?? [];

beforeEach(async () => {
  await act(() => i18n.changeLanguage('de'));
});
afterEach(async () => {
  await act(() => i18n.changeLanguage('en'));
});

const renderSpace = async (spaceId: string, tab: SpaceTab = 'overview') => {
  render(
    <MemoryRouter>
      <SpaceScreen spaceId={spaceId} tab={tab} />
    </MemoryRouter>,
  );
  await screen.findByRole('tablist', {}, { timeout: 4000 });
  await act(async () => {});
};

describe('a demo Space, in German', () => {
  it('the overview says nothing in English to a Member', async () => {
    await renderSpace('s-dbs');
    expect(screen.getByRole('tab', { name: 'Übersicht' })).toBeInTheDocument();
    expect(screen.getByText('Der Pfad')).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('the overview says nothing in English to an Owner, moderation included', async () => {
    await renderSpace('s-linalg');
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('an archived Space says so in German', async () => {
    await renderSpace('s-stats');
    expect(screen.getByText('Archiviert')).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('the map says nothing in English', async () => {
    await renderSpace('s-dbs', 'map');
    expect(screen.getByText('Du bist hier')).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('the members tab says nothing in English', async () => {
    await renderSpace('s-linalg', 'members');
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });
});
