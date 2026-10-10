import type { Citation } from '../studio/types';

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
    citations: [cite(6, 'p6-b6', 'A functional dependency (FD) X → A'), cite(7, 'p7-b14', 'Name → Weight')],
  },
  {
    question: 'Why doesn’t commutativity hold?',
    match: /commutativ|y\s*→\s*x/i,
    anchorId: 's-p10-1',
    markdown:
      'X → Y only says X decides Y, not the other way round. Many X values can share one Y value — a₁, a₂ and a₄ all point to b₁ — so knowing Y cannot tell you which X you have.',
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
];

export const SUGGESTED_QUESTIONS = STUDIO_ANSWERS.slice(0, 3).map((a) => a.question);

export function findAnswer(question: string): ScriptedAnswer | null {
  const q = question.trim();
  if (!q) return null;
  return STUDIO_ANSWERS.find((a) => a.question.toLowerCase() === q.toLowerCase() || a.match.test(q)) ?? null;
}
