import { useSyncExternalStore } from 'react';
import { loadLiveRepository, type LessonBatchRow } from './liveRepository';

/**
 * Files an owner is adding to their Space, while they are being prepared
 * (LS-072).
 *
 * Module state, not component state: when a Lesson is ready the world is
 * refreshed, which remounts the screen, and the files still in the oven must
 * not vanish from it. Per Space; gone on a full reload, when the course page
 * itself lists whatever finished.
 */

export type Pending = {
  /** Stable key for the row: the run id, or the filename if it never queued. */
  key: string;
  filename: string;
  state: 'preparing' | 'failed';
  error?: string;
};

type Entry = { batchId: string | null; rows: Pending[] };

const bySpace = new Map<string, Entry[]>();
const listeners = new Set<() => void>();
const timers = new Map<string, number>();
const EMPTY: Pending[] = [];
const snapshots = new Map<string, Pending[]>();

const emit = (spaceId: string) => {
  snapshots.set(spaceId, (bySpace.get(spaceId) ?? []).flatMap((e) => e.rows));
  listeners.forEach((l) => l());
};

const FAILED = new Set(['failed', 'error', 'cancelled']);
const DONE = new Set(['complete', 'completed', 'succeeded', 'done']);

/** How often to ask how the files are coming along. */
export const POLL_MS = 5000;

export function usePendingLessons(spaceId: string): Pending[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshots.get(spaceId) ?? EMPTY,
  );
}

/**
 * Send files to the Space and watch them. `onReady` runs whenever at least
 * one Lesson has finished, so the caller can reload what the page shows.
 */
export async function addLessons(spaceId: string, files: File[], onReady: () => void): Promise<void> {
  const repo = await loadLiveRepository();
  const batch = await repo.addLessons(spaceId, files);
  const entry: Entry = {
    batchId: batch.batch_id,
    rows: batch.files.map((f) => ({
      key: f.run_id ?? `${batch.batch_id}:${f.filename}`,
      filename: f.filename,
      state: f.status === 'failed' || !f.run_id ? 'failed' : 'preparing',
      error: f.error,
    })),
  };
  bySpace.set(spaceId, [...(bySpace.get(spaceId) ?? []), entry]);
  emit(spaceId);
  watch(spaceId, onReady);
}

function watch(spaceId: string, onReady: () => void) {
  if (timers.has(spaceId)) return;
  const tick = async () => {
    const entries = bySpace.get(spaceId) ?? [];
    let finished = false;
    const repo = await loadLiveRepository();
    for (const entry of entries) {
      if (!entry.batchId || !entry.rows.some((r) => r.state === 'preparing')) continue;
      let rows: LessonBatchRow[];
      try {
        rows = (await repo.lessonBatch(entry.batchId)).lectures;
      } catch {
        continue; // a missed poll is not a failed file; try again next tick
      }
      const byRun = new Map(rows.map((r) => [r.run_id, r]));
      entry.rows = entry.rows.flatMap((p) => {
        const row = byRun.get(p.key);
        if (!row || p.state !== 'preparing') return [p];
        if (DONE.has(row.status) && row.lecture_id) {
          finished = true;
          return [];
        }
        if (FAILED.has(row.status)) return [{ ...p, state: 'failed' as const, error: row.error ?? undefined }];
        return [p];
      });
    }
    bySpace.set(
      spaceId,
      entries.filter((e) => e.rows.length > 0),
    );
    emit(spaceId);
    if (finished) onReady();
    if ((bySpace.get(spaceId) ?? []).some((e) => e.rows.some((r) => r.state === 'preparing'))) {
      timers.set(spaceId, window.setTimeout(tick, POLL_MS));
    } else {
      timers.delete(spaceId);
    }
  };
  timers.set(spaceId, window.setTimeout(tick, POLL_MS));
}

/** Forget a failed row once its owner has read it. */
export function dismissPending(spaceId: string, key: string) {
  bySpace.set(
    spaceId,
    (bySpace.get(spaceId) ?? []).map((e) => ({ ...e, rows: e.rows.filter((r) => r.key !== key) })).filter((e) => e.rows.length),
  );
  emit(spaceId);
}

/** Tests only: start from nothing. */
export function resetPendingLessons() {
  timers.forEach((t) => window.clearTimeout(t));
  timers.clear();
  bySpace.clear();
  snapshots.clear();
  listeners.forEach((l) => l());
}
