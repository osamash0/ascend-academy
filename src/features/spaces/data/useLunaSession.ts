// src/features/spaces/data/useLunaSession.ts
import { useCallback, useEffect, useReducer, useRef } from 'react';
import i18n from '@/i18n';
import type { ExplainBlock } from '../components/reader/iui/spec';
import {
  lunaApi,
  type LunaCheck,
  type LunaEvent,
  type LunaMove,
  type LunaSessionRow,
  type LunaTurnRow,
  type LunaWrap,
  type PlanStep,
  type TurnBody,
} from './lunaSession';

export type ThreadItem =
  | { kind: 'learner'; id: string; text: string }
  | { kind: 'luna'; id: string; md: string; blocks: ExplainBlock[]; check: LunaCheck | null }
  | { kind: 'move'; id: string; move: LunaMove };

export interface LunaState {
  sessionId: string | null;
  /** The session's own Lesson; the reader may have followed Luna somewhere else. */
  lectureId: string | null;
  plan: PlanStep[];
  thread: ThreadItem[];
  busy: boolean;
  error: string | null;
  offerWrap: boolean;
  wrap: LunaWrap | null;
  kept: boolean;
  practiceAdded: number | null;
}

export const initialLuna: LunaState = {
  sessionId: null, lectureId: null, plan: [], thread: [], busy: false, error: null, offerWrap: false, wrap: null, kept: false, practiceAdded: null,
};

type Action =
  | { type: 'started'; session: LunaSessionRow; say: string }
  | { type: 'hydrated'; session: LunaSessionRow; turns: LunaTurnRow[] }
  | { type: 'learner'; id: string; text: string }
  | { type: 'event'; id: string; event: LunaEvent }
  | { type: 'busy'; busy: boolean }
  | { type: 'failed'; detail: string }
  | { type: 'wrapped'; wrap: LunaWrap }
  | { type: 'kept' }
  | { type: 'practised'; added: number }
  | { type: 'reset' };

/** Stored turns back into the column's thread: what was said, where Luna went. */
function threadFromTurns(turns: LunaTurnRow[]): { thread: ThreadItem[]; offerWrap: boolean } {
  const thread: ThreadItem[] = [];
  let offerWrap = false;
  for (const turn of turns) {
    const c = turn.content ?? {};
    if (turn.role === 'learner' && c.text) thread.push({ kind: 'learner', id: turn.id, text: c.text });
    else if (turn.role === 'move' && c.lecture_id && c.page)
      thread.push({ kind: 'move', id: turn.id, move: { lecture_id: c.lecture_id, page: c.page, ...(c.spot ? { spot: c.spot } : {}) } });
    else if (turn.role === 'luna') {
      thread.push({ kind: 'luna', id: turn.id, md: c.say ?? '', blocks: c.blocks ?? [], check: c.check ?? null });
      offerWrap = Boolean(c.offer_wrap);
    }
  }
  return { thread, offerWrap };
}

export function lunaReducer(state: LunaState, action: Action): LunaState {
  switch (action.type) {
    case 'started':
      return {
        ...initialLuna,
        sessionId: action.session.id,
        lectureId: action.session.lecture_id,
        plan: action.session.plan,
        thread: [{ kind: 'luna', id: 'start', md: action.say, blocks: [], check: null }],
      };
    case 'hydrated':
      return {
        ...initialLuna,
        sessionId: action.session.id,
        lectureId: action.session.lecture_id,
        plan: action.session.plan,
        wrap: action.session.wrap,
        kept: action.session.kept,
        ...threadFromTurns(action.turns),
      };
    case 'learner':
      return { ...state, error: null, thread: [...state.thread, { kind: 'learner', id: action.id, text: action.text }] };
    case 'busy':
      return { ...state, busy: action.busy, error: action.busy ? null : state.error };
    case 'failed':
      return { ...state, busy: false, error: action.detail };
    case 'wrapped':
      return { ...state, wrap: action.wrap, offerWrap: false };
    case 'kept':
      return { ...state, kept: true };
    case 'practised':
      return { ...state, practiceAdded: action.added };
    case 'reset':
      return initialLuna;
    case 'event': {
      const e = action.event;
      if (e.type === 'move') return { ...state, thread: [...state.thread, { kind: 'move', id: `${action.id}-m`, move: e.data }] };
      if (e.type === 'say')
        return { ...state, thread: [...state.thread, { kind: 'luna', id: `${action.id}-l`, md: e.data.md, blocks: [], check: null }] };
      if (e.type === 'blocks') {
        const thread = [...state.thread];
        const i = thread.map((t) => t.id).lastIndexOf(`${action.id}-l`);
        if (i >= 0 && thread[i].kind === 'luna') thread[i] = { ...thread[i], blocks: e.data.blocks, check: e.data.check } as ThreadItem;
        return { ...state, thread };
      }
      if (e.type === 'plan') return { ...state, plan: e.data.plan };
      if (e.type === 'end') return { ...state, busy: false, offerWrap: e.data.offer_wrap };
      return { ...state, busy: false, error: e.data.detail };
    }
  }
}

