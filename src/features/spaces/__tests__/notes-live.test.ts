import { afterEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({
  addNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
}));
vi.mock('../data/liveRepository', async (orig) => ({
  ...(await orig<typeof import('../data/liveRepository')>()),
  loadLiveRepository: async () => repo,
}));

import * as notes from '../data/notes';
import * as fixtureNotes from '../mocks/notes';
import { setLiveWorld } from '../data/world';
import { emptyWorld } from './emptyWorld';

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  setLiveWorld(null);
  fixtureNotes.resetNotes();
  vi.clearAllMocks();
});

describe('notes, live', () => {
  it('demo is the fixture store', () => {
    expect(notes.allNotes()).toEqual(fixtureNotes.allNotes());
  });

  it('a new note shows at once, then takes the stored note the server answers with', async () => {
    setLiveWorld(emptyWorld());
    repo.addNote.mockResolvedValue({
      id: 'n-1', authorId: 'u', body: '3NF', lessonId: 'l1', lessonTitle: 'Normalization',
      spaceId: 'c1', spaceName: 'Datenbanksysteme', updatedAt: '2026-10-13T10:00:00Z',
    });
    const heard = vi.fn();
    const off = notes.subscribeNotes(heard);
    notes.addNote({ lessonId: 'l1', body: '  3NF ' });
    expect(notes.notesForLesson('l1').map((n) => n.body)).toEqual(['3NF']);
    await flush();
    expect(repo.addNote).toHaveBeenCalledWith('3NF', 'l1');
    expect(notes.notesForLesson('l1')[0].id).toBe('n-1');
    expect(heard).toHaveBeenCalledTimes(2);
    off();
  });

  it('a failed save is taken back and said out loud', async () => {
    setLiveWorld(emptyWorld());
    repo.addNote.mockRejectedValue(new Error('500'));
    notes.addNote({ lessonId: 'l1', body: 'lost?' });
    await flush();
    expect(notes.allNotes()).toEqual([]);
    expect(notes.notesError()).toMatch(/could not be saved/);
  });

  it('a failed edit restores the old words', async () => {
    const note = { id: 'n-1', authorId: 'u', body: 'old', lessonId: 'l1', lessonTitle: '', spaceId: '', spaceName: '', updatedAt: '2026-10-01T00:00:00Z' };
    setLiveWorld(emptyWorld({ notes: [note] }));
    repo.updateNote.mockRejectedValue(new Error('500'));
    expect(notes.updateNote('n-1', 'new')?.body).toBe('new');
    await flush();
    expect(notes.noteById('n-1')?.body).toBe('old');
  });

  it('delete is immediate and reaches the server', async () => {
    const note = { id: 'n-1', authorId: 'u', body: 'x', lessonId: '', lessonTitle: '', spaceId: '', spaceName: '', updatedAt: '2026-10-01T00:00:00Z' };
    setLiveWorld(emptyWorld({ notes: [note] }));
    repo.deleteNote.mockResolvedValue({ deleted: true });
    notes.deleteNote('n-1');
    expect(notes.allNotes()).toEqual([]);
    await flush();
    expect(repo.deleteNote).toHaveBeenCalledWith('n-1');
  });
});
