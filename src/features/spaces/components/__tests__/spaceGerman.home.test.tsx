import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Archive } from 'lucide-react';
import i18n from '@/i18n';
import HomeScreen from '../../screens/HomeScreen';
import SpacesHubScreen from '../../screens/SpacesHubScreen';
import SpacesScreen from '../../screens/SpacesScreen';
import { AscentMap, ascentSpaces } from '../AscentMap';
import { StudioShell } from '../StudioShell';
import { visibleSpaces } from '../../mocks/spaces';

/*
 * Home, the Spaces hub, the legacy hub, the tiles, Ascent and the Studio
 * shell, in German — nothing of their own chrome left in English.
 *
 * Space names, Lesson titles and Space descriptions are the fixtures' words
 * and stay as they are; the shared top bar and mobile nav are another
 * slice's, so `header` and `nav` are taken out of what is checked.
 */

const ENGLISH_CHROME = [
  'Space of the week',
  'See all',
  'Your spaces',
  'Discover spaces',
  'new activity',
  'Invite only',
  'You are a member',
  'Good morning',
  'Good afternoon',
  'Good evening',
  'Still up',
  'in a row',
  'What should we focus on',
  'Ask about your Spaces',
  'In progress',
  'Up next',
  'Due for review',
  'New since you were here',
  'Pick up where you left off',
  'Also today',
  'Recently viewed',
  'Continue',
  'You are caught up',
  'Review something',
  'Find another Space',
  'Nothing to pick up',
  'Create a Space',
  'Join with a code',
  'Find your next space',
  'Browse Spaces',
  'you have not joined',
  'Invite only',
  'members',
  'member',
  'Last active',
  'Jump back in',
  'Worth a look',
  'Popular right now',
  'New this week',
  'Archived',
  'Read-only',
  'earns XP',
  'Request access',
  'Requested',
  'Enter',
  'Sort by',
  'Public Spaces',
  'Created by you',
  'Joined',
  'Hide archived',
  'New Space',
  'Progress',
  'Done',
  'Still processing',
  'You own this Space',
  'drafts',
  'stars',
  'Spaces cleared',
  'Lessons cleared',
  'Your journey',
  'further folded',
  'Nothing to light yet',
  'Back to Library',
  'Lesson',
  'Lessons',
];

const said = () => {
  const root = document.body.cloneNode(true) as HTMLElement;
  root.querySelectorAll('header, nav').forEach((h) => h.remove());
  const attrs = [...root.querySelectorAll<HTMLElement>('[aria-label],[title],[placeholder]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
  );
  /* SVG <title> children are text too. */
  return [root.textContent ?? '', ...attrs].join('\n');
};
/* Whole words; a fixture's own name is not chrome. */
const leftover = () => {
  const all = said();
  return ENGLISH_CHROME.filter((w) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(all));
};
const rawKeys = () => said().match(/\b(?:home|hub|tiles|ascent|stage|shell)\.[a-z][\w.]*/g) ?? [];

/* Fixture text (Lesson titles, Space names and descriptions) said in the deck's language. */
const fixtureWords = () =>
  visibleSpaces()
    .flatMap((s) => [s.name, s.description ?? ''])
    .filter(Boolean);
const leftoverChrome = () => {
  const fixtures = fixtureWords();
  return leftover().filter((w) => !fixtures.some((f) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(f)));
};

beforeEach(async () => {
  await act(() => i18n.changeLanguage('de'));
});
afterEach(async () => {
  window.history.replaceState(null, '', '/');
  await act(() => i18n.changeLanguage('en'));
});

/* The hub's cards and chip row (components/hub/) are checked with the rest. */
const hubLeftover = leftoverChrome;

const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('Home, in German', () => {
  it('greets, offers the next Lesson and the queue, all in German', async () => {
    inRouter(<HomeScreen />);
    expect(await screen.findByText('Worauf konzentrieren wir uns?', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Frag etwas zu deinen Spaces, Lektionen oder Übungen …')).toBeInTheDocument();
    expect(leftoverChrome()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('says you are caught up in German', async () => {
    window.history.replaceState(null, '', '/?mock=review');
    inRouter(<HomeScreen />);
    expect(await screen.findByText('Etwas wiederholen', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(leftoverChrome()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('a brand-new account is invited in German', async () => {
    window.history.replaceState(null, '', '/?mock=onboard');
    inRouter(<HomeScreen />);
    expect(await screen.findByText('Space erstellen', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(leftoverChrome()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });
});

describe('the Spaces hub, in German', () => {
  it('the hero, the sort, the rails and the archive', async () => {
    inRouter(<SpacesHubScreen />);
    await waitFor(() => expect(document.querySelector('[data-chip="discover"]')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByRole('button', { name: 'Zuletzt aktiv' })).toBeInTheDocument();
    expect(screen.getByText('Gerade beliebt')).toBeInTheDocument();
    expect(hubLeftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('Discover says how many Spaces you have not joined', async () => {
    inRouter(<SpacesHubScreen />);
    await waitFor(() => expect(document.querySelector('[data-chip="discover"]')).toBeTruthy(), { timeout: 3000 });
    fireEvent.click(document.querySelector('[data-chip="discover"]')!);
    expect(await screen.findByText('Finde deinen nächsten Space', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/noch nicht beigetreten/)).toBeInTheDocument();
    expect(hubLeftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('the legacy hub and its tiles', async () => {
    inRouter(<SpacesScreen />);
    expect(await screen.findByText('Sortieren nach', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Meine' })).toBeInTheDocument();
    expect(leftoverChrome()).toEqual([]);
    expect(rawKeys()).toEqual([]);
    fireEvent.click(screen.getByRole('tab', { name: 'Entdecken' }));
    expect(await screen.findByText('Öffentliche Spaces')).toBeInTheDocument();
    expect(leftoverChrome()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });
});

describe('Ascent and the Studio shell, in German', () => {
  it('the journey map counts in German', () => {
    inRouter(<AscentMap spaces={ascentSpaces(visibleSpaces())} />);
    expect(screen.getByRole('group', { name: /^Dein Weg:/ })).toBeInTheDocument();
    expect(leftoverChrome()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('an empty journey says so in German', () => {
    inRouter(<AscentMap spaces={[]} />);
    expect(screen.getByText(/Noch leuchtet nichts/)).toBeInTheDocument();
    expect(leftover()).toEqual([]);
  });

  it('the shell’s back arrow', () => {
    inRouter(
      <StudioShell icon={Archive} title="Studio" subtitle="—">
        <p />
      </StudioShell>,
    );
    expect(screen.getByRole('link', { name: 'Zurück zur Bibliothek' })).toBeInTheDocument();
    expect(leftover()).toEqual([]);
  });
});
