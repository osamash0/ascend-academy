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
import type { InsightFeed, InsightEvidence } from '@/features/analytics/types';

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
  const res = await apiClient.get<{ success: boolean; data: LectureOverview }>(
    `/api/analytics/lecture/${lectureId}/overview`,
  );
  return res.data;
}

export async function getSlideAnalytics(lectureId: string): Promise<SlideAnalytics[]> {
  const res = await apiClient.get<{ success: boolean; data: SlideAnalytics[] }>(
    `/api/analytics/lecture/${lectureId}/slides`,
  );
  return res.data;
}

export async function getQuizAnalytics(lectureId: string): Promise<QuizAnalytics[]> {
  const res = await apiClient.get<{ success: boolean; data: QuizAnalytics[] }>(
    `/api/analytics/lecture/${lectureId}/quizzes`,
  );
  return res.data;
}

export async function getStudentPerformance(lectureId: string): Promise<StudentPerformance[]> {
  const res = await apiClient.get<{ success: boolean; data: StudentPerformance[] }>(
    `/api/analytics/lecture/${lectureId}/students`,
  );
  return res.data;
}

export async function getDashboardData(lectureId: string): Promise<DashboardData> {
  const res = await apiClient.get<{ success: boolean; data: DashboardData }>(
    `/api/analytics/lecture/${lectureId}/dashboard`,
  );
  return res.data;
}

export async function getDropoffMap(lectureId: string): Promise<DropoffPoint[]> {
  const res = await apiClient.get<{ success: boolean; data: DropoffPoint[] }>(
    `/api/analytics/lecture/${lectureId}/dropoff`,
  );
  return res.data;
}

export async function getConfidenceBySlide(lectureId: string): Promise<ConfidenceBySlide[]> {
  const res = await apiClient.get<{ success: boolean; data: ConfidenceBySlide[] }>(
    `/api/analytics/lecture/${lectureId}/confidence`,
  );
  return res.data;
}

export async function getDistratorAnalysis(lectureId: string): Promise<DistractorAnalysis[]> {
  const res = await apiClient.get<{ success: boolean; data: DistractorAnalysis[] }>(
    `/api/analytics/lecture/${lectureId}/distractors`,
  );
  return res.data;
}

export async function getAiQueryFeed(lectureId: string): Promise<AiQueryFeedItem[]> {
  const res = await apiClient.get<{ success: boolean; data: AiQueryFeedItem[] }>(
    `/api/analytics/lecture/${lectureId}/ai-queries`,
  );
  return res.data;
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

// ── Insight Garden ────────────────────────────────────────────────────────────

export async function getLectureInsights(lectureId: string): Promise<InsightFeed> {
  const res = await apiClient.get<{ success: boolean; data: InsightFeed }>(
    `/api/analytics/lecture/${lectureId}/insights`,
  );
  return res.data;
}

export async function getInsightEvidence(
  lectureId: string,
  kind: string,
  params: { slideId?: string; studentId?: string },
): Promise<InsightEvidence> {
  const query = new URLSearchParams({ kind });
  if (params.slideId) query.set('slide_id', params.slideId);
  if (params.studentId) query.set('student_id', params.studentId);
  const res = await apiClient.get<{ success: boolean; data: InsightEvidence }>(
    `/api/analytics/lecture/${lectureId}/evidence?${query.toString()}`,
  );
  return res.data;
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
  aiModel = 'cerebras',
): Promise<AskAnswer> {
  const res = await apiClient.post<{ success: boolean; data: AskAnswer }>(
    `/api/analytics/lecture/${lectureId}/ask`,
    { question, ai_model: aiModel },
  );
  return res.data;
}

/** Professor-wide Ask Your Data — spans all the professor's courses/lectures. */
export async function askProfessorData(question: string, aiModel = 'cerebras'): Promise<AskAnswer> {
  const res = await apiClient.post<{ success: boolean; data: AskAnswer }>(
    `/api/analytics/professor/ask`,
    { question, ai_model: aiModel },
  );
  return res.data;
}

export async function getProfessorAskSuggestions(): Promise<string[]> {
  const res = await apiClient.get<{ success: boolean; data: { questions: string[] } }>(
    `/api/analytics/professor/ask/suggestions`,
  );
  return res.data?.questions ?? [];
}

export interface ChatTurn {
  role: 'user' | 'model';
  content: string;
}

/** Conversational, data-grounded assistant over all the professor's courses/lectures. */
export async function professorChat(messages: ChatTurn[], aiModel = 'cerebras'): Promise<string> {
  const res = await apiClient.post<{ success: boolean; data: { reply: string } }>(
    `/api/analytics/professor/chat`,
    { messages, ai_model: aiModel },
  );
  return res.data?.reply ?? '';
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
