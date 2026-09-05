import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  anchorFor,
  isOrphaned,
  isReanchored,
  reanchor,
  reanchorTargets,
  reanchoredLessonId,
  resetReanchors,
} from '../reanchor';
import { impactRows, libraryItems, myContributionById } from '../library';
import { linalgContributions, normalizationContributions, spaceContributions } from '../contributions';
import { conceptContributions } from '../concepts';
import { lessonsForSpace, locateLesson, publishedLessonsForSpace } from '../lessons';
import type { Contribution } from '../../types';
import { search } from '../search';
import { canReanchor } from '../reanchor';
import { contributionsForLesson } from '../contributions';
import { keller, viewer } from '../people';

/**
 * Re-anchoring an orphan.
 *
 * The state existed and the repair did not: Library said "pick a new place for
 * it" and nothing in the product picked one. These pin the rules the mutation
 * enforces, and — more importantly — that a single move is visible in *every*
 * surface that reads a contribution, which is the part that silently rots when
 * one of them keeps reading `c.anchor` directly.
 */

const everyContribution = [
  ...normalizationContributions,
  ...spaceContributions,
  ...linalgContributions,
  ...conceptContributions,
];

const anOrphan = () => {
  const c = everyContribution.find((x) => x.orphaned);
  if (!c) throw new Error('no orphan fixture — these guards would prove nothing');
  return c;
};

/** A published Lesson in the Space the orphan came from. */
const aTarget = () => {
  const c = anOrphan();
  const spaceId = (c.anchor as { spaceId?: string }).spaceId!;
  const l = publishedLessonsForSpace(spaceId)[0];
  if (!l) throw new Error(`no published Lesson in ${spaceId}`);
  return l;
};

/**
 * An orphan shaped like the fixture but anchored wherever a test needs.
 *
 * The refusal rules cannot all be exercised against the real one: it lives in
 * Database Systems, where every Lesson is published, so there is no draft
 * there to be refused. Constructing the subject keeps each rule tested for its
 * own reason rather than passing because some other rule fired first.
 */
const orphanFrom = (spaceId: string): Contribution => ({
  ...anOrphan(),
  id: `c-synthetic-${spaceId}`,
  anchor: { level: 'lesson', lessonId: `l-${spaceId}-gone`, spaceId },
});

beforeEach(() => resetReanchors());
afterEach(() => resetReanchors());

describe('the fixtures can exercise this at all', () => {
  it('has an orphan, and somewhere to put it', () => {
    expect(anOrphan().orphaned).toBe(true);
    expect(aTarget().state).toBe('published');
  });
});

describe('what a move is allowed to do', () => {
  it('moves an orphan to a published Lesson', () => {
    const c = anOrphan();
    const l = aTarget();
    expect(reanchor(c, l.id, null)).toBe(true);
    expect(reanchoredLessonId(c.id)).toBe(l.id);
    expect(anchorFor(c)).toEqual({ level: 'lesson', lessonId: l.id });
  });

  it('stops calling it an orphan once it has a home', () => {
    // `c.orphaned` is how it started and stays true forever; the warning must
    // not outlive the problem.
    const c = anOrphan();
    expect(isOrphaned(c)).toBe(true);
    reanchor(c, aTarget().id, null);
    expect(isOrphaned(c), 'still warning after it was given a Lesson').toBe(false);
    expect(isReanchored(c)).toBe(true);
    expect(c.orphaned, 'the fixture itself was mutated').toBe(true);
  });

  it('refuses a Lesson that does not exist', () => {
    // Re-pointing dangling work at another dangling id looks like a fix and is
    // the same problem.
    const c = anOrphan();
    expect(reanchor(c, 'l-does-not-exist', null)).toBe(false);
    expect(isOrphaned(c), 'a refused move still moved it').toBe(true);
    expect(reanchoredLessonId(c.id)).toBeUndefined();
  });

  it('refuses a Lesson that is not published', () => {
    // Same Space, so the only thing that can refuse it is its state.
    const draft = lessonsForSpace('s-linalg').find((l) => l.state !== 'published');
    expect(draft, 'no unpublished Lesson in s-linalg to test against').toBeTruthy();
    const c = orphanFrom('s-linalg');
    expect(reanchor(c, draft!.id, null)).toBe(false);
    expect(isOrphaned(c)).toBe(true);
  });

  it('refuses a published Lesson in a different Space', () => {
    /*
     * The dialog only offers Lessons from the orphan's own Space, but a rule
     * enforced only by which options are rendered is one caller away from
     * being false. Moving work between Spaces changes who can read it.
     */
    const c = orphanFrom('s-linalg');
    const elsewhere = publishedLessonsForSpace('s-dbs')[0];
    expect(elsewhere, 'no published Lesson in s-dbs to test against').toBeTruthy();
    expect(reanchor(c, elsewhere.id, null), 'an orphan escaped into another Space').toBe(false);
    expect(reanchoredLessonId(c.id)).toBeUndefined();
  });

  it('refuses to move something that is not an orphan', () => {
    // Repair, not a general "move" — that would be a different feature and a
    // permissions question.
    const settled = everyContribution.find((x) => !x.orphaned && x.anchor.level === 'lesson');
    expect(settled, 'no settled contribution to test against').toBeTruthy();
    expect(reanchor(settled!, aTarget().id, null)).toBe(false);
    expect(reanchoredLessonId(settled!.id)).toBeUndefined();
  });

  it('refuses to move the same orphan twice', () => {
    const c = anOrphan();
    const targets = publishedLessonsForSpace((c.anchor as { spaceId?: string }).spaceId!);
    expect(targets.length, 'need two Lessons to attempt a second move').toBeGreaterThan(1);
    expect(reanchor(c, targets[0].id, null)).toBe(true);
    expect(reanchor(c, targets[1].id, null), 'a settled contribution was moved again').toBe(false);
    expect(reanchoredLessonId(c.id)).toBe(targets[0].id);
  });

  it('only ever offers published Lessons as destinations', () => {
    const spaceId = (anOrphan().anchor as { spaceId?: string }).spaceId!;
    const offered = reanchorTargets(spaceId);
    expect(offered.length).toBeGreaterThan(0);
    for (const l of offered) expect(l.state, `${l.title} is offered but not published`).toBe('published');
  });
});

