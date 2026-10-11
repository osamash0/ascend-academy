/**
 * The truth behind the JOIN playground — a tiny, exact SQL join.
 *
 * SQL semantics on purpose, including the one students trip over: NULL never
 * equals anything, not even another NULL, so a NULL key never matches.
 */
import type { JoinPlaygroundProps } from './protocol';

export interface JoinPair {
  l: number | null; // left row index, or null when padded
  r: number | null; // right row index, or null when padded
}

export interface JoinResult {
  pairs: JoinPair[];
  leftIn: Set<number>; // left rows that appear in the result
  rightIn: Set<number>; // right rows that appear in the result
}

export function computeJoin(p: Pick<JoinPlaygroundProps, 'joinType' | 'left' | 'right' | 'on'>): JoinResult {
  const li = p.left.columns.indexOf(p.on.left);
  const ri = p.right.columns.indexOf(p.on.right);
  const pairs: JoinPair[] = [];
  const leftMatched = new Set<number>();
  const rightMatched = new Set<number>();

  p.left.rows.forEach((lrow, l) => {
    p.right.rows.forEach((rrow, r) => {
      const a = lrow[li];
      const b = rrow[ri];
      if (a !== null && b !== null && a === b) {
        pairs.push({ l, r });
        leftMatched.add(l);
        rightMatched.add(r);
      }
    });
  });

  if (p.joinType === 'LEFT' || p.joinType === 'FULL') {
    p.left.rows.forEach((_, l) => {
      if (!leftMatched.has(l)) pairs.push({ l, r: null });
    });
  }
  if (p.joinType === 'RIGHT' || p.joinType === 'FULL') {
    p.right.rows.forEach((_, r) => {
      if (!rightMatched.has(r)) pairs.push({ l: null, r });
    });
  }

  return {
    pairs,
    leftIn: new Set(pairs.flatMap((x) => (x.l === null ? [] : [x.l]))),
    rightIn: new Set(pairs.flatMap((x) => (x.r === null ? [] : [x.r]))),
  };
}
