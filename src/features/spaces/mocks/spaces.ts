import type { Space, Universe } from '../types';
import { viewer, keller, weber, ferreira, okonkwo } from './people';

/**
 * Space fixtures.
 *
 * Names, Lesson counts and progress are lifted from the running app's real
 * data (Database Systems, Advanced Topics in Cryptography, Intro to Linear
 * Algebra) so the screens are judged against content that actually exists,
 * including its awkward lengths and duplicate titles.
 *
 * Invented, because they are v4 concepts with no counterpart in the current
 * schema: owners, Universes, member/star counts, modes, grounding flags.
 * They are plausible, not observed — do not treat them as real numbers.
 *
 * The set is chosen to cover states, not to look tidy:
 *   • Guided and Open              • grounding on and dormant
 *   • joined, owned, and not-joined  • active, archived, and processing
 *   • a Space with no Universe     • names that overflow, umlauts, "(Student Notes)"
 */

export const marburg: Universe = {
  id: 'u-marburg',
  name: 'Uni Marburg',
  // 0–3 ordered levels; names are configurable text, never hardcoded
  // academic words. Here a university uses Faculty → Department.
  levels: [
    { name: 'Faculty', value: 'FB 12' },
    { name: 'Department', value: 'Mathematics & Computer Science' },
  ],
};

/** ── Mine · Joined ──────────────────────────────────────────────── */

/** The flagship: a real Guided Space with grounding switched on. */
export const databaseSystems: Space = {
  id: 's-dbs',
  name: 'Database Systems',
  shortCode: 'DBS',
  description:
    'Relational design, algebra and transactions — the full first-semester path, start to finish.',
  owner: keller,
  universe: marburg,
  classification: { domain: 'Computer Science', subject: 'Databases' },
  mode: 'guided',
  visibility: 'public',
  state: 'active',
  groundingEnabled: true,
  strictMode: false,
  memberCount: 184,
  starCount: 62,
  starredByViewer: true,
  viewerRole: 'member',
  viewerProgress: 14,
  lessonCount: 10,
  lessonsDone: 0,
  newSinceLastVisit: 2,
  online: 34,
  lastActivity: 'Chidi shared a cheat sheet in Normalization',
  lastActiveAt: '2026-08-29T18:40:00Z',
};

/**
 * Grounding is OFF here — so no grounding marker may render anywhere in this
 * Space. Dormant by default (Grounding, Rule 1): "a marker on everything
 * would be a marker on nothing."
 */
export const cryptography: Space = {
  id: 's-crypto',
  name: 'Advanced Topics in Cryptography',
  shortCode: 'ATC',
  description:
    'Differential cryptanalysis through to post-quantum. Heavy on the algebra.',
  owner: weber,
  universe: marburg,
  classification: { domain: 'Computer Science', subject: 'Cryptography' },
  mode: 'guided',
  visibility: 'invite',
  state: 'active',
  groundingEnabled: false,
  strictMode: false,
  memberCount: 47,
  starCount: 11,
  starredByViewer: false,
  viewerRole: 'member',
  viewerProgress: 1,
  lessonCount: 13,
  lessonsDone: 0,
  newSinceLastVisit: 0,
  online: 11,
  lastActivity: 'Jonas promoted your write-up',
  lastActiveAt: '2026-08-27T09:15:00Z',
};

/** ── Mine · Created by you ──────────────────────────────────────── */

/**
 * Open mode, owned by the viewer, no Universe. The solo case from the
 * foundations doc: "Someone studying alone is an Owner whose Space has 1."
 * Carries Owner-only signals (draftsPending, membersActiveThisWeek) that a
 * Member must never see.
 */
export const linearAlgebra: Space = {
  id: 's-linalg',
  name: 'Intro to Linear Algebra',
  shortCode: 'LA',
  description: 'Vectors and matrices, built up from scratch. Notes as I go.',
  owner: viewer,
  universe: null,
  classification: { domain: 'Mathematics', subject: 'Linear Algebra' },
  mode: 'open',
  visibility: 'private',
  state: 'active',
  groundingEnabled: false,
  strictMode: false,
  memberCount: 3,
  starCount: 0,
  starredByViewer: false,
  viewerRole: 'owner',
  viewerProgress: 50,
  lessonCount: 5,
  lessonsDone: 1,
  newSinceLastVisit: 0,
  draftsPending: 2,
  membersActiveThisWeek: 2,
  online: 2,
  lastActivity: 'Inês added a determinant diagram',
  lastActiveAt: '2026-08-30T20:05:00Z',
};

