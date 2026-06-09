/**
 * Skill-tree model: turns a student's courses / lectures / progress / concept
 * mastery into a 4-tier tree of "owned skills" with sequential game-locks.
 *
 *   root → course → ( lecture → lecture-concept )   (the learning path)
 *                 └ course-concept                    (deduped concept roll-up)
 *
 * Everything here is pure and synchronous so it can be unit-tested without any
 * network or React. The renderer (`SkillTreeView`) lays this out with
 * d3-hierarchy and animates it with anime.js.
 *
 * Reliability: concept data comes from a separate backend that may be down or
 * un-ingested. When `lectureConcepts`/`mastery` are empty the tree still builds
 * cleanly as course → lecture (concept tiers are simply absent).
 */
import type { CourseSummary, Lecture, StudentProgress } from '@/types/domain';
import type { LectureConcept, StudentMastery } from '@/services/conceptsService';

export type SkillNodeKind =
  | 'root'
  | 'course'
  | 'course-concept'
  | 'lecture'
  | 'lecture-concept';

/** locked → available → in_progress → owned */
export type SkillNodeState = 'locked' | 'available' | 'in_progress' | 'owned';

export interface SkillNode {
  id: string;
  label: string;
  kind: SkillNodeKind;
  state: SkillNodeState;
  /** 0..1 fill for the in_progress ring (slide % for lectures, mastery for concepts). */
  progress?: number;
  /** Lecture id, for navigation (lecture nodes only). */
  lectureId?: string;
  /** Canonical concept id (concept nodes only). */
  conceptId?: string;
  /** Mastery detail for tooltips (concept nodes). */
  mastery?: { attempts: number; correct: number; score: number };
  /** Short description for the info panel (lecture nodes). */
  desc?: string;
  /** Roll-up counts for the info panel (course nodes). */
  meta?: { owned: number; total: number };
  children?: SkillNode[];
}

export interface SkillTreeInput {
  /** Lectures the student can see (each carries `course` + `course_id`). */
  lectures: Lecture[];
  progress: StudentProgress[];
  /** lectureId → its concepts. Missing/empty when the concept API is unavailable. */
  lectureConcepts?: Map<string, LectureConcept[]>;
  mastery?: StudentMastery | null;
  /** Optional course titles by id (fallback when a lecture lacks a hydrated course). */
  courseTitleById?: Map<string, string>;
  options?: { lockAcrossCourses?: boolean };
}

const UNCATEGORIZED = '__uncategorized__';
const MASTERY_SCORE = 0.7;
const MASTERY_MIN_ATTEMPTS = 2;

/** Stable lecture ordering: there's no curriculum-order column, so use created_at then id. */
export function orderLectures(lectures: Lecture[]): Lecture[] {
  return [...lectures].sort((a, b) => {
    const t = (a.created_at ?? '').localeCompare(b.created_at ?? '');
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });
}

/** Intrinsic lecture state from progress alone (before applying sequential locks). */
function lectureProgressState(
  p: StudentProgress | undefined,
  totalSlides: number,
): { reached: boolean; state: SkillNodeState | 'none'; progress: number } {
  if (p?.completed_at) return { reached: true, state: 'owned', progress: 1 };
  const visited =
    (p?.slide_states ? Object.keys(p.slide_states).length : 0) ||
    (p?.completed_slides?.length ?? 0);
  if (visited > 0) {
    const pct = totalSlides > 0 ? Math.min(1, visited / totalSlides) : 0;
    return { reached: true, state: 'in_progress', progress: pct };
  }
  return { reached: false, state: 'none', progress: 0 };
}

