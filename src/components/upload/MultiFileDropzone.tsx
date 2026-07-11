import { useCallback, useRef, useState } from 'react';
import { FolderOpen, UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';

const ACCEPTED_EXTENSIONS = ['.pdf']; // .pptx isn't supported in batch upload yet (see backend/api/v1/upload.py)

function filterAccepted(files: File[]): File[] {
  return files.filter((f) => ACCEPTED_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext)));
}

interface MultiFileDropzoneProps {
  onFilesSelected: (files: File[]) => void;
  maxFiles: number;
  currentCount: number;
  /** Hide the "select a folder" affordance — irrelevant when maxFiles=1
   * (single personal-upload flows, e.g. My Materials). Defaults to shown. */
  hideFolderOption?: boolean;
}

/** Drag-drop + click-to-browse + folder-drop multi-file picker. No drag
 * library — this only needs plain HTML5 drag events and native file/folder
 * inputs, not a sortable primitive (reordering lives in UploadQueuePanel). */
export function MultiFileDropzone({ onFilesSelected, maxFiles, currentCount, hideFolderOption }: MultiFileDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const remaining = Math.max(0, maxFiles - currentCount);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      const accepted = filterAccepted(Array.from(fileList));
      if (accepted.length > 0) onFilesSelected(accepted);
    },
    [onFilesSelected],
  );

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        data-testid="multi-file-dropzone"
        className={cn(
          'rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors',
          isDragOver ? 'border-violet-500 bg-violet-500/5' : 'border-border hover:border-violet-400/60',
        )}
      >
        <UploadCloud className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Drop PDFs here, or click to browse</p>
        <p className="text-xs text-muted-foreground mt-1">
          Up to {remaining} more file{remaining === 1 ? '' : 's'} ({maxFiles} per batch)
        </p>
        {!hideFolderOption && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              folderInputRef.current?.click();
            }}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-700"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Or select a folder
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        multiple
        aria-label="Choose PDF files"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
        className="hidden"
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error non-standard attributes, Chrome/Edge/Firefox support them
        webkitdirectory=""
        directory=""
        multiple
        aria-label="Choose a folder of PDF files"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
        className="hidden"
      />
    </div>
  );
}
