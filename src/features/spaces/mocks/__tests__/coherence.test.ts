import { describe, expect, it } from 'vitest';
import { notifications } from '../notifications';
import { locateLesson } from '../lessons';
import { allSpaces } from '../spaces';
import { normalizationContributions, spaceContributions } from '../contributions';
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
 *     Space, which the Lesson fixtures state is impossible by definition, and
 *     pointed at an Official Lesson written by someone else.
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

  it('has a fixture behind every kind it claims to support', () => {
    /*
     * A kind with an icon, a tone and no data is a render path that has never
     * executed. `promoted` was removed rather than faked: the only Open Space
     * is owned by the viewer, so "someone promoted your work" has nothing to
     * describe. That is a doc conflict, recorded in the report, not a bug to
     * paper over here.
     */
    const used = new Set(notifications.map((n) => n.type));
    expect(used.size).toBeGreaterThan(2);
    for (const kind of used) {
      expect(notifications.filter((n) => n.type === kind).length).toBeGreaterThan(0);
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