const errorText = (err: unknown) =>
  (err as { detail?: string }).detail || i18n.t('v4Luna:column.error');

/** A stream `error` event must never carry an empty message. */
export function normaliseEvent(event: LunaEvent): LunaEvent {
  if (event.type === 'error' && !event.data.detail) {
    return { type: 'error', data: { detail: i18n.t('v4Luna:column.error') } };
  }
  return event;
}

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function useLunaSession(opts: {
  spaceId: string;
  lessonId: string;
  onMove: (m: LunaMove) => void;
  readingAt: () => number;
  /** Luna is on and the column is open. Nothing is fetched otherwise. */
  active: boolean;
}) {
  const [state, dispatch] = useReducer(lunaReducer, initialLuna);
  const ref = useRef(state);
  ref.current = state;
  const abort = useRef<AbortController | null>(null);
  // Set synchronously: `ref.current.busy` only changes on render, so two calls in one tick would both pass it.
  const inFlight = useRef(false);
  const { onMove, readingAt, active, spaceId, lessonId } = opts;
  const lessonRef = useRef(lessonId);
  lessonRef.current = lessonId;

  /* Pick up where you left off: an active session for this Lesson resumes, never a new one. */
  useEffect(() => {
    if (!active || !spaceId || !lessonId || ref.current.sessionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const latest = (await lunaApi.sessions(spaceId)).sessions[0];
        if (cancelled || !latest || latest.status !== 'active' || latest.lecture_id !== lessonId) return;
        const out = await lunaApi.get(latest.id);
        if (cancelled || ref.current.sessionId) return;
        dispatch({ type: 'hydrated', session: out.session, turns: out.turns });
      } catch {
        /* nothing to resume is the same as a fresh start */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, spaceId, lessonId]);

  const run = useCallback(
    async (body: Omit<TurnBody, 'client_turn_id' | 'reading_at'>, echo?: string) => {
      const sid = ref.current.sessionId;
      if (!sid || ref.current.busy || inFlight.current) return;
      inFlight.current = true;
      const id = newId();
      if (echo) dispatch({ type: 'learner', id, text: echo });
      dispatch({ type: 'busy', busy: true });
      const controller = new AbortController();
      abort.current = controller;
      try {
        // Where the reader is only means something inside the session's own Lesson.
        const here = lessonRef.current === ref.current.lectureId ? { reading_at: readingAt() } : {};
        await lunaApi.turn(sid, { ...body, client_turn_id: id, ...here }, (event) => {
          if (controller.signal.aborted) return;
          if (event.type === 'move') onMove(event.data);
          dispatch({ type: 'event', id, event: normaliseEvent(event) });
        }, controller.signal);
      } catch (err) {
        if ((err as Error).name !== 'AbortError' && abort.current === controller) {
          dispatch({ type: 'failed', detail: errorText(err) });
        }
      } finally {
        inFlight.current = false;
        if (abort.current === controller && ref.current.busy) dispatch({ type: 'busy', busy: false });
      }
    },
    [onMove, readingAt],
  );

  const start = useCallback(
    async (opener: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      dispatch({ type: 'busy', busy: true });
      try {
        const out = await lunaApi.start({ space_id: opts.spaceId, lecture_id: opts.lessonId, page: readingAt(), opener });
        dispatch({ type: 'started', session: out.session, say: out.say });
        if (opener) dispatch({ type: 'learner', id: 'opener', text: opener });
      } catch (err) {
        dispatch({ type: 'failed', detail: errorText(err) });
      } finally {
        inFlight.current = false;
      }
    },
    [opts.spaceId, opts.lessonId, readingAt],
  );

  const wrapUp = useCallback(async () => {
    const sid = ref.current.sessionId;
    if (!sid || inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: 'busy', busy: true });
    try {
      const out = await lunaApi.wrap(sid);
      dispatch({ type: 'wrapped', wrap: out.wrap });
      dispatch({ type: 'busy', busy: false });
    } catch (err) {
      dispatch({ type: 'failed', detail: errorText(err) });
    } finally {
      inFlight.current = false;
    }
  }, []);

  return {
    state,
    start,
    send: (text: string) => run({ text }, text),
    act: (action: NonNullable<TurnBody['action']>, extra?: Pick<TurnBody, 'plan'>) => run({ action, ...extra }),
    answerCheck: (question: string, correct: boolean) => run({ action: 'continue', check_result: { question, correct } }),
    wrapUp,
    keep: async () => {
      try {
        if (ref.current.sessionId && (await lunaApi.keep(ref.current.sessionId))) dispatch({ type: 'kept' });
      } catch (err) {
        dispatch({ type: 'failed', detail: errorText(err) });
      }
    },
    practise: async () => {
      if (!ref.current.sessionId) return;
      try {
        const out = await lunaApi.practice(ref.current.sessionId);
        dispatch({ type: 'practised', added: out.added });
      } catch (err) {
        dispatch({ type: 'failed', detail: errorText(err) });
      }
    },
    close: () => {
      abort.current?.abort();
      abort.current = null;
      inFlight.current = false;
      dispatch({ type: 'reset' });
    },
  };
}
