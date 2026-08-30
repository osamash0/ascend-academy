/**
 * Learnstation v4 domain types.
 *
 * Source of truth: `docs/design-v4/01-foundations.md` (Locked v1.15).
 *
 * Vocabulary law (Rule 6/7) — these names are load-bearing. Banned everywhere,
 * including identifiers: professor, student, teacher, instructor, course,
 * classroom, module, folder, lecture, LMS.
 *
 * Two properties ride on content and are always visible where they apply:
 *   • Origin    — Official (Owner/Editors) or Community (Members).
 *   • Grounding — grounded / not grounded. Dormant by default: when a Space
 *                 has grounding switched off, render no marker at all.
 */

/** A person. Every piece of content carries one — anonymous content is not allowed. */
export interface Person {
  id: string;
  /** Real display name. Always rendered next to their content. */
  name: string;
  /** Avatar URL, or null to fall back to initials. */
  avatarUrl: string | null;
}

/**
 * Permission roles. Per Space, never per account — the same person can be
 * Owner in one Space and Member in another.
 *
 * Note: "Learner" and "Creator" are descriptive copy words only. They are
 * never permission roles and must not appear in this union.
 */
export type Role = 'owner' | 'editor' | 'member';

/** Who may publish Lessons into the path. Switchable at any time, lossless. */
export type SpaceMode = 'guided' | 'open';

/** Who can find and join. Private is the default for everyone. */
export type Visibility = 'private' | 'invite' | 'public';

/** Who made a piece of content. Always visible. */
export type Origin = 'official' | 'community';

/**
 * How content relates to the Space's source of truth.
 *
 * `null` = the check has not run. Once grounding is on, the UI treats null as
 * 'not-grounded'. While grounding is OFF, no marker renders at all regardless
 * of this value — see `Space.groundingEnabled`.
 */
export type Grounding = 'grounded' | 'not-grounded' | null;

/** Progress against a Lesson. */
export type LessonProgress = 'not-started' | 'in-progress' | 'done';

/** Progress against a Concept. This is what lights the map. */
export type ConceptProgress = 'untouched' | 'discovered' | 'cleared';

/** Lesson lifecycle. Members only ever see `published` and `archived`. */
export type LessonState =
  | 'draft'
  | 'processing'
  | 'needs-review'
  | 'published'
  | 'archived';

/** Space lifecycle. Archived is read-only, keeps progress, earns no XP. */
export type SpaceState = 'active' | 'archived';

/** An optional organisation. Gives a Space scoped discovery and branding. */
export interface Universe {
  id: string;
  name: string;
  /**
   * 0–3 ordered grouping levels, each a name plus a flat list of values.
   * Capped at 3 — unlimited depth would be the folder tree sneaking back in.
   * Level names are configurable text, never hardcoded academic words.
   */
  levels: { name: string; value: string }[];
}

/** What a Space is about. Platform-wide, applies to every Space. */
export interface Classification {
  /** One of ~15–20 curated broad fields. */
  domain: string;
  /** Topic inside a domain. Curated list, grows on demand. */
  subject: string | null;
}

/** A shared study room for one subject. Never contains another Space. */
export interface Space {
  id: string;
  name: string;
  /** Short display code used as the tile watermark, e.g. "DBS". */
  shortCode: string;
  description: string | null;

  owner: Person;
  /** null when the Space belongs to no Universe. Solo Spaces look identical. */
  universe: Universe | null;
  classification: Classification;

  mode: SpaceMode;
  visibility: Visibility;
  state: SpaceState;

  /**
   * Owner-controlled, off by default and dormant until switched on. While
   * false, no grounding marker appears anywhere in this Space.
   */
  groundingEnabled: boolean;
  /** Per-Space option, requires `groundingEnabled`. Off by default. */
  strictMode: boolean;

  memberCount: number;
  /** GitHub-style, unlimited. Belongs to whole Spaces, never to contributions. */
  starCount: number;
  /** Whether the viewer has starred this Space. */
  starredByViewer: boolean;

  /** The viewer's role here, or null when they have not joined. */
  viewerRole: Role | null;
  /** The viewer's progress across the path, 0–100. */
  viewerProgress: number;

  lessonCount: number;
  /** Lessons the viewer has finished. */
  lessonsDone: number;
  /**
   * Published Lessons added since the viewer's last visit. Drives the "N new"
   * badge. See notes-spaces-screen.md gap 2 — this is the one definition.
   */
  newSinceLastVisit: number;

  /** Drafts awaiting the Owner/Editors. Only surfaced to them. */
  draftsPending?: number;
  /** Members active in the last 7 days. Only surfaced to Owner/Editors. */
  membersActiveThisWeek?: number;

  /** ISO timestamp, used by the "last active" sort. */
  lastActiveAt: string;
}

/** A file someone uploaded. Deleting it never breaks its Lesson. */
export interface Material {
  id: string;
  filename: string;
  sizeBytes: number;
  uploadedBy: Person;
  uploadedAt: string;
  /** True once the source file has been removed but the Lesson still works. */
  sourceRemoved: boolean;
}

