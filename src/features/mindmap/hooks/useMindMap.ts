import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import type { TreeNode, Slide } from '@/types/domain';
import { normalizeTree } from '@/features/mindmap/normalize';

export type { TreeNode };

export function useMindMap(
  lectureId: string | null,
  opts: { slides?: Slide[]; lectureTitle?: string } = {},
) {
  const queryClient = useQueryClient();

  const map = useQuery({
    queryKey: ['mind-map', lectureId],
    queryFn: async (): Promise<TreeNode | null> => {
      if (!lectureId) return null;
      const json = await apiClient.get<{ data: unknown }>(`/api/mind-map/${lectureId}`);
      if (json.data == null) return null;
      return normalizeTree(json.data, opts);
    },
    enabled: !!lectureId,
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const generate = useMutation({
    mutationFn: async (aiModel: string = 'groq') => {
      if (!lectureId) throw new Error('No lecture ID');
      const json = await apiClient.post<{ data: unknown }>(`/api/mind-map/${lectureId}/generate`, { ai_model: aiModel });
      return normalizeTree(json.data, opts);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['mind-map', lectureId], data);
    },
    onError: (error) => {
      console.error('Mind map generation error:', error);
    },
  });

  return { map, generate };
}
