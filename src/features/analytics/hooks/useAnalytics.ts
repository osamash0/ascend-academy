import { useQuery } from "@tanstack/react-query";
import type { LectureOverview, SlideAnalytics, QuizAnalytics, StudentPerformance } from "../types";
import { supabase } from "@/integrations/supabase/client";

const API_BASE = "http://localhost:8000/api/analytics";

export function useAnalytics(lectureId: string | null) {
  const overview = useQuery({
    queryKey: ["analytics", "overview", lectureId],
    queryFn: async () => {
      if (!lectureId) return null;
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_BASE}/lecture/${lectureId}/overview`, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      const json = await res.json();
      return json.data as LectureOverview;
    },
    enabled: !!lectureId,
  });

  const slides = useQuery({
    queryKey: ["analytics", "slides", lectureId],
    queryFn: async () => {
      if (!lectureId) return [];
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_BASE}/lecture/${lectureId}/slides`, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      const json = await res.json();
      return json.data as SlideAnalytics[];
    },
    enabled: !!lectureId,
  });

  const quizzes = useQuery({
    queryKey: ["analytics", "quizzes", lectureId],
    queryFn: async () => {
      if (!lectureId) return [];
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_BASE}/lecture/${lectureId}/quizzes`, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      const json = await res.json();
      return json.data as QuizAnalytics[];
    },
    enabled: !!lectureId,
  });

  const students = useQuery({
    queryKey: ["analytics", "students", lectureId],
    queryFn: async () => {
      if (!lectureId) return [];
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_BASE}/lecture/${lectureId}/students`, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      const json = await res.json();
      return json.data as StudentPerformance[];
    },
    enabled: !!lectureId,
  });

  return { overview, slides, quizzes, students };
}
