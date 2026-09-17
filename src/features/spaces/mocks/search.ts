import { allConcepts, conceptContributions } from './concepts';
import { publishedLessonsForSpace } from './lessons';
import { spaceContributions, normalizationContributions } from './contributions';
import { resolveContributionAnchor } from './library';
import { anchorFor } from './reanchor';
import { canSeeHidden } from './engagement';
import { viewer } from './people';
import { visibleSpaces } from './spaces';

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
  /**
   * The Space this lives in — Doc 2 rule 2, every result names it.
   *
   * `null` only for a Space hit, which *is* its own context. It used to be
   * `s.name`, so a Space result printed its own name on both lines: query
   * "data" gave "Database Systems / Database Systems".
   */
  spaceName: string | null;
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

  /*
   * Rule 4: only what you can already see — and `visibleSpaces()`, not
   * `allSpaces`. `allSpaces` is the frozen fixture list, so a Space created
   * this session was unfindable: you could open it by URL and it did not exist
   * in ⌘K. `spaces.ts` states the rule in words — "everything that reads
   * Spaces consults both".
   */
  const reachable = visibleSpaces().filter(
    (s) => s.viewerRole !== null || s.visibility === 'public',
  );
  const nameOf = (id: string) => visibleSpaces().find((s) => s.id === id)?.name ?? '';

  const spaces: Hit[] = reachable
    .filter((s) => matches(s.name, q))
    .map((s) => ({
      id: s.id,
      title: s.name,
      // A Space *is* its own context, so there is no second line to print.
      // Setting `spaceName: s.name` rendered its name twice — query "data"
      // gave "Database Systems / Database Systems".
      spaceName: null,
      href: `/v4/space/${s.id}`,
    }));

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
      spaceName: nameOf(c.spaceId),
      href: `/v4/space/${c.spaceId}/concept/${c.id}`,
    }));

  const contributions: Hit[] = [
    ...spaceContributions,
    ...normalizationContributions,
    ...conceptContributions,
  ]
    // Hidden work stays findable by its author and by Owner/Editors, which is
    // the rule everywhere else. Written out as `!c.hidden` here, this was the
    // seventh unconditional copy — and it meant an author could not find their
    // own hidden contribution, the exact vanishing the rule forbids.
    .filter((c) => matches(c.title, q))
    .flatMap((c) => {
      /*
       * Resolved, not assumed. `'s-dbs'` was hardcoded for any anchor that was
       * not space-level — correct today only because every lesson- and
       * concept-anchored fixture happens to live in Database Systems. One
       * contribution elsewhere and ⌘K would name the wrong Space and navigate
       * to it.
       */
      const at = resolveContributionAnchor(anchorFor(c), c.id);
      if (!at.spaceId) return [];
      const space = visibleSpaces().find((s) => s.id === at.spaceId);
      if (!space) return [];
      if (!canSeeHidden(c.author.id, space.viewerRole, viewer.id) && c.hidden) return [];
      return [
        {
          id: c.id,
          title: c.title,
          spaceName: space.name,
          /*
           * No `?? '/v4/space/…'` fallback. Every anchor level now resolves to
           * the item itself — space-level by fragment — and the only anchors
           * that resolve to `null` are orphans, whose Lesson is gone. ⌘K drops
           * those above (`if (!at.spaceId) return []`) rather than offering a
           * result that opens a Space the work is no longer part of.
           */
          href: at.href,
        },
      ];
    });

  return { spaces, lessons, concepts, contributions };
};

/** Total across every group — used for the empty state. */
export const hitCount = (r: SearchResults): number =>
  r.spaces.length + r.lessons.length + r.concepts.length + r.contributions.length;
