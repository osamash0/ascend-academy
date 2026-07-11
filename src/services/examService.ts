/**
 * Exam service — calls into the backend /api/v1/exams/* endpoints.
 * No component should call apiClient directly for exam data.
 */
import { apiClient } from '@/lib/apiClient';

export interface ExamQuestion {
  id: string;
  question_text: string;
  options: string[];
  slide_id: string;
}

export interface GenerateExamResult {
  exam_id: string;
  started_at: string;
  time_limit_s: number;
  questions: ExamQuestion[];
}

export interface WeakSlideRef {
  slide_id: string;
  lecture_id: string;
  slide_number: number;
}

export interface WeakConcept {
  concept: string;
  correct: number;
  total: number;
  miss_rate: number;
  slides: WeakSlideRef[];
}

export interface ExamReportData {
  score: number;
  correct_count: number;
  total: number;
  weakest_concepts: WeakConcept[];
  missed_question_ids: string[];
}

export interface ExamAttempt {
  exam_id: string;
  course_id: string;
  started_at: string;
  submitted_at: string | null;
  time_limit_s: number;
  expired: boolean;
  score: number | null;
  report: ExamReportData | null;
}

export interface ExamAttemptDetail extends ExamAttempt {
  answers: Record<string, number>;
  questions: ExamQuestion[];
}

export interface ExamHistoryItem {
  exam_id: string;
  course_id: string;
  started_at: string;
  submitted_at: string | null;
  time_limit_s: number;
  expired: boolean;
  score: number | null;
}

export interface SendMissesResult {
  cards_created: number;
  cards_activated: number;
}

export async function generateExam(
  courseId: string,
  numQuestions = 30,
  timeLimitS?: number,
): Promise<GenerateExamResult> {
  return apiClient.post<GenerateExamResult>(`/api/v1/exams/course/${courseId}/generate`, {
    num_questions: numQuestions,
    time_limit_s: timeLimitS,
  });
}

export async function getExam(examId: string): Promise<ExamAttemptDetail> {
  return apiClient.get<ExamAttemptDetail>(`/api/v1/exams/${examId}`);
}

export async function saveAnswer(examId: string, questionId: string, selected: number): Promise<void> {
  await apiClient.post(`/api/v1/exams/${examId}/answer`, { question_id: questionId, selected });
}

export async function submitExam(
  examId: string,
  answers: Record<string, number>,
): Promise<ExamAttempt> {
  return apiClient.post<ExamAttempt>(`/api/v1/exams/${examId}/submit`, { answers });
}

export async function listMyExams(courseId?: string): Promise<{ attempts: ExamHistoryItem[] }> {
  const qs = courseId ? `?course_id=${courseId}` : '';
  return apiClient.get(`/api/v1/exams/mine${qs}`);
}

export async function sendMissesToReview(examId: string): Promise<SendMissesResult> {
  return apiClient.post<SendMissesResult>(`/api/v1/exams/${examId}/send-misses-to-review`, {});
}
