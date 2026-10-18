import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import LibraryScreen from '../../screens/LibraryScreen';
import { NoteEditor } from '../NoteEditor';
import { noteToItem } from '../../mocks/library';
import { allNotes, noteById, resetNotes } from '../../mocks/notes';
import { resetReanchors } from '../../mocks/reanchor';

/**
 * Editing a note must not throw the rest of it away.
 *
 * `noteToItem` gives a Library item a **label** — `n.body.split(/[.:]/)[0]` —
 * so a note reads as one line in a list of mixed objects. That is reasonable
 * for a list. What was not reasonable was handing that label to `NoteEditor`
 * as the note's body: the editor is seeded from `value`, `commit()` sends
 * exactly what the textarea holds, and `LibraryScreen` passed it to
 * `updateNote`. So the first edit of any multi-sentence note replaced the
 * whole body with its own first clause.
 *
 * Two sentences of the seed note `n-1` were reachable this way, and Library is
 * the surface `notes.ts` calls "the one place that is entirely yours".
 *
 * These are render tests rather than source guards on purpose. The bug lived
 * in the *composition* — every part was individually defensible, and a guard
 * reading either file alone would have found nothing to object to.
 */

const MULTI = 'n-1';

beforeEach(() => {
  resetNotes();
  resetReanchors();
});
afterEach(() => {
  resetNotes();
  resetReanchors();
});

/**
 * Renders Library and waits for it to settle.
 *
 * `useSettled` holds every screen on a skeleton for 600ms to make sure the
 * loading state is actually exercised, so a synchronous render sees no notes
 * at all — the first version of these guards failed with "no note is editable"
 * and would have gone on passing after any fix, for the wrong reason.
 */
const renderLibrary = async () => {
  const r = render(
    // Notes live under the shelf's "Your words" filter (One Library §5.7).
    <MemoryRouter initialEntries={['/v4/library?f=words']}>
      <LibraryScreen />
    </MemoryRouter>,
  );
  await waitFor(() => expect(noteOpeners().length).toBeGreaterThan(0), { timeout: 3000 });
  return r;
};

/** Every closed note editor on screen — the closed state is a button. */
const noteOpeners = () =>
  screen
    .queryAllByRole('button')
    .filter((b) => (b.getAttribute('aria-label') ?? '').startsWith('Edit note:'));

describe('a note item carries its whole body', () => {
  it('has a seed note with more than one sentence, or these guards prove nothing', () => {
    const n = noteById(MULTI)!;
    expect(n, `the seed note ${MULTI} is gone — retarget these guards`).toBeTruthy();
    const label = n.body.split(/[.:]/)[0].trim();
    expect(
      label.length,
      'the seed note is a single clause, so truncation would be invisible here',
    ).toBeLessThan(n.body.trim().length);
  });

  it('exposes the full body, not just the label', () => {
    const n = noteById(MULTI)!;
    const item = noteToItem(n);
    expect(item.body, 'the item has no body — the editor can only be given the label').toBe(
      n.body,
    );
    // The label stays a label: still short, still useful in a mixed list.
    expect(item.title.length).toBeLessThan(n.body.length);
  });
});

describe('Library reads a note in full', () => {
  it('shows the whole body, not the first clause', async () => {
    const n = noteById(MULTI)!;
    const tail = n.body.trim().slice(-40);
    await renderLibrary();
    /*
     * The closed editor *is* the reading state — NoteEditor's own comment says
     * collapsing to "Edit this note" would mean "reading your own notes meant
     * opening every one of them". So the tail has to be on screen without any
     * interaction.
     */
    const hits = screen.getAllByText((_t, el) => (el?.textContent ?? '').includes(tail));
    expect(hits.length, `the end of the note is not rendered anywhere: "…${tail}"`)
      .toBeGreaterThan(0);
  });
});

