import { describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ReaderHeader } from '../reader/ReaderHeader';
import ReaderScreen from '../../screens/ReaderScreen';
import { spaceById } from '../../mocks/spaces';
import { visibleLesson } from '../../mocks/lessons';

/**
 * The reader's fixed header.
 *
 * Render tests rather than source guards, because every rule here is about
 * what a person sees and reaches: a way out, where they are, how many ideas
 * are already cleared, and two companions that are not open yet. A guard
 * reading the file would confirm the strings exist and nothing about whether
 * they are announced.
 *
 * The header replaced an inline `✕ + breadcrumb` row that scrolled away with
 * the text. Two things had to survive that move and are asserted below: the
 * exit is still the first thing in the tab order, and the article column is
 * untouched — same `max-w-2xl`, same measured `52ch`. The rail is *summoned,
 * never squatting*, so a closed rail may not cost the column a pixel.
 */

const SPACE = spaceById('s-dbs')!;
const LESSON = visibleLesson(SPACE, 'l-s-dbs-4')!;

/** The fixture the whole reader is built against — guards the two above. */
describe('the fixture the header is read from', () => {
  it('is Normalization, Lesson 4, with five ideas', () => {
    expect(LESSON.title).toBe('Normalization');
    expect(LESSON.order).toBe(4);
    expect(LESSON.concepts).toHaveLength(5);
  });
});

const defaults = {
  spaceName: SPACE.name,
  lessonOrder: LESSON.order,
  backTo: `/v4/space/${SPACE.id}/lesson/${LESSON.id}`,
  concepts: LESSON.concepts,
  view: 'read' as const,
  showToggle: false,
  railOpen: false,
  railTab: null,
  onRailToggle: () => {},
};

const mount = (over: Partial<React.ComponentProps<typeof ReaderHeader>> = {}) =>
  render(
    <MemoryRouter>
      <ReaderHeader {...defaults} {...over} />
    </MemoryRouter>,
  );

describe('the header says where you are and how to leave', () => {
  it('names the Space and the Lesson', () => {
    mount();
    expect(screen.getAllByText(`${SPACE.name} · Lesson ${LESSON.order}`).length).toBeGreaterThan(0);
  });

  it('says where you are exactly once, however narrow the row gets', () => {
    /*
     * The sentence is written twice on purpose and must be *heard* once. At
     * 375px a Lesson with both views has 38px for the breadcrumb and renders
     * "Dat…", so the visible copy steps out below `sm` — but hiding it
     * outright would take the only statement of which Space this is away from
     * a screen reader, at exactly the width where the surrounding chrome is
     * thinnest. So one copy is `sr-only` and always announced, and the copy
     * that comes and goes is `aria-hidden`.
     *
     * Asserting the count is the point. Drop the `aria-hidden` and the header
     * reads its own location twice on every desktop visit, which no render
     * test that only looks for presence would notice.
     */
    mount({ showToggle: true });
    const both = screen.getAllByText(`${SPACE.name} · Lesson ${LESSON.order}`);
    expect(both).toHaveLength(2);
    const spoken = both.filter((el) => el.closest('[aria-hidden="true"]') === null);
    expect(spoken).toHaveLength(1);
    expect(spoken[0].className).toContain('sr-only');
  });

  /*
   * The two halves of one fix, asserted in both directions.
   *
   * At 375px a Lesson with both views has 319px of row, of which the segment
   * takes 147; the breadcrumb wants 182 and rendered "Dat…". So the visible
   * copy steps out below `sm` — and the right column stops reserving half the
   * row for 84px of buttons, which is what starved the breadcrumb to 118px on
   * the Lessons that have no segment at all.
   *
   * The first version of these tests checked only that the sentence was still
   * announced once and that the *exception* held. Both `showToggle &&` clauses
   * could be deleted — reverting the whole visible change — with every test
   * still green. Guarding the exception and not the rule is worse than not
   * guarding it, because the green tick claims the regression is covered.
   */
  const visibleCopy = () =>
    screen
      .getAllByText(`${SPACE.name} · Lesson ${LESSON.order}`)
      .find((el) => el.getAttribute('aria-hidden') === 'true');

  /** The controls column — the thing that was flexible when it had no reason to be. */
  const rightColumn = () => screen.getByRole('button', { name: 'Tutor' }).parentElement;

  it('yields the row to the segment when there is one', () => {
    mount({ showToggle: true });
    expect(visibleCopy()?.className).toContain('hidden');
    expect(visibleCopy()?.className).toContain('sm:block');
    expect(rightColumn()?.className).toContain('flex-1');
  });

  it('keeps the visible breadcrumb when there is no segment to crowd it', () => {
    /*
     * The narrow case is the exception. Most Lessons have one view, the middle
     * column is absent, and 375px has room for the whole breadcrumb — so it
     * must not be hidden there too. A responsive rule that fires on every
     * Lesson would be a plain regression wearing a media query.
     */
    mount({ showToggle: false });
    expect(visibleCopy()?.className).not.toContain('hidden');
    // With nothing in the middle, a flexible right column centres nothing and
    // still reserves the space that the breadcrumb needs.
    expect(rightColumn()?.className).not.toContain('flex-1');
  });

  it('offers a way out, pointed at the Lesson it came from', () => {
    // A focus surface with no exit is a trap, not a mode — the same rule
    // Practice keeps with "Leave practice".
    mount();
    const exit = screen.getByRole('link', { name: 'Leave the reader' });
    expect(exit.getAttribute('href')).toBe(`/v4/space/${SPACE.id}/lesson/${LESSON.id}`);
  });
});

