import type { Concept, Lesson, Material, MaterialPage, Person, Space } from '../types';
import { viewer, keller, weber, lindqvist, okonkwo, ferreira } from './people';
import { practiceForLesson } from './practice';
import { contributionsForLesson, membersForSpace } from './contributions';

/**
 * Lesson fixtures — titles, order and progress taken verbatim from the
 * running app, including the parts that are inconvenient:
 *
 *   • "Linear Recurring Sequences and Feedback Shift Registers over Finite
 *     Fields" — 78 characters. Real. The tile plate has to survive it.
 *   • Two Lessons genuinely called "Advanced Topics in Cryptography" in the
 *     same Space. Real. If the UI shows only a title, they are
 *     indistinguishable — which is exactly why order and author must show.
 *   • "Gröbner Bases" — exercises the latin-ext font subset.
 *
 * Grounding: Database Systems has it ON, so every Lesson there carries a
 * value. Cryptography has it OFF, so its Lessons are all `null` and the UI
 * must render no marker at all — not a "not grounded" one.
 */

/**
 * IDs are derived from `spaceId + order`, which is stable and unique within a
 * Space. Deliberately not a running counter — contributions anchor to these
 * IDs, and a counter would silently re-point every anchor the moment a Lesson
 * was inserted above another. Deliberately not a title slug either: this Space
 * really does contain two Lessons with identical titles.
 */
/**
 * Most Lessons still have the file they were generated from. `material: null`
 * is the *exceptional* case — it means the source was deleted, and the Lesson
 * keeps working while saying so. Defaulting it to null made every row claim
 * "Source file removed", which is how that default was caught.
 */
const materialFor = (
  spaceId: string,
  order: number,
  author: Person,
  /*
   * Absent on most fixtures, and absent is not zero — see `Material.pages`.
   * A Material whose structure has not been read has no Source view, which is
   * the same shape the product has before the pipeline has finished with it.
   */
  pages?: MaterialPage[],
): Material => ({
  id: `m-${spaceId}-${order}`,
  filename: `lesson-${order}.pdf`,
  sizeBytes: 2_400_000,
  uploadedBy: author,
  uploadedAt: '2026-02-10T09:00:00Z',
  sourceRemoved: false,
  ...(pages ? { pages } : {}),
});


/**
 * Concepts — the "planets", and the map's gauge.
 *
 * Doc 2 map rule 5: the dots around a Lesson body ARE its Concepts, filling as
 * they are cleared. So the progress indicator and the illustration are the same
 * object, and these counts have to be real: a Lesson at 100% must have every
 * Concept cleared, and an untouched Lesson none.
 */
const conceptsFor = (
  lessonId: string,
  names: string[],
  cleared: number,
  discovered = 0,
): Concept[] =>
  names.map((name, i) => ({
    id: `c-${lessonId}-${i + 1}`,
    name,
    progress:
      i < cleared ? 'cleared' : i < cleared + discovered ? 'discovered' : 'untouched',
  }));

const lesson = (
  spaceId: string,
  title: string,
  order: number,
  author: Person,
  over: Partial<Lesson> = {},
): Lesson => {
  const id = `l-${spaceId}-${order}`;
  return {
    id,
    material: materialFor(spaceId, order, author),
    spaceId,
    title,
    order,
    state: 'published',
    origin: 'official',
    author,
    grounding: null,
    progress: 'not-started',
    percentComplete: 0,
    concepts: [],
    ...over,
    /*
     * Derived, like `practiceCount`, and for the same reason — it was stated
     * and it lied. Normalization claimed 104 contributions and served 4, so the
     * hero read "104 contributions" two sections above a community section
     * headed "4". I then added a *fresh* instance of it while wiring the
     * promoted Lesson: `contributionCount: 3` over "From the community 0".
     *
     * A stated count next to the list it counts will always drift. Deriving
     * both kills the class rather than the instance.
     *
     * A **getter**, not a value computed here. Deriving it once at module load
     * is still a stated count the moment the underlying set can change: with
     * re-anchoring, moving a contribution onto this Lesson made the hero read
     * "2 contributions" directly above a community section headed "3". Caught
     * in the browser, not by a test — every guard compared the count to the
     * same snapshot it came from.
     */
    get contributionCount() {
      return contributionsForLesson(id).length;
    },
    /*
     * Derived, and deliberately after the spread so no fixture can override
     * it. Seventeen Lessons stated a `practiceCount` and every single one was
     * wrong: Normalization claimed 20 against 3, and fifteen claimed a
     * non-zero count against an empty bank — so fifteen Lessons rendered an
     * enabled, primary-weight "Practice" button that landed on "No practice
     * here yet". Two sources for one fact, disagreeing everywhere, and the
     * practice guards only ever queried the one Lesson that half worked.
     */
    practiceCount: practiceForLesson(id).length,
  };
};

