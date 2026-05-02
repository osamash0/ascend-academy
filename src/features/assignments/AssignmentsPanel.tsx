/**
 * Student-facing assignments panel.
 *
 * Lists every assignment visible to the current student with a status pill,
 * due date, progress bar, and a CTA into the first incomplete lecture of
 * the assignment. The panel is intentionally a no-op when the student has
 * no assignments yet (we don't want to clutter the dashboard).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ClipboardList, ChevronRight, AlertTriangle, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import {
  listAssignments,
  type Assignment,
  type AssignmentStatus,
} from '@/services/assignmentsService';
import { fetchStudentDashboard } from '@/services/studentService';
import { Button } from '@/components/ui/button';

const STATUS_LABEL: Record<AssignmentStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
  overdue: 'Overdue',
};

const STATUS_CLASSES: Record<AssignmentStatus, string> = {
  not_started: 'bg-surface-2 text-muted-foreground border-white/5',
  in_progress: 'bg-primary/10 text-primary border-primary/20',
  completed: 'bg-success/10 text-success border-success/20',
  overdue: 'bg-destructive/10 text-destructive border-destructive/20',
};

function StatusIcon({ status }: { status: AssignmentStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-3.5 h-3.5" />;
    case 'overdue':
      return <AlertTriangle className="w-3.5 h-3.5" />;
    case 'in_progress':
      return <Loader2 className="w-3.5 h-3.5" />;
    default:
      return <Circle className="w-3.5 h-3.5" />;
  }
}

function formatDueDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

interface Props {
  userId: string;
  /** Optional cap for how many to show on the dashboard. */
  limit?: number;
}

export function AssignmentsPanel({ userId, limit = 5 }: Props) {
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [progressByLecture, setProgressByLecture] = useState<Map<string, { completed: boolean }>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [list, dashboard] = await Promise.all([
          listAssignments(),
          fetchStudentDashboard(userId),
        ]);
        if (cancelled) return;
        setAssignments(list);
        const m = new Map<string, { completed: boolean }>();
        for (const p of dashboard.progress) {
          m.set(p.lecture_id, { completed: !!p.completed_at });
        }
        setProgressByLecture(m);
      } catch (err) {
        console.error('Failed to load assignments:', err);
        if (!cancelled) setAssignments([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const visible = useMemo(
    () => (assignments ?? []).slice(0, limit),
    [assignments, limit],
  );

  if (loading) {
    return (
      <div className="space-y-4" data-testid="assignments-panel-loading">
        <div className="h-6 w-48 bg-surface-2 rounded animate-pulse" />
        <div className="glass-card p-6 animate-pulse h-32" />
      </div>
    );
  }

  if (!assignments || assignments.length === 0) {
    return null;
  }

  return (
    <div className="space-y-5" data-testid="assignments-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-primary" />
          <h2 className="text-heading-lg text-foreground">Assignments</h2>
        </div>
        <span className="text-caption text-muted-foreground">
          {assignments.length} active
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visible.map(a => {
          const status = a.status ?? 'not_started';
          const pct = a.progress_percentage ?? 0;
          const firstIncomplete = a.lecture_ids.find(
            lid => !progressByLecture.get(lid)?.completed,
          );
          const ctaLecture = firstIncomplete ?? a.lecture_ids[0];

          return (
            <div
              key={a.id}
              data-testid={`assignment-card-${a.id}`}
              className="glass-card p-5 space-y-4 border-white/5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <h3 className="font-semibold text-foreground line-clamp-1">
                    {a.title}
                  </h3>
                  {a.description && (
                    <p className="text-body-sm text-muted-foreground line-clamp-2">
                      {a.description}
                    </p>
                  )}
                </div>
                <span
                  data-testid={`assignment-status-${a.id}`}
                  className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wider border ${STATUS_CLASSES[status]}`}
                >
                  <StatusIcon status={status} />
                  {STATUS_LABEL[status]}
                </span>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-caption text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CalendarDays className="w-3 h-3" />
                    Due {formatDueDate(a.due_at)}
                  </span>
                  <span>
                    {a.completed_count ?? 0} / {a.total_count ?? a.lecture_ids.length} lectures
                  </span>
                </div>
                <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                {a.min_quiz_score != null ? (
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Min quiz score {a.min_quiz_score}%
                  </span>
                ) : (
                  <span />
                )}
                {ctaLecture && status !== 'completed' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-primary hover:text-primary"
                    onClick={() => navigate(`/lecture/${ctaLecture}`)}
                  >
                    Continue
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
