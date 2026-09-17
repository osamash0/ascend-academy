import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ReaderScreen from '../../screens/ReaderScreen';
import { spaceById } from '../../mocks/spaces';
import { visibleLesson } from '../../mocks/lessons';

/**
 * Every state the reader can be in, rendered.
 *
 * The reader has seven: four Lesson shapes, a Space with grounding off, and
 * the two load states `?mock=` forces. Each of the first five needs a fixture
 * or the branch has never executed against real data, and each of the last two
 * needs the query flag or the branch has never executed at all.
 *
 * Two rules are checked here rather than in a source guard, and the reason is
 * the finding that produced this file.
 *
 * **`deadends.test.tsx` did not catch the Material-only dead end, and never
 * could have.** Its unit is a `<button>` open tag: it reads every one in the
 * namespace and asks whether that button has a handler. It is a rule about
 * controls that exist and do nothing. A branch that renders *no* control has
 * no tag to match, so a regex over button tags is blind to it by construction
 * — "dead end" names two different failures and that file only ever
 * implemented the first. It is also a source guard, and source is the wrong
 * altitude for the question: `ReaderScreen.tsx` contains `<LessonPager` and a
 * practice link in its text, so any file-level check for "does this screen
 * offer a way onward" passes while the branch that is actually on screen
 * renders neither. Both rules below are therefore per-branch and rendered.
 */

const mount = (spaceId: string, lessonId: string) =>
  render(
    <MemoryRouter initialEntries={[`/v4/space/${spaceId}/lesson/${lessonId}/read`]}>
      <Routes>
        <Route path="/v4/space/:spaceId/lesson/:lessonId/read" element={<ReaderScreen />} />
      </Routes>
    </MemoryRouter>,
  );

/** Every screen holds a skeleton for 600ms, so the loading state is real. */
const open = async (spaceId: string, lessonId: string) => {
  const r = mount(spaceId, lessonId);
  await waitFor(() => expect(screen.getByRole('banner')).toBeTruthy(), { timeout: 3000 });
  return r;
};

/**
 * The five shapes, named by what the reader has to decide between rather than
 * by Lesson id — the ids are an index into the fixtures, not the subject.
 */
const SHAPES = {
  both: { space: 's-dbs', lesson: 'l-s-dbs-4' },
  textOnly: { space: 's-crypto', lesson: 'l-s-crypto-6' },
  materialOnly: { space: 's-dbs', lesson: 'l-s-dbs-10' },
  neither: { space: 's-dbs', lesson: 'l-s-dbs-3' },
} as const;

/**
 * `?mock=` is read off `window.location`, not off the router — the flag is a
 * design-review switch and has to work from the address bar on any screen.
 * `MemoryRouter` therefore cannot set it and the environment's own history must.
 */
const forceScenario = (v: string | null) =>
  window.history.replaceState({}, '', v ? `/?mock=${v}` : '/');

afterEach(() => forceScenario(null));

