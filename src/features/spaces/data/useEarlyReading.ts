import { useEffect, useMemo, useState } from 'react';
import { loadLiveRepository, type EarlyReading } from './liveRepository';
import { localFileFor } from './uploads';

/** How often Luna's progress is re-read while she is still reading. */
const POLL_MS = 3000;

/**
 * An upload you can read before its Lesson exists. The file on this device
 * opens at once (no network); otherwise the stored copy's signed link. Luna's
 * progress is re-read until she is done or the run has failed.
 */
export function useEarlyReading(uploadId: string) {
  const local = useMemo(() => {
    const f = localFileFor(uploadId);
    return f ? URL.createObjectURL(f) : null;
  }, [uploadId]);
  useEffect(() => () => {
    if (local) URL.revokeObjectURL(local);
  }, [local]);

  const [reading, setReading] = useState<EarlyReading | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const repo = await loadLiveRepository();
        const next = await repo.readingFor(uploadId);
        if (!alive) return;
        setReading(next);
        if (next.stage === 'developing') timer = setTimeout(tick, POLL_MS);
      } catch {
        if (alive) timer = setTimeout(tick, POLL_MS * 2);
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
