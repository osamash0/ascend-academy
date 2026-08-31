import type { Concept, Lesson, Material, Person, Space } from '../types';
import { viewer, keller, weber, lindqvist, okonkwo, ferreira } from './people';
import { practiceForLesson } from './practice';
import { contributionsForLesson } from './contributions';

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
const materialFor = (spaceId: string, order: number, author: Person): Material => ({
  id: `m-${spaceId}-${order}`,
  filename: `lesson-${order}.pdf`,
  sizeBytes: 2_400_000,
  uploadedBy: author,
  uploadedAt: '2026-02-10T09:00:00Z',
  sourceRemoved: false,
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
     */
    contributionCount: contributionsForLesson(id).length,
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
  lesson('s-dbs', 'Index Structures', 10, keller, {
    grounding: 'grounded',
    practiceCount: 11,
      concepts: conceptsFor('l-s-dbs-10', ['B-trees', 'Hashing'], 0, 0),
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
  lesson('s-crypto', 'The Sage Computer Algebra System', 6, weber, {
    // The source file was deleted; the Lesson keeps working (Objects, Rule 4).
    material: null,
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
export const addLesson = (spaceId: string, title: string, author: Person): Lesson => {
  const order = lessonsForSpace(spaceId).length + 1;
  const created = lesson(spaceId, title.trim(), order, author, {
    state: 'draft',
    // Community when a Member adds it; the Space's mode decides whether a
    // Member may, and that check lives on the screen that owns the action.
    origin: author.id === viewer.id ? 'community' : 'official',
    material: null,
  });
  addedThisSession.push(created);
  return created;
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
