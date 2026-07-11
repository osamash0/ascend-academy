/**
 * Review service — calls into the backend /api/v1/review/* endpoints.
 * No component should call apiClient directly for review data.
 */
import { apiClient } from '@/lib/apiClient';

export interface ReviewCard {
  card_id: string;
  lecture_id: string;
  source_type: 'quiz_question' | 'concept_qa' | 'concept_cloze';
  front: { question?: string; options?: string[]; text?: string };
  back: { correct_answer?: string; explanation?: string; text?: string };
  state: 'new' | 'learning' | 'review' | 'relearning';
}

export interface ReviewQueue {
  cards: ReviewCard[];
  total_due: number;
}

export interface GradeResult {
  card_id: string;
  rating: number;
  due_at: string;
  state: string;
  interval_days: number;
}

export interface ReviewStats {
  due_today: number;
  streak: number;
  retention_pct: number | null;
  reviews_last_30d: number;
}

export async function getQueue(limit?: number): Promise<ReviewQueue> {
  const qs = limit ? `?limit=${limit}` : '';
  return apiClient.get<ReviewQueue>(`/api/v1/review/queue${qs}`);
}

export async function grade(cardId: string, rating: number, elapsedMs?: number): Promise<GradeResult> {
  return apiClient.post<GradeResult>(`/api/v1/review/${cardId}/grade`, {
    rating,
    elapsed_ms: elapsedMs,
  });
}

export async function getStats(): Promise<ReviewStats> {
  return apiClient.get<ReviewStats>('/api/v1/review/stats');
}

export async function suspend(cardId: string): Promise<{ card_id: string; suspended: boolean }> {
  return apiClient.post(`/api/v1/review/cards/${cardId}/suspend`, {});
}