/**
 * The Material behind Normalization, page by page.
 *
 * Twelve pages grouped by Concept and in the same order as the passages, so
 * "this page belongs to 2NF" and "the passage on 2NF" are two routes to one
 * idea. Grouped rather than interleaved because a real file is: whoever built
 * it finished with partial dependencies before starting on transitive ones,
 * and a Source view that jumped between ideas every page would be describing a
 * file nobody has.
 *
 * Real content, for the same reason the passages are real. A page card is a
 * layout with a title and three or four lines on it, and filler lines are all
 * the same length — which is exactly the thing the card has to survive.
 */
const normalizationPages: MaterialPage[] = [
  {
    page: 1,
    conceptId: 'c-l-s-dbs-4-1',
    title: 'What normalization is for',
    bullets: [
      'Redundancy is one fact stored in more than one row',
      'Insert, update and delete anomalies all follow from it',
      'A table that repeats a fact can be made to contradict itself',
      'The normal forms are a sequence of guarantees, each stricter',
    ],
  },
  {
    page: 2,
    conceptId: 'c-l-s-dbs-4-1',
    title: 'Functional dependency',
    bullets: [
      'A → B: any two rows agreeing on A must agree on B',
      'A claim about every row the table will ever hold',
      'Read it off the meaning of the data, never off a sample',
    ],
  },
  {
    page: 3,
    conceptId: 'c-l-s-dbs-4-1',
    title: 'Keys, from dependencies',
    bullets: [
      'Superkey: an attribute set that determines all the others',
      'Candidate key: a superkey with nothing left to remove',
      'Prime attribute: one that belongs to some candidate key',
      'Every normal form below is stated in these three words',
    ],
  },
  {
    page: 4,
    conceptId: 'c-l-s-dbs-4-2',
    title: 'First normal form',
    bullets: [
      'Every attribute holds one indivisible value',
      'No repeating groups: no phone1, phone2, phone3',
      'No lists in a cell, however convenient they look',
    ],
  },
  {
    page: 5,
    conceptId: 'c-l-s-dbs-4-2',
    title: 'Why a list in a cell hurts',
    bullets: [
      'It cannot be joined against, constrained, or usefully indexed',
      'Reading one entry means reading and parsing all of them',
      'Split the group into its own relation, keyed by the parent',
      'The cost is one join; the gain is a database that can check it',
    ],
  },
  {
    page: 6,
    conceptId: 'c-l-s-dbs-4-3',
    title: 'Partial dependency',
    bullets: [
      'Only possible under a composite key',
      'A non-prime attribute depending on part of that key',
      '(order, product) → quantity, but product alone → product name',
    ],
  },
  {
    page: 7,
    conceptId: 'c-l-s-dbs-4-3',
    title: 'Second normal form',
    bullets: [
      'In 1NF, and no non-prime attribute depends on part of a key',
      'Project the partial dependency out into its own relation',
      'Automatic when the key is a single attribute — no part to depend on',
    ],
  },
  {
    page: 8,
    conceptId: 'c-l-s-dbs-4-3',
    title: 'The update anomaly, worked',
    bullets: [
      'Product name repeated on every order line naming that product',
      'Renaming it means finding every one of those lines',
      'Miss one and two rows now disagree about the same product',
    ],
  },
  {
    page: 9,
    conceptId: 'c-l-s-dbs-4-4',
    title: 'Transitive dependency',
    bullets: [
      'Key → A and A → B, where A is not itself a key',
      'Postcode fixes the city, so the city rides along on the row',
      'The city is stored once per row sharing that postcode',
    ],
  },
  {
    page: 10,
    conceptId: 'c-l-s-dbs-4-4',
    title: 'Third normal form',
    bullets: [
      'No non-prime attribute is determined by another non-prime one',
      'The key, the whole key, and nothing but the key',
      'Always reachable, and it can always keep every dependency',
    ],
  },
  {
    page: 11,
    conceptId: 'c-l-s-dbs-4-5',
    title: 'Boyce-Codd normal form',
    bullets: [
      'Every determinant is a candidate key, with no exceptions',
      'Stricter than 3NF by exactly one clause',
      'The two only differ where candidate keys overlap',
    ],
  },
  {
    page: 12,
    conceptId: 'c-l-s-dbs-4-5',
    title: 'What BCNF costs',
    bullets: [
      'A BCNF decomposition can lose a functional dependency',
      '3NF keeps every dependency; BCNF is not obliged to',
      'Which one to give up is a design decision, not a mechanical step',
    ],
  },
];

