import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import ProfileScreen from '../../screens/ProfileScreen';
import RankScreen from '../../screens/RankScreen';
import MomentsScreen from '../../screens/MomentsScreen';
import HistoryScreen from '../../screens/HistoryScreen';

/*
 * Profile and its three rooms — Rank, Moments, Study history — in German.
 * The moments, the XP events and the study-day summaries are demo data and
 * stay English; everything around them is chrome, and none of it may be.
 */

/* "XP", "Level" and "Likes" are left out: German says them the same way. */
const ENGLISH_CHROME = [
  // Profile
  'Profile',
  'to go',
  'day in a row',
  'days in a row',
  'Your journey',
  'Every Space you are in',
  'Moments',
  'Not a set to complete',
  'All moments',
  'to the next Rank',
  // Rank
  'Rank',
  'Progress through Rank',
  'through this rank',
  'XP comes from being useful',
  'Publishing on its own earns nothing',
  'grant no XP',
  'Where yours came from',
  'Learning',
  'Liked by someone',
  'Endorsed by an Owner',
  'Used by someone',
  'Milestone',
  'worth trusting',
  'Everything that earned it',
  'What is ahead',
  'You are here',
  'from the start',
  // Moments
  'The firsts',
  'nothing to collect',
  'Nothing yet',
  // History
  'Study history',
  'days running',
  'day running',
  'Longest so far',
  'days studied in all',
  'Including today',
  'Last on',
  'The last six weeks',
  'no study',
  'A filled square',
  'Every day you studied',
];

/* The shared top bar and the global nav are slice 3's; each screen's own header stays in. */
const said = () => {
  const root = document.body.cloneNode(true) as HTMLElement;
  root.querySelectorAll('header.sticky').forEach((h) => h.remove());
  root.querySelectorAll('nav').forEach((n) => n.remove());
  const attrs = [...root.querySelectorAll<HTMLElement>('[aria-label],[title],[placeholder]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
  );
  return [root.textContent ?? '', ...attrs].join('\n');
};
/* Whole words; the demo moments, events and summaries use none of these phrases. */
const leftover = () => {
  const all = said();
  return ENGLISH_CHROME.filter((w) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(all));
};
const rawKeys = () => said().match(/\b(?:profile|rank|moments|history)\.[a-z][\w.]*/g) ?? [];

const show = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(async () => {
  await act(() => i18n.changeLanguage('de'));
});
afterEach(async () => {
  await act(() => i18n.changeLanguage('en'));
});

describe('Profile and its rooms, in German', () => {
  it('Profile says nothing in English', async () => {
    show(<ProfileScreen />);
    expect(await screen.findByRole('link', { name: /^Rang \d+\. Noch \d+ XP bis zum nächsten Rang\.$/ }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('Dein Weg')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alle Momente' })).toBeInTheDocument();
    expect(screen.getByText(/^Tage? in Folge$/)).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('Rank explains itself in German', async () => {
    show(<RankScreen />);
    expect(await screen.findByRole('heading', { level: 1, name: /^Rang \d+$/ }, { timeout: 3000 })).toBeInTheDocument();
    // The back link; the mobile nav carries a second "Profil".
    expect(screen.getAllByRole('link', { name: 'Profil' }).length).toBeGreaterThan(1);
    expect(screen.getByRole('progressbar', { name: /^Fortschritt in Rang \d+$/ })).toBeInTheDocument();
    expect(screen.getByText('XP gibt es fürs Nützlichsein')).toBeInTheDocument();
    expect(screen.getByText('Du bist hier')).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('Moments says nothing in English, and dates them in German', async () => {
    show(<MomentsScreen />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Die ersten Male' }, { timeout: 3000 })).toBeInTheDocument();
    expect(said()).toMatch(/\d{1,2}\. (Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember) \d{4}/);
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('Study history says nothing in English', async () => {
    show(<HistoryScreen />);
    expect(await screen.findByRole('heading', { level: 1, name: /^\d+ Tage? in Folge$/ }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('Die letzten sechs Wochen')).toBeInTheDocument();
    expect(screen.getByText(/Bisher am längsten: \d+ Tage? · \d+ Lerntage? insgesamt/)).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });
});
