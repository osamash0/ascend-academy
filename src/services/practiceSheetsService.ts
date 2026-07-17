/**
 * Practice Sheets service — wraps /api/practice-sheets/* and
 * /api/v1/lectures/{id}/practice-sheets/* endpoints.
 */
import { apiClient } from '@/lib/apiClient';

export type SheetKind = 'auto' | 'manual';
export type SheetStatus = 'draft' | 'published';
export type QuestionType = 'multiple_choice' | 'short_answer' | 'free_form';

export interface PracticeSheetQuestion {
  id: string;
  sheet_id: string;
  order_index: number;
  type: QuestionType;
  prompt: string;
  choices: string[] | null;
  correct_answer: string | null;
  explanation: string | null;
  source_quiz_question_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface PracticeSheet {
  id: string;
  lecture_id: string;
  kind: SheetKind;
  title: string;
  status: SheetStatus;
  created_by: string;
  created_at: string | null;
  updated_at: string | null;
  question_count?: number;
  questions?: PracticeSheetQuestion[];
}

export interface PracticeAttempt {
  id: string;
  sheet_id: string;
  student_id: string;
  answers: Record<string, string>;
  score: number | null;
  is_preview: boolean;
  submitted_at: string;
  questions?: PracticeSheetQuestion[];
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

// ── Sheet CRUD ────────────────────────────────────────────────────────────────

export async function listPracticeSheets(lectureId: string): Promise<PracticeSheet[]> {
  const res = await apiClient.get<Envelope<PracticeSheet[]>>(
    `/api/v1/lectures/${lectureId}/practice-sheets`,
  );
  return res.data;
}

export async function createManualSheet(lectureId: string, title: string): Promise<PracticeSheet> {
  const res = await apiClient.post<Envelope<PracticeSheet>>(
    `/api/v1/lectures/${lectureId}/practice-sheets`,
    { title },
  );
  return res.data;
}

export async function generateAutoSheet(lectureId: string): Promise<PracticeSheet> {
  const res = await apiClient.post<Envelope<PracticeSheet>>(
    `/api/v1/lectures/${lectureId}/practice-sheets/auto`,
    {},
  );
  return res.data;
}

export async function getPracticeSheet(sheetId: string): Promise<PracticeSheet> {
  const res = await apiClient.get<Envelope<PracticeSheet>>(
    `/api/practice-sheets/${sheetId}`,
  );
  return res.data;
}

export async function updatePracticeSheet(
  sheetId: string,
  patch: { title?: string; status?: SheetStatus },
): Promise<PracticeSheet> {
  const res = await apiClient.patch<Envelope<PracticeSheet>>(
    `/api/practice-sheets/${sheetId}`,
    patch,
  );
  return res.data;
}

export async function deletePracticeSheet(sheetId: string): Promise<void> {
  await apiClient.delete(`/api/practice-sheets/${sheetId}`);
}

// ── Question CRUD ──────────────────────────────────────────────────────────────

export interface QuestionInput {
  type: QuestionType;
  prompt: string;
  choices?: string[];
  correct_answer?: string;
  explanation?: string;
  order_index?: number;
}

export async function addQuestion(
  sheetId: string,
  q: QuestionInput,
): Promise<PracticeSheetQuestion> {
  const res = await apiClient.post<Envelope<PracticeSheetQuestion>>(
    `/api/practice-sheets/${sheetId}/questions`,
    q,
  );
  return res.data;
}

export async function updateQuestion(
  sheetId: string,
  questionId: string,
  q: QuestionInput,
): Promise<PracticeSheetQuestion> {
  const res = await apiClient.patch<Envelope<PracticeSheetQuestion>>(
    `/api/practice-sheets/${sheetId}/questions/${questionId}`,
    q,
  );
  return res.data;
}

export async function deleteQuestion(sheetId: string, questionId: string): Promise<void> {
  await apiClient.delete(`/api/practice-sheets/${sheetId}/questions/${questionId}`);
}

export async function reorderQuestions(sheetId: string, questionIds: string[]): Promise<PracticeSheetQuestion[]> {
  const res = await apiClient.post<Envelope<PracticeSheetQuestion[]>>(
    `/api/practice-sheets/${sheetId}/reorder`,
    { question_ids: questionIds },
  );
  return res.data;
}

// ── Attempts ──────────────────────────────────────────────────────────────────

export async function submitAttempt(
  sheetId: string,
  answers: Record<string, string>,
  isPreview = false,
): Promise<PracticeAttempt> {
  const res = await apiClient.post<Envelope<PracticeAttempt>>(
    `/api/practice-sheets/${sheetId}/attempts`,
    { answers, is_preview: isPreview },
  );
  return res.data;
}

export async function getMyAttempts(sheetId: string): Promise<PracticeAttempt[]> {
  const res = await apiClient.get<Envelope<PracticeAttempt[]>>(
    `/api/practice-sheets/${sheetId}/attempts/mine`,
  );
  return res.data;
}
