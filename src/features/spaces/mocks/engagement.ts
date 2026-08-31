import { normalizationContributions, spaceContributions } from './contributions';
import { conceptContributions } from './concepts';
import { allSpaces } from './spaces';
import { viewer } from './people';
import type { Role } from '../types';

/**
 * Likes and stars, writable.
 *
 * Both buttons rendered enabled, carried `aria-pressed`, and announced "Tap to
 * remove" — and had no handler at all. A control that announces a state change
 * to a screen reader and then does not change it is worse than a disabled one.
 *
 * **Like is for contributions; Star is for whole Spaces.** They never cross,
 * which is why this file keeps two separate sets rather than one keyed by a
 * generic id — a single map would make the mistake typo-sized.
 *
 * Neither grants XP. Doc 1 rule 7: likes and stars are *content signals*, and
 * a second progression bolted beside XP is exactly what the rule forbids. The
 * counts here move; nobody's rank does.
 */

const seedLiked = () =>
  new Set(
    [...normalizationContributions, ...spaceContributions, ...conceptContributions]
      .filter((c) => c.likedByViewer)
      .map((c) => c.id),
  );

const seedStarred = () => new Set(allSpaces.filter((s) => s.starredByViewer).map((s) => s.id));

const seedLikeCounts = () =>
  new Map(
    [...normalizationContributions, ...spaceContributions, ...conceptContributions].map((c) => [
      c.id,
      c.likeCount,
    ]),
  );

const seedStarCounts = () => new Map(allSpaces.map((s) => [s.id, s.starCount]));

let liked = seedLiked();
let starred = seedStarred();
let likeCounts = seedLikeCounts();
let starCounts = seedStarCounts();

/** Test seam — these are mutable, so each test starts from the fixtures. */
export const resetEngagement = (): void => {
  liked = seedLiked();
  starred = seedStarred();
  likeCounts = seedLikeCounts();
  starCounts = seedStarCounts();
};

/* ── Likes: contributions only ─────────────────────────────────── */

export const isLiked = (contributionId: string): boolean => liked.has(contributionId);

export const likeCount = (contributionId: string): number => likeCounts.get(contributionId) ?? 0;

/**
 * One tap, unlimited, and never on your own work.
 *
 * The author check lives here rather than only in the component, because
 * "you cannot like your own contribution" (Engagement, rule 3) is a rule about
 * the data, and a second call site would otherwise have to remember it.
 */
export const toggleLike = (contributionId: string, authorId: string): boolean => {
  if (authorId === viewer.id) return isLiked(contributionId);
  const now = !liked.has(contributionId);
  if (now) liked.add(contributionId);
  else liked.delete(contributionId);
  likeCounts.set(contributionId, Math.max(0, likeCount(contributionId) + (now ? 1 : -1)));
  return now;
};

/* ── Stars: whole Spaces only ──────────────────────────────────── */

export const isStarred = (spaceId: string): boolean => starred.has(spaceId);

export const starCount = (spaceId: string): number => starCounts.get(spaceId) ?? 0;

/** Starring your own Space is meaningless, so it is refused rather than hidden. */
export const toggleStar = (spaceId: string, viewerOwns: boolean): boolean => {
  if (viewerOwns) return isStarred(spaceId);
  const now = !starred.has(spaceId);
  if (now) starred.add(spaceId);
  else starred.delete(spaceId);
  starCounts.set(spaceId, Math.max(0, starCount(spaceId) + (now ? 1 : -1)));
  return now;
};

/* ── Visibility of hidden work ─────────────────────────────────── */

/**
 * Who may see a hidden contribution.
 *
 * Doc 1 states the rule twice — "Owner hid it. Visible to its author and the
 * Owner/Editors only" — and five call sites implemented it as an unconditional
 * `!c.hidden`. So there was no code path at all by which an author could see
 * their own hidden work: it simply vanished, which is the one thing the rule
 * exists to prevent.
 *
 * Takes the viewer's role so the question cannot be asked without establishing
 * who is asking — the same shape as `visibleLessonsForSpace`, and for the same
 * reason: a filter that takes no viewer will be reached for by a call site
 * that has no viewer.
 */
export const canSeeHidden = (
  authorId: string,
  viewerRole: Role | null,
  viewerId: string,
): boolean => authorId === viewerId || viewerRole === 'owner' || viewerRole === 'editor';

/** Filter a community section for one viewer. */
export const visibleContributions = <T extends { hidden: boolean; author: { id: string } }>(
  list: T[],
  viewerRole: Role | null,
): T[] => list.filter((c) => !c.hidden || canSeeHidden(c.author.id, viewerRole, viewer.id));
