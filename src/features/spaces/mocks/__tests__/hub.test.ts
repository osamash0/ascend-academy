import { describe, expect, it } from 'vitest';
import {
  actionFor,
  hubInitialSelection,
  hubSelectionOrder,
  jumpBackIn,
  membershipOf,
  myHubSpaces,
  newThisWeek,
  popularNow,
  spaceOfTheWeek,
} from '../hub';
import { allSpaces } from '../spaces';
import { coverFor, COVERS, SLATE_COVER } from '../covers';
import { publishedLessonsForSpace } from '../lessons';

/**
 * The Spaces hub, against `docs/SPACES-HUB-HANDOFF.md`.
 *
 * The spec's central claim is a *negative* one — "membership is a property of a
 * card, never a section split" — and a negative is exactly what drifts back
 * without a guard. Most of this file exists to keep the joined/unjoined split
 * from reappearing as a filter somebody adds for convenience.
 */

describe('membership is a badge, never a section', () => {
  it('mixes joined and unjoined in "Popular right now"', () => {
    /*
     * The rail where the concept earns its keep. If this ever contains only
     * one kind, the tabs have come back wearing a different name.
     */
    const popular = popularNow();
    expect(popular.length).toBeGreaterThan(1);
    expect(popular.some((s) => s.viewerRole !== null)).toBe(true);
    expect(popular.some((s) => s.viewerRole === null)).toBe(true);
  });

  it('never sorts by membership', () => {
    // Sorted by stars, so a joined Space must be able to sit below an unjoined
    // one. Grouping by membership is the split by another route.
    const popular = popularNow();
    const stars = popular.map((s) => s.starCount);
    expect([...stars].sort((a, b) => b - a)).toEqual(stars);
  });
});

describe('the hero has one button with four states', () => {
  it('says Enter for a Space you are in', () => {
    const mine = allSpaces.find((s) => s.viewerRole !== null)!;
    expect(actionFor(membershipOf(mine))).toEqual({ label: 'Enter', disabled: false });
  });

  it('says Join for a public Space you are not in', () => {
    const open = allSpaces.find((s) => s.viewerRole === null && s.visibility === 'public')!;
    expect(actionFor(membershipOf(open)).label).toBe('Join');
  });

  it('says Request access for a private Space you are not in', () => {
    const shut = allSpaces.find(
      (s) => s.viewerRole === null && s.visibility !== 'public' && !s.viewerRequested,
    );
    expect(shut, 'no private-not-mine fixture — this state would be unreachable').toBeDefined();
    expect(actionFor(membershipOf(shut!)).label).toBe('Request access');
  });

  it('says Requested, disabled, once you have asked', () => {
    /*
     * The state `viewerRole` alone cannot express: a private Space you have
     * requested looked identical to one you had not, so the button offered
     * "Request access" to somebody who already had.
     */
    const waiting = allSpaces.find((s) => s.viewerRequested);
    expect(waiting, 'no pending fixture — the fourth state could never render').toBeDefined();
    expect(actionFor(membershipOf(waiting!))).toEqual({ label: 'Requested', disabled: true });
  });

  it('covers every state the spec lists, and no others', () => {
    const labels = allSpaces.map((s) => actionFor(membershipOf(s)).label);
    expect(new Set(labels)).toEqual(new Set(['Enter', 'Join', 'Request access', 'Requested']));
  });
});

describe('covers are stable and load-bearing', () => {
  it('gives the same Space the same gradient every time', () => {
    // "Same space = same gradient always." The console's `gradientFor(index)`
    // keys on a list position, so sorting changed a Space's colour.
    for (const s of allSpaces) expect(coverFor(s.id)).toBe(coverFor(s.id));
  });

  it('does not depend on list order', () => {
    const forward = allSpaces.map((s) => coverFor(s.id));
    const backward = [...allSpaces].reverse().map((s) => coverFor(s.id));
    expect(backward.reverse()).toEqual(forward);
  });

  it('always resolves to one of the palette', () => {
    const palette = Object.values(COVERS);
    for (const s of allSpaces) expect(palette).toContain(coverFor(s.id));
  });

  it('keeps the neutral one out of the hash', () => {
    // Slate belongs to Discover, which is not a Space. A Space landing on it
    // would read as the utility chip.
    for (const s of allSpaces) expect(coverFor(s.id)).not.toBe(SLATE_COVER);
  });

  it('spreads across the palette rather than collapsing', () => {
    // A hash that returns two colours for nine Spaces is not a hash.
    const used = new Set(allSpaces.map((s) => coverFor(s.id)));
    expect(used.size).toBeGreaterThan(3);
  });
});

describe('empty rails are not rendered', () => {
  it('only offers "Jump back in" for Spaces with a path to return to', () => {
    for (const s of jumpBackIn()) {
      expect(s.viewerRole).not.toBeNull();
      expect(publishedLessonsForSpace(s.id).length).toBeGreaterThan(0);
    }
  });

  it('features only a Space you could actually join', () => {
    // A banner carries an inline Join, and a banner you cannot act on is an
    // advertisement.
    const featured = spaceOfTheWeek();
    expect(featured).not.toBeNull();
    expect(featured!.viewerRole).toBeNull();
    expect(featured!.visibility).toBe('public');
  });

  it('offers only unjoined Spaces under "New this week"', () => {
    for (const s of newThisWeek()) expect(s.viewerRole).toBeNull();
  });
});

describe('the chip row', () => {
  it('holds only Spaces you are in', () => {
    for (const s of myHubSpaces()) expect(s.viewerRole).not.toBeNull();
  });

  it('leaves out archived Spaces', () => {
    // Archived is read-only and earns no XP; it is not somewhere to jump into.
    for (const s of myHubSpaces()) expect(s.state).toBe('active');
  });

  it('puts Discover last, always', () => {
    const order = hubSelectionOrder();
    expect(order[order.length - 1]).toBe('discover');
    expect(order.filter((id) => id === 'discover')).toHaveLength(1);
  });

  it('starts on one of the things it can select', () => {
    expect(hubSelectionOrder()).toContain(hubInitialSelection());
  });
});

describe('the standard card can show both of its badges', () => {
  it('puts a joined Space and an invite-only one in the same rail', () => {
    /*
     * The spec draws a "check/lock badge" on this rail, so both must be
     * reachable. Filtering "Popular" to public-only made the lock unreachable
     * — a badge with no data path, which is the failure this whole suite keeps
     * finding.
     */
    const popular = popularNow();
    expect(popular.some((s) => s.viewerRole !== null), 'no member → no check badge').toBe(true);
    expect(popular.some((s) => s.visibility === 'invite'), 'no invite → no lock badge').toBe(true);
  });

  it('never surfaces a fully private Space', () => {
    // `invite` is discoverable and asks for a request; `private` is not
    // discoverable at all. Listing one would leak its existence.
    for (const s of popularNow()) expect(s.visibility).not.toBe('private');
    for (const s of newThisWeek()) expect(s.visibility).toBe('public');
  });
});
