import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import LibraryScreen from '../../screens/LibraryScreen';
import LibraryStudioScreen from '../../screens/LibraryStudioScreen';
import { NoteEditor } from '../NoteEditor';
import { noteToItem } from '../../mocks/library';
import { allNotes, noteById, resetNotes } from '../../mocks/notes';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

beforeEach(() => resetNotes());
afterEach(() => resetNotes());

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
    <MemoryRouter>
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

  it('offers exactly one way to write when there is nothing yet', async () => {
    /*
     * `?mock=empty` is how the empty state is reachable — `useLibrary` reads it
     * off the URL, so this drives the real branch rather than a stubbed prop.
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
      await waitFor(() => expect(writeControls().length).toBeGreaterThan(0), { timeout: 3000 });
      const controls = writeControls();
      expect(
        controls.length,
        `${controls.length} controls for one action: ${controls.map((c) => c.textContent?.trim()).join(' / ')}`,
      ).toBe(1);
      // And it is the empty state's invitation, not the toolbar pill.
      expect(controls[0].textContent).toMatch(/write/i);
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

describe('Library Studio only has the screens it has', () => {
  /*
   * `/v4/library/:view` fell through to the impact screen for any unknown
   * value, so a typo rendered "How your work landed" with its real title and
   * real rows. A wrong screen that looks right is worse than an error, because
   * there is nothing to notice — and this route takes a free-text segment.
   */
  const renderStudio = async (view: string) => {
    const r = render(
      <MemoryRouter initialEntries={[`/v4/library/${view}`]}>
        <Routes>
          <Route path="/v4/library/:view" element={<LibraryStudioScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(document.body.textContent).toBeTruthy());
    return r;
  };

  for (const view of ['uploads', 'drafts', 'impact']) {
    it(`renders the ${view} screen`, async () => {
      const { unmount } = await renderStudio(view);
      await waitFor(() =>
        expect(document.body.textContent, `${view} did not render`).not.toMatch(/isn’t here/),
      );
      unmount();
    });
  }

  /*
   * Realistic wrong values: a stale link, a plural, the wrong case, and the
   * string "undefined", which is what a missing variable interpolated into a
   * template URL actually produces. `../uploads` is deliberately not here —
   * the router resolves it before it ever reaches the param, so it tests
   * react-router rather than this screen.
   */
  for (const bogus of ['not-a-real-view', 'impacts', 'Impact', 'undefined']) {
    it(`refuses "${bogus}" instead of quietly showing another screen`, async () => {
      const { unmount } = await renderStudio(bogus);
      await waitFor(() => {
        /*
         * The *heading* is the claim about which screen you are on — checked
         * there rather than across the whole body, because the not-found
         * subtitle deliberately lists the three real screen names to orient
         * someone who has just mistyped one. Matching the body flagged that
         * as the bug it was describing.
         */
        expect(
          screen.getByRole('heading', { level: 1 }).textContent,
          `"${bogus}" rendered a real screen`,
        ).not.toMatch(/How your work landed|Manage uploads|Your drafts/);
        // And none of the three screens' own content is on the page.
        expect(
          document.body.textContent,
          `"${bogus}" leaked a real screen's rows`,
        ).not.toMatch(/published contributions|files across your Spaces|unpublished across/);
        expect(document.body.textContent, `"${bogus}" gave no not-found state`).toMatch(
          /isn’t here/,
        );
      });
      unmount();
    });
  }
});

describe('Library Studio lets you reach the work it lists', () => {
  /*
   * "Your drafts" listed rows reading "Needs review" with nothing to click, so
   * the screen named work waiting on you and offered no way to do it. Uploads
   * were the same, except an `href` to the Lesson was already computed on every
   * material item and simply unused.
   *
   * Impact rows are deliberately exempt: an `ImpactRow` carries no `lessonId`
   * and there is no per-contribution route, so there is nothing to link to yet.
   * Asserted below so the exemption stays a decision rather than an oversight.
   */
  const studio = async (view: string) => {
    const r = render(
      <MemoryRouter initialEntries={[`/v4/library/${view}`]}>
        <Routes>
          <Route path="/v4/library/:view" element={<LibraryStudioScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(document.querySelectorAll('a[href^="/v4/"]').length + 1).toBeGreaterThan(0),
    );
    return r;
  };

  const titleLinks = () =>
    [...document.querySelectorAll('a[href*="/lesson/"]')].map((a) => a.getAttribute('href')!);

  for (const view of ['uploads', 'drafts']) {
    it(`links every ${view} row to its Lesson`, async () => {
      const { unmount } = await studio(view);
      await waitFor(() => {
        const rows = document.querySelectorAll('input[type="checkbox"]').length;
        expect(rows, `${view} rendered no rows, so this proves nothing`).toBeGreaterThan(0);
      });
      const links = titleLinks();
      expect(links.length, `${view} has rows but no way into any of them`).toBeGreaterThan(0);
      for (const href of links) expect(href).toMatch(/^\/v4\/space\/[^/]+\/lesson\/[^/]+$/);
      unmount();
    });
  }

  it('reaches a draft that says it needs review', async () => {
    const { unmount } = await studio('drafts');
    await waitFor(() => expect(document.body.textContent).toMatch(/Needs review|Draft/));
    /*
     * The specific dead end: a row whose pill says "Needs review" cannot be
     * selected — publishing it is not the answer — so a link is the only way
     * it is reachable at all.
     */
    if (/Needs review/.test(document.body.textContent ?? '')) {
      const row = [...document.querySelectorAll('div')].find(
        (d) => /Needs review/.test(d.textContent ?? '') && d.querySelector('a[href*="/lesson/"]'),
      );
      expect(row, 'a "Needs review" draft has no way in').toBeTruthy();
    }
    unmount();
  });

  it('never covers the row with the title link', () => {
    /*
     * A source check, because no render test can catch this: happy-dom has no
     * layout and no hit-testing, so `fireEvent.click` reaches the checkbox
     * however completely a sibling covers it. I wrote the click test below
     * first and it passed with `absolute inset-0 z-10` on the link — a guard
     * that cannot fail for the reason it names.
     *
     * Library's cards legitimately use a row-filling overlay; a Studio row
     * cannot, because it owns a checkbox.
     */
    const src = readFileSync(
      join(process.cwd(), 'src/features/spaces/screens/LibraryStudioScreen.tsx'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    const rowTitle = src.slice(src.indexOf('function RowTitle'));
    const body = rowTitle.slice(0, rowTitle.indexOf('\n}'));
    expect(body, 'the title link covers the row and will eat checkbox clicks').not.toMatch(
      /absolute[^"']*inset-0|inset-0[^"']*absolute/,
    );
  });

  it('keeps selection working', async () => {
    const { unmount } = await studio('uploads');
    await waitFor(() =>
      expect(document.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(0),
    );
    const box = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect((document.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true));
    // And the toolbar noticed, so the row's own handler ran.
    expect(document.body.textContent).toMatch(/1 selected/);
    unmount();
  });

  it('leaves impact rows unlinked, on purpose', async () => {
    const { unmount } = await studio('impact');
    await waitFor(() => expect(document.body.textContent).toMatch(/published contributions/));
    expect(
      titleLinks().length,
      'impact rows gained a Lesson link — if there is now a destination, drop this guard',
    ).toBe(0);
    unmount();
  });
});

describe('a dense list reads down its columns', () => {
  /*
   * The drafts view puts a checkbox only on rows that can be published, and
   * omitting it shifted everything after it left by its width — so the order
   * numbers sat at two different x positions depending on whether a row
   * happened to be publishable. Measured in the browser: 281 vs 299.
   *
   * Asserted structurally rather than by measurement, because happy-dom has no
   * layout: every row must have the same number of leading slots, which is
   * what the reserved spacer provides. Same reasoning as the overlay guard
   * above — where a render test cannot see the property, check the structure
   * that produces it.
   */
  it('gives every drafts row the same leading slots', async () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/v4/library/drafts']}>
        <Routes>
          <Route path="/v4/library/:view" element={<LibraryStudioScreen />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(document.querySelectorAll('a[href*="/lesson/"]').length).toBeGreaterThan(0),
    );

    const rows = [...document.querySelectorAll('a[href*="/lesson/"]')]
      .map((a) => a.closest('div[class*="rounded-xl"]'))
      .filter((r): r is HTMLElement => !!r);

    expect(rows.length, 'no drafts rows found — this guard is vacuous').toBeGreaterThan(1);
    // The list must actually mix selectable and unselectable rows, or the
    // misalignment this guards against could not occur.
    const withBox = rows.filter((r) => r.querySelector('input[type="checkbox"]')).length;
    expect(withBox, 'every row is selectable — no shift is possible').toBeGreaterThan(0);
    expect(withBox, 'no row is unselectable — no shift is possible').toBeLessThan(rows.length);

    const counts = rows.map((r) => r.children.length);
    expect(
      new Set(counts).size,
      `rows have different numbers of columns (${counts.join(', ')}) — the missing checkbox shifts the row`,
    ).toBe(1);
    unmount();
  });
});
