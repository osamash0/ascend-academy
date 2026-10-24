import { describe, expect, it } from 'vitest';
import { initialLuna, lunaReducer } from '../data/useLunaSession';
import type { PlanStep } from '../data/lunaSession';

const step = (id: string, status: PlanStep['status']): PlanStep => ({
  id, kind: 'look', title: id, target: { lecture_id: 'l', page: 1 }, status,
});

describe('lunaReducer', () => {
  it('builds the thread from events in arrival order', () => {
    let s = lunaReducer(initialLuna, {
      type: 'started',
      session: { id: 's1', plan: [step('s1', 'todo')] } as never,
      say: 'Here is a plan.',
    });
    expect(s.sessionId).toBe('s1');
    expect(s.thread).toEqual([{ kind: 'luna', id: 'start', md: 'Here is a plan.', blocks: [], check: null }]);
    s = lunaReducer(s, { type: 'learner', id: 't1', text: 'ok' });
    s = lunaReducer(s, { type: 'busy', busy: true });
    s = lunaReducer(s, { type: 'event', id: 't1', event: { type: 'move', data: { lecture_id: 'l', page: 4 } } });
    s = lunaReducer(s, { type: 'event', id: 't1', event: { type: 'say', data: { md: 'Look here.' } } });
    s = lunaReducer(s, { type: 'event', id: 't1', event: { type: 'blocks', data: { blocks: [], check: { question: 'Q', options: [] } } } });
    s = lunaReducer(s, { type: 'event', id: 't1', event: { type: 'plan', data: { plan: [step('s1', 'current')] } } });
    s = lunaReducer(s, { type: 'event', id: 't1', event: { type: 'end', data: { turn_count: 1, offer_wrap: true } } });
    expect(s.thread.map((t) => t.kind)).toEqual(['luna', 'learner', 'move', 'luna']);
    expect((s.thread[3] as { check: unknown }).check).toEqual({ question: 'Q', options: [] });
    expect(s.plan[0].status).toBe('current');
    expect(s.busy).toBe(false);
    expect(s.offerWrap).toBe(true);
  });

  it('an error ends the turn and says so without losing the thread', () => {
    let s = lunaReducer(initialLuna, { type: 'learner', id: 't1', text: 'hi' });
    s = lunaReducer(s, { type: 'busy', busy: true });
    s = lunaReducer(s, { type: 'event', id: 't1', event: { type: 'error', data: { detail: 'I lost my thread.' } } });
    expect(s.busy).toBe(false);
    expect(s.error).toBe('I lost my thread.');
    expect(s.thread).toHaveLength(1);
  });
});
