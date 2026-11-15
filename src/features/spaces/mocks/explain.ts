import type { ExplainAnswer, ExplainBlock } from '../components/reader/iui/spec';
import type { FD } from '../components/reader/iui/fd';
import i18n from '@/i18n';
import { beatsFromMarkdown } from '../components/reader/beats';

/**
 * What Explain says about a page — the stand-in for the model.
 *
 * Authored answers for the Normalization Lesson (`l-s-dbs-4`), one per page
 * of its deck, each written as the JSON a model would be asked for and each
 * choosing its own format: the definition is a table you can break, the keys
 * page a closure calculator, the transitive chain a set of steps, the BCNF
 * page a decomposer. Every other Lesson gets an answer composed from its own
 * parsed text, so the panel is never empty.
 *
 * Swap this module's body for a call and nothing else changes shape.
 */

const NORMALIZATION = 'l-s-dbs-4';

const fd = (lhs: string, rhs: string): FD => ({
  lhs: lhs.split(/\s*,\s*|\s+/).filter(Boolean),
  rhs: rhs.split(/\s*,\s*|\s+/).filter(Boolean),
});

/* ---------------------------------------------------------------- answers */

const motivation: ExplainAnswer = {
  title: 'One wide table repeats itself — and then contradicts itself',
  format: 'Side by side',
  blocks: [
    {
      type: 'compare',
      columns: [
        {
          title: 'One schema',
          tone: 'a',
          points: [
            'Movie(title, year, length, studio, studioAddress)',
            'The studio’s address is stored once per movie',
            'Change it in one row and the rows disagree',
          ],
        },
        {
          title: 'Split by its dependencies',
          tone: 'b',
          points: ['Movie(title, year, length, studio)', 'Studio(studio, studioAddress)', 'Each fact is stored exactly once'],
        },
      ],
      note: 'The split is guided by a functional dependency — studio → studioAddress — which is why FDs come first.',
    },
    { type: 'key', md: '**Goal:** avoid redundancy. **Approach:** split relation schemas along their functional dependencies, without losing information.' },
  ],
};

const definition: ExplainAnswer = {
  title: 'A → B is a promise about every row the table will ever hold',
  format: 'A table you can break',
  blocks: [
    {
      type: 'text',
      md: 'A **functional dependency** A → B says: any two rows that agree on A also agree on B. One row can’t break it — it takes two.',
    },
    {
      type: 'fdTable',
      title: 'Try it',
      columns: ['Title', 'Year', 'Length', 'Studio'],
      rows: [
        ['Basic Instinct', '1992', '127', 'Carolco'],
        ['Total Recall', '1990', '113', 'Carolco'],
        ['Dead Man', '1995', '121', 'Miramax'],
        ['Total Recall', '2012', '118', 'Columbia'],
      ],
      fd: fd('Title, Year', 'Length'),
      prompt: 'Edit a cell, or press a column name to move it between the left side, the right side and neither.',
    },
    {
      type: 'check',
      question: 'Both Total Recall rows share a title but not a length. Which dependency do they break?',
      options: [
        { text: 'Title → Length', correct: true, why: 'They agree on Title and disagree on Length — exactly two rows against the claim.' },
        { text: 'Title, Year → Length', why: 'They differ in Year, so they never agree on the left side. This one still holds.' },
        { text: 'Length → Title', why: 'Their lengths differ, so they don’t agree on the left side here either.' },
      ],
    },
    { type: 'key', md: 'Data can only ever *refute* an FD. Whether it holds is a decision about the world the table describes.' },
  ],
  next: ['Can data prove an FD?', 'How do FDs relate to keys?'],
};

const partial: ExplainAnswer = {
  title: 'Part of the key is already enough',
  format: 'A table to try',
  blocks: [
    {
      type: 'fdTable',
      title: 'Which part of the key decides the name?',
      columns: ['Order', 'Product', 'Quantity', 'Name'],
      rows: [
        ['1001', 'P7', '2', 'Desk lamp'],
        ['1002', 'P7', '1', 'Desk lamp'],
        ['1003', 'P7', '4', 'Desk lamp'],
        ['1003', 'P2', '1', 'Notebook'],
      ],
      fd: fd('Product', 'Name'),
      prompt: 'Product → Name holds. Now try Order → Name: press Order, then Name.',
    },
    { type: 'key', md: 'Order → Name fails on order 1003 — one order, two names. The name needs the product, which is only **part** of the key (Order, Product).' },
  ],
};

const transitive: ExplainAnswer = {
  title: 'A dependency that runs through a non-key',
  format: 'Step by step',
  blocks: [
    {
      type: 'steps',
      title: 'Follow the chain on the customer table',
      steps: [
        { label: 'Customer → Postcode', body: 'The key decides the postcode: each customer has one.' },
        { label: 'Postcode → City', body: 'The postcode decides the city, and the postcode is **not** a key.' },
        { label: 'Customer → City', body: 'So the customer decides the city only by way of the postcode: a **transitive** dependency.' },
        { label: 'Split', body: 'Give Postcode and City a relation of their own, and 10115 → Berlin is stored once.' },
      ],
    },
    { type: 'key', md: 'Third normal form forbids exactly this: a non-prime attribute decided by another non-prime one.' },
  ],
};

