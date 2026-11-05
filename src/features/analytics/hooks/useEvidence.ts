import { useQuery } from '@tanstack/react-query';
import { getInsightEvidence } from '@/services/analyticsService';
import type { InsightEvidence } from '@/features/analytics/types';

/** Fetch Layer-3 evidence for an open drawer. Lazy — only runs once opened. */
export function useEvidence(
  lectureId: string | null,
  kind: string | null,
  params: { slideId?: string },
) {
  return useQuery<InsightEvidence>({
    queryKey: ['analytics', 'evidence', lectureId, kind, params.slideId],
    queryFn: () => getInsightEvidence(lectureId as string, kind as string, params),
    enabled: !!lectureId && !!kind && !!params.slideId,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });
}
