import { beforeEach, describe, expect, it } from 'vitest';
import {
  canEndorse,
  canModerate,
  canReport,
  isEndorsed,
  isHidden,
  isPromoted,
  isReported,
  promote,
  report,
  resetModeration,
  toggleEndorse,
  toggleHidden,
} from '../moderation';
import { visibleContributions } from '../engagement';
import { normalizationContributions, spaceContributions } from '../contributions';
import { lessonsForSpace, resetAddedLessons } from '../lessons';
import { spaceById } from '../spaces';
import { viewer } from '../people';

/**
 * The Owner's three acts, and the Member's one.
 *
 * Doc 1 rule 4 lists what stands in for a moderation team: origin badges,
 * likes, engagement-gated XP, **a report button** and **the Owner's right to
 * hide** — plus endorse and promote from rule 3 and the promotion bridge.
 * All of it rendered as state and none of it was doable: `endorsed`, `hidden`
 * and `orphaned` came from fixtures and nothing in the product could produce
 * them.
 *
 * Exercised rather than merely written. `resetEngagement` and `resetSocial`
 * spent a whole session labelled "test seam" while being called nowhere, so
 * every store in this namespace now has a file that actually drives it.
 */

beforeEach(() => {
  resetModeration();
  resetAddedLessons();
});

const someoneElses = normalizationContributions.find((c) => c.author.id !== viewer.id)!;
const mine = normalizationContributions.find((c) => c.author.id === viewer.id)!;
/*
 * Promotion's origin depends on the *author's role*, and the fixtures contain
 * both cases — so the tests below need to name which one they mean rather than
 * taking whatever comes first. Åsa is an Editor of Database Systems and Chidi
 * is a Member, which is exactly the distinction.
 */
const byAMember = normalizationContributions.find((c) => c.author.id === 'p-okonkwo')!;
const byAnEditor = normalizationContributions.find((c) => c.author.id === 'p-lindqvist')!;

describe('only the people who run a Space may moderate it', () => {
  it('lets the Owner and Editors', () => {
    expect(canModerate('owner')).toBe(true);
    expect(canModerate('editor')).toBe(true);
  });

  it('refuses a Member and a stranger', () => {
    expect(canModerate('member')).toBe(false);
    expect(canModerate(null)).toBe(false);
  });

  it('refuses the acts themselves, not just the buttons', () => {
    /*
     * The check lives in the store, so a second call site cannot forget it.
     * A permission enforced only by hiding a control is a permission that
     * holds until somebody adds another way in.
     */
    toggleEndorse(someoneElses, 'member');
    expect(isEndorsed(someoneElses.id)).toBe(someoneElses.endorsed);
    toggleHidden(someoneElses, null);
    expect(isHidden(someoneElses.id)).toBe(someoneElses.hidden);
    const space = spaceById('s-dbs')!;
    expect(promote(someoneElses, space, 'member')).toBeNull();
  });
});

describe('endorsing', () => {
  it('marks it and unmarks it', () => {
    const before = isEndorsed(someoneElses.id);
    toggleEndorse(someoneElses, 'owner');
    expect(isEndorsed(someoneElses.id)).toBe(!before);
    toggleEndorse(someoneElses, 'owner');
    expect(isEndorsed(someoneElses.id)).toBe(before);
  });

  it('leaves it in the community section', () => {
    // "Endorsed = a checkmark, still community-authored, still in the
    // community section." Endorsing vouches; it does not absorb.
    toggleEndorse(someoneElses, 'owner');
    const shown = visibleContributions(normalizationContributions, 'owner');
    expect(shown.map((c) => c.id)).toContain(someoneElses.id);
  });

  it('refuses your own work', () => {
    /*
     * Not stated in Doc 1, and it follows from rule 2: XP is granted when a
     * contribution is endorsed, so self-endorsement is a button that prints
     * points. The same reasoning already forbids liking your own work.
     */
    expect(canEndorse(mine, 'owner')).toBe(false);
    toggleEndorse(mine, 'owner');
    expect(isEndorsed(mine.id)).toBe(mine.endorsed);
  });
});

describe('hiding', () => {
  const visible = normalizationContributions.find((c) => !c.hidden && c.author.id !== viewer.id)!;

  it('takes it away from Members', () => {
    toggleHidden(visible, 'owner');
    expect(visibleContributions(normalizationContributions, 'member').map((c) => c.id)).not.toContain(
      visible.id,
    );
  });

  it('leaves it visible to the Owner and to its author', () => {
    // Doc 1's never-vanish pattern. Hidden is not deleted.
    toggleHidden(visible, 'owner');
    expect(visibleContributions(normalizationContributions, 'owner').map((c) => c.id)).toContain(
      visible.id,
    );
    toggleHidden(mine, 'owner');
    expect(visibleContributions(normalizationContributions, 'member').map((c) => c.id)).toContain(
      mine.id,
    );
  });

  it('is reversible', () => {
    toggleHidden(visible, 'owner');
    toggleHidden(visible, 'owner');
    expect(isHidden(visible.id)).toBe(false);
  });
});

