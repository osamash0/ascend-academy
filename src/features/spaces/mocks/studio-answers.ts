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
    anchorId: 's-p8-1',
    markdown:
      'If the same fact is stored twice, an update can change one copy and miss the other — and the table starts telling two stories. Normalization splits relations so each fact lives in one place, which removes these **update anomalies** at the root.',
    citations: [
      cite(1, 'p1-b1', 'Redundancy is one fact stored in more than one row'),
      cite(8, 'p8-b3', 'Miss one and two rows now disagree about the same product'),
    ],
  },
  {
    question: 'What is a functional dependency?',
    match: /functional dependenc|\bfds?\b/i,
    anchorId: 's-p2-1',
    markdown:
      'A promise about the data: if you know X, you know A. Whenever two rows share the same X values, they must share the same A value. On the order lines, knowing the **Product** tells you its **Product name**.',
    format: 'A table to try',
    blocks: [
      { type: 'text', md: 'A promise about the data: if you know X, you know A. Whenever two rows share the same X values, they must share the same A value. On the order lines, knowing the **Product** tells you its **Product name**.' },
      { type: 'fdTable', title: 'Does Product → Product name hold?', columns: ['Order', 'Product', 'Product name'], rows: [['1001', 'P7', 'Desk lamp'], ['1002', 'P7', 'Desk lamp'], ['1003', 'P7', 'Desk lamp'], ['1003', 'P2', 'Notebook']], fd: { lhs: ['Product'], rhs: ['Product name'] }, prompt: 'Rename one Desk lamp and watch the dependency break.' },
    ],
    citations: [
      cite(2, 'p2-b1', 'A → B: any two rows agreeing on A must agree on B'),
      cite(6, 'p6-b3', 'product alone → product name'),
    ],
  },
  {
    question: 'Can I split the left-hand side too?',
    match: /left[- ]hand|split.*left|left.*split/i,
    anchorId: 's-p6-1',
    markdown:
      'Not in general. (order, product) → quantity needs *both* attributes: one order holds many products and one product appears in many orders, so dropping either breaks the dependency. When part of the left side *is* enough on its own, as product → product name, that part is a partial dependency — exactly what 2NF removes.',
    citations: [
      cite(6, 'p6-b3', '(order, product) → quantity'),
      cite(7, 'p7-b2', 'Project the partial dependency out into its own relation'),
    ],
  },
  {
    question: 'Does Postcode → City mean City → Postcode?',
    match: /commutativ|the other way|city\s*→\s*postcode/i,
    anchorId: 's-p9-2',
    markdown:
      'No. Postcode → City only says the postcode decides the city, not the other way round. One city has many postcodes, so knowing the city cannot tell you which postcode you have.',
    format: 'See it fail',
    blocks: [
      { type: 'text', md: 'No. Postcode → City only says the postcode decides the city, not the other way round. One city has many postcodes, so knowing the city cannot tell you which postcode you have.' },
      { type: 'fdTable', title: 'Postcode → City holds — does City → Postcode?', columns: ['Postcode', 'City'], rows: [['10115', 'Berlin'], ['10117', 'Berlin'], ['80331', 'Munich'], ['80333', 'Munich']], fd: { lhs: ['City'], rhs: ['Postcode'] }, prompt: 'Rows that share a city but differ in postcode are the counterexample.' },
    ],
    citations: [
      cite(9, 'p9-b2', 'Postcode fixes the city'),
      cite(9, 'p9-b5', 'C1 Ada 10115 Berlin'),
    ],
  },
  {
    question: 'What makes a dependency transitive?',
    match: /transitiv/i,
    anchorId: 's-p9-1',
    markdown:
      'A chain through something that is not a key. The customer decides the postcode and the postcode decides the city, so the city depends on the customer only by way of the postcode. **3NF** cuts the chain by giving postcode and city a relation of their own.',
    citations: [
      cite(9, 'p9-b1', 'Key → A and A → B, where A is not itself a key'),
      cite(10, 'p10-b1', 'No non-prime attribute is determined by another non-prime one'),
    ],
  },
  {
    question: 'What is the closure of {Order, Product}?',
    match: /closure/i,
    anchorId: 's-p3-1',
    format: 'Step through it',
    markdown:
      'The closure X⁺ is everything X determines: keep firing dependencies whose left side you already have. From {Order, Product} you reach Quantity, then Product name through Product, Customer through Order and City through Customer — every attribute, so {Order, Product} is a key.',
    citations: [cite(6, 'p6-b3', '(order, product) → quantity, but product alone → product name')],
    blocks: [
      { type: 'key', md: 'X⁺ is everything X determines — keep firing dependencies whose left side you already have.' },
      { type: 'closure', title: 'Compute {Order, Product}⁺', attrs: ['Order', 'Product', 'Quantity', 'ProductName', 'Customer', 'City'], fds: [{ lhs: ['Order', 'Product'], rhs: ['Quantity'] }, { lhs: ['Product'], rhs: ['ProductName'] }, { lhs: ['Order'], rhs: ['Customer'] }, { lhs: ['Customer'], rhs: ['City'] }], start: ['Order', 'Product'] },
    ],
  },
  {
    question: 'Split this relation into BCNF',
    match: /bcnf|boyce/i,
    anchorId: 's-p11-1',
    format: 'Decompose it',
    markdown:
      'A relation is in Boyce-Codd normal form when the left side of every dependency is a key. Where one is not, split the relation along that dependency and check each half again.',
    citations: [
      cite(11, 'p11-b1', 'Every determinant is a candidate key, with no exceptions'),
      cite(7, 'p7-b2', 'Project the partial dependency out into its own relation'),
    ],
    blocks: [
      { type: 'text', md: 'A relation is in **Boyce-Codd normal form** when the left side of every dependency is a key. Where one is not, split the relation along that dependency and check each half again.' },
      { type: 'bcnf', title: 'Split OrderLines into BCNF', relation: { name: 'OrderLines', attrs: ['Order', 'Product', 'Quantity', 'ProductName', 'Customer', 'City'] }, fds: [{ lhs: ['Order', 'Product'], rhs: ['Quantity'] }, { lhs: ['Product'], rhs: ['ProductName'] }, { lhs: ['Order'], rhs: ['Customer'] }, { lhs: ['Customer'], rhs: ['City'] }] },
    ],
  },
  {
    question: 'Quiz me on the normal forms',
    match: /quiz|normal forms?\b/i,
    anchorId: 's-p7-1',
    format: 'Try first',
    markdown:
      'Question: order lines keyed by (Order, Product) also store the product name. Which normal form do they break first? 2NF. The product name depends on the product alone, which is only part of the key.',
    citations: [
      cite(7, 'p7-b1', 'no non-prime attribute depends on part of a key'),
      cite(6, 'p6-b3', 'product alone → product name'),
    ],
    blocks: [
      { type: 'check', question: 'Order lines keyed by (Order, Product) also store the product name. Which normal form do they break first?', options: [
        { text: '1NF', why: 'Every cell still holds one value, so 1NF holds.' },
        { text: '2NF', correct: true, why: 'Product → product name uses only part of the key: a partial dependency.' },
        { text: 'BCNF only', why: 'BCNF breaks too, but 2NF breaks before it.' },
      ] },
      { type: 'steps', title: 'Why it breaks 2NF (page 6)', steps: [
        { label: 'Find the key', body: 'Order and product together decide every other attribute.' },
        { label: 'Look at one part', body: 'The product alone already decides the product name.' },
        { label: 'Name it', body: 'A non-prime attribute depending on part of the key is a partial dependency, which 2NF forbids.' },
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
