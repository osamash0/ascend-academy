import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import {
  AddLessonDialog,
  ContributeDialog,
  JoinCodeBlock,
  JoinSpaceDialog,
  NewSpaceDialog,
} from '../SpaceDialogs';
import { ReanchorDialog } from '../ReanchorDialog';
import { NoteEditor } from '../NoteEditor';
import SpaceManageScreen from '../../screens/SpaceManageScreen';
import { joinCodeFor, spaceById } from '../../mocks/spaces';
import { orphansForSpace } from '../../mocks/contributions';

/*
 * Making, joining, contributing, re-filing, noting and managing — in German.
 *
 * Space names, Lesson titles and contribution titles are the mocks' and stay
 * as they are. What is checked is everything the dialogs and the manage
 * screen say themselves: visible text plus every aria-label, title and
 * placeholder, against phrases only the English chrome uses.
 */

/* The manage screen's repair queue only shows with an orphan; the owned demo Space has none. */
vi.mock('../../mocks/contributions', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../mocks/contributions')>();
  return { ...real, orphansForSpace: () => real.orphansForSpace('s-dbs') };
});

const ENGLISH_CHROME = [
  'New Space',
  'Who can publish',
  'Who can see',
  'Create and open',
  'Only you',
  'Anyone',
  'Guided',
  'Open',
  'Private',
  'Invite',
  'Public',
  'Join with a code',
  'Join code',
  'Six characters',
  'Owner',
  'Editor',
  'Member',
  'Members',
  'Copy code',
  'Add a Lesson',
  'What is it about',
  'finished product',
  'Create the draft',
  'Contribute',
  'What kind',
  'A write-up',
  'Practice',
  'A link',
  'Title',
  'The useful part',
  'Publish to',
  'Find it a',
  'new home',
  'Lessons',
  'Cancel',
  'Move it here',
  'Pick a Lesson',
  'Write a note',
  'Edit note',
  'Note',
  'Saves when',
  'Delete this note',
  'Done',
  'Manage',
  'Save changes',
  'Details',
  'Description',
  'Source of truth',
  'Show grounding',
  'Grounded content only',
  'Role for',
  'Remove',
  'Archive',
  'Delete this Space',
  'Delete permanently',
  'to confirm',
  'Back to the Space',
  'This isn’t your Space',
];

/** Everything the screen says: its text, and what it says to a screen reader. */
const said = (strip: string[] = []) => {
  const root = document.body;
  /* The mocks' own words — Space names, Lesson and contribution titles — are not chrome. */
  const text = strip.reduce((all, words) => all.split(words).join(' '), root.textContent ?? '');
  const attrs = [...root.querySelectorAll<HTMLElement>('[aria-label],[title],[placeholder]')].flatMap((el) =>
    ['aria-label', 'title', 'placeholder'].map((a) =>
      strip.reduce((v, words) => v.split(words).join(' '), el.getAttribute(a) ?? ''),
    ),
  );
  return [text, ...attrs].join('\n');
};

/* Whole words only: "Open" must not trip on "Offen" or a Space name that contains it. */
const leftover = (strip: string[] = []) => {
  const all = said(strip);
  return ENGLISH_CHROME.filter((w) => new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(all));
};
/* No key printed raw instead of its words. */
const rawKeys = () => said().match(/\b(?:dialogs|reanchor|notes|manage)\.[a-z][\w.-]*/g) ?? [];

beforeEach(async () => {
  await act(() => i18n.changeLanguage('de'));
});
afterEach(async () => {
  await act(() => i18n.changeLanguage('en'));
});

const dbs = spaceById('s-dbs')!;
const linalg = spaceById('s-linalg')!;

