/**
 * Concept-graph client.  Talks to the backend cross-course concept API.
 */
import { apiClient } from '@/lib/apiClient';

export interface ConceptMasteryItem {
  concept_id: string;
  name: string;
  attempts: number;
  correct: number;
  mastery_score: number;
}

export interface StudentMastery {
  vector: ConceptMasteryItem[];
  mastered: ConceptMasteryItem[];
  weak: ConceptMasteryItem[];
}

export interface RelatedLecture {
  lecture_id: string;
  title: string;
  description: string | null;
  total_slides: number;
  slide_indices: number[];
  weight: number;
}

export async function fetchStudentMastery(userId: string): Promise<StudentMastery> {
  const env = await apiClient.get<{ data?: { vector?: ConceptMasteryItem[]; mastered?: ConceptMasteryItem[]; weak?: ConceptMasteryItem[] } }>(
    `/api/v1/concepts/student/${userId}`,
  );
  const data = env?.data || {};
  return {
    vector: data.vector || [],
    mastered: data.mastered || [],
    weak: data.weak || [],
  };
}

export interface LectureConcept {
  concept_id: string;
  name: string;
  weight: number;
  slide_indices: number[];
}

export async function fetchLectureConcepts(lectureId: string): Promise<LectureConcept[]> {
  const env = await apiClient.get<{ data?: LectureConcept[] }>(`/api/v1/concepts/lecture/${lectureId}`);
  return env?.data || [];
}

export async function fetchRelatedLectures(
  conceptId: string,
  limit = 10,
  excludeLectureId?: string,
): Promise<RelatedLecture[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (excludeLectureId) params.set('exclude_lecture_id', excludeLectureId);
  const env = await apiClient.get<{ data?: RelatedLecture[] }>(
    `/api/v1/concepts/${conceptId}/related-lectures?${params}`,
  );
  return env?.data || [];
}
