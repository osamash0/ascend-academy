import { describe, expect, it } from 'vitest';
import { groupedByDay, notifications, unreadCount } from '../notifications';
import { allSpaces } from '../spaces';
import { lessonsForSpace } from '../lessons';

/**
 * Notification guards.
 *
 * The row shape mirrors the existing `notifications` table exactly —
 * {id, title, message, type, read, created_at} — so wiring is a swap. The v4
 * kinds (endorsed, new_lessons, friend_request) are new *values* of `type`,
 * not a schema change.
 *
 * Doc 2's rule for Social and Home applies here too: notifications link to
 * Lessons and people, never to a Space card. A Space may be named as context.
 */

describe('Notifications', () => {
  it('mirrors the existing notification row shape', () => {
    for (const n of notifications) {
      expect(typeof n.id).toBe('string');
      expect(typeof n.title).toBe('string');
      expect(typeof n.message).toBe('string');
      expect(typeof n.type).toBe('string');
      expect(typeof n.read).toBe('boolean');
      expect(Number.isNaN(Date.parse(n.created_at))).toBe(false);
    }
  });

  it('never targets a Space', () => {
    const spaceIds = new Set(allSpaces.map((s) => s.id));
    for (const n of notifications) {
      expect(n.target.kind, n.title).not.toBe('space');
      if (n.target.kind === 'lesson') {
        expect(spaceIds.has(n.target.lessonId), n.title).toBe(false);
      }
    }
  });

  it('resolves every Lesson target to a Lesson that exists', () => {
    const known = new Set(allSpaces.flatMap((s) => lessonsForSpace(s.id)).map((l) => l.id));
    for (const n of notifications) {
      if (n.target.kind === 'lesson') {
        expect(known.has(n.target.lessonId), `${n.title} → ${n.target.lessonId}`).toBe(true);
      }
    }
  });

  it('names the Space as context on every Lesson notification', () => {
    for (const n of notifications) {
      if (n.target.kind === 'lesson') {
        expect(n.target.spaceName.trim().length, n.title).toBeGreaterThan(0);
      }
    }
  });

  it('counts only unread', () => {
    expect(unreadCount()).toBe(notifications.filter((n) => !n.read).length);
    expect(unreadCount()).toBeGreaterThan(0);
  });

  it('groups newest day first, and newest within a day', () => {
    const groups = groupedByDay();
    expect(groups.length).toBeGreaterThan(1);
    const dayTimes = groups.map((g) => +new Date(g.items[0].created_at));
    expect([...dayTimes].sort((a, b) => b - a)).toEqual(dayTimes);
    for (const g of groups) {
      const times = g.items.map((i) => +new Date(i.created_at));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    }
  });

  it('covers the kinds the panel has to render', () => {
    const kinds = new Set(notifications.map((n) => n.type));
    expect(kinds.has('endorsed')).toBe(true);
    expect(kinds.has('new_lessons')).toBe(true);
    expect(kinds.has('friend_request')).toBe(true);
  });
});
