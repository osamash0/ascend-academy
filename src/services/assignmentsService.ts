/**
 * Assignments service — calls into the backend /api/assignments/* endpoints.
 * No component should call apiClient directly for assignments.
 */
import { apiClient } from '@/lib/apiClient';

export type AssignmentStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'overdue';

export interface Assignment {
  id: string;
  professor_id: string;
  course_id: string | null;
  title: string;
  description: string | null;
  due_at: string;
  min_quiz_score: number | null;
  created_at: string | null;
  lecture_ids: string[];
  // Roster — present for the owning professor. Absent on student responses.
  student_ids?: string[];
  // Present for student callers; absent on the professor's own list.
  status?: AssignmentStatus;
  completed_count?: number;
  total_count?: number;
  progress_percentage?: number;
}

export interface CreateAssignmentInput {
  title: string;
  description?: string;
  lecture_ids: string[];
  /** Optional roster. Empty/omitted = roster can be filled in later. */
  student_ids?: string[];
  due_at: string; // ISO timestamp
  min_quiz_score?: number;
}

export interface UpdateAssignmentInput {
  title?: string;
  description?: string;
  lecture_ids?: string[];
  student_ids?: string[];
  due_at?: string;
  min_quiz_score?: number;
}

export interface StudentOption {
  id: string;
  full_name: string | null;
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

export async function listAssignments(): Promise<Assignment[]> {
  const res = await apiClient.get<Envelope<Assignment[]>>('/api/assignments');
  return res.data;
}

export async function getAssignment(id: string): Promise<Assignment> {
  const res = await apiClient.get<Envelope<Assignment>>(`/api/assignments/${id}`);
  return res.data;
}

export async function createAssignment(input: CreateAssignmentInput): Promise<Assignment> {
  const res = await apiClient.post<Envelope<Assignment>>('/api/assignments', input);
  return res.data;
}

export async function updateAssignment(
  id: string,
  patch: UpdateAssignmentInput,
): Promise<Assignment> {
  const res = await apiClient.patch<Envelope<Assignment>>(`/api/assignments/${id}`, patch);
  return res.data;
}

export async function deleteAssignment(id: string): Promise<void> {
  await apiClient.delete<void>(`/api/assignments/${id}`);
}

/**
 * Fetch the list of students a professor can enroll in an assignment.
 *
 * Goes through the backend (service role) because Supabase RLS
 * intentionally restricts user_roles / profiles SELECT to the row owner
 * — a professor cannot list other users' role rows from the client.
 */
export async function listEnrollableStudents(): Promise<StudentOption[]> {
  try {
    const res = await apiClient.get<Envelope<StudentOption[]>>(
      '/api/assignments/_meta/students',
    );
    return res.data;
  } catch (err) {
    console.error('listEnrollableStudents failed:', err);
    return [];
  }
}
