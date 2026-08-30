import type { LessonState, LibraryItem, Note } from '../types';
import { normalizationContributions, spaceContributions } from './contributions';
import type { Person } from '../types';
import { viewer, keller, weber, ferreira, okonkwo, lindqvist } from './people';
import { allSpaces } from './spaces';
import { lessonsForSpace } from './lessons';

/**
 * Library fixtures — what the viewer made, across every Space.
 *
 * Derived from the existing fixtures rather than invented separately, so
 * Library can never disagree with the Space screens about the same object.
 * That disagreement is exactly the class of bug the fixture guards exist for.
 *
 * Library holds no Spaces. Every item below is a Note, a Material or a
 * Contribution — and every one of them is authored by `viewer`.
 */

/** Private, anchored in a Lesson. Nobody else ever sees these. */
export const notes: Note[] = [
  {
    id: 'n-1',
    body:
      'BCNF is stricter than 3NF: every determinant has to be a candidate key. The worked example with two overlapping keys is the one that actually shows the difference.',
    lessonId: 'l-s-dbs-4',
    lessonTitle: 'Normalization',
    spaceId: 's-dbs',
    spaceName: 'Database Systems',
    updatedAt: '2026-08-28T20:15:00Z',
  },
  {
    id: 'n-2',
    body:
      'Ask about isolation levels — still not clear when READ COMMITTED is actually enough in practice.',
    lessonId: 'l-s-dbs-8',
    lessonTitle: 'Transactions',
    spaceId: 's-dbs',
    spaceName: 'Database Systems',
    updatedAt: '2026-08-26T11:40:00Z',
  },
  {
    id: 'n-3',
    body:
      'Eigenvector intuition that finally stuck: the directions the transformation does not rotate, only stretches.',
    lessonId: 'l-s-linalg-2',
    lessonTitle: 'Eigenvalues, intuitively',
    spaceId: 's-linalg',
    spaceName: 'Intro to Linear Algebra',
    updatedAt: '2026-08-30T09:05:00Z',
  },
];

/** Every Space the viewer belongs to, indexed for context lines. */
const spaceName = (id: string) => allSpaces.find((s) => s.id === id)?.name ?? 'Unknown Space';

/**
 * Materials the viewer uploaded. These are files, not Lessons — a Lesson is
 * generated from one, and deleting the Material never breaks the Lesson.
 */
const uploadedMaterials: LibraryItem[] = lessonsForSpace('s-linalg')
  .filter((l) => l.material !== null && l.author.id === viewer.id)
  .map((l) => ({
    id: `lib-mat-${l.id}`,
    kind: 'material' as const,
    title: l.material!.filename,
    spaceId: l.spaceId,
    spaceName: spaceName(l.spaceId),
    lessonTitle: l.title,
    updatedAt: l.material!.uploadedAt,
    sizeBytes: l.material!.sizeBytes,
    // Drafts and processing Lessons are the author's own business — this is
    // the one surface where they are legitimately visible outside the Space.
    pending: l.state === 'draft' || l.state === 'processing',
  }));

/** Contributions the viewer published, wherever they landed. */
const myContributions: LibraryItem[] = [...spaceContributions, ...normalizationContributions]
  .filter((c) => c.author.id === viewer.id)
  .map((c) => ({
    id: `lib-con-${c.id}`,
    kind: 'contribution' as const,
    title: c.title,
    spaceId: c.anchor.level === 'space' ? c.anchor.spaceId : 's-dbs',
    spaceName: spaceName(c.anchor.level === 'space' ? c.anchor.spaceId : 's-dbs'),
    lessonTitle: c.anchor.level === 'lesson' ? 'Normalization' : undefined,
    updatedAt: c.createdAt,
    likeCount: c.likeCount,
    endorsed: c.endorsed,
    orphaned: c.orphaned,
  }));

const myNotes: LibraryItem[] = notes.map((n) => ({
  id: `lib-note-${n.id}`,
  kind: 'note' as const,
  title: n.body.split(/[.:]/)[0].trim(),
  spaceId: n.spaceId,
  spaceName: n.spaceName,
  lessonTitle: n.lessonTitle,
  updatedAt: n.updatedAt,
}));

/** Everything you made, newest first. */
export const libraryItems: LibraryItem[] = [
  ...myNotes,
  ...uploadedMaterials,
  ...myContributions,
].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));

