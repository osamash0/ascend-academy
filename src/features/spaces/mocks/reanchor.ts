import type { Contribution, Role } from '../types';
import { locateLesson, publishedLessonsForSpace } from './lessons';
import { canModerate } from './moderation';
import { viewer } from './people';
import { homeSpaceOf, isOrphaned, setReanchor } from './reanchor-store';

/**
 * Giving an orphaned contribution a new Lesson.
 *
 * Doc 1, Contributions rule 1 surfaces an orphan to the Owner *and* the author
 * so it can be re-filed. Both halves can act on it: the author because it is
 * their work, the Owner and Editors because keeping the Space tidy is their
 * job and an author may never come back.
 *
 * The store is `reanchor-store.ts` — see the note there for why the state and
 * the validation live in different files.
 */

/** The overlay's read API, re-exported so callers have one import to reach for. */
export {
  anchorFor,
  isOrphaned,
  isReanchored,
  reanchoredLessonId,
  resetReanchors,
} from './reanchor-store';

/**
 * The Lessons an orphan may be moved to.
 *
 * Published only. A draft is not a place to put work that is already
 * published — it would be visible to its author and nobody else, which is a
 * quieter version of the same disappearance.
 */
export const reanchorTargets = (spaceId: string) => publishedLessonsForSpace(spaceId);

/**
 * Who may re-file an orphan: its author, or someone who moderates the Space.
 *
 * Takes the role rather than a boolean, matching `canModerate` and
 * `canEndorse` — "so a caller cannot ask the question without having
 * established who is asking". That shape earned itself here immediately: the
 * first version of `reanchor` had no permission check at all, because Library
 * is author-filtered and every caller was the author by construction. Safe by
 * accident is not safe; the Owner surface is exactly the second caller that
 * would have made it false.
 */
export const canReanchor = (c: Contribution, role: Role | null): boolean =>
  isOrphaned(c) && (c.author.id === viewer.id || canModerate(role));

/**
 * Give an orphaned contribution a new Lesson.
 *
 * Refuses five things, and returns whether it took so no caller can report a
 * success it did not get:
 *
 *   • anything that is not currently an orphan — this is repair, not a general
 *     "move", which would be a different feature and a permissions question;
 *   • a viewer who is neither the author nor a moderator of the Space;
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
export const reanchor = (c: Contribution, lessonId: string, role: Role | null): boolean => {
  if (!canReanchor(c, role)) return false;
  const found = locateLesson(lessonId);
  if (!found) return false;
  if (found.lesson.state !== 'published') return false;
  const home = homeSpaceOf(c);
  if (home && found.spaceId !== home) return false;
  setReanchor(c.id, lessonId);
  return true;
};