const anomalies: ExplainAnswer = {
  title: 'Redundancy shows up as three ways to go wrong',
  format: 'Parts to explore',
  blocks: [
    {
      type: 'explore',
      title: 'Anomalies',
      intro: 'All three come from storing one fact in many rows.',
      parts: [
        { id: 'u', label: 'Update', spot: 'update anomaly', body: 'The studio moves. Its address is in fifty rows; miss one and the table contradicts itself.' },
        { id: 'd', label: 'Delete', body: 'Delete a studio’s last movie and the studio’s address goes with it — a fact lost by accident.' },
        { id: 'i', label: 'Insert', body: 'A new studio with no movies yet cannot be stored without inventing a movie for it.' },
      ],
    },
    { type: 'key', md: 'Fix the redundancy and all three anomalies disappear together.' },
  ],
};

const ullman = ['A', 'B', 'C', 'D', 'E', 'F'];
const ullmanFds = [fd('A B', 'C'), fd('B C', 'A D'), fd('D', 'E'), fd('C F', 'B')];

const closure: ExplainAnswer = {
  title: 'X⁺ is everything X decides',
  format: 'A calculator',
  blocks: [
    { type: 'text', md: 'Start with X. Whenever an FD’s left side is inside the set, add its right side. Stop when nothing changes.' },
    { type: 'closure', title: 'Compute a closure', attrs: ullman, fds: ullmanFds, start: ['A', 'B'] },
    {
      type: 'check',
      question: 'With these FDs, does AB → D hold?',
      options: [
        { text: 'Yes', correct: true, why: 'D is in {A, B}⁺. That is the whole test: X → Y follows exactly when Y ⊆ X⁺.' },
        { text: 'No — no FD has AB → D', why: 'It doesn’t need to be listed. AB → C, then BC → AD gets you there.' },
      ],
    },
    { type: 'key', md: 'X → Y follows from F **exactly when Y ⊆ X⁺**. Closure answers the membership problem in one pass.' },
  ],
  next: ['Pick C, F as the start set', 'Why does this terminate?'],
};

const decomposition: ExplainAnswer = {
  title: 'Split without losing anything',
  format: 'Side by side',
  blocks: [
    {
      type: 'compare',
      columns: [
        { title: 'Lossless', tone: 'b', points: ['Joining the parts gives back exactly the original rows', 'Guaranteed when the shared attributes are a key of one part', 'Every BCNF split is lossless'] },
        { title: 'Lossy', tone: 'a', points: ['The join invents rows that were never there', 'Happens when the shared attributes decide nothing', 'Information lost as noise, not as missing rows'] },
      ],
    },
    { type: 'key', md: 'A decomposition is only worth it if the **join brings the original back**.' },
  ],
};

const bcnfStudio = {
  name: 'MovieStudio',
  attrs: ['title', 'year', 'studioName', 'president', 'presAddr'],
};
const bcnfFds = [fd('title year', 'studioName'), fd('studioName', 'president'), fd('president', 'presAddr')];

const bcnf: ExplainAnswer = {
  title: 'Every left side must be a key',
  format: 'A decomposer',
  blocks: [
    { type: 'text', md: 'A relation is in **BCNF** when every non-trivial FD X → Y has a superkey on the left. Find one that doesn’t, split along it, repeat.' },
    { type: 'bcnf', title: 'Decompose step by step', relation: bcnfStudio, fds: bcnfFds },
    {
      type: 'check',
      question: 'Why is studioName → president a violation in MovieStudio?',
      options: [
        { text: 'studioName is not a key of MovieStudio', correct: true, why: '{studioName}⁺ is studioName, president, presAddr — no title, no year. Not a superkey.' },
        { text: 'president depends on two things', why: 'Depending on studioName is fine in itself; the problem is that studioName doesn’t determine the whole row.' },
      ],
    },
  ],
};

const forms: ExplainAnswer = {
  title: 'A ladder: each rung forbids one more kind of redundancy',
  format: 'A chain of stages',
  blocks: [
    {
      type: 'explore',
      title: 'Normal forms',
      intro: 'Each form includes the one before it.',
      flow: true,
      parts: [
        { id: '1', label: '1NF', spot: '1NF', body: 'Every value is atomic: no lists, no repeating groups in a cell.' },
        { id: '2', label: '2NF', spot: '2NF', body: '1NF, and no non-key attribute depends on only *part* of a key.' },
        { id: '3', label: '3NF', spot: '3NF', body: 'For every non-trivial X → A: X is a superkey, or A is part of some key.' },
        { id: 'b', label: 'BCNF', spot: 'BCNF', body: 'For every non-trivial X → Y: X is a superkey. No exceptions.' },
        { id: '4', label: '4NF', spot: '4NF', body: 'BCNF for multivalued dependencies too — independent facts in separate tables.' },
      ],
    },
    { type: 'key', md: 'In practice: aim for **BCNF**, settle for **3NF** when BCNF would lose a dependency.' },
  ],
};