/**
 * Just created, still ingesting. Renders as a shimmer card — never absent.
 * (notes-spaces-screen.md gap 5.)
 */
export const numericsProcessing: Space = {
  id: 's-numerics',
  name: 'Numerical Methods',
  shortCode: 'NM',
  description: null,
  owner: viewer,
  universe: null,
  classification: { domain: 'Mathematics', subject: 'Numerical Analysis' },
  mode: 'open',
  visibility: 'private',
  state: 'active',
  groundingEnabled: false,
  strictMode: false,
  memberCount: 1,
  starCount: 0,
  starredByViewer: false,
  viewerRole: 'owner',
  viewerProgress: 0,
  lessonCount: 0,
  lessonsDone: 0,
  newSinceLastVisit: 0,
  draftsPending: 6,
  membersActiveThisWeek: 1,
  online: 1,
  lastActivity: 'You have 6 drafts waiting',
  lastActiveAt: '2026-08-30T22:44:00Z',
};

/**
 * Archived: read-only, keeps progress, earns no XP. Collapsed section at the
 * bottom of Mine, never hidden — the progress lives here (gap 5).
 */
export const statistics: Space = {
  id: 's-stats',
  name: 'Statistik I',
  shortCode: 'ST1',
  description: 'Wahrscheinlichkeitsrechnung und schließende Statistik.',
  owner: ferreira,
  universe: marburg,
  classification: { domain: 'Mathematics', subject: 'Statistics' },
  mode: 'guided',
  visibility: 'public',
  state: 'archived',
  groundingEnabled: true,
  strictMode: false,
  memberCount: 312,
  starCount: 140,
  starredByViewer: true,
  viewerRole: 'member',
  viewerProgress: 100,
  lessonCount: 4,
  lessonsDone: 4,
  newSinceLastVisit: 0,
  online: 0,
  lastActivity: 'Archived in March',
  lastActiveAt: '2026-03-11T16:00:00Z',
};

/** ── Discover · not joined ──────────────────────────────────────── */

/** Open Space with no Universe — the "people learning ML together" case. */
export const machineLearning: Space = {
  id: 's-ml',
  name: 'Machine Learning, from scratch',
  shortCode: 'ML',
  description:
    'No syllabus, no set path. We read a paper a week and build the thing.',
  owner: okonkwo,
  universe: null,
  classification: { domain: 'Computer Science', subject: 'Machine Learning' },
  mode: 'open',
  visibility: 'public',
  state: 'active',
  groundingEnabled: false,
  strictMode: false,
  memberCount: 1204,
  starCount: 486,
  starredByViewer: false,
  viewerRole: null,
  viewerProgress: 0,
  lessonCount: 5,
  lessonsDone: 0,
  newSinceLastVisit: 0,
  online: 96,
  lastActiveAt: '2026-08-30T11:20:00Z',
};

/** Guided, grounding + strict mode on — the exam-relevant university case. */
export const analysis: Space = {
  id: 's-analysis',
  name: 'Analysis II',
  shortCode: 'AN2',
  description: 'Differentialrechnung mehrerer Veränderlicher.',
  owner: ferreira,
  universe: marburg,
  classification: { domain: 'Mathematics', subject: 'Analysis' },
  mode: 'guided',
  visibility: 'public',
  state: 'active',
  groundingEnabled: true,
  strictMode: true,
  memberCount: 231,
  starCount: 74,
  starredByViewer: false,
  viewerRole: null,
  viewerProgress: 0,
  lessonCount: 4,
  lessonsDone: 0,
  newSinceLastVisit: 0,
  online: 18,
  lastActiveAt: '2026-08-28T14:00:00Z',
};

/** ── Collections ────────────────────────────────────────────────── */

/** "Created by you" — cards show drafts pending + members active, not progress. */
export const createdByViewer = [linearAlgebra, numericsProcessing];

/**
 * A Space you have finished, still active.
 *
 * `SpaceTile`'s corner marker shows one thing at a time — archived, then done,
 * then "N new" — which is right, but it meant the "Done" badge was unreachable
 * while the only complete Space was also archived. A finished-but-still-live
 * Space is the ordinary case for that badge and there was no fixture for it,
 * so a whole visual state had never been seen.
 */