describe('the dots display Concept state and nothing else', () => {
  it('draws one dot per Concept and counts the cleared ones', () => {
    /*
     * Derived from the fixture rather than hardcoded: the numbers here are a
     * property of `l-s-dbs-4`'s Concepts, and a test that restated them would
     * go on passing after somebody cleared one.
     */
    const cleared = LESSON.concepts.filter((c) => c.progress === 'cleared').length;
    mount();
    const group = screen.getByLabelText(`${cleared} of ${LESSON.concepts.length} ideas cleared`);
    expect(group.querySelectorAll('[data-concept-dot]')).toHaveLength(LESSON.concepts.length);
  });

  it('counts cleared and not-cleared, never a percentage', () => {
    // `discovered` is not `cleared`. Reading changes no progress, so the only
    // question the header may answer is which ideas the engine already cleared.
    mount({
      concepts: [
        { id: 'a', name: 'A', progress: 'cleared' },
        { id: 'b', name: 'B', progress: 'discovered' },
        { id: 'c', name: 'C', progress: 'untouched' },
      ],
    });
    expect(screen.getByLabelText('1 of 3 ideas cleared')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('hides the individual dots from the reader that hears them', () => {
    mount();
    const cleared = LESSON.concepts.filter((c) => c.progress === 'cleared').length;
    const group = screen.getByLabelText(`${cleared} of ${LESSON.concepts.length} ideas cleared`);
    for (const dot of group.querySelectorAll('[data-concept-dot]')) {
      expect(dot.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('is a display, not a control', () => {
    /*
     * A dot that could be pressed would be a way to mark an idea read, which
     * is exactly the progression rule the reader refuses to invent. This is
     * the branch's headline constraint, and for six review gates it was
     * guarded by an assertion that could not see a violation.
     *
     * The first version asked `queryAllByRole('button')`. Role queries skip
     * `aria-hidden` subtrees — and the dots are `aria-hidden`, correctly, so
     * that a screen reader hears the group's one sentence instead of five
     * pieces of punctuation. The test immediately above this one *requires*
     * that attribute. So the two tests were in tension and read as coverage:
     * turning every dot into a `<button onClick>` left all twenty green.
     *
     * `{ hidden: true }` is what lets the query see the thing the rule is
     * about. The tag check is the second half, because a `<div onClick>` has
     * no role at all and would slip past even that.
     */
    mount();
    const cleared = LESSON.concepts.filter((c) => c.progress === 'cleared').length;
    const group = screen.getByLabelText(`${cleared} of ${LESSON.concepts.length} ideas cleared`);
    expect(within(group).queryAllByRole('button', { hidden: true })).toHaveLength(0);

    const dots = [...group.querySelectorAll('[data-concept-dot]')];
    expect(dots.length, 'no dots to check').toBeGreaterThan(0);
    for (const dot of dots) expect(dot.tagName).toBe('SPAN');
  });

  it('says nothing at all when the Lesson has no Concepts', () => {
    mount({ concepts: [] });
    expect(screen.queryByLabelText(/ideas cleared/)).toBeNull();
  });
});

describe('the view toggle appears only when there is something to toggle to', () => {
  it('is absent while the Source view is unbuilt', () => {
    mount({ showToggle: false });
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Source' })).toBeNull();
  });

  it('offers Read and Source when the Lesson has both', () => {
    mount({ showToggle: true });
    const tabs = screen.getByRole('tablist');
    expect(within(tabs).getByRole('tab', { name: 'Read' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(within(tabs).getByRole('tab', { name: 'Source' }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  it('reports the view the reader asked for', () => {
    const onViewChange = vi.fn();
    mount({ showToggle: true, onViewChange });
    fireEvent.click(screen.getByRole('tab', { name: 'Source' }));
    expect(onViewChange).toHaveBeenCalledWith('source');
  });
});

describe('the two companions announce whether they are open', () => {
  it('reads unpressed while the rail is closed', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Tutor' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(screen.getByRole('button', { name: 'Notes' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('presses only the tab that is actually showing', () => {
    mount({ railOpen: true, railTab: 'notes' });
    expect(screen.getByRole('button', { name: 'Notes' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Tutor' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('asks for the tab it was pressed for', () => {
    const onRailToggle = vi.fn();
    mount({ onRailToggle });
    fireEvent.click(screen.getByRole('button', { name: 'Tutor' }));
    expect(onRailToggle).toHaveBeenCalledWith('tutor');
  });
});

/* ── The header on the screen it belongs to ─────────────────────── */

const renderReader = async (lessonId = 'l-s-dbs-4') => {
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

describe('the reader mounts the header instead of an inline row', () => {
  it('leaves exactly one way out', async () => {
    await renderReader();
    expect(screen.getAllByRole('link', { name: 'Leave the reader' })).toHaveLength(1);
  });

  it('keeps the calm column exactly as it was', async () => {
    /*
     * "Summoned, never squatting": with the rail closed — which is always,
     * until Task 3 — the article is the same column it has always been. The
     * `52ch` measure was arrived at by measuring in a browser twice, and the
     * first attempt failed because `max-w-2xl` was silently binding. Both
     * numbers are asserted so neither can be lost to the new chrome.
     */
    const { container } = await renderReader();
    const article = container.querySelector('article')!;
    expect(article.className).toContain('max-w-2xl');
    for (const p of article.querySelectorAll('section p')) {
      expect(p.className).toContain('max-w-[52ch]');
    }
  });

  it('does not hide the first line under the header', async () => {
    // 56px of fixed chrome over a column with `pt-6` would have covered the
    // Lesson title. The article reserves the height instead.
    const { container } = await renderReader();
    const article = container.querySelector('article')!;
    expect(article.className).toMatch(/\bpt-(2[0-9]|\[1\d\dpx\])/);
  });

  it('opens and closes a companion from the header', async () => {
    await renderReader();
    const tutor = screen.getByRole('button', { name: 'Tutor' });
    fireEvent.click(tutor);
    expect(tutor.getAttribute('aria-pressed')).toBe('true');
    // Pressing the open tab again closes it rather than reopening it.
    fireEvent.click(tutor);
    expect(tutor.getAttribute('aria-pressed')).toBe('false');
  });

  it('swaps companions rather than stacking them', async () => {
    await renderReader();
    fireEvent.click(screen.getByRole('button', { name: 'Tutor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(screen.getByRole('button', { name: 'Tutor' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(screen.getByRole('button', { name: 'Notes' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the header on a Lesson whose text is not written yet', async () => {
    /*
     * The dead end used to be a bare centred paragraph with one link. It is
     * still honest about being unwritten, but it is no longer a different
     * screen: the way out, the breadcrumb and the companions are where they
     * are everywhere else in the reader.
     */
    await renderReader('l-s-dbs-3');
    expect(screen.getByText('Not written yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Leave the reader' })).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});
