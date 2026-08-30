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
  lessonCount: 12,
  lessonsDone: 0,
  newSinceLastVisit: 0,
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
  viewerProgress: 0,
  lessonCount: 4,
  lessonsDone: 0,
  newSinceLastVisit: 0,
  draftsPending: 2,
  membersActiveThisWeek: 2,
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
  viewerProgress: 88,
  lessonCount: 4,
  lessonsDone: 3,
  newSinceLastVisit: 0,
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
  lastActiveAt: '2026-08-28T14:00:00Z',
};

/** ── Collections ────────────────────────────────────────────────── */

/** "Created by you" — cards show drafts pending + members active, not progress. */
export const createdByViewer = [linearAlgebra, numericsProcessing];

/** "Joined" — cards show the viewer's own progress. */
export const joinedByViewer = [databaseSystems, cryptography];

/** Archived lives in its own collapsed section, never hidden. */
export const archivedSpaces = [statistics];

/** Everything under Mine, in section order. */
export const mySpaces = [...createdByViewer, ...joinedByViewer, ...archivedSpaces];

/** Discover — public Spaces the viewer has not joined. Ranked by stars. */
export const discoverSpaces = [machineLearning, analysis];

export const allSpaces = [...mySpaces, ...discoverSpaces];

export const spaceById = (id: string): Space | undefined =>
  allSpaces.find((s) => s.id === id);
