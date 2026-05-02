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
import { Sparkles, RotateCw, Calendar } from "lucide-react";

interface ParseCacheDialogProps {
  open: boolean;
  parsedAt: string | null;
  onUseCached: () => void;
  onReparse: () => void;
  onCancel: () => void;
}

function formatDate(iso: string | null): string {
  if (!iso) return "an earlier session";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "an earlier session";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Surfaces the global `pdf_parse_cache` hit to the user.
 *
 * The existing DuplicatePDFDialog only fires for PDFs that the current
 * professor has already saved as a lecture. This dialog covers the other
 * case: the parse cache has a result for this file (because the user
 * bailed on a previous upload, or a colleague uploaded it first) and we
 * would otherwise silently serve the cached parse. The user picks
 * "Use saved parse" (fast, free) or "Generate fresh" (forceReparse=true).
 */
export function ParseCacheDialog({
  open,
  parsedAt,
  onUseCached,
  onReparse,
  onCancel,
}: ParseCacheDialogProps) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>We've parsed this PDF before</AlertDialogTitle>
          <AlertDialogDescription>
            A saved parse for this exact file is on record. You can reuse
            it (instant, no AI cost) or generate a fresh parse from scratch
            with the latest pipeline.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="mt-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="h-4 w-4 shrink-0" />
            <span>Last parsed on {formatDate(parsedAt)}</span>
          </div>
        </div>

        <AlertDialogFooter className="mt-4 gap-2 sm:gap-2">
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onReparse}
            className="bg-muted text-foreground hover:bg-muted/80"
          >
            <RotateCw className="mr-2 h-4 w-4" />
            Generate fresh
          </AlertDialogAction>
          <AlertDialogAction onClick={onUseCached}>
            <Sparkles className="mr-2 h-4 w-4" />
            Use saved parse
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
