import { describe, expect, it } from 'vitest';
import { hitCount, search } from '../search';
import { allSpaces } from '../spaces';

/**
 * Search guards — Doc 2 §"Search — ⌘K".
 *
 * Mirrors `searchService.GlobalSearchResults {lectures, slides, concepts,
 * worksheets}`, renamed to the v4 vocabulary. Four rules from the doc:
 * results group by object type, every result names its Space, search never
 * renders content inline, and it searches only what you can already see.
 */

describe('Search', () => {
  it('groups by object type', () => {
    const r = search('normal');
    expect(Object.keys(r)).toEqual(['spaces', 'lessons', 'concepts', 'contributions']);
  });

  it('names the Space on every result that lives in one', () => {
    const r = search('normal');
    for (const group of [r.lessons, r.concepts, r.contributions]) {
      for (const hit of group) expect(hit.spaceName.trim().length, hit.title).toBeGreaterThan(0);
    }
  });

  it('finds a Lesson by title', () => {
    expect(search('normalization').lessons.some((l) => /Normalization/i.test(l.title))).toBe(true);
  });

  it('finds a Concept by name', () => {
    expect(search('BCNF').concepts.length).toBeGreaterThan(0);
  });

  it('searches only what you can already see — never a private Space you are not in', () => {
    /*
     * Doc 2 rule 4: "published content in your Spaces, plus public Spaces."
     *
     * This used to end in `expect(true).toBe(true)` behind an
     * `if (privateNotMine)` that no fixture satisfied — a guard for the rule
     * with the most at stake, unable to fail. There is a fixture now, and the
     * assertion is unconditional.
     */
    const privateNotMine = allSpaces.find(
      (s) => s.visibility === 'private' && s.viewerRole === null,
    );
    expect(privateNotMine, 'no private-not-mine fixture — this guard is vacuous').toBeDefined();
    const hits = search(privateNotMine!.name);
    expect(hits.spaces.some((h) => h.id === privateNotMine!.id)).toBe(false);
    // Nor by any of its content, through any group.
    expect(hitCount(hits)).toBe(0);
  });

  it('never returns an unpublished Lesson', () => {
    for (const hit of search('e').lessons) expect(hit.state).toBe('published');
  });

  it('is empty for a query that matches nothing', () => {
    const r = search('zzzzzzzz');
    expect(r.spaces.length + r.lessons.length + r.concepts.length + r.contributions.length).toBe(0);
  });

  it('ignores a blank query rather than returning everything', () => {
    const r = search('  ');
    expect(r.spaces.length + r.lessons.length + r.concepts.length + r.contributions.length).toBe(0);
  });
});
