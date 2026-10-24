import { describe, expect, it, vi } from 'vitest';
import { lunaEnabled, parseSse } from '../data/lunaSession';

describe('parseSse', () => {
  it('reads complete events and carries a partial one to the next chunk', () => {
    const first = parseSse('event: move\ndata: {"lecture_id":"l","page":4}\n\nevent: say\ndata: {"md":"Lo', '');
    expect(first.events).toEqual([{ type: 'move', data: { lecture_id: 'l', page: 4 } }]);
    const second = parseSse('ok here."}\n\n', first.carry);
    expect(second.events).toEqual([{ type: 'say', data: { md: 'Look here.' } }]);
    expect(second.carry).toBe('');
  });

  it('skips events whose data is not JSON', () => {
    expect(parseSse('event: say\ndata: not json\n\n', '').events).toEqual([]);
  });
});

describe('lunaEnabled', () => {
  it('is off without the flag, in demo mode, and for fixture ids', () => {
    vi.stubEnv('VITE_FEATURE_LUNA_SESSIONS', '');
    expect(lunaEnabled('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002')).toBe(false);
    vi.stubEnv('VITE_FEATURE_LUNA_SESSIONS', '1');
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    expect(lunaEnabled('space-dbs', 'lesson-1')).toBe(false);
    expect(lunaEnabled('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002')).toBe(true);
    vi.unstubAllEnvs();
  });
});