describe('the Space dialogs, in German', () => {
  it('a new Space is made in German', () => {
    render(
      <MemoryRouter>
        <NewSpaceDialog open onOpenChange={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('dialog', { name: 'Neuer Space' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Modus' })).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('joining with a code previews and joins in German', () => {
    render(
      <MemoryRouter>
        <JoinSpaceDialog open onOpenChange={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Beitrittscode'), { target: { value: 'ZZZZZZ' } });
    expect(screen.getByText(/Kein Space nutzt diesen Code/)).toBeInTheDocument();
    expect(leftover()).toEqual([]);

    fireEvent.change(screen.getByLabelText('Beitrittscode'), { target: { value: joinCodeFor(dbs.id) } });
    expect(screen.getByRole('button', { name: `${dbs.name} beitreten` })).toBeInTheDocument();
    expect(screen.getByText(/Mitglieder/)).toBeInTheDocument();
    expect(leftover([dbs.name, dbs.owner.name])).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('the join code is handed out in German', () => {
    render(<JoinCodeBlock spaceId={linalg.id} />);
    expect(screen.getByRole('button', { name: 'Code kopieren' })).toBeInTheDocument();
    expect(leftover()).toEqual([]);
  });

  it('adding a Lesson says draft, in German', () => {
    render(
      <MemoryRouter>
        <AddLessonDialog space={linalg} open onOpenChange={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('dialog', { name: 'Lektion hinzufügen' })).toBeInTheDocument();
    expect(leftover([linalg.name])).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('contributing says who will see it, in German', () => {
    render(
      <MemoryRouter>
        <ContributeDialog space={dbs} open onOpenChange={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: `In ${dbs.name} veröffentlichen` })).toBeInTheDocument();
    expect(leftover([dbs.name])).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('re-filing an orphan says it in German', () => {
    const orphan = orphansForSpace(dbs.id)[0];
    render(
      <ReanchorDialog
        contribution={orphan}
        spaceId={dbs.id}
        spaceName={dbs.name}
        viewerRole="owner"
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Lektionen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hierhin verschieben' })).toHaveAttribute(
      'title',
      'Wähl zuerst eine Lektion',
    );
    const titles = [...document.querySelectorAll('[role="radio"]')].map((r) => r.textContent ?? '');
    expect(leftover([orphan.title, dbs.name, ...titles])).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });
});

describe('notes, in German', () => {
  it('an empty note invites writing, in German', () => {
    render(<NoteEditor onSave={() => {}} />);
    expect(screen.getByRole('button', { name: 'Notiz schreiben' })).toBeInTheDocument();
    expect(leftover()).toEqual([]);
  });

  it('an open note says how it saves, in German', () => {
    render(<NoteEditor value="Mein Gedanke" onSave={() => {}} onDelete={() => {}} autoOpen />);
    expect(screen.getByRole('textbox', { name: 'Notiz' })).toHaveAttribute(
      'placeholder',
      'Schreib es auf, solange es frisch ist …',
    );
    expect(screen.getByRole('button', { name: 'Diese Notiz löschen' })).toBeInTheDocument();
    expect(leftover()).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });
});

const renderManage = async (spaceId: string) => {
  render(
    <MemoryRouter initialEntries={[`/v4/space/${spaceId}/manage`]}>
      <Routes>
        <Route path="/v4/space/:spaceId/manage" element={<SpaceManageScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {});
};

/* Names the mocks put on the screen: people, Spaces, contribution titles. */
const mockWords = () =>
  [...document.querySelectorAll('a, [title]')]
    .map((el) => el.textContent ?? '')
    .filter(Boolean)
    .concat([linalg.name, dbs.name, dbs.owner.name, ...orphansForSpace(dbs.id).map((c) => c.title)]);

describe('managing a Space, in German', () => {
  it('the Owner manages it in German', async () => {
    await renderManage(linalg.id);
    expect(await screen.findByText('Space verwalten')).toBeInTheDocument();
    expect(screen.getByText('Braucht einen neuen Platz')).toBeInTheDocument();
    expect(leftover(mockWords())).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('a Member is told it is not theirs, in German', async () => {
    await renderManage(dbs.id);
    expect(await screen.findByText('Das ist nicht dein Space')).toBeInTheDocument();
    expect(leftover(mockWords())).toEqual([]);
    expect(rawKeys()).toEqual([]);
  });

  it('a missing Space says so in German', async () => {
    await renderManage('s-nope');
    expect(await screen.findByText('Space nicht gefunden')).toBeInTheDocument();
    expect(leftover()).toEqual([]);
  });
});
