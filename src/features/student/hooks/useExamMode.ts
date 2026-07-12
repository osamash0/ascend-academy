import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

export interface ExamQuestion {
  id: string;
  slide_id: string;
  question_text: string;
  options: string[];
}

export interface ExamAttempt {
  exam_id: string;
  course_id: string;
  started_at: string;
  submitted_at: string | null;
  time_limit_s: number;
  expired: boolean;
  score: number | null;
  report: any | null;
  answers: Record<string, number>;
  questions?: ExamQuestion[];
}

export function useGenerateExam(courseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { num_questions: number; time_limit_s?: number }) => {
      return apiClient.post<{ exam_id: string; question_ids: string[] }>(`/api/v1/exams/course/${courseId}/generate`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exams', 'mine'] });
      queryClient.invalidateQueries({ queryKey: ['student-dashboard'] });
    },
  });
}

export function useExamAttempt(examId: string | undefined) {
  return useQuery({
    queryKey: ['exam', examId],
    queryFn: async () => {
      if (!examId) return null;
      return apiClient.get<ExamAttempt>(`/api/v1/exams/${examId}`);
    },
    enabled: !!examId,
  });
}

export function useSaveExamAnswer(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { question_id: string; selected: number }) => {
      return apiClient.post<{ ok: boolean }>(`/api/v1/exams/${examId}/answer`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam', examId] });
    },
  });
}

export function useSubmitExam(examId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { answers: Record<string, number> }) => {
      return apiClient.post<ExamAttempt>(`/api/v1/exams/${examId}/submit`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam', examId] });
      queryClient.invalidateQueries({ queryKey: ['exams', 'mine'] });
      queryClient.invalidateQueries({ queryKey: ['student-dashboard'] });
    },
  });
}

export function useSendMissesToReview(examId: string) {
  return useMutation({
    mutationFn: async () => {
      return apiClient.post<{ ok: boolean }>(`/api/v1/exams/${examId}/send-misses-to-review`, {});
    },
  });
}
