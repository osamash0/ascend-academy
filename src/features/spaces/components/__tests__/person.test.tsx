import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PersonScreen from '../../screens/PersonScreen';
import { conceptContributions } from '../../mocks/concepts';
import { linalgContributions } from '../../mocks/contributions';
import { resetReanchors } from '../../mocks/reanchor';

/**
 * A Person's published work, rendered.
 *
 * The companion mock guards assert that `resolveContributionAnchor` handles
 * every anchor level — and they passed while the screen was broken, because
 * the screen did not use it. It hand-rolled `level === 'lesson'` and
 * `level === 'space'` and had no branch for `concept`, so those contributions
 * fell through to `href: null` and rendered under "Needs a new home": work
 * shown to its own author as having lost its Lesson when nothing had happened
 * to it.
 *
 * The lesson is the reason this file exists next to the other one. Guards that
 * exercise the shared helper cannot see a screen that keeps its own copy of
 * the rules; only rendering the screen can.
 */

beforeEach(() => resetReanchors());
afterEach(() => resetReanchors());

const renderPerson = async (personId: string) => {
  const r = render(
    <MemoryRouter initialEntries={[`/v4/person/${personId}`]}>
      <Routes>
        <Route path="/v4/person/:personId" element={<PersonScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(document.querySelector('h1')).toBeTruthy(), { timeout: 3000 });
  return r;
};

/** The row for a contribution, by its title. */
const rowFor = (title: string) =>
  [...document.querySelectorAll('li')].find((li) => (li.textContent ?? '').includes(title));

describe('a Concept-anchored contribution opens', () => {
  const concept = conceptContributions.find((c) => c.author.id !== 'p-viewer');

  it('has one by somebody with a profile, or this proves nothing', () => {
    expect(concept, 'no Concept-anchored contribution by another person').toBeTruthy();
  });

  it('renders as a link to the Concept, not as an orphan', async () => {
    const c = concept!;
    const { unmount } = await renderPerson(c.author.id);

    const row = rowFor(c.title);
    expect(row, `"${c.title}" is missing from ${c.author.name}'s page`).toBeTruthy();

    const link = row!.querySelector('a');
    expect(link, `"${c.title}" is Concept-anchored and renders with nowhere to go`).toBeTruthy();
    expect(link!.getAttribute('href')).toContain('/concept/');
    expect(
      row!.textContent,
      'a Concept-anchored contribution is labelled as having lost its Lesson',
    ).not.toMatch(/Needs a new home/);
    unmount();
  });
});

describe('a Person page lists every group of their work', () => {
  it("shows an author's Linear Algebra contributions", async () => {
    /*
     * `linalgContributions` was missing from the screen's hand-assembled list
     * — the fourth such omission of the same group in this codebase — so these
     * were absent from their author's own page, under a heading that counts
     * what they have published.
     */
    const mine = linalgContributions.filter((c) => c.author.id !== 'p-viewer' && !c.hidden);
    expect(mine.length, 'no Linear Algebra contribution to check').toBeGreaterThan(0);

    const author = mine[0].author;
    const { unmount } = await renderPerson(author.id);
    const theirs = mine.filter((c) => c.author.id === author.id);

    for (const c of theirs) {
      expect(
        rowFor(c.title),
        `"${c.title}" is missing from ${author.name}'s page`,
      ).toBeTruthy();
    }
    unmount();
  });
});
