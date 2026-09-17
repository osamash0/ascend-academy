import type { Contribution, Role, Space } from '../types';
import { normalizationContributions, spaceContributions } from './contributions';
import { conceptContributions } from './concepts';
import { addLesson } from './lessons';
import { viewer } from './people';

/**
 * What an Owner can do about a contribution, and what a Member can do.
 *
 * Doc 1 rules 1–4 define the whole of quality control without a moderation
 * team: **origin badges** (trust), **likes** (sorting), **engagement-gated XP**
 * (incentive), **a report button**, and **the Owner's right to hide**. Plus the
 * two acts that make the community section worth having at all —
 *
 *   • **Endorse** — "a checkmark, still community-authored, still in the
 *     community section". It vouches; it does not absorb.
 *   • **Promote** — "it moved into the path, and the author's credit moves with
 *     it". This is the bridge between Guided and Open: an Open Space can grow a
 *     source of truth, a Guided one can absorb the best member work.
 *
 * None of it existed. `endorsed`, `hidden` and `orphaned` rendered from
 * fixtures and nothing in the product could produce any of them — so three
 * documented Owner powers and one Member power were badges with no verbs.
 *
 * **Promotion is also what makes a Community-origin Lesson appear inside a
 * Guided Space** — the thing a fixture comment called impossible until Abi
 * ruled otherwise on 2026-08-31. Building it closes that loop: the state is no
 * longer something a fixture asserts, it is something the product does.
 *
 * No XP is granted here. Doc 1 gates XP on likes, endorsements and use, but
 * awards it from the engine — a mock that hands out points would be inventing
 * a progression rule.
 */

const everyContribution = (): Contribution[] => [
  ...normalizationContributions,
  ...spaceContributions,
  ...conceptContributions,
];

const seedEndorsed = () =>
  new Set(everyContribution().filter((c) => c.endorsed).map((c) => c.id));
const seedHidden = () => new Set(everyContribution().filter((c) => c.hidden).map((c) => c.id));

let endorsedIds = seedEndorsed();
let hiddenIds = seedHidden();
/** Contributions that have left the section for the path. */
let promotedIds = new Set<string>();
let reportedIds = new Set<string>();

/** Test seam. Exercised by `moderation.test.ts` — see `stores.test.ts` for why. */
export const resetModeration = (): void => {
  endorsedIds = seedEndorsed();
  hiddenIds = seedHidden();
  promotedIds = new Set();
  reportedIds = new Set();
};

/* ── Who may do what ───────────────────────────────────────────── */

/**
 * Endorsing, hiding and promoting are the Owner's and Editors' acts.
 *
 * Takes the role rather than a boolean, so a caller cannot ask the question
 * without having established who is asking — the shape that
 * `visibleLessonsForSpace` and `canSeeHidden` both settled on after a rule
 * living in one place got bypassed by three screens that did not look there.
 */
export const canModerate = (role: Role | null): boolean =>
  role === 'owner' || role === 'editor';

/**
 * You cannot endorse your own work.
 *
 * Not stated in Doc 1, and it follows from rule 2: XP is granted when a
 * contribution is endorsed. Self-endorsement would be a button that prints
 * points — the same reasoning that already forbids liking your own work.
 */
export const canEndorse = (c: Contribution, role: Role | null): boolean =>
  canModerate(role) && c.author.id !== viewer.id;

/** Anyone can report anything except their own work. */
export const canReport = (c: Contribution): boolean => c.author.id !== viewer.id;

/* ── State ─────────────────────────────────────────────────────── */

export const isEndorsed = (id: string): boolean => endorsedIds.has(id);
export const isHidden = (id: string): boolean => hiddenIds.has(id);
export const isPromoted = (id: string): boolean => promotedIds.has(id);
export const isReported = (id: string): boolean => reportedIds.has(id);

/* ── The acts ──────────────────────────────────────────────────── */

/** Vouch for it. It stays community-authored and stays in the section. */
export const toggleEndorse = (c: Contribution, role: Role | null): boolean => {
  if (!canEndorse(c, role)) return isEndorsed(c.id);
  const now = !endorsedIds.has(c.id);
  if (now) endorsedIds.add(c.id);
  else endorsedIds.delete(c.id);
  return now;
};

/**
 * Hide it. Reversible, and never a deletion.
 *
 * Hidden is not gone: it stays visible to its author and to the Owner/Editors,
 * which is what `canSeeHidden` enforces. Doc 1's never-vanish pattern — the
 * same reason an orphaned contribution keeps its place.
 */
export const toggleHidden = (c: Contribution, role: Role | null): boolean => {
  if (!canModerate(role)) return isHidden(c.id);
  const now = !hiddenIds.has(c.id);
  if (now) hiddenIds.add(c.id);
  else hiddenIds.delete(c.id);
  return now;
};

/**
 * Move it into the path, credit and all.
 *
 * One-way on purpose. Doc 1 describes promotion as the contribution *moving*
 * into the path, so it leaves the community section and becomes a Lesson —
 * Community origin, authored by whoever wrote the contribution, not by the
 * Owner who promoted it. "The author's credit moves with it" is the clause
 * that matters, and it is the one an implementation would be most tempted to
 * get wrong.
 *
 * Returns the new Lesson's id so the caller can offer to open it.
 */
export const promote = (
  c: Contribution,
  space: Space,
  role: Role | null,
): string | null => {
  if (!canModerate(role) || promotedIds.has(c.id)) return null;
  // Credit follows the work, so the Lesson is authored by the contributor.
  const lesson = addLesson(space.id, c.title, c.author);
  promotedIds.add(c.id);
  return lesson.id;
};

/**
 * Report it.
 *
 * NEEDS-BACKEND: there is no queue for this to land in, and no notion of who
 * reviews it. The button exists because Doc 1 rule 4 lists it as one of the
 * five things standing in for a moderation team — but what it does after the
 * acknowledgement is a decision nobody has made, so it is recorded and says so
 * rather than implying an outcome.
 */
export const report = (c: Contribution): boolean => {
  if (!canReport(c)) return false;
  reportedIds.add(c.id);
  return true;
};
