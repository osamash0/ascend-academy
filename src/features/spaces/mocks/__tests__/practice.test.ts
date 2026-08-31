import { describe, expect, it } from 'vitest';
import { allSpaces } from '../spaces';
import { lessonsForSpace } from '../lessons';
import { practiceForLesson, gradeAnswer } from '../practice';

/**
 * Practice guards.
 *
 * Mirrors `practiceSheetsService.PracticeSheetQuestion`
 * {id, type, prompt, choices, correct_answer, explanation} exactly, so wiring
 * is a swap. Doc 1: a Practice set belongs to one Lesson.
 */

describe('Practice', () => {
  it('gives every question a prompt and a correct answer', () => {
    const qs = practiceForLesson('l-s-dbs-4');
    expect(qs.length).toBeGreaterThan(0);
    for (const q of qs) {
      expect(q.prompt.trim().length).toBeGreaterThan(0);
      expect(q.correctAnswer.trim().length).toBeGreaterThan(0);
    }
  });

  it('always includes the correct answer among the choices', () => {
    // A multiple-choice question whose answer is not on the list is
    // unanswerable, and no amount of UI polish rescues it.
    for (const q of practiceForLesson('l-s-dbs-4')) {
      expect(q.choices, q.prompt).toContain(q.correctAnswer);
    }
  });

  it('explains every answer, right or wrong', () => {
    // Practice that only says "wrong" teaches nothing.
    for (const q of practiceForLesson('l-s-dbs-4')) {
      expect(q.explanation.trim().length, q.prompt).toBeGreaterThan(10);
    }
  });

  it('belongs to a Lesson that exists', () => {
    const known = new Set(allSpaces.flatMap((s) => lessonsForSpace(s.id)).map((l) => l.id));
    for (const q of practiceForLesson('l-s-dbs-4')) expect(known.has(q.lessonId)).toBe(true);
  });

  it('grades exactly, and reports what was right', () => {
    const q = practiceForLesson('l-s-dbs-4')[0];
    expect(gradeAnswer(q, q.correctAnswer).correct).toBe(true);
    const wrong = q.choices.find((c) => c !== q.correctAnswer)!;
    const graded = gradeAnswer(q, wrong);
    expect(graded.correct).toBe(false);
    expect(graded.correctAnswer).toBe(q.correctAnswer);
    expect(graded.explanation).toBe(q.explanation);
  });

  it('returns nothing for a Lesson with no practice', () => {
    expect(practiceForLesson('l-does-not-exist')).toEqual([]);
  });
});

describe('what a Lesson promises is what practice delivers', () => {
  it('never advertises a question that does not exist', () => {
    /*
     * The cross-fixture check that was missing. `practiceCount` was stated on
     * seventeen Lessons and wrong on all seventeen — fifteen of them offered
     * an enabled Practice button that landed on the empty state. It is derived
     * now, so this asserts the derivation rather than the numbers.
     */
    for (const space of allSpaces) {
      for (const l of lessonsForSpace(space.id)) {
        expect(l.practiceCount, `${l.title} advertises the wrong count`).toBe(
          practiceForLesson(l.id).length,
        );
      }
    }
  });

  it('has practice in more than one corner of the path', () => {
    // With two Lessons carrying questions, every guard about practice was
    // really a guard about Normalization.
    const withPractice = allSpaces
      .flatMap((s) => lessonsForSpace(s.id))
      .filter((l) => l.practiceCount > 0);
    expect(withPractice.length).toBeGreaterThan(2);
  });

  it('leaves most Lessons honestly empty rather than falsely stocked', () => {
    // The empty state is the majority path and that is fine — what is not
    // fine is a button promising otherwise.
    const empty = allSpaces
      .flatMap((s) => lessonsForSpace(s.id))
      .filter((l) => l.practiceCount === 0);
    expect(empty.length).toBeGreaterThan(0);
    for (const l of empty) expect(practiceForLesson(l.id)).toHaveLength(0);
  });
});
