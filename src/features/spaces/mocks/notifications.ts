import type { Person } from '../types';
import { ferreira, lindqvist, okonkwo } from './people';

/**
 * Notification fixtures.
 *
 * The row mirrors the existing `notifications` table exactly —
 * `{id, title, message, type, read, created_at}`, which `NotificationBell`
 * already selects — so wiring this is a swap, not a new endpoint. The v4 kinds
 * below are new **values** of `type`, not a schema change; the old product
 * already treats `type` as an open string with an icon lookup.
 *
 * `target` is the one addition: what opening it should show. Doc 2's rule for
 * Home and Social holds here too — **notifications link to Lessons and people,
 * never to a Space card.** A Space is named as context, never as a destination.
 */

export type NotificationKind =
  // v4 kinds
  | 'endorsed'
  | 'promoted'
  | 'liked'
  | 'new_lessons'
  | 'friend_request'
  // kinds the old product already emits
  | 'achievement'
  | 'streak';

/** Where opening it goes. Never a Space. */
export type NotificationTarget =
  | { kind: 'lesson'; lessonId: string; spaceName: string }
  | { kind: 'person'; person: Person }
  | { kind: 'profile' };

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: NotificationKind;
  read: boolean;
  /** ISO. Named to match the column, so the mapping is one-to-one. */
  created_at: string;
  target: NotificationTarget;
  /** Who caused it, where a person did. Drives the avatar. */
  actor?: Person;
}

export const notifications: AppNotification[] = [
  {
    id: 'n-1',
    title: 'Åsa endorsed your work',
    message: '“Mnemonic for the normal forms” is now marked endorsed in Database Systems.',
    type: 'endorsed',
    read: false,
    created_at: '2026-08-31T08:40:00Z',
    actor: lindqvist,
    target: { kind: 'lesson', lessonId: 'l-s-dbs-4', spaceName: 'Database Systems' },
  },
  {
    id: 'n-2',
    title: 'Chidi wants to be friends',
    message: 'You share 1 Space.',
    type: 'friend_request',
    read: false,
    created_at: '2026-08-31T07:10:00Z',
    actor: okonkwo,
    target: { kind: 'person', person: okonkwo },
  },
  {
    id: 'n-3',
    title: '2 new Lessons',
    message: 'Relational Design and Normalization were published in Database Systems.',
    type: 'new_lessons',
    read: false,
    created_at: '2026-08-30T19:05:00Z',
    target: { kind: 'lesson', lessonId: 'l-s-dbs-3', spaceName: 'Database Systems' },
  },
  {
    id: 'n-4',
    title: 'Your practice set was used',
    message: 'Someone completed “20 normalization questions”. That earns XP.',
    type: 'liked',
    read: true,
    created_at: '2026-08-30T14:20:00Z',
    actor: ferreira,
    target: { kind: 'lesson', lessonId: 'l-s-dbs-4', spaceName: 'Database Systems' },
  },
  {
    /*
     * `achievement` had an icon and a tone in `NotificationPanel` and no
     * fixture anywhere, so that branch had never rendered. Badges are earned
     * and each says what earned it — so does this.
     */
    id: 'n-7',
    title: 'Badge earned — Contributor',
    message: 'You published your first contribution to a Space.',
    type: 'achievement',
    read: true,
    created_at: '2026-08-29T20:10:00Z',
    target: { kind: 'profile' },
  },
  {
    id: 'n-5',
    title: 'Four days running',
    message: 'You have studied four days in a row.',
    type: 'streak',
    read: true,
    created_at: '2026-08-29T18:00:00Z',
    target: { kind: 'profile' },
  },
];

export const unreadCount = (): number => notifications.filter((n) => !n.read).length;

/** Marks everything read in place — the panel's one bulk action. */
export const markAllRead = (): void => {
  for (const n of notifications) n.read = true;
};

const dayKey = (iso: string) => iso.slice(0, 10);

const dayLabel = (iso: string): string => {
  const d = new Date(iso);
  const today = new Date('2026-08-31T12:00:00Z');
  const diff = Math.floor((+new Date(dayKey(today.toISOString())) - +new Date(dayKey(iso))) / 86_400_000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
};

/**
 * Grouped by day, newest first — and newest first within each day. A flat list
 * of timestamps is unreadable once there are more than a handful.
 */
export const groupedByDay = (): { label: string; items: AppNotification[] }[] => {
  const buckets = new Map<string, AppNotification[]>();
  for (const n of [...notifications].sort(
    (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
  )) {
    const k = dayKey(n.created_at);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(n);
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([k, items]) => ({ label: dayLabel(`${k}T00:00:00Z`), items }));
};
