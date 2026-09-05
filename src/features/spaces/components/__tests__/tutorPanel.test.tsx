import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { QUICK_PROMPTS, TutorPanel, type Turn } from '../reader/TutorPanel';
import ReaderScreen from '../../screens/ReaderScreen';
import { spaceById } from '../../mocks/spaces';
import { visibleLesson } from '../../mocks/lessons';
import { askTutor } from '../../mocks/tutor';
import { readSource } from './sources';
import type { Lesson } from '../../types';

/**
 * The one failure the fixture cannot produce.
 *
 * `askTutor` never rejects — there is no network behind it to fail — so the
 * error branch is reachable only by putting a failure in front of it. A
 * delegating mock rather than a replacement: every other test in this file
 * asks the real seam and asserts the real words, and a factory returning
 * canned junk would quietly turn all of them into tests of the mock.
 */
const { failNext } = vi.hoisted(() => ({ failNext: { value: false } }));

vi.mock('../../mocks/tutor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../mocks/tutor')>();
  return {
    ...actual,
    askTutor: (...args: Parameters<typeof actual.askTutor>) => {
      if (!failNext.value) return actual.askTutor(...args);
      failNext.value = false;
      return Promise.reject(new Error('the request did not arrive'));
    },
  };
});

/**
 * The tutor, and the two rules it is most likely to half-keep.
 *
 * **Grounding.** It is dormant by default, so the branch that renders *no*
 * marker is the one that ships untested — the flagship Space has grounding on
 * and it is the only Space with a written Lesson in it, so every hand-check of
 * the reader sees the marker and nobody ever sees its absence. Both branches
 * are driven here, and the off one is driven twice: once through the prop, and
 * once end to end through `s-crypto`, a real fixture with the setting off, so
 * the assertion is not merely that the component obeys a boolean but that a
 * reader in that Space is actually shown nothing.
 *
 * **Citations that land.** A chip is the only reason the panel is worth
 * building, and a chip that goes nowhere is worse than a paragraph with no
 * chip at all. So the tests press them on the real screen and check where they
 * arrived — the passage scrolled to, the page turned to — rather than checking
 * that a callback fired into a mock that could be wired to nothing.
 */

const SPACE = 's-dbs';
const WRITTEN = 'l-s-dbs-4';
const RAIL = { name: 'Reader companions' } as const;

const normalization = () => visibleLesson(spaceById(SPACE)!, WRITTEN)!;

/**
 * The thread belongs to the screen now, so a component test has to bring one.
 *
 * A stateful harness rather than a fixed array, because half of what is
 * checked here is a turn *changing* — pending to answered, error to retried —
 * and a panel handed a frozen list would render the first frame of each of
 * those forever. The harness is the smallest possible stand-in for
 * `ReaderScreen`: a `useState` and a counter, which is exactly what the screen
 * holds.
 */
function Harness(props: Partial<React.ComponentProps<typeof TutorPanel>>) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const id = useRef(0);
  return (
    <TutorPanel
      lesson={normalization()}
      groundingEnabled
      onCiteConcept={() => {}}
      onCiteMaterial={() => {}}
      onQuoteConsumed={() => {}}
      turns={turns}
      onTurnsChange={setTurns}
      mintTurnId={() => id.current++}
      {...props}
    />
  );
}

const mount = (over: Partial<React.ComponentProps<typeof TutorPanel>> = {}) =>
  render(<Harness {...over} />);

const MARKER = 'Grounded — answers draw on this Space’s Lessons and name where they came from.';
const EMPTY = 'Ask about anything in this Lesson — or select a sentence in the text and start from there.';

/** Send a question the way somebody typing one does. */
const type = (text: string) => {
  fireEvent.change(screen.getByLabelText('Ask about this Lesson'), { target: { value: text } });
};

describe('the grounded marker is chrome, and it is dormant by default', () => {
  it('shows one quiet line where the Space has grounding on', () => {
    mount({ groundingEnabled: true });
    expect(screen.getByText(MARKER)).toBeTruthy();
  });

  it('shows nothing at all where it is off — not a greyed marker', () => {
    /*
     * "A marker on everything would be a marker on nothing." The assertion is
     * absence of the *concept*, not of one string: a panel that swapped in
     * "Not grounded" would pass a check for the grounded copy alone while
     * breaking the rule outright.
     */
    const { container } = mount({ groundingEnabled: false });
    expect(screen.queryByText(MARKER)).toBeNull();
    expect(container.textContent).not.toMatch(/ground/i);
  });
});

