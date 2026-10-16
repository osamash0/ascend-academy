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

/* "Uploads" and "Filter" are left out: German says them the same way. */
const ENGLISH_CHROME = [
  'Library',
  'Everything you’ve made',
  'Everything you made',
  'Everything',
  'Notes',
  'Published',
  'Drafts',
  'How your work landed',
  'still being prepared',
  'New note',
  'Not filed in a Space yet',
  'Not published yet',
  'Find it a new home',
  'was removed',
  'Your work is safe',
  'Open',
  'Nothing here yet',
  'No notes yet',
  'Nothing uploaded yet',
  'Nothing published yet',
  'Write your first note',
  'Write a note',
  'Go to your Spaces',
  'Write it down',
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
const rawKeys = () => said().match(/\b(?:library)\.[a-z][\w.]*/g) ?? [];

const open = async () => {
  const r = render(
    <MemoryRouter>
      <LibraryScreen />
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: 'Alles, was du gemacht hast' }, { timeout: 3000 });
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
  it('the page, its filters and its rows say nothing in English', async () => {
    await open();
    expect(screen.getByRole('heading', { name: 'Bibliothek' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Alles/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Notizen/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Entwürfe/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Neues Zuhause finden' })).toBeInTheDocument());
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('every filter, and writing a new note, stay German', async () => {
    await open();
    for (const name of [/^Notizen/, /^Uploads/, /^Veröffentlicht/, /^Alles/]) {
      fireEvent.click(screen.getByRole('tab', { name }));
      expect(leftover()).toEqual([]);
      expect(rawKeys()).toEqual([]);
    }
    fireEvent.click(screen.getByRole('button', { name: /Neue Notiz/ }));
    expect(await screen.findByPlaceholderText('Schreib es auf, solange es frisch ist …')).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });
});