describe('editing a note preserves what you did not edit', () => {
  it('keeps the untouched remainder when you append to a note', async () => {
    const before = noteById(MULTI)!.body;
    const tail = before.trim().slice(-40);

    await renderLibrary();

    const label = before.split(/[.:]/)[0].trim();
    // The note under test, by its own aria-label — not just the first one.
    const opener = noteOpeners().find((b) =>
      (b.getAttribute('aria-label') ?? '').includes(label.slice(0, 24)),
    );
    expect(opener, `note ${MULTI} is not editable in Library`).toBeTruthy();
    fireEvent.click(opener!);

    const box = screen.getByRole('textbox', { name: 'Note' });
    expect(
      (box as HTMLTextAreaElement).value,
      'the editor opened on a truncated body — saving would destroy the rest',
    ).toContain(tail);

    // A real edit: append. This is what makes `commit()` actually save.
    fireEvent.change(box, { target: { value: `${(box as HTMLTextAreaElement).value} Plus one.` } });
    fireEvent.blur(box);

    const after = noteById(MULTI)!.body;
    expect(after, 'appending to a note dropped the text you did not touch').toContain(tail);
    expect(after).toContain('Plus one.');
    expect(after.length).toBeGreaterThan(before.length);
    expect(label.length).toBeLessThan(after.length);
  });

  it('does not save when a note is opened and closed untouched', async () => {
    // The no-op path. It happened to be safe already, because `commit()`
    // compares against `value` — but only because `value` and the stored body
    // were the *same truncated string*. Once the editor is given the real body
    // that comparison is doing real work, so it is worth pinning.
    const before = allNotes().map((n) => `${n.id}:${n.body}:${n.updatedAt}`);
    await renderLibrary();
    fireEvent.click(noteOpeners()[0]);
    fireEvent.blur(screen.getByRole('textbox', { name: 'Note' }));
    expect(allNotes().map((n) => `${n.id}:${n.body}:${n.updatedAt}`)).toEqual(before);
  });

  it('restores the full body on Escape, not the label', () => {
    const before = noteById(MULTI)!.body;
    render(<NoteEditor value={before} onSave={() => undefined} autoOpen />);
    const box = screen.getByRole('textbox', { name: 'Note' });
    fireEvent.change(box, { target: { value: 'scratch that' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    // Reopen and check what it restored.
    fireEvent.click(screen.getByRole('button', { name: /^Edit note:/ }));
    expect((screen.getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement).value).toBe(
      before,
    );
  });
});

describe('Library can always write a note', () => {
  /*
   * Doc 2 rule 5: notes are read *and written* in Library. The action existed
   * only inside the empty state, so it vanished as soon as there was one note
   * — writing your second note meant going and opening a Lesson.
   */
  it('offers a New note action when notes already exist', async () => {
    await renderLibrary();
    expect(noteOpeners().length, 'no notes present, so this proves nothing').toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: /New note/i }),
      'Library has notes and no way to write another',
    ).toBeTruthy();
  });

  it('opens an editor that is not one of the existing notes', async () => {
    await renderLibrary();
    const before = noteOpeners().length;
    fireEvent.click(screen.getByRole('button', { name: /New note/i }));
    // A fresh, empty editor — not an edit of something already written.
    const boxes = screen.getAllByRole('textbox', { name: 'Note' });
    expect(boxes.length, 'New note opened no editor').toBe(1);
    expect((boxes[0] as HTMLTextAreaElement).value).toBe('');
    expect(noteOpeners().length, 'an existing note was consumed').toBe(before);
  });

  it('stores what you write, and leaves the existing notes alone', async () => {
    const before = allNotes().length;
    await renderLibrary();
    fireEvent.click(screen.getByRole('button', { name: /New note/i }));
    const box = screen.getByRole('textbox', { name: 'Note' });
    fireEvent.change(box, { target: { value: 'Written straight into Library.' } });
    fireEvent.blur(box);
    await waitFor(() => expect(allNotes().length).toBe(before + 1));
    expect(allNotes().some((n) => n.body === 'Written straight into Library.')).toBe(true);
  });
});

describe('one action, offered once', () => {
  /*
   * With notes present the toolbar owns "New note". With none, the empty state
   * owns it — and for a while both did, 270px apart, which is the duplication
   * this screen's own comment says was "worth cutting" when it appeared in the
   * Spaces hero and the Home streak chip.
   */
  const writeControls = () =>
    [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')].filter((b) =>
      /new note|write (your first |a )?note/i.test(b.textContent ?? ''),
    );

  it('offers exactly one way to write, with notes present', async () => {
    await renderLibrary();
    const controls = writeControls();
    expect(
      controls.length,
      `${controls.length} controls for one action: ${controls.map((c) => c.textContent?.trim()).join(' / ')}`,
    ).toBe(1);
  });

  it('offers no write control twice when the Library is empty', async () => {
    /*
     * One Library: an empty Library is one calm invitation to bring a file in
     * (spec §5.1), so the old empty state's "Write your first note" moved to
     * Your words' "New note". What still holds is the rule: never the same
     * action twice. `?mock=empty` drives the real branch.
     */
    const url = new URL(window.location.href);
    url.searchParams.set('mock', 'empty');
    window.history.replaceState({}, '', url);
    try {
      render(
        <MemoryRouter>
          <LibraryScreen />
        </MemoryRouter>,
      );
      await waitFor(() => expect(screen.getByText(/Bring in your first file/)).toBeTruthy(), {
        timeout: 3000,
      });
      // Nothing written and nothing brought in: the invitation is the only action, so no write control at all.
      expect(writeControls()).toHaveLength(0);
      expect(screen.getAllByText(/Bring in your first file/)).toHaveLength(1);
    } finally {
      url.searchParams.delete('mock');
      window.history.replaceState({}, '', url);
    }
  });
});

