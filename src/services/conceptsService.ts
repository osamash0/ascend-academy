/**
 * Concept-graph client.  Talks to the backend cross-course concept API.
 */
import { supabase } from '@/integrations/supabase/client';

const API_BASE = (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000';

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

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export async function fetchStudentMastery(userId: string): Promise<StudentMastery> {
  const headers = await authHeader();
  const res = await fetch(`${API_BASE}/api/concepts/student/${userId}`, { headers });
  if (!res.ok) throw new Error(`mastery fetch failed: ${res.status}`);
  const json = await res.json();
  const data = json?.data || {};
  return {
    vector: data.vector || [],
    mastered: data.mastered || [],
    weak: data.weak || [],
  };
}

export async function fetchRelatedLectures(
  conceptId: string,
  limit = 10,
  excludeLectureId?: string,
): Promise<RelatedLecture[]> {
  const headers = await authHeader();
  const url = new URL(`${API_BASE}/api/concepts/${conceptId}/related-lectures`);
  url.searchParams.set('limit', String(limit));
  if (excludeLectureId) url.searchParams.set('exclude_lecture_id', excludeLectureId);
  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`related-lectures fetch failed: ${res.status}`);
  const json = await res.json();
  return json?.data || [];
}
