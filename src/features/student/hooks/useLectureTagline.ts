import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import { useAiModel } from '@/hooks/use-ai-model';

interface TaglineResponse {
  tagline: string;
  cached: boolean;
}

/**
 * Fetches an AI-generated, one-line tagline for a lecture, derived from its
 * full slide content. Cached aggressively client-side (and server-side) so
 * browsing the carousel doesn't re-trigger generation.
 *
 * Experimental — backs the subtitle in the PS5-style course library.
 */
export function useLectureTagline(lectureId: string | undefined, enabled = true) {
  const { aiModel } = useAiModel();

  return useQuery({
    queryKey: ['lecture-tagline', lectureId],
    queryFn: async () => {
      const data = await apiClient.post<TaglineResponse>('/api/ai/lecture-tagline', {
        lecture_id: lectureId,
        ai_model: aiModel,
      });
      return data.tagline;
    },
    enabled: enabled && !!lectureId,
    staleTime: Infinity, // tagline is stable for a given lecture
    gcTime: 1000 * 60 * 30,
    retry: 1,
  });
}
