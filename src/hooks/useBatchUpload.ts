import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import { naturalSort, safeGetUUID } from '@/lib/utils';
import type { BatchFileEntry, QueueFileStatus, UploadJob } from '@/types/upload';

// Same pattern as usePDFUpload's upload-limit cache, for the batch file-count cap.
const FALLBACK_MAX_BATCH_FILES = 30;
let cachedMaxBatchFiles = FALLBACK_MAX_BATCH_FILES;
let batchConfigLoaded = false;

async function loadBatchConfig(): Promise<void> {
  if (batchConfigLoaded) return;
  batchConfigLoaded = true;
  try {
    const cfg = await apiClient.get<{ maxBatchFiles?: number }>('/api/upload/config');
    if (cfg?.maxBatchFiles && cfg.maxBatchFiles > 0) cachedMaxBatchFiles = cfg.maxBatchFiles;
  } catch {
    batchConfigLoaded = false; // allow a later retry; keep the fallback for now
  }
}

interface BatchUploadResponseFile {
  filename: string;
  pdf_hash: string | null;
  run_id: string | null;
  status: string;
  error?: string;
}

interface UseBatchUploadOptions {
  courseId: string | null;
  parsingMode: 'ai' | 'on_demand';
  aiModel: string;
}

function jobStatusToQueueStatus(status: UploadJob['status']): QueueFileStatus {
  if (status === 'completed') return 'done';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  if (status === 'queued') return 'queued';
  return 'parsing'; // extracting/outlining/analyzing/embedding/finalizing
}

/**
 * Multi-file upload queue (Phase 1). A sibling to usePDFUpload, not a
 * generalization of it — that hook's SSE-driven inline slide editor doesn't
 * apply here: a batch upload has no editor step, course_id is set at
 * enqueue time, and per-file progress is polled (not streamed) so it
 * survives the professor navigating away or closing the tab.
 */
export function useBatchUpload({ courseId, parsingMode, aiModel }: UseBatchUploadOptions) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<BatchFileEntry[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => { void loadBatchConfig(); }, []);

  const addFiles = useCallback((picked: File[]) => {
    setFiles((prev) => {
      const remaining = Math.max(0, cachedMaxBatchFiles - prev.length);
      const entries: BatchFileEntry[] = naturalSort(picked)
        .slice(0, remaining)
        .map((file) => ({ fileId: safeGetUUID(), file, status: 'queued' }));
      return [...prev, ...entries];
    });
  }, []);

  const removeFile = useCallback((fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.fileId !== fileId));
  }, []);

  const reorderFiles = useCallback((fromIndex: number, toIndex: number) => {
    setFiles((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      if (moved) next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const jobsQuery = useQuery({
    queryKey: ['upload-jobs', batchId],
    queryFn: async () => {
      const res = await apiClient.get<{ jobs: UploadJob[] }>(`/api/upload/jobs?batch_id=${batchId}`);
      return res.jobs;
    },
    enabled: !!batchId,
    refetchInterval: (query) => {
      const jobs = query.state.data ?? [];
      const allSettled = jobs.length > 0 && jobs.every((j) => jobStatusToQueueStatus(j.status) !== 'queued' && jobStatusToQueueStatus(j.status) !== 'parsing');
      return allSettled ? false : 4000;
    },
  });

  // Merge polled server state into the local (ordered, user-reorderable) file list by pdf_hash.
  const mergedFiles: BatchFileEntry[] = files.map((f) => {
    const job = jobsQuery.data?.find((j) => j.pdf_hash && j.pdf_hash === f.pdfHash);
    if (!job) return f;
    return {
      ...f,
      status: jobStatusToQueueStatus(job.status),
      runId: job.run_id,
      lectureId: job.lecture_id,
      error: job.error,
    };
  });

  const allSettled = mergedFiles.length > 0 && mergedFiles.every((f) => f.status === 'done' || f.status === 'failed');

  const submitBatch = useCallback(async (): Promise<{ batchId: string } | null> => {
    if (files.length === 0) return null;
    setIsSubmitting(true);
    try {
      const formData = new FormData();
      files.forEach((f) => formData.append('files', f.file));
      if (courseId) formData.append('course_id', courseId);
      formData.append('parsing_mode', parsingMode);
      formData.append('ai_model', aiModel);

      const response = await apiClient.upload('/api/v1/upload/batch', formData);
      const body = (await response.json()) as { batch_id: string; files: BatchUploadResponseFile[] };

      setFiles((prev) =>
        prev.map((f) => {
          const match = body.files.find((r) => r.filename === f.file.name);
          if (!match) return f;
          return {
            ...f,
            status: match.status === 'failed' ? 'failed' : 'queued',
            error: match.error ?? null,
            runId: match.run_id,
            pdfHash: match.pdf_hash,
          };
        }),
      );
      setBatchId(body.batch_id);
      return { batchId: body.batch_id };
    } finally {
      setIsSubmitting(false);
    }
  }, [files, courseId, parsingMode, aiModel]);

  const retryFile = useCallback(
    async (fileId: string) => {
      const entry = mergedFiles.find((f) => f.fileId === fileId);
      if (!entry?.runId) return; // pre-flight (validation) failures have no run_id and can't be retried as-is
      await apiClient.post(`/api/v1/upload/jobs/${entry.runId}/retry`, {});
      setFiles((prev) => prev.map((f) => (f.fileId === fileId ? { ...f, status: 'queued', error: null } : f)));
      void queryClient.invalidateQueries({ queryKey: ['upload-jobs', batchId] });
    },
    [mergedFiles, batchId, queryClient],
  );

  return {
    files: mergedFiles,
    addFiles,
    removeFile,
    reorderFiles,
    submitBatch,
    retryFile,
    batchId,
    isSubmitting,
    allSettled,
    maxBatchFiles: cachedMaxBatchFiles,
  };
}
