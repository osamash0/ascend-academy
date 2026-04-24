import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000/api/analytics";

export function useAnalytics(lectureId: string | null) {
  const dashboard = useQuery({
    queryKey: ["analytics", "dashboard", lectureId],
    queryFn: async () => {
      if (!lectureId) return null;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No active session token available');
      }
      
      const res = await fetch(`${API_BASE}/lecture/${lectureId}/dashboard`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      if (!res.ok) {
        if (res.status === 401) {
            throw new Error('Unauthorized - Token expired');
        }
        throw new Error('API Error');
      }
      const json = await res.json();
      return json.data;
    },
    enabled: !!lectureId,
    staleTime: 1000 * 10, // 10 seconds
    refetchInterval: 1000 * 10, // Refetch every 10 seconds for 'Live' effect
  });

  return { dashboard };
}
