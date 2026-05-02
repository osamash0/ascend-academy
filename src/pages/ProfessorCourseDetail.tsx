import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, BookOpen, Loader2, Plus, FileText, X, ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  getCourse,
  unassignLectureFromCourse,
  assignLectureToCourse,
  type CourseWithLectures,
} from '@/services/coursesService';
import { fetchProfessorLectures } from '@/services/lectureService';
import { useAuth } from '@/lib/auth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Lecture } from '@/types/domain';

export default function ProfessorCourseDetail() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [course, setCourse] = useState<CourseWithLectures | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allLectures, setAllLectures] = useState<Lecture[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!courseId) return;
    setLoading(true);
    try {
      setCourse(await getCourse(courseId));
    } catch (e) {
      console.error(e);
      toast({ title: 'Failed to load course', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [courseId, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openPicker = async () => {
    if (!user) return;
    setPickerOpen(true);
    setPickerLoading(true);
    try {
      const all = await fetchProfessorLectures(user.id);
      setAllLectures(all);
    } finally {
      setPickerLoading(false);
    }
  };

  const handleAssign = async (lectureId: string) => {
    if (!courseId) return;
    try {
      await assignLectureToCourse(courseId, lectureId);
      toast({ title: 'Lecture added to course' });
      setPickerOpen(false);
      await refresh();
    } catch (e) {
      toast({ title: 'Assign failed', description: String(e), variant: 'destructive' });
    }
  };

  const handleUnassign = async (lectureId: string) => {
    if (!courseId) return;
    if (!confirm('Remove this lecture from the course?')) return;
    try {
      await unassignLectureFromCourse(courseId, lectureId);
      await refresh();
    } catch (e) {
      toast({ title: 'Unassign failed', variant: 'destructive' });
    }
  };

  if (loading || !course) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const assignedIds = new Set(course.lectures.map((l) => l.id));
  const unassignable = allLectures.filter((l) => !assignedIds.has(l.id));

  return (
    <div className="relative min-h-screen p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      <Button variant="ghost" onClick={() => navigate('/professor/courses')} className="gap-2">
        <ArrowLeft className="w-4 h-4" /> All courses
      </Button>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: course.color || '#6366f1' }}
          >
            <BookOpen className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{course.title}</h1>
            {course.description && (
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{course.description}</p>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              {course.lectures.length} lecture{course.lectures.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <Button onClick={openPicker} className="gap-2">
          <Plus className="w-4 h-4" /> Add lecture
        </Button>
      </div>

      {course.lectures.length === 0 ? (
        <div className="glass-card p-10 text-center space-y-3">
          <FileText className="w-10 h-10 mx-auto text-muted-foreground" />
          <p className="font-semibold">No lectures in this course yet</p>
          <p className="text-sm text-muted-foreground">Add an existing lecture, or upload a new one.</p>
          <div className="flex justify-center gap-2">
            <Button onClick={openPicker} variant="outline" className="gap-2"><Plus className="w-4 h-4" /> Add existing</Button>
            <Button onClick={() => navigate('/professor/upload')} className="gap-2"><Plus className="w-4 h-4" /> Upload new</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {course.lectures.map((l) => (
            <div key={l.id} className="glass-card p-5 space-y-3 group">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-bold text-foreground line-clamp-2">{l.title}</h3>
                <button
                  onClick={() => handleUnassign(l.id)}
                  className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Remove from course"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {l.description && (
                <p className="text-sm text-muted-foreground line-clamp-2">{l.description}</p>
              )}
              <p className="text-xs text-muted-foreground">{l.total_slides} slides</p>
              <div className="flex gap-2 pt-2 border-t border-white/5">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs"
                  onClick={() => navigate(`/professor/lecture/${l.id}`)}
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Edit
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add lecture to course</DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto -mx-2">
            {pickerLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : unassignable.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">
                All your lectures are already in this course.
              </p>
            ) : (
              <ul className="space-y-1">
                {unassignable.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => handleAssign(l.id)}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted transition-colors flex items-center justify-between gap-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground line-clamp-1">{l.title}</p>
                        <p className="text-xs text-muted-foreground">{l.total_slides} slides</p>
                      </div>
                      <Plus className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
