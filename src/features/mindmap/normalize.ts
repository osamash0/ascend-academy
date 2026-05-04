/**
 * Mind-map tree normaliser.
 *
 * The backend has shipped at least three different shapes for the cached
 * tree_data payload (legacy `{name,children}`, partial `{label,...}`,
 * canonical `{id,label,type,children}`), and AI output occasionally contains
 * cycles, missing ids, or drops slides. This module is the single point that
 * coerces any of those into the canonical `TreeNode` the renderer expects, or
 * returns null when the payload is hopelessly broken.
 *
 * Guarantees on the returned tree (when non-null):
 *  - Every node has a stable, unique `id`, a non-empty `label`, and a `type`
 *    in {root,cluster,slide,concept}.
 *  - No cycles; depth capped to MAX_DEPTH.
 *  - When `slides` are passed in, every slide.id appears as a `slide` node
 *    somewhere in the tree (missing ones are appended under an "Other slides"
 *    cluster so the student never silently loses content).
 */
import type { TreeNode } from '@/types/domain';
import type { Slide } from '@/types/domain';

const MAX_DEPTH = 6;
const MAX_NODES = 600;

type LooseNode = {
  id?: unknown;
  label?: unknown;
  name?: unknown;
  title?: unknown;
  type?: unknown;
  summary?: unknown;
  description?: unknown;
  children?: unknown;
  nodes?: unknown;
};

function asString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  if (typeof v === 'number') return String(v);
  return undefined;
}

function asType(v: unknown): TreeNode['type'] {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  if (s === 'root' || s === 'cluster' || s === 'slide' || s === 'concept') return s;
  return 'concept';
}

function coerce(
  raw: unknown,
  depth: number,
  seen: Set<string>,
  ids: Set<string>,
  counter: { n: number },
): TreeNode | null {
  if (counter.n >= MAX_NODES) return null;
  if (depth > MAX_DEPTH) return null;
  if (raw == null || typeof raw !== 'object') return null;
  const node = raw as LooseNode;

  const label =
    asString(node.label) ?? asString(node.name) ?? asString(node.title) ?? 'Untitled';
  const type = asType(node.type);
  const summary = asString(node.summary) ?? asString(node.description);

  // Stable id: prefer provided id; if duplicate or missing, derive one.
  let id = asString(node.id);
  if (!id || ids.has(id)) {
    id = `${type}-${counter.n}`;
    while (ids.has(id)) id = `${type}-${counter.n}-${Math.random().toString(36).slice(2, 6)}`;
  }

  // Cycle guard: if this id is already in the active path, skip.
  if (seen.has(id)) return null;
  ids.add(id);
  seen.add(id);
  counter.n += 1;

  const childrenIn = Array.isArray(node.children)
    ? node.children
    : Array.isArray(node.nodes)
      ? node.nodes
      : [];

  const children: TreeNode[] = [];
  for (const child of childrenIn) {
    const c = coerce(child, depth + 1, seen, ids, counter);
    if (c) children.push(c);
    if (counter.n >= MAX_NODES) break;
  }

  seen.delete(id);

  const result: TreeNode = { id, label, type, children };
  if (summary) result.summary = summary;
  return result;
}

/**
 * Coerce arbitrary input into a canonical TreeNode (or null).
 * If `slides` is provided and any slide.id is missing from the tree, the
 * missing slides are appended under an "Other slides" cluster.
 */
export function normalizeTree(
  raw: unknown,
  opts: { slides?: Slide[]; lectureTitle?: string } = {},
): TreeNode | null {
  const ids = new Set<string>();
  const counter = { n: 0 };
  const tree = coerce(raw, 0, new Set(), ids, counter);

  if (!tree) return null;

  // Root coercion: top-level node should be `root`.
  if (tree.type !== 'root') {
    tree.type = 'root';
  }
  if (opts.lectureTitle && (!tree.label || tree.label === 'Untitled')) {
    tree.label = opts.lectureTitle;
  }

  if (opts.slides && opts.slides.length > 0) {
    const present = new Set<string>();
    const walk = (n: TreeNode) => {
      if (n.type === 'slide') present.add(n.id);
      n.children?.forEach(walk);
    };
    walk(tree);

    const missing = opts.slides.filter((s) => !present.has(s.id));
    if (missing.length > 0) {
      const otherId = `cluster-other-${ids.size}`;
      tree.children = [
        ...(tree.children ?? []),
        {
          id: otherId,
          label: 'Other slides',
          type: 'cluster',
          children: missing.map((s) => ({
            id: s.id,
            label: s.title || `Slide ${s.slide_number}`,
            type: 'slide' as const,
            summary: s.summary ?? undefined,
          })),
        },
      ];
    }
  }

  return tree;
}

/** Total node count — useful for tests and analytics. */
export function countNodes(tree: TreeNode): number {
  let n = 1;
  for (const c of tree.children ?? []) n += countNodes(c);
  return n;
}
