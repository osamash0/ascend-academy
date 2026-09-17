import { describe, expect, it } from 'vitest';
import { allConcepts, conceptById, conceptContributions, contributionsForConcept } from '../concepts';
import { lessonsForSpace } from '../lessons';
import { allSpaces } from '../spaces';

/**
 * Concept guards.
 *
 * A Concept is "a single idea inside a Lesson" (Doc 1) — the map's planet, and
 * one of the three contribution anchors. The shape mirrors what the backend
 * already serves: conceptsService.LectureConcept carries {concept_id, name,
 * weight, slide_indices}, and RelatedLecture answers "which Lessons touch this
 * Concept". Both are real endpoints today, so this stays a swap, not a
 * feature request.
 */

describe('Concept fixtures', () => {
  it('anchors every Concept to at least one Lesson', () => {
    // A Concept with no Lesson is unreachable: nothing would ever link to it.
    expect(allConcepts().length).toBeGreaterThan(0);
    for (const c of allConcepts()) {
      expect(c.lessonIds.length, `${c.name} is orphaned`).toBeGreaterThan(0);
    }
  });

  it('resolves every Concept lessonId to a Lesson that exists', () => {
    const known = new Set(allSpaces.flatMap((s) => lessonsForSpace(s.id)).map((l) => l.id));
    for (const c of allConcepts()) {
      for (const id of c.lessonIds) expect(known.has(id), `${c.name} → ${id}`).toBe(true);
    }
  });

  it('never marks a Concept cleared inside an untouched Lesson', () => {
    // "Nothing glows that has not been earned" — the same rule the map obeys.
    for (const s of allSpaces) {
      for (const l of lessonsForSpace(s.id)) {
        if (l.progress !== 'not-started') continue;
        for (const c of l.concepts) {
          expect(c.progress, `${l.title} / ${c.name}`).not.toBe('cleared');
        }
      }
    }
  });

  it('carries a weight, because the backend already reports one', () => {
    for (const c of allConcepts()) {
      expect(c.weight, c.name).toBeGreaterThan(0);
      expect(c.weight, c.name).toBeLessThanOrEqual(1);
    }
  });

  it('models a Concept that appears in more than one Lesson', () => {
    // RelatedLecture exists precisely because Concepts cross Lessons. If no
    // fixture did, the Concept overview's "appears in" section would be dead
    // code that looks fine.
    expect(allConcepts().some((c) => c.lessonIds.length > 1)).toBe(true);
  });

  it('gives every Concept-anchored contribution a Concept that exists', () => {
    const ids = new Set(allConcepts().map((c) => c.id));
    expect(conceptContributions.length).toBeGreaterThan(0);
    for (const c of conceptContributions) {
      expect(c.anchor.level).toBe('concept');
      if (c.anchor.level === 'concept') {
        expect(ids.has(c.anchor.conceptId), c.title).toBe(true);
      }
    }
  });

  it('is always Community origin — Official content is a Lesson', () => {
    for (const c of conceptContributions) expect(c.origin).toBe('community');
  });

  it('sorts a Concept community section by likes', () => {
    const withSome = allConcepts().find((c) => contributionsForConcept(c.id).length > 1);
    expect(withSome, 'no Concept has 2+ contributions to sort').toBeDefined();
    const likes = contributionsForConcept(withSome!.id).map((c) => c.likeCount);
    expect([...likes].sort((a, b) => b - a)).toEqual(likes);
  });

  it('finds a Concept by id and nothing by a bad id', () => {
    const first = allConcepts()[0];
    expect(conceptById(first.id)?.name).toBe(first.name);
    expect(conceptById('c-nope')).toBeUndefined();
  });
});
