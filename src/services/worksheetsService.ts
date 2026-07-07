/**
 * Worksheets service — file attachments per lecture.
 *
 * Uploads go through the backend multipart endpoint (handles validation,
 * size limits, and consistent storage path keyed off the worksheet id).
 * Downloads go through the backend signed-URL endpoint so RLS + bucket
 * privacy are enforced uniformly.
 */
import { apiClient } from '@/lib/apiClient';

export interface Worksheet {
  id: string;
  lecture_id: string;
  title: string;
  file_url: string;
  file_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

export async function listWorksheets(lectureId: string): Promise<Worksheet[]> {
  const res = await apiClient.get<Envelope<Worksheet[]>>(
    `/api/lectures/${lectureId}/worksheets`,
  );
  return res.data;
}

export async function uploadWorksheet(
  lectureId: string,
  file: File,
  title?: string,
): Promise<Worksheet> {
  const fd = new FormData();
  fd.append('file', file);
  if (title) fd.append('title', title);
  const res = await apiClient.upload(`/api/v1/lectures/${lectureId}/worksheets`, fd);
  const body = (await res.json()) as Envelope<Worksheet>;
  return body.data;
}

export async function renameWorksheet(id: string, title: string): Promise<Worksheet> {
  const res = await apiClient.patch<Envelope<Worksheet>>(`/api/worksheets/${id}`, { title });
  return res.data;
}

export async function deleteWorksheet(id: string): Promise<void> {
  await apiClient.delete<void>(`/api/worksheets/${id}`);
}

export interface WorksheetDownload {
  url: string;
  title: string;
  file_type: string | null;
}

export async function getWorksheetDownloadUrl(id: string): Promise<WorksheetDownload> {
  const res = await apiClient.get<Envelope<WorksheetDownload>>(
    `/api/worksheets/${id}/download_url`,
  );
  return res.data;
}
