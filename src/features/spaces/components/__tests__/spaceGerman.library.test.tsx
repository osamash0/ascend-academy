import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import LibraryScreen from '../../screens/LibraryScreen';
import { resetNotes } from '../../mocks/notes';
import { resetReanchors } from '../../mocks/reanchor';

/*
 * The Library, in German. The notes, titles and file names are the student's
 * own (demo data stays English); everything around them is chrome, and none
 * of it may be left in English.
 */

/* "Filter" and "A–Z" are left out: German says them the same way. */
const ENGLISH_CHROME = [
  'Library',
  'Everything',
  'Reading',
  'Shared',
  'Your words',
  'Your shelf',
  'Select',
  'Only you',
  'Continue reading',
  'Pick up where you left off',
  'Bring something in',
  'drop it, or click',
  'pages',
  'Read',
  'Recall',
  'New note',
  'Not filed in a Space yet',
  'Needs a new home',
  'Find it a new home',
  'Nothing written yet',
  'More for',
];

/*
 * The shared top bar and the mobile nav are slice 3's; this checks the Library
 * under them. Only *their* header and navs are stripped: the Library has its
 * own `<header>` (title and lede) and its own `<nav>` (the Studio doors), and
 * both are exactly what this test is for.
 */
const said = () => {
  const root = document.body.cloneNode(true) as HTMLElement;
  root.querySelectorAll('header.sticky').forEach((h) => h.remove());
  root.querySelectorAll('nav').forEach((n) => n.getAttribute('aria-label') !== 'Studio' && n.remove());
  const attrs = [...root.querySelectorAll<HTMLElement>('[aria-label],[title],[placeholder]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
  );
  return [root.textContent ?? '', ...attrs].join('\n');
};
/* Whole words; a note's own text is not chrome, but none of the demo notes uses these words. */
const leftover = () => {
  const all = said();
  return ENGLISH_CHROME.filter((w) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(all));
};
const rawKeys = () =>
  said().match(/\b(?:library|bringIn|continue|cover|life|journey|select|share|words)\.[a-z][\w.]*/g) ?? [];

const open = async () => {
  const r = render(
    <MemoryRouter>
      <LibraryScreen />
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: 'Bibliothek' }, { timeout: 3000 });
  return r;
};

beforeEach(async () => {
  resetNotes();
  resetReanchors();
  await act(() => i18n.changeLanguage('de'));
});
afterEach(async () => {
  await act(() => i18n.changeLanguage('en'));
});

describe('the Library, in German', () => {
  it('the shelf, its filters and its covers say nothing in English', async () => {
    await open();
    expect(screen.getByRole('tab', { name: /^Alles/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Deine Worte/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dein Regal' })).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('every filter, and writing a new note, stay German', async () => {
    await open();
    for (const name of [/^Zu lesen/, /^Geteilt/, /^Deine Worte/]) {
      fireEvent.click(screen.getByRole('tab', { name }));
      expect(leftover()).toEqual([]);
      expect(rawKeys()).toEqual([]);
    }
    fireEvent.click(screen.getByRole('button', { name: /Neue Notiz/ }));
    expect(await screen.findByPlaceholderText('Schreib es auf, solange es frisch ist …')).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('Select, and its Remove confirm, stay German', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /^Auswählen/ }));
    await waitFor(() => expect(screen.getByRole('group', { name: 'Auswahl' })).toBeInTheDocument());
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });
});
