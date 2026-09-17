import { describe, expect, it } from 'vitest';
import { canDelete, draftSpace, switchMode, spaceByJoinCode, joinCodeFor } from '../spaces';
import { lessonsForSpace } from '../lessons';
import { spaceById } from '../spaces';

/**
 * Space lifecycle guards — Doc 1 "Visibility", "The two Space modes",
 * and the mode-switch losslessness promise.
 */

describe('Creating a Space', () => {
  it('is Private and owned by you by default', () => {
    // Doc 1, Visibility: "Private — only me. Default for everyone."
    const s = draftSpace({ name: 'Test Space' });
    expect(s.visibility).toBe('private');
    expect(s.viewerRole).toBe('owner');
    expect(s.state).toBe('active');
  });

  it('starts with grounding off and strict mode off', () => {
    // Grounding rule 1: dormant until switched on, off for every fresh Space.
    const s = draftSpace({ name: 'Test Space' });
    expect(s.groundingEnabled).toBe(false);
    expect(s.strictMode).toBe(false);
  });

  it('starts empty — no Lessons, no members but you', () => {
    const s = draftSpace({ name: 'Test Space' });
    expect(s.lessonCount).toBe(0);
    expect(s.lessonsDone).toBe(0);
    expect(s.memberCount).toBe(1);
    expect(s.starCount).toBe(0);
    expect(s.starredByViewer).toBe(false);   // cannot star your own Space
  });

  it('takes the mode it was asked for, defaulting to Guided', () => {
    expect(draftSpace({ name: 'A' }).mode).toBe('guided');
    expect(draftSpace({ name: 'B', mode: 'open' }).mode).toBe('open');
  });
});

describe('Switching mode', () => {
  it('is lossless — Lessons, their order and progress all survive', () => {
    // Doc 1: "the switch is lossless by construction: it changes only who may
    // publish going forward. Existing Lessons keep their place, their origin,
    // and everyone's progress."
    const before = lessonsForSpace('s-linalg').map((l) => [l.id, l.order, l.progress, l.origin]);
    const after = switchMode('s-linalg', 'guided');
    expect(after.space.mode).toBe('guided');
    expect(after.lessons.map((l) => [l.id, l.order, l.progress, l.origin])).toEqual(before);
  });

  it('keeps Community-origin Lessons that were already published', () => {
    // Flipping Open → Guided must not retroactively evict member work.
    const after = switchMode('s-linalg', 'guided');
    expect(after.lessons.some((l) => l.origin === 'community')).toBe(true);
  });

  it('flips back without loss either', () => {
    const before = lessonsForSpace('s-linalg').map((l) => l.id);
    expect(switchMode('s-linalg', 'open').lessons.map((l) => l.id)).toEqual(before);
  });
});

describe('Deleting a Space', () => {
  it('refuses anything but an exact name match', () => {
    const s = spaceById('s-linalg')!;
    expect(canDelete(s, '')).toBe(false);
    expect(canDelete(s, 'intro to linear algebra')).toBe(false);   // case matters
    expect(canDelete(s, 'Intro to Linear Algebr')).toBe(false);
    expect(canDelete(s, s.name)).toBe(true);
  });

  it('refuses when you do not own it', () => {
    const notMine = spaceById('s-dbs')!;      // viewer is a Member here
    expect(notMine.viewerRole).not.toBe('owner');
    expect(canDelete(notMine, notMine.name)).toBe(false);
  });
});

describe('Join codes', () => {
  it('gives every Space a stable code', () => {
    expect(joinCodeFor('s-dbs')).toBe(joinCodeFor('s-dbs'));
    expect(joinCodeFor('s-dbs')).not.toBe(joinCodeFor('s-linalg'));
  });

  it('resolves a code back to its Space, case-insensitively', () => {
    const code = joinCodeFor('s-dbs');
    expect(spaceByJoinCode(code)?.id).toBe('s-dbs');
    expect(spaceByJoinCode(code.toLowerCase())?.id).toBe('s-dbs');
  });

  it('returns nothing for a code that does not exist', () => {
    expect(spaceByJoinCode('ZZZZZZ')).toBeUndefined();
  });
});

describe('Registering a created Space', () => {
  it('makes it findable, so landing on its Overview works', async () => {
    // Caught by clicking the dialog through, not by a test: draftSpace built
    // the object and navigated to it, but nothing registered it, so the
    // destination 404'd. Creating must therefore register.
    const { createSpace, spaceById: byId } = await import('../spaces');
    const s = createSpace({ name: 'Guard Space' });
    expect(byId(s.id)?.name).toBe('Guard Space');
  });

  it('leaves the fixture set alone, so the other guards stay stable', async () => {
    const { allSpaces: base, createSpace } = await import('../spaces');
    const before = base.length;
    createSpace({ name: 'Another' });
    expect(base.length).toBe(before);
  });
});
