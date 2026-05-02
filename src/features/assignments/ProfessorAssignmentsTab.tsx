/**
 * Professor-facing assignments tab — list of own assignments + create dialog.
 *
 * Slots into the existing professor dashboard alongside the lectures table.
 */
import { useCallback, useEffect, useState } from 'react';
import { Plus, ClipboardList, Trash2, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  deleteAssignment,
  listAssignments,
  listEnrollableStudents,
  type Assignment,
  type StudentOption,
} from '@/services/assignmentsService';
import { CreateAssignmentDialog } from './CreateAssignmentDialog';

interface Props {
  lectures: { id: string; title: string }[];
}

function formatDate(iso: string): string {
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

export function ProfessorAssignmentsTab({ lectures }: Props) {
  const { toast } = useToast();
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const [list, studentList] = await Promise.all([
        listAssignments(),
        listEnrollableStudents().catch(err => {
          console.error('Failed to load students:', err);
          return [] as StudentOption[];
        }),
      ]);
      setAssignments(list);
      setStudents(studentList);
    } catch (err) {
      console.error('Failed to load assignments:', err);
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleDelete(id: string, title: string) {
    if (!window.confirm(`Delete "${title}"? Students will no longer see it.`)) return;
    try {
      await deleteAssignment(id);
      setAssignments(prev => (prev ?? []).filter(a => a.id !== id));
      toast({ title: 'Assignment deleted' });
    } catch (err) {
      console.error(err);
      toast({
        title: 'Failed to delete',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }

  return (
    <div className="space-y-6" data-testid="professor-assignments-tab">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-foreground tracking-tight">Assignments</h2>
            <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.3em] mt-1 opacity-60">
              Weekly tasks built on top of your lectures
            </p>
          </div>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="gap-2"
          data-testid="open-create-assignment"
        >
          <Plus className="w-4 h-4" />
          New assignment
        </Button>
      </div>

      {loading ? (
        <div className="glass-card p-8 animate-pulse h-40" />
      ) : !assignments || assignments.length === 0 ? (
        <div className="glass-card p-12 text-center border-dashed border-2 border-white/5">
          <ClipboardList className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-foreground mb-1">No assignments yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Create an assignment to give students a weekly target tied to your existing lectures.
          </p>
        </div>
      ) : (
        <div className="glass-card rounded-2xl border-white/5 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-white/5 border-b border-white/5">
              <tr>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Title
                </th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Lectures
                </th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Due
                </th>
                <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Min score
                </th>
                <th className="px-6 py-4 text-right text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {assignments.map(a => (
                <tr key={a.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-bold text-foreground">{a.title}</div>
                    {a.description && (
                      <div className="text-xs text-muted-foreground line-clamp-1 mt-1">
                        {a.description}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    {a.lecture_ids.length}
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="w-3 h-3" />
                      {formatDate(a.due_at)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    {a.min_quiz_score != null ? `${a.min_quiz_score}%` : '—'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                      onClick={() => handleDelete(a.id, a.title)}
                      title="Delete assignment"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateAssignmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        lectures={lectures}
        students={students}
        onCreated={refresh}
      />
    </div>
  );
}
