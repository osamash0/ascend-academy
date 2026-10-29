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
  /** A run is being followed and is not ready. */
  following: boolean;
  /** This page has Explain, Text and Ask. */
  pageReady: boolean;
  /** Practise may show (run: practiceReady; no run: practiceCount > 0). */
  practiceOn: boolean;
  /** The Luna session offer may show. */
  lunaReady: boolean;
  /** Grey part of the timeline. */
  buffer: number;
  /** A line Luna says now (once each), else null. */
  line: LightLine | null;
  /** True for RING_MS after a light came on: wake controls, ring the new tabs. */
  ringing: boolean;
  /** Clears `line` early. */
  dismiss: () => void;
}

export function useLights(
  run: EarlyReading | null,
  page: number,
  opts: { total: number; practiceCount: number },
): Lights {
  const following = run !== null && run.stage !== 'ready';
  const pageReady = !following || (run?.pagesReady.includes(page) ?? false);
  const practiceOn = run && following
    ? run.practiceReady
    : (run?.practiceReady ?? false) || opts.practiceCount > 0;
  const buffer = run && following ? bufferOf(run.pagesReady) : opts.total;

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

  return { following, pageReady, practiceOn, lunaReady: !following, buffer, line, ringing, dismiss };
}
