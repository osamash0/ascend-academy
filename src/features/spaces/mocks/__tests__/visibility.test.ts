import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allSpaces, spaceById } from '../spaces';
import { allConcepts } from '../concepts';
import { lessonsForSpace, visibleLesson, visibleLessonsForSpace } from '../lessons';

/**
 * Rule 1: Members only ever see published Lessons.
 *
 * The rule was real and enforced — in `useSpace`. `LessonScreen`,
 * `ConceptScreen` and `PracticeScreen` each did their own
 * `lessonsForSpace(id).find(...)` and so served an unpublished Lesson to
 * anyone holding the URL, with no Draft marker anywhere on the screen. Three
 * screens, one rule, and the rule lived somewhere none of them looked.
 *
 * These guards therefore assert two different things: that the filter is
 * correct, and that no screen bypasses it.
 */

const SRC = join(process.cwd(), 'src/features/spaces');
const read = (p: string) =>
  readFileSync(join(SRC, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('a Member never sees an unpublished Lesson', () => {
  it('filters drafts out for Members and outsiders', () => {
    for (const space of allSpaces) {
      if (space.viewerRole === 'owner' || space.viewerRole === 'editor') continue;
      for (const lesson of visibleLessonsForSpace(space)) {
        expect(lesson.state, `${space.id}/${lesson.id} leaked to a ${space.viewerRole}`).toBe(
          'published',
        );
      }
    }
  });

  it('keeps drafts reachable for the people who own them', () => {
    // The fix must not lock authors out of their own unpublished work — that
    // is what the Studio drafts list links to.
    const owned = allSpaces.filter((s) => s.viewerRole === 'owner' || s.viewerRole === 'editor');
    expect(owned.length).toBeGreaterThan(0);
    for (const space of owned) {
      expect(visibleLessonsForSpace(space)).toHaveLength(lessonsForSpace(space.id).length);
    }
  });

  it('refuses a draft asked for by id', () => {
    // The concrete URL that leaked: a draft in a Space the viewer only reads.
    const leaky = allSpaces
      .filter((s) => s.viewerRole !== 'owner' && s.viewerRole !== 'editor')
      .flatMap((s) =>
        lessonsForSpace(s.id)
          .filter((l) => l.state !== 'published')
          .map((l) => [s, l] as const),
      );
    expect(leaky.length, 'no unpublished fixture in a read-only Space to test against').
      toBeGreaterThan(0);
    for (const [space, lesson] of leaky) {
      expect(visibleLesson(space, lesson.id), `${space.id}/${lesson.id} still reachable`).
        toBeUndefined();
    }
  });

  it('is not bypassed by any screen', () => {
    /*
     * The screens must ask the visibility-aware question. `lessonsForSpace`
     * takes a bare id and so cannot know who is asking — which is exactly why
     * it was easy to reach for.
     */
    for (const f of [
      'screens/LessonScreen.tsx',
      'screens/ConceptScreen.tsx',
      'screens/PracticeScreen.tsx',
      'screens/SpaceScreen.tsx',
    ]) {
      expect(read(f), `${f} does its own unfiltered lookup`).not.toMatch(
        /[^a-zA-Z]lessonsForSpace\(/,
      );
    }
  });
});

describe('a Concept never points outside its own Space', () => {
  it('every lessonId resolves to a Lesson in the Space the Concept claims', () => {
    /*
     * ConceptScreen intersects `concept.lessonIds` with the *visible* path, so
     * a dangling id silently shortens the "Appears in" list rather than
     * erroring — the idea would quietly claim to appear in fewer places than
     * it does, and nothing on screen would look wrong.
     */
    const concepts = allConcepts();
    expect(concepts.length).toBeGreaterThan(0);
    for (const c of concepts) {
      const space = spaceById(c.spaceId);
      expect(space, `${c.id} names an unknown Space ${c.spaceId}`).toBeDefined();
      const inSpace = new Set(lessonsForSpace(c.spaceId).map((l) => l.id));
      for (const id of c.lessonIds) {
        expect(inSpace.has(id), `${c.id} points at ${id}, not in ${c.spaceId}`).toBe(true);
      }
    }
  });
});
