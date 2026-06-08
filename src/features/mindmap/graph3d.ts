/**
 * Mind-map → 3D graph transform + force layout.
 *
 * The lecture mind map is a `TreeNode` hierarchy. To render it as a spatial
 * web we (1) flatten the tree into a flat node/link graph, (2) add cross-links
 * between concept nodes that recur across slides so the structure reads as a
 * *web* rather than a strict tree, and (3) run a d3-force-3d simulation to
 * convergence synchronously, freezing each node's [x, y, z] position.
 *
 * The simulation is run to completion in `computeGraphLayout` (not ticked live
 * in the render loop) so the r3f scene only ever renders static positions —
 * cheap, deterministic, and jitter-free. Idle motion is layered on in the
 * canvas via a gentle group rotation, not by re-simulating.
 */
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceRadial,
  type SimulationNode,
} from 'd3-force-3d';
import type { TreeNode } from '@/types/domain';

export type NodeType = TreeNode['type'];

export interface GraphNode extends SimulationNode {
  id: string;
  label: string;
  type: NodeType;
  summary?: string;
  /** Depth from the root (root = 0). Drives radial placement + node size. */
  depth: number;
  /** Number of graph edges touching this node — drives glow/size emphasis. */
  degree: number;
}

export interface GraphLink {
  source: string;
  target: string;
  /** `tree` = parent→child edge; `cross` = recurring-concept association. */
  kind: 'tree' | 'cross';
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

/** Visual + physics constants keyed by node type. */
export const NODE_RADIUS: Record<NodeType, number> = {
  root: 1.5,
  cluster: 1.0,
  slide: 0.6,
  concept: 0.45,
};

/**
 * Flatten the hierarchy into graph nodes + parent/child links, then synthesize
 * cross-links between concept nodes that share a normalized label (the same
 * idea appearing under multiple slides/clusters). Cross-links are what give the
 * layout its interconnected, non-tree feel.
 */
export function flattenTree(tree: TreeNode): GraphData {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const degree = new Map<string, number>();

  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);

  const walk = (node: TreeNode, depth: number) => {
    nodes.push({
      id: node.id,
      label: node.label,
      type: node.type,
      summary: node.summary,
      depth,
      degree: 0,
    });
    for (const child of node.children ?? []) {
      links.push({ source: node.id, target: child.id, kind: 'tree' });
      bump(node.id);
      bump(child.id);
      walk(child, depth + 1);
    }
  };
  walk(tree, 0);

  // Cross-link recurring concepts. Group concept nodes by normalized label;
  // when a label appears more than once, chain the occurrences together so the
  // shared idea visibly bridges otherwise-distant branches.
  const byLabel = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.type !== 'concept') continue;
    const key = n.label.trim().toLowerCase();
    if (!key) continue;
    const list = byLabel.get(key) ?? [];
    list.push(n.id);
    byLabel.set(key, list);
  }
  const seen = new Set<string>();
  for (const ids of byLabel.values()) {
    if (ids.length < 2) continue;
    for (let i = 1; i < ids.length; i++) {
      const a = ids[i - 1];
      const b = ids[i];
      const edgeKey = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(edgeKey)) continue;
      seen.add(edgeKey);
      links.push({ source: a, target: b, kind: 'cross' });
      bump(a);
      bump(b);
    }
  }

  for (const n of nodes) n.degree = degree.get(n.id) ?? 0;
  return { nodes, links };
}

export type PositionMap = Map<string, [number, number, number]>;

export interface LayoutResult {
  nodes: GraphNode[];
  links: GraphLink[];
  positions: PositionMap;
  /** Radius of the bounding sphere — used to frame the camera. */
  extent: number;
}

/**
 * Run the 3D force simulation to convergence and return frozen positions.
 *
 * Forces:
 *  - link: pulls connected nodes to a rest distance (cross-links a touch longer
 *    so recurring concepts arc between branches rather than collapsing onto it)
 *  - charge: many-body repulsion so nodes don't pile up
 *  - radial: seats each node on a shell sized by its depth (root at center →
 *    clusters → slides → concepts outward), giving the layout legible structure
 *  - center: keeps the whole graph centered on the origin
 */
export function computeGraphLayout(data: GraphData, iterations = 320): LayoutResult {
  const { nodes, links } = data;

  // Pin the root at the origin so the layout is stable across renders.
  const root = nodes.find((n) => n.depth === 0);
  if (root) {
    root.fx = 0;
    root.fy = 0;
    root.fz = 0;
  }

  const shell = (depth: number) => depth * 9;

  const sim = forceSimulation<GraphNode>(nodes, 3)
    .force(
      'link',
      forceLink<GraphNode>(links)
        .id((n) => n.id)
        .distance((l) => ((l as GraphLink).kind === 'cross' ? 14 : 8))
        .strength((l) => ((l as GraphLink).kind === 'cross' ? 0.15 : 0.6)),
    )
    .force('charge', forceManyBody().strength(-32).distanceMax(60))
    .force('radial', forceRadial((n) => shell((n as GraphNode).depth), 0, 0, 0).strength(0.45))
    .force('center', forceCenter(0, 0, 0).strength(0.04))
    .alphaDecay(0.018)
    .alphaMin(0.001);

  sim.stop();
  for (let i = 0; i < iterations; i++) sim.tick();
  sim.stop();

  const positions: PositionMap = new Map();
  let extent = 1;
  for (const n of nodes) {
    const x = n.x ?? 0;
    const y = n.y ?? 0;
    const z = n.z ?? 0;
    positions.set(n.id, [x, y, z]);
    extent = Math.max(extent, Math.hypot(x, y, z));
  }

  // d3-force's forceLink mutates each link in place, swapping the string
  // source/target ids for references to the resolved node objects. Restore
  // string ids so downstream consumers (edge geometry, adjacency) keep working.
  const idOf = (v: unknown): string =>
    typeof v === 'object' && v !== null ? (v as GraphNode).id : String(v);
  const normalizedLinks: GraphLink[] = links.map((l) => ({
    source: idOf(l.source),
    target: idOf(l.target),
    kind: l.kind,
  }));

  return { nodes, links: normalizedLinks, positions, extent };
}

/** Build an adjacency map (id → set of directly-connected ids) for hover highlight. */
export function buildAdjacency(links: GraphLink[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    const set = adj.get(a) ?? new Set<string>();
    set.add(b);
    adj.set(a, set);
  };
  for (const l of links) {
    add(l.source, l.target);
    add(l.target, l.source);
  }
  return adj;
}
