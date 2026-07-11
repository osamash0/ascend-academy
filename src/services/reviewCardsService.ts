/**
 * Review-cards service — professor-facing control over a lecture's SRS
 * "Daily Ascent" cards (Roadmap Phase 4.1). Student-facing review (queue/
 * grade/stats) lives in src/features/review/useReviewQueue.ts; this is the
 * professor's list/hide/unhide surface.
 */
import { apiClient } from '@/lib/apiClient';

export interface ReviewCard {
  card_id: string;
  source_type: 'quiz_question' | 'concept_qa' | 'concept_cloze';
  front: Record<string, unknown>;
  back: Record<string, unknown>;
  concept_id: string | null;
  hidden: boolean;
}

interface ListResponse {
  cards: ReviewCard[];
  total: number;
}

export async function listLectureReviewCards(lectureId: string): Promise<ReviewCard[]> {
  const res = await apiClient.get<ListResponse>(`/api/review/lecture/${lectureId}/cards`);
  return res.cards;
}

export async function hideReviewCard(cardId: string): Promise<void> {
  await apiClient.post<{ card_id: string; hidden: boolean }>(`/api/review/cards/${cardId}/hide`, {});
}

export async function unhideReviewCard(cardId: string): Promise<void> {
  await apiClient.post<{ card_id: string; hidden: boolean }>(`/api/review/cards/${cardId}/unhide`, {});
}
