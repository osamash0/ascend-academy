/**
 * Courses service — calls into the backend /api/courses/* endpoints.
 * No component should call apiClient directly for courses.
 */
import { apiClient } from '@/lib/apiClient';
import type { Lecture } from '@/types/domain';

export interface Course {
  id: string;
  professor_id: string;
  title: string;
  description: string | null;
  color: string | null;
  icon: string | null;
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
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

export async function listCourses(): Promise<Course[]> {
  const res = await apiClient.get<Envelope<Course[]>>('/api/courses');
  return res.data;
}

export async function getCourse(id: string): Promise<CourseWithLectures> {
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
