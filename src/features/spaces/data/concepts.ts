import * as fixtures from '../mocks/concepts';
import type { ConceptDetail, Contribution } from '../types';
import { liveWorld } from './world';

/**
 * One idea, and what was made for it.
 *
 * Demo: the fixture concepts. Live: derived from the world, the way the
 * fixtures derive theirs from the Lessons — a real concept id is shared by
 * every lecture that teaches it (`concept_lectures`), so its Lessons are the
 * world's Lessons that carry the id, in the Space asked about. Mastery is per
 * concept, so every carrier reports the same progress.
 */
export function conceptById(id: string, spaceId?: string): ConceptDetail | undefined {
  const world = liveWorld();
  if (!world) return fixtures.conceptById(id);

  const carriers = world.lessons
    .filter((l) => (!spaceId || l.spaceId === spaceId) && l.concepts.some((c) => c.id === id))
    .sort((a, b) => a.order - b.order);
  if (!carriers.length) return undefined;

  const first = carriers[0];
  const index = first.concepts.findIndex((c) => c.id === id);
  const concept = first.concepts[index];
  return {
    ...concept,
    // The same weight curve the fixtures use: central ideas first.
    weight: Math.round((1 - (index / Math.max(first.concepts.length, 1)) * 0.6) * 100) / 100,
    spaceId: first.spaceId,
    lessonIds: carriers.map((l) => l.id),
  };
}

/** Concept-anchored contributions. There is no contributions table yet, so live has none. */
export function contributionsForConcept(id: string): Contribution[] {
  return liveWorld() ? [] : fixtures.contributionsForConcept(id);
}
