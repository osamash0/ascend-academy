import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Landing, LandingAnswer } from '../landing/types';
import { landingFor } from '../mocks/landing';
import { stageAccentFor } from '../components/stage';
import type { LoadState } from '../types';
import { loadLiveRepository, type WireLanding } from './liveRepository';
import { isLive } from './useReader';
import { liveWorld } from './world';

export type { WireLanding } from './liveRepository';

/**
 * The data seam for the owner's door.
 *
 * The demo build reads `mocks/landing.ts`, as the lab does. A live Space reads
 * `GET /api/v1/v4/spaces/{id}/landing`, in the language the app is showing,
 * and the app draws the two colours the server leaves out: the Space's light
 * from its name and each Lesson's from its order, the way every other room of
 * the Space is lit (`SpaceScreen`, `PracticeScreen`). A hue sampled from a
 * Lesson's first page belongs on the Lesson at ingest; until it is stored
 * there, order is the honest choice.
 *
 * Questions come with the Questions channel (Plan 4), as two lists, waiting
 * and answered; the door splits one list by whether it has an answer, so they
 * are joined here. Until then there are none, and the door draws no section.
 */
export function fromWire(w: WireLanding): Landing {
  const { answered, questions, ...rest } = w;
  return {
    ...rest,
    accent: stageAccentFor(w.spaceName.length),
    lessons: w.lessons.map((l) => ({ ...l, color: stageAccentFor(l.order) })),
    questions: [...(questions ?? []), ...(answered ?? [])],
    themes: w.themes,
  };
}

type Loaded = { state: LoadState; landing: Landing | null };

export interface LandingData extends Loaded {
  /**
   * Answering, only where it really happens. The demo build answers in the
   * screen's state, so the lab's answer flow works end to end. Live, answering
   * is the Questions channel's (Plan 4); until it ships there is no way to
   * answer, and the door offers none.
   */
  answer?: (questionId: string, text: string, forEveryone: boolean) => void;
  retry: () => void;
}

/** An HTTP status from the transport's error, when it carries one (`ApiError.status`). */
const statusOf = (e: unknown) => (typeof e === 'object' && e && 'status' in e ? Number((e as { status: unknown }).status) : 0);

/** Fixtures in the demo build only: a live build never shows a made-up Space, even at a demo id. */
const fixture = (spaceId: string): Loaded => {
  const landing = liveWorld() === null ? landingFor(spaceId) : null;
  return { state: landing ? 'ready' : 'empty', landing };
};

export function useLanding(spaceId: string): LandingData {
  const live = isLive(spaceId);
  const { i18n } = useTranslation();
  const [loaded, setLoaded] = useState<Loaded>(() => (live ? { state: 'loading', landing: null } : fixture(spaceId)));
  const [tick, setTick] = useState(0);

  // Demo: a different Space is a different fixture (answers in place last for the life of the Space).
  useEffect(() => {
    if (!live) setLoaded(fixture(spaceId));
  }, [spaceId, live]);

  // Live: read again on a new Space, a retry, or a new language (themes are written in it).
  useEffect(() => {
    if (!live) return;
    let alive = true;
    setLoaded({ state: 'loading', landing: null });
    loadLiveRepository()
      .then((repo) => repo.landing(spaceId))
      .then((w) => {
        if (alive) setLoaded({ state: 'ready', landing: fromWire(w) });
      })
      .catch((e) => {
        if (!alive) return;
        const s = statusOf(e);
        setLoaded({ state: s === 403 || s === 404 ? 'empty' : 'error', landing: null });
      });
    return () => {
      alive = false;
    };
  }, [spaceId, live, tick, i18n.language]);

  const answerInPlace = useCallback((questionId: string, text: string, forEveryone: boolean) => {
    const reply: LandingAnswer = { text, forEveryone, at: new Date().toISOString() };
    setLoaded((l) =>
      l.landing ? { ...l, landing: { ...l.landing, questions: l.landing.questions.map((q) => (q.id === questionId ? { ...q, answer: reply } : q)) } } : l,
    );
  }, []);
  const retry = useCallback(() => setTick((t) => t + 1), []);

  return { ...loaded, answer: live ? undefined : answerInPlace, retry };
}
