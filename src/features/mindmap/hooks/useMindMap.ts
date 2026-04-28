import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface TreeNode {
  id: string;
  label: string;
  type: 'root' | 'cluster' | 'slide' | 'concept';
  summary?: string;
  children?: TreeNode[];
}

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('No session');
  return { Authorization: `Bearer ${session.access_token}` };
}

export function useMindMap(lectureId: string | null) {
  const queryClient = useQueryClient();

  const map = useQuery({
    queryKey: ['mind-map', lectureId],
    queryFn: async (): Promise<TreeNode | null> => {
      if (!lectureId) return null;
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/mind-map/${lectureId}`, { headers });
      if (!res.ok) throw new Error('Failed to fetch mind map');
      const json = await res.json();
      return json.data ?? null;
    },
    enabled: !!lectureId,
    staleTime: 1000 * 60 * 10, // Mind maps rarely change — 10 min cache
    refetchOnWindowFocus: false,
    retry: false,
  });

  const generate = useMutation({
    mutationFn: async (aiModel: string = 'groq') => {
      if (!lectureId) throw new Error('No lecture ID');
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_BASE}/api/mind-map/${lectureId}/generate`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_model: aiModel }),
      });
      if (!res.ok) throw new Error('Generation failed');
      const json = await res.json();
      return json.data as TreeNode;
    },
    onSuccess: (data) => {
      // Populate the cache immediately so the map renders without a refetch
      queryClient.setQueryData(['mind-map', lectureId], data);
    },
    onError: (error) => {
      console.error('Mind map generation error:', error);
    }
  });

  return { map, generate };
}