/**
 * Index Structures has a Material and no text — the shape the reader used to
 * turn into a dead end.
 *
 * Before this fixture existed, a Lesson whose prose had not been written
 * showed "Not written yet" and a way back, even when the file it was built
 * from was sitting right there. That is a screen apologising for having
 * nothing while holding something. It is the *reason* the Source view can be
 * the opening view, so the case needs a fixture or the branch is unreachable.
 */
const indexStructurePages: MaterialPage[] = [
  {
    page: 1,
    conceptId: 'c-l-s-dbs-10-1',
    title: 'Why disk structures differ',
    bullets: [
      'A seek fetches a whole block whether you read one byte or all of it',
      'If you pay for the block, the node should fill the block',
      'Comparisons inside a node are free next to the read that fetched it',
    ],
  },
  {
    page: 2,
    conceptId: 'c-l-s-dbs-10-1',
    title: 'What a B-tree node holds',
    bullets: [
      'One node is one block: hundreds of sorted keys, and keys+1 children',
      'Fan-out is how many children a node can point at',
      'Fan-out 500 over three levels reaches 125 million keys',
    ],
  },
  {
    page: 3,
    conceptId: 'c-l-s-dbs-10-1',
    title: 'Search, insert, split',
    bullets: [
      'Binary-search within the node, follow the child that brackets the key',
      'A lookup costs the height of the tree — three or four reads',
      'A full leaf splits and promotes its median key to the parent',
      'Splits cascade upward; a root split is how the tree grows',
    ],
  },
  {
    page: 4,
    conceptId: 'c-l-s-dbs-10-2',
    title: 'Hashing',
    bullets: [
      'A hash function maps the key straight to a bucket',
      'One read for an exact match, however large the table',
      'No order, so no range scan and no sorted output',
    ],
  },
  {
    page: 5,
    conceptId: 'c-l-s-dbs-10-2',
    title: 'Collisions',
    bullets: [
      'Two keys, one bucket — resolved by chaining or by probing',
      'The load factor decides how often that happens',
      'Static hashing degrades as the table outgrows its design size',
    ],
  },
  {
    page: 6,
    conceptId: 'c-l-s-dbs-10-2',
    title: 'Choosing between them',
    bullets: [
      'Range and prefix queries need the order a B-tree keeps',
      'Equality-only lookups are cheaper hashed',
      'Engines default to B-trees because ranges turn up everywhere',
    ],
  },
];

/** ── Database Systems · Guided · grounding ON ───────────────────── */

