import { beforeEach, describe, expect, it } from 'vitest';
import { addNote, deleteNote, noteById, notesForLesson, resetNotes, updateNote, allNotes } from '../notes';

/**
 * Note guards — Doc 1 "Note: Personal. Anchored to a spot in a Lesson. Only
 * its author sees it." and Doc 2 rule 5, which makes Notes the one Library
 * item read and written in Library directly rather than being a pointer.
 */

beforeEach(() => resetNotes());

describe('Notes', () => {
  it('belongs to its author and nobody else', () => {
    for (const n of allNotes()) expect(n.authorId).toBe('p-viewer');
    expect(addNote({ lessonId: 'l-s-dbs-1', body: 'mine' }).authorId).toBe('p-viewer');
  });

  it('stays readable after its Lesson is gone', () => {
    // Notes are private and appear nowhere else, so losing the anchor must not
    // lose the note. Nothing of yours vanishes silently.
    const n = addNote({ lessonId: 'l-does-not-exist', body: 'orphaned but kept' });
    expect(noteById(n.id)?.body).toBe('orphaned but kept');
  });

  it('refuses to store an empty note', () => {
    expect(() => addNote({ lessonId: 'l-s-dbs-1', body: '   ' })).toThrow();
  });

  it('edits in place without changing identity or anchor', () => {
    const n = addNote({ lessonId: 'l-s-dbs-1', body: 'first' });
    const edited = updateNote(n.id, 'second');
    expect(edited?.id).toBe(n.id);
    expect(edited?.lessonId).toBe(n.lessonId);
    expect(edited?.body).toBe('second');
    expect(noteById(n.id)?.body).toBe('second');
  });

  it('touches updatedAt on edit, so Library can sort by it', () => {
    const n = addNote({ lessonId: 'l-s-dbs-1', body: 'first' });
    const before = n.updatedAt;
    const edited = updateNote(n.id, 'second');
    expect(+new Date(edited!.updatedAt)).toBeGreaterThanOrEqual(+new Date(before));
  });

  it('deletes only the note asked for', () => {
    const a = addNote({ lessonId: 'l-s-dbs-1', body: 'a' });
    const b = addNote({ lessonId: 'l-s-dbs-1', body: 'b' });
    deleteNote(a.id);
    expect(noteById(a.id)).toBeUndefined();
    expect(noteById(b.id)?.body).toBe('b');
  });

  it('finds the notes for one Lesson, newest first', () => {
    const l = 'l-s-dbs-1';
    addNote({ lessonId: l, body: 'older' });
    addNote({ lessonId: l, body: 'newer' });
    const found = notesForLesson(l);
    expect(found.length).toBeGreaterThanOrEqual(2);
    const times = found.map((n) => +new Date(n.updatedAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});
