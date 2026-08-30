import type { Concept, ConceptDetail, Contribution } from '../types';
import { lessonsForSpace } from './lessons';
import { allSpaces } from './spaces';
import { ferreira, lindqvist, okonkwo, viewer } from './people';

/**
 * Concept fixtures, derived from the Lessons rather than declared separately.
 *
 * Deriving matters: a Concept list maintained by hand would drift from the
 * Lessons that own it, and the map already reads `lesson.concepts` as its
 * gauge. One source, two readers.
 *
 * `weight` and the cross-Lesson `lessonIds` mirror `conceptsService`'s
 * `LectureConcept.weight` and `RelatedLecture` — both real endpoints today.
 */

/**
 * Concepts that genuinely recur across Lessons. The backend models this with
 * RelatedLecture, so the fixture set has to contain at least one or the
 * "also appears in" section would be dead code that looks fine.
 */
const SHARED: Record<string, string[]> = {
  // Keys are introduced in Basics and used again by Normalization.
  Keys: ['l-s-dbs-2', 'l-s-dbs-4'],
};

/** Deterministic weight — central ideas first, mirroring LectureConcept.weight. */
const weightFor = (index: number, total: number) =>
  Math.round((1 - (index / Math.max(total, 1)) * 0.6) * 100) / 100;

export const allConcepts = (): ConceptDetail[] => {
  const out = new Map<string, ConceptDetail>();
  for (const space of allSpaces) {
    for (const lesson of lessonsForSpace(space.id)) {
      lesson.concepts.forEach((c: Concept, i) => {
        const extra = SHARED[c.name] ?? [];
        const lessonIds = Array.from(new Set([lesson.id, ...extra]));
        // First writer wins, so a shared Concept keeps its earliest Lesson's
        // progress — the one where it was actually introduced.
        if (!out.has(c.id)) {
          out.set(c.id, {
            ...c,
            weight: weightFor(i, lesson.concepts.length),
            spaceId: space.id,
            lessonIds,
          });
        }
      });
    }
  }
  return [...out.values()];
};

export const conceptById = (id: string): ConceptDetail | undefined =>
  allConcepts().find((c) => c.id === id);

export const conceptsForLesson = (lessonId: string): ConceptDetail[] =>
  allConcepts().filter((c) => c.lessonIds.includes(lessonId));

/**
 * Contributions anchored at Concept level — the third anchor Doc 1 defines
 * ("a worked example of JOIN, a mnemonic, an animation of one idea"). Space
 * and Lesson anchors already had fixtures; this level did not, so its section
 * had never been rendered against real data.
 */
export const conceptContributions: Contribution[] = [
  {
    id: 'cc-1',
    title: 'A three-line way to remember what a candidate key is',
    excerpt:
      'Any set of attributes that identifies a row uniquely and has nothing spare in it. Drop one attribute and it stops identifying — that "nothing spare" part is the whole definition.',
    type: 'text',
    anchor: { level: 'concept', conceptId: 'c-l-s-dbs-2-3' },
    origin: 'community',
    author: lindqvist,
    grounding: 'grounded',
    likeCount: 64,
    likedByViewer: true,
    endorsed: true,
    hidden: false,
    orphaned: false,
    createdAt: '2026-08-18T09:20:00Z',
  },
  {
    id: 'cc-2',
    title: 'Candidate keys vs primary key — worked on one relation',
    excerpt:
      'Same relation, three candidate keys, and the arbitrary choice of which becomes primary. Once you see the choice is arbitrary, the rest of normalization reads differently.',
    type: 'practice-set',
    anchor: { level: 'concept', conceptId: 'c-l-s-dbs-2-3' },
    origin: 'community',
    author: okonkwo,
    grounding: 'grounded',
    likeCount: 31,
    likedByViewer: false,
    endorsed: false,
    hidden: false,
    orphaned: false,
    createdAt: '2026-08-22T14:00:00Z',
  },
  {
    id: 'cc-3',
    title: 'Why BCNF is stricter, in one picture',
    type: 'image',
    excerpt: 'The determinant/candidate-key overlap drawn as two circles.',
    anchor: { level: 'concept', conceptId: 'c-l-s-dbs-4-5' },
    origin: 'community',
    author: ferreira,
    grounding: 'not-grounded',
    likeCount: 12,
    likedByViewer: false,
    endorsed: false,
    hidden: false,
    orphaned: false,
    createdAt: '2026-08-27T16:30:00Z',
  },
  {
    id: 'cc-4',
    title: 'My note on functional dependency, cleaned up and shared',
    excerpt: 'A → B means: fix A and B can only be one thing. That is all it means.',
    type: 'text',
    anchor: { level: 'concept', conceptId: 'c-l-s-dbs-4-1' },
    origin: 'community',
    author: viewer,
    grounding: 'grounded',
    likeCount: 3,
    likedByViewer: false,
    endorsed: false,
    hidden: false,
    orphaned: false,
    createdAt: '2026-08-29T11:00:00Z',
  },
];

/** Likes sort the community section — never the path. */
export const contributionsForConcept = (conceptId: string): Contribution[] =>
  conceptContributions
    .filter((c) => c.anchor.level === 'concept' && c.anchor.conceptId === conceptId && !c.hidden)
    .sort((a, b) => b.likeCount - a.likeCount);
