import { libraryItems } from './library';
import { createdByViewer } from './spaces';
import { xpEvents, type XpSource } from './rank';

/**
 * Moments — the first time each thing happened to you.
 *
 * ## Why this is not a badge screen
 *
 * Abi's call, and the docs are unusually clear once you look. Every "badge" in
 * `docs/design-v4` means a **label on content**: origin badges (Official /
 * Community), the "new" badge, the Guided/Open badge. Not one of them means an
 * achievement earned by a person. `components/badges.tsx` exports exactly that
 * sense — `OriginBadge`, `ModeBadge`, `VisibilityBadge`, `EndorsedBadge` —
 * one directory from a `badges` fixture that meant something else entirely.
 * Doc 1 rule 7 is "One word, one meaning (locked)", and the docs' own
 * `notes-spaces-screen.md` says it plainly: "badge must mean exactly one
 * thing. Otherwise remove."
 *
 * The achievement set broke two more rules besides the word:
 *
 *   • Profile rendered `3/6`, a completion score on the Ascent profile.
 *     Rule 4: ranks and that profile "read from XP only … they don't have a
 *     second progression bolted on."
 *   • "Well received — Get 25 likes on your work" hung a reward off a like
 *     count, which is the same rule again, and dangled precisely the goal that
 *     rule 3's anti-farming clauses exist to suppress.
 *   • "Contributor — Published your first contribution" rewarded posting.
 *     Rule 2 is explicit: "Reward reception, not production, or you get spam
 *     within a week." The sanctioned form of that milestone is XP, and it
 *     already exists in the ledger — so it was one event paid twice, in two
 *     currencies.
 *
 * And "Four in a row" rewarded run length, which is the thing the study
 * history screen was deliberately built not to do. Keeping it as a badge would
 * have contradicted a decision made the same afternoon.
 *
 * ## What is left, and why it is safe
 *
 * A moment is a **fact with a date**. It grants nothing, cannot be lost, has
 * no total and no locked siblings dangled in front of you. There is nothing to
 * complete, so there is no second progression — the same reasoning that let
 * study history exist.
 *
 * Every one is derived from a record that already exists. Nothing here is a
 * fixture of its own, because a hand-written "first" is a claim, and claims
 * drift: the ledger already said your first contribution was 14 June while the
 * contribution itself was dated 2 June.
 */

export interface Moment {
  id: string;
  title: string;
  /** What actually happened, named. */
  detail: string;
  /**
   * When — or `null` where the record genuinely does not know.
   *
   * Nullable on purpose. Spaces carry no creation date, so the Space you made
   * has no day attached, and inventing one would be the orphan row's
   * fabricated `'s-dbs'` all over again. The screen renders it without a date.
   */
  at: string | null;
}

/** The earliest XP event of a given kind, or `null` if it never happened. */
const firstBySource = (source: XpSource) =>
  [...xpEvents].filter((e) => e.source === source).sort((a, b) => a.at.localeCompare(b.at))[0] ??
  null;

/**
 * The day of your first contribution, from the contribution itself.
 *
 * Read off `libraryItems()` rather than the ledger's milestone event, because
 * the contribution is the thing that happened and the XP is a consequence of
 * it. When the two disagreed, this was the one telling the truth.
 */
export const firstContributionAt = (): string | null => {
  const dates = libraryItems()
    .filter((i) => i.kind === 'contribution')
    .map((i) => i.updatedAt)
    .sort();
  return dates[0] ?? null;
};

/**
 * Your moments, oldest first.
 *
 * Oldest first because this reads as a history: the point is the distance
 * travelled, and a list that starts with the most recent thing hides it.
 */
export const moments = (): Moment[] => {
  const out: Moment[] = [];

  const firstLearning = firstBySource('learning');
  if (firstLearning) {
    out.push({
      id: 'm-lesson',
      title: 'Your first Lesson',
      // A sentence, with the stop. The label is a log line ("Finished …");
      // a moment is something you read.
      detail: `${firstLearning.label.replace(/^Finished\s+/, 'You finished ')}.`,
      at: firstLearning.at,
    });
  }

  const firstContribution = firstContributionAt();
  if (firstContribution) {
    const item = libraryItems()
      .filter((i) => i.kind === 'contribution')
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
    out.push({
      id: 'm-contribution',
      title: 'Your first contribution',
      detail: `You published “${item.title}”.`,
      at: firstContribution,
    });
  }

  const firstLiked = firstBySource('liked');
  if (firstLiked) {
    out.push({
      id: 'm-liked',
      title: 'Someone found your work useful',
      detail: firstLiked.label.replace(/ was liked$/, ' was liked by another member.'),
      at: firstLiked.at,
    });
  }

  const firstEndorsed = firstBySource('endorsed');
  if (firstEndorsed) {
    out.push({
      id: 'm-endorsed',
      title: 'An Owner endorsed your work',
      detail: `${firstEndorsed.label}.`,
      at: firstEndorsed.at,
    });
  }

  const firstUsed = firstBySource('used');
  if (firstUsed) {
    out.push({
      id: 'm-used',
      title: 'Someone learned from what you made',
      detail: `${firstUsed.label}.`,
      at: firstUsed.at,
    });
  }

  const mine = createdByViewer[0];
  if (mine) {
    out.push({
      id: 'm-space',
      title: 'You made a Space',
      detail: `You created “${mine.name}”.`,
      // No Space carries a creation date. Undated beats invented.
      at: null,
    });
  }

  return out.sort((a, b) => {
    // Undated moments last — they have no place in the sequence, and guessing
    // one would be stating something the record does not know.
    if (a.at === null) return 1;
    if (b.at === null) return -1;
    return a.at.localeCompare(b.at);
  });
};
