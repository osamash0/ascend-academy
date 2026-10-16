import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import LibraryStudioScreen from '../../screens/LibraryStudioScreen';

/*
 * Library's Studio screens, in German.
 *
 * Every view in the screen's VIEWS table — uploads, drafts, impact — plus the
 * not-found screen for a mistyped one. What the rows *name* (file titles,
 * Lesson titles, Space names) is mock data and stays English; what the screen
 * itself says must not.
 */

const ENGLISH_CHROME = [
  'Manage uploads',
  'Your drafts',
  'How your work landed',
  'selected',
  'Select this row',
  'Publish',
  'Delete',
  'files across your Spaces',
  'The original files',
  'Working',
  'Ready',
  'unpublished across',
  'Only you can see these',
  'Processing',
  'Needs review',
  'Draft',
  'published contributions',
  'Every contribution',
  'Needs a new home',
  'Endorsed',
  'Open',
  'Library',
  'Loading',
  'Something went wrong',
];

/* The Studio shell's top bar is not this slice's; the screen under it is. */
const said = () => {
  const root = document.body.cloneNode(true) as HTMLElement;
  root.querySelectorAll('header, nav').forEach((h) => h.remove());
  const attrs = [...root.querySelectorAll<HTMLElement>('[aria-label],[title],[placeholder]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
  );
  return [root.textContent ?? '', ...attrs].join('\n');
};
const leftover = () => {
  const all = said();
  return ENGLISH_CHROME.filter((w) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(all));
};
const rawKeys = () => said().match(/\b(?:studio|views|uploads|drafts|impact|toast)\.[a-z][\w.]*/g) ?? [];

const open = (view: string) =>
  render(
    <MemoryRouter initialEntries={[`/v4/library/${view}`]}>
      <Routes>
        <Route path="/v4/library/:view" element={<LibraryStudioScreen />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(async () => {
  await act(() => i18n.changeLanguage('de'));
});
afterEach(async () => {
  await act(() => i18n.changeLanguage('en'));
});

describe('Library Studio, in German', () => {
  it('manage uploads says nothing in English', async () => {
    open('uploads');
    expect(await screen.findByRole('heading', { level: 1, name: 'Uploads verwalten' })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('input[type="checkbox"]')).toBeTruthy());
    expect(screen.getAllByText('Bereit').length + screen.queryAllByText('In Arbeit').length).toBeGreaterThan(0);
    fireEvent.click(document.querySelector('input[type="checkbox"]') as HTMLInputElement);
    await waitFor(() => expect(document.body.textContent).toMatch(/1 ausgewählt/));
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('your drafts says nothing in English', async () => {
    open('drafts');
    expect(await screen.findByRole('heading', { level: 1, name: 'Deine Entwürfe' })).toBeInTheDocument();
    /* The loading state, inside the same shell, is German too. */
    if (/Wird geladen/.test(document.body.textContent ?? '')) {
      expect(leftover()).toEqual([]);
      expect(rawKeys()).toEqual([]);
    }
    await waitFor(() => expect(document.body.textContent).toMatch(/unveröffentlichte Lektion/));
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('how your work landed says nothing in English', async () => {
    open('impact');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Wie deine Arbeit ankam' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(document.body.textContent).toMatch(/veröffentlichter? Beitr/));
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('a mistyped screen is refused in German, naming the three that exist', async () => {
    open('not-a-real-view');
    expect(await screen.findByRole('heading', { level: 1, name: 'Bibliothek' })).toBeInTheDocument();
    expect(document.body.textContent).toMatch(
      /Uploads verwalten · Deine Entwürfe · Wie deine Arbeit ankam/,
    );
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });
});
