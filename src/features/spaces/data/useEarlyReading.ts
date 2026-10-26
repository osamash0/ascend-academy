import { useEffect, useState } from 'react';
import { loadLiveRepository, type EarlyReading } from './liveRepository';
import { localUrlFor } from './uploads';

/** How often Luna's progress is re-read while she is still reading. */
const POLL_MS = 3000;
/** Consecutive failed reads before giving up. */
const MAX_FAILURES = 5;

/**
 * An upload you can read before its Lesson exists. The file on this device
 * opens at once (no network); otherwise the stored copy's signed link. Luna's
 * progress is re-read until she is done or the run has failed.
 */
export function useEarlyReading(uploadId: string) {
  /* One link per File, kept across the swap from `sending-N` to the run id: the PDF loads once. */
  const local = localUrlFor(uploadId);

  const [reading, setReading] = useState<EarlyReading | null>(null);
  useEffect(() => {
    // A file still on its way up has no run yet: nothing to ask the server about.
    if (uploadId.startsWith('sending-')) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    const tick = async () => {
      try {
        const repo = await loadLiveRepository();
        const next = await repo.readingFor(uploadId);
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
  }, [uploadId]);

  return { reading, url: local ?? reading?.pdfUrl ?? null };
}
