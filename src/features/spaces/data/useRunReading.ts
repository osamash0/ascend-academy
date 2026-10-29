import { useEffect, useState } from 'react';
import { loadLiveRepository, type EarlyReading } from './liveRepository';

/** How often Luna's progress is re-read while she is still reading. */
const POLL_MS = 3000;
/** Consecutive failed reads before giving up. */
const MAX_FAILURES = 5;

/**
 * One upload's reading status, re-read every few seconds until Luna is done or
 * the run has failed. Null until the first answer, and always null without a
 * run or for a file still on its way up (`sending-*`, no run yet).
 */
export function useRunReading(runId: string | null): EarlyReading | null {
  const [reading, setReading] = useState<EarlyReading | null>(null);
  useEffect(() => {
    setReading(null);
    if (!runId || runId.startsWith('sending-')) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    const tick = async () => {
      try {
        const repo = await loadLiveRepository();
        const next = await repo.readingFor(runId);
        if (!alive) return;
        failures = 0;
        setReading(next);
        if (next.stage === 'developing') timer = setTimeout(tick, POLL_MS);
      } catch (e) {
        if (!alive) return;
        const status = (e as { status?: number })?.status;
        // Not yours / removed / signed out: retrying cannot help.
        if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) return;
        failures += 1;
        if (failures < MAX_FAILURES) timer = setTimeout(tick, POLL_MS * 2);
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);
  return reading;
}
