import type { Citation } from '../studio/types';
import type { AnswerBlock } from '../studio/answers/spec';

/**
 * Studio's answers, canned — the same pattern as `mocks/tutor.ts`.
 *
 * Deterministic: the same question returns the same words, so tests can
 * assert them. A question none of these match gets an honest "I can only
 * answer these here" (Living Learn spec §4.7), never an invented answer.
 * Every anchor is a paragraph of the default canvas and every citation a
 * real source block — guarded in `__tests__/studio-answers.test.ts`.
 */
export interface ScriptedAnswer {
  question: string;
  match: RegExp;
  /** The paragraph it grows under (spec §4.2, "first citation"). */
  anchorId: string;
  markdown: string;
  citations: Citation[];
  /** Typed parts; `markdown` stays the plain-text version (screen readers, Morph). */
  blocks?: AnswerBlock[];
  /** A quiet label for the shape of the answer. */
  format?: string;
}

export const ASK_LATENCY_MS = 600;

const cite = (page: number, blockId: string, quote: string): Citation =>
  ({ label: `p. ${page}`, materialId: 'm-norm', page, blockId, quote });

export const STUDIO_ANSWERS: ScriptedAnswer[] = [
  {
    question: 'Why does repeated data cause problems?',
    match: /repeat|redundan|duplicat/i,
    anchorId: 's-p5-2',
    markdown:
      'If the same fact is stored twice, an update can change one copy and miss the other — and the table starts telling two stories. Normalization splits relations so each fact lives in one place, which removes these **update anomalies** at the root.',
    citations: [cite(5, 'p5-b10', 'Goal: Avoid redundancies'), cite(5, 'p5-b11', 'Approach: Split relation schemas')],
  },
  {
    question: 'What is a functional dependency?',
    match: /functional dependenc|\bfds?\b/i,
    anchorId: 's-p6-1',
    markdown:
      'A promise about the data: if you know X, you know A. Whenever two rows share the same X values, they must share the same A value. In the example table, knowing a creature’s **Name** tells you its **Weight**.',
    format: 'A table to try',
    blocks: [
      { type: 'text', md: 'A promise about the data: if you know X, you know A. Whenever two rows share the same X values, they must share the same A value. In the example table, knowing a creature’s **Name** tells you its **Weight**.' },
      { type: 'fdTable', title: 'Does Name → Weight hold?', columns: ['Name', 'Weight', 'Type'], rows: [['Pikachu', '6.0', 'electric'], ['Nidoran', '7.0', 'poison'], ['Nidoran', '7.0', 'poison'], ['Vulpix', '9.9', 'fire'], ['Abra', '19.5', 'psychic']], fd: { lhs: ['Name'], rhs: ['Weight'] }, prompt: 'Change one Nidoran’s weight and watch the dependency break.' },
    ],
    citations: [cite(6, 'p6-b6', 'A functional dependency (FD) X → A'), cite(7, 'p7-b14', 'Name → Weight')],
  },
  {
    question: 'Why doesn’t commutativity hold?',
    match: /commutativ|y\s*→\s*x/i,
    anchorId: 's-p10-1',
    markdown:
      'X → Y only says X decides Y, not the other way round. Many X values can share one Y value — a₁, a₂ and a₄ all point to b₁ — so knowing Y cannot tell you which X you have.',
    format: 'See it fail',
    blocks: [
      { type: 'text', md: 'X → Y only says X decides Y, not the other way round. Many X values can share one Y value — a₁, a₂ and a₄ all point to b₁ — so knowing Y cannot tell you which X you have.' },
      { type: 'fdTable', title: 'X → Y holds — does Y → X?', columns: ['X', 'Y', 'Z'], rows: [['a₁', 'b₁', 'c₁'], ['a₂', 'b₁', 'c₁'], ['a₃', 'b₂', 'c₁'], ['a₄', 'b₁', 'c₁']], fd: { lhs: ['Y'], rhs: ['X'] }, prompt: 'Rows that share a Y value but differ in X are the counterexample.' },
    ],
    citations: [cite(10, 'p10-b17', 'Commutativity does not apply!'), cite(10, 'p10-b23', 'a 1 b 1 c 1')],
  },
  {
    question: 'Can I split the left-hand side too?',
    match: /left[- ]hand|split.*left|left.*split/i,
    anchorId: 's-p8-2',
    markdown:
      'No. Title, Year → Length needs *both* attributes: one title can exist in several years with different lengths. Drop either one and the dependency breaks, which is why splitting only works on the right.',
    citations: [cite(8, 'p8-b15', 'The splitting rule only on right-hand side!'), cite(8, 'p8-b17', '⇏ Year → Length')],
  },
  {
    question: 'What does pseudotransitivity give me?',
    match: /pseudo/i,
    anchorId: 's-p12-2',
    markdown:
      'A shortcut. If X decides Y, and W together with Y decides Z, then W together with X decides Z — you may swap Y for X inside a left-hand side. It comes in handy in the **closure algorithm**.',
    citations: [cite(12, 'p12-b21', 'X → Y ∧ WY → Z ⇒ WX → Z')],
  },
  {
    question: 'What is the closure of {Title, Year}?',
    match: /closure/i,
    anchorId: 's-p8-2',
    format: 'Step through it',
    markdown:
      'The closure X⁺ is everything X determines: keep firing dependencies whose left side you already have. From {Title, Year} you reach Length, Type and StudioName, then President through StudioName, then PresAddr through President.',
    citations: [cite(8, 'p8-b14', 'Title, Year → Length, Type, StudioName'), cite(9, 'p9-b9', 'Closure Algorithm!')],
    blocks: [
      { type: 'key', md: 'X⁺ is everything X determines — keep firing dependencies whose left side you already have.' },
      { type: 'closure', title: 'Compute {Title, Year}⁺', attrs: ['Title', 'Year', 'Length', 'Type', 'StudioName', 'President', 'PresAddr'], fds: [{ lhs: ['Title', 'Year'], rhs: ['Length', 'Type', 'StudioName'] }, { lhs: ['StudioName'], rhs: ['President'] }, { lhs: ['President'], rhs: ['PresAddr'] }], start: ['Title', 'Year'] },
    ],
  },
  {
    question: 'Split this relation into BCNF',
    match: /bcnf|boyce/i,
    anchorId: 's-p3-1',
    format: 'Decompose it',
    markdown:
      'A relation is in Boyce-Codd normal form when the left side of every dependency is a key. Where one is not, split the relation along that dependency and check each half again.',
    citations: [cite(5, 'p5-b11', 'Approach: Split relation schemas')],
    blocks: [
      { type: 'text', md: 'A relation is in **Boyce-Codd normal form** when the left side of every dependency is a key. Where one is not, split the relation along that dependency and check each half again.' },
      { type: 'bcnf', title: 'Split Studios into BCNF', relation: { name: 'Studios', attrs: ['Title', 'Year', 'StudioName', 'President', 'PresAddr'] }, fds: [{ lhs: ['Title', 'Year'], rhs: ['StudioName'] }, { lhs: ['StudioName'], rhs: ['President'] }, { lhs: ['President'], rhs: ['PresAddr'] }] },
    ],
  },
  {
    question: 'Quiz me on Armstrong’s axioms',
    match: /quiz|armstrong|axiom/i,
    anchorId: 's-p9-2',
    format: 'Try first',
    markdown:
      'Question: you know X → Y and Y → Z. Which rule gives you X → Z? Transitivity. Any two rows that agree on X agree on Y, and then on Z.',
    citations: [cite(9, 'p9-b8', 'X → Y ∧ Y → Z ⇒ X → Z'), cite(11, 'p11-b20', 'must agree in Z as well')],
    blocks: [
      { type: 'check', question: 'You know X → Y and Y → Z. Which rule gives you X → Z?', options: [
        { text: 'Reflexivity', why: 'That only gives X → Y when Y ⊆ X.' },
        { text: 'Augmentation', why: 'That adds the same attributes to both sides; it never chains two dependencies.' },
        { text: 'Transitivity', correct: true, why: 'X → Y and Y → Z give X → Z.' },
      ] },
      { type: 'steps', title: 'Why transitivity holds (page 11)', steps: [
        { label: 'Take two rows', body: 'Pick any two rows that agree on X.' },
        { label: 'X → Y', body: 'Because X → Y, their Y values are equal.' },
        { label: 'Y → Z', body: 'Because Y → Z, their Z values are equal too, so X → Z.' },
      ] },
    ],
  },
];

export const SUGGESTED_QUESTIONS = STUDIO_ANSWERS.slice(0, 3).map((a) => a.question);

/** The first `n` questions not asked yet, in catalogue order. */
export function nextSuggestions(asked: string[], n = 3): string[] {
  const done = new Set(asked.map((q) => q.trim().toLowerCase()));
  return STUDIO_ANSWERS.map((a) => a.question).filter((q) => !done.has(q.toLowerCase())).slice(0, n);
}

export function findAnswer(question: string): ScriptedAnswer | null {
  const q = question.trim();
  if (!q) return null;
  return STUDIO_ANSWERS.find((a) => a.question.toLowerCase() === q.toLowerCase() || a.match.test(q)) ?? null;
}
