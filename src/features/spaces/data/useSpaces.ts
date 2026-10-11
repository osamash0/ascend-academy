import { useEffect, useState } from 'react';
import type { LectureConcept, LocalizedLectureBundle } from '@/types/domain';
import type { Contribution, Lesson, LibraryItem, LoadState, Membership, Note, Space } from '../types';
import {
  archivedSpaces,
  createdByViewer,
  createdThisSessionSpaces,
  discoverSpaces,
  joinedByViewer,
  spaceById,
} from '../mocks/spaces';
import {
  adjacentLessons,
  lessonsForSpace,
  publishedLessonsForSpace,
  visibleLesson,
} from '../mocks/lessons';
import { lessonContent } from '../mocks/content';
import {
  contributionsForLesson,
  contributionsForSpace,
  membersForSpace,
} from '../mocks/contributions';
import {
  heroKind,
  homeFeed,
  libraryItemsWith,
  nextAction,
  pendingUploads,
  recentlyViewed,
} from '../mocks/library';
import { allNotes } from '../mocks/notes';
import { currentRun } from '../mocks/history';
import type { HeroKind, HomeItem, RecentItem } from '../mocks/library';
import { canvasById, materialById, pagesFor, recentCanvases } from '../mocks/studio-canvas';
import type { CanvasSummary } from '../mocks/studio-canvas';
import type { CanvasDoc, SourcePage, StudioMaterial } from '../studio/types';

/**
 * The data seam.
 *
 * Everything in `features/spaces/` reads through these hooks and nothing else.
 * They return the shape a real query would — `{ state, data }` — so wiring the
 * backend later means replacing the bodies here, not touching a single
 * component. No API calls, no Supabase, no backend imports live below this
 * line today.
 */

/**
 * Force a load state for design review, via `?mock=empty|loading|error`.
 * Lets the empty, loading and error screens be inspected in a browser without
 * editing code — they are as real as the happy path and get reviewed as often.
 */
export type Scenario = 'ready' | 'empty' | 'loading' | 'error';

