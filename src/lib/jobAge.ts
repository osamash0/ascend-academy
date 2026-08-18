/**
 * R53: `GET /api/upload/jobs` already returns `started_at`/`finished_at` for
 * every job, but nothing in the UI ever used them — the uploads panel showed
 * a bare status string ("extracting") that looks identical whether the job
 * started 5 seconds or 5 hours ago, which is exactly why the Milestone-4
 * audit needed a human to notice two lectures stuck for 15+ minutes with
 * `error: null`. This turns `started_at` into a human "how long has this
 * been running" label so a stuck job is visually obvious.
 */

/** Above this many minutes in a non-terminal status, the job is flagged as
 * likely-stuck in the UI (distinct styling) — not a hard cutoff, just a
 * visual hint; the backend's own reconciliation sweep (STALLED_RUN_THRESHOLD_MINUTES
 * in backend/workers/arq_worker.py) is the actual source of truth. Kept
 * lower than that backend threshold so the UI hints "this looks slow"
 * before the backend would actually intervene.
 */
export const LIKELY_STUCK_MINUTES = 15;

/** Human "how long ago" label for an ISO timestamp, or null if unparseable
 * (never throws — a formatting glitch must never break the uploads panel). */
export function formatJobAge(startedAt: string | null | undefined, now: number = Date.now()): string | null {
  if (!startedAt) return null;
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return null;
  const deltaMs = now - started;
  if (deltaMs < 0) return null;

  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'just started';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** Age in whole minutes since `started_at`, or null if unparseable/missing.
 * Used to decide when to flag a job as "likely stuck" in the uploads panel. */
export function jobAgeMinutes(startedAt: string | null | undefined, now: number = Date.now()): number | null {
  if (!startedAt) return null;
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return null;
  const deltaMs = now - started;
  if (deltaMs < 0) return null;
  return Math.floor(deltaMs / 60_000);
}
