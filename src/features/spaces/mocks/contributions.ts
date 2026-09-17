import type { Contribution, Membership } from '../types';
import { viewer, keller, weber, ferreira, okonkwo, lindqvist } from './people';
import { anchorFor, homeSpaceOf, isOrphaned } from './reanchor-store';

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
    /*
     * A space-anchored contribution by the **viewer**, and the reason it is
     * here is the same reason `c-6` was reassigned to the viewer above.
     *
     * Every Library and impact path is author-filtered, so with all four
     * space-level fixtures belonging to other people, the `level: 'space'`
     * branch of `resolveContributionAnchor` was never once reached from
     * Library. That branch returned a bare `/v4/space/<id>` — the exact link
     * LibraryScreen's header forbids — and no test could see it, because no
     * row ever reached it. A guard written against it would have passed by
     * iterating nothing, which is how the previous three vacuous guards in
     * this feature passed.
     *
     * It also exercises the case honestly: work posted to the whole Space,
     * belonging to no Lesson, which is why it needs a fragment to be
     * addressable at all.
     */
    id: 'c-9',
    title: 'How I actually revised for this — a four-week plan',
    excerpt:
      'What to read in which order, which practice sets are worth the time, and the two weeks where the normal forms finally have to click.',
    type: 'text',
    anchor: { level: 'space', spaceId: 's-dbs' },
    origin: 'community',
    author: viewer,
    grounding: 'not-grounded',
    likeCount: 4,
    likedByViewer: false,
    endorsed: false,
    hidden: false,
    orphaned: false,
    createdAt: '2026-08-09T09:00:00Z',
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
    anchor: { level: 'lesson', lessonId: 'l-s-dbs-deleted', spaceId: 's-dbs' },
    origin: 'community',
    author: viewer,
    grounding: 'not-grounded',
    likeCount: 6,
    likedByViewer: false,
    endorsed: false,
    hidden: false,
    orphaned: true,
    createdAt: '2026-08-06T09:00:00Z',
  },
  {
    /*
     * No excerpt. `excerpt` is optional and all eleven fixtures carried one,
     * so `{c.excerpt && ...}` had never been false — the title-only card is a
     * layout that would otherwise have first appeared against real data, where
     * a link with nothing written about it is the commonest kind there is.
     */
    id: 'c-8',
    title: 'Recordings of all twelve sessions, mirrored',
    type: 'link',
    anchor: { level: 'space', spaceId: 's-dbs' },
    origin: 'community',
    author: keller,
    grounding: null,
    likeCount: 41,
    likedByViewer: false,
    endorsed: false,
    hidden: false,
    orphaned: false,
    createdAt: '2026-08-05T10:00:00Z',
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

/**
 * Community work in a Space the viewer **owns**.
 *
 * Every other contribution is anchored in Database Systems, where the viewer is
 * a Member — so once endorse, hide and promote were built, none of them could
 * be reached in the UI at all. Three documented Owner powers, wired, guarded,
 * and with no Space to perform them in.
 *
 * Intro to Linear Algebra is the viewer's Open Space. Inês is a Member there,
 * so her work is Community and the Owner's acts apply to it. Åsa is an Editor,
 * which is what makes the two promotion outcomes visible side by side:
 * promoting Inês's gives a Community Lesson, promoting Åsa's gives an Official
 * one.
 */
export const linalgContributions: Contribution[] = [
  {
    /*
     * The Owner's half of the orphan rule, which had no fixture.
     *
     * Doc 1 surfaces an orphan to the Owner *and* the author, and the only
     * orphan in the fixtures was written by the viewer — so every Owner-facing
     * orphan path (the non-author wording, and the Owner's right to re-file
     * somebody else's work) was unreachable and could only be tested against
     * hand-built objects. The same gap the viewer-authored orphan below in
     * `spaceContributions` was added to close, one role over.
     *
     * Linear Algebra because the viewer is its Owner; authored by Ferreira so
     * the author branch cannot be what authorises it.
     */
    id: 'c-la-orphan',
    title: 'Change-of-basis worksheet from the old Lesson 4',
    excerpt:
      'Six matrices, each written in two bases, with the transition matrix worked out both ways round so you can see which one you actually need.',
    type: 'pdf',
    anchor: { level: 'lesson', lessonId: 'l-s-linalg-removed', spaceId: 's-linalg' },
    origin: 'community',
    author: ferreira,
    grounding: null,
    likeCount: 11,
    likedByViewer: false,
    endorsed: false,
    hidden: false,
    orphaned: true,
    createdAt: '2026-07-30T11:00:00Z',
  },
  {
    id: 'c-la-1',
    title: 'The determinant as signed area — one diagram that fixed it for me',
    excerpt:
      'Draw the unit square, apply the matrix, and the area of what comes out *is* the determinant. Negative means the square got flipped over. Everything about singular matrices follows: zero area means you cannot get back.',
    type: 'image',
    anchor: { level: 'space', spaceId: 's-linalg' },
    origin: 'community',
    author: ferreira,
    grounding: null,
    likeCount: 34,
    likedByViewer: false,
    endorsed: false,
    hidden: false,
    orphaned: false,
    createdAt: '2026-08-21T10:00:00Z',
  },
  {
    id: 'c-la-2',
    title: 'Practice: eigenvalues of 2×2 matrices, twelve worked examples',
    excerpt:
      'Characteristic polynomial each time, including the two cases people trip on — repeated roots, and a rotation matrix with no real eigenvalues at all.',
    type: 'practice-set',
    anchor: { level: 'lesson', lessonId: 'l-s-linalg-2' },
    origin: 'community',
    author: ferreira,
    grounding: null,
    likeCount: 19,
    likedByViewer: true,
    endorsed: false,
    hidden: false,
    orphaned: false,
    createdAt: '2026-08-24T14:30:00Z',
  },
  {
    // By an Editor, so promoting this one produces an *Official* Lesson.
    id: 'c-la-3',
    title: 'Change of basis, done slowly',
    excerpt:
      'The part that confuses everyone is which way round the matrix goes. Write down what each column means before you invert anything and it stops being a coin flip.',
    type: 'text',
    anchor: { level: 'lesson', lessonId: 'l-s-linalg-2' },
    origin: 'community',
    author: lindqvist,
    grounding: null,
    likeCount: 51,
    likedByViewer: false,
    endorsed: true,
    hidden: false,
    orphaned: false,
    createdAt: '2026-08-18T09:00:00Z',
  },
];

/**
 * Every contribution, in one place, so a Lesson can be asked what is on it.
 *
 * This replaced a hand-written `byLesson` index (`'l-s-dbs-4'` →
 * `normalizationContributions`, and so on). Two problems with that: it had to
 * be kept in step with the anchors by hand, and it could not see a re-anchored
 * orphan at all — so a contribution moved to a Lesson never appeared *on* that
 * Lesson, which is the one thing the move promises.
 *
 * Behaviour-preserving on the fixtures: every `normalizationContribution` is
 * anchored to `l-s-dbs-4` and both lesson-anchored `linalgContributions` to
 * `l-s-linalg-2`, which is exactly what the index said.
 */
const everyContribution = (): Contribution[] => [
  ...normalizationContributions,
  ...spaceContributions,
  ...linalgContributions,
  ...addedThisSession,
];

/** Published this session. Kept apart from the fixtures, as elsewhere. */
const addedThisSession: Contribution[] = [];

export const resetAddedContributions = (): void => {
  addedThisSession.length = 0;
};

/**
 * Publish a contribution.
 *
 * Always Community origin — Official content is a Lesson, not a contribution
 * (Doc 1), so origin is not a parameter. It starts un-endorsed and un-hidden:
 * endorsing and hiding are Owner acts, and neither is something you can do to
 * your own work on the way in.
 *
 * `grounding` follows the Space, mirroring how the fixtures do it: grounding
 * is a property of the Space's material, not of who wrote the contribution.
 */
export const addContribution = (input: {
  title: string;
  excerpt: string;
  type: Contribution['type'];
  anchor: Contribution['anchor'];
  author: Contribution['author'];
  grounding: Contribution['grounding'];
}): Contribution => {
  const created: Contribution = {
    id: `c-new-${addedThisSession.length + 1}`,
    title: input.title.trim(),
    excerpt: input.excerpt.trim(),
    type: input.type,
    anchor: input.anchor,
    origin: 'community',
    author: input.author,
    grounding: input.grounding,
    likeCount: 0,
    likedByViewer: false,
    endorsed: false,
    hidden: false,
    orphaned: false,
    createdAt: new Date().toISOString(),
  };
  addedThisSession.push(created);
  return created;
};

/** Sorted by likes — the community section, never the path. */
export const contributionsForLesson = (lessonId: string): Contribution[] =>
  everyContribution()
    .filter((c) => {
      // The *effective* anchor: a re-anchored orphan belongs to its new Lesson.
      const at = anchorFor(c);
      return at.level === 'lesson' && at.lessonId === lessonId;
    })
    .sort((a, b) => b.likeCount - a.likeCount);

/**
 * Work in this Space whose Lesson was deleted.
 *
 * Doc 1, Contributions rule 1 surfaces an orphan to the Owner *and* the
 * author. The author half was Library; the Owner half did not exist — and not
 * because a button was missing, but because an orphan appears in **no** Space
 * list at all. Its anchor points at a Lesson that is gone, so
 * `contributionsForLesson` cannot find it and `contributionsForSpace` only
 * matches space-level anchors. The Owner could not have seen one if they had
 * looked.
 */
export const orphansForSpace = (spaceId: string): Contribution[] =>
  everyContribution()
    .filter((c) => isOrphaned(c) && homeSpaceOf(c) === spaceId)
    .sort((a, b) => b.likeCount - a.likeCount);

/**
 * The DOM id a contribution card carries, and the fragment that targets it.
 *
 * Lives here rather than in `ContributionCard` so that `mocks/library.ts` can
 * build the href without a mock importing a component — that direction is a
 * cycle, since the card already reads its like and moderation state from here.
 *
 * One definition, three users: this builds the id, the card renders it, and
 * `SpaceScreen` scrolls to it. A link to a fragment nothing renders is a link
 * to the top of the page, silently.
 */
export const contributionAnchorId = (id: string) => `contribution-${id}`;

export const contributionsForSpace = (spaceId: string): Contribution[] =>
  [...spaceContributions, ...linalgContributions, ...addedThisSession]
    .filter((c) => {
      const at = anchorFor(c);
      return at.level === 'space' && at.spaceId === spaceId;
    })
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

/**
 * Members of the other Spaces.
 *
 * Only Database Systems had any, and the Members tab has no empty branch — so
 * `/v4/space/s-ml/members` printed "1,204 Members", an empty list, and then
 * "Showing 0 of 1,204". Six of the seven Spaces rendered that.
 *
 * These are samples, not complete lists: a Space with 1,204 members does not
 * ship 1,204 rows, and the "Showing N of M" line exists precisely because the
 * list is a sample. Every Space has an Owner, because a Space without one is
 * not a state the model allows.
 */
const cryptoMembers: Membership[] = [
  { person: weber, role: 'owner', progress: 100, joinedAt: '2026-01-15T09:00:00Z' },
  { person: keller, role: 'editor', progress: 62, joinedAt: '2026-02-20T09:00:00Z' },
  { person: viewer, role: 'member', progress: 1, joinedAt: '2026-08-20T14:00:00Z' },
  { person: lindqvist, role: 'member', progress: 88, joinedAt: '2026-03-02T09:00:00Z' },
];

/** The viewer's own Open Space. Asa is an Editor, which is why she can publish. */
const linalgMembers: Membership[] = [
  { person: viewer, role: 'owner', progress: 50, joinedAt: '2026-05-01T09:00:00Z' },
  { person: lindqvist, role: 'editor', progress: 71, joinedAt: '2026-05-04T09:00:00Z' },
  { person: ferreira, role: 'member', progress: 12, joinedAt: '2026-07-19T09:00:00Z' },
];

/**
 * A Space of one. The viewer created it and nobody has joined — the ordinary
 * state of a new Space, and one the Members tab had never rendered.
 */
const numericsMembers: Membership[] = [
  { person: viewer, role: 'owner', progress: 0, joinedAt: '2026-08-29T09:00:00Z' },
];

const statsMembers: Membership[] = [
  { person: ferreira, role: 'owner', progress: 100, joinedAt: '2026-01-08T09:00:00Z' },
  { person: viewer, role: 'member', progress: 75, joinedAt: '2026-06-11T09:00:00Z' },
  { person: okonkwo, role: 'member', progress: 34, joinedAt: '2026-04-22T09:00:00Z' },
];

const discreteMembers: Membership[] = [
  { person: keller, role: 'owner', progress: 100, joinedAt: '2026-01-20T09:00:00Z' },
  { person: viewer, role: 'member', progress: 100, joinedAt: '2026-02-14T09:00:00Z' },
  { person: weber, role: 'member', progress: 55, joinedAt: '2026-03-30T09:00:00Z' },
];

const byMembers: Record<string, Membership[]> = {
  's-discrete': discreteMembers,
  's-dbs': dbsMembers,
  's-crypto': cryptoMembers,
  's-linalg': linalgMembers,
  's-numerics': numericsMembers,
  's-stats': statsMembers,
};

/**
 * Who is in a Space.
 *
 * Empty for Spaces the viewer has not joined: a Discover Space shows what is
 * *inside* it — its Lessons — so you are not joining blind, but its member
 * list is not public. That is a real empty state, not missing data, and the
 * screen now says which one it is.
 */
export const membersForSpace = (spaceId: string): Membership[] => byMembers[spaceId] ?? [];

/** Whether a person is in a Space, by the member list rather than by guess. */
export const isMemberOf = (spaceId: string, personId: string): boolean =>
  membersForSpace(spaceId).some((m) => m.person.id === personId);

/**
 * Space ids two people are both in.
 *
 * `PersonScreen` computed this as "Spaces I am in that I do not own" and never
 * looked at the other person at all — so every profile listed the same four
 * Spaces under the heading "Spaces you are both in", including Chidi's, whose
 * one shared Space was not among them. The `[]` dependency array was the tell:
 * a memo with no reactive input, on a screen whose whole subject is a route
 * parameter.
 */
export const sharedSpaceIds = (a: string, b: string): string[] =>
  Object.keys(byMembers).filter((id) => isMemberOf(id, a) && isMemberOf(id, b));
