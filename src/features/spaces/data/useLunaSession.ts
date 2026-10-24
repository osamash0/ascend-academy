// src/features/spaces/data/useLunaSession.ts
import { useCallback, useReducer, useRef } from 'react';
import i18n from '@/i18n';
import type { ExplainBlock } from '../components/reader/iui/spec';
import {
  lunaApi,
  type LunaCheck,
  type LunaEvent,
  type LunaMove,
  type LunaSessionRow,
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
  sessionId: null, plan: [], thread: [], busy: false, error: null, offerWrap: false, wrap: null, kept: false, practiceAdded: null,
};

type Action =
  | { type: 'started'; session: LunaSessionRow; say: string }
  | { type: 'learner'; id: string; text: string }
  | { type: 'event'; id: string; event: LunaEvent }
  | { type: 'busy'; busy: boolean }
  | { type: 'failed'; detail: string }
  | { type: 'wrapped'; wrap: LunaWrap }
  | { type: 'kept' }
  | { type: 'practised'; added: number }
  | { type: 'reset' };

export function lunaReducer(state: LunaState, action: Action): LunaState {
  switch (action.type) {
    case 'started':
      return {
        ...initialLuna,
        sessionId: action.session.id,
        plan: action.session.plan,
        thread: [{ kind: 'luna', id: 'start', md: action.say, blocks: [], check: null }],
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
}) {
  const [state, dispatch] = useReducer(lunaReducer, initialLuna);
  const ref = useRef(state);
  ref.current = state;
  const abort = useRef<AbortController | null>(null);
  // Set synchronously: `ref.current.busy` only changes on render, so two calls in one tick would both pass it.
  const inFlight = useRef(false);
  const { onMove, readingAt } = opts;

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
        await lunaApi.turn(sid, { ...body, client_turn_id: id, reading_at: readingAt() }, (event) => {
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
