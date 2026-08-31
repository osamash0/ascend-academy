import { allConcepts, conceptContributions } from './concepts';
import { publishedLessonsForSpace } from './lessons';
import { spaceContributions, normalizationContributions } from './contributions';
import { allSpaces } from './spaces';

/**
 * Search — the ⌘K jump tool.
 *
 * Mirrors `searchService.GlobalSearchResults {lectures, slides, concepts,
 * worksheets}`, renamed to the v4 vocabulary. Doc 2 fixes four rules and each
 * is enforced here rather than in the UI:
 *
 *   1. Results **group by object type**.
 *   2. Every result **names the Space it lives in**.
 *   3. Search **never renders content inline** — these are pointers, so a hit
 *      carries a title and an href, never a body.
 *   4. It searches **only what you can already see**: published content in
 *      your Spaces, plus public Spaces. Drafts are excluded here, not hidden
 *      later, so a draft can never leak through a search box.
 */

export interface Hit {
  id: string;
  title: string;
  spaceName: string;
  href: string;
  /** Present on Lesson hits so the published-only rule is checkable. */
  state?: string;
}

export interface SearchResults {
  spaces: Hit[];
  lessons: Hit[];
  concepts: Hit[];
  contributions: Hit[];
}

const EMPTY: SearchResults = { spaces: [], lessons: [], concepts: [], contributions: [] };

const matches = (haystack: string, q: string) => haystack.toLowerCase().includes(q);

export const search = (query: string): SearchResults => {
  const q = query.trim().toLowerCase();
  // A blank query returns nothing, not everything — ⌘K is a jump tool, and
  // dumping the whole product into it is not a search result.
  if (!q) return EMPTY;

  // Rule 4: only what you can already see.
  const reachable = allSpaces.filter((s) => s.viewerRole !== null || s.visibility === 'public');

  const spaces: Hit[] = reachable
    .filter((s) => matches(s.name, q))
    .map((s) => ({ id: s.id, title: s.name, spaceName: s.name, href: `/v4/space/${s.id}` }));

  const lessons: Hit[] = reachable.flatMap((s) =>
    // Published only — a draft must never leak through a search box.
    publishedLessonsForSpace(s.id)
      .filter((l) => matches(l.title, q))
      .map((l) => ({
        id: l.id,
        title: l.title,
        spaceName: s.name,
        href: `/v4/space/${s.id}/lesson/${l.id}`,
        state: l.state,
      })),
  );

  const reachableIds = new Set(reachable.map((s) => s.id));
  const concepts: Hit[] = allConcepts()
    .filter((c) => reachableIds.has(c.spaceId) && matches(c.name, q))
    .map((c) => ({
      id: c.id,
      title: c.name,
      spaceName: allSpaces.find((s) => s.id === c.spaceId)?.name ?? '',
      href: `/v4/space/${c.spaceId}/concept/${c.id}`,
    }));

  const contributions: Hit[] = [
    ...spaceContributions,
    ...normalizationContributions,
    ...conceptContributions,
  ]
    .filter((c) => !c.hidden && matches(c.title, q))
    .map((c) => {
      const spaceId = c.anchor.level === 'space' ? c.anchor.spaceId : 's-dbs';
      return {
        id: c.id,
        title: c.title,
        spaceName: allSpaces.find((s) => s.id === spaceId)?.name ?? '',
        href: `/v4/space/${spaceId}`,
      };
    });

  return { spaces, lessons, concepts, contributions };
};

/** Total across every group — used for the empty state. */
export const hitCount = (r: SearchResults): number =>
  r.spaces.length + r.lessons.length + r.concepts.length + r.contributions.length;