export const dbsLessons: Lesson[] = [
  lesson('s-dbs', 'Introduction', 1, keller, {
    grounding: 'grounded',
    progress: 'in-progress',
    // 60 and 80 across the first two Lessons of ten is the 14% the Space
    // claims. It used to be 3 and 11, which averages to 1% — so the tile said
    // 14% and the Lessons said 1.4%.
    percentComplete: 60,
    practiceCount: 8,
      concepts: conceptsFor('l-s-dbs-1', ['Why databases', 'The three-level architecture', 'Data independence'], 0, 1),
  }),
  lesson('s-dbs', 'Basics', 2, keller, {
    grounding: 'grounded',
    progress: 'in-progress',
    percentComplete: 80,
    practiceCount: 14,
      concepts: conceptsFor('l-s-dbs-2', ['Entities', 'Attributes', 'Keys', 'Cardinality'], 1, 1),
  }),
  lesson('s-dbs', 'Relational Design', 3, keller, {
    grounding: 'grounded',
    practiceCount: 12,
      concepts: conceptsFor('l-s-dbs-3', ['Relations', 'Foreign keys', 'ER to relational'], 0, 0),
  }),
  /*
   * The one Lesson with its text written out.
   *
   * Real prose, not filler, because the reader is a typography surface and
   * lorem ipsum lies about line length, paragraph rhythm and how a heading
   * sits against the paragraph under it. Normalization was chosen because it
   * already carries the most fixtures — 104 contributions, 20 practice
   * questions, five Concepts — so the reader is exercised against the busiest
   * Lesson rather than the emptiest.
   */
  lesson('s-dbs', 'Normalization', 4, keller, {
    grounding: 'grounded',
    practiceCount: 20,
    // Both views of one Lesson: the written text below, and the file it was
    // written from. This is the only fixture that has both.
    material: materialFor('s-dbs', 4, keller, normalizationPages),
      concepts: conceptsFor('l-s-dbs-4', ['Functional dependency', '1NF', '2NF', '3NF', 'BCNF'], 0, 0),
    passages: [
      {
        conceptId: 'c-l-s-dbs-4-1',
        heading: 'Functional dependency',
        body: [
          'A functional dependency is a promise about the data: given a value for one set of attributes, the value of another set is fixed. Written A → B, it says that any two rows agreeing on A must agree on B. Nothing about the current contents of the table proves this — it is a claim about every row the table will ever hold.',
          'That last point is the one people skip. You cannot read dependencies off a sample. A table where every member happens to have a distinct surname does not mean surname determines the person; it means you have not met the second Müller yet.',
        ],
      },
      {
        conceptId: 'c-l-s-dbs-4-2',
        heading: 'First normal form',
        body: [
          'A relation is in 1NF when every attribute holds a single, indivisible value. No repeating groups, no comma-separated lists, no three columns called phone1, phone2 and phone3.',
          'The reason is not tidiness. A list in a cell cannot be joined against, cannot be constrained, and cannot be indexed usefully — so every query that needs one item out of it has to read all of them and take the database out of the decision.',
        ],
      },
      {
        conceptId: 'c-l-s-dbs-4-3',
        heading: 'Second normal form',
        body: [
          '2NF removes partial dependencies: a non-key attribute must depend on the whole of a composite key, not part of it.',
          'The classic shape is an order-line table keyed on (order, product) that also carries the product name. The name depends on the product alone, so it is repeated on every line that mentions the product — and updating it means finding all of them, which is how one row ends up disagreeing with another.',
          'If the key is a single attribute, 2NF is automatic. There is no part of it to depend on.',
        ],
      },
      {
        conceptId: 'c-l-s-dbs-4-4',
        heading: 'Third normal form',
        body: [
          '3NF removes transitive dependencies: a non-key attribute must not be determined by another non-key attribute.',
          'Keep a postcode and a city on the same row and you have one, because the postcode fixes the city. The city is now stored once per row that shares that postcode, and the table can be made to contradict itself by editing one of them.',
          'The mnemonic is worth the space it takes: every non-key attribute depends on the key, the whole key, and nothing but the key.',
        ],
      },
      {
        conceptId: 'c-l-s-dbs-4-5',
        heading: 'Boyce-Codd normal form',
        body: [
          'BCNF is stricter than 3NF by one clause: every determinant must be a candidate key, with no exception for determinants that are part of one.',
          'The difference only shows up when a relation has two overlapping candidate keys, which is why most tables are in BCNF the moment they reach 3NF, and why the counterexample is worth memorising rather than deriving.',
          'BCNF is also where decomposition stops being free. A BCNF decomposition can lose a functional dependency that 3NF would have kept, and choosing which to give up is a design decision rather than a mechanical step.',
        ],
      },
    ],
  }),
  lesson('s-dbs', 'Relational Algebra', 5, keller, {
    grounding: 'grounded',
    practiceCount: 16,
      concepts: conceptsFor('l-s-dbs-5', ['Selection', 'Projection', 'Join', 'Set operations'], 0, 0),
  }),
  lesson('s-dbs', 'SQL', 6, keller, {
    grounding: 'grounded',
    practiceCount: 24,
      concepts: conceptsFor('l-s-dbs-6', ['SELECT', 'JOIN', 'GROUP BY', 'Subqueries'], 0, 0),
  }),
  lesson('s-dbs', 'Integrity', 7, keller, {
    grounding: 'grounded',
    practiceCount: 9,
    concepts: conceptsFor('l-s-dbs-7', ['Constraints', 'Triggers'], 0, 0),
  }),
  lesson('s-dbs', 'Transactions', 8, keller, {
    grounding: 'grounded',
    practiceCount: 18,
      concepts: conceptsFor('l-s-dbs-8', ['ACID', 'Isolation levels', 'Deadlock'], 0, 0),
  }),
  // Official, but outside the truth set — Grounding Rule 6: an Official Lesson
  // can legitimately be not grounded. Origin and Grounding are orthogonal.
  lesson('s-dbs', 'Query Processing', 9, keller, {
    grounding: 'not-grounded',
    practiceCount: 6,
      concepts: conceptsFor('l-s-dbs-9', ['Plans', 'Cost estimation'], 0, 0),
  }),
  // A Material and no prose — the reader opens straight into the file rather
  // than saying "Not written yet" while holding the thing you came to read.
  lesson('s-dbs', 'Index Structures', 10, keller, {
    grounding: 'grounded',
    practiceCount: 11,
      concepts: conceptsFor('l-s-dbs-10', ['B-trees', 'Hashing'], 0, 0),
    material: materialFor('s-dbs', 10, keller, indexStructurePages),
  }),
];

