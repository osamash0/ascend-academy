import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ReaderRail } from '../reader/ReaderRail';
import ReaderScreen from '../../screens/ReaderScreen';
import { allNotes, notesForLesson, resetNotes } from '../../mocks/notes';
import { readSource } from './sources';

/**
 * The rail, and the rule it exists to keep.
 *
 * *Summoned, never squatting.* Two halves, and both are asserted here because
 * only one of them is visible: the rail must leave no trace in the document
 * when it is closed, and the article column must be the same column with it
 * open. A rail that merely slid off-screen would pass a screenshot and fail a
 * keyboard — it would still be in the accessibility tree and still take a Tab
 * — so "absent" is checked against the tree, not against a transform.
 *
 * The focus contract is tested down all three exits on purpose. It is the part
 * most easily written to work for the one path the author happened to try:
 * Escape, the close button, and pressing the header toggle a second time are
 * three different callers of the same close, and a return that only survives
 * one of them is a return that will be found by a keyboard user rather than by
 * a test.
 */

const LESSON = 'l-s-dbs-4';

const mountRail = (over: Partial<React.ComponentProps<typeof ReaderRail>> = {}) =>
  render(
    <ReaderRail
      open
      tab="notes"
      onTabChange={() => {}}
      onClose={() => {}}
      tutor={<p>tutor panel</p>}
      notes={<p>notes panel</p>}
      {...over}
    />,
  );

