import { describe, expect, it } from 'vitest';
import { computeJoin } from '../join';
import { parseTurn } from '../protocol';
import { scriptedBrain } from '../scriptedBrain';

const base = {
  left: { name: 'students', columns: ['id', 'name'], rows: [[1, 'Ada'], [2, 'Ben'], [3, 'Mia'], [null, 'Zed']] },
  right: { name: 'enrollments', columns: ['student_id', 'course'], rows: [[1, 'DBS'], [1, 'Algo'], [null, 'Stats'], [5, 'Web']] },
  on: { left: 'id', right: 'student_id' },
};

describe('computeJoin', () => {
  it('INNER keeps only matched pairs, with one row per match', () => {
    const r = computeJoin({ ...base, joinType: 'INNER' });
    expect(r.pairs).toEqual([{ l: 0, r: 0 }, { l: 0, r: 1 }]);
  });

  it('NULL never matches NULL', () => {
    const r = computeJoin({ ...base, joinType: 'INNER' });
    expect(r.leftIn.has(3)).toBe(false);
    expect(r.rightIn.has(2)).toBe(false);
  });

  it('LEFT pads every unmatched left row', () => {
    const r = computeJoin({ ...base, joinType: 'LEFT' });
    expect([...r.leftIn].sort()).toEqual([0, 1, 2, 3]);
    expect(r.pairs.filter((p) => p.r === null).map((p) => p.l)).toEqual([1, 2, 3]);
  });

  it('RIGHT pads every unmatched right row', () => {
    const r = computeJoin({ ...base, joinType: 'RIGHT' });
    expect([...r.rightIn].sort()).toEqual([0, 1, 2, 3]);
    expect(r.leftIn).toEqual(new Set([0]));
  });

  it('FULL keeps everyone', () => {
    const r = computeJoin({ ...base, joinType: 'FULL' });
    expect(r.leftIn.size).toBe(4);
    expect(r.rightIn.size).toBe(4);
    expect(r.pairs).toHaveLength(2 + 3 + 2);
  });
});

describe('parseTurn — the model cannot ship a broken or untrusted widget', () => {
  it('accepts valid text + widget parts', () => {
    const parts = parseTurn(
      { parts: [{ type: 'text', text: 'hi' }, { type: 'widget', component: 'JoinPlayground', props: { ...base, joinType: 'LEFT' } }] },
      'fallback',
    );
    expect(parts.map((p) => p.type)).toEqual(['text', 'widget']);
  });

  it('rejects unknown components (no arbitrary UI)', () => {
    expect(parseTurn({ parts: [{ type: 'widget', component: 'RawHtml', props: { html: '<script>' } }] }, 'fb')).toEqual([{ type: 'text', text: 'fb' }]);
  });

  it('rejects a join on a column that does not exist', () => {
    const bad = { ...base, joinType: 'LEFT', on: { left: 'nope', right: 'student_id' } };
    expect(parseTurn({ parts: [{ type: 'widget', component: 'JoinPlayground', props: bad }] }, 'fb')[0]).toEqual({ type: 'text', text: 'fb' });
  });

  it('rejects a concept check with zero or two correct answers', () => {
    const opts = (a: boolean, b: boolean) => [{ text: 'a', correct: a, why: '' }, { text: 'b', correct: b, why: '' }];
    for (const [a, b] of [[false, false], [true, true]] as const) {
      const turn = { parts: [{ type: 'widget', component: 'ConceptCheck', props: { question: 'Which one?', options: opts(a, b), hint: 'h' } }] };
      expect(parseTurn(turn, 'fb')[0].type).toBe('text');
    }
  });

  it('falls back on garbage', () => {
    expect(parseTurn(null, 'fb')).toEqual([{ type: 'text', text: 'fb' }]);
    expect(parseTurn({ parts: 'nope' }, 'fb')).toEqual([{ type: 'text', text: 'fb' }]);
  });

  it('every scripted turn passes the same validation the real model will face', async () => {
    for (const q of ['How does a LEFT JOIN work?', 'primary key?', 'anything else']) {
      for (const lang of ['en', 'de']) {
        const raw = await scriptedBrain(q, lang);
        const parts = parseTurn(raw, '__fallback__');
        expect(parts.some((p) => p.type === 'text' && p.text === '__fallback__')).toBe(false);
      }
    }
  }, 20_000);
});
