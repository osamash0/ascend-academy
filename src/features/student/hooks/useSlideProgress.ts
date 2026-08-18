/**
 * useSlideProgress — the single source of truth for slide navigation state.
 *
 * Responsibilities:
 *   - Maintains `slideStates` (the per-slide JSONB map) and `currentIndex`
 *   - Applies the four-state transition logic on every navigation
 *   - Debounces saves (800 ms) so we don't hammer the DB on every keystroke
 *   - Flushes synchronously on `beforeunload` (tab/browser close)
 *   - Backs up to `localStorage` on unload as a fallback if the async write fails
 *   - Exposes `initialize()` to restore state after lecture data loads
 *   - Exposes `validateSlide()`, `markLectureComplete()`, `resetProgress()`
 */
import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { upsertLectureProgress } from '@/services/studentService';
import {
  computeSlideTransition,
  computeCompletionPct,
  countByState,
} from '@/lib/slideProgress';
import type { Slide, SlideState } from '@/types/domain';

interface UseSlideProgressOptions {
  lectureId: string | undefined;
  slides: Slide[];
  userId: string | undefined;
}

export function useSlideProgress({ lectureId, slides, userId }: UseSlideProgressOptions) {
  const queryClient = useQueryClient();
  const [slideStates, setSlideStates] = useState<Record<string, SlideState>>({});
  const [currentIndex, setCurrentIndex] = useState(0);

  // Refs keep the latest values accessible inside closures without re-creating callbacks
  const slideStatesRef = useRef<Record<string, SlideState>>({});
  const currentIndexRef = useRef(0);
  const dirtyRef = useRef(false); // true when there are unsaved changes
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Keep refs in sync
  useEffect(() => {
    slideStatesRef.current = slideStates;
  }, [slideStates]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  // M8 fix: `currentIndex` is only ever moved by `goToSlide`/`initialize`,
  // both of which clamp it — but `slides` itself can change without going
  // through either (LectureView reuses this same hook instance when the
  // student navigates from one lecture to another without unmounting, e.g.
  // an in-app link, a deep link, or the browser Back/Forward buttons landing
  // on a different `:lectureId` for the same mounted `/lecture/:lectureId`
  // route). If the newly-loaded lecture has fewer slides than the index left
  // over from whatever was viewed before, `slides[currentIndex]` becomes
  // undefined and LectureView's render guard (`currentSlide ? <SlideViewer/>
  // : null`) silently drops the entire left slide pane with no way to
  // recover short of a reload. Re-clamp synchronously (useLayoutEffect, so it
  // lands before the browser paints) whenever `slides` changes so that
  // out-of-range frame is never shown. This is a backstop only: when saved
  // progress exists for the new lecture, `initialize()` (invoked by
  // LectureView right after this) still restores the correct index.
  useLayoutEffect(() => {
    if (slides.length === 0) return;
    if (currentIndexRef.current > slides.length - 1) {
      const clamped = slides.length - 1;
      currentIndexRef.current = clamped;
      setCurrentIndex(clamped);
    }
  }, [slides]);

  // ── Core save ──────────────────────────────────────────────────────────────

  const flushSave = useCallback(async () => {
    if (!userId || !lectureId || !dirtyRef.current) return;
    dirtyRef.current = false;

    const states = slideStatesRef.current;
    const idx = currentIndexRef.current;

    // Keep completed_slides in sync for backward compat (analytics, RLS checks)
    const completedSlides = Object.entries(states)
      .filter(([, v]) => v === 'visited')
      .map(([k]) => Number(k))
      .sort((a, b) => a - b);

    // Optimistically update the cache so the UI reacts instantly
    queryClient.setQueryData(['student-progress', userId], (oldData: any) => {
      if (!oldData) return oldData;
      return oldData.map((p: any) => {
        if (p.lecture_id === lectureId) {
          return {
            ...p,
            slide_states: states,
            last_slide_viewed: idx,
            completed_slides: completedSlides,
          };
        }
        return p;
      });
    });

    await upsertLectureProgress(userId, lectureId, {
      slide_states: states,
      last_slide_viewed: idx,
      completed_slides: completedSlides,
    });

    queryClient.invalidateQueries({ queryKey: ['student-progress', userId] });
  }, [userId, lectureId, queryClient]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      flushSave().catch((err) => console.warn('[slideProgress] debounced save failed:', err));
    }, 800);
  }, [flushSave]);

  // Apply a patch to both React state and ref atomically
  const applyPatch = useCallback((patch: Record<string, SlideState>) => {
    const next = { ...slideStatesRef.current, ...patch };
    slideStatesRef.current = next;
    setSlideStates(next);
  }, []);

  // ── Navigation ────────────────────────────────────────────────────────────

  /**
   * Navigate to a slide. Computes the four-state transition, applies it, and
   * schedules a debounced save. This is the ONLY way currentIndex should change.
   */
  const goToSlide = useCallback(
    (newIndex: number) => {
      if (slides.length === 0) return;
      const clamped = Math.max(0, Math.min(newIndex, slides.length - 1));

      const patch = computeSlideTransition(
        currentIndexRef.current,
        clamped,
        slideStatesRef.current,
        slides,
      );
      applyPatch(patch);
      currentIndexRef.current = clamped;
      setCurrentIndex(clamped);
      scheduleSave();
    },
    [slides, applyPatch, scheduleSave],
  );

  // ── Initialization (called once after fetchLectureData) ───────────────────

  /**
   * Restore slide state from persisted progress. Called after the lecture
   * data (slides + DB progress) has loaded. Safe to call multiple times;
   * subsequent calls override the previous state.
   */
  const initialize = useCallback(
    (savedStates: Record<string, SlideState>, lastIndex: number) => {
      if (slides.length === 0) return; // not ready yet
      const clamped = Math.max(0, Math.min(lastIndex, slides.length - 1));

      // Ensure the current slide is tagged 'current' in the restored map
      const init = { ...savedStates };
      const currentSlide = slides[clamped];
      if (currentSlide) {
        const key = String(currentSlide.slide_number);
        if (init[key] !== 'visited') init[key] = 'current';
      }

      slideStatesRef.current = init;
      setSlideStates(init);
      currentIndexRef.current = clamped;
      setCurrentIndex(clamped);
      dirtyRef.current = false; // freshly loaded — nothing to save yet
    },
    [slides],
  );

  // ── Manual student actions ─────────────────────────────────────────────────

  /**
   * Validate a skipped slide: upgrade its state to `visited`.
   * Does nothing if the slide is not in `skipped` state.
   */
  const validateSlide = useCallback(
    (slideNumber: number) => {
      const key = String(slideNumber);
      if (slideStatesRef.current[key] !== 'skipped') return;
      applyPatch({ [key]: 'visited' });
      scheduleSave();
    },
    [applyPatch, scheduleSave],
  );

  /**
   * Mark all slides as visited (manual "I'm done" action).
   * Flushes immediately — no debounce.
   */
  const markLectureComplete = useCallback(() => {
    const allVisited: Record<string, SlideState> = {};
    for (const s of slides) allVisited[String(s.slide_number)] = 'visited';
    slideStatesRef.current = allVisited;
    setSlideStates(allVisited);
    dirtyRef.current = true;
    flushSave().catch((err) => console.warn('[slideProgress] mark-complete save failed:', err));
  }, [slides, flushSave]);

  /**
   * Clear all progress for this lecture.
   * Flushes immediately — no debounce.
   */
  const resetProgress = useCallback(() => {
    slideStatesRef.current = {};
    setSlideStates({});
    dirtyRef.current = true;
    flushSave().catch((err) => console.warn('[slideProgress] reset save failed:', err));
  }, [flushSave]);

  // ── Persist before tab/browser close ─────────────────────────────────────

  useEffect(() => {
    const handleBeforeUnload = () => {
      // Sync fallback: write to localStorage so we can restore position next visit
      // even if the async DB write didn't complete.
      if (lectureId && dirtyRef.current) {
        try {
          localStorage.setItem(
            `progress_backup_${lectureId}`,
            JSON.stringify({
              slide_states: slideStatesRef.current,
              last_slide_viewed: currentIndexRef.current,
              ts: Date.now(),
            }),
          );
        } catch {
          // localStorage may be full — ignore
        }
      }
      // Best-effort async write (modern browsers give it ~250 ms)
      flushSave().catch(() => {});
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      clearTimeout(saveTimerRef.current);
      if (dirtyRef.current) {
        flushSave().catch((err) => console.warn('[slideProgress] unmount save failed:', err));
      }
    };
  }, [lectureId, flushSave]);

  // ── Derived stats (memoized on state change) ──────────────────────────────

  const { visited: visitedCount, skipped: skippedCount } = countByState(slideStates);
  const completionPct = computeCompletionPct(slideStates, slides.length);

  return {
    slideStates,
    currentIndex,
    goToSlide,
    initialize,
    validateSlide,
    markLectureComplete,
    resetProgress,
    flushSave,
    visitedCount,
    skippedCount,
    completionPct,
  };
}
