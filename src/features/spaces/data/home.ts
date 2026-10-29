import type { HeroKind, HomeItem, RecentItem } from '../mocks/library';

export type { HeroKind, HomeItem, RecentItem };
import type { Lesson } from '../types';
import type { World } from './world';
import { runIn } from './record';

/**
 * Home, assembled from the live world.
 *
 * Doc 2: "Home is your next action, assembled across every Space." The rules
 * are the fixtures' rules — every item opens a Lesson, never a Space card;
 * exactly one next action; the same Lesson never appears twice on the screen —
 * applied to what the viewer actually did:
 *
 *   next    — the most recently touched Lesson that is not finished; if it is
 *             finished, the Lesson after it in the same Space.
 *   feed    — the Lesson after the one you are on ('next'), then Lessons
 *             uploaded since your last visit to a Space you are in ('new').
 *   recent  — everything else you touched, newest first.
 *   kind    — 'onboard' when you have touched nothing in a Space you are in,
 *             'review' when every published Lesson there is done, else 'resume'.
 *
 * 'review' items (spaced repetition) are not produced yet: the review engine's
 * due cards are a separate slice, and an invented one would be worse than none.
 */
export interface LiveHome {
  kind: HeroKind;
  next: HomeItem | null;
  feed: HomeItem[];
  recent: RecentItem[];
  streakDays: number;
}

export function homeFromWorld(world: World): LiveHome {
  const spaces = new Map(world.spaces.map((s) => [s.id, s]));
  const mine = world.spaces.filter((s) => s.viewerRole !== null && s.state === 'active');
  const mineIds = new Set(mine.map((s) => s.id));
  const path = (spaceId: string) =>
    world.lessons
      .filter((l) => l.spaceId === spaceId && l.state === 'published')
      .sort((a, b) => a.order - b.order);
  const lessons = new Map(world.lessons.map((l) => [l.id, l]));

  const item = (l: Lesson, reason: HomeItem['reason']): HomeItem => ({
    lessonId: l.id,
    lessonTitle: l.title,
    lessonOrder: l.order,
    spaceId: l.spaceId,
    spaceName: spaces.get(l.spaceId)?.name ?? '',
    percentComplete: l.percentComplete,
    reason,
  });
  const after = (l: Lesson) => path(l.spaceId).find((x) => x.order > l.order) ?? null;

  // Only what is still in a Space you are in, and still published.
  const touched = world.activity
    .map((a) => ({ lesson: lessons.get(a.lessonId), at: a.at }))
    .filter((t): t is { lesson: Lesson; at: string } =>
      !!t.lesson && mineIds.has(t.lesson.spaceId) && t.lesson.state === 'published',
    );

  const allPublished = mine.flatMap((s) => path(s.id));
  const kind: HeroKind = !touched.length
    ? 'onboard'
    : allPublished.length > 0 && allPublished.every((l) => l.progress === 'done')
      ? 'review'
      : 'resume';

  let next: HomeItem | null = null;
  const unfinished = touched.find((t) => t.lesson.progress !== 'done');
  if (unfinished) next = item(unfinished.lesson, 'continue');
  else if (touched.length) {
    const following = after(touched[0].lesson);
    if (following) next = item(following, 'next');
  }
  if (kind === 'onboard') next = null;

  const seen = new Set(next ? [next.lessonId] : []);
  const feed: HomeItem[] = [];
  const push = (l: Lesson | null, reason: HomeItem['reason']) => {
    if (l && !seen.has(l.id)) {
      seen.add(l.id);
      feed.push(item(l, reason));
    }
  };
  if (next) push(after(lessons.get(next.lessonId)!), 'next');
  for (const s of mine) {
    const newest = path(s.id)
      .filter((l) => l.material)
      .sort((a, b) => +new Date(b.material!.uploadedAt) - +new Date(a.material!.uploadedAt))
      .slice(0, s.newSinceLastVisit);
    newest.forEach((l) => push(l, 'new'));
  }

  const recent: RecentItem[] = touched
    .filter((t) => !seen.has(t.lesson.id))
    .slice(0, 6)
    .map((t) => ({ ...item(t.lesson, 'continue'), viewedAt: t.at }));

  return {
    kind,
    next,
    feed: kind === 'resume' ? feed : [],
    recent: kind === 'resume' ? recent : [],
    // Counted from the study days, like Profile. The stored profiles.current_streak
    // only moves when you study, so it could say 2 while Profile said 1.
    streakDays: runIn(world.record.studyDays),
  };
}
