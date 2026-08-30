import { useEffect, useState } from 'react';
import type { Contribution, Lesson, LibraryItem, LoadState, Membership, Note, Space } from '../types';
import {
  archivedSpaces,
  createdByViewer,
  discoverSpaces,
  joinedByViewer,
  spaceById,
} from '../mocks/spaces';
import { lessonsForSpace, publishedLessonsForSpace } from '../mocks/lessons';
import {
  contributionsForLesson,
  contributionsForSpace,
  membersForSpace,
} from '../mocks/contributions';
import { homeFeed, itemsOfKind, libraryItems, nextAction, notes, pendingUploads } from '../mocks/library';
import type { HomeItem } from '../mocks/library';

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
      created: empty ? [] : createdByViewer,
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
  const items = ready ? (kind ? itemsOfKind(kind) : libraryItems) : [];
  return {
    state: ready && items.length === 0 ? 'empty' : state,
    items,
    notes: ready ? notes : [],
    pending: ready ? pendingUploads() : [],
  };
}

/* ── Home ─────────────────────────────────────────────────────── */

export interface HomeResult {
  state: LoadState;
  /** The one thing to do now, ranked across every Space. */
  next: HomeItem | null;
  /** Everything else, all Lesson-level — never a Space card. */
  feed: HomeItem[];
  streakDays: number;
}

/** Home: your next action, assembled across every Space. */
export function useHome(): HomeResult {
  const scenario = useScenario();
  const state = useSettled(scenario);
  const ready = state === 'ready';
  return {
    state,
    next: ready ? nextAction : null,
    feed: ready ? homeFeed : [],
    streakDays: ready ? 4 : 0,
  };
}
