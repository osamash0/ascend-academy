import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import type { TreeNode } from '@/types/domain';

export type { TreeNode };

export function useMindMap(lectureId: string | null) {
  const queryClient = useQueryClient();

  const map = useQuery({
    queryKey: ['mind-map', lectureId],
    queryFn: async (): Promise<TreeNode | null> => {
      if (!lectureId) return null;
      const json = await apiClient.get<{ data: TreeNode | null }>(`/api/mind-map/${lectureId}`);
      return json.data ?? null;
    },
    enabled: !!lectureId,
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const generate = useMutation({
    mutationFn: async (aiModel: string = 'groq') => {
      if (!lectureId) throw new Error('No lecture ID');
      const json = await apiClient.post<{ data: TreeNode }>(`/api/mind-map/${lectureId}/generate`, { ai_model: aiModel });
      return json.data;
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
