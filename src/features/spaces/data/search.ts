import * as fixtures from '../mocks/search';
import type { Hit, SearchResults } from '../mocks/search';
import { liveWorld } from './world';

export type { Hit, SearchResults };
export { hitCount } from '../mocks/search';

/**
 * ⌘K — the jump tool, over what the viewer can already see.
 *
 * Demo: the fixture search, unchanged. Live: the loaded world, searched as
 * you type with no round trip — the Spaces you are in or may join, their
 * published Lessons, and the ideas those Lessons teach. Doc 2's rules hold:
 * grouped by type, every hit names its Space, pointers only (no content),
 * published only. Contributions have no table yet, so none.
 *
 * A live idea opens the Lesson that teaches it: Concept pages are not wired
 * to real data yet, and a hit that opens "not found" is worse than one that
 * opens the right Lesson.
 */
export const search = (query: string): SearchResults => {
  const world = liveWorld();
  if (!world) return fixtures.search(query);
  const q = query.trim().toLowerCase();
  if (!q) return { spaces: [], lessons: [], concepts: [], contributions: [] };
  const has = (s: string) => s.toLowerCase().includes(q);

  const reachable = world.spaces.filter((s) => s.viewerRole !== null || s.visibility === 'public');
  const names = new Map(reachable.map((s) => [s.id, s.name]));
  const published = world.lessons
    .filter((l) => names.has(l.spaceId) && l.state === 'published')
    .sort((a, b) => a.order - b.order);

  const spaces: Hit[] = reachable
    .filter((s) => has(s.name))
    .map((s) => ({ id: s.id, title: s.name, spaceName: null, href: `/v4/space/${s.id}` }));

  const lessons: Hit[] = published
    .filter((l) => has(l.title))
    .map((l) => ({
      id: l.id,
      title: l.title,
      spaceName: names.get(l.spaceId) ?? '',
      href: `/v4/space/${l.spaceId}/lesson/${l.id}`,
      state: l.state,
    }));

  // One hit per idea per Space: the first Lesson in the path that teaches it.
  const seen = new Set<string>();
  const concepts: Hit[] = [];
  for (const l of published) {
    for (const c of l.concepts) {
      const key = `${l.spaceId}:${c.name.toLowerCase()}`;
      if (seen.has(key) || !has(c.name)) continue;
      seen.add(key);
      concepts.push({
        id: c.id,
        title: c.name,
        spaceName: names.get(l.spaceId) ?? '',
        href: `/v4/space/${l.spaceId}/lesson/${l.id}`,
      });
    }
  }

  return { spaces, lessons, concepts, contributions: [] };
};
