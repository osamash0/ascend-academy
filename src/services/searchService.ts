import { apiClient } from '@/lib/apiClient';

export interface LectureHit {
  id: string;
  course_id: string | null;
  title: string;
  description: string | null;
}

export interface SlideHit {
  lecture_id: string;
  lecture_title: string;
  slide_index: number;
  title: string;
  content: string;
  similarity: number;
}

export interface ConceptHit {
  id: string;
  canonical_name: string;
  lecture_id: string;
  course_id: string | null;
}

export interface WorksheetHit {
  id: string;
  title: string;
  lecture_id: string;
  course_id: string | null;
}

export interface GlobalSearchResults {
  lectures: LectureHit[];
  slides: SlideHit[];
  concepts: ConceptHit[];
  worksheets: WorksheetHit[];
}

export interface CourseTutorCitation {
  source_index: number;
  lecture_id: string;
  lecture_title: string | null;
  slide_index: number;
  similarity: number;
}

export interface CourseTutorReply {
  reply: string;
  citations: CourseTutorCitation[];
  grounded: boolean;
}

export async function globalSearch(query: string): Promise<GlobalSearchResults> {
  const q = query.trim();
  if (!q) {
    return { lectures: [], slides: [], concepts: [], worksheets: [] };
  }
  return apiClient.get<GlobalSearchResults>(`/api/search?q=${encodeURIComponent(q)}`);
}

export async function askCourseTutor(params: {
  courseId: string;
  question: string;
  history?: Array<{ role: string; content: string }>;
  allowUngrounded?: boolean;
}): Promise<CourseTutorReply> {
  return apiClient.post<CourseTutorReply>('/api/search/ask', {
    course_id: params.courseId,
    question: params.question,
    history: params.history ?? null,
    allow_ungrounded: params.allowUngrounded ?? false,
  });
}