export function buildSkillTree(input: SkillTreeInput): SkillNode {
  const { lectures, progress, lectureConcepts, mastery, courseTitleById, options } = input;

  const progressByLecture = new Map(progress.map((p) => [p.lecture_id, p]));

  // Concept mastery lookups.
  const masteryById = new Map(mastery?.vector.map((m) => [m.concept_id, m]) ?? []);
  const masteredIds = new Set(mastery?.mastered.map((m) => m.concept_id) ?? []);

  const conceptState = (
    conceptId: string,
    parentReached: boolean,
  ): { state: SkillNodeState; progress: number; mastery?: SkillNode['mastery'] } => {
    const m = masteryById.get(conceptId);
    const detail = m
      ? { attempts: m.attempts, correct: m.correct, score: m.mastery_score }
      : undefined;
    if (!parentReached) return { state: 'locked', progress: m?.mastery_score ?? 0, mastery: detail };
    const owned =
      masteredIds.has(conceptId) ||
      (!!m && m.mastery_score >= MASTERY_SCORE && m.attempts >= MASTERY_MIN_ATTEMPTS);
    if (owned) return { state: 'owned', progress: 1, mastery: detail };
    if (m && m.attempts >= 1) return { state: 'in_progress', progress: m.mastery_score, mastery: detail };
    return { state: 'available', progress: 0, mastery: detail };
  };

  // Group lectures by course.
  const byCourse = new Map<string, { title: string; description?: string | null; lectures: Lecture[] }>();
  for (const lec of lectures) {
    const courseId = lec.course_id ?? UNCATEGORIZED;
    const title =
      lec.course?.title ?? courseTitleById?.get(courseId) ?? 'Uncategorized';
    const description = lec.course?.description ?? null;
    const entry = byCourse.get(courseId) ?? { title, description, lectures: [] };
    entry.lectures.push(lec);
    byCourse.set(courseId, entry);
  }

  const courseNodes: SkillNode[] = [];

  for (const [courseId, group] of byCourse) {
    const ordered = orderLectures(group.lectures);
    const ownedLectureIds = new Set<string>();

    // First pass: intrinsic lecture states + which lectures are "reached".
    const intrinsic = ordered.map((lec) =>
      lectureProgressState(progressByLecture.get(lec.id), lec.total_slides ?? 0),
    );
    ordered.forEach((lec, i) => {
      if (intrinsic[i].state === 'owned') ownedLectureIds.add(lec.id);
    });

    // Second pass: apply sequential locks + build lecture nodes with concepts.
    const lectureNodes: SkillNode[] = ordered.map((lec, i) => {
      const intr = intrinsic[i];
      let state: SkillNodeState;
      if (intr.state !== 'none') {
        state = intr.state; // owned / in_progress are always "reached"
      } else {
        const prevOwned = i === 0 || intrinsic[i - 1].state === 'owned';
        state = prevOwned ? 'available' : 'locked';
      }
      const reached = state === 'owned';

      const concepts = lectureConcepts?.get(lec.id) ?? [];
      const conceptNodes: SkillNode[] = concepts.map((c) => {
        const cs = conceptState(c.concept_id, reached);
        return {
          id: `lc:${lec.id}:${c.concept_id}`,
          label: c.name,
          kind: 'lecture-concept',
          state: cs.state,
          progress: cs.progress,
          conceptId: c.concept_id,
          mastery: cs.mastery,
        };
      });

      return {
        id: `lecture:${lec.id}`,
        label: lec.title,
        kind: 'lecture',
        state,
        progress: intr.progress,
        lectureId: lec.id,
        desc: lec.description ?? undefined,
        children: conceptNodes.length ? conceptNodes : undefined,
      };
    });

    // Course-concept roll-up: dedupe concepts across the course's lectures.
    // A roll-up concept is "reached" if it appears in any owned lecture.
    const rollup = new Map<string, { name: string; reached: boolean }>();
    for (const lec of ordered) {
      const isOwned = ownedLectureIds.has(lec.id);
      for (const c of lectureConcepts?.get(lec.id) ?? []) {
        const prev = rollup.get(c.concept_id);
        rollup.set(c.concept_id, {
          name: c.name,
          reached: (prev?.reached ?? false) || isOwned,
        });
      }
    }
    const courseConceptNodes: SkillNode[] = [...rollup.entries()].map(([conceptId, info]) => {
      const cs = conceptState(conceptId, info.reached);
      return {
        id: `cc:${courseId}:${conceptId}`,
        label: info.name,
        kind: 'course-concept',
        state: cs.state,
        progress: cs.progress,
        conceptId,
        mastery: cs.mastery,
      };
    });

    // Course capstone state.
    const allOwned = ordered.length > 0 && ordered.every((l) => ownedLectureIds.has(l.id));
    const anyTouched = lectureNodes.some(
      (n) => n.state === 'owned' || n.state === 'in_progress',
    );
    const courseState: SkillNodeState = allOwned
      ? 'owned'
      : anyTouched
        ? 'in_progress'
        : 'available';

    const courseChildren = [...lectureNodes, ...courseConceptNodes];
    courseNodes.push({
      id: `course:${courseId}`,
      label: group.title,
      kind: 'course',
      state: courseState,
      desc: group.description ?? undefined,
      progress: ordered.length
        ? ordered.filter((l) => ownedLectureIds.has(l.id)).length / ordered.length
        : 0,
      meta: { owned: ordered.filter((l) => ownedLectureIds.has(l.id)).length, total: ordered.length },
      children: courseChildren.length ? courseChildren : undefined,
    });
  }

  // Optional cross-course locking: a course is locked until the previous course
  // (by first lecture's created_at) has any owned lecture. Default: off.
  if (options?.lockAcrossCourses) {
    courseNodes.forEach((node, i) => {
      if (i === 0) return;
      const prev = courseNodes[i - 1];
      const prevStarted = prev.state === 'owned' || prev.state === 'in_progress';
      if (!prevStarted && node.state === 'available') node.state = 'locked';
    });
  }

  return {
    id: 'root',
    label: 'My Skills',
    kind: 'root',
    state: 'owned',
    children: courseNodes,
  };
}

/**
 * Count earned vs total visible "skill" leaves (lectures + lecture-concepts).
 * Course-concepts are a hidden roll-up (not rendered), so they're excluded to
 * keep the header counter matching what's on screen.
 */
export function countSkills(root: SkillNode): { owned: number; total: number } {
  let owned = 0;
  let total = 0;
  const walk = (n: SkillNode) => {
    if (n.kind === 'lecture' || n.kind === 'lecture-concept') {
      total += 1;
      if (n.state === 'owned') owned += 1;
    }
    n.children?.forEach(walk);
  };
  walk(root);
  return { owned, total };
}