/** ── Advanced Topics in Cryptography · Guided · grounding OFF ───── */

export const cryptoLessons: Lesson[] = [
  lesson('s-crypto', 'Differential Cryptanalysis', 1, weber, {
    progress: 'in-progress',
    // 11 of one Lesson in eleven is the 1% the Space claims.
    percentComplete: 11,
    practiceCount: 5,
  }),
  // Duplicate title #1 — real data. Order + author are the only differentiators.
  lesson('s-crypto', 'Advanced Topics in Cryptography', 2, weber),
  lesson('s-crypto', 'Advanced Topics in Cryptology', 3, weber),
  // Duplicate title #2.
  lesson('s-crypto', 'Advanced Topics in Cryptography', 4, weber),
  lesson('s-crypto', 'Impossible Differentials', 5, weber),
  /*
   * The fourth shape: written prose and no Material at all.
   *
   * The source file was deleted and the Lesson keeps working (Objects, Rule
   * 4) — which is the whole argument for `pages` hanging off the Material,
   * and it was only ever shown on Lessons that had nothing to read either.
   * Both `material: null` fixtures were also passage-less, so "a Lesson with
   * a text and no Material" and "a Lesson with neither" were being exercised
   * by the same rows and the reader's Read-only branch had never had a
   * fixture of its own.
   *
   * The prose is here rather than on a new Lesson because a new row moves
   * Space-level counts (`lessonCount`, `viewerProgress`) that a dozen guards
   * hold to; putting a new shape on an existing Lesson moves nothing but the
   * Lesson.
   *
   * It also lands the reading surface in the one Space with grounding OFF, so
   * the dormant-marker branch finally has something to read while it is off.
   */
  lesson('s-crypto', 'The Sage Computer Algebra System', 6, weber, {
    material: null,
    concepts: conceptsFor(
      'l-s-crypto-6',
      ['Symbolic expressions', 'The preparser'],
      0,
      0,
    ),
    passages: [
      {
        conceptId: 'c-l-s-crypto-6-1',
        heading: 'Symbolic expressions',
        body: [
          /*
           * Written without code spans, and it is not a style choice.
           * `ReaderScreen` renders each paragraph as a plain text node — there
           * is no Markdown in the passage path — so a backtick is a backtick on
           * screen. This paragraph shipped twelve of them, visible at
           * /v4/space/s-crypto/lesson/l-s-crypto-6/read. Giving passages code
           * spans is a change to the `Passage` type and its renderer, not
           * something a fixture may assume; `reader.test.ts` now refuses the
           * assumption on every fixture rather than on this one.
           */
          'A symbolic expression in Sage is an object in the symbolic ring, not a piece of text waiting to be parsed. Names have to be brought into being before they can be used — var("x, y") creates them — and from that point x^2 − y is a value you can differentiate, substitute into and compare, in the same way an integer is a value you can add.',
          'The consequence people trip over is that nothing simplifies itself. Sage will hold an expression in exactly the shape you built it in until you ask otherwise, because two expressions that are mathematically equal are rarely equally useful, and choosing between them is your decision rather than the system’s.',
        ],
      },
      {
        conceptId: 'c-l-s-crypto-6-2',
        heading: 'The preparser',
        body: [
          'Sage is Python with one layer in front of it. Before Python sees a line, the preparser rewrites it: a bare 2 becomes a Sage integer rather than a machine int, the caret becomes exponentiation rather than exclusive-or, and 1/3 becomes an exact rational rather than a truncated division.',
          'That layer is why 2^10 is 1024 here and 8 in plain Python, and why arithmetic stays exact until you ask for a decimal. It is also the first thing to remember when pasting code the other way: what runs in Sage will not always run in a bare Python interpreter, and the difference is a rewrite you never see.',
        ],
      },
    ],
  }),
  lesson('s-crypto', 'Multivariate polynomial rings', 7, weber),
  lesson('s-crypto', 'Gröbner Bases', 8, weber),
  lesson(
    's-crypto',
    'Linear Recurring Sequences and Feedback Shift Registers over Finite Fields',
    9,
    weber,
  ),
  lesson('s-crypto', 'Linearisation and Fast Linear Algebra', 10, weber),
  lesson('s-crypto', 'Post-Quantum Cryptography', 11, weber),
  lesson('s-crypto', 'Lattice Problems', 12, weber, { state: 'needs-review' }),
  /*
   * A **promoted** Lesson: Community origin, in a *Guided* Space.
   *
   * A comment here used to say this was "impossible by definition", and a
   * notification describing it was deleted on that basis. Abi's call,
   * 2026-08-31: promotion is possible in Guided mode — which is right, because
   * origin says who *made* something and mode says who may *publish* it, and
   * those are different questions. A promotion is the Owner publishing a
   * member's contribution into the path with the credit intact, so the Lesson
   * is Community-origin and the Space is still Guided.
   *
   * Authored by the viewer, because the notification is about you.
   */
  lesson('s-crypto', 'Lattice Sieving in Practice', 13, viewer, {
    origin: 'community',
  }),
];

