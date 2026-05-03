import { describe, it, expect } from 'vitest';
import { normalizeTree, countNodes } from '@/features/mindmap/normalize';
import type { Slide } from '@/types/domain';

const slide = (id: string, n: number, title?: string): Slide => ({
  id,
  slide_number: n,
  title: title ?? `Slide ${n}`,
  content_text: null,
  summary: null,
});

describe('normalizeTree', () => {
  it('returns null for non-objects', () => {
    expect(normalizeTree(null)).toBeNull();
    expect(normalizeTree('hi')).toBeNull();
    expect(normalizeTree(42)).toBeNull();
  });

  it('coerces legacy {name, children} payloads to canonical TreeNode', () => {
    const tree = normalizeTree({
      name: 'Root',
      children: [{ name: 'A' }, { name: 'B', children: [{ name: 'B1' }] }],
    });
    expect(tree).not.toBeNull();
    expect(tree!.label).toBe('Root');
    expect(tree!.type).toBe('root');
    expect(tree!.children).toHaveLength(2);
    expect(tree!.children![1].children).toHaveLength(1);
  });

  it('keeps the canonical {id,label,type,children} shape intact', () => {
    const tree = normalizeTree({
      id: 'r',
      label: 'Lec',
      type: 'root',
      children: [{ id: 'c1', label: 'C', type: 'cluster', children: [] }],
    });
    expect(tree!.id).toBe('r');
    expect(tree!.children![0].id).toBe('c1');
    expect(tree!.children![0].type).toBe('cluster');
  });

  it('breaks cycles instead of recursing forever', () => {
    const a: any = { id: 'a', label: 'A', type: 'cluster', children: [] };
    const b: any = { id: 'b', label: 'B', type: 'cluster', children: [a] };
    a.children.push(b); // cycle a → b → a
    const tree = normalizeTree({ id: 'r', label: 'Root', type: 'root', children: [a] });
    expect(tree).not.toBeNull();
    expect(countNodes(tree!)).toBeGreaterThan(0);
    expect(countNodes(tree!)).toBeLessThan(50);
  });

  it('dedupes duplicate ids by remapping later occurrences', () => {
    const tree = normalizeTree({
      id: 'r',
      label: 'R',
      type: 'root',
      children: [
        { id: 'x', label: 'X1', type: 'concept' },
        { id: 'x', label: 'X2', type: 'concept' },
      ],
    });
    const ids = tree!.children!.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('appends missing slides under "Other slides" cluster', () => {
    const slides = [slide('s1', 1, 'Intro'), slide('s2', 2, 'Body'), slide('s3', 3, 'End')];
    const tree = normalizeTree(
      {
        id: 'r',
        label: 'R',
        type: 'root',
        children: [
          {
            id: 'c1',
            label: 'Topic',
            type: 'cluster',
            children: [{ id: 's1', label: 'Intro', type: 'slide' }],
          },
        ],
      },
      { slides },
    );
    // The "Other slides" cluster picks up s2 and s3.
    const other = tree!.children!.find((c) => c.label === 'Other slides');
    expect(other).toBeDefined();
    expect(other!.children).toHaveLength(2);
    const ids = other!.children!.map((c) => c.id).sort();
    expect(ids).toEqual(['s2', 's3']);
  });

  it('forces top-level type to root', () => {
    const tree = normalizeTree({ id: 'r', label: 'R', type: 'cluster', children: [] });
    expect(tree!.type).toBe('root');
  });

  it('uses lectureTitle as fallback label when input is unlabelled', () => {
    const tree = normalizeTree({ children: [] }, { lectureTitle: 'My Lecture' });
    expect(tree!.label).toBe('My Lecture');
  });
});
