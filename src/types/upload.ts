/** Phase 1 (course-at-once ingestion) batch-upload types — shared by
 * useBatchUpload, UploadsIndicator, and uploadBatchService. Scoped to the
 * new batch/poll surface only; the existing single-file SSE event shapes in
 * usePDFUpload.ts are a separate, working code path, not retrofitted here. */

export type UploadJobStatus =
  | 'queued'
  | 'extracting'
  | 'outlining'
  | 'analyzing'
  | 'embedding'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface UploadJob {
  run_id: string;
  batch_id: string | null;
  filename: string | null;
  pdf_hash: string;
  status: UploadJobStatus;
  lecture_id: string | null;
  course_id: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface BatchSummaryRow {
  run_id: string;
  status: string;
  error: string | null;
  filename: string | null;
  lecture_id: string | null;
  title: string | null;
  deck_summary: string | null;
  slide_count: number;
  quiz_count: number;
  flagged_count: number;
}

/** Client-side queue entry, one per picked file, before/while it's submitted. */
export type QueueFileStatus = 'queued' | 'uploading' | 'parsing' | 'done' | 'failed';

export interface BatchFileEntry {
  fileId: string;
  file: File;
  status: QueueFileStatus;
  error?: string | null;
  runId?: string | null;
  lectureId?: string | null;
  pdfHash?: string | null;
}
