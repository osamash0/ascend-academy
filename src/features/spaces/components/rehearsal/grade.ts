import type { RehearsalQuestion } from '../../data/liveRepository';
import { closureOf, fdText, violations } from '../reader/iui/fd';

/**
 * Grading a rehearsal answer.
 *
 * The tool questions are graded by computing the answer — which FDs the rows
 * actually satisfy, what the closure actually is, which FDs actually break
 * BCNF — so a mistake in the question's writing cannot become a mistake in
 * the grade. Choice and order are graded against the slides' answer.
 *
 * Pure: no DOM, no React.
 */

export type Answer =
  | { kind: 'choice'; index: number }
  | { kind: 'order'; order: number[] }
  | { kind: 'fdHolds'; holds: number[] }
  | { kind: 'closure'; attrs: string[] }
  | { kind: 'bcnf'; violating: number[] };

export interface Grade {
  correct: boolean;
  /** The right answer, said in a line. */
  expected: string;
}

const sameSet = <T>(a: T[], b: T[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Indices of the candidate FDs that hold on the question's rows. */
export function holdingCandidates(q: Extract<RehearsalQuestion, { kind: 'fdHolds' }>): number[] {
  return q.candidates.flatMap((fd, i) => (violations(q.columns, q.rows, fd).length === 0 ? [i] : []));
}

/** Indices of the FDs whose left side is not a superkey of the relation (and which are non-trivial). */
export function bcnfViolations(q: Extract<RehearsalQuestion, { kind: 'bcnf' }>): number[] {
  return q.fds.flatMap((fd, i) => {
    const trivial = fd.rhs.every((a) => fd.lhs.includes(a));
    const superkey = q.attrs.every((a) => closureOf(fd.lhs, q.fds).includes(a));
    return !trivial && !superkey ? [i] : [];
  });
}

export function closureAnswer(q: Extract<RehearsalQuestion, { kind: 'closure' }>): string[] {
  const c = closureOf(q.start, q.fds);
  return q.attrs.filter((a) => c.includes(a));
}

export function grade(q: RehearsalQuestion, a: Answer): Grade {
  switch (q.kind) {
    case 'choice': {
      const right = q.options.findIndex((o) => o.correct);
      return { correct: a.kind === 'choice' && a.index === right, expected: q.options[right]?.text ?? '' };
    }
    case 'order':
      return {
        correct: a.kind === 'order' && a.order.every((v, i) => v === i),
        expected: q.items.join(' → '),
      };
    case 'fdHolds': {
      const holds = holdingCandidates(q);
      return {
        correct: a.kind === 'fdHolds' && sameSet(a.holds, holds),
        expected: holds.length ? `Holds: ${holds.map((i) => fdText(q.candidates[i])).join('; ')}` : 'None of them holds',
      };
    }
    case 'closure': {
      const c = closureAnswer(q);
      return {
        correct: a.kind === 'closure' && sameSet(a.attrs, c),
        expected: `{${q.start.join(', ')}}⁺ = {${c.join(', ')}}`,
      };
    }
    case 'bcnf': {
      const v = bcnfViolations(q);
      return {
        correct: a.kind === 'bcnf' && sameSet(a.violating, v),
        expected: v.length ? `Violating: ${v.map((i) => fdText(q.fds[i])).join('; ')}` : 'None violates BCNF',
      };
    }
  }
}
