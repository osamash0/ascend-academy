import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BookOpen, Plus, Loader2, Trash2, Pencil, ChevronRight, Archive, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
  listCourses,
  deleteCourse,
  type Course,
} from '@/services/coursesService';
import { COLOR_SWATCHES, CreateCourseDialog } from '@/features/courses/components/CreateCourseDialog';

import { useCurriculumTranslation } from '@/hooks/useCurriculumTranslation';

export default function ProfessorCourses() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const translateCurriculum = useCurriculumTranslation();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Course | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setCourses(await listCourses());
    } catch (e) {
      console.error(e);
      toast({ title: 'Failed to load courses', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (c: Course) => {
    setEditing(c);
    setOpen(true);
  };

  const handleSuccess = async (course: Course) => {
    setOpen(false);
    await refresh();
  };


  const handleDelete = async (c: Course) => {
    if (c.lecture_count > 0) {
      toast({
        title: 'Course has lectures',
        description: 'Open the course and unassign lectures first, or delete them.',
        variant: 'destructive',
      });
      return;
    }
    if (!confirm(`Delete course "${c.title}"?`)) return;
    try {
      await deleteCourse(c.id);
      toast({ title: 'Course deleted' });
      await refresh();
    } catch (e) {
      console.error(e);
      toast({ title: 'Delete failed', variant: 'destructive' });
    }
  };

  const handleArchive = async (c: Course) => {
    if (!confirm(`Archive course "${c.title}"? This will hide it from active lists. You can restore it anytime from the Archive.`)) return;
    try {
      await updateCourse(c.id, { is_archived: true });
      toast({ title: 'Course archived' });
      await refresh();
    } catch (e) {
      console.error(e);
      toast({ title: 'Archive failed', variant: 'destructive' });
    }
  };

  return (
    <div className="relative min-h-screen p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Courses</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Group your lectures into subjects so students see them organised.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="w-4 h-4" /> New Course
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : courses.length === 0 ? (
        <div className="glass-card p-12 text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
            <BookOpen className="w-8 h-8 text-white" />
          </div>
          <p className="text-lg font-semibold">No courses yet</p>
          <p className="text-sm text-muted-foreground">Create your first course to start grouping lectures.</p>
          <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> Create course</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {courses.map((c) => {
            const translatedTitle = translateCurriculum(c.title);
            return (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card p-6 space-y-4 cursor-pointer group hover:border-primary/40 transition-all"
              onClick={() => navigate(`/professor/courses/${c.id}`)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{ background: c.color || COLOR_SWATCHES[0] }}
                  >
                    <BookOpen className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-foreground">{translatedTitle}</h3>
                    <p className="text-xs text-muted-foreground">
                      {c.lecture_count} lecture{c.lecture_count === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              {c.description && (
                <p className="text-sm text-muted-foreground line-clamp-2">{c.description}</p>
              )}
              <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); openEdit(c); }}
                  className="gap-1.5 text-xs"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); void handleArchive(c); }}
                  className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Archive className="w-3.5 h-3.5" /> Archive
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); void handleDelete(c); }}
                  className="gap-1.5 text-xs text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </Button>
              </div>
            </motion.div>
          )})}
        </div>
      )}

      <CreateCourseDialog 
        open={open} 
        onOpenChange={setOpen} 
        editingCourse={editing} 
        onSuccess={handleSuccess} 
      />
    </div>
  );
}
