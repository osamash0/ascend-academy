import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getQueue, grade as gradeCard } from '@/services/reviewService';

export function useReviewQueue() {
  const queryClient = useQueryClient();

  const queueQuery = useQuery({
    queryKey: ['review-queue'],
    queryFn: () => getQueue(),
  });

  const gradeMutation = useMutation({
    mutationFn: ({ cardId, rating, elapsedMs }: { cardId: string; rating: number; elapsedMs?: number }) =>
      gradeCard(cardId, rating, elapsedMs),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['review-stats'] });
    },
  });

  return {
    cards: queueQuery.data?.cards ?? [],
    totalDue: queueQuery.data?.total_due ?? 0,
    isLoading: queueQuery.isLoading,
    error: queueQuery.error,
    grade: gradeMutation.mutateAsync,
    isGrading: gradeMutation.isPending,
  };
}
