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
  s(1, 1, ['p1-b2'], '**Normalization**, from Database Systems by Thorsten Papenbrock.'),

  s(2, 1, ['p2-b2', 'p2-b3', 'p2-b4', 'p2-b5', 'p2-b6', 'p2-b7', 'p2-b8'],
    'Building a database follows a fixed path. It starts with **requirement analysis**, an informal description of what people need, then a **conceptual design** drawn as an **ER diagram**, and a **distribution design** that decides how data is partitioned.'),
  s(2, 2, ['p2-b9', 'p2-b10', 'p2-b11', 'p2-b12', 'p2-b13', 'p2-b14', 'p2-b15'],
    'Next come the **logical design** as relation schemas, the **data definition** in SQL DDL, and the **physical design** with parameters and indices. Implementation and maintenance close the path — in my words: this is where tables get real.',
    true),

  s(3, 1, [], 'This part has four stops: **functional dependencies**, the **closure algorithm**, **Boyce-Codd normal form**, and the **normal forms** in general.'),

  s(4, 1, ['p4-b1', 'p4-b3', 'p4-b22', 'p4-b23', 'p4-b24'],
    'So far the design runs from a **conceptual design** to a **logical design**: first by translating the ER model, then by merging relations.'),
  s(4, 2, ['p4-b28'], 'The result works, but it can still be improved — and that is where functional dependencies come in.'),

  s(5, 1, ['p5-b1', 'p5-b5', 'p5-b6', 'p5-b7'],
    'A working **logical design** can still be refined. Break down structures to make attributes explicit, and split schemas to make constraints explicit.'),
  s(5, 2, ['p5-b8', 'p5-b9', 'p5-b10', 'p5-b11', 'p5-b12', 'p5-b13', 'p5-b14'],
    'The tools are **functional** and **multivalued dependencies**. The goal is to avoid **redundancy** by splitting relation schemas, without losing meaning and without losing the way back to the original relations. Doing this systematically is **normalization**.'),

  s(6, 1, ['p6-b1', 'p6-b5', 'p6-b6'],
    'A **functional dependency** X → A says: whenever two rows agree on the attributes in X, they also agree on A.'),
  s(6, 2, ['p6-b7', 'p6-b8', 'p6-b9'],
    'Formally, X → A holds in a relation exactly when, for any two tuples, equal values on X force equal values on A.'),
  s(6, 3, ['p6-b10', 'p6-b11', 'p6-b12', 'p6-b13', 'p6-b20', 'p6-b21', 'p6-b22', 'p6-b23', 'p6-b28'],
    'Single letters like A, B, C name attributes, and X, Y, Z name sets of them. X → ABC is short for X → A, X → B and X → C. In German: *Funktionale Abhängigkeit* (FA).'),

  s(7, 1, ['p7-b1', 'p7-b3', 'p7-b4', 'p7-b5', 'p7-b6', 'p7-b7', 'p7-b8', 'p7-b9', 'p7-b10', 'p7-b11', 'p7-b12', 'p7-b13'],
    'A table of creatures, with name, evolution, location, weight, type and more, shows dependencies hiding in real data.'),
  s(7, 2, ['p7-b14', 'p7-b16'],
    'For instance **Name → Weight**: the same name always comes with the same weight. And **Type → Weak**: a type decides its weakness.'),

  s(8, 1, ['p8-b1', 'p8-b5', 'p8-b6', 'p8-b7', 'p8-b8', 'p8-b9'],
    'The **splitting rule** breaks A₁…Aₙ → B₁…Bₘ into one dependency per right-hand attribute. The **combining rule** puts them back together.'),
  s(8, 2, ['p8-b10', 'p8-b11', 'p8-b12', 'p8-b13', 'p8-b14', 'p8-b15', 'p8-b16', 'p8-b17', 'p8-b18'],
    'So Title, Year → Length, Type, StudioName means the same as three separate dependencies. But splitting works **only on the right-hand side**: Title, Year → Length gives neither Year → Length nor Title → Length.'),

  s(9, 1, ['p9-b10', 'p9-b17', 'p9-b21'],
    "**Armstrong's axioms** derive new dependencies from known ones. They are **sound**, never deriving a false one, and **complete**, deriving every true one."),
  s(9, 2, ['p9-b1', 'p9-b2', 'p9-b3', 'p9-b4', 'p9-b5', 'p9-b6', 'p9-b7', 'p9-b8', 'p9-b9'],
    '**Reflexivity**: if Y ⊆ X, then X → Y. **Augmentation**: X → Y gives XZ → YZ. **Transitivity**: X → Y and Y → Z give X → Z.'),

  s(10, 1, ['p10-b10', 'p10-b17'], '**Commutativity does not hold**: X → Y does not mean Y → X.'),
  s(10, 2, ['p10-b18', 'p10-b19', 'p10-b20', 'p10-b21', 'p10-b22', 'p10-b23', 'p10-b24', 'p10-b25', 'p10-b26'],
    'A small counterexample proves it. Every X value is different, so X → Y holds, yet the same Y value b₁ appears with three different X values, so Y → X fails.'),

  s(11, 1, ['p11-b10', 'p11-b17', 'p11-b18', 'p11-b19', 'p11-b20'],
    'Why **transitivity** holds: given X → Y and Y → Z, any two rows that agree on X must also agree on Z.'),
  s(11, 2, ['p11-b21', 'p11-b22', 'p11-b23'],
    'Take two such rows. X → Y makes their Y values equal, and then Y → Z makes their Z values equal.'),

  s(12, 1, ['p12-b10', 'p12-b14', 'p12-b15', 'p12-b16', 'p12-b17', 'p12-b18', 'p12-b19'],
    'More rules follow from the axioms. **Splitting**: X → YZ gives X → Y. **Combining**: X → Y and X → Z give X → YZ.'),
  s(12, 2, ['p12-b20', 'p12-b21', 'p12-b22', 'p12-b26'],
    '**Pseudotransitivity**: X → Y and WY → Z give WX → Z. Augment X → Y with W to get WX → WY, then apply transitivity.'),
];
