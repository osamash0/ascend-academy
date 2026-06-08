/**
 * Build an aggregate "knowledge map" `TreeNode` from a student's lectures.
 *
 * Unlike the per-lecture mind map (root → clusters → slides → concepts), the
 * Learning Insights map is cross-course: root → one cluster per course → one
 * node per lecture. Lecture nodes use `type: 'slide'` so they're the clickable,
 * navigable leaves (clicking opens the lecture). Lecture node ids are the raw
 * lecture id; course node ids are prefixed so they can't collide with them.
 */
import type { Lecture, TreeNode } from '@/types/domain';

const UNCATEGORIZED = '__uncategorized__';

export function buildKnowledgeMapTree(
  lectures: Lecture[],
  rootLabel = 'Knowledge Map',
): TreeNode {
  const byCourse = new Map<string, { title: string; lectures: Lecture[] }>();

  for (const lec of lectures) {
    const courseId = lec.course_id ?? UNCATEGORIZED;
    const title = lec.course?.title ?? 'Uncategorized';
    const entry = byCourse.get(courseId) ?? { title, lectures: [] };
    entry.lectures.push(lec);
    byCourse.set(courseId, entry);
  }

  const children: TreeNode[] = [...byCourse.entries()].map(([courseId, group]) => ({
    id: `course:${courseId}`,
    label: group.title,
    type: 'cluster',
    children: group.lectures.map((lec) => ({
      id: lec.id,
      label: lec.title,
      type: 'slide',
      summary: lec.description ?? undefined,
    })),
  }));

  return { id: 'root', label: rootLabel, type: 'root', children };
}