const firstNf: ExplainAnswer = {
  title: 'One value per cell',
  format: 'Side by side',
  blocks: [
    {
      type: 'compare',
      columns: [
        { title: 'Not 1NF', tone: 'a', points: ['Student(id, name, phones)', '17 · Ada · “0151 …, 0171 …”', 'A query for one number has to parse a string'] },
        { title: '1NF', tone: 'b', points: ['Student(id, name)', 'Phone(id, number)', 'One row per phone number'] },
      ],
    },
  ],
};

const threeVsBcnf: ExplainAnswer = {
  title: 'BCNF removes more redundancy; 3NF keeps every dependency',
  format: 'Side by side',
  blocks: [
    {
      type: 'compare',
      columns: [
        { title: '3NF', tone: 'b', points: ['Always lossless', 'Always dependency-preserving', 'May keep a little redundancy'] },
        { title: 'BCNF', tone: 'a', points: ['Always lossless', 'No redundancy from FDs', 'May lose a dependency — it can then only be checked with a join'] },
      ],
    },
    {
      type: 'check',
      question: 'Which one can force you to check a constraint across two tables?',
      options: [
        { text: 'BCNF', correct: true, why: 'When a BCNF split separates an FD’s attributes, no single table can enforce it any more.' },
        { text: '3NF', why: '3NF synthesis keeps every FD inside one table — that is its guarantee.' },
      ],
    },
  ],
};

/** Which pages get which authored answer. */
const AUTHORED: [number[], ExplainAnswer][] = [
  [[1], motivation],
  [[2], definition],
  [[3], closure],
  [[4, 5], firstNf],
  [[6], partial],
  [[7], decomposition],
  [[8], anomalies],
  [[9], transitive],
  [[10], forms],
  [[11], bcnf],
  [[12], threeVsBcnf],
];

/* ------------------------------------------------------------- composing */

/** An answer for any page, from its own parsed text — in the reader's language, around the page's own words. */
export function composeFromText(title: string, markdown: string): ExplainAnswer {
  const t = (key: string, params?: Record<string, unknown>) => i18n.t(`v4Reader:explain.composed.${key}`, params);
  const beats = beatsFromMarkdown(markdown);
  const blocks: ExplainBlock[] =
    beats.length >= 2
      ? [
          {
            type: 'explore',
            title: t('onPage'),
            intro: t('points', { count: beats.length }),
            parts: beats.map((b, i) => ({ id: String(i), label: b.label, body: b.text, spot: b.text })),
          },
        ]
      : [{ type: 'text', md: markdown.trim() || t('picture') }];
  return { title, format: beats.length >= 2 ? t('parts') : t('plain'), blocks };
}

/** The authored answer for a page, or null where Explain would compose one. */
export function authoredFor(lessonId: string, page: number): ExplainAnswer | null {
  if (lessonId !== NORMALIZATION) return null;
  return AUTHORED.find(([pages]) => pages.includes(page))?.[1] ?? null;
}

export function explainFor(
  lessonId: string,
  page: number,
  fallback: { title: string; markdown: string },
): ExplainAnswer {
  if (lessonId === NORMALIZATION) {
    const hit = AUTHORED.find(([pages]) => pages.includes(page));
    if (hit) return hit[1];
  }
  return composeFromText(fallback.title, fallback.markdown);
}

/** The interactive things inside a Lesson — the answers worth trying, not just reading. */
export interface LessonTool {
  page: number;
  title: string;
  format: string;
  kind: 'fdTable' | 'closure' | 'bcnf' | 'compare' | 'explore' | 'steps';
}

const TOOL_KINDS: LessonTool['kind'][] = ['fdTable', 'closure', 'bcnf', 'steps', 'explore', 'compare'];

export function toolsFor(lessonId: string): LessonTool[] {
  if (lessonId !== NORMALIZATION) return [];
  const out: LessonTool[] = [];
  for (const [pages, answer] of AUTHORED) {
    const kind = TOOL_KINDS.find((k) => answer.blocks.some((b) => b.type === k));
    /* One per kind of tool: the shelf is a sampler, not an index. */
    if (!kind || out.some((t) => t.kind === kind)) continue;
    out.push({ page: pages[0], title: answer.title, format: answer.format, kind });
  }
  /* The ones you can operate first: a calculator beats a comparison. */
  return out.sort((a, b) => TOOL_KINDS.indexOf(a.kind) - TOOL_KINDS.indexOf(b.kind) || a.page - b.page);
}
