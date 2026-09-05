import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ReaderScreen from '../../screens/ReaderScreen';
import { MIN_SELECTION } from '../reader/SelectionAsk';
import { allNotes, resetNotes } from '../../mocks/notes';
import { askTutor } from '../../mocks/tutor';
import { readSource } from './sources';

/**
 * Starting a question from the text.
 *
 * Driven end to end on the reader rather than against the component, because
 * every interesting thing about this popover is a relationship with something
 * else on the screen: which element the selection came from, which panel it
 * opens, whose Escape wins. A component test would have to hand it an article,
 * a rail and a note store, at which point it is the screen test with more
 * setup and fewer guarantees.
 *
 * The rectangle is the one thing that cannot be checked here — the suite runs
 * on happy-dom (`vitest.config.ts`), which has no layout, so every
 * `getBoundingClientRect` is zeros and the clamp has nothing to clamp. That
 * half was measured in a browser at four widths and against all four edges;
 * the report says what came back. What is checkable here is everything about
 * *when* the popover exists, *what* it carries, and where that lands.
 */

const SPACE = 's-dbs';
const WRITTEN = 'l-s-dbs-4';

const ASK = 'Ask the tutor';
const SAVE = 'Save as note';
const RAIL = { name: 'Reader companions' } as const;

const renderReader = async (lessonId = WRITTEN) => {
  const r = render(
    <MemoryRouter initialEntries={[`/v4/space/${SPACE}/lesson/${lessonId}/read`]}>
      <Routes>
        <Route path="/v4/space/:spaceId/lesson/:lessonId/read" element={<ReaderScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  // Every screen holds a skeleton for 600ms so the loading state is real.
  await waitFor(() => expect(screen.getByRole('banner')).toBeTruthy(), { timeout: 3000 });
  /*
   * And then wait for the *effects* of that commit, not only its DOM.
   *
   * `SelectionAsk` registers its `selectionchange` listener in a passive
   * effect. `waitFor` resolves on the mutation that put the header on screen,
   * and the passive effects of that same commit are flushed by React's
   * scheduler afterwards — so there is a window in which the reader is fully
   * rendered and nothing is listening for a selection yet. Selecting inside it
   * dispatches the event at no one, and because the selection does not change
   * again, no later event recovers it: the popover simply never appears.
   *
   * That window is the whole of the intermittent recorded as D1. Traced: the
   * event fires with `rangeCount 1`, uncollapsed, 357 characters, inside the
   * article — and the popover is absent from the DOM at the end of the `act`.
   * Re-selecting the identical range after a flush shows it immediately, which
   * is what names the listener rather than the selection as the missing half.
   * Nothing is wrong with the component: in a browser the flush follows paint
   * by a frame and no hand is that fast.
   */
  await act(async () => {});
  return r;
};

/**
 * Make a selection the way a drag does.
 *
 * happy-dom fires `selectionchange` synchronously from `addRange`
 * (`selection/Selection.js`, `#associateRange`), so the whole thing goes
 * inside `act` — otherwise React applies the state update outside a batch and
 * warns, and the assertion runs against the pre-render tree.
 *
 * The engine matters and this comment used to name the wrong one. jsdom
 * queues `selectionchange` as a task; happy-dom dispatches it inline, and it
 * is happy-dom the suite runs on. A reader chasing the D1 intermittent lost an
 * hour to the difference, because the jsdom behaviour would have explained it
 * and the real behaviour does not.
 */
const selectRange = (start: Node, startOffset: number, end: Node, endOffset: number) => {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  const sel = document.getSelection()!;
  act(() => {
    sel.removeAllRanges();
    sel.addRange(range);
  });
  return sel.toString().replace(/\s+/g, ' ').trim();
};

const clearSelection = () =>
  act(() => {
    document.getSelection()!.removeAllRanges();
  });

/** The first two paragraphs of the first passage — a real cross-paragraph drag. */
const twoParagraphs = (container: HTMLElement) => {
  const paras = container.querySelectorAll('article section p');
  expect(paras.length, 'the fixture has no prose to select').toBeGreaterThan(1);
  return selectRange(paras[0].firstChild!, 0, paras[1].firstChild!, 40);
};

const popover = () => screen.queryByRole('group', { name: 'What to do with the selected sentence' });

beforeEach(() => {
  resetNotes();
  clearSelection();
});

describe('the popover follows the selection, and only inside the prose', () => {
  it('appears for a selection that spans two paragraphs', async () => {
    const { container } = await renderReader();
    expect(popover(), 'a popover with nothing selected').toBeNull();

    const quote = twoParagraphs(container);
    expect(quote.length).toBeGreaterThan(MIN_SELECTION);
    expect(popover()).not.toBeNull();
    expect(screen.getByRole('button', { name: ASK })).toBeTruthy();
    expect(screen.getByRole('button', { name: SAVE })).toBeTruthy();
  });

  it('ignores a selection too short to be a question', async () => {
    /*
     * A double-click on one short word is the accident this floor exists for.
     * Seven characters, one below the minimum — the boundary rather than a
     * comfortable two letters, because an off-by-one in the comparison is
     * exactly the mutation a lenient test would not catch.
     */
    const { container } = await renderReader();
    const para = container.querySelector('article section p')!;
    const short = selectRange(para.firstChild!, 0, para.firstChild!, MIN_SELECTION - 1);
    expect(short).toHaveLength(MIN_SELECTION - 1);
    expect(popover()).toBeNull();
  });

  it('appears at exactly the minimum', async () => {
    // The other side of the same boundary, so "never shows" cannot pass both.
    const { container } = await renderReader();
    const para = container.querySelector('article section p')!;
    expect(selectRange(para.firstChild!, 0, para.firstChild!, MIN_SELECTION)).toHaveLength(
      MIN_SELECTION,
    );
    expect(popover()).not.toBeNull();
  });

  it('ignores a selection made outside the article', async () => {
    /*
     * The rail holds a tutor thread and a note editor, both full of selectable
     * text, and selecting there is somebody copying what they wrote — not
     * asking about the Lesson. The header is the same story with a breadcrumb.
     */
    await renderReader();
    const btn = screen.getByRole('button', { name: 'Tutor' });
    btn.focus();
    fireEvent.click(btn);
    const rail = screen.getByRole('complementary', RAIL);
    const line = within(rail).getByText(/Ask about anything in this Lesson/);

    const quote = selectRange(line.firstChild!, 0, line.firstChild!, 30);
    expect(quote.length).toBeGreaterThan(MIN_SELECTION);
    expect(popover(), 'a selection in the rail summoned the popover').toBeNull();
  });

  it('ignores a selection that runs from the chrome into the prose', async () => {
    /*
     * The reason the check is `contains(commonAncestorContainer)` rather than
     * "does either end sit inside": a drag that begins on the breadcrumb and
     * ends in the first paragraph has its common ancestor above the article,
     * and half the quote would be chrome. Anything wholly inside the article —
     * the practice link and the pager included — is still fair game, which is
     * why this reaches for the header rather than for them.
     */
    const { container } = await renderReader();
    const breadcrumb = container.querySelector('header span.sr-only')!;
    const para = container.querySelector('article section p')!;
    const spill = selectRange(breadcrumb.firstChild!, 0, para.firstChild!, 40);
    expect(spill.length).toBeGreaterThan(MIN_SELECTION);
    expect(popover(), 'a selection running out of the article summoned the popover').toBeNull();
  });

  it('is not offered on a Lesson with no prose to select', async () => {
    // There is no article at all there, so there is nothing to scope to.
    await renderReader('l-s-dbs-3');
    expect(screen.getByText('Not written yet')).toBeTruthy();
    expect(popover()).toBeNull();
  });
});

describe('what the two actions do with the sentence', () => {
  it('carries the quote into the tutor and asks with it', async () => {
    /*
     * All the way to the seam, not to the chip. The panel shows a pending
     * quote before the question is sent, so asserting the chip alone would
     * pass on a popover that displayed the sentence and handed `askTutor`
     * nothing. `l-s-dbs-4`'s script answers *any* question differently when a
     * quote is present, so the reply text is the proof it arrived.
     */
    const { container } = await renderReader();
    const quote = twoParagraphs(container);
    fireEvent.click(screen.getByRole('button', { name: ASK }));

    const rail = screen.getByRole('complementary', RAIL);
    expect(within(rail).getByRole('tab', { name: 'Tutor' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(within(rail).getByText(`“${quote}”`)).toBeTruthy();
    expect(popover(), 'the popover outlived the action').toBeNull();

    fireEvent.click(within(rail).getByRole('button', { name: 'Explain more simply' }));
    const quoted = await askTutor(WRITTEN, 'Explain more simply', quote);
    const plain = await askTutor(WRITTEN, 'Explain more simply');
    expect(quoted.text, 'the fixture answers the same with and without a quote').not.toBe(
      plain.text,
    );
    expect(await screen.findByText(quoted.text)).toBeTruthy();
  });

  it('writes a note whose body carries the quote, and opens the notes', async () => {
    const before = allNotes().length;
    const { container } = await renderReader();
    const quote = twoParagraphs(container);
    fireEvent.click(screen.getByRole('button', { name: SAVE }));

    expect(allNotes().length).toBe(before + 1);
    const written = allNotes()[0];
    expect(written.body, 'the quote is not in the body').toContain(quote);
    /*
     * The quote is *the* body — not a field beside it, not an anchor type.
     * `addNote` trims, so the blank line the brief describes is unstorable and
     * deliberately not written; the quotation marks are what say the words are
     * not the reader's own. See `ReaderScreen` for the argument.
     */
    expect(written.body).toBe(`“${quote}”`);
    expect(written.lessonId).toBe(WRITTEN);
    expect(written.spaceId).toBe(SPACE);

    const rail = screen.getByRole('complementary', RAIL);
    expect(within(rail).getByRole('tab', { name: 'Notes' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    // And it is on screen, not merely in the store.
    expect(within(rail).getByText(`“${quote}”`)).toBeTruthy();
  });

  it('says the save happened, where the reader is looking', async () => {
    /*
     * The note lands in the rail, which is 384px away from the sentence the
     * eye is on. The confirmation replaces the two actions in place, and it is
     * a text change inside a live region that already existed — a region
     * inserted along with its own text is announced by some screen readers and
     * not others.
     */
    const { container } = await renderReader();
    twoParagraphs(container);
    fireEvent.click(screen.getByRole('button', { name: SAVE }));

    expect(screen.getByText('Saved to your notes.')).toBeTruthy();
    expect(popover()!.querySelector('[aria-live="polite"]')!.textContent).toBe(
      'Saved to your notes.',
    );
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
  });

  it('does not let the press that triggers it destroy the sentence it is about', async () => {
    /*
     * The bug this prevents is total, not cosmetic: `mousedown` on a button
     * collapses the document selection, `selectionchange` fires, the popover
     * unmounts — and `click` never arrives on an element that is gone. Both
     * actions would be unreachable by the one input method that can reach them
     * at all. The root cancels the default, so the selection survives the press.
     */
    const { container } = await renderReader();
    twoParagraphs(container);
    const prevented = !fireEvent.mouseDown(screen.getByRole('button', { name: ASK }));
    expect(prevented, 'mousedown inside the popover is not prevented').toBe(true);
  });
});

describe('the popover goes away for all four reasons', () => {
  const shown = async () => {
    const r = await renderReader();
    twoParagraphs(r.container);
    expect(popover()).not.toBeNull();
    return r;
  };

  it('goes on Escape', async () => {
    await shown();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(popover()).toBeNull();
  });

  it('goes on a press outside it', async () => {
    await shown();
    fireEvent.pointerDown(document.body);
    expect(popover()).toBeNull();
  });

  it('stays for a press inside it', async () => {
    // The dismissal listener is on the document, so without the containment
    // check it would fire on the way to its own buttons.
    await shown();
    fireEvent.pointerDown(screen.getByRole('button', { name: ASK }));
    expect(popover()).not.toBeNull();
  });

  it('goes when the page scrolls under it', async () => {
    // It is pinned to a rectangle. Once the page has moved, that rectangle is
    // over a different sentence.
    await shown();
    fireEvent.scroll(window);
    expect(popover()).toBeNull();
  });

  it('goes when the selection collapses', async () => {
    await shown();
    clearSelection();
    expect(popover()).toBeNull();
  });

  it('takes Escape before the rail does, one layer at a time', async () => {
    /*
     * Both can be up at once — the rail docks, the article stays readable, and
     * selecting a sentence with the tutor open is the ordinary case. One
     * Escape must not take both: the popover listens in the capture phase and
     * stops the event, so the rail's document handler never sees the first
     * press.
     *
     * Dispatched at `document.body` rather than at `document`, and that is the
     * difference between testing the rule and testing nothing. With `document`
     * as the target both listeners are "at target" and fire in registration
     * order, so the capture listener's advantage — and the whole mechanism —
     * disappears. A real key press targets the focused element.
     */
    const { container } = await renderReader();
    const btn = screen.getByRole('button', { name: 'Tutor' });
    btn.focus();
    fireEvent.click(btn);
    twoParagraphs(container);
    expect(popover()).not.toBeNull();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(popover()).toBeNull();
    expect(screen.getByRole('complementary', RAIL), 'one press took both layers').toBeTruthy();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('complementary', RAIL)).toBeNull();
  });
});

describe('the popover is an extra route, not the only one', () => {
  it('leaves the header’s two doors exactly where they were', async () => {
    /*
     * The rule the brief states as a floor: selection is a pointer gesture, so
     * both panels must still open without one. This is the regression half —
     * the popover mounts on every branch of the reader, first in the tree, and
     * a mounting mistake there could shadow the header.
     */
    await renderReader();
    for (const name of ['Tutor', 'Notes'] as const) {
      const btn = screen.getByRole('button', { name });
      btn.focus();
      fireEvent.click(btn);
      const rail = screen.getByRole('complementary', RAIL);
      expect(within(rail).getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true');
      fireEvent.click(btn);
    }
  });

  it('is the next tab stop once it is showing, and no tab stop before', async () => {
    /*
     * Its keyboard story in one assertion. It never takes focus — there is no
     * control that opened it to hand focus back to, and grabbing focus mid-drag
     * would fight the gesture — so being reachable means being *early*. It is
     * first in the reader's DOM, so the Tab after a selection reaches it rather
     * than walking the header first; with nothing selected it renders nothing,
     * and the tab order is the reader's own.
     */
    const { container } = await renderReader();
    const focusable = () =>
      [...container.querySelectorAll<HTMLElement>('a[href], button, input, [tabindex]')].filter(
        (el) => el.getAttribute('tabindex') !== '-1',
      );

    expect(focusable()[0].getAttribute('aria-label')).toBe('Leave the reader');

    twoParagraphs(container);
    expect(document.activeElement, 'the popover took focus').not.toBe(
      screen.getByRole('button', { name: ASK }),
    );
    expect(focusable()[0].textContent).toContain(ASK);
    expect(focusable()[1].textContent).toContain(SAVE);
  });
});

describe('the column is the same column with the popover up', () => {
  it('changes no class on the article or its paragraphs', async () => {
    /*
     * "A popover is not allowed to change the column." Byte-identical, and the
     * paragraphs too — a popover that reserved room by narrowing the measure
     * would keep every substring the looser guard checks for.
     */
    const { container } = await renderReader();
    const before = container.querySelector('article')!.className;
    const measures = [...container.querySelectorAll('article section p')].map((p) => p.className);

    twoParagraphs(container);
    expect(popover()).not.toBeNull();

    expect(container.querySelector('article')!.className).toBe(before);
    expect([...container.querySelectorAll('article section p')].map((p) => p.className)).toEqual(
      measures,
    );
  });
});

describe('the position is a style, because a computed class is not CSS', () => {
  it('places itself with inline coordinates', async () => {
    /*
     * Tailwind scans source text. A class built from a number at runtime is a
     * class it never emits, so the DOM looks perfect, `getComputedStyle` says
     * nothing happened, and every DOM-only test passes — which is exactly how the
     * reader's dock shipped broken once already.
     */
    const { container } = await renderReader();
    twoParagraphs(container);
    const el = popover()!;
    expect(el.style.left, 'the popover has no inline left').not.toBe('');
    expect(el.style.top, 'the popover has no inline top').not.toBe('');
  });

  it('assembles no class at runtime anywhere in the file', async () => {
    const body = readSource('components/reader/SelectionAsk.tsx');
    expect(body, 'a className built from a template literal').not.toMatch(/className=\{`/);
    expect(body, 'a class assembled by concatenation').not.toMatch(/className=\{[^}]*\+/);
  });
});
