import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  generateExam,
  getExam,
  saveAnswer,
  submitExam,
  sendMissesToReview,
  type ExamAttemptDetail,
} from '@/services/examService';

export function useGenerateExam() {
  return useMutation({
    mutationFn: ({
      courseId,
      numQuestions,
      timeLimitS,
    }: {
      courseId: string;
      numQuestions?: number;
      timeLimitS?: number;
    }) => generateExam(courseId, numQuestions, timeLimitS),
  });
}

export function useExam(examId: string | undefined) {
  const queryClient = useQueryClient();

  const examQuery = useQuery({
    queryKey: ['exam', examId],
    queryFn: () => getExam(examId as string),
    enabled: !!examId,
  });

  const submitMutation = useMutation({
    mutationFn: (answers: Record<string, number>) => submitExam(examId as string, answers),
    onSuccess: (data) => {
      queryClient.setQueryData(['exam', examId], (prev: ExamAttemptDetail | undefined) =>
        prev ? { ...prev, ...data } : prev,
      );
    },
  });

  const sendMissesMutation = useMutation({
    mutationFn: () => sendMissesToReview(examId as string),
  });

  // Fire-and-forget: each answer is saved to the backend the moment the
  // student picks it, so killing the tab mid-exam never loses more than the
  // in-flight request. The final submit still sends every answer, so a rare
  // dropped autosave is recovered there too.
  const saveAnswerRemote = useCallback(
    (questionId: string, selected: number) => {
      if (!examId) return;
      void saveAnswer(examId, questionId, selected).catch(() => {
        /* best-effort */
      });
    },
    [examId],
  );

  return {
    exam: examQuery.data,
    isLoading: examQuery.isLoading,
    error: examQuery.error,
    saveAnswer: saveAnswerRemote,
    submit: submitMutation.mutateAsync,
    isSubmitting: submitMutation.isPending,
    sendMissesToReview: sendMissesMutation.mutateAsync,
    isSendingMisses: sendMissesMutation.isPending,
    sentMisses: sendMissesMutation.data,
  };
}