describe('one move, visible everywhere', () => {
  /*
   * The failure this is really for: a surface that keeps reading `c.anchor`
   * instead of `anchorFor(c)`. It would look perfectly correct in isolation and
   * disagree with every other screen about where the work lives.
   */
  it('updates the Library row', () => {
    const c = anOrphan();
    const before = libraryItems().find((i) => i.id === `lib-con-${c.id}`);
    expect(before?.orphaned, 'the row does not start out orphaned').toBe(true);

    const l = aTarget();
    reanchor(c, l.id, null);

    const after = libraryItems().find((i) => i.id === `lib-con-${c.id}`);
    expect(after, 'the row vanished after the move').toBeTruthy();
    expect(after!.orphaned, 'the Library row still warns').toBe(false);
    expect(after!.lessonTitle, 'the row does not name its new Lesson').toBe(l.title);
    expect(after!.href, 'the row still does not open anywhere').toContain(`/lesson/${l.id}`);
  });

  it('updates the Studio impact row', () => {
    const c = anOrphan();
    expect(impactRows().find((r) => r.id === c.id)?.orphaned).toBe(true);
    reanchor(c, aTarget().id, null);
    const row = impactRows().find((r) => r.id === c.id);
    expect(row?.orphaned, 'the impact view still says it needs a new home').toBe(false);
    expect(row?.lessonTitle).toBe(aTarget().title);
  });

  it('updates search', () => {
    const c = anOrphan();
    const l = aTarget();
    reanchor(c, l.id, null);
    const hit = search(c.title).contributions.find((r) => r.title === c.title);
    expect(hit, `"${c.title}" is not findable`).toBeTruthy();
    expect(hit!.href, 'search still points at the deleted Lesson').toContain(`/lesson/${l.id}`);
  });

  it('keeps the likes and the endorsement', () => {
    // The dialog promises this in so many words.
    const c = anOrphan();
    const before = libraryItems().find((i) => i.id === `lib-con-${c.id}`)!;
    reanchor(c, aTarget().id, null);
    const after = libraryItems().find((i) => i.id === `lib-con-${c.id}`)!;
    expect(after.likeCount).toBe(before.likeCount);
    expect(after.endorsed).toBe(before.endorsed);
  });
});

describe('the store resets between tests', () => {
  it('starts from the seed', () => {
    const c = anOrphan();
    expect(
      isReanchored(c),
      'a move leaked out of another test — resetReanchors is not wired',
    ).toBe(false);
  });

  it('is reachable from a Library row id', () => {
    // How the screen gets from a row back to the contribution.
    const c = anOrphan();
    const item = libraryItems().find((i) => i.id === `lib-con-${c.id}`)!;
    expect(myContributionById(item.id.replace(/^lib-con-/, ''))?.id).toBe(c.id);
  });
});

