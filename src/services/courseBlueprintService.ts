import { apiClient } from '@/lib/apiClient';
import type { Course } from '@/services/coursesService';
import type { StudyGoal } from '@/services/onboardingService';

export type MaterialClassification = 'lecture' | 'reading' | 'worksheet' | 'assignment' | 'exam' | 'supporting';
export type MaterialProcessingState = 'queued' | 'processing' | 'ready' | 'needs_attention' | 'failed';

export interface MaterialSourceSummary {
  original_filename: string;
  processing_state: MaterialProcessingState;
  extracted_metadata: { parse_error?: string } | Record<string, unknown>;
}

export interface CourseBlueprintItem {
  id: string;
  material_source_id: string;
  lecture_id: string | null;
  title: string;
  position: number;
  classification: MaterialClassification;
  confidence: number;
  include_in_course: boolean;
  source_range: unknown | null;
  lecture_group_id: string;
  split_from_item_id: string | null;
  material_source: MaterialSourceSummary | null;
}

export interface CourseBlueprint {
  id: string;
  batch_id: string;
  course_id: string | null;
  title: string;
  description: string | null;
  study_goal: StudyGoal | null;
  status: 'draft' | 'ready' | 'created';
  items: CourseBlueprintItem[];
}

interface Envelope<T> { success: boolean; data: T }

export async function fetchCourseBlueprint(batchId: string): Promise<CourseBlueprint> {
  const response = await apiClient.get<Envelope<CourseBlueprint>>(`/api/v1/onboarding/batches/${batchId}/blueprint`);
  return response.data;
}

export async function updateCourseBlueprint(
  blueprintId: string,
  patch: Partial<Pick<CourseBlueprint, 'title' | 'description' | 'study_goal'>>,
): Promise<CourseBlueprint> {
  const response = await apiClient.patch<Envelope<CourseBlueprint>>(`/api/v1/onboarding/blueprints/${blueprintId}`, patch);
  return response.data;
}

export async function updateCourseBlueprintItem(
  blueprintId: string,
  itemId: string,
  patch: Partial<Pick<CourseBlueprintItem, 'title' | 'position' | 'classification' | 'include_in_course' | 'lecture_group_id'>>,
): Promise<CourseBlueprint> {
  const response = await apiClient.patch<Envelope<CourseBlueprint>>(`/api/v1/onboarding/blueprints/${blueprintId}/items/${itemId}`, patch);
  return response.data;
}

export async function splitCourseBlueprintItem(
  blueprintId: string,
  itemId: string,
  afterSlide?: number,
): Promise<CourseBlueprint> {
  const response = await apiClient.post<Envelope<CourseBlueprint>>(
    `/api/v1/onboarding/blueprints/${blueprintId}/items/${itemId}/split`,
    afterSlide ? { after_slide: afterSlide } : {},
  );
  return response.data;
}

export async function createCourseFromBlueprint(blueprintId: string): Promise<Course> {
  const response = await apiClient.post<Envelope<{ course: Course }>>(`/api/v1/onboarding/blueprints/${blueprintId}/create-course`, {});
  return response.data.course;
}