export const discreteStructures: Space = {
  id: 's-discrete',
  name: 'Diskrete Strukturen',
  shortCode: 'DIS',
  description: 'Mengen, Relationen, Graphen und Induktion. Grundlagen für alles Weitere.',
  owner: keller,
  universe: marburg,
  classification: { domain: 'Mathematics', subject: 'Discrete Mathematics' },
  mode: 'guided',
  visibility: 'public',
  state: 'active',
  groundingEnabled: true,
  strictMode: false,
  memberCount: 96,
  starCount: 38,
  starredByViewer: true,
  viewerRole: 'member',
  viewerProgress: 100,
  lessonCount: 3,
  lessonsDone: 3,
  newSinceLastVisit: 0,
  online: 7,
  lastActivity: 'You finished the path',
  lastActiveAt: '2026-08-24T11:00:00Z',
};

/** "Joined" — cards show the viewer's own progress. */
export const joinedByViewer = [databaseSystems, cryptography, discreteStructures];

/** Archived lives in its own collapsed section, never hidden. */
export const archivedSpaces = [statistics];

/** Everything under Mine, in section order. */
export const mySpaces = [...createdByViewer, ...joinedByViewer, ...archivedSpaces];

/**
 * Someone else's private Space.
 *
 * Not in `mySpaces` and not in `discoverSpaces` — it exists in the world and
 * the viewer cannot see it. Its only job is to give the visibility rules
 * something real to exclude: `search.test.ts` had a branch for exactly this
 * case, guarded by `if (privateNotMine)`, and no fixture satisfied it — so the
 * test ended in `expect(true).toBe(true)` and could not fail.
 */
export const someoneElsesPrivate: Space = {
  id: 's-private',
  name: 'Numerische Lineare Algebra',
  shortCode: 'NLA',
  description: 'Someone else’s Space. You cannot see this.',
  owner: keller,
  universe: marburg,
  classification: { domain: 'Mathematics', subject: 'Numerical Analysis' },
  mode: 'guided',
  visibility: 'private',
  state: 'active',
  groundingEnabled: false,
  strictMode: false,
  memberCount: 12,
  starCount: 0,
  starredByViewer: false,
  viewerRole: null,
  viewerProgress: 0,
  lessonCount: 0,
  lessonsDone: 0,
  newSinceLastVisit: 0,
  lastActiveAt: '2026-08-20T09:00:00Z',
};

/**
 * A private Space you have asked to join and are waiting on.
 *
 * The hub's primary action has four states and only three had fixtures, so
 * "Requested" — the disabled one — could never render. Distinct from
 * `someoneElsesPrivate`, which is private and *not* requested: keeping both
 * means the two private cases are visibly different rather than collapsing
 * into whichever the last edit happened to set.
 */
export const requestedPrivate: Space = {
  id: 's-requested',
  name: 'Formale Sprachen',
  shortCode: 'FS',
  description: 'Automata, grammars and the pumping lemma. Small and deliberately quiet.',
  owner: weber,
  universe: marburg,
  classification: { domain: 'Computer Science', subject: 'Theory of Computation' },
  mode: 'guided',
  visibility: 'invite',
  state: 'active',
  groundingEnabled: false,
  strictMode: false,
  memberCount: 28,
  starCount: 4,
  starredByViewer: false,
  viewerRole: null,
  // Asked, and waiting on the Owner. The fourth button state.
  viewerRequested: true,
  viewerProgress: 0,
  lessonCount: 0,
  lessonsDone: 0,
  newSinceLastVisit: 0,
  online: 3,
  lastActiveAt: '2026-08-26T10:00:00Z',
};

/** Discover — public Spaces the viewer has not joined. Ranked by stars. */
export const discoverSpaces = [machineLearning, analysis];

/**
 * Every Space in the fixture world, including ones the viewer cannot see.
 *
 * Screens must filter this; the visibility rules are what do the filtering,
 * and they need something to exclude or they are guarding nothing.
 */
export const allSpaces = [
  ...mySpaces,
  ...discoverSpaces,
  someoneElsesPrivate,
  requestedPrivate,
];

