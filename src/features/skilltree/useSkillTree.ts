/**
 * Composes the skill tree from the student dashboard (courses/lectures/progress,
 * always available via Supabase) plus the optional concept backend (lecture
 * concepts + per-concept mastery). Concept calls are wrapped so a down or
 * un-ingested concept API degrades to a course → lecture tree rather than failing.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { useStudentDashboard } from '@/features/student/hooks/useStudentDashboard';
import {
  fetchStudentMastery,
  fetchLectureConcepts,
  type LectureConcept,
  type StudentMastery,
} from '@/services/conceptsService';
import { buildSkillTree, countSkills } from './skillTree';

interface ConceptBundle {
  lectureConcepts: Map<string, LectureConcept[]>;
  mastery: StudentMastery | null;
  available: boolean;
}

export function useSkillTree() {
  const { user } = useAuth();
  const { data: dashboard, isLoading: dashLoading } = useStudentDashboard();

  const lectures = dashboard?.lectures ?? [];
  const progress = dashboard?.progress ?? [];
  const userId = user?.id;

  // Stable, content-derived key so React Query caches across renders.
  const lectureIds = useMemo(() => lectures.map((l) => l.id).sort(), [lectures]);

  const { data: concepts, isLoading: conceptsLoading } = useQuery<ConceptBundle>({
    queryKey: ['skilltree-concepts', userId, lectureIds],
    enabled: !!userId && lectureIds.length > 0,
    staleTime: 1000 * 60 * 5,
    retry: false, // a down concept backend shouldn't retry-storm
    queryFn: async () => {
      const masteryPromise = fetchStudentMastery(userId!).catch(() => null);
      const conceptResults = await Promise.allSettled(
        lectureIds.map((id) => fetchLectureConcepts(id)),
      );
      const lectureConcepts = new Map<string, LectureConcept[]>();
      let available = false;
      conceptResults.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value.length) {
          lectureConcepts.set(lectureIds[i], r.value);
          available = true;
        }
      });
      const mastery = await masteryPromise;
      return { lectureConcepts, mastery, available };
    },
  });

  const tree = useMemo(
    () =>
      buildSkillTree({
        lectures,
        progress,
        lectureConcepts: concepts?.lectureConcepts,
        mastery: concepts?.mastery ?? null,
      }),
    [lectures, progress, concepts],
  );

  const counts = useMemo(() => countSkills(tree), [tree]);

  return {
    tree,
    counts,
    loading: dashLoading,
    conceptsLoading,
    conceptsAvailable: !!concepts?.available,
    hasContent: lectures.length > 0,
  };
}
