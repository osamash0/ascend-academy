import { describe, it, expect } from 'vitest';
import type { Lecture } from '@/types/domain';
import { buildKnowledgeMapTree } from '@/features/mindmap/knowledgeMapTree';

function lec(over: Partial<Lecture>): Lecture {
  return {
    id: 'l',
    title: 'Lecture',
    description: null,
    total_slides: 0,
    created_at: '2026-01-01',
    ...over,
  } as Lecture;
}

describe('buildKnowledgeMapTree', () => {
  it('groups lectures into one cluster per course under a single root', () => {
    const lectures = [
      lec({ id: 'l1', title: 'Intro', course_id: 'c1', course: { id: 'c1', title: 'Biology' } as any }),
      lec({ id: 'l2', title: 'Cells', course_id: 'c1', course: { id: 'c1', title: 'Biology' } as any }),
      lec({ id: 'l3', title: 'Atoms', course_id: 'c2', course: { id: 'c2', title: 'Chemistry' } as any }),
    ];
    const tree = buildKnowledgeMapTree(lectures);

    expect(tree.type).toBe('root');
    expect(tree.children).toHaveLength(2);

    const bio = tree.children!.find((c) => c.label === 'Biology')!;
    expect(bio.type).toBe('cluster');
    expect(bio.id).toBe('course:c1');
    expect(bio.children!.map((l) => l.id).sort()).toEqual(['l1', 'l2']);
    expect(bio.children!.every((l) => l.type === 'slide')).toBe(true);
  });

  it('uses the raw lecture id for leaf nodes so clicks resolve to a lecture route', () => {
    const tree = buildKnowledgeMapTree([
      lec({ id: 'lecture-abc', title: 'X', course_id: 'c1', course: { id: 'c1', title: 'C' } as any }),
    ]);
    const leaf = tree.children![0].children![0];
    expect(leaf.id).toBe('lecture-abc'); // not prefixed — onSlideClick gets the lecture id directly
  });

  it('carries the lecture description into the node summary', () => {
    const tree = buildKnowledgeMapTree([
      lec({ id: 'l1', title: 'X', description: 'About X', course_id: 'c1', course: { id: 'c1', title: 'C' } as any }),
    ]);
    expect(tree.children![0].children![0].summary).toBe('About X');
  });

  it('buckets lectures without a course into an Uncategorized cluster', () => {
    const tree = buildKnowledgeMapTree([lec({ id: 'l1', title: 'Orphan', course_id: null })]);
    expect(tree.children).toHaveLength(1);
    expect(tree.children![0].label).toBe('Uncategorized');
    expect(tree.children![0].id).toBe('course:__uncategorized__');
  });

  it('returns a childless root when there are no lectures', () => {
    const tree = buildKnowledgeMapTree([]);
    expect(tree.children).toEqual([]);
  });
});
