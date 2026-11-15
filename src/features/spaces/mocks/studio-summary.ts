import type { SummaryBlock } from '../studio/types';

/**
 * The calm summary of Normalization.pdf — Living Learn spec §2, style A.
 *
 * Authored, not generated: the real summary step arrives with the pipeline
 * spec. Every paragraph condenses source blocks of ONE page and lists all of
 * them, so Peek outlines their union and Morph flies home to it. Running
 * headers and footers are left out on purpose — Morph shows them as
 * "Not in your version", which is the truth.
 */
const s = (page: number, n: number, blockIds: string[], markdown: string, edited = false): SummaryBlock => ({
  id: `s-p${page}-${n}`,
  origin: 'summary',
  markdown,
  source: { materialId: 'm-norm', page, blockIds },
  gist: n === 1,
  edited,
});

export const STUDIO_SUMMARY: SummaryBlock[] = [
  s(1, 1, ['p1-b0', 'p1-b1', 'p1-b2'],
    '**Normalization** starts from one observation: redundancy, one fact stored in more than one row, is where the insert, update and delete anomalies come from.'),
  s(1, 2, ['p1-b3', 'p1-b4'],
    'A table that repeats a fact can be made to contradict itself. The normal forms are guarantees against that, each one stricter than the last.'),

  s(2, 1, ['p2-b0', 'p2-b1', 'p2-b2'],
    'A **functional dependency** A → B says that any two rows agreeing on A also agree on B — for every row the table will ever hold, not only the ones in it now.'),
  s(2, 2, ['p2-b3', 'p2-b4'],
    'So it is read off what the data means, never off a sample. In my words: the rows in front of you can only ever prove an FD wrong.',
    true),

  s(3, 1, [], 'Keys come straight out of dependencies: a **superkey** determines every other attribute, a **candidate key** is a superkey with nothing left to remove, and a **prime attribute** belongs to some candidate key.'),

  s(4, 1, ['p4-b0', 'p4-b1', 'p4-b2', 'p4-b3'],
    '**First normal form** asks for one indivisible value per attribute: no repeating groups like phone1, phone2, phone3, and no lists in a cell.'),

  s(5, 1, ['p5-b0', 'p5-b1', 'p5-b2'],
    'A list in a cell cannot be joined against, constrained or usefully indexed, and reading one entry means parsing all of them.'),
  s(5, 2, ['p5-b3', 'p5-b4', 'p5-b5', 'p5-b6', 'p5-b7', 'p5-b8'],
    'The fix gives the group its own relation, keyed by the parent: one row per phone number. It costs one **join** and buys a database that can check its own data.'),

  s(6, 1, ['p6-b0', 'p6-b1', 'p6-b2'],
    'A **functional dependency** on only part of a composite key is a partial dependency: a non-prime attribute that needs less than the whole key.'),
  s(6, 2, ['p6-b3'],
    'On order lines keyed by (order, product), the quantity needs both, but the product name follows from the product alone.'),

  s(7, 1, ['p7-b0', 'p7-b1', 'p7-b2', 'p7-b3'],
    '**Second normal form** is 1NF without partial dependencies. Each one is projected out into its own relation; with a single-attribute key there is no part to depend on, so 2NF comes for free.'),

  s(8, 1, ['p8-b0', 'p8-b1', 'p8-b2', 'p8-b3'],
    'When the product name sits on every order line, renaming the product means finding every one of those lines. Miss one and two rows disagree about the same product: an **update anomaly**.'),
  s(8, 2, ['p8-b4', 'p8-b5', 'p8-b6', 'p8-b7', 'p8-b8'],
    'The table shows it: “Desk lamp” is stored three times for one product, P7, because the name depends on the product, not on the order.'),

  s(9, 1, ['p9-b0', 'p9-b1'],
    'A **transitive dependency** runs through something that is not a key: the key decides A, and A decides B.'),
  s(9, 2, ['p9-b2', 'p9-b3', 'p9-b4', 'p9-b5', 'p9-b6', 'p9-b7'],
    'The postcode fixes the city, so the city rides along on every customer row with that postcode — Berlin is stored twice for 10115.'),

  s(10, 1, ['p10-b0', 'p10-b1', 'p10-b2', 'p10-b3'],
    '**Third normal form** removes those chains: no non-prime attribute is determined by another non-prime one. It is always reachable and can always keep every dependency.'),

  s(11, 1, ['p11-b0', 'p11-b1', 'p11-b4'],
    'In **Boyce-Codd normal form** every determinant is a candidate key, without exceptions.'),
  s(11, 2, ['p11-b2', 'p11-b3'],
    'That makes it stricter than 3NF by exactly one clause, and the two only differ where candidate keys overlap.'),

  s(12, 1, ['p12-b0', 'p12-b1', 'p12-b2'],
    'The price: a BCNF decomposition can lose a **functional dependency**, which 3NF never has to.'),
  s(12, 2, ['p12-b3'], 'Which one to give up is a design decision, not a mechanical step.'),
];