/** ── Intro to Linear Algebra · Open · owned by the viewer ───────── */

export const linalgLessons: Lesson[] = [
  lesson('s-linalg', 'Vectors and Matrices', 1, viewer, {
    progress: 'done',
    percentComplete: 100,
    practiceCount: 6,
  }),
  // Open mode: a Member published this. Community origin, author always shown.
  lesson('s-linalg', 'Eigenvalues, intuitively', 2, lindqvist, {
    origin: 'community',
    practiceCount: 3,
  }),
  // Still ingesting — visible to its author and Owner/Editors only (Rule 1).
  lesson('s-linalg', 'Determinants', 3, viewer, { state: 'processing' }),
  // Draft — same visibility rule.
  lesson('s-linalg', 'Change of Basis', 4, viewer, { state: 'draft' }),
  /*
   * Built, but the extraction came back uncertain and wants a human read.
   * The only `needs-review` fixture used to belong to `weber` in a Space the
   * viewer is only a Member of — and every drafts view is author-filtered, so
   * the amber "Needs review" pill had never rendered on either screen that
   * handles it.
   */
  lesson('s-linalg', 'Orthogonality and Projections', 5, viewer, {
    state: 'needs-review',
    practiceCount: 4,
  }),
];

/** ── Discover · not joined ─────────────────────────────────────── */

/**
 * Discover Spaces need real Lessons too. "Every public Space has a public page
 * — visible without joining. Shows what's inside (lesson list…). Blind joins
 * cause churn." A Discover card that promises 23 Lessons and shows none is the
 * blind join the rule exists to prevent.
 */
/*
 * Origin follows the *role*, not the mode.
 *
 * All five of these were `community`, including the three by Chidi — who owns
 * this Space. Doc 1 defines Official as Owner/Editors and Community as
 * Members, so an Owner's own Lesson is Official even in an Open Space where
 * everybody publishes. Caught by the guard that replaced the one asserting
 * Community-in-Guided was impossible, about a minute after writing it.
 */
export const mlLessons: Lesson[] = [
  lesson('s-ml', 'Linear regression, by hand', 1, okonkwo),
  lesson('s-ml', 'Gradient descent', 2, okonkwo),
  // Åsa is a Member here, so hers are Community — which is the distinction
  // the Origin badge exists to draw, and this is the Space that shows both.
  lesson('s-ml', 'Backpropagation from first principles', 3, lindqvist, {
    origin: 'community',
  }),
  lesson('s-ml', 'Attention is all you need — a read-through', 4, lindqvist, {
    origin: 'community',
  }),
  lesson('s-ml', 'Tokenizers', 5, okonkwo),
];

