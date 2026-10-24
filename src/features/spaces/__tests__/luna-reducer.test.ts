import { describe, expect, it } from 'vitest';
import { initialLuna, lunaReducer, normaliseEvent } from '../data/useLunaSession';
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

  it('an error event with no detail still says something', () => {
    const event = normaliseEvent({ type: 'error', data: { detail: '' } });
    const s = lunaReducer(initialLuna, { type: 'event', id: 't1', event });
    expect(s.error).toBeTruthy();
    expect(normaliseEvent({ type: 'error', data: { detail: 'x' } })).toEqual({ type: 'error', data: { detail: 'x' } });
  });

  it('a resumed session rebuilds its thread, plan and wrap offer from the stored turns', () => {
    const session = {
      id: 's9', space_id: 'sp', lecture_id: 'L1', goal: 'exam', plan: [step('s1', 'current')], status: 'active',
      wrap: null, kept: false, turn_count: 2, updated_at: '',
    } as const;
    const s = lunaReducer(initialLuna, {
      type: 'hydrated',
      session: { ...session, plan: [...session.plan] },
      turns: [
        { id: 't0', role: 'learner', content: { text: 'exam soon' }, created_at: '' },
        { id: 't1', role: 'luna', content: { say: 'A plan.' }, created_at: '' },
        { id: 't2', role: 'learner', content: { action: 'accept_plan' } as never, created_at: '' },
        { id: 't3', role: 'move', content: { lecture_id: 'L1', page: 4, spot: 'agree on X' }, created_at: '' },
        { id: 't4', role: 'luna', content: { say: 'Look here.', blocks: [], check: { question: 'Q', options: [] }, offer_wrap: true }, created_at: '' },
      ],
    });
    expect(s.sessionId).toBe('s9');
    expect(s.lectureId).toBe('L1');
    expect(s.plan[0].status).toBe('current');
    expect(s.thread).toEqual([
      { kind: 'learner', id: 't0', text: 'exam soon' },
      { kind: 'luna', id: 't1', md: 'A plan.', blocks: [], check: null },
      { kind: 'move', id: 't3', move: { lecture_id: 'L1', page: 4, spot: 'agree on X' } },
      { kind: 'luna', id: 't4', md: 'Look here.', blocks: [], check: { question: 'Q', options: [] } },
    ]);
    expect(s.offerWrap).toBe(true);
    expect(s.busy).toBe(false);
  });

  it('a started session remembers its Lesson', () => {
    const s = lunaReducer(initialLuna, { type: 'started', session: { id: 's1', lecture_id: 'L1', plan: [] } as never, say: 'hi' });
    expect(s.lectureId).toBe('L1');
  });
});
