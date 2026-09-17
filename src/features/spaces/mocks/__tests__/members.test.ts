import { describe, expect, it } from 'vitest';
import { allSpaces } from '../spaces';
import { membersForSpace } from '../contributions';
import { viewer } from '../people';

/**
 * The Members tab, against the fixtures.
 *
 * `membersForSpace` returned `[]` for everything but Database Systems, and the
 * tab had no empty branch — so six of the seven Spaces rendered
 * "1,204 Members", an empty list, and "Showing 0 of 1,204". Nothing failed;
 * the screen just told you three contradictory things at once.
 */

describe('every Space you are in can show you its members', () => {
  it('has a member list for every joined Space', () => {
    for (const s of allSpaces) {
      if (s.viewerRole === null) continue;
      expect(
        membersForSpace(s.id).length,
        `${s.id}: you are a ${s.viewerRole} and it has no members to show`,
      ).toBeGreaterThan(0);
    }
  });

  it('lists you in every Space you are in, with the role the Space claims', () => {
    for (const s of allSpaces) {
      if (s.viewerRole === null) continue;
      const mine = membersForSpace(s.id).find((m) => m.person.id === viewer.id);
      expect(mine, `${s.id} does not list you`).toBeDefined();
      // Two sources for one fact: `space.viewerRole` and the membership row.
      expect(mine?.role, `${s.id} disagrees about your role`).toBe(s.viewerRole);
    }
  });

  it('gives every member list exactly one Owner', () => {
    // A Space without an Owner is not a state the model allows; two Owners is
    // not either — `Role` is per-Space and ownership is singular.
    for (const s of allSpaces) {
      const members = membersForSpace(s.id);
      if (members.length === 0) continue;
      expect(members.filter((m) => m.role === 'owner'), `${s.id}`).toHaveLength(1);
    }
  });

  it('names the same Owner the Space does', () => {
    for (const s of allSpaces) {
      const owner = membersForSpace(s.id).find((m) => m.role === 'owner');
      if (!owner) continue;
      expect(owner.person.id, `${s.id}: the member list and the Space disagree`).toBe(s.owner.id);
    }
  });

  it('never lists more members than the Space says it has', () => {
    // The list is a sample; "Showing N of M" only makes sense if N <= M.
    for (const s of allSpaces) {
      expect(membersForSpace(s.id).length, `${s.id}`).toBeLessThanOrEqual(s.memberCount);
    }
  });

  it('covers both the populated and the one-person case', () => {
    // A Space of one is the ordinary state of a new Space, and it had never
    // rendered — so the singular "1 Member" had never been seen either.
    const sizes = allSpaces.map((s) => membersForSpace(s.id).length).filter((n) => n > 0);
    expect(sizes).toContain(1);
    expect(Math.max(...sizes)).toBeGreaterThan(3);
  });
});
