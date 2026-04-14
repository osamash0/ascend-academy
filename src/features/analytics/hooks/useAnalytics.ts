import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000/api/analytics";

export function useAnalytics(lectureId: string | null) {
  const dashboard = useQuery({
    queryKey: ["analytics", "dashboard", lectureId],
    queryFn: async () => {
      if (!lectureId) return null;
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_BASE}/lecture/${lectureId}/dashboard`, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      if (!res.ok) throw new Error('API Error');
      const json = await res.json();
      return json.data;
    },
    enabled: !!lectureId,
    staleTime: 1000 * 60 * 5 // 5 minutes
  });

  return { dashboard };
}
