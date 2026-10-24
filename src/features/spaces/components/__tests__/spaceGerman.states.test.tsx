import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import {
  ListSkeleton,
  NoSpacesYet,
  NotFound,
  NothingToDiscover,
  SpacesError,
  type Failed,
  type Loading,
  type Missing,
} from '../states';

/*
 * Every empty, failed and missing state, in German, as a whole sentence.
 *
 * They used to be one English frame around a noun, which German cannot fill
 * (it needs the noun's gender in the words around it). Each is now chosen,
 * not assembled — so each is checked: German, no raw key, no English frame.
 */

const FAILED: Failed[] = ['spaces', 'space', 'lesson', 'idea', 'practice', 'person', 'library', 'material', 'work', 'profile', 'settings', 'people', 'moments', 'history', 'rank', 'next'];
const MISSING: Missing[] = ['space', 'lesson', 'idea', 'person', 'material', 'screen'];
const LOADING: Loading[] = ['any', 'spaces', 'profile', 'social', 'moments', 'history', 'rank'];

const ENGLISH = /Couldn|isn’t here|Try again|Back to|Loading|No Spaces|Create your|Join with|Search everywhere|No public/;
const RAW = /\bstates\.[a-z]/;

beforeEach(async () => {
  await act(() => i18n.changeLanguage('de'));
});
afterEach(async () => {
  await act(() => i18n.changeLanguage('en'));
});

const text = () => {
  const attrs = [...document.body.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label'));
  return [document.body.textContent, ...attrs].join('\n');
};

describe('the states, in German', () => {
  it.each(FAILED)('a failure to load "%s" is one German sentence', (what) => {
    render(<SpacesError what={what} onRetry={() => {}} />);
    expect(screen.getByRole('button', { name: /Noch mal versuchen/ })).toBeInTheDocument();
    expect(text()).toMatch(/konnte(n)? nicht geladen werden/);
    expect(text()).not.toMatch(ENGLISH);
    expect(text()).not.toMatch(RAW);
  });

  it.each(MISSING)('a missing "%s" says so, and the way back', (what) => {
    render(
      <MemoryRouter>
        <NotFound what={what} back={{ to: '/v4/spaces', place: 'spaces' }} />
      </MemoryRouter>,
    );
    expect(text()).toMatch(/gibt es hier nicht/);
    expect(screen.getByRole('link', { name: 'Zurück zu den Spaces' })).toBeInTheDocument();
    expect(text()).not.toMatch(ENGLISH);
    expect(text()).not.toMatch(RAW);
  });

  it('a Material is "das Material" in both', () => {
    const { unmount } = render(<SpacesError what="material" onRetry={() => {}} />);
    expect(screen.getByText('Dieses Material konnte nicht geladen werden')).toBeInTheDocument();
    unmount();
    render(
      <MemoryRouter>
        <NotFound what="material" back={{ to: '/v4/library', place: 'library' }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Dieses Material gibt es hier nicht')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zurück zur Bibliothek' })).toBeInTheDocument();
  });

  it('the way back can name the Space', () => {
    render(
      <MemoryRouter>
        <NotFound what="lesson" back={{ to: '/v4/space/s', space: 'Datenbanksysteme' }} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Zurück zu Datenbanksysteme' })).toBeInTheDocument();
  });

  it.each(LOADING)('loading "%s" is announced in German', (label) => {
    render(<ListSkeleton label={label} />);
    expect(text()).not.toMatch(ENGLISH);
    expect(text()).not.toMatch(RAW);
  });

  it('no Spaces yet, and nothing to discover', () => {
    render(
      <>
        <NoSpacesYet onCreate={() => {}} onJoin={() => {}} />
        <NothingToDiscover scopeLabel="Marburg" onWiden={() => {}} />
      </>,
    );
    expect(screen.getByText('Noch keine Spaces')).toBeInTheDocument();
    expect(screen.getByText('Keine öffentlichen Spaces in Marburg')).toBeInTheDocument();
    expect(text()).not.toMatch(ENGLISH);
    expect(text()).not.toMatch(RAW);
  });
});
