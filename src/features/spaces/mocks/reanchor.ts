import type { Contribution, ContributionAnchor } from '../types';
import { locateLesson, publishedLessonsForSpace } from './lessons';

/**
 * Giving an orphaned contribution a new Lesson.
 *
 * Doc 1, Contributions rule 1 surfaces an orphan to the Owner *and* the author
 * so it can be re-filed; until now Library only reported the state, and its
 * copy told you to "pick a new place for it" with nothing anywhere that
 * picked one.
 *
 * **Its own module, because of an import cycle.** The obvious home is
 * `contributions.ts`, but validating the destination needs `locateLesson`, and
 * `lessons.ts` already imports `contributions.ts` — so the store would have
 * closed a loop. Nothing imports this file except the read paths in
 * `library.ts` / `search.ts` and the dialog, so the arrow only points one way.
 *
 * An overlay keyed by id rather than a mutation of the fixture, for the same
 * reason `moderation.ts` keeps endorsed/hidden/promoted as id sets: the
 * fixtures are the seed and have to stay reproducible between tests.
 */

const reanchoredTo = new Map<string, string>();

/** Test seam — the overlay is mutable, so each test starts from the seed. */
export const resetReanchors = (): void => {
  reanchoredTo.clear();
};

/** The Lesson an orphan was moved to this session, if any. */
export const reanchoredLessonId = (contributionId: string): string | undefined =>
  reanchoredTo.get(contributionId);

/** True once an orphan has been given a home. */
export const isReanchored = (c: Contribution): boolean => reanchoredTo.has(c.id);

/**
 * The anchor to actually use — the override if there is one, else the fixture's.
 *
 * Every read path resolves through this rather than reading `c.anchor`
 * directly, which is what makes one re-anchor show up in Library, the impact
 * view and search together instead of in whichever surface remembered to ask.
 */
export const anchorFor = (c: Contribution): ContributionAnchor => {
  const lessonId = reanchoredTo.get(c.id);
  return lessonId ? { level: 'lesson', lessonId } : c.anchor;
};

/**
 * Whether this contribution still needs a home.
 *
 * Derived, not read off the fixture: `c.orphaned` says how it started, and
 * stays true forever. A row must stop calling itself orphaned the moment it
 * has somewhere to live, or the warning outlives the problem.
 */
export const isOrphaned = (c: Contribution): boolean => c.orphaned && !reanchoredTo.has(c.id);

/**
 * The Lessons an orphan may be moved to.
 *
 * Published only. A draft is not a place to put work that is already
 * published — it would be visible to its author and nobody else, which is a
 * quieter version of the same disappearance.
 */
export const reanchorTargets = (spaceId: string) => publishedLessonsForSpace(spaceId);

/**
 * Give an orphaned contribution a new Lesson.
 *
 * Refuses four things, and returns whether it took so no caller can report a
 * success it did not get:
 *
 *   • anything that is not currently an orphan — this is repair, not a general
 *     "move", which would be a different feature and a permissions question;
 *   • a Lesson that does not exist, because re-pointing dangling work at
 *     another dangling id looks like a fix and is the same problem;
 *   • a Lesson that is not published, for the reason in `reanchorTargets`;
 *   • a Lesson in a different Space.
 *
 * The last one is here because the dialog only ever offers Lessons from the
 * orphan's own Space, and a rule enforced solely by which options get rendered
 * is not enforced at all — it is one caller away from being false. Moving work
 * between Spaces is a visibility change (a different set of Members can
 * suddenly read it), which is emphatically not what "find it a new home"
 * means.
 */
export const reanchor = (c: Contribution, lessonId: string): boolean => {
  if (!isOrphaned(c)) return false;
  const found = locateLesson(lessonId);
  if (!found) return false;
  if (found.lesson.state !== 'published') return false;
  const home = homeSpaceOf(c);
  if (home && found.spaceId !== home) return false;
  reanchoredTo.set(c.id, lessonId);
  return true;
};

/** The Space an orphan belongs to — from the anchor, which still records it. */
const homeSpaceOf = (c: Contribution): string | undefined => {
  if (c.anchor.level === 'space') return c.anchor.spaceId;
  if (c.anchor.level === 'lesson') return c.anchor.spaceId;
  return undefined;
};