/**
 * Spaces created during this session.
 *
 * Kept separate from `allSpaces` so the fixture guards keep asserting over a
 * fixed, known set — a mutable base array would make "covers every state"
 * depend on whatever the last click created. Everything that *reads* Spaces
 * consults both.
 */
const createdThisSession: Space[] = [];

/** Spaces made this session, newest first. */
export const createdThisSessionSpaces = (): Space[] => [...createdThisSession];

/** Every Space the viewer can see, fixtures plus anything just created. */
export const visibleSpaces = (): Space[] => [...createdThisSession, ...allSpaces];

export const spaceById = (id: string): Space | undefined =>
  visibleSpaces().find((s) => s.id === id);

/**
 * Create and register a Space, so that landing on its Overview actually finds
 * it. `draftSpace` alone builds the object without registering it, which
 * navigated to a Space that did not exist — caught by clicking the dialog
 * through rather than by any test.
 */
export const createSpace = (input: Parameters<typeof draftSpace>[0]): Space => {
  const space = draftSpace(input);
  createdThisSession.unshift(space);
  return space;
};

/* ── Lifecycle ────────────────────────────────────────────────────
   Create, join, switch mode, delete. Pure functions over the fixture set —
   the dialogs call them, and wiring later replaces the bodies, not the
   call sites.

   // NEEDS-BACKEND: member roles (Owner/Editor/Member) are a v4 concept with
   // no counterpart in the current schema. Join codes exist on courses today,
   // so `joinCodeFor` mirrors something real; role changes do not. */

import { viewer as viewerPerson } from './people';
import { lessonsForSpace as lessonsFor } from './lessons';
import type { Lesson, SpaceMode, Visibility } from '../types';

/**
 * A brand-new Space, before it is saved.
 *
 * Private by default — Doc 1 is explicit that Private is "the default for
 * everyone", and defaulting a new Space to Public would publish someone's
 * half-built material the moment they named it. Grounding starts off, because
 * it is dormant until an Owner nominates a source of truth.
 */
export const draftSpace = ({
  name,
  mode = 'guided',
  visibility = 'private',
}: {
  name: string;
  mode?: SpaceMode;
  visibility?: Visibility;
}): Space => ({
  id: `s-draft-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  name,
  shortCode: name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase(),
  description: null,
  owner: viewerPerson,
  universe: null,
  classification: { domain: 'Computer Science', subject: null },
  mode,
  visibility,
  state: 'active',
  groundingEnabled: false,
  strictMode: false,
  memberCount: 1,
  starCount: 0,
  // You cannot star your own Space (Engagement rule 3).
  starredByViewer: false,
  viewerRole: 'owner',
  viewerProgress: 0,
  lessonCount: 0,
  lessonsDone: 0,
  newSinceLastVisit: 0,
  draftsPending: 0,
  membersActiveThisWeek: 1,
  lastActiveAt: '2026-08-31T00:00:00Z',
});

/**
 * Switch Guided ↔ Open.
 *
 * Lossless by construction: it changes **only who may publish going forward**.
 * Existing Lessons keep their place, their origin and everyone's progress — so
 * this returns the same Lessons untouched, and flipping an Open Space to
 * Guided does not retroactively evict the member work already in its path.
 */
export const switchMode = (
  spaceId: string,
  mode: SpaceMode,
): { space: Space; lessons: Lesson[] } => {
  const space = allSpaces.find((s) => s.id === spaceId)!;
  return { space: { ...space, mode }, lessons: lessonsFor(spaceId) };
};

/**
 * Deleting a Space is destructive and irreversible, so it takes an exact,
 * case-sensitive name match — the pattern the Studio screens use for anything
 * that cannot be undone. Only the Owner may do it at all.
 */
export const canDelete = (space: Space, typedName: string): boolean =>
  space.viewerRole === 'owner' && typedName === space.name;

/**
 * A stable, human-readable join code. Derived from the id so it never drifts;
 * courses carry a join code today, so this mirrors something real.
 */
export const joinCodeFor = (spaceId: string): string => {
  let hash = 0;
  for (const ch of spaceId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 — misread aloud
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[(hash >>> (i * 5)) % alphabet.length];
  return out;
};

/** Codes are read aloud and typed, so matching ignores case. */
export const spaceByJoinCode = (code: string): Space | undefined =>
  allSpaces.find((s) => joinCodeFor(s.id) === code.trim().toUpperCase());
