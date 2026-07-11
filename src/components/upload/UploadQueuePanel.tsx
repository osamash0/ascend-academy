import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, GripVertical, Loader2, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BatchFileEntry } from '@/types/upload';

const STATUS_LABEL: Record<BatchFileEntry['status'], string> = {
  queued: 'Queued',
  uploading: 'Uploading…',
  parsing: 'Parsing…',
  done: 'Done',
  failed: 'Failed',
};

function StatusPill({ status }: { status: BatchFileEntry['status'] }) {
  if (status === 'done') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
        <CheckCircle2 className="w-3.5 h-3.5" /> {STATUS_LABEL[status]}
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
        <AlertCircle className="w-3.5 h-3.5" /> {STATUS_LABEL[status]}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
      <Loader2 className="w-3.5 h-3.5 animate-spin" /> {STATUS_LABEL[status]}
    </span>
  );
}

interface UploadQueuePanelProps {
  files: BatchFileEntry[];
  onRemove: (fileId: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onRetry: (fileId: string) => void;
  submitted: boolean;
}

export function UploadQueuePanel({ files, onRemove, onReorder, onRetry, submitted }: UploadQueuePanelProps) {
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const doneCount = files.filter((f) => f.status === 'done').length;
  const failedCount = files.filter((f) => f.status === 'failed').length;

  if (files.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card/60 overflow-hidden" data-testid="upload-queue-panel">
      {submitted && (
        <div className="px-4 py-2 border-b border-border text-xs text-muted-foreground">
          {doneCount} of {files.length} done{failedCount > 0 ? `, ${failedCount} failed` : ''}
          {doneCount + failedCount < files.length ? ', processing…' : ''}
        </div>
      )}
      <ul>
        {files.map((entry, index) => (
          <li
            key={entry.fileId}
            draggable={!submitted}
            onDragStart={() => {
              dragIndex.current = index;
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverIndex(index);
            }}
            onDragEnd={() => {
              setDragOverIndex(null);
              dragIndex.current = null;
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex.current !== null && dragIndex.current !== index) {
                onReorder(dragIndex.current, index);
              }
              setDragOverIndex(null);
              dragIndex.current = null;
            }}
            className={cn(
              'flex items-center gap-3 px-4 py-2.5 border-b border-border/50 last:border-b-0',
              dragOverIndex === index && 'bg-violet-500/5',
            )}
          >
            {!submitted && (
              <GripVertical className="w-4 h-4 text-muted-foreground/50 cursor-grab shrink-0" />
            )}
            <span className="flex-1 min-w-0 text-sm text-foreground truncate">{entry.file.name}</span>
            <StatusPill status={entry.status} />
            {entry.status === 'failed' && entry.error && (
              <span className="text-xs text-muted-foreground max-w-[16rem] truncate" title={entry.error}>
                {entry.error}
              </span>
            )}
            {entry.status === 'failed' && entry.runId && (
              <button
                type="button"
                onClick={() => onRetry(entry.fileId)}
                className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700 shrink-0"
                data-testid="retry-file"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Retry
              </button>
            )}
            {!submitted && (
              <button
                type="button"
                onClick={() => onRemove(entry.fileId)}
                className="text-muted-foreground hover:text-foreground shrink-0"
                aria-label={`Remove ${entry.file.name}`}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
