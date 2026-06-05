import { useQuery } from '@tanstack/react-query';
import { getLectureInsights } from '@/services/analyticsService';
import type { InsightFeed } from '@/features/analytics/types';

/** Fetch the ranked insight feed for the Insight Garden. */
export function useInsights(lectureId: string | null) {
  return useQuery<InsightFeed>({
    queryKey: ['analytics', 'insights', lectureId],
    queryFn: () => getLectureInsights(lectureId as string),
    enabled: !!lectureId,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    retry: (failureCount, error: unknown) => {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('401') || msg.includes('403') || msg.includes('404')) return false;
      return failureCount < 2;
    },
  });
}
