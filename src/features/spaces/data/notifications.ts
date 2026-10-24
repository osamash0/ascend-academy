import * as fixtures from '../mocks/notifications';
import type { AppNotification } from '../mocks/notifications';
import { loadLiveRepository } from './liveRepository';
import { liveWorld } from './world';

export type { AppNotification, NotificationKind } from '../mocks/notifications';

/**
 * The notification panel's data: the fixtures in demo, the viewer's real
 * notifications live (loaded with the world). Same three questions either way.
 */

export const unreadCount = (): number => {
  const world = liveWorld();
  return world ? world.notifications.filter((n) => !n.read).length : fixtures.unreadCount();
};

/** Marks everything read — locally at once, and on the server when live. */
export const markAllRead = (): void => {
  const world = liveWorld();
  if (!world) return fixtures.markAllRead();
  for (const n of world.notifications) n.read = true;
  void loadLiveRepository()
    .then((repo) => repo.markNotificationsRead())
    .catch(() => {
      /* Read state is a convenience; the panel already shows them read. */
    });
};

const dayKey = (iso: string) => iso.slice(0, 10);

function label(day: string, today: Date): string {
  const diff = Math.floor((+new Date(dayKey(today.toISOString())) - +new Date(day)) / 86_400_000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}

/** Grouped by day, newest first. Live, "today" is today (the fixtures pin a date). */
export const groupedByDay = (now: Date = new Date()): { label: string; items: AppNotification[] }[] => {
  const world = liveWorld();
  if (!world) return fixtures.groupedByDay();
  const buckets = new Map<string, AppNotification[]>();
  for (const n of [...world.notifications].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))) {
    const k = dayKey(n.created_at);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(n);
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([k, items]) => ({ label: label(k, now), items }));
};