describe('the reader has a fixture for every shape, and renders each one', () => {
  it('shows both views when the Lesson has a text and a paged Material', async () => {
    const lesson = visibleLesson(spaceById(SHAPES.both.space)!, SHAPES.both.lesson)!;
    expect(lesson.passages!.length, 'fixture lost its prose').toBeGreaterThan(0);
    expect(lesson.material!.pages!.length, 'fixture lost its pages').toBeGreaterThan(0);

    const { container } = await open(SHAPES.both.space, SHAPES.both.lesson);
    expect(screen.getByRole('tablist', { name: 'Reader view' })).toBeTruthy();
    expect(container.querySelector('article')).not.toBeNull();
    expect(container.querySelectorAll('article section h2')).toHaveLength(
      lesson.passages!.length,
    );
  });

  it('ties the segment to the view it switches, and only where there is one', async () => {
    /*
     * `role="tab"` is a promise: it says there is a panel to jump to. The
     * header's segment made that promise with no `aria-controls` and no
     * `role="tabpanel"` anywhere — the rail's tablist next door has done it
     * properly since it was written, so this was one pattern with two
     * implementations in one feature, and no test asserted the association
     * either way.
     *
     * Both directions are pinned. A `tabpanel` without a tablist is the same
     * defect seen from the other end — it announces the column as one of a set
     * that does not exist — so the one-view shapes must carry no panel role at
     * all.
     */
    const { container } = await open(SHAPES.both.space, SHAPES.both.lesson);

    const selected = screen
      .getAllByRole('tab')
      .find((t) => t.getAttribute('aria-selected') === 'true')!;
    const panelId = selected.getAttribute('aria-controls');
    expect(panelId, 'a tab that controls nothing').toBeTruthy();

    const panel = container.querySelector(`#${panelId}`);
    expect(panel, 'aria-controls points at no element').not.toBeNull();
    expect(panel!.getAttribute('role')).toBe('tabpanel');
    // Named by the tab that is showing it, so the two cannot drift apart.
    expect(panel!.getAttribute('aria-labelledby')).toBe(selected.id);
    expect(selected.id).toBeTruthy();

    // And the panel follows the view rather than being pinned to one branch.
    fireEvent.click(screen.getByRole('tab', { name: 'Source' }));
    const after = container.querySelector('[role="tabpanel"]')!;
    expect(after.getAttribute('aria-labelledby')).toBe(
      screen.getByRole('tab', { name: 'Source' }).id,
    );
  });

  it('claims no panel where there is no segment to control it', async () => {
    const { container } = await open(SHAPES.materialOnly.space, SHAPES.materialOnly.lesson);
    expect(screen.queryByRole('tablist', { name: 'Reader view' })).toBeNull();
    expect(container.querySelector('[role="tabpanel"]')).toBeNull();
  });

  it('shows the text alone when the source file is gone', async () => {
    /*
     * The shape that had no fixture at all until this task. Both
     * `material: null` Lessons also had no passages, so they were a second
     * reading of "neither" — and this branch, the one where the reader has to
     * survive losing the file it was written from, had never rendered.
     */
    const lesson = visibleLesson(spaceById(SHAPES.textOnly.space)!, SHAPES.textOnly.lesson)!;
    expect(lesson.material, 'this fixture is only interesting with no Material').toBeNull();
    expect(lesson.passages!.length).toBeGreaterThan(0);

    const { container } = await open(SHAPES.textOnly.space, SHAPES.textOnly.lesson);
    expect(container.querySelector('article')).not.toBeNull();
    // Nothing to toggle to, so no segment and no page pager.
    expect(screen.queryByRole('tablist', { name: 'Reader view' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  });

  it('opens in the Material when there is no prose', async () => {
    const { container } = await open(SHAPES.materialOnly.space, SHAPES.materialOnly.lesson);
    expect(container.querySelector('[data-source-column]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeTruthy();
    expect(screen.queryByText('Not written yet')).toBeNull();
  });

  it('says so, once, when there is neither', async () => {
    await open(SHAPES.neither.space, SHAPES.neither.lesson);
    expect(screen.getByText('Not written yet')).toBeTruthy();
    expect(screen.queryByRole('tablist', { name: 'Reader view' })).toBeNull();
  });

  it('renders no grounding marker in a Space with grounding switched off', async () => {
    /*
     * Doc 1, locked: the marker is chrome and dormant by default. Driven
     * end-to-end through the Space rather than by a prop, because the value
     * has to travel from the Space through the screen to the panel — and the
     * Lesson that reads it is now one with prose, so this is the marker being
     * absent on a page somebody is actually reading.
     */
    expect(spaceById('s-crypto')!.groundingEnabled).toBe(false);
    await open(SHAPES.textOnly.space, SHAPES.textOnly.lesson);
    fireEvent.click(screen.getByRole('button', { name: 'Tutor' }));
    expect(screen.queryByText(/Grounded — answers draw on/)).toBeNull();
  });

  it('renders the grounding marker where the Space has it on', async () => {
    // The other half, so "no marker" cannot pass by the marker never rendering.
    expect(spaceById('s-dbs')!.groundingEnabled).toBe(true);
    await open(SHAPES.both.space, SHAPES.both.lesson);
    fireEvent.click(screen.getByRole('button', { name: 'Tutor' }));
    expect(screen.getByText(/Grounded — answers draw on/)).toBeTruthy();
  });
});

describe('the load states the query flag forces still reach the reader', () => {
  beforeEach(() => forceScenario(null));

  it('holds the skeleton on ?mock=loading, and never resolves', async () => {
    forceScenario('loading');
    const { container } = mount(SHAPES.both.space, SHAPES.both.lesson);
    await new Promise((r) => setTimeout(r, 900));
    expect(screen.getByLabelText('Loading')).toBeTruthy();
    // RULING F4: no Lesson, so no header — the exit below is what replaces it.
    expect(container.querySelector('header')).toBeNull();
  });

  it('renders the failure on ?mock=error, named for what failed', async () => {
    forceScenario('error');
    mount(SHAPES.both.space, SHAPES.both.lesson);
    await waitFor(() => expect(screen.getByText('Couldn’t load this Lesson')).toBeTruthy(), {
      timeout: 3000,
    });
    expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy();
  });
});

/* ── The two rules that are about branches, not about files ──────── */

/** Links that leave the reader — anything not pointing back at `/read`. */
const exits = (container: HTMLElement) =>
  [...container.querySelectorAll('a[href]')].filter(
    (a) => !(a.getAttribute('href') ?? '').endsWith('/read'),
  );

/**
 * The way out, named and pointed at the Lesson it was opened from.
 *
 * `exits(...).length > 0` was what three of the five branches asserted, and it
 * is much weaker than the describe above it reads: on the branch that is
 * reading, the practice CTA satisfies it on its own, so deleting the header's
 * exit outright left that test green. A count of links is not a way out —
 * being able to name it and say where it goes is.
 *
 * The not-found branch is deliberately not held to this: it renders
 * `NotFound`, whose way out is "Back to {Space}" and points at the Space
 * rather than at a Lesson that does not exist. It keeps its own assertion.
 */
const wayOut = (container: HTMLElement, space: string, lesson: string) => {
  const out = exits(container).find(
    (a) => a.getAttribute('aria-label') === 'Leave the reader',
  );
  expect(out, 'no control on this branch is the way out').toBeTruthy();
  expect(out!.getAttribute('href'), 'the way out does not lead back to the Lesson').toBe(
    `/v4/space/${space}/lesson/${lesson}`,
  );
};

describe('every branch offers a way out', () => {
  /*
   * The name is now true of every branch, which it was not.
   *
   * `SpacesError` offers a "Try again" that reloads the same URL, and
   * `DetailSkeleton` offered nothing at all — so on a surface that takes off
   * the top bar and mounts no bottom nav, two of the reader's branches could
   * only be left with the browser's own back button. `?mock=loading` never
   * resolves, so that one was a trap you could not wait out.
   *
   * The guard this replaces asserted that `ReaderScreen.tsx` mounts
   * `<ReaderHeader` and that the header contains "Leave the reader" — both
   * true, both about the one branch in four that has a header.
   */
  it('from the branch that is reading', async () => {
    const { container } = await open(SHAPES.both.space, SHAPES.both.lesson);
    wayOut(container, SHAPES.both.space, SHAPES.both.lesson);
  });

  it('from a Lesson with nothing written', async () => {
    const { container } = await open(SHAPES.neither.space, SHAPES.neither.lesson);
    wayOut(container, SHAPES.neither.space, SHAPES.neither.lesson);
  });

  it('from the skeleton, which never resolves', async () => {
    forceScenario('loading');
    const { container } = mount(SHAPES.both.space, SHAPES.both.lesson);
    await new Promise((r) => setTimeout(r, 900));
    expect(exits(container).length, 'a load that never lands and no way off it').toBeGreaterThan(
      0,
    );
    wayOut(container, SHAPES.both.space, SHAPES.both.lesson);
  });

  it('from the failure, which offers only a reload otherwise', async () => {
    forceScenario('error');
    const { container } = mount(SHAPES.both.space, SHAPES.both.lesson);
    await waitFor(() => expect(screen.getByText('Couldn’t load this Lesson')).toBeTruthy(), {
      timeout: 3000,
    });
    wayOut(container, SHAPES.both.space, SHAPES.both.lesson);
  });

  it('from a Lesson id that is not there', async () => {
    const { container } = mount('s-dbs', 'l-s-dbs-nope');
    await waitFor(() => expect(screen.getByText(/isn’t here/)).toBeTruthy(), { timeout: 3000 });
    /*
     * The one branch with a different way out, and correctly so: there is no
     * Lesson to go back to, so `NotFound` points at the Space and names it.
     * Pinned to that rather than to a count, for the same reason as the four
     * above.
     */
    const out = exits(container);
    expect(out.map((a) => a.getAttribute('href'))).toContain('/v4/space/s-dbs');
    expect(out.map((a) => a.textContent?.trim())).toContain('Back to Database Systems');
  });
});

/**
 * Controls outside the fixed bar that lead on to another Lesson or to
 * practice.
 *
 * Matched on the accessible name, which is looser than it looks: the pager
 * labels every card "Previous/Next Lesson: …", the practice link is the only
 * "Practise" on the screen, and the way back is "Back to the Lesson". What it
 * cannot distinguish is a control that *says* one of those things and does
 * nothing — which is precisely the half `deadends.test.tsx` does cover, so the
 * two guards are complementary rather than overlapping.
 */
const onward = (container: HTMLElement) => {
  const bar = container.querySelector('header');
  return [...container.querySelectorAll('a[href], button')]
    .filter((el) => !bar?.contains(el))
    .map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '')
    .filter((name) => /\bLesson\b|Practise/.test(name));
};

describe('every branch a reader can land on offers something to do next', () => {
  /*
   * The dead end this closes: `l-s-dbs-10` has a Material, no prose, an empty
   * practice bank and no Lesson after it in the path. Opened, it showed the
   * page card, a page pager and the header's X — nothing that went anywhere.
   * That is the dead end the Source view was built to remove, reappearing at
   * the far end of the same screen.
   *
   * Entry views only, and deliberately: reaching the Material of a Lesson that
   * also has prose costs a press of a segment you can press back, so the way
   * onward from there is the segment. The failure this is about is landing
   * somewhere with nothing.
   */
  it.each([
    ['a text and a Material', SHAPES.both],
    ['a text and no Material', SHAPES.textOnly],
    ['a Material and no text', SHAPES.materialOnly],
    ['neither', SHAPES.neither],
  ])('from a Lesson with %s', async (_label, shape) => {
    const { container } = await open(shape.space, shape.lesson);
    expect(
      onward(container),
      'nothing outside the bar leads anywhere: this branch is a dead end',
    ).not.toHaveLength(0);
  });
});

describe('the reading keeps its heading order', () => {
  it('opens at h1 and steps one level at a time', async () => {
    /*
     * The chrome grew a header, a rail and a popover around the column, and
     * every one of them was a chance to put an `h2` above the Lesson title or
     * to skip a level on the way down. The passages are `h2` because they are
     * sections of the thing the `h1` names.
     */
    for (const shape of [SHAPES.both, SHAPES.textOnly, SHAPES.materialOnly]) {
      const { container, unmount } = await open(shape.space, shape.lesson);
      const levels = [...container.querySelectorAll('h1, h2, h3, h4')].map((h) =>
        Number(h.tagName[1]),
      );
      expect(levels[0], `${shape.lesson} does not open at h1`).toBe(1);
      expect(levels.filter((l) => l === 1), `${shape.lesson} has two titles`).toHaveLength(1);
      levels.forEach((l, i) => {
        if (i === 0) return;
        expect(l - levels[i - 1], `${shape.lesson} skips a heading level`).toBeLessThanOrEqual(1);
      });
      unmount();
    }
  });
});