describe('who may re-file an orphan', () => {
  /*
   * Doc 1 surfaces an orphan to the Owner *and* the author, and both may fix
   * it. The first version of `reanchor` had no permission check at all — every
   * caller happened to be the author, because Library is author-filtered, so
   * it was safe by accident. The Owner surface is the second caller that would
   * have made that false.
   *
   * The one orphan fixture is viewer-authored, so somebody else's orphan has
   * to be constructed.
   */
  const someoneElsesOrphan = (): Contribution => ({
    ...anOrphan(),
    id: 'c-synthetic-theirs',
    author: keller,
  });

  it('lets the author re-file their own, with no role in the Space', () => {
    const mine = anOrphan();
    expect(mine.author.id).toBe(viewer.id);
    expect(canReanchor(mine, null)).toBe(true);
  });

  it('lets an Owner and an Editor re-file somebody else’s', () => {
    const theirs = someoneElsesOrphan();
    expect(canReanchor(theirs, 'owner')).toBe(true);
    expect(canReanchor(theirs, 'editor')).toBe(true);
  });

  it('refuses a plain Member somebody else’s work', () => {
    const theirs = someoneElsesOrphan();
    expect(canReanchor(theirs, 'member'), 'a Member can move another’s work').toBe(false);
    expect(canReanchor(theirs, null), 'a non-member can move another’s work').toBe(false);
  });

  it('refuses everyone once it is not an orphan', () => {
    const c = anOrphan();
    reanchor(c, aTarget().id, null);
    expect(canReanchor(c, 'owner'), 'still offering to re-file a settled contribution').toBe(
      false,
    );
    expect(canReanchor(c, null)).toBe(false);
  });

  it('enforces it in the mutation, not only in the question', () => {
    // A screen that forgot to ask `canReanchor` must still be refused.
    const theirs = someoneElsesOrphan();
    expect(reanchor(theirs, aTarget().id, 'member'), 'a Member moved another’s work').toBe(
      false,
    );
    expect(reanchoredLessonId(theirs.id)).toBeUndefined();
    expect(reanchor(theirs, aTarget().id, 'owner')).toBe(true);
  });
});

describe('the moved contribution actually appears on its new Lesson', () => {
  /*
   * The promise the dialog makes in so many words: "it will sit there
   * instead". `contributionsForLesson` read a hand-written `byLesson` index
   * and the raw `c.anchor`, so it could not see an override at all — the move
   * would have looked right in Library and the Lesson would never have shown
   * it.
   */
  it('is listed on the Lesson it was moved to', () => {
    const c = anOrphan();
    const l = aTarget();
    expect(
      contributionsForLesson(l.id).some((x) => x.id === c.id),
      'it is somehow already there',
    ).toBe(false);

    reanchor(c, l.id, null);

    expect(
      contributionsForLesson(l.id).some((x) => x.id === c.id),
      'moved, but the Lesson does not list it',
    ).toBe(true);
  });

  it('still lists everything that was already on that Lesson', () => {
    // The index it replaced mapped whole fixture groups to a Lesson; this is
    // the check that the anchor-driven version did not quietly drop any.
    /*
     * Deliberately a Lesson that already has contributions — `aTarget()` is
     * the Space's first Lesson and has none, so moving onto it would prove
     * nothing about preservation.
     */
    const busiest = publishedLessonsForSpace('s-dbs')
      .map((l) => ({ l, on: contributionsForLesson(l.id).length }))
      .sort((a, b) => b.on - a.on)[0];
    expect(busiest.on, 'no Lesson in s-dbs has contributions to preserve').toBeGreaterThan(0);
    const l = busiest.l;
    const before = contributionsForLesson(l.id).map((x) => x.id).sort();
    reanchor(anOrphan(), l.id, null);
    const after = contributionsForLesson(l.id).map((x) => x.id).sort();
    for (const id of before) expect(after, `${id} fell off the Lesson`).toContain(id);
  });
});

describe('the count agrees with the list it counts', () => {
  /*
   * `lesson()` derives `contributionCount` from `contributionsForLesson`, which
   * killed a whole class of "hero says 104, section says 4" bugs. But it
   * derived it *once, at module load* — and once the set can change, a value
   * computed at load is just a stated count with extra steps. Moving a
   * contribution onto a Lesson made its hero read "2 contributions" directly
   * above a community section headed "3".
   *
   * Found in a screenshot, not by a test: every existing guard compared the
   * count against the same snapshot it was built from, so all of them agreed
   * with each other and none of them with the screen.
   */
  it('still matches after a contribution is moved onto the Lesson', () => {
    const c = anOrphan();
    const l = aTarget();
    const before = locateLesson(l.id)!.lesson.contributionCount;
    expect(before).toBe(contributionsForLesson(l.id).length);

    reanchor(c, l.id, null);

    const after = locateLesson(l.id)!.lesson.contributionCount;
    expect(after, 'the Lesson did not notice it gained a contribution').toBe(before + 1);
    expect(
      after,
      'the stated count and the list disagree — the hero will contradict the section',
    ).toBe(contributionsForLesson(l.id).length);
  });

  it('matches on every Lesson, before anything moves', () => {
    // The general invariant, so this is not only about re-anchoring.
    for (const spaceId of ['s-dbs', 's-linalg']) {
      for (const l of lessonsForSpace(spaceId)) {
        expect(l.contributionCount, `${l.title} states a count its list disagrees with`).toBe(
          contributionsForLesson(l.id).length,
        );
      }
    }
  });
});
