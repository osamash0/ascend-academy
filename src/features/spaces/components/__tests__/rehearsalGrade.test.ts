import { describe, expect, it } from 'vitest';
import { bcnfViolations, closureAnswer, grade, holdingCandidates } from '../rehearsal/grade';
import type { RehearsalQuestion } from '../../data/liveRepository';

const base = { id: 1, lecture_id: 'l', page: 1, idea: 'i', prompt: 'p', why: '' };

describe('rehearsal answers are graded by computing them', () => {
  it('grades which FDs hold from the rows, not from a key', () => {
    const q = {
      ...base,
      kind: 'fdHolds',
      columns: ['A', 'B', 'C'],
      rows: [['1', 'x', 'p'], ['1', 'x', 'q'], ['2', 'y', 'p']],
      candidates: [{ lhs: ['A'], rhs: ['B'] }, { lhs: ['A'], rhs: ['C'] }],
    } as Extract<RehearsalQuestion, { kind: 'fdHolds' }>;
    expect(holdingCandidates(q)).toEqual([0]);
    expect(grade(q, { kind: 'fdHolds', holds: [0] }).correct).toBe(true);
    expect(grade(q, { kind: 'fdHolds', holds: [0, 1] }).correct).toBe(false);
  });

  it('computes the closure, whatever the question claimed', () => {
    const q = {
      ...base,
      kind: 'closure',
      attrs: ['A', 'B', 'C', 'D'],
      fds: [{ lhs: ['A'], rhs: ['B'] }, { lhs: ['B'], rhs: ['C'] }],
      start: ['A'],
    } as Extract<RehearsalQuestion, { kind: 'closure' }>;
    expect(closureAnswer(q)).toEqual(['A', 'B', 'C']);
    expect(grade(q, { kind: 'closure', attrs: ['C', 'A', 'B'] }).correct).toBe(true);
    expect(grade(q, { kind: 'closure', attrs: ['A', 'B', 'C', 'D'] }).correct).toBe(false);
  });

  it('flags exactly the non-trivial FDs whose left side is not a superkey', () => {
    const q = {
      ...base,
      kind: 'bcnf',
      relation: 'R',
      attrs: ['A', 'B', 'C'],
      fds: [{ lhs: ['A'], rhs: ['B', 'C'] }, { lhs: ['B'], rhs: ['C'] }, { lhs: ['B', 'C'], rhs: ['C'] }],
    } as Extract<RehearsalQuestion, { kind: 'bcnf' }>;
    expect(bcnfViolations(q)).toEqual([1]);
  });

  it('grades order and choice against the slides', () => {
    const order = { ...base, kind: 'order', items: ['a', 'b', 'c'], shuffle: [2, 0, 1] } as RehearsalQuestion;
    expect(grade(order, { kind: 'order', order: [0, 1, 2] }).correct).toBe(true);
    expect(grade(order, { kind: 'order', order: [2, 0, 1] }).correct).toBe(false);
    const choice = { ...base, kind: 'choice', options: [{ text: 'x' }, { text: 'y', correct: true }] } as RehearsalQuestion;
    expect(grade(choice, { kind: 'choice', index: 1 })).toEqual({ correct: true, expected: 'y' });
  });
});
