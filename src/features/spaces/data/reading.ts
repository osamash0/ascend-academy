import { useEffect, useRef } from 'react';
import { loadLiveRepository } from './liveRepository';

/**
 * Report reading to the server, page by page.
 *
 * Each time the page in view changes — and once more when the reader closes —
 * the page being *left* is posted with how long it was open. The server
 * counts it as read after two seconds, so flicking through a deck is not
 * reading it. This is what makes v4 reading show up as progress, a visit, a
 * streak day and a slide_view for the professor, exactly as the old reader's.
 *
 * Fire-and-forget: a failed report must never interrupt reading. Live only.
 */
export function useReadingProgress(lessonId: string | undefined, page: number, live: boolean): void {
  const since = useRef<{ page: number; at: number } | null>(null);

  useEffect(() => {
    if (!live || !lessonId || page < 1) return;
    const left = since.current;
    since.current = { page, at: Date.now() };
    if (left && left.page !== page) send(lessonId, left.page, left.at);
  }, [lessonId, page, live]);

  // Closing the reader reports the page that was open.
  useEffect(() => {
    if (!live || !lessonId) return;
    return () => {
      const open = since.current;
      since.current = null;
      if (open) send(lessonId, open.page, open.at);
    };
  }, [lessonId, live]);
}

function send(lessonId: string, page: number, startedAt: number): void {
  const seconds = Math.min(6 * 3600, (Date.now() - startedAt) / 1000);
  void loadLiveRepository()
    .then((repo) => repo.recordReading(lessonId, page, seconds))
    .catch(() => {
      /* Progress is best-effort; the reader keeps going. */
    });
}