export const itemsOfKind = (kind: LibraryItem['kind']) =>
  libraryItems.filter((i) => i.kind === kind);

/** Studio: uploads still processing or sitting as drafts, across every Space. */
export const pendingUploads = () => libraryItems.filter((i) => i.pending);

/* ── Home ─────────────────────────────────────────────────────────
   Doc 2: "Home is your next action, assembled across every Space." It ranks
   across all Spaces and answers "the one thing"; the Spaces list shows
   per-Space progress. Same information at two altitudes, not a duplicate.

   Critically: Home links to **Lessons and practice, never to a Space card**.
   A Home item names its Space as context and opens the Lesson. */

export interface HomeItem {
  lessonId: string;
  lessonTitle: string;
  lessonOrder: number;
  spaceId: string;
  spaceName: string;
  percentComplete: number;
  /** Why this is being surfaced. Drives the section it appears under. */
  reason: 'continue' | 'next' | 'review' | 'new';
}

const homeItem = (spaceId: string, order: number, reason: HomeItem['reason']): HomeItem => {
  const l = lessonsForSpace(spaceId).find((x) => x.order === order)!;
  return {
    lessonId: l.id,
    lessonTitle: l.title,
    lessonOrder: l.order,
    spaceId,
    spaceName: spaceName(spaceId),
    percentComplete: l.percentComplete,
    reason,
  };
};

/** The single next action, ranked across every Space. Exactly one. */
export const nextAction: HomeItem = homeItem('s-dbs', 2, 'continue');

/** Everything else Home surfaces, all Lesson-level. */
export const homeFeed: HomeItem[] = [
  homeItem('s-dbs', 1, 'review'),
  homeItem('s-crypto', 1, 'continue'),
  homeItem('s-dbs', 3, 'new'),
  homeItem('s-linalg', 2, 'new'),
];

/* ── Social & Profile ─────────────────────────────────────────────
   Doc 2: Social is *people* — friends, requests, finding people, their public
   profiles, and rankings. It shows no Space cards and no Lessons; where a
   person's work is mentioned, the link goes to that work in its Space.

   Rankings read XP only. Doc 1 locks this: ranks and progression read from XP;
   likes and stars are content signals with no second progression bolted on. */

export interface RankedPerson {
  person: Person;
  xp: number;
  rank: string;
  /** Spaces in common — the reason they are surfaced, not a Space card. */
  sharedSpaces: number;
  isViewer?: boolean;
}

export const leaderboard: RankedPerson[] = [
  { person: keller, xp: 12480, rank: 'Rank 9', sharedSpaces: 1 },
  { person: lindqvist, xp: 8210, rank: 'Rank 7', sharedSpaces: 2 },
  { person: okonkwo, xp: 5140, rank: 'Rank 6', sharedSpaces: 1 },
  { person: ferreira, xp: 3020, rank: 'Rank 5', sharedSpaces: 2 },
  { person: weber, xp: 900, rank: 'Rank 3', sharedSpaces: 1 },
  { person: viewer, xp: 60, rank: 'Rank 1', sharedSpaces: 4, isViewer: true },
];

export interface FriendRequest {
  person: Person;
  sharedSpaces: number;
}

export const friendRequests: FriendRequest[] = [
  { person: okonkwo, sharedSpaces: 1 },
];

export const friends = [lindqvist, ferreira];

/** Badges are earned, and each says what earned it. */
export interface Badge {
  id: string;
  name: string;
  earned: boolean;
  how: string;
}

export const badges: Badge[] = [
  { id: 'b-1', name: 'First steps', earned: true, how: 'Finished your first Lesson' },
  { id: 'b-2', name: 'Contributor', earned: true, how: 'Published your first contribution' },
  { id: 'b-3', name: 'Four in a row', earned: true, how: 'Four days running' },
  { id: 'b-4', name: 'Well received', earned: false, how: 'Get 25 likes on your work' },
  { id: 'b-5', name: 'Cartographer', earned: false, how: 'Clear every idea in one Space' },
  { id: 'b-6', name: 'Founder', earned: true, how: 'Created a Space of your own' },
];

/* ── Library · Studio ─────────────────────────────────────────────
   Doc 2: "Studio screens hang off Library; Library itself stays Learn. Dense
   work opens *from* it as its own screen: manage uploads, review your drafts
   across every Space, see how your contributions landed."

   All three are author-filtered, exactly like Library. The difference is mode,
   not scope: Library is calm and browsable, these are dense and operational. */

