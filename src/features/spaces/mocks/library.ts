import type { Contribution, ContributionAnchor, LessonState, LibraryItem, Note } from '../types';
import {
  linalgContributions,
  normalizationContributions,
  sharedSpaceIds,
  spaceContributions,
} from './contributions';
import { contributionAnchorId } from './contributions';
import { conceptById, conceptContributions } from './concepts';
import type { Person } from '../types';
import { viewer, keller, weber, ferreira, okonkwo, lindqvist } from './people';
import { allSpaces } from './spaces';
import { rankLabel, viewerXp } from './rank';
import { lessonsForSpace, locateLesson } from './lessons';
import { anchorFor, isOrphaned } from './reanchor';

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
    authorId: viewer.id,
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
    authorId: viewer.id,
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
    authorId: viewer.id,
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
    // A Material opens the Lesson built from it — the file itself is not a
    // screen, and Library never re-renders Space content.
    href: `/v4/space/${l.spaceId}/lesson/${l.id}`,
    spaceId: l.spaceId,
    spaceName: spaceName(l.spaceId),
    lessonTitle: l.title,
    updatedAt: l.material!.uploadedAt,
    sizeBytes: l.material!.sizeBytes,
    // Drafts and processing Lessons are the author's own business — this is
    // the one surface where they are legitimately visible outside the Space.
    pending: l.state === 'draft' || l.state === 'processing',
  }));

/**
 * Where a contribution actually lives — resolved, not assumed.
 *
 * All three anchor levels, because Doc 1 defines three. The previous version
 * handled `space`, hardcoded `'Normalization'` / `'s-dbs'` for `lesson`, and
 * silently dropped `concept` entirely — so a Concept-anchored contribution by
 * the viewer existed in the fixtures, was findable in ⌘K, and Library denied
 * it existed.
 *
 * An orphan has no anchor left to resolve; that is what makes it an orphan.
 */
export const resolveContributionAnchor = (
  anchor: ContributionAnchor,
  /**
   * The contribution being resolved, where the caller has one.
   *
   * Optional so an anchor can be resolved on its own — `orphans.test.ts`
   * constructs bare anchors to check that a dead Lesson still knows its Space,
   * and there is no contribution in that question.
   *
   * Space-level anchors need it: they are addressed by fragment, having no
   * page of their own. Without it there is no href at all — deliberately not a
   * fall back to `/v4/space/<id>`, so a Space root cannot be reached from
   * Library by any path, including a caller that forgot the id.
   */
  contributionId?: string,
): { spaceId: string | null; lessonTitle?: string; href: string | null } => {
  if (anchor.level === 'space') {
    /*
     * Space-anchored work lives on the Space overview, in the community
     * section — there is no Lesson page and no Concept page to send you to.
     * That is why this used to return the Space root, and why doing so broke
     * LibraryScreen's stated rule: "a Space is never an entry point from here."
     *
     * The fragment is what resolves the conflict. `/v4/space/x#contribution-y`
     * opens *the contribution*, which happens to be rendered on the Space
     * overview, rather than opening the Space and leaving you to find it.
     * `SpaceScreen` scrolls to it on arrival.
     */
    return {
      spaceId: anchor.spaceId,
      href: contributionId
        ? `/v4/space/${anchor.spaceId}#${contributionAnchorId(contributionId)}`
        : null,
    };
  }
  if (anchor.level === 'lesson') {
    const found = locateLesson(anchor.lessonId);
    return found
      ? {
          spaceId: found.spaceId,
          lessonTitle: found.lesson.title,
          href: `/v4/space/${found.spaceId}/lesson/${found.lesson.id}`,
        }
      : // The Lesson is gone; the anchor still knows which Space it was in.
        { spaceId: anchor.spaceId ?? null, href: null };
  }
  const concept = conceptById(anchor.conceptId);
  return concept
    ? {
        spaceId: concept.spaceId,
        lessonTitle: concept.name,
        href: `/v4/space/${concept.spaceId}/concept/${concept.id}`,
      }
    : { spaceId: null, href: null };
};

