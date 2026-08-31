import type { Concept, Lesson, Material, Person, Space } from '../types';
import { viewer, keller, weber, lindqvist, okonkwo, ferreira } from './people';

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
): Lesson => ({
  id: `l-${spaceId}-${order}`,
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
  contributionCount: 0,
  practiceCount: 0,
  ...over,
});

/** ── Database Systems · Guided · grounding ON ───────────────────── */

export const dbsLessons: Lesson[] = [
  lesson('s-dbs', 'Introduction', 1, keller, {
    grounding: 'grounded',
    progress: 'in-progress',
    percentComplete: 3,
    contributionCount: 12,
    practiceCount: 8,
      concepts: conceptsFor('l-s-dbs-1', ['Why databases', 'The three-level architecture', 'Data independence'], 0, 1),
  }),
  lesson('s-dbs', 'Basics', 2, keller, {
    grounding: 'grounded',
    progress: 'in-progress',
    percentComplete: 11,
    contributionCount: 31,
    practiceCount: 14,
      concepts: conceptsFor('l-s-dbs-2', ['Entities', 'Attributes', 'Keys', 'Cardinality'], 1, 1),
  }),
  lesson('s-dbs', 'Relational Design', 3, keller, {
    grounding: 'grounded',
    contributionCount: 7,
    practiceCount: 12,
      concepts: conceptsFor('l-s-dbs-3', ['Relations', 'Foreign keys', 'ER to relational'], 0, 0),
  }),
  lesson('s-dbs', 'Normalization', 4, keller, {
    grounding: 'grounded',
    contributionCount: 104,
    practiceCount: 20,
      concepts: conceptsFor('l-s-dbs-4', ['Functional dependency', '1NF', '2NF', '3NF', 'BCNF'], 0, 0),
  }),
  lesson('s-dbs', 'Relational Algebra', 5, keller, {
    grounding: 'grounded',
    contributionCount: 18,
    practiceCount: 16,
      concepts: conceptsFor('l-s-dbs-5', ['Selection', 'Projection', 'Join', 'Set operations'], 0, 0),
  }),
  lesson('s-dbs', 'SQL', 6, keller, {
    grounding: 'grounded',
    contributionCount: 56,
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
    contributionCount: 9,
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
    percentComplete: 4,
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
  // Community-origin Lesson in a *Guided* Space is impossible by definition,
  // so this last one is Official too — the Open case lives in Linear Algebra.
  lesson('s-crypto', 'Lattice Problems', 12, weber, { state: 'needs-review' }),
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
    contributionCount: 4,
    practiceCount: 3,
  }),
  // Still ingesting — visible to its author and Owner/Editors only (Rule 1).
  lesson('s-linalg', 'Determinants', 3, viewer, { state: 'processing' }),
  // Draft — same visibility rule.
  lesson('s-linalg', 'Change of Basis', 4, viewer, { state: 'draft' }),
];

/** ── Discover · not joined ─────────────────────────────────────── */

/**
 * Discover Spaces need real Lessons too. "Every public Space has a public page
 * — visible without joining. Shows what's inside (lesson list…). Blind joins
 * cause churn." A Discover card that promises 23 Lessons and shows none is the
 * blind join the rule exists to prevent.
 */
export const mlLessons: Lesson[] = [
  lesson('s-ml', 'Linear regression, by hand', 1, okonkwo, { origin: 'community' }),
  lesson('s-ml', 'Gradient descent', 2, okonkwo, { origin: 'community' }),
  lesson('s-ml', 'Backpropagation from first principles', 3, lindqvist, { origin: 'community' }),
  lesson('s-ml', 'Attention is all you need — a read-through', 4, lindqvist, { origin: 'community' }),
  lesson('s-ml', 'Tokenizers', 5, okonkwo, { origin: 'community' }),
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
  lesson('s-stats', 'Schätzer', 4, ferreira, {
    grounding: 'grounded', progress: 'in-progress', percentComplete: 40,
  }),
];

const bySpace: Record<string, Lesson[]> = {
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
