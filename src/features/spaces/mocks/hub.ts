import type { Space } from '../types';
import { allSpaces, visibleSpaces } from './spaces';
import { publishedLessonsForSpace } from './lessons';

/**
 * The Spaces hub — what each rail holds, and what the hero's one button says.
 *
 * The page logic from the handoff is *chip row selects → hero reacts → rails
 * discover*, and the concept note is blunt about the thing that shapes every
 * function here: **membership is a property of a card, never a section split.**
 * So nothing below groups by joined-versus-not. `popular` deliberately mixes
 * them, exactly as the spec asks.
 */

/**
 * The four states the hero's single button can be in.
 *
 * One button, four sentences — the spec's list, in order: member → Enter,
 * public and not a member → Join, private and not a member → Request access,
 * already asked → Requested and disabled.
 *
 * A function rather than a field, because it is derivable from three things
 * the Space already knows. Storing it would make a fifth place that can
 * disagree with `viewerRole`.
 */
export type Membership = 'member' | 'joinable' | 'request' | 'pending';

export const membershipOf = (space: Space): Membership => {
  if (space.viewerRole !== null) return 'member';
  if (space.viewerRequested) return 'pending';
  return space.visibility === 'public' ? 'joinable' : 'request';
};

/** What the button says, and whether it can be pressed. */
export const actionFor = (m: Membership): { label: string; disabled: boolean } => {
  switch (m) {
    case 'member':
      return { label: 'Enter', disabled: false };
    case 'joinable':
      return { label: 'Join', disabled: false };
    case 'request':
      return { label: 'Request access', disabled: false };
    case 'pending':
      // Disabled and saying why, rather than absent: the state *is* the answer.
      return { label: 'Requested', disabled: true };
  }
};

/* ── The chip row ──────────────────────────────────────────────── */

/**
 * Your Spaces, pinned to the bottom of the hero.
 *
 * `visibleSpaces()`, so a Space created this session appears here — the same
 * reason ⌘K had to stop reading the frozen fixture array.
 *
 * A new account gets an empty list on purpose. The spec's empty case is that
 * the row shows only Discover and the hero features a Space to join, which is
 * a state the page must render rather than a case to guard against.
 */
export const myHubSpaces = (): Space[] =>
  visibleSpaces().filter((s) => s.viewerRole !== null && s.state === 'active');

/* ── The rails ─────────────────────────────────────────────────── */

/**
 * "Jump back in" — Spaces you are in, most recently active first.
 *
 * Only ones with something to return *to*: a Space whose path is empty has no
 * "back in" to jump to, and the rail's wide cards are mostly cover art with a
 * line of activity under the name.
 */
export const jumpBackIn = (): Space[] =>
  myHubSpaces()
    .filter((s) => publishedLessonsForSpace(s.id).length > 0)
    .sort((a, b) => +new Date(b.lastActiveAt) - +new Date(a.lastActiveAt));

/**
 * "Space of the week" — one banner.
 *
 * The most-starred public Space the viewer has *not* joined, because the
 * banner carries an inline Join and a banner you cannot act on is an
 * advertisement. Returns null when there is nothing to feature, and the rail
 * is then not rendered at all — empty rails are not rendered.
 */
export const spaceOfTheWeek = (): Space | null =>
  visibleSpaces()
    .filter((s) => s.viewerRole === null && s.visibility === 'public')
    .sort((a, b) => b.starCount - a.starCount)[0] ?? null;

/**
 * "Popular right now" — mixes joined and unjoined freely.
 *
 * The one rail where the concept note is doing visible work: a Space you are
 * in sits next to one you are not, and the only difference is a badge. Sorted
 * by stars, which is the signal Doc 1 gives for ranking Spaces.
 */
export const popularNow = (): Space[] =>
  visibleSpaces()
    /*
     * Public *and* invite-only, which is the distinction the three-value
     * `Visibility` exists to draw: `invite` is discoverable and asks for a
     * request, `private` is not discoverable at all.
     *
     * Filtering to `public` alone made the standard card's **lock badge
     * unreachable** — the spec draws one in this very rail ("check/lock
     * badge"), and the mock's `explore` list carries a locked "Founders
     * Circle". A badge with no data path is a badge that has never rendered.
     */
    .filter((s) => s.visibility !== 'private' && s.state === 'active')
    .sort((a, b) => b.starCount - a.starCount);

/**
 * "New this week" — the compact grid, with an inline Join.
 *
 * Newest by last activity among Spaces you have not joined. These are the
 * small ones by design: a 300px row with a 56px cover is the right shape for
 * something you are deciding about in half a second.
 */
export const newThisWeek = (): Space[] =>
  visibleSpaces()
    .filter((s) => s.viewerRole === null && s.visibility === 'public')
    .sort((a, b) => +new Date(b.lastActiveAt) - +new Date(a.lastActiveAt));

/**
 * "Worth a look" — the Discover scope: every Space you are not in.
 *
 * The spec already states this for a brand-new account — "rails = discover
 * content only" — and the Discover chip is that same scope, chosen on purpose
 * rather than arrived at by having joined nothing. Selecting it used to change
 * the hero copy and the cover art and nothing else: the rails underneath went
 * on showing "Jump back in", which is the exact opposite of discovering.
 *
 * **One rail, mixed visibility.** Public and invite-only sit together and the
 * card carries the lock, for the same reason `popularNow` mixes joined and
 * unjoined: the concept note's law is that membership is a property of a card,
 * never a section split, and visibility is no different. Splitting "join in one
 * click" from "ask first" into two rails would reintroduce exactly the sorting
 * the hub deleted the Mine/Discover tabs to avoid.
 *
 * `private` is excluded because it is not discoverable at all — that is what
 * the third `Visibility` value means.
 */
export const worthALook = (): Space[] =>
  visibleSpaces()
    .filter((s) => s.viewerRole === null && s.visibility !== 'private' && s.state === 'active')
    .sort((a, b) => b.starCount - a.starCount);

/** Whether the hub has anything at all to show. Used for the empty state. */
export const hubHasContent = (): boolean =>
  jumpBackIn().length > 0 || popularNow().length > 0 || newThisWeek().length > 0;

/** Every Space the hub can select, in chip order, Discover last. */
export const hubSelectionOrder = (): string[] => [...myHubSpaces().map((s) => s.id), 'discover'];

/**
 * The Space the hero shows when nothing is selected yet.
 *
 * Your first Space if you have one; otherwise the featured Space, so a new
 * account lands on something joinable rather than on an empty stage.
 */
export const hubInitialSelection = (): string => {
  const mine = myHubSpaces();
  if (mine.length > 0) return mine[0].id;
  const featured = spaceOfTheWeek();
  return featured ? featured.id : 'discover';
};

/** Any Space the hero might show, whether or not you are a member. */
export const hubSpaceById = (id: string): Space | undefined =>
  visibleSpaces().find((s) => s.id === id) ?? allSpaces.find((s) => s.id === id);
