import { useEffect, useState } from 'react';
import { loadLiveRepository, type EarlyReading } from './liveRepository';
import type { RunFollow } from './useReader';

/** How often Luna's progress is re-read while she is still reading. */
const POLL_MS = 3000;
/** Consecutive failed reads before giving up. */
const MAX_FAILURES = 5;

/*
 * The last answer for each run, kept for the page's lifetime: the full reader
 * starts from what the early reader last heard, at once, instead of waiting
 * for its own first read.
 */
const lastReading = new Map<string, EarlyReading>();

const polls = (runId: string | null): runId is string => !!runId && !runId.startsWith('sending-');
const remembered = (runId: string | null) => (polls(runId) ? lastReading.get(runId) ?? null : null);

export interface RunStatus {
  /** The latest answer, else the last one heard for this run, else null. */
  reading: EarlyReading | null;
  /** No answer came and none will: the run is not yours, gone, or the reads kept failing. */
  gaveUp: boolean;
}

/**
 * One upload's reading status, re-read every few seconds until Luna is done or
 * the run has failed. Null until the first answer (unless one was heard
 * before), and always null without a run or for a file still on its way up
 * (`sending-*`, no run yet).
 */
export function useRunStatus(runId: string | null): RunStatus {
  /* Kept with the run it is for: a new run never shows the last one's answer, not even for a render. */
  const [state, setState] = useState<{ for: string | null; reading: EarlyReading | null; gaveUp: boolean }>(() => ({
    for: runId,
    reading: remembered(runId),
    gaveUp: false,
  }));
  useEffect(() => {
    setState({ for: runId, reading: remembered(runId), gaveUp: false });
    if (!polls(runId)) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    const giveUp = () => setState((s) => (s.for === runId ? { ...s, gaveUp: true } : s));
    const tick = async () => {
      try {
        const repo = await loadLiveRepository();
        const next = await repo.readingFor(runId);
        lastReading.set(runId, next);
        if (!alive) return;
        failures = 0;
        setState({ for: runId, reading: next, gaveUp: false });
        if (next.stage === 'developing') timer = setTimeout(tick, POLL_MS);
      } catch (e) {
        if (!alive) return;
        const status = (e as { status?: number })?.status;
        // Not yours / removed / signed out: retrying cannot help.
        if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) {
          giveUp();
          return;
        }
        failures += 1;
        if (failures < MAX_FAILURES) timer = setTimeout(tick, POLL_MS * 2);
        else giveUp();
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);
  return state.for === runId
    ? { reading: state.reading, gaveUp: state.gaveUp }
    : { reading: remembered(runId), gaveUp: false };
}

/** `useRunStatus`'s answer alone. */
export function useRunReading(runId: string | null): EarlyReading | null {
  return useRunStatus(runId).reading;
}

/**
 * What the full reader follows for one Lesson. A run for another Lesson (a
 * link carried over to the next one) is not followed. A run known but not yet
 * heard from (a reload with `&run=`) is `pending`: the Lesson is read as a
 * partial one and its faces wait, until the first answer — or until the reads
 * give up, and then it is read as any Lesson.
 */
export function followOf(
  status: RunStatus,
  runId: string | null,
  lessonId: string | undefined,
): { run: EarlyReading | null; pending: boolean; follow: RunFollow | null } {
  const { reading, gaveUp } = status;
  const run = reading && reading.lessonId && reading.lessonId !== lessonId ? null : reading;
  const pending = !reading && !gaveUp && polls(runId);
  const follow: RunFollow | null = run
    ? { pagesReady: run.pagesReady.length, done: run.stage !== 'developing' }
    : pending
      ? { pagesReady: 0, done: false }
      : null;
  return { run, pending, follow };
}
