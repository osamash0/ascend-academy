import { useQuery } from '@tanstack/react-query';
import { fetchStudentDashboard } from '@/services/studentService';
import { useAuth } from '@/lib/auth';

/**
 * Custom hook for student dashboard data.
 * Uses React Query for automatic caching and revalidation.
 */
export function useStudentDashboard() {
  const { user, refreshProfile } = useAuth();

  return useQuery({
    queryKey: ['student-dashboard', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      
      // Fetch core dashboard data
      const data = await fetchStudentDashboard(user.id);

      // Sync XP/streaks in background — don't block the query from resolving
      refreshProfile();
      
      return data;
    },
    enabled: !!user?.id,
    staleTime: 1000 * 60 * 5, // 5 minutes cache
    refetchOnWindowFocus: false,
  });
}
