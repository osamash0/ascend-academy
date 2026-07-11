/**
 * My Materials service — calls into the backend /api/v1/materials/* endpoints
 * (Roadmap Phase 3.1, student self-serve uploads). No component should call
 * apiClient directly for materials data.
 */
import { apiClient } from '@/lib/apiClient';

export type MaterialStatus =
  | 'queued'
  | 'extracting'
  | 'outlining'
  | 'analyzing'
  | 'embedding'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface Material {
  run_id: string;
  lecture_id: string | null;
  status: MaterialStatus;
  error: string | null;
  filename: string;
  title: string;
  total_slides: number;
  quiz_count: number;
  created_at: string;
}

export interface MaterialsList {
  materials: Material[];
}

export interface QuotaStatus {
  period: string;
  uploads_used: number;
  quota_limit: number;
  remaining: number;
}

export interface UploadResult {
  status: 'queued' | 'duplicate';
  run_id?: string;
  pdf_hash?: string;
  filename?: string;
  lecture_id?: string;
  title?: string;
}

export async function listMaterials(): Promise<MaterialsList> {
  return apiClient.get<MaterialsList>('/api/v1/materials');
}

export async function getQuota(): Promise<QuotaStatus> {
  return apiClient.get<QuotaStatus>('/api/v1/materials/quota');
}

export async function uploadMaterial(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append('file', file);
  const res = await apiClient.upload('/api/v1/materials/upload', form);
  return res.json();
}

export async function deleteMaterial(lectureId: string): Promise<{ lecture_id: string; deleted: boolean }> {
  return apiClient.delete(`/api/v1/materials/${lectureId}`);
}
