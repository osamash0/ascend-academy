/**
 * Functional dependencies, computed — the engine under the answer tools.
 *
 * Pure functions over attribute names, so the live table, the closure
 * calculator and the BCNF decomposer all compute what they show rather than
 * replay a script. Small on purpose: the relations on a page have a
 * handful of attributes, and clarity beats cleverness at that size.
 */

export interface FD {
  lhs: string[];
  rhs: string[];
}

export const fdText = (fd: FD) => `${fd.lhs.join(', ')} → ${fd.rhs.join(', ')}`;

/** Pairs of rows that agree on `lhs` but not on `rhs` — the witnesses against `lhs → rhs`. */
export function violations(columns: string[], rows: string[][], fd: FD): [number, number][] {
  const li = fd.lhs.map((a) => columns.indexOf(a)).filter((i) => i >= 0);
  const ri = fd.rhs.map((a) => columns.indexOf(a)).filter((i) => i >= 0);
  if (li.length === 0 || ri.length === 0) return [];
  const norm = (v: string) => v.trim().toLowerCase();
  const out: [number, number][] = [];
  for (let a = 0; a < rows.length; a++) {
    for (let b = a + 1; b < rows.length; b++) {
      const sameL = li.every((i) => norm(rows[a][i] ?? '') === norm(rows[b][i] ?? ''));
      if (!sameL) continue;
      const sameR = ri.every((i) => norm(rows[a][i] ?? '') === norm(rows[b][i] ?? ''));
      if (!sameR) out.push([a, b]);
    }
  }
  return out;
}

export interface ClosureStep {
  /** The set before this step. */
  before: string[];
  /** The FD that fired, or null for the starting set. */
  fired: FD | null;
  /** What it added. */
  added: string[];
  after: string[];
}

/** X⁺ under `fds`, as the sequence of steps the A⁺ algorithm takes. */
export function closureSteps(start: string[], fds: FD[]): ClosureStep[] {
  const set = new Set(start);
  const steps: ClosureStep[] = [{ before: [], fired: null, added: [...start], after: [...start] }];
  let changed = true;
  const used = new Set<number>();
  while (changed) {
    changed = false;
    fds.forEach((fd, i) => {
      if (used.has(i)) return;
      if (!fd.lhs.every((a) => set.has(a))) return;
      used.add(i);
      const added = fd.rhs.filter((a) => !set.has(a));
      if (added.length === 0) return;
      const before = [...set];
      added.forEach((a) => set.add(a));
      steps.push({ before, fired: fd, added, after: [...set] });
      changed = true;
    });
  }
  return steps;
}

export const closureOf = (start: string[], fds: FD[]) => {
  const steps = closureSteps(start, fds);
  return steps[steps.length - 1].after;
};

/** The FDs that hold on a projection onto `attrs`, as closures of its subsets — fine at this size. */
export function projectFds(attrs: string[], fds: FD[]): FD[] {
  const out: FD[] = [];
  const n = attrs.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const lhs = attrs.filter((_, i) => mask & (1 << i));
    if (lhs.length === n) continue;
    const rhs = closureOf(lhs, fds).filter((a) => attrs.includes(a) && !lhs.includes(a));
    if (rhs.length) out.push({ lhs, rhs });
  }
  return out;
}

const isSuperkey = (lhs: string[], attrs: string[], fds: FD[]) => {
  const c = closureOf(lhs, fds);
  return attrs.every((a) => c.includes(a));
};

export interface Relation {
  name: string;
  attrs: string[];
}

export interface BcnfStep {
  /** The relations after this step. */
  relations: Relation[];
  /** The relation that was split, the FD that broke BCNF there, and the two halves. */
  split: { from: Relation; by: FD; into: [Relation, Relation] } | null;
}

/** The BCNF decomposition, one split at a time. Names the halves R1, R2, … in order. */
export function bcnfSteps(start: Relation, fds: FD[]): BcnfStep[] {
  let relations = [start];
  const steps: BcnfStep[] = [{ relations, split: null }];
  let counter = 1;
  for (let guard = 0; guard < 12; guard++) {
    let did = false;
    for (const r of relations) {
      const local = projectFds(r.attrs, fds);
      const bad = local.find((fd) => !isSuperkey(fd.lhs, r.attrs, local));
      if (!bad) continue;
      const left = closureOf(bad.lhs, local).filter((a) => r.attrs.includes(a));
      const right = r.attrs.filter((a) => !left.includes(a) || bad.lhs.includes(a));
      const a: Relation = { name: `R${counter++}`, attrs: left };
      const b: Relation = { name: `R${counter++}`, attrs: right };
      relations = relations.flatMap((x) => (x === r ? [a, b] : [x]));
      steps.push({ relations, split: { from: r, by: { lhs: bad.lhs, rhs: left.filter((x) => !bad.lhs.includes(x)) }, into: [a, b] } });
      did = true;
      break;
    }
    if (!did) break;
  }
  return steps;
}
