import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  linalgContributions,
  normalizationContributions,
  spaceContributions,
} from '../contributions';
import { conceptContributions } from '../concepts';
import { resolveContributionAnchor } from '../library';
import { anchorFor, reanchor, resetReanchors } from '../reanchor';
import { publishedLessonsForSpace } from '../lessons';

/**
 * A Person's published work resolves like everywhere else.
 *
 * `PersonScreen` hand-rolled anchor resolution — `level === 'lesson'` and
 * `level === 'space'`, and nothing for `concept`. So a Concept-anchored
 * contribution fell through to `href: null` and rendered under the label
 * "Needs a new home": four fixtures, by four different people, each shown on
 * their own page as work that had lost its Lesson when nothing had happened to
 * it. `resolveContributionAnchor`'s own doc comment records the previous
 * version of that same bug — it "silently dropped `concept` entirely" — which
 * is what a second copy of a rule buys you.
 *
 * These guard the shape rather than the screen: that every anchor a Person
 * page can hold resolves, and that the screen goes through the shared
 * resolver instead of growing another copy.
 */

const everyContribution = [
  ...normalizationContributions,
  ...spaceContributions,
  ...linalgContributions,
  ...conceptContributions,
];

const SCREEN = join(process.cwd(), 'src/features/spaces/screens/PersonScreen.tsx');
const source = () =>
  readFileSync(SCREEN, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');

beforeEach(() => resetReanchors());
afterEach(() => resetReanchors());

describe('every anchor level resolves', () => {
  it('has a Concept-anchored contribution to check, or this proves nothing', () => {
    const concept = everyContribution.filter((c) => c.anchor.level === 'concept');
    expect(concept.length, 'no Concept-anchored fixture').toBeGreaterThan(0);
  });

  it('gives a Concept anchor somewhere to open', () => {
    for (const c of everyContribution.filter((x) => x.anchor.level === 'concept')) {
      const at = resolveContributionAnchor(anchorFor(c), c.id);
      expect(at.href, `"${c.title}" is Concept-anchored and opens nowhere`).toBeTruthy();
      expect(at.href).toContain('/concept/');
    }
  });

  it('leaves only genuine orphans without a destination', () => {
    /*
     * The invariant the screen's "Needs a new home" branch depends on: if a
     * contribution has no href, it is because it is an orphan — not because
     * the resolver failed to handle its anchor level.
     */
    for (const c of everyContribution) {
      const at = resolveContributionAnchor(anchorFor(c), c.id);
      if (at.href) continue;
      expect(c.orphaned, `"${c.title}" opens nowhere and is not an orphan`).toBe(true);
    }
  });

  it('follows a re-anchored orphan to its new Lesson', () => {
    const orphan = everyContribution.find((c) => c.orphaned && c.anchor.level === 'lesson');
    expect(orphan, 'no orphan fixture').toBeTruthy();
    const spaceId = (orphan!.anchor as { spaceId?: string }).spaceId!;
    const target = publishedLessonsForSpace(spaceId)[0];

    expect(resolveContributionAnchor(anchorFor(orphan!), orphan!.id).href).toBeNull();
    expect(reanchor(orphan!, target.id, null)).toBe(true);
    expect(
      resolveContributionAnchor(anchorFor(orphan!), orphan!.id).href,
      'the Person page would still point at the deleted Lesson',
    ).toContain(`/lesson/${target.id}`);
  });
});

describe('the Person page does not keep its own copy of the rules', () => {
  it('resolves through the shared resolver', () => {
    const src = source();
    expect(src, 'PersonScreen resolves anchors itself again').toContain(
      'resolveContributionAnchor',
    );
    expect(src, 'PersonScreen reads the raw anchor instead of the override').not.toMatch(
      /c\.anchor\.level/,
    );
  });

  it('assembles every contribution group', () => {
    /*
     * Four hand-written "all the contributions" lists in this codebase have
     * now been found short of `linalgContributions` — `myPublished`,
     * `coherence.test`, `contributionsForLesson`'s old index, and this screen,
     * where it meant Ferreira's two Linear Algebra pieces were missing from
     * her own page under a heading that counts them.
     */
    const src = source();
    for (const group of [
      'normalizationContributions',
      'spaceContributions',
      'linalgContributions',
      'conceptContributions',
    ]) {
      expect(src, `PersonScreen never looks at ${group}`).toContain(group);
    }
  });
});
