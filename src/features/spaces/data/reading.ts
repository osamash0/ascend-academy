import { useEffect, useRef } from 'react';
import { loadLiveRepository, type LiveRepository } from './liveRepository';
import { endSession, startSession } from './readingSession';

/**
 * Report reading to the server, page by page.
 *
 * Each time the page in view changes the page being *left* is posted with how
 * long it was really read, the reading session, and the page now in view (an
 * earlier one is a way back). Time the page is covered (`covered`: Explain
 * when it fills the screen over the page, a checkpoint, the teach-back, the
 * break room, the practice bench), or in a hidden tab, is not counted. Closing
 * the reader reports the open page; closing the tab reports it too, as a
 * beacon, because nothing after `pagehide` is sure to run.
 *
 * A page a guide turned to (`steered`: Luna) is reported without the page now
 * in view, so it is never counted as the reader turning back.
 *
 * Fire-and-forget: a failed report must never interrupt reading. Live only.
 */
export function useReadingProgress(
  lessonId: string | undefined,
  page: number,
  live: boolean,
  covered = false,
  steered?: { current: number | null },
): void {
  const clock = useRef<{ page: number; at: number; paused: number; pausedAt: number | null } | null>(null);
  const session = useRef<string | null>(null);
  const repo = useRef<LiveRepository | null>(null);
  const coveredRef = useRef(covered);
  /* The page in view now, so a restore from the page cache resumes on it, not on the page the reader opened at. */
  const pageRef = useRef(page);

  const isPaused = () => coveredRef.current || (typeof document !== 'undefined' && document.visibilityState === 'hidden');
  /* How long this page was really read: open time less the time covered or hidden. Takes the clock so it can run after the ref is cleared. */
  const seconds = (c: { at: number; paused: number; pausedAt: number | null }, now: number) => {
    const paused = c.paused + (c.pausedAt !== null ? now - c.pausedAt : 0);
    return Math.min(6 * 3600, Math.max(0, (now - c.at - paused) / 1000));
  };
  /* Start or stop the pause clock to match covered/hidden. */
  const syncPause = () => {
    const c = clock.current;
    if (!c) return;
    const now = Date.now();
    if (isPaused() && c.pausedAt === null) c.pausedAt = now;
    if (!isPaused() && c.pausedAt !== null) {
      c.paused += now - c.pausedAt;
      c.pausedAt = null;
    }
  };

  /* One session per open reader; the repository is loaded up front so the tab closing can report synchronously. */
  useEffect(() => {
    if (!live || !lessonId) return;
    const id = startSession(lessonId);
    session.current = id;
    let alive = true;
    loadLiveRepository()
      .then((r) => {
        if (alive) repo.current = r;
      })
      .catch(() => {});

    const onVisibility = () => syncPause();
    const onPageHide = () => {
      const c = clock.current;
      if (!c) return;
      const secs = seconds(c, Date.now());
      clock.current = null;
      if (repo.current) repo.current.recordReadingBeacon(lessonId, c.page, secs, id);
    };
    const onPageShow = (e: PageTransitionEvent) => {
      /* Back from the page cache: the page in view is open again, from now. */
      if (!e.persisted) return;
      const now = Date.now();
      clock.current = { page: pageRef.current, at: now, paused: 0, pausedAt: isPaused() ? now : null };
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      /* Closing the reader reports the page that was open. */
      const c = clock.current;
      clock.current = null;
      if (c) send(repo.current, lessonId, c.page, seconds(c, Date.now()), id, undefined);
      endSession(lessonId, id);
      session.current = null;
    };
    // The clock helpers are re-made each render but only read refs; the session follows the lesson and live alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, live]);

  /* The page changed: report the one left, start the next. */
  useEffect(() => {
    pageRef.current = page;
    /* A page a guide (Luna) turned to is not the reader turning back. */
    const guided = steered?.current === page;
    if (steered) steered.current = null;
    if (!live || !lessonId || page < 1) return;
    const now = Date.now();
    const left = clock.current;
    if (left && left.page !== page) {
      send(repo.current, lessonId, left.page, seconds(left, now), session.current, guided ? undefined : page);
    }
    if (!left || left.page !== page) clock.current = { page, at: now, paused: 0, pausedAt: isPaused() ? now : null };
  }, [lessonId, page, live, steered]);

  /* Covered or uncovered: move the pause clock. */
  useEffect(() => {
    coveredRef.current = covered;
    syncPause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [covered]);
}

function send(
  repo: LiveRepository | null,
  lessonId: string,
  page: number,
  seconds: number,
  session: string | null,
  toPage: number | undefined,
): void {
  const go = (r: LiveRepository) => r.recordReading(lessonId, page, seconds, session, toPage);
  void (repo ? go(repo) : loadLiveRepository().then(go)).catch(() => {
    /* Progress is best-effort; the reader keeps going. */
  });
}