describe('the panel before anything has been asked', () => {
  it('says what it is for, and where else a question can start', () => {
    mount();
    expect(screen.getByText(EMPTY)).toBeTruthy();
  });

  it('offers three openers', () => {
    mount();
    for (const p of QUICK_PROMPTS) expect(screen.getByRole('button', { name: p })).toBeTruthy();
  });

  it('does not send an empty question', async () => {
    // Enter on an empty field is a mis-hit, and a thread with a blank turn in
    // it is a thread that has to be scrolled past.
    mount();
    fireEvent.submit(screen.getByLabelText('Ask about this Lesson').closest('form')!);
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);
    await waitFor(() => expect(screen.getByText(EMPTY)).toBeTruthy());
  });
});

describe('a question, its wait, and its answer', () => {
  it('waits visibly, then answers in the words the seam returned', async () => {
    /*
     * The expected text comes from `askTutor` rather than being pasted in.
     * What is being tested is that the panel renders the answer it was given
     * — pasting the copy here would make an edit to the fixture fail this
     * file for no reason, and the fixture's own content is guarded next door
     * in `mocks/__tests__/tutor.test.ts`.
     */
    const expected = await askTutor(WRITTEN, 'Concrete example');
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Concrete example' }));

    // The chip that sent it, and the question standing in the thread.
    expect(screen.getAllByText('Concrete example')).toHaveLength(2);
    expect(screen.getByText('Thinking…')).toBeTruthy();

    expect(await screen.findByText(expected.text)).toBeTruthy();
    expect(screen.queryByText('Thinking…')).toBeNull();
    for (const c of expected.citations) expect(screen.getByText(c.label)).toBeTruthy();
  });

  it('goes quiet while it is thinking, and comes back', async () => {
    // Two overlapping asks would interleave in a thread that reads top to
    // bottom. Quiet is not dead: everything is live again after the answer.
    const expected = await askTutor(WRITTEN, 'Explain more simply');
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Explain more simply' }));
    expect(screen.getByRole('button', { name: 'Concrete example' }).hasAttribute('disabled')).toBe(
      true,
    );

    await screen.findByText(expected.text);
    expect(screen.getByRole('button', { name: 'Concrete example' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('sends what was typed, on Enter, and empties the field', async () => {
    mount();
    type('What breaks in 2NF?');
    fireEvent.submit(screen.getByLabelText('Ask about this Lesson').closest('form')!);
    expect(screen.getByText('What breaks in 2NF?')).toBeTruthy();
    expect((screen.getByLabelText('Ask about this Lesson') as HTMLInputElement).value).toBe('');
    await screen.findByText((await askTutor(WRITTEN, 'What breaks in 2NF?')).text);
  });

  it('announces the answer without reading the question back', async () => {
    /*
     * The live region is around the reply and not around the thread. A live
     * thread announces your own question the moment you send it — the one
     * thing in the panel you already know — and then announces the answer, so
     * everything is said twice.
     */
    const expected = await askTutor(WRITTEN, 'Why does this matter?');
    const { container } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Why does this matter?' }));
    await screen.findByText(expected.text);

    const live = container.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toContain(expected.text);
    expect(live.textContent).not.toContain('Why does this matter?');
  });

  it('each opener reaches an answer of its own', async () => {
    /*
     * The guard on the seam between the chips and the script. The matchers are
     * substrings, so renaming an opener — or tightening a pattern — drops it
     * through to the generic fallback: three chips, one bland answer, no
     * citations, and nothing red anywhere.
     */
    const replies = await Promise.all(QUICK_PROMPTS.map((p) => askTutor(WRITTEN, p)));
    expect(new Set(replies.map((r) => r.text)).size, 'two openers give one answer').toBe(
      QUICK_PROMPTS.length,
    );
    for (const [i, r] of replies.entries())
      expect(r.citations.length, `"${QUICK_PROMPTS[i]}" falls through to the fallback`).toBeGreaterThan(0);
  });
});

describe('a citation is a control only where there is somewhere to land', () => {
  const askAndFind = async (label: string) => {
    fireEvent.click(screen.getByRole('button', { name: 'Concrete example' }));
    await screen.findByText((await askTutor(WRITTEN, 'Concrete example')).text);
    return screen.getByText(label);
  };

  it('hands back the Concept id it named', async () => {
    const onCiteConcept = vi.fn();
    mount({ onCiteConcept });
    fireEvent.click(await askAndFind('Second normal form'));
    expect(onCiteConcept).toHaveBeenCalledWith('c-l-s-dbs-4-3');
  });

  it('hands back the page number it named', async () => {
    const onCiteMaterial = vi.fn();
    mount({ onCiteMaterial });
    fireEvent.click(await askAndFind('Material · page 8'));
    expect(onCiteMaterial).toHaveBeenCalledWith(8);
  });

  it('names the page as plain text once the source file is gone', async () => {
    /*
     * `material: null` is the deleted file, and it takes the pages with it.
     * The answer still says where it came from — that is the marker's whole
     * promise — but there is nothing left to open, so the chip is a sentence.
     */
    const gone: Lesson = { ...normalization(), material: null };
    const onCiteMaterial = vi.fn();
    mount({ lesson: gone, onCiteMaterial });
    const chip = await askAndFind('Material · page 8');

    expect(chip.tagName).toBe('SPAN');
    expect(screen.queryByRole('button', { name: /Material · page 8/ })).toBeNull();
    fireEvent.click(chip);
    expect(onCiteMaterial).not.toHaveBeenCalled();
  });

  it('names the Concept as plain text on a Lesson with no text to scroll to', async () => {
    /*
     * The same rule in the other direction, and the reason it is stated as a
     * rule rather than as the `material === null` special case: a Lesson with
     * a Material and no prose has no passage to land on either, and a chip
     * that scrolled to an element that is not in the document is the dead end
     * the Source view's sync line was rebuilt to remove.
     */
    const unwritten: Lesson = { ...normalization(), passages: [] };
    const onCiteConcept = vi.fn();
    mount({ lesson: unwritten, onCiteConcept });
    const chip = await askAndFind('Second normal form');

    expect(chip.tagName).toBe('SPAN');
    fireEvent.click(chip);
    expect(onCiteConcept).not.toHaveBeenCalled();
  });
});

describe('a sentence carried in from the text', () => {
  const QUOTE = 'any two rows agreeing on A must agree on B';

  it('shows what it is holding before the question is asked', () => {
    // Otherwise it is state with no representation: you send a question and
    // get an answer shaped by a sentence you had forgotten you picked.
    mount({ pendingQuote: QUOTE });
    expect(screen.getByText(`“${QUOTE}”`)).toBeTruthy();
  });

  it('drops it on request, and says so upward', () => {
    const onQuoteConsumed = vi.fn();
    mount({ pendingQuote: QUOTE, onQuoteConsumed });
    fireEvent.click(screen.getByRole('button', { name: 'Drop the selected sentence' }));
    expect(onQuoteConsumed).toHaveBeenCalled();
  });

  it('carries it into the turn it was asked with, and releases it', async () => {
    const onQuoteConsumed = vi.fn();
    mount({ pendingQuote: QUOTE, onQuoteConsumed });
    fireEvent.click(screen.getByRole('button', { name: 'Explain more simply' }));

    expect(onQuoteConsumed).toHaveBeenCalled();
    // The quoted exchange, not the plain one — the selection reached the seam.
    expect(await screen.findByText((await askTutor(WRITTEN, 'x', QUOTE)).text)).toBeTruthy();
    expect(screen.getAllByText(`“${QUOTE}”`).length).toBeGreaterThan(0);
  });
});

describe('when the answer does not come back', () => {
  it('says so, and offers the trip again', async () => {
    /*
     * The fixture never rejects — there is no network behind it to fail. The
     * branch is real anyway, because this signature is the one a request will
     * keep and the first thing a request adds is a way to fail; an error state
     * built afterwards is one built while somebody stares at a blank panel.
     */
    failNext.value = true;
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Concrete example' }));
    expect(await screen.findByText('That answer did not come back.')).toBeTruthy();

    // And the composer is not dead behind it.
    expect(screen.getByRole('button', { name: 'Concrete example' }).hasAttribute('disabled')).toBe(
      false,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText((await askTutor(WRITTEN, 'Concrete example')).text)).toBeTruthy();
    expect(screen.queryByText('That answer did not come back.')).toBeNull();
  });
});

describe('the rejected ideas stay rejected', () => {
  it('offers no model picker, no vendor, no regenerate and no rating', () => {
    /*
     * Source-level, because the point is that none of it was built rather than
     * that none of it happens to be on screen in one state. Every one of these
     * is an invitation to treat the answer as a product to tune instead of a
     * pointer back into the reading.
     */
    const body = readSource('components/reader/TutorPanel.tsx');
    for (const banned of [
      /model/i,
      /gpt|claude|gemini|llama|openai|anthropic/i,
      /regenerate/i,
      /thumbs|ThumbsUp|ThumbsDown|helpful\?/i,
    ])
      expect(body, `TutorPanel mentions ${banned}`).not.toMatch(banned);
  });
});

/* ── The chips, pressed on the screen they point into ─────────────── */

/**
 * A handle on the router, so a test can move the reader without a link.
 *
 * The one navigation that keeps `ReaderScreen` mounted — `/read` to `/read`,
 * same route, different param — is one no link in the app performs today:
 * `LessonPager` goes to the Lesson *overview*, a different route, which
 * unmounts the screen outright and resets everything by itself. The screen's
 * reset block is written for the shape anyway, and this is the only way to
 * make it execute.
 */
let go: ReturnType<typeof useNavigate> | undefined;
function Reader() {
  go = useNavigate();
  return <ReaderScreen />;
}

const renderReader = async (spaceId: string, lessonId: string) => {
  const r = render(
    <MemoryRouter initialEntries={[`/v4/space/${spaceId}/lesson/${lessonId}/read`]}>
      <Routes>
        <Route path="/v4/space/:spaceId/lesson/:lessonId/read" element={<Reader />} />
      </Routes>
    </MemoryRouter>,
  );
  // Every screen holds a skeleton for 600ms so the loading state is real.
  await waitFor(() => expect(screen.getByRole('banner')).toBeTruthy(), { timeout: 3000 });
  return r;
};

/** Open the rail on the Tutor tab, the way the header does. */
const openTutor = async (spaceId = SPACE, lessonId = WRITTEN) => {
  const r = await renderReader(spaceId, lessonId);
  const btn = screen.getByRole('button', { name: 'Tutor' });
  btn.focus();
  fireEvent.click(btn);
  return r;
};

const answer = async (prompt: string) => {
  const rail = screen.getByRole('complementary', { name: 'Reader companions' });
  fireEvent.click(within(rail).getByRole('button', { name: prompt }));
  await screen.findByText((await askTutor(WRITTEN, prompt)).text);
  return rail;
};

describe('the tutor sits in the rail, on the reader', () => {
  it('shows the marker in a Space that has grounding switched on', async () => {
    await openTutor();
    expect(screen.getByText(MARKER)).toBeTruthy();
  });

  it('shows no marker in a Space that has it switched off', async () => {
    /*
     * `s-crypto` is a real fixture with `groundingEnabled: false`, so this is
     * the branch as a reader would meet it rather than as a prop. Its Lessons
     * have no prose — the reader renders "Not written yet" — and the rail is
     * summoned there anyway, which is the point: the tutor is about the
     * Lesson, not about which of its views is showing.
     */
    await openTutor('s-crypto', 'l-s-crypto-1');
    const rail = screen.getByRole('complementary', { name: 'Reader companions' });
    expect(within(rail).queryByText(MARKER)).toBeNull();
    expect(within(rail).getByText(EMPTY)).toBeTruthy();
  });

  it('turns the Material to the page a page chip names', async () => {
    /*
     * The reason the page number is held on the screen rather than inside
     * `SourceView`: the chip turns a page of a view that is not mounted at the
     * moment it is pressed.
     */
    await openTutor();
    const rail = await answer('Concrete example');
    fireEvent.click(within(rail).getByRole('button', { name: /Material · page 8/ }));

    expect(screen.getByText('The update anomaly, worked')).toBeTruthy();
    expect(screen.getByText('8 / 12')).toBeTruthy();
  });

  it('comes back from the Material to the passage a Concept chip names', async () => {
    /*
     * The jump is the sync line's jump — one implementation, two callers — and
     * this is the test that can tell the difference. Pressed from the Read
     * view, a naive `getElementById(...).scrollIntoView()` looks identical,
     * because the passage is already there; the second copy passes and drifts
     * from there. Pressed from the *Material*, it cannot: the passage is not
     * in the document until the view has changed, and it is not in the
     * document on the tick the view is set either.
     *
     * The options are asserted for the same reason `ReaderScreen` states them.
     * `index.css` sets `scroll-behavior: smooth` on `html` for the whole app,
     * and that property does not consult the operating system — so a jump that
     * leaves `behavior` implicit animates a long scroll at somebody who asked
     * for less motion.
     */
    // `this` is captured by hand rather than read off a spy: which of
    // `mock.instances` / `mock.contexts` holds the receiver has moved between
    // versions, and a guard whose subject depends on that is a guard that
    // silently starts asserting `undefined === undefined`.
    const scrolled: { id: string; options?: ScrollIntoViewOptions }[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (
      this: HTMLElement,
      arg?: boolean | ScrollIntoViewOptions,
    ) {
      scrolled.push({ id: this.id, options: typeof arg === 'object' ? arg : undefined });
    };
    try {
      await openTutor();
      const rail = await answer('Concrete example');

      // Away from the prose first, so the passage is not there to be found.
      fireEvent.click(within(rail).getByRole('button', { name: /Material · page 8/ }));
      expect(screen.getByText('The update anomaly, worked')).toBeTruthy();

      fireEvent.click(within(rail).getByRole('button', { name: /Second normal form/ }));
      await waitFor(() => expect(scrolled.length).toBeGreaterThan(0));

      expect(scrolled[0].id).toBe('passage-c-l-s-dbs-4-3');
      expect(scrolled[0].options?.block).toBe('start');
      expect(scrolled[0].options?.behavior, 'behavior left to the stylesheet').toBeDefined();
      // And the reader is reading again, not still holding the page.
      expect(screen.queryByText('The update anomaly, worked')).toBeNull();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

/**
 * The thread outlives the panel that draws it.
 *
 * Both halves, because the bug had two and a fix for one looks exactly like a
 * fix for both from the tab that was tested. The rail renders one companion
 * and unmounts the other (`tab === 'tutor' ? tutor : notes`), and it unmounts
 * everything when it closes (`if (!open) return null`) — so state owned by
 * `TutorPanel` died on a glance at the notes *and* on closing the rail, and
 * keeping both panels mounted would have fixed only the first.
 */
describe('the conversation survives the rail', () => {
  const askOnce = async () => {
    await openTutor();
    const rail = screen.getByRole('complementary', RAIL);
    fireEvent.click(within(rail).getByRole('button', { name: 'Concrete example' }));
    const expected = await askTutor(WRITTEN, 'Concrete example');
    await screen.findByText(expected.text);
    return expected;
  };

  it('is still there after a look at the notes', async () => {
    const expected = await askOnce();
    const rail = screen.getByRole('complementary', RAIL);
    fireEvent.click(within(rail).getByRole('tab', { name: 'Notes' }));
    expect(screen.queryByText(expected.text), 'the tutor is not even showing').toBeNull();

    fireEvent.click(within(rail).getByRole('tab', { name: 'Tutor' }));
    expect(screen.getByText(expected.text)).toBeTruthy();
    expect(screen.getByText('Concrete example', { selector: 'span' })).toBeTruthy();
  });

  it('is still there after the rail is closed and summoned again', async () => {
    const expected = await askOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Close companions' }));
    expect(screen.queryByRole('complementary', RAIL)).toBeNull();

    const again = screen.getByRole('button', { name: 'Tutor' });
    again.focus();
    fireEvent.click(again);
    expect(screen.getByText(expected.text)).toBeTruthy();
  });

  it('gives the next question an id no turn in the thread is using', async () => {
    /*
     * Why the counter had to move up with the turns, and it is not academic.
     * Left in the panel it restarts on every remount — so the question asked
     * after a look at the notes gets the id the first question is still
     * holding, and `onTurnsChange` matches on that id: the answer is written
     * into *both* turns, and the first exchange silently becomes a copy of the
     * second. Nothing throws, and the thread reads as though the tutor said
     * the same thing twice.
     */
    const first = await askOnce();
    const rail = screen.getByRole('complementary', RAIL);
    fireEvent.click(within(rail).getByRole('tab', { name: 'Notes' }));
    fireEvent.click(within(rail).getByRole('tab', { name: 'Tutor' }));

    fireEvent.click(within(rail).getByRole('button', { name: 'Explain more simply' }));
    const second = await askTutor(WRITTEN, 'Explain more simply');
    await screen.findByText(second.text);

    expect(screen.getAllByText(first.text), 'the first answer was overwritten').toHaveLength(1);
    expect(screen.getAllByText(second.text)).toHaveLength(1);
  });

  it('does not follow the reader to another Lesson', async () => {
    /*
     * No cross-Lesson memory in v1, and lifting the thread is what put that
     * rule at risk: state on the screen outlives everything the rail does.
     * Answering about Normalization under the next Lesson's title, with
     * citations pointing at ideas it does not have, is the failure.
     */
    const expected = await askOnce();
    await act(async () => {
      go!('/v4/space/s-dbs/lesson/l-s-dbs-5/read');
    });
    await waitFor(() => expect(screen.getByRole('banner')).toBeTruthy(), { timeout: 3000 });

    const open = screen.getByRole('button', { name: 'Tutor' });
    open.focus();
    fireEvent.click(open);
    expect(screen.queryByText(expected.text)).toBeNull();
    expect(screen.getByText(EMPTY)).toBeTruthy();
  });
});
