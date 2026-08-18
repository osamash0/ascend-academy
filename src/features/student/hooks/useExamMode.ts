import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { apiClient } from '@/lib/apiClient';
import { getErrorStatus } from '@/lib/apiErrors';

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

// ── Friendly error mapping (R31) ────────────────────────────────────────────
// `apiClient` throws `ApiError` (status + optional `detail`) instead of a
// plain `Error` — this maps that status, per call site, to the existing
// (previously unreachable) friendly i18n copy in exam.json instead of
// letting a raw `"POST /api/v1/exams/... → 429: {...}"` string reach a toast.
export type ExamErrorContext = 'generate' | 'submit' | 'answer' | 'sendToReview';

type TFunc = (key: string, options?: Record<string, unknown>) => string;

export function getExamErrorMessage(err: unknown, t: TFunc, context: ExamErrorContext): string {
  const status = getErrorStatus(err);

  switch (context) {
    case 'generate':
      if (status === 429) return t('generate.rateLimited');
      if (status === 400) return t('generate.notEnoughQuestions');
      return t('generate.failed');
    case 'answer':
      if (status === 409) return t('runner.alreadySubmitted');
      return t('runner.answerSaveFailed');
    case 'submit':
      return t('runner.submitFailed');
    case 'sendToReview':
      return t('report.sendToReviewFailed');
    default:
      return t('runner.submitFailed');
  }
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
  const { t } = useTranslation('exam');
  return useMutation({
    mutationFn: async (data: { question_id: string; selected: number }) => {
      return apiClient.post<{ ok: boolean }>(`/api/v1/exams/${examId}/answer`, data);
    },
    // R32: this used to invalidate ['exam', examId] on every autosave, which
    // triggers a full attempt refetch. MockExam.tsx's local `answers` state
    // is already the source of truth for what the student picked (updated
    // synchronously on click, before this mutation even fires) — nothing
    // reads the server's `answers` copy again until the next full page
    // load/exam_id change, so there is nothing here to keep "fresh". The
    // invalidation's only observable effect was the race described in R32:
    // an earlier answer's refetch resolving after a later answer's POST,
    // visually reverting the newer selection back to the older server copy.
    onError: (err) => {
      // A 409 here means the exam was already submitted (e.g. answering
      // from a second open tab) — that used to fail completely silently.
      toast.error(getExamErrorMessage(err, t, 'answer'));
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