describe('the rail is chrome around panels it does not own', () => {
  it('is a landmark with a name', () => {
    // `<aside>` alone is an unnamed region — one of several on a page, and
    // indistinguishable from the others in a landmark list.
    mountRail();
    expect(screen.getByRole('complementary', { name: 'Reader companions' })).toBeTruthy();
  });

  it('shows the panel it was asked for, and not the other one', () => {
    mountRail({ tab: 'notes' });
    expect(screen.getByText('notes panel')).toBeTruthy();
    expect(screen.queryByText('tutor panel')).toBeNull();
  });

  it('reports the tab that was pressed rather than switching itself', () => {
    // Which companion is out is screen state — the same state the header's
    // two buttons write. A rail holding its own copy would let the two
    // disagree about what is showing.
    const onTabChange = vi.fn();
    mountRail({ tab: 'notes', onTabChange });
    fireEvent.click(screen.getByRole('tab', { name: 'Tutor' }));
    expect(onTabChange).toHaveBeenCalledWith('tutor');
  });

  it('says which tab is showing', () => {
    mountRail({ tab: 'tutor' });
    const tabs = screen.getByRole('tablist', { name: 'Companions' });
    expect(within(tabs).getByRole('tab', { name: 'Tutor' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(within(tabs).getByRole('tab', { name: 'Notes' }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  it('leaves nothing in the document when it is closed', () => {
    /*
     * The whole of RULING F3 in one assertion. "Fully translated off" was the
     * other option and is not equivalent: a rail parked at `translateX(100%)`
     * is still focusable, still announced, and still between the article and
     * the end of the tab order.
     */
    const { container } = mountRail({ open: false });
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    mountRail({ onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('leaves Escape to a field that is already using it', () => {
    /*
     * `NoteEditor` cancels an edit with Escape. One key must not both throw
     * away what you were writing and take the panel away — the second press,
     * with the editor closed, is the one that closes the rail.
     */
    const onClose = vi.fn();
    mountRail({ notes: <textarea data-testid="field" /> });
    fireEvent.keyDown(screen.getByTestId('field'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops listening for Escape once it is gone', () => {
    // A document-level listener that outlives its component is a rail that
    // closes something that is not there, on a screen it no longer belongs to.
    const onClose = vi.fn();
    const { unmount } = mountRail({ onClose });
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

/* ── The rail on the screen that summons it ──────────────────────── */

const renderReader = async (lessonId = LESSON) => {
  const r = render(
    <MemoryRouter initialEntries={[`/v4/space/s-dbs/lesson/${lessonId}/read`]}>
      <Routes>
        <Route path="/v4/space/:spaceId/lesson/:lessonId/read" element={<ReaderScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  // Every screen holds a skeleton for 600ms so the loading state is real.
  await waitFor(() => expect(screen.getByRole('banner')).toBeTruthy(), { timeout: 3000 });
  return r;
};

/**
 * Press a header button the way a pointer does.
 *
 * `fireEvent.click` does not focus what it clicks, and the focus return reads
 * `document.activeElement` at the moment the rail opens — so a plain click
 * would leave the rail with nothing to hand focus back to and the assertion
 * would be testing the test harness. A real browser focuses on mousedown.
 */
const press = (name: string) => {
  const btn = screen.getByRole('button', { name });
  btn.focus();
  fireEvent.click(btn);
  return btn;
};

beforeEach(resetNotes);

describe('the column is the same column, open or closed', () => {
  it('never changes a class on the article itself', async () => {
    /*
     * The "summoned, never squatting" guard, and the reason the shift lives on
     * a wrapper. Byte-identical, not merely "still contains max-w-2xl": a rail
     * that narrowed the measure to make room would keep that substring while
     * taking exactly the thing the reader was built around.
     */
    const { container } = await renderReader();
    const closed = container.querySelector('article')!.className;
    const measures = [...container.querySelectorAll('article section p')].map((p) => p.className);

    press('Notes');
    const open = container.querySelector('article')!.className;

    expect(open).toBe(closed);
    expect([...container.querySelectorAll('article section p')].map((p) => p.className)).toEqual(
      measures,
    );
    expect(open).toContain('max-w-2xl');
    expect(measures[0]).toContain('max-w-[52ch]');
  });

  it('shifts a wrapper instead, and only where there is room for one', async () => {
    /*
     * The dock is a media query at 900px, so it cannot be observed in a DOM
     * with no layout. What is checkable here is that the moving part is *not*
     * the article — the wrapper carries the transform, the article's ancestors
     * change, its own class list does not — and that the shift is gone again
     * when the rail is.
     */
    const { container } = await renderReader();
    const shifted = () => container.querySelector('[class*="translate-x-"]');
    expect(shifted()).toBeNull();

    press('Notes');
    const wrapper = shifted();
    expect(wrapper, 'nothing steps aside for the rail').not.toBeNull();
    expect(wrapper!.tagName).not.toBe('ARTICLE');
    expect(wrapper!.className).toContain('min-width:900px');

    press('Notes');
    expect(shifted()).toBeNull();
  });

  /*
   * The clamp is a number derived from Tailwind classes on a different
   * element, and nothing connected the two. That is how the Source view ended
   * up shifted past its own left edge: the constant was derived from the
   * article, applied to a wrapper that also carries the 760px page card, and
   * measured only at 1440px — the one width where the bug does not show. At
   * 1024 the card sat at -60 and its first characters were not merely
   * off-screen but unreachable, because content left of the origin creates no
   * scroll area.
   *
   * jsdom has no layout, so the shift itself cannot be observed. What *can* be
   * checked is the derivation — that the number in the clamp is still the
   * number the classes imply. Both halves are pinned, because the previous
   * guard pinned `max-w-2xl` and not `px-6`, and a padding change would have
   * de-tuned the clamp with every test green.
   */
  /** Tailwind's scale, for the two classes the clamps are derived from. */
  const PX = { 'max-w-2xl': 672, 'max-w-[860px]': 860, 'px-6': 24 };

  const clampEdge = (el: Element | null) =>
    Number(el?.className.match(/100%_-_(\d+)px/)?.[1] ?? NaN);

  /** The content box of a column — where its first character actually sits. */
  const contentBox = (maxW: keyof typeof PX) => PX[maxW] - 2 * PX['px-6'];

  it('clamps the Read view to the first character of the article', async () => {
    const { container } = await renderReader();
    press('Notes');
    const article = container.querySelector('article')!;
    expect(article.className).toContain('max-w-2xl');
    expect(article.className).toContain('px-6');
    expect(clampEdge(container.querySelector('[class*="translate-x-"]'))).toBe(
      contentBox('max-w-2xl'),
    );
  });

  it('writes both clamps as literals Tailwind can actually find', () => {
    /*
     * The one failure in this file that no rendered assertion can see, and the
     * worse of the two it has had.
     *
     * The clamps were briefly built by a helper — `dockShift(edge)`, one
     * template literal instead of two near-identical strings. Tailwind scans
     * source *text* for class names, so a class assembled at runtime is never
     * generated. Both wrappers carried a class that did not exist: the DOM
     * class lists were exactly right, `getComputedStyle` said
     * `transform: none`, and the dock silently did not happen at all.
     *
     * The two tests below stayed green through it, and so did the other 24 —
     * they compare class strings, and there is no stylesheet behind jsdom to
     * disagree with. Only a browser saw it, and only because someone looked.
     * So this asserts against the source text, which is the one place the
     * difference between "a class" and "a class Tailwind emits" is visible
     * without a build.
     */
    const src = readSource('screens/ReaderScreen.tsx');
    for (const edge of [624, 812]) {
      expect(
        src,
        `the ${edge}px clamp is assembled rather than written out — Tailwind will not emit it`,
      ).toContain(`[@media(min-width:900px)]:translate-x-[calc(-1*min(192px,(100%_-_${edge}px)/2))]`);
    }
  });

  it('clamps the Source view to its whole column, not to the page card', async () => {
    /*
     * The column, because the column is the wider thing. Clamping to the card
     * (760) puts the card at exactly 0 and the heading above it — which runs
     * the full column width — at -26. It reads as correct in the place the eye
     * goes first, which is what made it worth a test rather than a comment.
     */
    const { container } = await renderReader();
    fireEvent.click(screen.getByRole('tab', { name: 'Source' }));
    press('Notes');
    const column = container.querySelector('[data-source-column]');
    expect(column, 'no Source column to clamp to').not.toBeNull();
    expect(column!.className).toContain('max-w-[860px]');
    expect(column!.className).toContain('px-6');
    expect(clampEdge(container.querySelector('[class*="translate-x-"]'))).toBe(
      contentBox('max-w-[860px]'),
    );
  });
});

describe('the rail comes and goes with the header buttons', () => {
  it('is not in the document until it is asked for', async () => {
    await renderReader();
    expect(screen.queryByRole('complementary', { name: 'Reader companions' })).toBeNull();
  });

  it('opens on the tab that summoned it', async () => {
    await renderReader();
    press('Tutor');
    const rail = screen.getByRole('complementary', { name: 'Reader companions' });
    expect(within(rail).getByRole('tab', { name: 'Tutor' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('swaps panels from inside the rail, and the header agrees', async () => {
    await renderReader();
    press('Tutor');
    const rail = screen.getByRole('complementary', { name: 'Reader companions' });
    fireEvent.click(within(rail).getByRole('tab', { name: 'Notes' }));
    expect(within(rail).getByRole('tab', { name: 'Notes' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    // The header's two buttons are the same state, seen from outside.
    expect(screen.getByRole('button', { name: 'Notes' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Tutor' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('goes away entirely on Escape', async () => {
    await renderReader();
    press('Notes');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'Reader companions' })).toBeNull();
  });

  it('is summoned on a Lesson that has no text to read', async () => {
    // Notes on an unwritten Lesson are exactly the notes somebody would want.
    await renderReader('l-s-dbs-3');
    expect(screen.getByText('Not written yet')).toBeTruthy();
    press('Notes');
    expect(screen.getByRole('complementary', { name: 'Reader companions' })).toBeTruthy();
  });
});

describe('focus goes in, and comes back the way it went', () => {
  it('moves into the rail when it opens', async () => {
    await renderReader();
    press('Notes');
    const rail = screen.getByRole('complementary', { name: 'Reader companions' });
    expect(rail.contains(document.activeElement)).toBe(true);
  });

  it('returns to the button that opened it — closed with Escape', async () => {
    await renderReader();
    const opener = press('Notes');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
  });

  it('returns to the button that opened it — closed from the rail', async () => {
    await renderReader();
    const opener = press('Tutor');
    fireEvent.click(screen.getByRole('button', { name: 'Close companions' }));
    expect(document.activeElement).toBe(opener);
  });

  it('returns to the button that opened it — closed by pressing it again', async () => {
    /*
     * The path most likely to be missed, and the one where getting it wrong is
     * invisible: the button already has focus, so a return that never fires
     * looks exactly like a return that did.
     */
    await renderReader();
    const opener = press('Notes');
    fireEvent.click(opener);
    expect(screen.queryByRole('complementary', { name: 'Reader companions' })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('a panel beside the page and a panel over it are different things', () => {
  /**
   * Which side of `sm` the window is on.
   *
   * `src/test/setup.ts` stubs `matchMedia` with `matches: false` for every
   * query, so the *narrow* branch is what a test gets for free and the wide
   * one only ever runs if somebody asks for it. Both halves are driven here on
   * purpose: a responsive rule verified on one side of its breakpoint is the
   * shape of finding this branch has already had three times (F8, B1, C3).
   */
  const atWidth = (wide: boolean) => {
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query.includes('min-width: 640px') ? wide : false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    return () => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: original,
      });
    };
  };

  /*
   * `inert` is asserted as an attribute rather than as behaviour, and the
   * limit is stated rather than glossed: happy-dom does not implement inertness
   * — it will not take an inert subtree out of the tab order — so a test that
   * tabbed around would report success no matter what. What is checkable here
   * is that the attribute lands on the two nodes the rail covers and on
   * neither the header nor anything else. That it *works* was measured in a
   * browser at 375px: `elementFromPoint` at both pager cards returns a rail
   * descendant, and after the fix `.focus()` on either leaves
   * `document.activeElement` unchanged while all five header controls still
   * take focus.
   */
  const inertNodes = (container: HTMLElement) => [...container.querySelectorAll('[inert]')];

  it('takes the page out of reach when the companion covers all of it', async () => {
    const restore = atWidth(false);
    try {
      const { container } = await renderReader();
      expect(inertNodes(container), 'inert before anything was summoned').toHaveLength(0);

      press('Tutor');
      const inert = inertNodes(container);
      expect(inert.length, 'the covered page is still reachable').toBeGreaterThan(0);
      expect(
        inert.some((n) => n.querySelector('article')),
        'the column behind the panel is not the thing taken out of reach',
      ).toBe(true);
      /*
       * The pager is fixed chrome outside the wrapper, so it is the half a
       * partial fix would miss — and it is exactly the half the browser
       * measurement found sitting behind the panel and still tabbable.
       */
      expect(
        inert.some((n) => n.textContent?.includes('Lesson 3')),
        'the pager is not covered by the rule',
      ).toBe(true);
    } finally {
      restore();
    }
  });

  it('leaves the header alone, because the way out lives there', async () => {
    /*
     * The header is `z-40` above a rail that starts at `top-14`, so it is
     * visible at 375px and it carries the exit *and* the two toggles — and
     * re-pressing a toggle is one of the three documented ways to close the
     * rail. A focus trap, or inerting everything, would strand that path and
     * take the way out away from a keyboard user: a worse bug than the one
     * this rule fixes.
     */
    const restore = atWidth(false);
    try {
      const { container } = await renderReader();
      press('Tutor');
      expect(container.querySelector('header[inert]'), 'the way out went inert').toBeNull();
      expect(
        inertNodes(container).some((n) => n.querySelector('header')),
        'the header is inside something inert',
      ).toBe(false);
      expect(screen.getByRole('link', { name: 'Leave the reader' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Tutor' })).toBeTruthy();
    } finally {
      restore();
    }
  });

  it('leaves the page alone where the companion sits beside it', async () => {
    /*
     * The other half, and the reason the rule is not simply "inert whenever
     * the rail is open". Between 640 and 900 the panel overlays a column that
     * is still readable, and at 900 and up it does not overlay at all — in
     * both the article is the thing being read and selecting a sentence in it
     * is the ordinary case. Making it inert there would delete
     * selection-to-ask outright.
     */
    const restore = atWidth(true);
    try {
      const { container } = await renderReader();
      press('Tutor');
      expect(screen.getByRole('complementary', { name: 'Reader companions' })).toBeTruthy();
      expect(inertNodes(container), 'the docked reader was taken out of reach').toHaveLength(0);
    } finally {
      restore();
    }
  });

  it('gives the page back when the companion goes', async () => {
    const restore = atWidth(false);
    try {
      const { container } = await renderReader();
      const opener = press('Notes');
      expect(inertNodes(container).length).toBeGreaterThan(0);
      fireEvent.click(opener);
      expect(inertNodes(container), 'the reader stayed inert after the panel left').toHaveLength(
        0,
      );
    } finally {
      restore();
    }
  });

  it('never writes the attribute as a word', () => {
    /*
     * `inert` is a boolean attribute: `inert="false"` is *present*, and
     * therefore true. Spelling it `inert={covering}` would make the reader
     * permanently unreachable while every rendered assertion above went on
     * passing, because `[inert]` matches either spelling. React 18's typings
     * predate the attribute, so nothing in the compiler catches it either.
     */
    const screenSource = readSource('screens/ReaderScreen.tsx');
    expect(screenSource, 'inert is being passed a boolean').not.toMatch(/inert=\{/);
    expect(screenSource, "inert is not written as a present-or-absent attribute").toMatch(
      /inert: ''/,
    );
  });
});

describe('notes are written from the rail', () => {
  const openNotes = async () => {
    await renderReader();
    press('Notes');
    return screen.getByRole('complementary', { name: 'Reader companions' });
  };

  it('lists the Lesson’s existing notes', async () => {
    const seeded = notesForLesson(LESSON);
    expect(seeded.length, 'no seeded note on the fixture').toBeGreaterThan(0);
    const rail = await openNotes();
    for (const n of seeded) expect(within(rail).getByText(n.body)).toBeTruthy();
  });

  it('offers the composer with the established promise on it', async () => {
    const rail = await openNotes();
    fireEvent.click(within(rail).getByRole('button', { name: 'Write a note' }));
    expect(
      within(rail).getByPlaceholderText('Private to you, and gathered in your Library.'),
    ).toBeTruthy();
  });

  it('writes to the store and to the list, without a reload', async () => {
    /*
     * Both halves matter. The note store lives outside React, so a rail that
     * saved correctly and never re-read would look broken until you navigated
     * away and back — which is the bug the `noteTick` pattern exists to
     * prevent, and it is invisible unless the list is asserted too.
     */
    const before = allNotes().length;
    const rail = await openNotes();
    fireEvent.click(within(rail).getByRole('button', { name: 'Write a note' }));
    const field = within(rail).getByPlaceholderText(
      'Private to you, and gathered in your Library.',
    );
    fireEvent.change(field, { target: { value: 'BCNF is 3NF with no exceptions.' } });
    fireEvent.blur(field);

    expect(allNotes().length).toBe(before + 1);
    expect(allNotes()[0].body).toBe('BCNF is 3NF with no exceptions.');
    expect(allNotes()[0].lessonId).toBe(LESSON);
    expect(within(rail).getByText('BCNF is 3NF with no exceptions.')).toBeTruthy();
  });

  it('anchors what it writes to the Lesson it was written on', async () => {
    // A note outlives its anchor, so the anchor has to be stored rather than
    // resolved later — and an unanchored note reads as "No Space yet".
    const rail = await openNotes();
    fireEvent.click(within(rail).getByRole('button', { name: 'Write a note' }));
    const field = within(rail).getByPlaceholderText(
      'Private to you, and gathered in your Library.',
    );
    fireEvent.change(field, { target: { value: 'A dependency on part of a key.' } });
    fireEvent.blur(field);
    const written = allNotes()[0];
    expect(written.spaceId).toBe('s-dbs');
    expect(written.lessonTitle).toBe('Normalization');
    expect(written.spaceName.length).toBeGreaterThan(0);
  });

  it('says what is not there yet, when nothing is', async () => {
    await renderReader('l-s-dbs-3');
    press('Notes');
    const rail = screen.getByRole('complementary', { name: 'Reader companions' });
    expect(notesForLesson('l-s-dbs-3')).toHaveLength(0);
    expect(
      within(rail).getByText('Nothing yet. Notes are private, and only you ever see them.'),
    ).toBeTruthy();
  });
});
