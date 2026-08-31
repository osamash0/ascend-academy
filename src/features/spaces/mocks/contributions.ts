import type { Contribution, Membership } from '../types';
import { viewer, keller, weber, ferreira, okonkwo, lindqvist } from './people';

/**
 * Contribution fixtures.
 *
 * Every one is Community origin by definition — Official content is a Lesson,
 * not a contribution. Each carries a real author, a like count, and a single
 * anchor. Likes sort this list; likes never reorder the path.
 *
 * Grounding follows the Space: these are anchored in Database Systems, which
 * has grounding ON, so each has a real value. A Community summary being
 * `grounded` while an Official Lesson is `not-grounded` is intentional —
 * the two axes are orthogonal (Grounding, Rule 6).
 */

export const normalizationContributions: Contribution[] = [
  {
    id: 'c-1',
    title: '3NF vs BCNF — the one example that made it click',
    excerpt:
      'Take R(A,B,C) with two overlapping candidate keys. It satisfies 3NF because every determinant is *part of* a key — but not BCNF, because it is not a key on its own. That single relation is the whole difference.',
    type: 'text',
    anchor: { level: 'lesson', lessonId: 'l-s-dbs-4' },
    origin: 'community',
    author: lindqvist,
    grounding: 'grounded',
    likeCount: 148,
    likedByViewer: true,
    endorsed: true,
    hidden: false,
    orphaned: false,
    createdAt: '2026-08-14T10:00:00Z',
  },
  {
    id: 'c-2',
    title: 'Practice: 20 normalization questions with worked answers',
    excerpt:
      'Twenty relations, from obvious 1NF violations up to two that are genuinely ambiguous. Every answer shows the functional dependencies first, then the decomposition.',
    type: 'practice-set',
    anchor: { level: 'lesson', lessonId: 'l-s-dbs-4' },
    origin: 'community',
    author: okonkwo,
    grounding: 'grounded',
    likeCount: 97,
    likedByViewer: false,
    endorsed: false,
    hidden: false,
    orphaned: false,
    createdAt: '2026-08-19T15:30:00Z',
  },
  {
    id: 'c-3',
    // Not grounded: no supporting passage was found. This says nothing about
    // correctness (Grounding, Rule 2) — it is a quiet marker, not a warning.
    title: 'A shortcut for spotting transitive dependencies',
    excerpt:
      'Read each non-key attribute and ask: could I work this out from another non-key attribute? If yes, that is your transitive dependency, and it is the 3NF violation.',
    type: 'text',
    anchor: { level: 'lesson', lessonId: 'l-s-dbs-4' },
    origin: 'community',
    author: ferreira,
    grounding: 'not-grounded',
    likeCount: 23,
    likedByViewer: false,
    endorsed: false,
    hidden: false,
    orphaned: false,
    createdAt: '2026-08-25T08:05:00Z',
  },
  {
    id: 'c-4',
    // The viewer's own. You can't like your own contribution (Engagement, 3).
    title: 'Mnemonic for the normal forms',
    excerpt:
      'The key, the whole key, and nothing but the key — 1NF atomic, 2NF no partial, 3NF no transitive.',
    type: 'image',
    anchor: { level: 'lesson', lessonId: 'l-s-dbs-4' },
    origin: 'community',
    author: viewer,
    grounding: 'not-grounded',
    likeCount: 4,
    likedByViewer: false,
    // Endorsed, because notification n-1 says Asa endorsed it. This said
    // `false`, so the bell announced an endorsement that Library, the Studio
    // impact table and the card badge all denied had happened.
    endorsed: true,
    hidden: false,
    orphaned: false,
    createdAt: '2026-08-28T19:45:00Z',
  },
];

/** Anchored at the Space, not a Lesson — a whole-Space cheat sheet. */
export const spaceContributions: Contribution[] = [
  {
    id: 'c-5',
    title: 'Exam cheat sheet — everything on one page',
    excerpt:
      'One side of A4: the algebra operators with examples, the normal forms as a decision tree, ACID, and the six index structures with when each wins.',
    type: 'pdf',
    anchor: { level: 'space', spaceId: 's-dbs' },
    origin: 'community',
    author: okonkwo,
    grounding: 'grounded',
    likeCount: 212,
    likedByViewer: true,
    endorsed: true,
    hidden: false,
    orphaned: false,
    createdAt: '2026-07-30T12:00:00Z',
  },
  {
    id: 'c-6',
    /*
     * Its anchor was deleted. Surfaced to the Owner *and* the author — nobody's
     * work vanishes silently (Contributions, Rule 1).
     *
     * Authored by the **viewer** on purpose. It used to belong to `weber`,
     * which meant the author half of that rule had no fixture: every orphan
     * path is author-filtered, so the warning border, the "Your work is safe"
     * copy and the "Needs a new home" pill were three render paths that had
     * never once executed, and the guard meant to protect them was iterating
     * an empty array.
     */
    title: 'Worked example: the old Lesson 11 join exercise',
    excerpt:
      'Nested loop vs hash join on the same two relations, with the row counts written out at each step.',
    type: 'text',
    anchor: { level: 'lesson', lessonId: 'l-s-dbs-deleted' },
    origin: 'community',
    author: viewer,
    grounding: 'not-grounded',
    likeCount: 6,
    likedByViewer: false,
    endorsed: false,
    hidden: false,
    orphaned: true,
    createdAt: '2026-06-02T09:00:00Z',
  },
  {
    id: 'c-7',
    // Hidden by the Owner. Visible to its author and Owner/Editors only.
    title: 'Link dump',
    excerpt:
      'Assorted links, unsorted.',
    type: 'link',
    anchor: { level: 'space', spaceId: 's-dbs' },
    origin: 'community',
    author: ferreira,
    grounding: 'not-grounded',
    likeCount: 0,
    likedByViewer: false,
    endorsed: false,
    hidden: true,
    orphaned: false,
    createdAt: '2026-08-01T11:00:00Z',
  },
];

const byLesson: Record<string, Contribution[]> = {
  'l-s-dbs-4': normalizationContributions,
};

/** Sorted by likes — the community section, never the path. */
export const contributionsForLesson = (lessonId: string): Contribution[] =>
  [...(byLesson[lessonId] ?? [])].sort((a, b) => b.likeCount - a.likeCount);

export const contributionsForSpace = (spaceId: string): Contribution[] =>
  spaceContributions
    .filter((c) => c.anchor.level === 'space' && c.anchor.spaceId === spaceId)
    .sort((a, b) => b.likeCount - a.likeCount);

/**
 * Members of Database Systems.
 *
 * `progress: 0` on Chidi is load-bearing: likes from members with zero
 * progress in a Space still count and still sort, but grant no XP
 * (Engagement, Rule 3). Farming XP needs real learners, not real emails.
 */
export const dbsMembers: Membership[] = [
  { person: keller, role: 'owner', progress: 100, joinedAt: '2026-02-01T09:00:00Z' },
  { person: lindqvist, role: 'editor', progress: 76, joinedAt: '2026-02-03T09:00:00Z' },
  { person: viewer, role: 'member', progress: 14, joinedAt: '2026-08-12T17:20:00Z' },
  { person: ferreira, role: 'member', progress: 41, joinedAt: '2026-04-18T13:00:00Z' },
  { person: okonkwo, role: 'member', progress: 0, joinedAt: '2026-08-29T21:00:00Z' },
];

export const membersForSpace = (spaceId: string): Membership[] =>
  spaceId === 's-dbs' ? dbsMembers : [];
