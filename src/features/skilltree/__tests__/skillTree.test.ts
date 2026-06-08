import { describe, it, expect } from 'vitest';
import type { Lecture, StudentProgress } from '@/types/domain';
import type { LectureConcept, StudentMastery } from '@/services/conceptsService';
import {
  buildSkillTree,
  countSkills,
  orderLectures,
  type SkillNode,
} from '@/features/skilltree/skillTree';

function lec(over: Partial<Lecture> & { id: string }): Lecture {
  return {
    title: over.id,
    description: null,
    total_slides: 10,
    created_at: '2026-01-01',
    course_id: 'c1',
    course: { id: 'c1', title: 'SQL' } as any,
    ...over,
  } as Lecture;
}

function prog(over: Partial<StudentProgress> & { lecture_id: string }): StudentProgress {
  return {
    completed_slides: [],
    quiz_score: 0,
    total_questions_answered: 0,
    correct_answers: 0,
    ...over,
  } as StudentProgress;
}

const find = (root: SkillNode, id: string): SkillNode | undefined => {
  if (root.id === id) return root;
  for (const c of root.children ?? []) {
    const hit = find(c, id);
    if (hit) return hit;
  }
  return undefined;
};

describe('orderLectures', () => {
  it('orders by created_at then id', () => {
    const out = orderLectures([
      lec({ id: 'b', created_at: '2026-02-01' }),
      lec({ id: 'a', created_at: '2026-01-01' }),
      lec({ id: 'a2', created_at: '2026-01-01' }),
    ]);
    expect(out.map((l) => l.id)).toEqual(['a', 'a2', 'b']);
  });
});

describe('buildSkillTree — sequential locks', () => {
  const lectures = [
    lec({ id: 'l1', created_at: '2026-01-01' }),
    lec({ id: 'l2', created_at: '2026-01-02' }),
    lec({ id: 'l3', created_at: '2026-01-03' }),
  ];

  it('first lecture is available, later ones locked until the previous is owned', () => {
    const tree = buildSkillTree({ lectures, progress: [] });
    expect(find(tree, 'lecture:l1')!.state).toBe('available');
    expect(find(tree, 'lecture:l2')!.state).toBe('locked');
    expect(find(tree, 'lecture:l3')!.state).toBe('locked');
  });

  it('completing lecture 1 unlocks lecture 2 (but not 3)', () => {
    const tree = buildSkillTree({
      lectures,
      progress: [prog({ lecture_id: 'l1', completed_at: '2026-01-05' })],
    });
    expect(find(tree, 'lecture:l1')!.state).toBe('owned');
    expect(find(tree, 'lecture:l2')!.state).toBe('available');
    expect(find(tree, 'lecture:l3')!.state).toBe('locked');
  });

  it('marks a partially-viewed lecture in_progress with a slide fraction', () => {
    const tree = buildSkillTree({
      lectures,
      progress: [prog({ lecture_id: 'l1', slide_states: { '0': 'visited', '1': 'visited' } })],
    });
    const l1 = find(tree, 'lecture:l1')!;
    expect(l1.state).toBe('in_progress');
    expect(l1.progress).toBeCloseTo(0.2, 5); // 2 of 10 slides
  });
});

describe('buildSkillTree — concepts & mastery', () => {
  const lectures = [lec({ id: 'l1', created_at: '2026-01-01' })];
  const lectureConcepts = new Map<string, LectureConcept[]>([
    ['l1', [
      { concept_id: 'k-join', name: 'JOINs', weight: 2, slide_indices: [1] },
      { concept_id: 'k-index', name: 'Indexes', weight: 1, slide_indices: [2] },
    ]],
  ]);

  it('locks lecture-concepts until the parent lecture is owned', () => {
    const tree = buildSkillTree({ lectures, progress: [], lectureConcepts });
    expect(find(tree, 'lc:l1:k-join')!.state).toBe('locked');
  });

  it('owns a concept that is mastered once its lecture is owned; others become available', () => {
    const mastery: StudentMastery = {
      vector: [{ concept_id: 'k-join', name: 'JOINs', attempts: 3, correct: 3, mastery_score: 0.9 }],
      mastered: [{ concept_id: 'k-join', name: 'JOINs', attempts: 3, correct: 3, mastery_score: 0.9 }],
      weak: [],
    };
    const tree = buildSkillTree({
      lectures,
      progress: [prog({ lecture_id: 'l1', completed_at: '2026-02-01' })],
      lectureConcepts,
      mastery,
    });
    expect(find(tree, 'lc:l1:k-join')!.state).toBe('owned');
    expect(find(tree, 'lc:l1:k-index')!.state).toBe('available');
  });

  it('rolls up deduped course-concepts off the course node', () => {
    const tree = buildSkillTree({ lectures, progress: [], lectureConcepts });
    expect(find(tree, 'cc:c1:k-join')!.kind).toBe('course-concept');
    expect(find(tree, 'cc:c1:k-index')!.kind).toBe('course-concept');
  });
});

describe('buildSkillTree — course capstone', () => {
  it('course is owned only when all its lectures are owned', () => {
    const lectures = [
      lec({ id: 'l1', created_at: '2026-01-01' }),
      lec({ id: 'l2', created_at: '2026-01-02' }),
    ];
    const partial = buildSkillTree({
      lectures,
      progress: [prog({ lecture_id: 'l1', completed_at: '2026-01-05' })],
    });
    expect(find(partial, 'course:c1')!.state).toBe('in_progress');

    const full = buildSkillTree({
      lectures,
      progress: [
        prog({ lecture_id: 'l1', completed_at: '2026-01-05' }),
        prog({ lecture_id: 'l2', completed_at: '2026-01-06' }),
      ],
    });
    expect(find(full, 'course:c1')!.state).toBe('owned');
  });
});

describe('buildSkillTree — graceful degradation', () => {
  it('builds course → lecture with no concept data', () => {
    const tree = buildSkillTree({
      lectures: [lec({ id: 'l1' })],
      progress: [],
    });
    const lectureNode = find(tree, 'lecture:l1')!;
    expect(lectureNode.children).toBeUndefined(); // no concept children
    expect(find(tree, 'course:c1')!.children).toHaveLength(1); // just the lecture
  });

  it('buckets lectures with no course under Uncategorized', () => {
    const tree = buildSkillTree({
      lectures: [lec({ id: 'l1', course_id: null, course: null })],
      progress: [],
    });
    expect(find(tree, 'course:__uncategorized__')!.label).toBe('Uncategorized');
  });
});

describe('countSkills', () => {
  it('counts owned vs total skill leaves', () => {
    const lectures = [lec({ id: 'l1', created_at: '2026-01-01' })];
    const lectureConcepts = new Map<string, LectureConcept[]>([
      ['l1', [{ concept_id: 'k1', name: 'A', weight: 1, slide_indices: [] }]],
    ]);
    const tree = buildSkillTree({
      lectures,
      progress: [prog({ lecture_id: 'l1', completed_at: '2026-02-01' })],
      lectureConcepts,
    });
    const { owned, total } = countSkills(tree);
    // counts only visible leaves: lecture l1 (owned) + lecture-concept k1 (available).
    // course-concept roll-up is excluded.
    expect(owned).toBe(1);
    expect(total).toBe(2);
  });
});