export const analysisLessons: Lesson[] = [
  lesson('s-analysis', 'Partielle Ableitungen', 1, ferreira, { grounding: 'grounded' }),
  lesson('s-analysis', 'Totale Differenzierbarkeit', 2, ferreira, { grounding: 'grounded' }),
  lesson('s-analysis', 'Der Satz von Taylor', 3, ferreira, { grounding: 'grounded' }),
  lesson('s-analysis', 'Extrema unter Nebenbedingungen', 4, ferreira, { grounding: 'grounded' }),
];

/** Archived Space — read-only, but its Lessons and progress are still there. */
export const statisticsLessons: Lesson[] = [
  lesson('s-stats', 'Wahrscheinlichkeitsräume', 1, ferreira, {
    grounding: 'grounded', progress: 'done', percentComplete: 100,
  }),
  lesson('s-stats', 'Zufallsvariablen', 2, ferreira, {
    grounding: 'grounded', progress: 'done', percentComplete: 100,
  }),
  lesson('s-stats', 'Erwartungswert und Varianz', 3, ferreira, {
    grounding: 'grounded', progress: 'done', percentComplete: 100,
  }),
  // Finished. Statistik I is the one Space the viewer has completed, which is
  // what makes `SpaceTile`'s "Done" badge reachable — it sat in an if/else
  // chain with two live branches and had never rendered against anything.
  lesson('s-stats', 'Schätzer', 4, ferreira, {
    grounding: 'grounded', progress: 'done', percentComplete: 100,
  }),
];

/** ── Diskrete Strukturen · finished ─────────────────────────────── */

export const discreteLessons: Lesson[] = [
  lesson('s-discrete', 'Mengen und Relationen', 1, keller, {
    grounding: 'grounded', progress: 'done', percentComplete: 100, practiceCount: 7,
    concepts: conceptsFor('l-s-discrete-1', ['Mengenoperationen', 'Äquivalenzrelationen'], 2),
  }),
  lesson('s-discrete', 'Vollständige Induktion', 2, keller, {
    grounding: 'grounded', progress: 'done', percentComplete: 100, practiceCount: 9,
    concepts: conceptsFor('l-s-discrete-2', ['Induktionsanfang', 'Induktionsschritt'], 2),
  }),
  lesson('s-discrete', 'Graphen', 3, keller, {
    grounding: 'grounded', progress: 'done', percentComplete: 100, practiceCount: 12,
    concepts: conceptsFor('l-s-discrete-3', ['Wege und Kreise', 'Bäume', 'Zusammenhang'], 3),
  }),
];

const bySpace: Record<string, Lesson[]> = {
  's-discrete': discreteLessons,
  's-dbs': dbsLessons,
  's-crypto': cryptoLessons,
  's-linalg': linalgLessons,
  's-ml': mlLessons,
  's-analysis': analysisLessons,
  's-stats': statisticsLessons,
};

/**
 * Lessons added this session, kept apart from the fixture arrays.
 *
 * Separate rather than pushed into `bySpace` for the same reason
 * `createdThisSession` exists for Spaces: a mutable base array would make
 * "covers every state" depend on whatever was last clicked, and the fixture
 * guards would start passing or failing according to click history.
 */
const addedThisSession: Lesson[] = [];

/** Every Lesson in a Space, in path order. Order is fixed in both modes. */
export const lessonsForSpace = (spaceId: string): Lesson[] =>
  [...(bySpace[spaceId] ?? []), ...addedThisSession.filter((l) => l.spaceId === spaceId)].sort(
    (a, b) => a.order - b.order,
  );

/**
 * How far through a Space's path the viewer is, 0–100.
 *
 * The mean of `percentComplete` across the published path — so a Space where
 * you have half-read two of ten Lessons is 10% through it, not 20%.
 *
 * Derived because it was stated. `Space.viewerProgress` said Linear Algebra
 * was 33% while Ascent computed 50% from the same Lessons, so the tile and the
 * journey map disagreed on screen and both looked right. They are different
 * questions — "how far through the material" versus "how many Lessons
 * cleared" — but they cannot be *inconsistent*, and 33% was consistent with
 * nothing.
 */
export const progressAcross = (spaceId: string): number => {
  const path = publishedLessonsForSpace(spaceId);
  if (!path.length) return 0;
  return Math.round(path.reduce((n, l) => n + l.percentComplete, 0) / path.length);
};

/** Test seam — session additions must not leak between tests. */
export const resetAddedLessons = (): void => {
  addedThisSession.length = 0;
};