describe('promoting moves it into the path, credit and all', () => {
  const space = () => spaceById('s-dbs')!;

  it('creates a Lesson', () => {
    const before = lessonsForSpace('s-dbs').length;
    const id = promote(someoneElses, space(), 'owner');
    expect(id).toBeTruthy();
    expect(lessonsForSpace('s-dbs')).toHaveLength(before + 1);
  });

  it('credits the contributor, not the Owner who promoted it', () => {
    /*
     * "Promoted = it moved into the path, and the author's credit moves with
     * it." This is the clause an implementation is most likely to get wrong,
     * because the Owner is the one pressing the button.
     */
    const id = promote(someoneElses, space(), 'owner')!;
    const made = lessonsForSpace('s-dbs').find((l) => l.id === id)!;
    expect(made.author.id).toBe(someoneElses.author.id);
    expect(made.author.id).not.toBe(space().owner.id);
  });

  it("makes a Community Lesson from a Member's work, even in a Guided Space", () => {
    // The state a fixture comment called impossible until Abi ruled otherwise
    // on 2026-08-31. Promotion is the mechanism that produces it, so this is
    // the rule being exercised rather than asserted.
    expect(space().mode).toBe('guided');
    const id = promote(byAMember, space(), 'owner')!;
    const made = lessonsForSpace('s-dbs').find((l) => l.id === id)!;
    expect(made.origin).toBe('community');
    expect(made.author.id).toBe(byAMember.author.id);
  });

  it("makes an Official Lesson from an Editor's work", () => {
    /*
     * A distinction the first version of this file missed. It promoted
     * whichever contribution came first — Åsa's, and Åsa is an Editor of
     * Database Systems — and then asserted the result was Community, which
     * failed for the right reason.
     *
     * Doc 1 defines Official as Owner/Editors, so promoting an Editor's
     * contribution *should* produce an Official Lesson. Origin follows the
     * author's standing in the Space, not the act of promoting.
     */
    const id = promote(byAnEditor, space(), 'owner')!;
    const made = lessonsForSpace('s-dbs').find((l) => l.id === id)!;
    expect(made.origin).toBe('official');
    expect(made.author.id).toBe(byAnEditor.author.id);
  });

  it('takes it out of the community section', () => {
    // It moved. Two copies of one object on one screen is worse than either.
    promote(someoneElses, space(), 'owner');
    expect(
      visibleContributions(normalizationContributions, 'owner').map((c) => c.id),
    ).not.toContain(someoneElses.id);
  });

  it('cannot happen twice', () => {
    promote(someoneElses, space(), 'owner');
    const before = lessonsForSpace('s-dbs').length;
    expect(promote(someoneElses, space(), 'owner')).toBeNull();
    expect(lessonsForSpace('s-dbs')).toHaveLength(before);
    expect(isPromoted(someoneElses.id)).toBe(true);
  });
});

describe('reporting', () => {
  it('records it', () => {
    expect(report(someoneElses)).toBe(true);
    expect(isReported(someoneElses.id)).toBe(true);
  });

  it('refuses your own work', () => {
    expect(canReport(mine)).toBe(false);
    expect(report(mine)).toBe(false);
    expect(isReported(mine.id)).toBe(false);
  });

  it('changes nothing else — it is a flag, not an act', () => {
    // NEEDS-BACKEND: there is no queue and no reviewer. Reporting must not
    // quietly hide something; that would be a moderation decision taken by
    // whoever complained first.
    report(someoneElses);
    expect(isHidden(someoneElses.id)).toBe(someoneElses.hidden);
    expect(visibleContributions(normalizationContributions, 'member').map((c) => c.id)).toContain(
      someoneElses.id,
    );
  });
});

describe('the reset seam works', () => {
  it('puts every flag back', () => {
    toggleEndorse(someoneElses, 'owner');
    toggleHidden(someoneElses, 'owner');
    report(someoneElses);
    promote(spaceContributions[0], spaceById('s-dbs')!, 'owner');
    resetModeration();
    expect(isEndorsed(someoneElses.id)).toBe(someoneElses.endorsed);
    expect(isHidden(someoneElses.id)).toBe(someoneElses.hidden);
    expect(isReported(someoneElses.id)).toBe(false);
    expect(isPromoted(spaceContributions[0].id)).toBe(false);
  });
});
