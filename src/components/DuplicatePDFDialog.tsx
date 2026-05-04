import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FileText, Calendar, Layers } from "lucide-react";

export interface DuplicateMatch {
  id: string;
  title: string | null;
  created_at: string | null;
  total_slides: number | null;
}

interface DuplicatePDFDialogProps {
  open: boolean;
  matches: DuplicateMatch[];
  onUseExisting: (lectureId: string) => void;
  onUploadAsNew: () => void;
  onCancel: () => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Unknown date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown date";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function DuplicatePDFDialog({
  open,
  matches,
  onUseExisting,
  onUploadAsNew,
  onCancel,
}: DuplicatePDFDialogProps) {
  // When multiple lectures share the same PDF, the professor must be
  // able to choose which one to open — defaulting to the most recent
  // (matches[0]) but selectable via radios. For a single match, this
  // collapses to a one-row card.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (open) setSelectedId(matches[0]?.id ?? null);
  }, [open, matches]);

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>You've uploaded this PDF before</AlertDialogTitle>
          <AlertDialogDescription>
            {matches.length === 1
              ? "This file matches an existing lecture in your library. Open the existing one or re-parse it as a new lecture."
              : `This file matches ${matches.length} existing lectures in your library. Choose one to open or re-parse it as a new lecture.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {matches.length > 0 && (
          <div
            role={matches.length > 1 ? "radiogroup" : "group"}
            aria-label={
              matches.length > 1 ? "Existing matching lectures" : "Existing lecture"
            }
            className="mt-2 space-y-2 max-h-64 overflow-y-auto"
          >
            {matches.map((m) => {
              const checked = selectedId === m.id;
              const interactive = matches.length > 1;
              return (
                <label
                  key={m.id}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-sm transition-colors ${
                    interactive ? "cursor-pointer" : ""
                  } ${
                    checked
                      ? "border-violet-500 bg-violet-500/5"
                      : "border-border bg-muted/40 hover:bg-muted/60"
                  }`}
                >
                  {interactive && (
                    <input
                      type="radio"
                      name="duplicate-match"
                      value={m.id}
                      checked={checked}
                      onChange={() => setSelectedId(m.id)}
                      className="mt-1 h-4 w-4 accent-violet-500"
                      aria-label={m.title || "Untitled lecture"}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-medium text-foreground">
                      <FileText className="w-4 h-4 text-violet-500 shrink-0" />
                      <span className="truncate">{m.title || "Untitled lecture"}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatDate(m.created_at)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Layers className="w-3 h-3" />
                        {(m.total_slides ?? 0)} slides
                      </span>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}

        <AlertDialogFooter className="mt-4 gap-2 sm:gap-2">
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onUploadAsNew}
            className="bg-muted text-foreground hover:bg-muted/80"
          >
            Upload as new
          </AlertDialogAction>
          <AlertDialogAction
            onClick={() => selectedId && onUseExisting(selectedId)}
            disabled={!selectedId}
          >
            Use existing
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