/**
 * Add a Lesson to a Space's path.
 *
 * It lands as a **draft**, always. Uploading material starts a build; it does
 * not publish. Rule 1 then makes it visible to its author and the
 * Owner/Editors and nobody else — which is what the drafts list in Studio is
 * for, and why "Add Lesson" is not the same act as "publish".
 */
export const addLesson = (
  spaceId: string,
  title: string,
  author: Person,
  over: Partial<Lesson> = {},
): Lesson => {
  const order = lessonsForSpace(spaceId).length + 1;
  const created = lesson(spaceId, title.trim(), order, author, {
    state: 'draft',
    /*
     * Origin follows the author's **role**, not their identity.
     *
     * This used to read `author.id === viewer.id ? 'community' : 'official'` —
     * "mine is Community, everyone else's is Official" — which is not a rule at
     * all. It broke promotion outright: promoting a member's contribution
     * created an *Official* Lesson, which is precisely the credit the
     * promotion is supposed to carry across. Caught by the guard on the day
     * promotion was built.
     *
     * Doc 1: Official is Owner/Editors, Community is Members. Somebody with no
     * membership row is treated as a Member, which is the safer default — it
     * marks the content as community-authored rather than passing it off as
     * part of the official core.
     */
    origin: canPublishOfficial(spaceId, author.id) ? 'official' : 'community',
    material: null,
    ...over,
  });
  addedThisSession.push(created);
  return created;
};

/** Whether this person's work in this Space counts as Official. */
const canPublishOfficial = (spaceId: string, personId: string): boolean => {
  const role = membersForSpace(spaceId).find((m) => m.person.id === personId)?.role;
  return role === 'owner' || role === 'editor';
};

/**
 * One Lesson by id, and the Space it belongs to, without knowing the Space
 * first.
 *
 * Library needed this and did not have it, so it hardcoded `'Normalization'`
 * and `'s-dbs'` as the label for *any* lesson-anchored contribution — in three
 * separate places. Every such contribution outside that one Lesson would have
 * been filed under the wrong Lesson, in the wrong Space, in Library, in the
 * Studio impact table and in ⌘K results independently.
 */
export const locateLesson = (
  lessonId: string,
): { lesson: Lesson; spaceId: string } | undefined => {
  for (const [spaceId, lessons] of Object.entries(bySpace)) {
    const lesson = lessons.find((l) => l.id === lessonId);
    if (lesson) return { lesson, spaceId };
  }
  return undefined;
};

/**
 * What a Member is allowed to see: published only. Drafts and processing
 * states belong to their author and the Owner/Editors (Rules, 1).
 */
export const publishedLessonsForSpace = (spaceId: string): Lesson[] =>
  lessonsForSpace(spaceId).filter((l) => l.state === 'published');

/**
 * What *this viewer* may see in this Space — the Rule 1 filter itself, rather
 * than the two halves of it.
 *
 * This exists because the rule was living in `useSpace` while `LessonScreen`
 * and `PracticeScreen` did their own `lessonsForSpace(...).find(...)`. Both
 * therefore rendered a draft to anyone holding the URL, with no Draft marker
 * anywhere on the screen — `/v4/space/s-linalg/lesson/l-s-linalg-4` was an
 * unpublished Lesson served to a stranger.
 *
 * Passing the Space rather than a role means a caller cannot ask the question
 * without having established who is asking, which is what made it easy to skip.
 */
export const visibleLessonsForSpace = (space: Space): Lesson[] =>
  space.viewerRole === 'owner' || space.viewerRole === 'editor'
    ? lessonsForSpace(space.id)
    : publishedLessonsForSpace(space.id);

/** One Lesson, or undefined if this viewer is not allowed to know it exists. */
export const visibleLesson = (space: Space, lessonId: string): Lesson | undefined =>
  visibleLessonsForSpace(space).find((l) => l.id === lessonId);

/**
 * The Lessons either side of one, for the pager.
 *
 * Walks the **published** path only. Rule 1: Members only ever see published
 * Lessons — a pager that stepped into a draft would leak unpublished work to
 * anyone who pressed the arrow key twice. Returns nulls at the ends and for a
 * Lesson that is not in this Space.
 */
export const adjacentLessons = (
  spaceId: string,
  lessonId: string,
): { prev: Lesson | null; next: Lesson | null } => {
  const path = publishedLessonsForSpace(spaceId);
  const i = path.findIndex((l) => l.id === lessonId);
  if (i === -1) return { prev: null, next: null };
  return { prev: path[i - 1] ?? null, next: path[i + 1] ?? null };
};
