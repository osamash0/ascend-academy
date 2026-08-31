import type { Contribution, ContributionAnchor } from '../types';

/**
 * Where a re-anchored orphan now lives: contribution id → Lesson id.
 *
 * **Split out from `reanchor.ts` with no imports but types, deliberately.**
 * The validated `reanchor()` needs `locateLesson`, and `lessons.ts` imports
 * `contributions.ts` — so any module holding both the store and the validation
 * is unreachable from `contributions.ts` without a cycle. And
 * `contributionsForLesson` has to read the override, or a contribution moved
 * to a Lesson never appears *on* that Lesson, which is the one thing the whole
 * feature promises.
 *
 * A file that imports nothing can be imported by anything. That is the entire
 * reason it exists.
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

/** Records a move. Validation lives in `reanchor.ts`; this only stores. */
export const setReanchor = (contributionId: string, lessonId: string): void => {
  reanchoredTo.set(contributionId, lessonId);
};

/**
 * The anchor to actually use — the override if there is one, else the fixture's.
 *
 * Every read path resolves through this rather than reading `c.anchor`
 * directly, which is what makes one move land in Library, the Space's
 * community section, the Lesson it moved to, the impact view and ⌘K together
 * instead of in whichever surface remembered to ask.
 */
export const anchorFor = (c: Contribution): ContributionAnchor => {
  const lessonId = reanchoredTo.get(c.id);
  return lessonId ? { level: 'lesson', lessonId } : c.anchor;
};

/**
 * Whether this contribution still needs a home.
 *
 * Derived, not read off the fixture: `c.orphaned` says how it started and
 * stays true forever. A surface reading it raw keeps warning after the problem
 * is fixed — which three of them were still doing after the first pass.
 */
export const isOrphaned = (c: Contribution): boolean => c.orphaned && !reanchoredTo.has(c.id);

/**
 * The Space a contribution belongs to, from the anchor alone.
 *
 * Works for an orphan, which is the point: its Lesson is gone, but a lesson
 * anchor still records the Space (see `ContributionAnchor`). Concept anchors
 * return undefined — they resolve through the Concept, and nothing re-anchors
 * them.
 */
export const homeSpaceOf = (c: Contribution): string | undefined => {
  if (c.anchor.level === 'space') return c.anchor.spaceId;
  if (c.anchor.level === 'lesson') return c.anchor.spaceId;
  return undefined;
};
