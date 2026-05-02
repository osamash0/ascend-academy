/**
 * Create-assignment dialog used by the professor dashboard.
 *
 * Lecture multi-select is a checkbox list of the professor's own lectures
 * (passed in as a prop to avoid a second fetch). Due date uses the native
 * <input type="date"> for keyboard accessibility and simplicity. We
 * intentionally don't ship a fancy calendar widget here — keeps the surface
 * area small for v1.
 */
import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import {
  createAssignment,
  type CreateAssignmentInput,
  type StudentOption,
} from '@/services/assignmentsService';

interface LectureOption {
  id: string;
  title: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lectures: LectureOption[];
  /** Students eligible to be enrolled. Caller is responsible for fetching. */
  students?: StudentOption[];
  onCreated?: () => void;
}

function defaultDueDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

export function CreateAssignmentDialog({
  open,
  onOpenChange,
  lectures,
  students = [],
  onCreated,
}: Props) {
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState(defaultDueDate());
  const [minScore, setMinScore] = useState<string>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // For tests / single-student rosters: if there is exactly one student,
  // auto-select them so the dialog stays single-step in the simple case.
  // Real usage shows the multi-select with explicit "select all".
  const effectiveStudentIds = useMemo(() => {
    if (selectedStudents.size > 0) return Array.from(selectedStudents);
    if (students.length === 1) return [students[0].id];
    return [];
  }, [selectedStudents, students]);

  const canSubmit = useMemo(() => {
    if (!title.trim()) return false;
    if (selected.size === 0) return false;
    if (!dueDate) return false;
    if (minScore !== '') {
      const n = Number(minScore);
      if (!Number.isFinite(n) || n < 0 || n > 100) return false;
    }
    // Roster is optional — assignment can be created without enrolling
    // anyone yet. Professors can add students later.
    return true;
  }, [title, selected, dueDate, minScore]);

  function reset() {
    setTitle('');
    setDescription('');
    setDueDate(defaultDueDate());
    setMinScore('');
    setSelected(new Set());
    setSelectedStudents(new Set());
  }

  function toggleLecture(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleStudent(id: string) {
    setSelectedStudents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllStudents() {
    setSelectedStudents(new Set(students.map(s => s.id)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const payload: CreateAssignmentInput = {
        title: title.trim(),
        description: description.trim() || undefined,
        lecture_ids: Array.from(selected),
        // Only send roster when explicitly built. Empty = no enrollments yet.
        student_ids: effectiveStudentIds.length > 0 ? effectiveStudentIds : undefined,
        // Treat the picked date as end-of-day local time so "due Sunday" feels right.
        due_at: new Date(`${dueDate}T23:59:59`).toISOString(),
        min_quiz_score: minScore !== '' ? Number(minScore) : undefined,
      };
      await createAssignment(payload);
      toast({ title: 'Assignment created', description: `"${payload.title}" is now visible to students.` });
      reset();
      onOpenChange(false);
      onCreated?.();
    } catch (err) {
      console.error('Create assignment failed:', err);
      toast({
        title: 'Could not create assignment',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!submitting) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg" data-testid="create-assignment-dialog">
        <DialogHeader>
          <DialogTitle>New weekly assignment</DialogTitle>
          <DialogDescription>
            Bundle one or more lectures with a due date. Students automatically complete it
            when they finish the lectures (and meet the optional minimum quiz score).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="assignment-title">Title</Label>
            <Input
              id="assignment-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Week 3 — Catch up on lectures 5 & 6"
              maxLength={200}
              required
              data-testid="assignment-title-input"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="assignment-description">Description (optional)</Label>
            <Textarea
              id="assignment-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Anything students should know before they start."
              maxLength={4000}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="assignment-due">Due date</Label>
              <Input
                id="assignment-due"
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                required
                data-testid="assignment-due-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="assignment-min-score">Min quiz score (%)</Label>
              <Input
                id="assignment-min-score"
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                value={minScore}
                onChange={e => setMinScore(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          {students.length > 1 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Students enrolled</Label>
                <button
                  type="button"
                  className="text-xs font-bold text-primary hover:underline"
                  onClick={selectAllStudents}
                  data-testid="assignment-select-all-students"
                >
                  Select all ({students.length})
                </button>
              </div>
              <div
                className="max-h-40 overflow-y-auto rounded-lg border border-white/5 bg-surface-1 divide-y divide-white/5"
                data-testid="assignment-student-list"
              >
                {students.map(s => {
                  const checked = selectedStudents.has(s.id);
                  return (
                    <label
                      key={s.id}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-white/5"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleStudent(s.id)}
                        data-testid={`assignment-student-${s.id}`}
                      />
                      <span className="text-sm text-foreground line-clamp-1">
                        {s.full_name || s.id}
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Only enrolled students will see this assignment.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Lectures</Label>
            {lectures.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You haven't created any lectures yet. Upload one before assigning it.
              </p>
            ) : (
              <div
                className="max-h-48 overflow-y-auto rounded-lg border border-white/5 bg-surface-1 divide-y divide-white/5"
                data-testid="assignment-lecture-list"
              >
                {lectures.map(l => {
                  const checked = selected.has(l.id);
                  return (
                    <label
                      key={l.id}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-white/5"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleLecture(l.id)}
                        data-testid={`assignment-lecture-${l.id}`}
                      />
                      <span className="text-sm text-foreground line-clamp-1">{l.title}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit || submitting}
              data-testid="assignment-submit-button"
            >
              {submitting ? 'Creating…' : 'Create assignment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