/** Everything the viewer published, at any of the three anchor levels. */
const myPublished = (): Contribution[] =>
  [
    ...spaceContributions,
    ...normalizationContributions,
    ...linalgContributions,
    ...conceptContributions,
  ].filter((c) => c.author.id === viewer.id);

/** One of yours, by id — Library rows carry `lib-con-<id>`. */
export const myContributionById = (id: string): Contribution | undefined =>
  myPublished().find((c) => c.id === id);

/**
 * Contributions the viewer published, wherever they landed.
 *
 * A function, not a `const`. It was composed once at module load, so
 * re-anchoring an orphan changed the store and Library went on showing the old
 * row — the exact bug `noteToItem`'s comment records for notes. Anything
 * downstream of a mutable store has to be recomputed on read.
 */
const myContributionItems = (): LibraryItem[] =>
  myPublished().map((c) => {
  // Resolve through the override, so a re-anchored orphan lands on its Lesson.
  const at = resolveContributionAnchor(anchorFor(c), c.id);
  return {
    id: `lib-con-${c.id}`,
    kind: 'contribution' as const,
    title: c.title,
    /*
     * A contribution opens where it is anchored. An orphan has no anchor left,
     * so it opens nowhere — `null`, and the row renders no link at all. Once
     * it is re-anchored the override gives it a real Lesson to open.
     *
     * Not a fallback to `/v4/space/<id>`: that makes a Space an entry point
     * from Library, which this screen's own header forbids, and it lands you
     * on an overview the contribution is not on. `library.test.ts` guards it.
     */
    href: at.href,
    spaceId: at.spaceId,
    spaceName: at.spaceId ? spaceName(at.spaceId) : null,
    lessonTitle: at.lessonTitle,
    updatedAt: c.createdAt,
    likeCount: c.likeCount,
    endorsed: c.endorsed,
    // Derived: a row must stop warning the moment it has somewhere to live.
    orphaned: isOrphaned(c),
  };
});

/**
 * A Note as a Library row.
 *
 * Exported as a mapper rather than applied to the seed here, because the
 * writable note store lives in `notes.ts` — which imports this file for its
 * seed, so importing it back would be a cycle. `useLibrary` owns the join.
 *
 * This matters: the list used to be built from the seed array once, at module
 * load. Notes were writable and Library could never show a new one.
 */
export const noteToItem = (n: Note): LibraryItem => ({
  id: `lib-note-${n.id}`,
  kind: 'note' as const,
  /* A label for the list. Never what gets saved — see `LibraryItem`. */
  title: n.body.split(/[.:]/)[0].trim(),
  /* The note itself. Library is where notes are read *and* written. */
  body: n.body,
  // Notes are the exception: read and written in Library itself, never
  // opened in their Space (Doc 2 rule 5).
  href: null,
  spaceId: n.spaceId,
  spaceName: n.spaceName,
  lessonTitle: n.lessonTitle,
  updatedAt: n.updatedAt,
});

/** Everything you made that is not a Note, newest first. */
export const nonNoteItems = (): LibraryItem[] =>
  [...uploadedMaterials, ...myContributionItems()].sort(
    (a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt),
  );

/** Everything you made, newest first, given the current notes. */
export const libraryItemsWith = (currentNotes: Note[]): LibraryItem[] =>
  [...currentNotes.map(noteToItem), ...nonNoteItems()].sort(
    (a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt),
  );

/** The seeded view, for fixtures and guards that do not run the note store. */
export const libraryItems = (): LibraryItem[] => libraryItemsWith(notes);

export const itemsOfKind = (kind: LibraryItem['kind']) =>
  libraryItems().filter((i) => i.kind === kind);

