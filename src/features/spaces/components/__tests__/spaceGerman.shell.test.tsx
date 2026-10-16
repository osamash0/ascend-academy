import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { SpacesTopBar } from '../SpacesTopBar';
import { SearchPalette } from '../SearchPalette';
import { AskBar } from '../AskBar';
import { viewer } from '../../mocks/people';
import { notifications } from '../../mocks/notifications';

/*
 * The shell, in German: the top bar, the bottom bar on a phone, the
 * notification panel, ⌘K and the ask button. The notifications themselves and
 * the search hits are demo data and stay as they are — what is checked is the
 * chrome around them.
 */

const ENGLISH_CHROME = [
  'Home',
  'Library',
  'Social',
  'Profile',
  'Main',
  'Open account menu',
  'Ask anything',
  'Search',
  'Settings',
  'Sign out',
  'Not wired',
  'Notifications',
  'Mark all read',
  'Unread',
  'unread',
  'Today',
  'Yesterday',
  'Nothing yet',
  'Lessons',
  'Ideas',
  'From the community',
  'result',
  'results',
  'No results',
  'Nothing matches',
  'Type to search',
  'Ask Luna',
];

/** Everything the shell says, minus the demo data it shows. */
const said = () => {
  const root = document.body.cloneNode(true) as HTMLElement;
  /* Search hits are the demo Spaces' own titles. */
  root.querySelectorAll('[role="option"]').forEach((el) => el.remove());
  const attrs = [...root.querySelectorAll<HTMLElement>('[aria-label],[title],[placeholder]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
  );
  /* The notifications' own words are the fixture's. */
  const demo = notifications.flatMap((n) => [n.title, n.message]);
  const text = demo.reduce((all, words) => all.split(words).join(''), root.textContent ?? '');
  return [text, ...attrs].join('\n');
};
/* Whole words: "Spaces" is German too, and "Search" must not trip on a longer word. */
const leftover = () => {
  const all = said();
  return ENGLISH_CHROME.filter((w) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(all));
};
const rawKeys = () => said().match(/\b(?:nav|notifications|search|ask)\.[a-z][\w.]*/g) ?? [];

beforeEach(async () => {
  await act(() => i18n.changeLanguage('de'));
});
afterEach(async () => {
  await act(() => i18n.changeLanguage('en'));
});

describe('the shell, in German', () => {
  it('names the rooms the glossary names, in both navs', () => {
    render(
      <MemoryRouter>
        <SpacesTopBar active="home" viewer={viewer} />
      </MemoryRouter>,
    );
    for (const room of ['Start', 'Spaces', 'Bibliothek', 'Leute', 'Profil']) {
      /* Once as a pill in the top bar, once as a link in the bottom bar. */
      expect(screen.getAllByRole('button', { name: room }).length).toBeGreaterThan(0);
      expect(screen.getByRole('link', { name: room })).toBeInTheDocument();
    }
    expect(screen.getByText('Frag, was du willst')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Einstellungen' })).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('the notification panel says its chrome in German', async () => {
    render(
      <MemoryRouter>
        <SpacesTopBar active="home" viewer={viewer} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Benachrichtigungen, \d+ ungelesen$/ }));
    expect(await screen.findByText('Alle als gelesen markieren')).toBeInTheDocument();
    expect(screen.getAllByText('Benachrichtigungen').length).toBeGreaterThan(0);
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('⌘K, before and after typing', () => {
    render(
      <MemoryRouter>
        <SearchPalette open onOpenChange={() => {}} />
      </MemoryRouter>,
    );
    const box = screen.getByRole('combobox', { name: 'Spaces, Lektionen und Ideen durchsuchen' });
    expect(screen.getByText(/Tipp etwas ein/)).toBeInTheDocument();
    expect(leftover()).toEqual([]);

    fireEvent.change(box, { target: { value: 'zzzqqq' } });
    expect(screen.getByText('Nichts passt zu „zzzqqq“.')).toBeInTheDocument();
    expect(screen.getByText('Keine Ergebnisse')).toBeInTheDocument();
    expect(leftover()).toEqual([]);

    fireEvent.change(box, { target: { value: 'a' } });
    expect(screen.getByText(/^\d+ Ergebnisse?$/)).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('the ask button', () => {
    render(<AskBar placeholder="Frag Luna" suggestions={[]} model="gpt" onSubmit={() => {}} />);
    expect(screen.getByRole('button', { name: 'Luna fragen' })).toBeInTheDocument();
    expect(leftover()).toEqual([]);
  });
});
