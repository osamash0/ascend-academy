import { useMemo, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  PartyPopper,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { fetchBatchSummary } from '@/services/uploadBatchService';
import { ProfessorRoutes, StudentRoutes } from '@/lib/routes';

/**
 * Phase 1.3 batch review screen. There is no draft/published state on
 * lectures today (schema has only is_archived) — a batch-created lecture is
 * already live in its course the moment the parse job finishes. So "Done
 * reviewing" here is intentionally cosmetic (a local dismissal), not a real
 * publish action; see the Phase 1 plan for why this was chosen over adding
 * a schema column for this pass.
 *
 * Styled to match LectureUpload.tsx's visual language (gradient header icon,
 * violet/indigo CTAs) rather than a generic console list — this screen is
 * the direct continuation of that same upload flow, just for N lectures.
 */
export default function BatchReviewPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = location.state as any;
  const fromOnboarding = routeState?.fromOnboarding;
  const targetCourseTitle = routeState?.targetCourseTitle;
  
  const { toast } = useToast();
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());

  const { data: lectures, isLoading, error } = useQuery({
    queryKey: ['batch-summary', batchId],
    queryFn: () => fetchBatchSummary(batchId!),
    enabled: !!batchId,
  });

  const remaining = useMemo(
    () => (lectures ?? []).filter((l) => !reviewed.has(l.run_id)),
    [lectures, reviewed],
  );

  const markAllReviewed = () => {
    if (!lectures) return;
    setReviewed(new Set(lectures.map((l) => l.run_id)));
    toast({ title: 'Batch reviewed', description: `${lectures.length} lecture(s) are live in the course.` });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header — same gradient-icon + back-button treatment as LectureUpload */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (fromOnboarding) {
                  navigate(StudentRoutes.LIBRARY, { state: { onboardTarget: targetCourseTitle } });
                } else {
                  navigate(ProfessorRoutes.UPLOAD);
                }
              }}
              className="rounded-full h-8 w-8"
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <PartyPopper className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Batch review</h1>
              <p className="text-xs text-muted-foreground">
                {lectures ? `${lectures.length} lecture${lectures.length === 1 ? '' : 's'} ready` : 'Loading…'}
              </p>
            </div>
          </div>
          {lectures && lectures.length > 0 && remaining.length > 0 && (
            <Button
              onClick={markAllReviewed}
              data-testid="mark-all-reviewed"
              className="gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-lg shadow-violet-500/25"
            >
              <CheckCircle2 className="w-4 h-4" />
              Done reviewing all
            </Button>
          )}
          {lectures && lectures.length > 0 && remaining.length === 0 && fromOnboarding && (
            <Button
              onClick={() => navigate(StudentRoutes.LIBRARY, { state: { onboardTarget: targetCourseTitle } })}
              className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/25"
            >
              <CheckCircle2 className="w-4 h-4" />
              Go to Course Library
            </Button>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading batch…
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-destructive py-8">
            <AlertCircle className="w-5 h-5" /> Batch not found.
          </div>
        )}
        {lectures && lectures.length === 0 && (
          <p className="text-center text-muted-foreground py-16">No files in this batch.</p>
        )}

        <div className="space-y-3">
          {(lectures ?? []).map((row, idx) => {
            const isReviewed = reviewed.has(row.run_id);
            const failed = row.status === 'failed';
            return (
              <motion.div
                key={row.run_id}
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: idx * 0.05 }}
                className={`rounded-2xl border p-5 flex items-center gap-4 shadow-sm transition-opacity ${
                  failed
                    ? 'border-destructive/30 bg-destructive/5'
                    : 'border-border bg-card/60 hover:shadow-md'
                } ${isReviewed ? 'opacity-60' : ''}`}
              >
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-md ${
                    failed
                      ? 'bg-destructive/10 shadow-none'
                      : 'bg-gradient-to-br from-violet-500 to-indigo-600 shadow-violet-500/20'
                  }`}
                >
                  {failed ? (
                    <AlertCircle className="w-5 h-5 text-destructive" />
                  ) : (
                    <BookOpen className="w-5 h-5 text-white" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground truncate">{row.title || row.filename}</h3>
                    {isReviewed && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
                  </div>
                  {failed ? (
                    <p className="text-xs text-destructive mt-1">{row.error || 'Parsing failed.'}</p>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{row.deck_summary}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                          {row.slide_count} slides
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                          {row.quiz_count} quiz questions
                        </span>
                        {row.flagged_count > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-500/10 rounded-full px-2 py-0.5">
                            <Sparkles className="w-3 h-3" /> {row.flagged_count} flagged
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!failed && row.lecture_id && (
                    <Button
                      onClick={() => navigate(ProfessorRoutes.LECTURE_EDIT(row.lecture_id!))}
                      className="gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white shadow-md shadow-violet-500/20"
                    >
                      Open editor <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {!failed && !isReviewed && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setReviewed((prev) => new Set(prev).add(row.run_id));
                        toast({ title: 'Marked reviewed', description: row.title || row.filename || undefined });
                      }}
                      data-testid="done-reviewing"
                    >
                      Done reviewing
                    </Button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