/** Studio: uploads still processing or sitting as drafts, across every Space. */
export const pendingUploads = () => libraryItems().filter((i) => i.pending);

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
  // `next` — the Lesson after the one you are on. HomeScreen has a label and
  // an icon for it and nothing produced one, so that row had never rendered.
  homeItem('s-dbs', 3, 'next'),
  homeItem('s-dbs', 5, 'new'),
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

/**
 * `sharedSpaces` is derived, not stated.
 *
 * It used to be a literal per row, and `PersonScreen` computes the same fact
 * from the member lists — so Social said Chidi shared 1 Space and his profile
 * listed 2, both looking right. The member lists are the source; a count that
 * can disagree with the list it counts is not a count.
 */
const shared = (personId: string) => sharedSpaceIds(viewer.id, personId).length;

/*
 * XP is the fixture; **rank is derived** from it by `rankLabel`.
 *
 * Each row used to carry its own `rank: 'Rank 9'` string beside its XP, and
 * the two disagreed for everyone except the viewer. At the 250-XP-per-rank
 * the profile was using, Keller's 12,480 XP is Rank 50, not Rank 9. Nothing
 * could catch it, because a hand-written label agrees with any curve.
 */
export const leaderboard: RankedPerson[] = [
  { person: keller, xp: 12480, sharedSpaces: shared(keller.id) },
  { person: lindqvist, xp: 8210, sharedSpaces: shared(lindqvist.id) },
  { person: okonkwo, xp: 5140, sharedSpaces: shared(okonkwo.id) },
  { person: ferreira, xp: 3020, sharedSpaces: shared(ferreira.id) },
  { person: weber, xp: 900, sharedSpaces: shared(weber.id) },
  {
    person: viewer,
    // From the ledger, not a literal — the Rank screen itemises this exact
    // number, and a second statement of it is a second thing to get wrong.
    xp: viewerXp(),
    // Your own row counts the Spaces you are in, not ones "shared with" you.
    sharedSpaces: allSpaces.filter((s) => s.viewerRole !== null).length,
    isViewer: true,
  },
].map((r) => ({ ...r, rank: rankLabel(r.xp) }));

/**
 * The viewer's own standing — one source for it.
 *
 * The top bar used to carry `rank = 'Rank 1', xp = 60` as prop defaults while
 * the leaderboard stated the same two numbers independently, so the bar and
 * Social could disagree about the viewer's rank and both look correct. A guard
 * asserts this row exists and is the only one flagged `isViewer`.
 */
export const viewerStanding = (): RankedPerson => {
  const mine = leaderboard.find((r) => r.isViewer);
  if (!mine) throw new Error('leaderboard has no viewer row');
  return mine;
};

export interface FriendRequest {
  person: Person;
  sharedSpaces: number;
}

export const friendRequests: FriendRequest[] = [
  // Derived, for the same reason as the leaderboard: this number and the list
  // on the person's profile were two statements of one fact.
  { person: okonkwo, sharedSpaces: shared(okonkwo.id) },
];

export const friends = [lindqvist, ferreira];

/*
 * The achievement badges lived here — six of them, `earned` flags and all.
 * Retired rather than moved: see `mocks/moments.ts` for what replaced them and
 * the three locked rules they broke. The word "badge" now means one thing in
 * this codebase, which is what `components/badges.tsx` already meant by it.
 */

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
  myPublished()
    .map((c) => {
      const at = resolveContributionAnchor(anchorFor(c), c.id);
      return {
        id: c.id,
        title: c.title,
        // Sourced from the anchor, never assumed. An orphan names no Space.
        spaceId: at.spaceId,
        spaceName: at.spaceId ? spaceName(at.spaceId) : null,
        lessonTitle: at.lessonTitle,
        likeCount: c.likeCount,
        endorsed: c.endorsed,
        orphaned: isOrphaned(c),
        createdAt: c.createdAt,
      };
    })
    .sort((a, b) => b.likeCount - a.likeCount);

/** Everything you uploaded, across every Space. */
export const uploadRows = () => libraryItems().filter((i) => i.kind === 'material');

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
