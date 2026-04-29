/**
 * Analytics service — all calls to the backend /api/analytics/* endpoints.
 * No component should call apiClient directly for analytics — use these functions.
 */
import { apiClient } from '@/lib/apiClient';
import type {
  LectureOverview,
  SlideAnalytics,
  QuizAnalytics,
  StudentPerformance,
} from '@/types/domain';

export interface DropoffPoint {
  slide_number: number;
  title: string;
  dropoff_count: number;
}

export interface ConfidenceBySlide {
  slide_number: number;
  title: string;
  average_confidence: number;
}

export interface DistractorAnalysis {
  question_id: string;
  question_text: string;
  distractor_stats: { option: string; count: number; percentage: number }[];
}

export interface AiQueryFeedItem {
  slide_title: string;
  query: string;
  created_at: string;
}

export interface DashboardData {
  overview: LectureOverview;
  slideAnalytics: SlideAnalytics[];
  quizAnalytics: QuizAnalytics[];
  studentPerformance: StudentPerformance[];
}

export async function getLectureOverview(lectureId: string): Promise<LectureOverview> {
  return apiClient.get<LectureOverview>(`/api/analytics/lecture/${lectureId}/overview`);
}

export async function getSlideAnalytics(lectureId: string): Promise<SlideAnalytics[]> {
  return apiClient.get<SlideAnalytics[]>(`/api/analytics/lecture/${lectureId}/slides`);
}

export async function getQuizAnalytics(lectureId: string): Promise<QuizAnalytics[]> {
  return apiClient.get<QuizAnalytics[]>(`/api/analytics/lecture/${lectureId}/quiz`);
}

export async function getStudentPerformance(lectureId: string): Promise<StudentPerformance[]> {
  return apiClient.get<StudentPerformance[]>(`/api/analytics/lecture/${lectureId}/students`);
}

export async function getDashboardData(lectureId: string): Promise<DashboardData> {
  return apiClient.get<DashboardData>(`/api/analytics/lecture/${lectureId}/dashboard`);
}

export async function getDropoffMap(lectureId: string): Promise<DropoffPoint[]> {
  return apiClient.get<DropoffPoint[]>(`/api/analytics/lecture/${lectureId}/dropoff`);
}

export async function getConfidenceBySlide(lectureId: string): Promise<ConfidenceBySlide[]> {
  return apiClient.get<ConfidenceBySlide[]>(`/api/analytics/lecture/${lectureId}/confidence`);
}

export async function getDistratorAnalysis(lectureId: string): Promise<DistractorAnalysis[]> {
  return apiClient.get<DistractorAnalysis[]>(`/api/analytics/lecture/${lectureId}/distractors`);
}

export async function getAiQueryFeed(lectureId: string): Promise<AiQueryFeedItem[]> {
  return apiClient.get<AiQueryFeedItem[]>(`/api/analytics/lecture/${lectureId}/ai-queries`);
}

export async function getAiInsights(lectureId: string, context: Record<string, unknown>): Promise<{ summary: string; suggestions: string[] }> {
  return apiClient.post(`/api/ai/analytics-insights`, { lecture_id: lectureId, ...context });
}
