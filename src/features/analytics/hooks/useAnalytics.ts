import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import { getProfessorOverview, type ProfessorOverview } from '@/services/analyticsService';

export function useProfessorOverview(courseId: string | null, days = 7) {
  return useQuery<ProfessorOverview>({
    queryKey: ['analytics', 'professor-overview', courseId, days],
    queryFn: () => getProfessorOverview(courseId as string, days),
    enabled: !!courseId,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    retry: (failureCount, error: unknown) => {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('401') || msg.includes('403') || msg.includes('404')) return false;
      return failureCount < 2;
    },
  });
}

export function useAnalytics(lectureId: string | null) {
  const dashboard = useQuery({
    queryKey: ['analytics', 'dashboard', lectureId],
    queryFn: async () => {
      if (!lectureId) return null;
      const json = await apiClient.get<{ data: unknown }>(`/api/analytics/lecture/${lectureId}/dashboard`);
      return json.data;
    },
    enabled: !!lectureId,
    retry: (failureCount, error: unknown) => {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('401') || msg.includes('404')) return false;
      return failureCount < 2;
    },
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  return { dashboard };
}
