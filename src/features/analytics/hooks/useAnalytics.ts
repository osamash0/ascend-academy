import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

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
    staleTime: 1000 * 60,
    refetchOnWindowFocus: false,
  });

  return { dashboard };
}