export function useScenario(): Scenario {
  const [scenario, setScenario] = useState<Scenario>('ready');
  useEffect(() => {
    const read = () => {
      const v = new URLSearchParams(window.location.search).get('mock');
      setScenario(
        v === 'empty' || v === 'loading' || v === 'error' ? v : 'ready',
      );
    };
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  return scenario;
}

/** Mimics a network round-trip so skeletons are actually exercised. */
function useSettled(scenario: Scenario, delay = 600): LoadState {
  const [state, setState] = useState<LoadState>('loading');
  useEffect(() => {
    if (scenario === 'loading') {
      setState('loading');
      return;
    }
    setState('loading');
    const id = setTimeout(() => {
      setState(
        scenario === 'error' ? 'error' : scenario === 'empty' ? 'empty' : 'ready',
      );
    }, delay);
    return () => clearTimeout(id);
  }, [scenario, delay]);
  return state;
}

/**
 * Loading and error for a screen that reads fixtures synchronously.
 *
 * Eight of the twelve screens never called `useScenario`, so `?mock=loading`
 * and `?mock=error` were silently no-ops on them — while §5.4 requires all
 * four states rendered and screenshotted per screen. Worse, three of those
 * eight used the *error* state for "not found", so a mistyped Lesson id
 * claimed the connection had dropped.
 *
 * Exported separately from the data hooks because these screens have nothing
 * to fetch: what they need is the round-trip, not the data.
 */
export function useScreenState(): LoadState {
  return useSettled(useScenario());
}

export interface MySpaces {
  /** Cards here show drafts pending + members active, not personal progress. */
  created: Space[];
  /** Cards here show the viewer's own progress. */
  joined: Space[];
  /** Collapsed section at the bottom — never hidden, the progress lives here. */
  archived: Space[];
}

export interface SpacesResult {
  state: LoadState;
  mine: MySpaces;
  discover: Space[];
}

/** The Spaces screen: Mine (created / joined / archived) and Discover. */
export function useSpaces(): SpacesResult {
  const scenario = useScenario();
  const state = useSettled(scenario);
  const empty = state !== 'ready';

  return {
    state,
    mine: {
      // Anything made this session leads, because you just made it.
      created: empty ? [] : [...createdThisSessionSpaces(), ...createdByViewer],
      joined: empty ? [] : joinedByViewer,
      archived: empty ? [] : archivedSpaces,
    },
    discover: empty ? [] : discoverSpaces,
  };
}

export interface SpaceResult {
  state: LoadState;
  space: Space | null;
  /** The path, in fixed order. Drafts included only for Owner/Editors. */
  lessons: Lesson[];
  /** Anchored at the Space itself — cheat sheets, reading lists. */
  contributions: Contribution[];
  members: Membership[];
}

/** One Space: its ordered Lessons, community sections and members. */
export function useSpace(spaceId: string | undefined): SpaceResult {
  const scenario = useScenario();
  const state = useSettled(scenario);
  const space = spaceId ? spaceById(spaceId) ?? null : null;

  if (state !== 'ready' || !space) {
    return {
      state: !space && state === 'ready' ? 'empty' : state,
      space: null,
      lessons: [],
      contributions: [],
      members: [],
    };
  }

  // Rule 1: Members only ever see published Lessons. Drafts and processing
  // states are visible to their author and the Owner/Editors.
  const canSeeUnpublished =
    space.viewerRole === 'owner' || space.viewerRole === 'editor';

  return {
    state,
    space,
    lessons: canSeeUnpublished
      ? lessonsForSpace(space.id)
      : publishedLessonsForSpace(space.id),
    contributions: contributionsForSpace(space.id),
    members: membersForSpace(space.id),
  };
}

/** Community contributions anchored to one Lesson, sorted by likes. */
export function useLessonContributions(lessonId: string | undefined): {
  state: LoadState;
  contributions: Contribution[];
} {
  const scenario = useScenario();
  const state = useSettled(scenario, 400);
  return {
    state,
    contributions:
      state === 'ready' && lessonId ? contributionsForLesson(lessonId) : [],
  };
}

/* ── Library ──────────────────────────────────────────────────── */

export interface LibraryResult {
  state: LoadState;
  items: LibraryItem[];
  notes: Note[];
  /** Studio: uploads still processing or sitting as drafts, across Spaces. */
  pending: LibraryItem[];
}

/**
 * Library: the objects you made, across every Space.
 *
 * Deliberately does not accept a Space id. Library is filtered by author, not
 * by Space — filtering it down to one Space would make it the duplicate index
 * Doc 2 rejected.
 */
export function useLibrary(kind?: LibraryItem['kind']): LibraryResult {
  const scenario = useScenario();
  const state = useSettled(scenario);
  const ready = state === 'ready';
  /*
   * Read the live note store, not the seed. `libraryItems()` is composed once at
   * module load, so a note written this session never appeared in Library —
   * the one surface Doc 2 says notes are *written* in.
   */
  const currentNotes = ready ? allNotes() : [];
  const all = ready ? libraryItemsWith(currentNotes) : [];
  const items = kind ? all.filter((i) => i.kind === kind) : all;
  return {
    state: ready && items.length === 0 ? 'empty' : state,
    items,
    notes: currentNotes,
    pending: ready ? pendingUploads() : [],
  };
}

/* ── Home ─────────────────────────────────────────────────────── */

export interface HomeResult {
  state: LoadState;
  /** Which hero to show: onboard / resume / review. */
  kind: HeroKind;
  /** The one thing to do now, ranked across every Space. */
  next: HomeItem | null;
  /** Everything else, all Lesson-level — never a Space card. */
  feed: HomeItem[];
  /** Most-recent first, minus whatever `next` already offers. */
  recent: RecentItem[];
  streakDays: number;
}

/** Home: your next action, assembled across every Space. */
export function useHome(): HomeResult {
  const scenario = useScenario();
  const state = useSettled(scenario);
  const ready = state === 'ready';
  /*
   * `?mock=onboard|review` forces the other two heroes, so all three can be
   * reviewed in a browser without editing code — the same reason the load
   * states are switchable. They are as real as the happy path.
   */
  const forced = new URLSearchParams(window.location.search).get('mock');
  const kind =
    forced === 'onboard'
      ? 'onboard'
      : forced === 'review'
        ? 'review'
        : heroKind({ hasProgress: true, allDone: false });

  return {
    state,
    kind,
    next: ready && kind !== 'onboard' ? nextAction : null,
    feed: ready && kind === 'resume' ? homeFeed : [],
    recent: ready && kind === 'resume' ? recentlyViewed() : [],
    // Derived. This was a literal `4` that Profile also held independently,
    // so Home and Profile could disagree about the same run and both look right.
    streakDays: ready ? currentRun() : 0,
  };
}

/* ── Studio canvas ────────────────────────────────────────────────────── */

export interface CanvasResult {
  state: LoadState;
  canvas: CanvasDoc | null;
  pages: SourcePage[];
  material: StudioMaterial | null;
  spaceName: string | null;
}

/** One Studio canvas and the source pages behind it. Unknown id → `empty`, like `useSpace`. */
export function useCanvas(canvasId: string | undefined): CanvasResult {
  const state = useSettled(useScenario());
  const canvas = canvasId ? canvasById(canvasId) ?? null : null;
  if (state !== 'ready' || !canvas) {
    return {
      state: !canvas && state === 'ready' ? 'empty' : state,
      canvas: null,
      pages: [],
      material: null,
      spaceName: null,
    };
  }
  return {
    state,
    canvas,
    pages: pagesFor(canvas.materialIds),
    material: materialById(canvas.materialIds[0]) ?? null,
    spaceName: canvas.spaceId ? spaceById(canvas.spaceId)?.name ?? null : null,
  };
}

export interface StudioHomeResult {
  state: LoadState;
  recent: CanvasSummary[];
}

export function useStudioHome(): StudioHomeResult {
  const state = useSettled(useScenario());
  return { state, recent: state === 'ready' ? recentCanvases() : [] };
}

/* ── One Lesson, and what it is made of ───────────────────────── */

export interface LessonResult {
  state: LoadState;
  space: Space | null;
  /** Rule 1 applied: a Member never receives an unpublished Lesson here. */
  lesson: Lesson | null;
  /** The published neighbours in the path, for the pager. */
  prev: Lesson | null;
  next: Lesson | null;
}

/**
 * One Lesson as the viewer may see it.
 *
 * `ReaderScreen` reaches into `mocks/lessons.ts` for this directly; the
 * two-faced reader goes through here instead, so the day these bodies call the
 * backend the screen does not change.
 */
export function useLesson(spaceId: string | undefined, lessonId: string | undefined): LessonResult {
  const scenario = useScenario();
  const state = useSettled(scenario);
  const space = spaceId ? spaceById(spaceId) ?? null : null;
  const lesson = space && lessonId ? visibleLesson(space, lessonId) ?? null : null;
  if (state !== 'ready') return { state, space: null, lesson: null, prev: null, next: null };
  const { prev, next } = space && lesson ? adjacentLessons(space.id, lesson.id) : { prev: null, next: null };
  return { state, space, lesson, prev: prev ?? null, next: next ?? null };
}

export interface LessonContentResult {
  state: LoadState;
  /** `GET /api/v1/localized-content/lectures/{id}`, as `fetchLocalizedLectureBundle` returns it. */
  bundle: LocalizedLectureBundle | null;
  /** `GET /api/v1/concepts/lecture/{id}`, as `fetchLectureConcepts` returns it. */
  concepts: LectureConcept[];
  /** What `resolvePdfUrl(bundle.lecture.pdf_url)` returns. Null = no file. */
  pdfUrl: string | null;
}

/**
 * What a Lesson is made of: its pages, its Concepts, its file.
 *
 * The result is the two endpoint responses in their own types plus the signed
 * URL for the file, which is exactly what the live body will return:
 *
 *   const bundle = await fetchLocalizedLectureBundle(lessonId);
 *   const concepts = await fetchLectureConcepts(lessonId);
 *   const pdfUrl = await resolvePdfUrl(bundle.lecture.pdf_url);
 *
 * Today the body reads `mocks/content.ts`. `state === 'empty'` is a Lesson
 * with nothing to read yet, which is not a failure and is not rendered as one.
 */
export function useLessonContent(lessonId: string | undefined): LessonContentResult {
  const scenario = useScenario();
  const state = useSettled(scenario);
  const content = lessonId ? lessonContent(lessonId) : null;
  if (state !== 'ready') return { state, bundle: null, concepts: [], pdfUrl: null };
  if (!content) return { state: 'empty', bundle: null, concepts: [], pdfUrl: null };
  return { state, bundle: content.bundle, concepts: content.concepts, pdfUrl: content.pdfUrl };
}
