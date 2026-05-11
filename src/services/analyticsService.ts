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

export interface ProfessorOverview {
  active_students: number;
  average_completion: number;
  average_quiz_accuracy: number;
  median_time_minutes: number;
  weakest_concepts: { concept: string; miss_rate: number; attempts: number }[];
  weakest_slides: { slide_id: string; title: string; miss_rate: number; attempts: number }[];
  activity_sparkline: { date: string; count: number }[];
  lecture_count: number;
  days: number;
}

export async function getProfessorOverview(courseId: string, days = 7): Promise<ProfessorOverview> {
  const res = await apiClient.get<{ success: boolean; data: ProfessorOverview }>(
    `/api/analytics/professor/overview?course_id=${encodeURIComponent(courseId)}&days=${days}`,
  );
  return res.data;
}

export async function getAiInsights(lectureId: string, context: Record<string, unknown>): Promise<{ summary: string; suggestions: string[] }> {
  return apiClient.post(`/api/ai/analytics-insights`, { lecture_id: lectureId, ...context });
}

// ── Ask Your Data ──────────────────────────────────────────────────────────

export interface AskChartSpec {
  type: 'bar';
  x_key: string;
  y_key: string;
  y_label?: string;
  data: Record<string, unknown>[];
}

export interface AskAnswer {
  intent: string;
  answer_text: string;
  table: Record<string, unknown>[];
  chart: AskChartSpec | null;
  debug: Record<string, unknown>;
  suggested_questions: string[];
}

export async function askLectureData(
  lectureId: string,
  question: string,
  aiModel = 'groq',
): Promise<AskAnswer> {
  const res = await apiClient.post<{ success: boolean; data: AskAnswer }>(
    `/api/analytics/lecture/${lectureId}/ask`,
    { question, ai_model: aiModel },
  );
  return res.data;
}

// ── Comparative Benchmarks (Task #50) ─────────────────────────────────────

export interface BenchmarkMetricPack {
  avg_time_minutes: number;
  completion_rate: number;
  unique_students: number;
  drop_off_rate: number;
  avg_score: number;
  mastery_rate: number;
  struggle_rate: number;
  distractor_confusion: number;
  concept_count: number;
  needs_review_share: number;
}

export interface BenchmarkPeerSummary {
  avg: number;
  min: number;
  max: number;
  count: number;
}

export interface LectureBenchmarkRow {
  lecture_id: string;
  title: string;
  metrics: BenchmarkMetricPack;
}

export interface CourseBenchmarkRow {
  course_id: string;
  title: string;
  lecture_count: number;
  metrics: BenchmarkMetricPack;
}

export interface LectureBenchmarks {
  scope: 'lecture';
  lecture_id: string;
  course_id: string | null;
  current: LectureBenchmarkRow | null;
  peers: LectureBenchmarkRow[];
  summary: Record<keyof BenchmarkMetricPack, BenchmarkPeerSummary>;
}

export interface CourseBenchmarks {
  scope: 'course';
  course_id: string;
  current: CourseBenchmarkRow | null;
  peers: CourseBenchmarkRow[];
  summary: Record<keyof BenchmarkMetricPack, BenchmarkPeerSummary>;
}

export async function getLectureBenchmarks(lectureId: string): Promise<LectureBenchmarks> {
  const res = await apiClient.get<{ success: boolean; data: LectureBenchmarks }>(
    `/api/analytics/lecture/${lectureId}/benchmarks`,
  );
  return res.data;
}

export async function getCourseBenchmarks(courseId: string): Promise<CourseBenchmarks> {
  const res = await apiClient.get<{ success: boolean; data: CourseBenchmarks }>(
    `/api/analytics/course/${courseId}/benchmarks`,
  );
  return res.data;
}

export async function getAskSuggestions(lectureId: string): Promise<string[]> {
  const res = await apiClient.get<{ success: boolean; data: { questions: string[] } }>(
    `/api/analytics/lecture/${lectureId}/ask/suggestions`,
  );
  return res.data?.questions ?? [];
}
