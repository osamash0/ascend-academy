import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchStudentLectures,
  fetchStudentCourses,
  fetchStudentProgress,
  fetchStudentAchievements,
  fetchStudentCourseVisits,
  StudentDashboardData
} from '@/services/studentService';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';

/**
 * Custom hook for student dashboard data.
 * Split into granular queries for optimistic updates and real-time sync.
 */
export function useStudentDashboard() {
  const { user, refreshProfile } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (user?.id) {
      refreshProfile();
    }
  }, [user?.id, refreshProfile]);

  useEffect(() => {
    if (!user?.id) return;
    
    // Subscribe to real-time updates for student_progress
    const channel = supabase
      .channel('student_progress_changes')
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'student_progress',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          // Instantly invalidate the specific progress cache
          queryClient.invalidateQueries({ queryKey: ['student-progress', user.id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  const lecturesQuery = useQuery({
    queryKey: ['student-lectures'],
    queryFn: fetchStudentLectures,
    staleTime: 1000 * 60 * 5,
  });

  const coursesQuery = useQuery({
    queryKey: ['student-courses'],
    queryFn: fetchStudentCourses,
    staleTime: 1000 * 60 * 5,
  });

  const progressQuery = useQuery({
    queryKey: ['student-progress', user?.id],
    queryFn: () => fetchStudentProgress(user!.id),
    enabled: !!user?.id,
    staleTime: 1000 * 60 * 5,
  });

  const achievementsQuery = useQuery({
    queryKey: ['student-achievements', user?.id],
    queryFn: () => fetchStudentAchievements(user!.id),
    enabled: !!user?.id,
    staleTime: 1000 * 60 * 5,
  });

  const visitsQuery = useQuery({
    queryKey: ['course-visits', user?.id],
    queryFn: () => fetchStudentCourseVisits(user!.id),
    enabled: !!user?.id,
    staleTime: 1000 * 60 * 5,
  });

  const isLoading = lecturesQuery.isLoading || coursesQuery.isLoading || progressQuery.isLoading || achievementsQuery.isLoading || visitsQuery.isLoading;
  const isError = lecturesQuery.isError || coursesQuery.isError || progressQuery.isError || achievementsQuery.isError || visitsQuery.isError;

  const data = useMemo<StudentDashboardData | null>(() => {
    if (!user?.id || isLoading) return null;
    return {
      lectures: (lecturesQuery.data as any) || [],
      courses: (coursesQuery.data as any) || [],
      progress: (((progressQuery.data as any) || [])).map((p: any) => ({
        ...p,
        completed_slides: Array.isArray(p.completed_slides) ? p.completed_slides : [],
      })),
      achievements: (achievementsQuery.data as any) || [],
      courseVisits: (visitsQuery.data as any) || [],
    };
  }, [
    user?.id,
    isLoading,
    lecturesQuery.data,
    coursesQuery.data,
    progressQuery.data,
    achievementsQuery.data,
    visitsQuery.data,
  ]);

  return {
    data,
    isLoading,
    isError,
    refetch: () => {
      lecturesQuery.refetch();
      coursesQuery.refetch();
      progressQuery.refetch();
      achievementsQuery.refetch();
      visitsQuery.refetch();
    }
  };
}