/** A single idea inside a Lesson. The "planet". */
export interface Concept {
  id: string;
  name: string;
  progress: ConceptProgress;
}

/** The readable, learnable unit. Lives in a Space in a fixed order. */
export interface Lesson {
  id: string;
  spaceId: string;
  title: string;
  /** Fixed position in the path. Likes never reorder this. */
  order: number;

  state: LessonState;
  /** In an Open Space a Member's Lesson sits in the path with Community origin. */
  origin: Origin;
  /** Always shown, whatever the origin. */
  author: Person;
  grounding: Grounding;

  progress: LessonProgress;
  /** 0–100. */
  percentComplete: number;

  concepts: Concept[];
  /** null when the source file was deleted — the Lesson keeps working. */
  material: Material | null;
  /** How many member contributions are anchored to this Lesson. */
  contributionCount: number;
  /** Questions belonging to this Lesson. */
  practiceCount: number;
}

/** Where a contribution attaches. One contribution, one anchor. */
export type ContributionAnchor =
  | { level: 'space'; spaceId: string }
  | { level: 'lesson'; lessonId: string }
  | { level: 'concept'; conceptId: string };

/** Open model; v1 accepts low-risk types only. No executable artifacts. */
export type ContributionType = 'text' | 'pdf' | 'image' | 'link' | 'practice-set';

/** Something a Member made and published into the Space. */
export interface Contribution {
  id: string;
  title: string;
  /**
   * A line or two of the actual content. Without it a contribution is a
   * headline you must open to evaluate, which makes a busy community section
   * unusable — you cannot tell the good from the noise at a glance.
   */
  excerpt?: string;
  type: ContributionType;
  anchor: ContributionAnchor;
  /** Always Community — Official content is a Lesson, not a contribution. */
  origin: 'community';
  author: Person;
  grounding: Grounding;

  /** Public. One tap, unlimited. Sorts the community section. */
  likeCount: number;
  likedByViewer: boolean;

  /** Owner marked it good; stays community-authored, stays in this section. */
  endorsed: boolean;
  /** Owner hid it. Visible to its author and the Owner/Editors only. */
  hidden: boolean;
  /** Its anchor was deleted. Surfaced to the Owner and to the author. */
  orphaned: boolean;

  createdAt: string;
}

/** A person plus their role in one Space. */
export interface Membership {
  person: Person;
  role: Role;
  /** 0–100 across the path. Used by the zero-progress like gate. */
  progress: number;
  joinedAt: string;
}

/** Every async surface renders one of these. Never just the happy path. */
export type LoadState = 'loading' | 'ready' | 'empty' | 'error';

/* ── Library ──────────────────────────────────────────────────────
   Doc 2 locks Library as filtered by AUTHOR, not by content type: the
   objects YOU made, wherever they live. A Space shows everyone's work in one
   room; Library shows only yours across every room.

   Library holds NO Spaces (Doc 2, Spaces/Library rule 2 — a Space card only
   ever appears under Spaces). Its items are POINTERS into their Space, except
   Notes, which are read and written in Library directly. */

/** Private, anchored in a Lesson. Only its author ever sees it. */
export interface Note {
  id: string;
  /**
   * Always the viewer. A Note is private and appears nowhere else, so it has
   * no reader but its author — but storing it makes that a fact the code can
   * check rather than a convention it relies on.
   */
  authorId: string;
  /** Author is always the viewer — a Note appears nowhere else. */
  body: string;
  /** Where it is anchored. The Note is still readable if this is gone. */
  lessonId: string;
  lessonTitle: string;
  spaceId: string;
  spaceName: string;
  updatedAt: string;
}

/** What kind of thing you made. Library groups by this. */
export type LibraryKind = 'note' | 'material' | 'contribution';

/**
 * One thing you made, normalised for the Library list.
 *
 * `href` is where opening it goes. For notes that is Library itself; for
 * everything else it is the object in its Space — Library never re-renders
 * Space content, which is what made the rejected version a duplicate index.
 */
export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  title: string;
  /** Context line: which Space, and which Lesson where relevant. */
  spaceId: string;
  spaceName: string;
  lessonTitle?: string;
  updatedAt: string;
  /** Contributions only — Library doubles as your creator record. */
  likeCount?: number;
  endorsed?: boolean;
  promoted?: boolean;
  orphaned?: boolean;
  /** Materials only. */
  sizeBytes?: number;
  /** Materials only: still ingesting, or a draft not yet published. */
  pending?: boolean;
}

/**
 * A Concept plus where it lives — what the Concept overview needs.
 *
 * Mirrors two shapes the backend already serves:
 *   • `conceptsService.LectureConcept {concept_id, name, weight, slide_indices}`
 *     — the Concepts of one Lesson, with how central each is to it.
 *   • `conceptsService.RelatedLecture` — answers "which other Lessons touch
 *     this Concept", which is why `lessonIds` is a list and not one id.
 *
 * Wiring this later is a field rename, not a new endpoint.
 */
export interface ConceptDetail extends Concept {
  /** 0–1. How central this idea is to the Lessons that carry it. */
  weight: number;
  spaceId: string;
  /** Every Lesson that touches it, in path order. Never empty. */
  lessonIds: string[];
}