export interface DraftRow {
  lessonId: string;
  title: string;
  spaceId: string;
  spaceName: string;
  /** 'draft' or 'processing' — both are unpublished and yours alone to see. */
  state: LessonState;
  order: number;
  updatedAt: string;
}

/**
 * Every unpublished Lesson you authored, across every Space.
 *
 * This is the one surface where drafts from different Spaces sit together.
 * Rule 1 still holds — nobody else can see these; they are visible here
 * *because* the viewer is their author.
 */
export const draftsAcrossSpaces = (): DraftRow[] =>
  allSpaces
    .flatMap((s) =>
      lessonsForSpace(s.id)
        .filter((l) => l.state !== 'published' && l.author.id === viewer.id)
        .map((l) => ({
          lessonId: l.id,
          title: l.title,
          spaceId: s.id,
          spaceName: s.name,
          state: l.state,
          order: l.order,
          updatedAt: s.lastActiveAt,
        })),
    )
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));

export interface ImpactRow {
  id: string;
  title: string;
  spaceId: string;
  spaceName: string;
  lessonTitle?: string;
  likeCount: number;
  endorsed: boolean;
  orphaned: boolean;
  createdAt: string;
}

/**
 * How your work landed. Doc 1 promises authors "see which of their work
 * landed"; this is where that promise is kept.
 *
 * Likes are reported as a fact about each contribution, never summed into a
 * score — Doc 1 rule 7 forbids a second progression beside XP.
 */
export const impactRows = (): ImpactRow[] =>
  [...spaceContributions, ...normalizationContributions]
    .filter((c) => c.author.id === viewer.id)
    .map((c) => ({
      id: c.id,
      title: c.title,
      spaceId: c.anchor.level === 'space' ? c.anchor.spaceId : 's-dbs',
      spaceName: spaceName(c.anchor.level === 'space' ? c.anchor.spaceId : 's-dbs'),
      lessonTitle: c.anchor.level === 'lesson' ? 'Normalization' : undefined,
      likeCount: c.likeCount,
      endorsed: c.endorsed,
      orphaned: c.orphaned,
      createdAt: c.createdAt,
    }))
    .sort((a, b) => b.likeCount - a.likeCount);

/** Everything you uploaded, across every Space. */
export const uploadRows = () => libraryItems.filter((i) => i.kind === 'material');

/**
 * Which hero Home shows.
 *
 * Ported from the old dashboard's `homeFeed`, which already models
 * onboard / resume / next / review. The shape is proven — what changes is the
 * vocabulary and the rule that every target is a Lesson.
 *
 *   onboard — nothing to continue. A brand-new account, and the one place Home
 *             may point at Spaces, because there is no Lesson to point at yet.
 *   review  — everything done. Celebrate before the rails, don't show an empty
 *             "up next" that implies you missed something.
 *   resume  — the ordinary case.
 */
export type HeroKind = 'onboard' | 'resume' | 'review';

export const heroKind = ({
  hasProgress,
  allDone,
}: {
  hasProgress: boolean;
  allDone: boolean;
}): HeroKind => {
  if (!hasProgress) return 'onboard';
  if (allDone) return 'review';
  return 'resume';
};

export interface RecentItem extends HomeItem {
  viewedAt: string;
}

/**
 * Recently viewed, most recent first.
 *
 * Excludes whatever the next action already offers — the old dashboard dedupes
 * for the same reason: the same Lesson twice on one screen reads as a bug
 * rather than as emphasis.
 */
export const recentlyViewed = (): RecentItem[] =>
  [
    { ...homeItem('s-dbs', 1, 'continue'), viewedAt: '2026-08-30T21:40:00Z' },
    { ...homeItem('s-linalg', 1, 'continue'), viewedAt: '2026-08-30T18:05:00Z' },
    { ...homeItem('s-crypto', 1, 'continue'), viewedAt: '2026-08-29T20:12:00Z' },
    { ...homeItem('s-dbs', 6, 'continue'), viewedAt: '2026-08-29T09:30:00Z' },
  ]
    .filter((r) => r.lessonId !== nextAction.lessonId)
    .sort((a, b) => +new Date(b.viewedAt) - +new Date(a.viewedAt));
