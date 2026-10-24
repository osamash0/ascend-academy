// src/features/spaces/data/lunaSession.ts
import type { ExplainBlock } from '../components/reader/iui/spec';
import i18n from '@/i18n';
import { isLive } from './useReader';
import { dataMode } from './liveRepository';

/**
 * Luna study sessions — the API and its event stream.
 *
 * Live only: a session is a real model reading the learner's real slides,
 * so in demo mode nothing here is reachable (`lunaEnabled` is false) and no
 * Luna UI renders. A turn answers as Server-Sent Events over a POST, which
 * `EventSource` cannot send with our auth header — hence `fetch` + a reader.
 */

export type StepKind = 'look' | 'explain' | 'ask' | 'connect' | 'check' | 'teachback';
export type StepStatus = 'todo' | 'current' | 'done' | 'skipped';
export interface PlanStep {
  id: string;
  kind: StepKind;
  title: string;
  target: { lecture_id: string; page: number };
  status: StepStatus;
}
export interface LunaMove {
  lecture_id: string;
  page: number;
  spot?: string;
}
export interface LunaCheck {
  question: string;
  options: { text: string; correct: boolean; why: string }[];
}
export interface WrapItem {
  text: string;
  lecture_id: string | null;
  page: number | null;
}
export interface LunaWrap {
  covered: WrapItem[];
  clicked: WrapItem[];
  shaky: WrapItem[];
}
export interface LunaSessionRow {
  id: string;
  space_id: string;
  lecture_id: string | null;
  goal: string;
  plan: PlanStep[];
  status: 'active' | 'wrapped' | 'abandoned';
  wrap: LunaWrap | null;
  kept: boolean;
  turn_count: number;
  updated_at: string;
}
export type LunaEvent =
  | { type: 'move'; data: LunaMove }
  | { type: 'say'; data: { md: string } }
  | { type: 'blocks'; data: { blocks: ExplainBlock[]; check: LunaCheck | null } }
  | { type: 'plan'; data: { plan: PlanStep[] } }
  | { type: 'end'; data: { turn_count: number; offer_wrap: boolean } }
  | { type: 'error'; data: { detail: string } };
export interface MemoryLine {
  id: string;
  kind: 'preference' | 'shaky' | 'strong' | 'goal';
  space_id: string | null;
  text: string;
  active: boolean;
}
export interface DueCard {
  card_id: string;
  lecture_id: string;
  front: { question: string; options: string[]; page: number | null };
  back: { correct: number; why: string[] };
}
export interface TurnBody {
  client_turn_id: string;
  text?: string;
  action?: 'accept_plan' | 'skip_step' | 'edit_plan' | 'continue' | 'end';
  plan?: { id: string; title?: string }[];
  reading_at?: number;
  check_result?: { question: string; correct: boolean };
}

const KNOWN = new Set(['move', 'say', 'blocks', 'plan', 'end', 'error']);

/** Split a stream chunk into complete events; an unfinished one is carried over. */
export function parseSse(chunk: string, carry: string): { events: LunaEvent[]; carry: string } {
  const parts = (carry + chunk).split('\n\n');
  const rest = parts.pop() ?? '';
  const events: LunaEvent[] = [];
  for (const part of parts) {
    let type = '';
    let data = '';
    for (const line of part.split('\n')) {
      if (line.startsWith('event: ')) type = line.slice(7).trim();
      else if (line.startsWith('data: ')) data += line.slice(6);
    }
    if (!KNOWN.has(type)) continue;
    try {
      events.push({ type, data: JSON.parse(data) } as LunaEvent);
    } catch {
      /* a malformed event is dropped, never shown */
    }
  }
  return { events, carry: rest };
}

export function lunaEnabled(spaceId?: string, lessonId?: string): boolean {
  return import.meta.env.VITE_FEATURE_LUNA_SESSIONS === '1' && isLive(spaceId, lessonId);
}

/** Luna is on and the data is real — for screens that have no Space or Lesson ids yet. */
export function lunaLive(): boolean {
  if (import.meta.env.VITE_FEATURE_LUNA_SESSIONS !== '1') return false;
  try {
    return dataMode(import.meta.env.VITE_V4_DATA_MODE) === 'live';
  } catch {
    return false;
  }
}

const root = '/api/v1/v4/luna';
const lang = () => i18n.language?.split('-')[0] || 'en';
const q = async (path: string) => `${path}${path.includes('?') ? '&' : '?'}lang=${lang()}`;

async function client() {
  return (await import('@/lib/apiClient')).apiClient;
}

export const lunaApi = {
  start: async (body: { space_id: string; lecture_id: string; page: number; opener: string }) =>
    (await client()).post<{ session: LunaSessionRow; say: string }>(await q(`${root}/sessions`), body),

  turn: async (sessionId: string, body: TurnBody, onEvent: (e: LunaEvent) => void, signal?: AbortSignal) => {
    const res = await (await client()).stream(await q(`${root}/sessions/${sessionId}/turn`), body, signal);
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let carry = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const parsed = parseSse(decoder.decode(value, { stream: true }), carry);
      carry = parsed.carry;
      parsed.events.forEach(onEvent);
    }
  },

  wrap: async (id: string) =>
    (await client()).post<{ wrap: LunaWrap; memory: { id: string; kind: string; text: string }[] }>(
      await q(`${root}/sessions/${id}/wrap`),
      {},
    ),
  keep: async (id: string) => (await client()).post<{ kept: true }>(await q(`${root}/sessions/${id}/keep`), {}),
  practice: async (id: string) => (await client()).post<{ added: number }>(await q(`${root}/sessions/${id}/practice`), {}),
  sessions: async (spaceId: string) =>
    (await client()).get<{ sessions: LunaSessionRow[] }>(await q(`${root}/sessions?space_id=${encodeURIComponent(spaceId)}`)),
  memory: async () => (await client()).get<{ memory: MemoryLine[] }>(await q(`${root}/memory`)),
  editMemory: async (id: string, text: string) => (await client()).patch<MemoryLine>(await q(`${root}/memory/${id}`), { text }),
  deleteMemory: async (id: string) => (await client()).delete<{ deleted: true }>(await q(`${root}/memory/${id}`)),
  forgetAll: async () => (await client()).delete<{ deleted: number }>(await q(`${root}/memory`)),
  due: async (lectureId?: string) =>
    (await client()).get<{ cards: DueCard[]; total: number }>(
      await q(`${root}/practice/due${lectureId ? `?lecture_id=${lectureId}` : ''}`),
    ),
  grade: async (cardId: string, rating: 1 | 2 | 3 | 4) =>
    (await client()).post<{ card_id: string; due_at: string }>(await q(`${root}/practice/${cardId}/grade`), { rating }),
};
