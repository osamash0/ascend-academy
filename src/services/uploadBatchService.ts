/**
 * Batch-upload service (Phase 1) — calls into /api/upload/batch* endpoints.
 * No component should call apiClient directly for batch review data.
 */
import { apiClient } from '@/lib/apiClient';
import type { BatchSummaryRow } from '@/types/upload';

export async function fetchBatchSummary(batchId: string): Promise<BatchSummaryRow[]> {
  const res = await apiClient.get<{ batch_id: string; lectures: BatchSummaryRow[] }>(
    `/api/upload/batches/${batchId}`,
  );
  return res.lectures;
}
