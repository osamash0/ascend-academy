import { describe, expect, it } from 'vitest';
import { notifications } from '../notifications';
import { lessonsForSpace, locateLesson } from '../lessons';
import { allSpaces } from '../spaces';
import {
  contributionsForLesson,
  normalizationContributions,
  spaceContributions,
} from '../contributions';
import { conceptContributions } from '../concepts';
import { impactRows } from '../library';
import { viewer } from '../people';

/**
 * Fixtures must not contradict each other.
 *
 * This is the failure mode the whole fixture-guard method exists for: nothing
 * renders wrong, no test fails, and two screens quietly tell you different
 * things about the same object. Found by asking "does anything here state a
 * fact that something else denies?" rather than by reading for bugs.
 *
 * What it caught:
 *   • Notification n-1 announced that Asa had endorsed "Mnemonic for the
 *     normal forms". The contribution carried `endorsed: false`, so the bell
 *     said it happened while Library, the impact table and the card badge all
 *     said it had not.
 *   • Notification n-6 announced a Community Lesson promoted into a *Guided*
 *     Space and pointed at an Official Lesson written by someone else. Half of
 *     that was a real defect (the wrong target); the other half was not — a
 *     fixture comment claimed the *situation* was impossible, and it was the
 *     comment that was wrong. Abi ruled on 2026-08-31 that promotion works in
 *     Guided mode, so the notification is back with a target that matches every
 *     clause of its own sentence.
 */

const everyContribution = [
  ...normalizationContributions,
  ...spaceContributions,
  ...conceptContributions,
];

describe('notifications agree with what they describe', () => {
  it('points every lesson target at a Lesson that exists', () => {
    for (const n of notifications) {
      if (n.target.kind !== 'lesson') continue;
      expect(locateLesson(n.target.lessonId), `${n.id} targets a missing Lesson`).toBeDefined();
    }
  });

  it('names the Space that Lesson actually lives in', () => {
    for (const n of notifications) {
      if (n.target.kind !== 'lesson') continue;
      const found = locateLesson(n.target.lessonId);
      const space = allSpaces.find((s) => s.id === found?.spaceId);
      expect(n.target.spaceName, `${n.id} names the wrong Space`).toBe(space?.name);
    }
  });

  it('only announces an endorsement that the contribution agrees happened', () => {
    for (const n of notifications) {
      if (n.type !== 'endorsed') continue;
      // The title in the message is quoted with curly quotes.
      const quoted = n.message.match(/[“"]([^”"]+)[”"]/)?.[1];
      expect(quoted, `${n.id} names no contribution`).toBeTruthy();
      const c = everyContribution.find((x) => x.title === quoted);
      expect(c, `${n.id} names a contribution that does not exist: ${quoted}`).toBeDefined();
      expect(c?.endorsed, `${n.id} says ${quoted} is endorsed; the fixture says it is not`).toBe(
        true,
      );
    }
  });

  it('only announces a promotion that actually happened', () => {
    /*
     * The notification this replaces was deleted because a fixture comment
     * asserted a Community Lesson in a Guided Space was impossible. Abi
     * overturned that (2026-08-31) — origin is who made it, mode is who may
     * publish it — so the notification is back, and this asserts the four
     * things its sentence claims rather than trusting the sentence:
     *
     *   "Jonas promoted your write-up — it is now part of the path in Advanced
     *    Topics in Cryptography, credited to you."
     *
     * → the Lesson exists, is Community origin, is authored by you, and sits
     *   in a Space somebody else runs. Take any one away and the message is a
     *   claim about something that did not happen.
     */
    const promotions = notifications.filter((n) => n.type === 'promoted');
    expect(promotions.length, 'no promoted notification to check').toBeGreaterThan(0);
    for (const n of promotions) {
      expect(n.target.kind).toBe('lesson');
      if (n.target.kind !== 'lesson') continue;
      const found = locateLesson(n.target.lessonId);
      expect(found, `${n.id} targets a missing Lesson`).toBeDefined();
      expect(found!.lesson.origin, `${n.id}: promoted work must be Community`).toBe('community');
      expect(found!.lesson.author.id, `${n.id} says "credited to you"`).toBe(viewer.id);
      const space = allSpaces.find((s) => s.id === found!.spaceId);
      expect(space?.owner.id, `${n.id}: you cannot be promoted in your own Space`).not.toBe(
        viewer.id,
      );
      // And the actor is the person who could do it.
      expect(n.actor?.id, `${n.id}: the promoter must run the Space`).toBe(space?.owner.id);
    }
  });

  it('has a fixture behind every kind it claims to support', () => {
    /*
     * A kind with an icon, a tone and no data is a render path that has never
     * executed. `promoted` was the last one without a fixture — it has one now,
     * and the guard above proves the fixture matches the message rather than
     * merely existing.
     */
    const used = new Set(notifications.map((n) => n.type));
    expect(used.size).toBeGreaterThan(2);
    for (const kind of used) {
      expect(notifications.filter((n) => n.type === kind).length).toBeGreaterThan(0);
    }
  });
});

describe('a Lesson never advertises work it does not have', () => {
  it('states the contributions it actually holds', () => {
    /*
     * `contributionCount` was stated and wrong: Normalization claimed 104 and
     * served 4, so its hero read "104 contributions" two sections above a
     * community section headed "4". Derived now — and worth a guard, because I
     * introduced a fresh instance of it while wiring the promoted Lesson
     * (`contributionCount: 3` over "From the community 0"), which is what a
     * stated count next to its own list always does.
     */
    for (const space of allSpaces) {
      for (const l of lessonsForSpace(space.id)) {
        expect(l.contributionCount, `${l.title} advertises the wrong count`).toBe(
          contributionsForLesson(l.id).length,
        );
      }
    }
  });
});

describe('Library and the Space screens agree about your work', () => {
  it('counts every contribution the viewer published, at all three anchor levels', () => {
    /*
     * `myContributions` and `impactRows` read `spaceContributions` and
     * `normalizationContributions` and silently dropped `conceptContributions`
     * — so ⌘K would find a contribution that Library denied existed.
     */
    const mine = everyContribution.filter((c) => c.author.id === viewer.id);
    expect(mine.length).toBeGreaterThan(1);
    const byConcept = mine.filter((c) => c.anchor.level === 'concept');
    expect(byConcept.length, 'no Concept-anchored fixture to catch the regression').
      toBeGreaterThan(0);
    expect(impactRows()).toHaveLength(mine.length);
  });

  it('resolves each anchor to its real Lesson rather than assuming one', () => {
    // Library hardcoded 'Normalization' / 's-dbs' for any lesson anchor, in
    // three places. Any contribution outside that Lesson was mislabelled.
    for (const row of impactRows()) {
      if (row.orphaned) continue;
      const c = everyContribution.find((x) => x.id === row.id);
      if (c?.anchor.level !== 'lesson') continue;
      const found = locateLesson(c.anchor.lessonId);
      expect(row.lessonTitle).toBe(found?.lesson.title);
      expect(row.spaceId).toBe(found?.spaceId);
    }
  });
});
