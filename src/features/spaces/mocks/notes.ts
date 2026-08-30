import type { Note } from '../types';
import { notes as seed } from './library';
import { viewer } from './people';

/**
 * Notes, writable.
 *
 * Doc 2 rule 5 makes Notes the exception in Library: everything else there is
 * a pointer into its Space, but "Notes are read and written in Library
 * directly. A Note is private, appears nowhere else, and is the object you are
 * most likely to want across Spaces at once."
 *
 * So this is the one mock with real mutation. It stays behind
 * `data/useSpaces.ts` like everything else — wiring later replaces these
 * bodies, not the call sites.
 */

let store: Note[] = seed.map((n) => ({ ...n, authorId: viewer.id }));
let counter = 0;

/** Test seam — the fixtures are mutable, so each test starts from the seed. */
export const resetNotes = (): void => {
  store = seed.map((n) => ({ ...n, authorId: viewer.id }));
  counter = 0;
};

export const allNotes = (): Note[] =>
  [...store].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));

export const noteById = (id: string): Note | undefined => store.find((n) => n.id === id);

export const notesForLesson = (lessonId: string): Note[] =>
  allNotes().filter((n) => n.lessonId === lessonId);

/**
 * Write a note.
 *
 * The Lesson id is stored, not resolved — a note outlives its anchor. If the
 * Lesson is deleted the note stays readable, because losing the anchor must
 * not lose the writing. Empty notes are refused: a blank note is an accident,
 * and silently storing one leaves rubbish in the one place that is entirely
 * yours.
 */
export const addNote = ({
  lessonId,
  body,
  lessonTitle = 'Unknown Lesson',
  spaceId = '',
  spaceName = '',
}: {
  lessonId: string;
  body: string;
  lessonTitle?: string;
  spaceId?: string;
  spaceName?: string;
}): Note => {
  if (!body.trim()) throw new Error('A note needs something in it.');
  const note: Note = {
    id: `n-new-${++counter}`,
    authorId: viewer.id,
    body: body.trim(),
    lessonId,
    lessonTitle,
    spaceId,
    spaceName,
    updatedAt: new Date().toISOString(),
  };
  store = [note, ...store];
  return note;
};

/** Edits in place: same id, same anchor, new body and timestamp. */
export const updateNote = (id: string, body: string): Note | undefined => {
  const i = store.findIndex((n) => n.id === id);
  if (i === -1) return undefined;
  if (!body.trim()) return store[i];
  store[i] = { ...store[i], body: body.trim(), updatedAt: new Date().toISOString() };
  return store[i];
};

export const deleteNote = (id: string): void => {
  store = store.filter((n) => n.id !== id);
};
