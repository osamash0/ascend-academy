import { describe, expect, it } from 'vitest';
import { mark, pageProgress, reset, retry, stateOf, termKey, termsIn, tryAgain, type RecallState } from '../recall';
import type { CanvasBlock } from '../types';

const empty: RecallState = { on: true, terms: {} };
const blocks = [
  { id: 's1', origin: 'summary', markdown: 'A **b** and **c d**.' },
  { id: 'e1', origin: 'extracted', markdown: 'Has **ignored** term.' },
  { id: 'w1', origin: 'written', markdown: '**nope**' },
  { id: 'g1', origin: 'generated', markdown: '**nope**' },
] as unknown as CanvasBlock[];

describe('recall state', () => {
  it('finds the **term** texts in order', () => {
    expect(termsIn('A **b** and **c d**.')).toEqual(['b', 'c d']);
    expect(termsIn('none here')).toEqual([]);
  });
  it('marks and reads back; unknown is blank', () => {
    expect(stateOf(empty, 'x:0')).toBe('blank');
    const s = mark(empty, termKey('x', 0), 'knew');
    expect(stateOf(s, 'x:0')).toBe('knew');
    expect(empty.terms).toEqual({});
  });
  it('counts only summary blocks', () => {
    let s = mark(empty, 's1:0', 'knew');
    s = mark(s, 'e1:0', 'knew');
    expect(pageProgress(blocks, s)).toEqual({ knew: 1, total: 2 });
  });
  it('tryAgain, retry and reset', () => {
    let s = mark(mark(empty, 'a:0', 'notYet'), 'a:1', 'knew');
    expect(tryAgain(s)).toEqual(['a:0']);
    const r = retry(s);
    expect(stateOf(r, 'a:0')).toBe('blank');
    expect(stateOf(r, 'a:1')).toBe('knew');
    s = reset(s);
    expect(s.terms).toEqual({});
    expect(s.on).toBe(true);
  });
});
