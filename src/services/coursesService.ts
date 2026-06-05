/**
 * Courses service — calls into the backend /api/courses/* endpoints.
 * No component should call apiClient directly for courses.
 */
import { apiClient } from '@/lib/apiClient';
import type { Lecture } from '@/types/domain';
import { toSlug } from '@/lib/utils';


export interface Course {
  id: string;
  professor_id: string;
  title: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  is_archived: boolean;
  created_at: string | null;
  updated_at: string | null;
  lecture_count: number;
}

export interface CourseWithLectures extends Course {
  lectures: Lecture[];
}

export interface CreateCourseInput {
  title: string;
  description?: string;
  color?: string;
  icon?: string;
}

export interface UpdateCourseInput {
  title?: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  is_archived?: boolean;
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

export async function listCourses(filters?: { onlyArchived?: boolean; includeArchived?: boolean }): Promise<Course[]> {
  const params = new URLSearchParams();
  if (filters?.onlyArchived) params.append('only_archived', 'true');
  if (filters?.includeArchived) params.append('include_archived', 'true');
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await apiClient.get<Envelope<Course[]>>(`/api/courses${qs}`);
  return res.data;
}

export async function getCourse(idOrSlug: string): Promise<CourseWithLectures> {
  let id = idOrSlug;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  if (!isUuid) {
    const courses = await listCourses({ includeArchived: true });
    let match = courses.find(c => toSlug(c.title) === idOrSlug);
    if (!match) {
      try {
        const browse = await browseCourses();
        match = browse.find(c => toSlug(c.title) === idOrSlug);
      } catch (e) {
        // ignore error
      }
    }
    if (match) {
      id = match.id;
    } else {
      throw new Error(`Course not found for slug: ${idOrSlug}`);
    }
  }
  const res = await apiClient.get<Envelope<CourseWithLectures>>(`/api/courses/${id}`);
  return res.data;
}

export async function createCourse(input: CreateCourseInput): Promise<Course> {
  const res = await apiClient.post<Envelope<Course>>('/api/courses', input);
  return res.data;
}

export async function updateCourse(id: string, patch: UpdateCourseInput): Promise<Course> {
  const res = await apiClient.patch<Envelope<Course>>(`/api/courses/${id}`, patch);
  return res.data;
}

/**
 * Generate a course-level description with AI, summarizing the course from the
 * titles and slide summaries of its lectures. Requires the course to already
 * exist and have at least one lecture with slides.
 */
export async function generateCourseDescription(courseId: string): Promise<string> {
  const res = await apiClient.post<{ description: string }>('/api/ai/course-description', {
    course_id: courseId,
  });
  return res.description;
}

export async function deleteCourse(id: string, reassignTo?: string): Promise<void> {
  const qs = reassignTo ? `?reassign_to=${encodeURIComponent(reassignTo)}` : '';
  await apiClient.delete<void>(`/api/courses/${id}${qs}`);
}

export async function assignLectureToCourse(courseId: string, lectureId: string): Promise<void> {
  await apiClient.post<Envelope<unknown>>(
    `/api/courses/${courseId}/lectures/${lectureId}`,
    {},
  );
}

export async function unassignLectureFromCourse(courseId: string, lectureId: string): Promise<void> {
  await apiClient.delete<void>(`/api/courses/${courseId}/lectures/${lectureId}`);
}

export async function browseCourses(): Promise<Course[]> {
  const res = await apiClient.get<Envelope<Course[]>>('/api/courses/browse');
  return res.data;
}

export async function enrollInCourse(courseId: string): Promise<void> {
  await apiClient.post<Envelope<unknown>>(`/api/courses/${courseId}/enroll`, {});
}
