import * as fixtures from '../mocks/notes';
import type { Note } from '../types';
import { loadLiveRepository } from './liveRepository';
import { liveWorld } from './world';

/**
 * Notes — private writing, anchored to a Lesson, readable and writable.
 *
 * The same synchronous API as the fixture store (`mocks/notes.ts`), so the
 * reader, Lesson and Library call sites do not change. Demo delegates to the
 * fixtures. Live works on the world's notes: every write lands on screen at
 * once and then on the server (`/v4/notes`), which answers with the stored
 * note — its real id, and the Lesson and Space names it keeps for good.
 *
 * A failed write is not silent: the optimistic note is taken back out (or the
 * old body restored), and `notesError()` says so, for the screen to show.
 */

const listeners = new Set<() => void>();
let version = 0;
let lastError: string | null = null;
let counter = 0;

const changed = () => {
  version++;
  listeners.forEach((fn) => fn());
};

const store = (): Note[] => liveWorld()?.notes ?? [];
const setStore = (next: Note[]) => {
  const world = liveWorld();
  if (world) world.notes = next;
};

const byNewest = (a: Note, b: Note) => +new Date(b.updatedAt) - +new Date(a.updatedAt);

export const notesVersion = (): number => (liveWorld() ? version : fixtures.notesVersion());

export const subscribeNotes = (fn: () => void): (() => void) => {
  if (!liveWorld()) return fixtures.subscribeNotes(fn);
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** The last write that did not reach the server, or null. */
export const notesError = (): string | null => lastError;

export const allNotes = (): Note[] => (liveWorld() ? [...store()].sort(byNewest) : fixtures.allNotes());

export const noteById = (id: string): Note | undefined =>
  liveWorld() ? store().find((n) => n.id === id) : fixtures.noteById(id);

export const notesForLesson = (lessonId: string): Note[] =>
  liveWorld() ? allNotes().filter((n) => n.lessonId === lessonId) : fixtures.notesForLesson(lessonId);

export const addNote = (input: {
  lessonId: string;
  body: string;
  lessonTitle?: string;
  spaceId?: string;
  spaceName?: string;
}): Note => {
  const world = liveWorld();
  if (!world) return fixtures.addNote(input);
  if (!input.body.trim()) throw new Error('A note needs something in it.');
  const draft: Note = {
    id: `n-pending-${++counter}`,
    authorId: world.viewer.id,
    body: input.body.trim(),
    lessonId: input.lessonId,
    lessonTitle: input.lessonTitle ?? '',
    spaceId: input.spaceId ?? '',
    spaceName: input.spaceName ?? '',
    updatedAt: new Date().toISOString(),
  };
  setStore([draft, ...store()]);
  lastError = null;
  changed();
  void loadLiveRepository()
    .then((repo) => repo.addNote(draft.body, draft.lessonId || null))
    .then((saved) => {
      setStore(store().map((n) => (n.id === draft.id ? saved : n)));
      changed();
    })
    .catch(() => {
      setStore(store().filter((n) => n.id !== draft.id));
      lastError = 'That note could not be saved, so it is not here. Write it again in a moment.';
      changed();
    });
  return draft;
};

/** Edits in place: same id, same anchor, new body and timestamp. */
export const updateNote = (id: string, body: string): Note | undefined => {
  if (!liveWorld()) return fixtures.updateNote(id, body);
  const before = store().find((n) => n.id === id);
  if (!before) return undefined;
  if (!body.trim()) return before;
  const after = { ...before, body: body.trim(), updatedAt: new Date().toISOString() };
  setStore(store().map((n) => (n.id === id ? after : n)));
  lastError = null;
  changed();
  void loadLiveRepository()
    .then((repo) => repo.updateNote(id, after.body))
    .catch(() => {
      setStore(store().map((n) => (n.id === id ? before : n)));
      lastError = 'That edit could not be saved, so the note is back as it was.';
      changed();
    });
  return after;
};

export const deleteNote = (id: string): void => {
  if (!liveWorld()) return fixtures.deleteNote(id);
  const before = store();
  setStore(before.filter((n) => n.id !== id));
  lastError = null;
  changed();
  void loadLiveRepository()
    .then((repo) => repo.deleteNote(id))
    .catch(() => {
      setStore(before);
      lastError = 'That note could not be deleted, so it is still here.';
      changed();
    });
};