describe('an unfiled note says so', () => {
  it('never invents a Lesson or a Space for it', async () => {
    await renderLibrary();
    fireEvent.click(screen.getByRole('button', { name: /New note/i }));
    const box = screen.getByRole('textbox', { name: 'Note' });
    fireEvent.change(box, { target: { value: 'Belongs to nothing yet.' } });
    fireEvent.blur(box);

    const fresh = await waitFor(() => {
      const n = allNotes().find((x) => x.body === 'Belongs to nothing yet.');
      expect(n).toBeTruthy();
      return n!;
    });

    // The data carries absence, not display copy.
    expect(fresh.lessonTitle, 'an invented Lesson name was stored').toBe('');
    expect(fresh.spaceName, 'display copy was stored in a data field').toBe('');

    /*
     * And the screen names that absence once, in words. The note is newest, so
     * it is what the "Your latest note" cell shows.
     */
    await waitFor(() => {
      expect(
        screen.queryByText(/Unknown Lesson|No Space yet|undefined/),
        'the anchor fields were interpolated raw',
      ).toBeNull();
      expect(screen.getAllByText(/Not filed in a Space yet/).length).toBeGreaterThan(0);
    });
  });
});

describe('Library can re-home an orphan', () => {
  /*
   * The row said "pick a new place for it" and nothing in the product picked
   * one. These drive the real screen, because the interesting part is not the
   * mutation (covered in `mocks/__tests__/reanchor.test.ts`) but whether the
   * control is reachable at all: it sits under the row's `absolute inset-0`
   * link, so it needs `relative z-10` to be clickable, and nothing about that
   * is visible in the mock tests.
   */
  const orphanRow = () =>
    [...document.querySelectorAll('article')].find((a) =>
      /was removed/.test(a.textContent ?? ''),
    );

  const openLibrary = async () => {
    const r = render(
      <MemoryRouter initialEntries={['/v4/library?f=words']}>
        <LibraryScreen />
      </MemoryRouter>,
    );
    await waitFor(() => expect(orphanRow()).toBeTruthy(), { timeout: 3000 });
    return r;
  };

  it('offers the action on an orphan and nowhere else', async () => {
    const { unmount } = await openLibrary();
    const buttons = screen.queryAllByRole('button', { name: /Find it a new home/i });
    expect(buttons.length, 'the orphan has no way to be re-filed').toBe(1);
    // And it lives inside the orphan row, not loose on the screen.
    expect(orphanRow()!.contains(buttons[0]), 'the action is not on the orphan row').toBe(true);
    unmount();
  });

  it('offers the action only on orphan rows', async () => {
    /*
     * "Needs a new home" lists orphans only, so there are no settled rows
     * beside them any more; what must hold is that every move action sits on
     * an orphan, one each.
     */
    const { unmount } = await openLibrary();
    const orphans = [...document.querySelectorAll('article')].filter((a) =>
      /was removed/.test(a.textContent ?? ''),
    );
    const buttons = screen.queryAllByRole('button', { name: /Find it a new home/i });
    expect(buttons.length).toBe(orphans.length);
    for (const b of buttons) {
      expect(orphans.some((o) => o.contains(b)), 'a move action outside an orphan row').toBe(true);
    }
    unmount();
  });

  it('moves it, and the row stops warning', async () => {
    const { unmount } = await openLibrary();
    fireEvent.click(screen.getByRole('button', { name: /Find it a new home/i }));

    const lessons = await screen.findByRole('radiogroup', { name: 'Lessons' });
    const options = within(lessons).getAllByRole('radio');
    expect(options.length, 'no Lessons offered').toBeGreaterThan(0);

    // Confirm is refused until something is chosen.
    const confirm = screen.getByRole('button', { name: /Move it here/i });
    expect((confirm as HTMLButtonElement).disabled, 'can confirm without choosing').toBe(true);

    fireEvent.click(options[0]);
    expect((screen.getByRole('button', { name: /Move it here/i }) as HTMLButtonElement).disabled)
      .toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Move it here/i }));

    await waitFor(() => {
      expect(orphanRow(), 'the row still says the Lesson was removed').toBeFalsy();
      expect(
        screen.queryByRole('button', { name: /Find it a new home/i }),
        'the action is still offered after the move',
      ).toBeNull();
    });
    unmount();
  });
});
