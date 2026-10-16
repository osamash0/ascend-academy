import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import SocialScreen from '../../screens/SocialScreen';
import PersonScreen from '../../screens/PersonScreen';
import { resetSocial } from '../../mocks/social';

/*
 * Social and a person's page, in German — nothing of their own chrome left
 * in English.
 *
 * People's names, Space names and contribution titles are the fixtures' words
 * and stay as they are; the shared top bar and the global nav are another
 * slice's, so `header.sticky` and `nav` are taken out of what is checked.
 */

const ENGLISH_CHROME = [
  'Social',
  'learning alongside',
  'XP behind',
  'Nobody ahead of you',
  'on the board',
  'Show the board',
  'Top of the board',
  'You',
  'Ranking',
  'Friends',
  'Requests',
  'Ranked by XP',
  'in common',
  'No friends yet',
  'View profile',
  'profile',
  'Find people',
  'No requests',
  'Nothing waiting',
  'Accept',
  'Decline',
  'Rank',
  'No rank yet',
  'Spaces you are both in',
  'What they have published',
  'published anything',
  'likes',
  'Needs a new home',
];

/** Everything the screen says, minus the shared top bar and nav. */
const said = () => {
  const root = document.body.cloneNode(true) as HTMLElement;
  root.querySelectorAll('header.sticky, nav').forEach((h) => h.remove());
  const attrs = [...root.querySelectorAll<HTMLElement>('[aria-label],[title],[placeholder]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
  );
  return [root.textContent ?? '', ...attrs].join('\n');
};
/* Whole words only. */
const leftover = () => {
  const all = said();
  return ENGLISH_CHROME.filter((w) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(all));
};
/* No key printed raw instead of its words. */
const rawKeys = () => said().match(/\b(?:social|person)\.[a-z][\w.]*/g) ?? [];

beforeEach(async () => {
  resetSocial();
  await act(() => i18n.changeLanguage('de'));
});
afterEach(async () => {
  resetSocial();
  await act(() => i18n.changeLanguage('en'));
});

const renderSocial = () =>
  render(
    <MemoryRouter initialEntries={['/v4/social']}>
      <SocialScreen />
    </MemoryRouter>,
  );

describe('Social, in German', () => {
  it('the board and where you stand', async () => {
    renderSocial();
    expect(await screen.findByRole('heading', { name: 'Leute' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Rangliste' })).toBeInTheDocument();
    expect(screen.getByText(/^Nach XP sortiert/)).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('friends', async () => {
    renderSocial();
    fireEvent.click(await screen.findByRole('tab', { name: /^Freund:innen · / }));
    expect(screen.getAllByText('Profil ansehen').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Leute finden/ })).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('requests, and the empty state once they are all answered', async () => {
    renderSocial();
    fireEvent.click(await screen.findByRole('tab', { name: /^Anfragen · / }));
    expect(screen.getAllByRole('button', { name: /^Anfrage von .* annehmen$/ }).length).toBeGreaterThan(0);
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
    for (const b of screen.getAllByRole('button', { name: /^Anfrage von .* ablehnen$/ })) fireEvent.click(b);
    expect(await screen.findByText('Keine Anfragen')).toBeInTheDocument();
    expect(leftover()).toEqual([]);
  });
});

describe('a person’s page, in German', () => {
  it.each(['p-keller', 'p-ferreira', 'p-weber'])('%s says nothing in English', async (id) => {
    render(
      <MemoryRouter initialEntries={[`/v4/person/${id}`]}>
        <Routes>
          <Route path="/v4/person/:personId" element={<PersonScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.querySelector('h1')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getAllByRole('link', { name: /^Leute$/ }).length).toBeGreaterThan(0);
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });
});
