/**
 * Practice fixtures.
 *
 * Mirrors `practiceSheetsService.PracticeSheetQuestion` —
 * {id, type, prompt, choices, correct_answer, explanation} — renamed to
 * camelCase for the UI. Wiring is a field rename, not a new endpoint.
 *
 * Every question explains itself whichever way you answer. Practice that only
 * says "wrong" teaches nothing, and the explanation is the part that does the
 * work — a guard enforces it.
 */

export interface PracticeQuestion {
  id: string;
  lessonId: string;
  prompt: string;
  choices: string[];
  correctAnswer: string;
  explanation: string;
}

const QUESTIONS: Record<string, PracticeQuestion[]> = {
  'l-s-dbs-4': [
    {
      id: 'q-norm-1',
      lessonId: 'l-s-dbs-4',
      prompt: 'A relation is in 2NF but not 3NF. What must be true of it?',
      choices: [
        'A non-key attribute depends on another non-key attribute',
        'A non-key attribute depends on part of a composite key',
        'It has no primary key',
        'It contains a repeating group',
      ],
      correctAnswer: 'A non-key attribute depends on another non-key attribute',
      explanation:
        'That is a transitive dependency, and removing it is exactly what 3NF asks for. Partial dependency on part of a key is the 2NF violation, one step earlier.',
    },
    {
      id: 'q-norm-2',
      lessonId: 'l-s-dbs-4',
      prompt: 'Which is true of BCNF but not of 3NF?',
      choices: [
        'Every determinant must be a candidate key',
        'Every attribute must be atomic',
        'The relation must have exactly one candidate key',
        'Foreign keys must be indexed',
      ],
      correctAnswer: 'Every determinant must be a candidate key',
      explanation:
        '3NF allows a determinant that is only *part* of a candidate key. BCNF does not, which is why the two differ only when candidate keys overlap.',
    },
    {
      id: 'q-norm-3',
      lessonId: 'l-s-dbs-4',
      prompt: 'Why does normalising past the point of need sometimes hurt?',
      choices: [
        'Every extra relation is another join at read time',
        'It breaks referential integrity',
        'It makes primary keys optional',
        'It prevents indexing',
      ],
      correctAnswer: 'Every extra relation is another join at read time',
      explanation:
        'Normalisation trades write anomalies for read cost. You normalise until the anomalies are gone, then denormalise only where a measured query demands it — and write down why.',
    },
  ],
  'l-s-dbs-2': [
    {
      id: 'q-basics-1',
      lessonId: 'l-s-dbs-2',
      prompt: 'What makes a set of attributes a candidate key?',
      choices: [
        'It identifies a row uniquely and has nothing spare in it',
        'It is the first column of the table',
        'It is indexed',
        'It is never null',
      ],
      correctAnswer: 'It identifies a row uniquely and has nothing spare in it',
      explanation:
        'Uniqueness alone is not enough — drop any attribute and it must stop identifying. That "nothing spare" part is minimality, and it is the whole definition.',
    },
  ],
};

export const practiceForLesson = (lessonId: string): PracticeQuestion[] =>
  QUESTIONS[lessonId] ?? [];

export interface Graded {
  correct: boolean;
  correctAnswer: string;
  explanation: string;
}

/** Grades and always returns the explanation — right answers deserve one too. */
export const gradeAnswer = (q: PracticeQuestion, answer: string): Graded => ({
  correct: answer === q.correctAnswer,
  correctAnswer: q.correctAnswer,
  explanation: q.explanation,
});
