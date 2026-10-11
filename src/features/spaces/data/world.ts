import * as fixtureSpaces from '../mocks/spaces';
import * as fixtureLessons from '../mocks/lessons';
import type { Lesson, Person, Space } from '../types';

/**
 * The viewer's world: every Space they can see and those Spaces' Lessons.
 *
 * Screens ask it synchronously — `spaceById(id)`, `visibleLesson(space, id)` —
 * exactly as they asked the fixtures. In demo mode every function delegates to
 * the fixture modules, unchanged. In live mode `LiveGate` loads the world from
 * `GET /v4/world` once, before any screen renders, and calls `setLiveWorld`;
 * from then on the same questions are answered from real courses and
 * lectures, with the same visibility rules.
 *
 * Lesson *content* is not here. It loads per Lesson through the reader.
 */
export interface World {
  viewer: Person;
  spaces: Space[];
  lessons: Lesson[];
}

let live: World | null = null;

export function setLiveWorld(world: World | null): void {
  live = world;
}

export function liveWorld(): World | null {
  return live;
}

/* ── Spaces ─────────────────────────────────────────────────────── */

/** Every Space the viewer can see. */
export const visibleSpaces = (): Space[] => (live ? live.spaces : fixtureSpaces.visibleSpaces());

/** Everything that exists, including what the viewer cannot see (fixtures only). */
export const allSpaces = (): Space[] => (live ? live.spaces : fixtureSpaces.allSpaces);

export const spaceById = (id: string): Space | undefined =>
  live ? live.spaces.find((s) => s.id === id) : fixtureSpaces.spaceById(id);

export const createdByViewer = (): Space[] =>
  live
    ? live.spaces.filter((s) => s.viewerRole === 'owner' && s.state === 'active')
    : fixtureSpaces.createdByViewer;

export const joinedByViewer = (): Space[] =>
  live
    ? live.spaces.filter(
        (s) => (s.viewerRole === 'member' || s.viewerRole === 'editor') && s.state === 'active',
      )
    : fixtureSpaces.joinedByViewer;

export const archivedSpaces = (): Space[] =>
  live
    ? live.spaces.filter((s) => s.viewerRole !== null && s.state === 'archived')
    : fixtureSpaces.archivedSpaces;

export const discoverSpaces = (): Space[] =>
  live ? live.spaces.filter((s) => s.viewerRole === null) : fixtureSpaces.discoverSpaces;

/** Spaces made this session. Live Spaces are made on the server, so none. */
export const createdThisSessionSpaces = (): Space[] =>
  live ? [] : fixtureSpaces.createdThisSessionSpaces();

/* ── Lessons ────────────────────────────────────────────────────── */

/** Every Lesson in a Space, in path order. */
export const lessonsForSpace = (spaceId: string): Lesson[] =>
  live
    ? live.lessons.filter((l) => l.spaceId === spaceId).sort((a, b) => a.order - b.order)
    : fixtureLessons.lessonsForSpace(spaceId);

/** What a Member may see: published only (Rules, 1). */
export const publishedLessonsForSpace = (spaceId: string): Lesson[] =>
  live
    ? lessonsForSpace(spaceId).filter((l) => l.state === 'published')
    : fixtureLessons.publishedLessonsForSpace(spaceId);

/** What *this viewer* may see in this Space — the Rule 1 filter itself. */
export const visibleLessonsForSpace = (space: Space): Lesson[] => {
  if (!live) return fixtureLessons.visibleLessonsForSpace(space);
  return space.viewerRole === 'owner' || space.viewerRole === 'editor'
    ? lessonsForSpace(space.id)
    : publishedLessonsForSpace(space.id);
};

/** One Lesson, or undefined if this viewer is not allowed to know it exists. */
export const visibleLesson = (space: Space, lessonId: string): Lesson | undefined =>
  live
    ? visibleLessonsForSpace(space).find((l) => l.id === lessonId)
    : fixtureLessons.visibleLesson(space, lessonId);

/** The Lessons either side of one, walking the published path only. */
export const adjacentLessons = (
  spaceId: string,
  lessonId: string,
): { prev: Lesson | null; next: Lesson | null } => {
  if (!live) return fixtureLessons.adjacentLessons(spaceId, lessonId);
  const path = publishedLessonsForSpace(spaceId);
  const i = path.findIndex((l) => l.id === lessonId);
  if (i === -1) return { prev: null, next: null };
  return { prev: path[i - 1] ?? null, next: path[i + 1] ?? null };
};

/** How far through a Space's published path the viewer is, 0–100. */
export const progressAcross = (spaceId: string): number => {
  if (!live) return fixtureLessons.progressAcross(spaceId);
  const path = publishedLessonsForSpace(spaceId);
  if (!path.length) return 0;
  return Math.round(path.reduce((n, l) => n + l.percentComplete, 0) / path.length);
};

/** One Lesson by id, and its Space, without knowing the Space first. */
export const locateLesson = (lessonId: string): { lesson: Lesson; spaceId: string } | undefined => {
  if (!live) return fixtureLessons.locateLesson(lessonId);
  const lesson = live.lessons.find((l) => l.id === lessonId);
  return lesson ? { lesson, spaceId: lesson.spaceId } : undefined;
};
