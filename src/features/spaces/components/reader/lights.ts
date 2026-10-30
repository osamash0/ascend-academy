import { useCallback, useEffect, useRef, useState } from 'react';
import type { EarlyReading } from '../../data/liveRepository';

/**
 * The lights: while Luna is still reading a Lesson, which faces a page has
 * (only pages she has written have Explain, Text and Ask), whether Practise and
 * a study session may show yet, how far the timeline's buffer reaches, and the
 * few things Luna says once: the first light on the page you are on, Practise
 * arriving, and a run that stopped. Without a run (a Space's Lesson) every
 * face is on, as it always was.
 */
export type LightLine = 'explain' | 'practice' | 'stopped';
export const RING_MS = 4000;

/** The highest page p such that every page 1..p is written: the timeline's buffer. */
export function bufferOf(pagesReady: number[]): number {
  const have = new Set(pagesReady);
  let p = 0;
  while (have.has(p + 1)) p += 1;
  return p;
}

export interface Lights {
  /** A run is being followed and is not ready (or its first answer has not come yet). */
  following: boolean;
  /** This page has Explain, Text and Ask. */
  pageReady: boolean;
  /** Practise may show (run: practiceReady; no run: practiceCount > 0). */
  practiceOn: boolean;
  /**
   * The practice questions may be asked for, and the companion's Practise
   * shown: always without a run (as it always was), else once they exist.
   */
  practiceArmed: boolean;
  /** The Luna session offer may show. */
  lunaReady: boolean;
  /** Grey part of the timeline. */
  buffer: number;
  /** A line Luna says now (once each), else null. */
  line: LightLine | null;
  /** True for RING_MS after a light came on: wake controls, ring the new tabs. */
  ringing: boolean;
  /** What rings: the new tabs (Explain) or the Practise entry. */
  rings: 'tabs' | 'practice' | null;
  /** Clears `line` early. */
  dismiss: () => void;
}

export function useLights(
  run: EarlyReading | null,
  page: number,
  opts: {
    total: number;
    practiceCount: number;
    /** A run is known but has not answered yet: every face waits, as if nothing were written. */
    pending?: boolean;
    /** The once-only lines are once per Lesson: a new Lesson in the same screen starts afresh. */
    lessonId?: string;
  },
): Lights {
  const pending = !run && !!opts.pending;
  const following = pending || (run !== null && run.stage !== 'ready');
  const pageReady = !following || (run?.pagesReady.includes(page) ?? false);
  const practiceOn = following
    ? (run?.practiceReady ?? false)
    : (run?.practiceReady ?? false) || opts.practiceCount > 0;
  const practiceArmed = !following || (run?.practiceReady ?? false);
  const buffer = following ? (run ? bufferOf(run.pagesReady) : 0) : opts.total;

  const [line, setLine] = useState<LightLine | null>(null);
  const [ringing, setRinging] = useState(false);
  const said = useRef(new Set<LightLine>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const say = useCallback((what: LightLine, ring: boolean) => {
    if (said.current.has(what)) return;
    said.current.add(what);
    setLine(what);
    setRinging(ring);
    clearTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      setLine(null);
      setRinging(false);
    }, RING_MS);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  /* The lights seen during this visit: a change, never what was already there on arrival. */
  const was = useRef<{ page: number; ready: boolean; practice: boolean } | null>(null);
  /* Another Lesson: nothing said yet, nothing seen yet. Declared first, so it runs before the lights below. */
  const lessonId = opts.lessonId;
  useEffect(() => {
    said.current = new Set();
    was.current = null;
    clearTimer();
    setLine(null);
    setRinging(false);
  }, [lessonId, clearTimer]);
  useEffect(() => {
    if (!run) return;
    const prev = was.current;
    was.current = { page, ready: pageReady, practice: run.practiceReady };
    if (run.stage === 'failed') say('stopped', false);
    if (!prev) return;
    if (following && prev.page === page && !prev.ready && pageReady) say('explain', true);
    if (!prev.practice && run.practiceReady) say('practice', true);
  }, [run, page, pageReady, following, say]);

  const dismiss = useCallback(() => {
    clearTimer();
    setLine(null);
    setRinging(false);
  }, [clearTimer]);

  const rings = !ringing ? null : line === 'explain' ? 'tabs' : line === 'practice' ? 'practice' : null;
  return { following, pageReady, practiceOn, practiceArmed, lunaReady: !following, buffer, line, ringing, rings, dismiss };
}
