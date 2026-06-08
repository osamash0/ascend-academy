import { describe, it, expect } from 'vitest';
import type { TreeNode } from '@/types/domain';
import {
  flattenTree,
  computeGraphLayout,
  buildAdjacency,
} from '@/features/mindmap/graph3d';

function tree(): TreeNode {
  return {
    id: 'root',
    label: 'Lecture',
    type: 'root',
    children: [
      {
        id: 'c-1',
        label: 'Topic A',
        type: 'cluster',
        children: [
          {
            id: 's-1',
            label: 'Slide 1',
            type: 'slide',
            children: [{ id: 'k-1', label: 'Gradient Descent', type: 'concept' }],
          },
        ],
      },
      {
        id: 'c-2',
        label: 'Topic B',
        type: 'cluster',
        children: [
          {
            id: 's-2',
            label: 'Slide 2',
            type: 'slide',
            // Same concept label as under c-1 → should produce a cross-link.
            children: [{ id: 'k-2', label: 'gradient descent', type: 'concept' }],
          },
        ],
      },
    ],
  };
}

describe('flattenTree', () => {
  it('emits one node per tree node with correct depth', () => {
    const { nodes } = flattenTree(tree());
    expect(nodes).toHaveLength(7);
    expect(nodes.find((n) => n.id === 'root')!.depth).toBe(0);
    expect(nodes.find((n) => n.id === 'c-1')!.depth).toBe(1);
    expect(nodes.find((n) => n.id === 's-1')!.depth).toBe(2);
    expect(nodes.find((n) => n.id === 'k-1')!.depth).toBe(3);
  });

  it('creates parent/child tree links plus a cross-link for the recurring concept', () => {
    const { links } = flattenTree(tree());
    const treeLinks = links.filter((l) => l.kind === 'tree');
    const crossLinks = links.filter((l) => l.kind === 'cross');
    expect(treeLinks).toHaveLength(6); // 6 parent→child edges in a 7-node tree
    expect(crossLinks).toHaveLength(1);
    const ids = [crossLinks[0].source, crossLinks[0].target].sort();
    expect(ids).toEqual(['k-1', 'k-2']);
  });

  it('does not cross-link unique concepts', () => {
    const t: TreeNode = {
      id: 'root',
      label: 'L',
      type: 'root',
      children: [{ id: 'k', label: 'Unique', type: 'concept' }],
    };
    expect(flattenTree(t).links.filter((l) => l.kind === 'cross')).toHaveLength(0);
  });
});

describe('computeGraphLayout', () => {
  it('produces finite positions for every node and pins the root at origin', () => {
    const data = flattenTree(tree());
    const { positions, extent } = computeGraphLayout(data, 80);
    expect(positions.size).toBe(data.nodes.length);
    for (const [, p] of positions) {
      expect(p.every((v) => Number.isFinite(v))).toBe(true);
    }
    const root = positions.get('root')!;
    expect(root[0]).toBeCloseTo(0, 5);
    expect(root[1]).toBeCloseTo(0, 5);
    expect(root[2]).toBeCloseTo(0, 5);
    expect(extent).toBeGreaterThan(0);
  });

  it('returns links with STRING source/target ids (d3-force mutates them to objects in place)', () => {
    // Regression: forceLink swaps string ids for node-object refs during the
    // sim. If we leak those, edge geometry + adjacency silently break (no
    // edges render). computeGraphLayout must normalize them back to ids.
    const data = flattenTree(tree());
    const { links, positions } = computeGraphLayout(data, 50);
    for (const l of links) {
      expect(typeof l.source).toBe('string');
      expect(typeof l.target).toBe('string');
      // Every link endpoint must resolve to a known position.
      expect(positions.has(l.source)).toBe(true);
      expect(positions.has(l.target)).toBe(true);
    }
  });

  it('pushes deeper nodes farther from the origin than shallow ones (on average)', () => {
    const data = flattenTree(tree());
    const { positions } = computeGraphLayout(data, 200);
    const r = (id: string) => {
      const [x, y, z] = positions.get(id)!;
      return Math.hypot(x, y, z);
    };
    // Concept (depth 3) should sit outside the cluster (depth 1) shell.
    expect(r('k-1')).toBeGreaterThan(r('c-1'));
  });
});

describe('buildAdjacency', () => {
  it('is symmetric across every edge', () => {
    const { links } = flattenTree(tree());
    const adj = buildAdjacency(links);
    for (const l of links) {
      expect(adj.get(l.source)!.has(l.target)).toBe(true);
      expect(adj.get(l.target)!.has(l.source)).toBe(true);
    }
  });
});
